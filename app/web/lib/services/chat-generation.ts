import type { AttachmentItem } from "@pharmacy/shared";
import { stripFixedAssistantSuffix } from "@pharmacy/shared";

import {
  emitDelta as emitDeltaToStream,
  completeStream,
  failStream,
  registerStream,
} from "@/lib/active-streams";
import { PROGRESS_STEP_LABELS, PROGRESS_STEP_ORDER } from "@/lib/chat-progress";
import { prisma } from "@/lib/db";
import {
  buildGeneralPharmacyPrompt,
  buildKbStyledPrompt,
  streamGeneralPharmacyAnswer,
  streamKbStyledAnswer,
  type ModelChatMessage,
} from "@/lib/openai";
import { streamMultimodalChat } from "@/lib/retrieval/ml-service";
import {
  appendConversationMessage,
  getConversationMessages,
  refreshConversationTitle,
} from "@/lib/services/conversations";
import { retrieveAnswer } from "@/lib/services/retrieval";
import { getRuntimeSettings } from "@/lib/services/settings";
import { getAttachmentItems, isImageAttachment } from "@/lib/utils";

function sseChunk(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function toModelHistoryMessages(
  messages: Awaited<ReturnType<typeof getConversationMessages>>,
  currentUserMessageId: string,
  maxCreatedAt: Date
): ModelChatMessage[] {
  const historyMessages = messages
    .filter((message) => message.id !== currentUserMessageId)
    .filter((message) => message.status === "completed")
    .filter((message) => message.createdAt <= maxCreatedAt)
    .map((message): ModelChatMessage | null => {
      const content = message.contentText.trim();
      if (!content) {
        return null;
      }

      if (message.role === "user") {
        const imagePaths = getAttachmentItems(message.attachmentsJson)
          .filter(isImageAttachment)
          .map((item) => item.path);
        return {
          role: "user",
          content,
          imagePaths,
        };
      }

      if (message.role === "assistant" || message.role === "agent") {
        const assistantContent = stripFixedAssistantSuffix(content);
        if (!assistantContent) {
          return null;
        }

        return {
          role: "assistant",
          content: assistantContent,
        };
      }

      return null;
    })
    .filter((message): message is ModelChatMessage => Boolean(message));

  while (historyMessages[0]?.role === "assistant") {
    historyMessages.shift();
  }

  return historyMessages;
}

function createProgressTracker(onProgress: (payload: unknown) => void) {
  const startedAt = Date.now();
  const stepStartedAtMap = new Map<keyof typeof PROGRESS_STEP_LABELS, number>();
  const stepsSummary = new Map<
    keyof typeof PROGRESS_STEP_LABELS,
    {
      stepKey: keyof typeof PROGRESS_STEP_LABELS;
      label: string;
      startedAtMs: number;
      endedAtMs: number;
      durationMs: number;
      detail?: string;
    }
  >();
  let firstResponseLatencyMs: number | null = null;
  let firstTokenLatencyMs: number | null = null;

  return {
    startStep(stepKey: keyof typeof PROGRESS_STEP_LABELS, detail?: string) {
      const startedAtMs = Date.now() - startedAt;
      stepStartedAtMap.set(stepKey, startedAtMs);
      onProgress({
        stepKey,
        label: PROGRESS_STEP_LABELS[stepKey],
        status: "started",
        startedAtMs,
        elapsedTotalMs: startedAtMs,
        detail,
      });
    },
    completeStep(stepKey: keyof typeof PROGRESS_STEP_LABELS, detail?: string) {
      const endedAtMs = Date.now() - startedAt;
      const startedAtMs = stepStartedAtMap.get(stepKey) ?? endedAtMs;
      const durationMs = Math.max(0, endedAtMs - startedAtMs);
      stepsSummary.set(stepKey, {
        stepKey,
        label: PROGRESS_STEP_LABELS[stepKey],
        startedAtMs,
        endedAtMs,
        durationMs,
        detail,
      });
      onProgress({
        stepKey,
        label: PROGRESS_STEP_LABELS[stepKey],
        status: "completed",
        startedAtMs,
        endedAtMs,
        durationMs,
        elapsedTotalMs: endedAtMs,
        detail,
      });
    },
    markFirstResponse() {
      if (firstResponseLatencyMs !== null) {
        return firstResponseLatencyMs;
      }

      firstResponseLatencyMs = Date.now() - startedAt;
      return firstResponseLatencyMs;
    },
    markFirstToken() {
      if (firstTokenLatencyMs !== null) {
        return firstTokenLatencyMs;
      }

      firstTokenLatencyMs = Date.now() - startedAt;
      return firstTokenLatencyMs;
    },
    getDonePayload() {
      const stepsSummaryList = PROGRESS_STEP_ORDER.map((stepKey) =>
        stepsSummary.get(stepKey)
      ).filter(Boolean);
      const waitFirstTokenMs = stepsSummary.get("await_first_token")?.durationMs;
      const reasoningAnswerMs = stepsSummary.get("reasoning_answer")?.durationMs;
      const streamAnswerMs = stepsSummary.get("stream_answer")?.durationMs;

      return {
        totalDurationMs: Date.now() - startedAt,
        stepsSummary: stepsSummaryList,
        firstResponseLatencyMs,
        firstTokenLatencyMs,
        reasoningAnswerMs,
        waitFirstTokenMs,
        streamAnswerMs,
      };
    },
  };
}

type CreateAssistantGenerationStreamInput =
  | {
      mode: "create";
      conversationId: string;
      text: string;
      attachments: AttachmentItem[];
    }
  | {
      mode: "regenerate";
      conversationId: string;
      text: string;
      attachments: AttachmentItem[];
      userMessageId: string;
      userMessageCreatedAt: Date;
      assistantMessageId: string;
    }
  | {
      mode: "continue";
      conversationId: string;
      text: string;
      attachments: AttachmentItem[];
      userMessageId: string;
      userMessageCreatedAt: Date;
    };

export function createAssistantGenerationStream(input: CreateAssistantGenerationStreamInput) {
  const encoder = new TextEncoder();
  const attachmentImagePaths = input.attachments.map((item) => item.path);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        let closed = false;
        const enqueueChunk = (event: string, data: unknown) => {
          if (closed) {
            return false;
          }
          try {
            controller.enqueue(encoder.encode(sseChunk(event, data)));
            return true;
          } catch {
            closed = true;
            return false;
          }
        };
        const closeStream = () => {
          if (closed) {
            return;
          }
          closed = true;
          try {
            controller.close();
          } catch {
            // 客户端提前断开时，流可能已被运行时关闭。
          }
        };
        let assistantText = "";
        let hasStartedReasoningAnswer = false;
        let hasStartedStreamAnswer = false;
        let assistantMessageId: string | null = null;
        let lastDbUpdate = Date.now();
        const DB_UPDATE_INTERVAL = 500;
        let deltaCount = 0;

        const progress = createProgressTracker((payload) => {
          enqueueChunk("progress", payload);
        });

        const flushToDb = async () => {
          if (!assistantMessageId) return;
          await prisma.chatMessage.update({
            where: { id: assistantMessageId },
            data: { contentText: assistantText },
          });
          lastDbUpdate = Date.now();
          deltaCount = 0;
        };

        const markFirstResponse = (detail?: string) => {
          progress.markFirstResponse();

          if (!hasStartedReasoningAnswer && !hasStartedStreamAnswer) {
            progress.completeStep("await_first_token", detail);
            progress.startStep("reasoning_answer");
            hasStartedReasoningAnswer = true;
          }
        };

        const emitFirstDelta = (delta: string) => {
          if (!hasStartedReasoningAnswer && !hasStartedStreamAnswer) {
            markFirstResponse();
          }

          if (!hasStartedStreamAnswer) {
            progress.markFirstToken();
            if (hasStartedReasoningAnswer) {
              progress.completeStep("reasoning_answer");
            } else {
              progress.completeStep("await_first_token");
            }
            progress.startStep("stream_answer");
            hasStartedStreamAnswer = true;
          }

          assistantText += delta;
          enqueueChunk("delta", { text: delta });
          if (assistantMessageId) {
            emitDeltaToStream(assistantMessageId, delta);
          }
          deltaCount++;
          if (Date.now() - lastDbUpdate >= DB_UPDATE_INTERVAL || deltaCount >= 20) {
            void flushToDb();
          }
        };

        try {
          progress.startStep("save_input");
          const userMessage =
            input.mode === "create"
              ? await appendConversationMessage({
                  conversationId: input.conversationId,
                  role: "user",
                  sourceType: "system",
                  contentText: input.text || "用户上传了图片",
                  attachmentsJson: input.attachments.length
                    ? JSON.stringify(input.attachments)
                    : null,
                })
              : {
                  id: input.userMessageId,
                  createdAt: input.userMessageCreatedAt,
                };

          if (input.mode === "create") {
            await refreshConversationTitle(input.conversationId, input.text || "图片问题");
          } else if (input.mode === "regenerate") {
            await prisma.chatMessage.update({
              where: { id: input.assistantMessageId },
              data: {
                contentText: "",
                status: "streaming",
                sourceType: "system",
                retrievalDebugJson: null,
              },
            });
          }
          progress.completeStep("save_input");

          progress.startStep("summarize_context");
          const settings = await getRuntimeSettings();
          const [allMessages, conversationScope] = await Promise.all([
            getConversationMessages(input.conversationId),
            prisma.conversation.findUnique({
              where: { id: input.conversationId },
              include: { user: { include: { store: true } } },
            }),
          ]);
          const historyMessages = toModelHistoryMessages(
            allMessages,
            userMessage.id,
            userMessage.createdAt
          ).slice(-settings.maxContextTurns * 2);
          while (historyMessages[0]?.role === "assistant") {
            historyMessages.shift();
          }
          progress.completeStep(
            "summarize_context",
            historyMessages.length ? `已加载 ${historyMessages.length} 条历史消息` : "无历史消息"
          );

          const retrieval = await retrieveAnswer(
            {
              question: input.text,
              imagePaths: attachmentImagePaths,
              region: {
                storeId: conversationScope?.user.storeId,
                provinceCode: conversationScope?.user.store?.provinceCode,
                cityCode: conversationScope?.user.store?.cityCode,
                districtCode: conversationScope?.user.store?.districtCode,
              },
              historyMessages,
            },
            {
              startStep: (stepKey, detail) => progress.startStep(stepKey, detail),
              completeStep: (stepKey, detail) => progress.completeStep(stepKey, detail),
            }
          );

          const retrievalDebugJson = JSON.stringify({
            debug: retrieval.retrievalDebug,
            imagePaths: retrieval.sourceType === "kb" ? retrieval.knowledgeItem.imagePaths : [],
          });
          const assistantSourceType =
            retrieval.sourceType === "refusal" ? "system" : retrieval.sourceType;

          enqueueChunk("meta", {
            conversationId: input.conversationId,
            sourceType: assistantSourceType,
            sourceLabel:
              retrieval.sourceType === "kb"
                ? "知识库"
                : retrieval.sourceType === "refusal"
                  ? "知识库未命中"
                  : "大模型",
            knowledgeUpdatedAt:
              retrieval.sourceType === "kb" ? retrieval.knowledgeItem.updatedAt : null,
          });
          enqueueChunk("debug", {
            retrievalDebug: retrieval.retrievalDebug,
            imagePaths: retrieval.sourceType === "kb" ? retrieval.knowledgeItem.imagePaths : [],
          });

          if (input.mode === "create" || input.mode === "continue") {
            const assistantMessage = await appendConversationMessage({
              conversationId: input.conversationId,
              role: "assistant",
              sourceType: assistantSourceType,
              contentText: "",
              status: "streaming",
              retrievalDebugJson,
            });
            assistantMessageId = assistantMessage.id;
          } else {
            assistantMessageId = input.assistantMessageId;
            await prisma.chatMessage.update({
              where: { id: assistantMessageId },
              data: {
                sourceType: assistantSourceType,
                retrievalDebugJson,
              },
            });
          }
          registerStream(assistantMessageId);

          progress.startStep("await_first_token");

          if (retrieval.sourceType === "refusal") {
            emitFirstDelta(retrieval.refusalReason);
          } else {
            const hasGenerationImages =
              attachmentImagePaths.length > 0 ||
              historyMessages.some((message) => Boolean(message.imagePaths?.length));

            if (hasGenerationImages) {
              const prompt =
                retrieval.sourceType === "kb"
                  ? buildKbStyledPrompt({
                      question: input.text,
                      referenceQuestion: retrieval.knowledgeItem.question,
                      referenceAnswer: retrieval.knowledgeItem.answer,
                      referenceSnippets: retrieval.referenceSnippets,
                      knowledgeUpdatedAt: retrieval.knowledgeItem.updatedAt,
                    })
                  : buildGeneralPharmacyPrompt({
                      question: input.text,
                    });
              const messages: ModelChatMessage[] = [
                ...historyMessages,
                {
                  role: "user",
                  content: prompt.userText,
                  imagePaths: attachmentImagePaths,
                },
              ];

              const multimodalResponse = await streamMultimodalChat({
                systemPrompt: prompt.system,
                messages,
              });
              const reader = multimodalResponse.body!.getReader();
              const decoder = new TextDecoder();

              while (true) {
                const { value, done } = await reader.read();
                if (done) {
                  break;
                }
                const delta = decoder.decode(value, { stream: true });
                if (!delta) {
                  continue;
                }
                emitFirstDelta(delta);
              }
            } else {
              const llmStream =
                retrieval.sourceType === "kb"
                  ? await streamKbStyledAnswer({
                      question: input.text,
                      referenceQuestion: retrieval.knowledgeItem.question,
                      referenceAnswer: retrieval.knowledgeItem.answer,
                      referenceSnippets: retrieval.referenceSnippets,
                      knowledgeUpdatedAt: retrieval.knowledgeItem.updatedAt,
                      historyMessages,
                    })
                  : await streamGeneralPharmacyAnswer({
                      question: input.text,
                      historyMessages,
                    });

              for await (const chunk of llmStream) {
                const choiceDelta = chunk.choices[0]?.delta;
                const reasoningDelta =
                  typeof choiceDelta?.reasoning_content === "string"
                    ? choiceDelta.reasoning_content
                    : "";
                if (reasoningDelta) {
                  markFirstResponse("模型已开始推理，等待正文输出");
                }

                const delta = typeof choiceDelta?.content === "string" ? choiceDelta.content : "";
                if (!delta) {
                  continue;
                }
                emitFirstDelta(delta);
              }
            }
          }

          if (!hasStartedStreamAnswer) {
            if (hasStartedReasoningAnswer) {
              progress.completeStep("reasoning_answer", "模型未返回正文内容");
            } else {
              progress.completeStep("await_first_token", "模型未返回正文内容");
            }
          }

          await prisma.chatMessage.update({
            where: { id: assistantMessageId! },
            data: { contentText: assistantText, status: "completed" },
          });
          completeStream(assistantMessageId!);

          if (hasStartedStreamAnswer) {
            progress.completeStep("stream_answer");
          }

          const donePayload = progress.getDonePayload();

          enqueueChunk("done", {
            assistantMessageId,
            answer: assistantText,
            totalDurationMs: donePayload.totalDurationMs,
            stepsSummary: donePayload.stepsSummary,
            firstResponseLatencyMs: donePayload.firstResponseLatencyMs,
            firstTokenLatencyMs: donePayload.firstTokenLatencyMs,
            reasoningAnswerMs: donePayload.reasoningAnswerMs,
            waitFirstTokenMs: donePayload.waitFirstTokenMs,
            streamAnswerMs: donePayload.streamAnswerMs,
          });
          closeStream();
        } catch (error) {
          if (assistantMessageId) {
            await prisma.chatMessage
              .update({
                where: { id: assistantMessageId },
                data: { contentText: assistantText, status: "failed" },
              })
              .catch(() => undefined);
            failStream(assistantMessageId);
          }
          enqueueChunk("error", {
            error: error instanceof Error ? error.message : "生成回答失败",
          });
          closeStream();
        }
      })();
    },
    cancel() {
      // 客户端断开时，后端仍继续生成并写库。
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
