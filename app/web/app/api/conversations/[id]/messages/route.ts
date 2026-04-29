import { NextResponse } from "next/server";

import type { AttachmentItem } from "@pharmacy/shared";
import { FIXED_ASSISTANT_SUFFIX } from "@pharmacy/shared";

import { getCurrentUser } from "@/lib/auth/session";
import { PROGRESS_STEP_LABELS, PROGRESS_STEP_ORDER } from "@/lib/chat-progress";
import { buildGeneralPharmacyPrompt, buildKbStyledPrompt, streamGeneralPharmacyAnswer, streamKbStyledAnswer } from "@/lib/openai";
import { streamMultimodalChat } from "@/lib/retrieval/ml-service";
import {
  appendConversationMessage,
  getConversationDetail,
  getConversationMessages,
  refreshConversationTitle
} from "@/lib/services/conversations";
import { retrieveAnswer } from "@/lib/services/retrieval";

function sseChunk(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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
        detail
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
        detail
      });
      onProgress({
        stepKey,
        label: PROGRESS_STEP_LABELS[stepKey],
        status: "completed",
        startedAtMs,
        endedAtMs,
        durationMs,
        elapsedTotalMs: endedAtMs,
        detail
      });
    },
    getTotalDurationMs() {
      return Date.now() - startedAt;
    },
    getStepsSummary() {
      return PROGRESS_STEP_ORDER.map((stepKey) => stepsSummary.get(stepKey)).filter(Boolean);
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
      const stepsSummaryList = PROGRESS_STEP_ORDER.map((stepKey) => stepsSummary.get(stepKey)).filter(Boolean);
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
        streamAnswerMs
      };
    }
  };
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const conversation = await getConversationDetail(id);
  if (!conversation || conversation.userId !== user.id || conversation.deletedAt) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }

  const messages = await getConversationMessages(id);
  return NextResponse.json({ messages, fixedSuffix: FIXED_ASSISTANT_SUFFIX });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const conversation = await getConversationDetail(id);
  if (!conversation || conversation.userId !== user.id || conversation.deletedAt) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }

  const body = (await request.json()) as { text?: string; attachments?: AttachmentItem[] };
  const text = body.text?.trim() ?? "";
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];

  if (!text && attachments.length === 0) {
    return NextResponse.json({ error: "请输入文字或上传图片后再发送" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const attachmentImagePaths = attachments.map((item) => item.path);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        let assistantText = "";
        let hasStartedReasoningAnswer = false;
        let hasStartedStreamAnswer = false;
        const progress = createProgressTracker((payload) => {
          controller.enqueue(encoder.encode(sseChunk("progress", payload)));
        });

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
          controller.enqueue(encoder.encode(sseChunk("delta", { text: delta })));
        };

        try {
          progress.startStep("save_input");
          await appendConversationMessage({
            conversationId: id,
            role: "user",
            sourceType: "system",
            contentText: text || "用户上传了图片",
            attachmentsJson: attachments.length ? JSON.stringify(attachments) : null
          });
          await refreshConversationTitle(id, text || "图片问题");
          progress.completeStep("save_input");

          const retrieval = await retrieveAnswer(
            {
              conversationId: id,
              question: text,
              imagePaths: attachmentImagePaths
            },
            {
              startStep: (stepKey, detail) => progress.startStep(stepKey, detail),
              completeStep: (stepKey, detail) => progress.completeStep(stepKey, detail)
            }
          );

          controller.enqueue(
            encoder.encode(
              sseChunk("meta", {
                conversationId: id,
                sourceType: retrieval.sourceType,
                sourceLabel: retrieval.sourceType === "kb" ? "知识库" : "大模型"
              })
            )
          );
          controller.enqueue(
            encoder.encode(
              sseChunk("debug", {
                retrievalDebug: retrieval.retrievalDebug,
                imagePaths: retrieval.sourceType === "kb" ? retrieval.knowledgeItem.imagePaths : []
              })
            )
          );
          progress.startStep("await_first_token");

          if (attachmentImagePaths.length > 0) {
            const prompt =
              retrieval.sourceType === "kb"
                ? buildKbStyledPrompt({
                    question: text,
                    contextSummary: retrieval.contextSummary,
                    referenceQuestion: retrieval.knowledgeItem.question,
                    referenceAnswer: retrieval.knowledgeItem.answer,
                    referenceSnippets: retrieval.referenceSnippets
                  })
                : buildGeneralPharmacyPrompt({
                    question: text,
                    contextSummary: retrieval.contextSummary
                  });

            const multimodalResponse = await streamMultimodalChat({
              systemPrompt: prompt.system,
              userText: prompt.userText,
              imagePaths: attachmentImagePaths
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
                    question: text,
                    contextSummary: retrieval.contextSummary,
                    referenceQuestion: retrieval.knowledgeItem.question,
                    referenceAnswer: retrieval.knowledgeItem.answer,
                    referenceSnippets: retrieval.referenceSnippets
                  })
                : await streamGeneralPharmacyAnswer({
                    question: text,
                    contextSummary: retrieval.contextSummary
                  });

            for await (const chunk of llmStream) {
              const choiceDelta = chunk.choices[0]?.delta;
              const reasoningDelta =
                typeof choiceDelta?.reasoning_content === "string" ? choiceDelta.reasoning_content : "";
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

          if (!hasStartedStreamAnswer) {
            if (hasStartedReasoningAnswer) {
              progress.completeStep("reasoning_answer", "模型未返回正文内容");
            } else {
              progress.completeStep("await_first_token", "模型未返回正文内容");
            }
          }

          const suffix = `\n\n${FIXED_ASSISTANT_SUFFIX}`;
          if (hasStartedStreamAnswer) {
            assistantText += suffix;
            controller.enqueue(encoder.encode(sseChunk("delta", { text: suffix })));
          }

          const assistantMessage = await appendConversationMessage({
            conversationId: id,
            role: "assistant",
            sourceType: retrieval.sourceType,
            contentText: assistantText,
            retrievalDebugJson: JSON.stringify({
              debug: retrieval.retrievalDebug,
              imagePaths: retrieval.sourceType === "kb" ? retrieval.knowledgeItem.imagePaths : []
            })
          });
          if (hasStartedStreamAnswer) {
            progress.completeStep("stream_answer");
          }

          const donePayload = progress.getDonePayload();

          controller.enqueue(
            encoder.encode(
              sseChunk("done", {
                assistantMessageId: assistantMessage.id,
                answer: assistantText,
                totalDurationMs: donePayload.totalDurationMs,
                stepsSummary: donePayload.stepsSummary,
                firstResponseLatencyMs: donePayload.firstResponseLatencyMs,
                firstTokenLatencyMs: donePayload.firstTokenLatencyMs,
                reasoningAnswerMs: donePayload.reasoningAnswerMs,
                waitFirstTokenMs: donePayload.waitFirstTokenMs,
                streamAnswerMs: donePayload.streamAnswerMs
              })
            )
          );
          controller.close();
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              sseChunk("error", {
                error: error instanceof Error ? error.message : "生成回答失败"
              })
            )
          );
          controller.close();
        }
      })();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
