import { NextResponse } from "next/server";

import type { AttachmentItem } from "@pharmacy/shared";
import { FIXED_ASSISTANT_SUFFIX } from "@pharmacy/shared";

import { getCurrentUser } from "@/lib/auth/session";
import { buildConservativePrompt, buildKbStyledPrompt, streamConservativeAnswer, streamKbStyledAnswer } from "@/lib/openai";
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

  await appendConversationMessage({
    conversationId: id,
    role: "user",
    sourceType: "system",
    contentText: text || "用户上传了图片",
    attachmentsJson: attachments.length ? JSON.stringify(attachments) : null
  });
  await refreshConversationTitle(id, text || "图片问题");

  const retrieval = await retrieveAnswer({
    conversationId: id,
    question: text,
    imagePaths: attachments.map((item) => item.path)
  });

  const encoder = new TextEncoder();
  let assistantText = "";
  const attachmentImagePaths = attachments.map((item) => item.path);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
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
                : buildConservativePrompt({
                    question: text,
                    contextSummary: retrieval.contextSummary,
                    retrievalHints: retrieval.retrievalHints
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
              assistantText += delta;
              controller.enqueue(encoder.encode(sseChunk("delta", { text: delta })));
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
                : await streamConservativeAnswer({
                    question: text,
                    contextSummary: retrieval.contextSummary,
                    retrievalHints: retrieval.retrievalHints
                  });

            for await (const chunk of llmStream) {
              const delta = chunk.choices[0]?.delta?.content ?? "";
              if (!delta) {
                continue;
              }
              assistantText += delta;
              controller.enqueue(encoder.encode(sseChunk("delta", { text: delta })));
            }
          }

          const suffix = `\n\n${FIXED_ASSISTANT_SUFFIX}`;
          assistantText += suffix;
          controller.enqueue(encoder.encode(sseChunk("delta", { text: suffix })));

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

          controller.enqueue(
            encoder.encode(
              sseChunk("done", {
                assistantMessageId: assistantMessage.id,
                answer: assistantText
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
