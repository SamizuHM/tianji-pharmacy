import fs from "node:fs/promises";

import OpenAI from "openai";

import { env, uploadDirAbsolute } from "@/lib/env";

const UPLOADS_PREFIX_RE = /^uploads\//;

const client = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  baseURL: env.OPENAI_BASE_URL
});

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function withThinkingDisabled<T extends Record<string, unknown>>(payload: T) {
  return {
    ...payload,
    enable_thinking: false
  } as T & { enable_thinking: false };
}

async function attachmentToImagePart(filePath: string): Promise<ChatContentPart> {
  const normalizedPath = filePath.startsWith("/")
    ? filePath
    : uploadDirAbsolute + "/" + filePath.replace(UPLOADS_PREFIX_RE, "");
  const data = await fs.readFile(normalizedPath);
  const ext = normalizedPath.split(".").pop()?.toLowerCase() ?? "png";
  const mime = ext === "jpg" ? "jpeg" : ext;
  return {
    type: "image_url",
    image_url: { url: "data:image/" + mime + ";base64," + data.toString("base64") }
  };
}

async function createMultimodalUserContent(input: {
  instruction: string;
  question?: string;
  contextSummary?: string;
  imagePaths?: string[];
}) {
  const content: ChatContentPart[] = [
    {
      type: "text",
      text:
        input.instruction +
        "\n最近上下文摘要：" + (input.contextSummary || "无") +
        "\n当前问题：" + (input.question || "用户仅上传图片，请根据图片理解诉求")
    }
  ];

  for (const imagePath of input.imagePaths ?? []) {
    content.push(await attachmentToImagePart(imagePath));
  }

  return content;
}

async function completeText(input: {
  system?: string;
  userContent: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> | string;
}) {
  const response = await client.chat.completions.create(
    withThinkingDisabled({
      model: env.OPENAI_MODEL,
      messages: [
        ...(input.system
          ? [
              {
                role: "system" as const,
                content: input.system
              }
            ]
          : []),
        {
          role: "user" as const,
          content: input.userContent
        }
      ]
    }) as any
  );

  return response.choices[0]?.message?.content?.trim() || "";
}

export async function streamChatText(input: {
  system: string;
  userContent: ChatContentPart[] | string;
}): Promise<AsyncIterable<any>> {
  return client.chat.completions.create(
    withThinkingDisabled({
      model: env.OPENAI_MODEL,
      stream: true,
      messages: [
        {
          role: "system",
          content: input.system
        },
        {
          role: "user",
          content: input.userContent
        }
      ]
    }) as any
  ) as unknown as Promise<AsyncIterable<any>>;
}

export async function buildMultimodalQueryText(input: { question: string; contextSummary: string; imagePaths: string[] }) {
  if (input.imagePaths.length === 0) {
    return input.question || "用户未输入明确问题";
  }

  const content = await createMultimodalUserContent({
    instruction:
      "请仅把用户当前问题与全部图片信息整理成适合知识库检索的一段中文查询文本。输出纯文本，不要分点，不要解释，不要编造未出现的细节。",
    question: input.question,
    contextSummary: "",
    imagePaths: input.imagePaths
  });

  const text = await completeText({ userContent: content });
  return text || input.question || "用户上传了图片，请根据图片内容推断检索关键词";
}

export async function summarizeAdditionalImages(input: {
  question: string;
  contextSummary: string;
  imagePaths: string[];
}) {
  if (input.imagePaths.length <= 1) {
    return "";
  }

  const content = await createMultimodalUserContent({
    instruction:
      "请仅基于这些补充图片，提炼与用户诉求相关的检索关键信息。输出一段简短中文，不要分点，不要解释，不要扩展未出现的信息。",
    question: input.question,
    contextSummary: input.contextSummary,
    imagePaths: input.imagePaths.slice(1)
  });

  return completeText({ userContent: content });
}

export async function streamKbStyledAnswer(input: {
  question: string;
  contextSummary: string;
  referenceQuestion: string;
  referenceAnswer: string;
  referenceSnippets: string[];
}) {
  const prompt = buildKbStyledPrompt(input);

  return streamChatText({
    system: prompt.system,
    userContent: prompt.userText
  });
}

export async function streamConservativeAnswer(input: {
  question: string;
  contextSummary: string;
  retrievalHints?: string[];
}) {
  const prompt = buildConservativePrompt(input);

  return streamChatText({
    system: prompt.system,
    userContent: prompt.userText
  });
}

export function buildKbStyledPrompt(input: {
  question: string;
  contextSummary: string;
  referenceQuestion: string;
  referenceAnswer: string;
  referenceSnippets: string[];
}) {
  return {
    system:
      "你是药店门店知识库问答整理助手。你只能基于给定的参考问题、参考标准答案和参考片段，做表达形式上的整理与润色，不能引入任何新的事实、步骤、原因、风险判断或结论。输出必须简短、清晰，开头写“根据知识库：”，正文可用1到3条短句或短项整理，但信息量不得超出参考内容。若参考答案本身很短，就保持克制。",
    userText:
      "用户当前问题：" + (input.question || "用户上传了图片，请结合知识库回答") + "\n" +
      "最近上下文摘要：" + (input.contextSummary || "无") + "\n" +
      "参考问题：" + input.referenceQuestion + "\n" +
      "参考标准答案：" + input.referenceAnswer + "\n" +
      "参考片段：" + (input.referenceSnippets.length ? input.referenceSnippets.join("\n") : "无")
  };
}

export function buildConservativePrompt(input: {
  question: string;
  contextSummary: string;
  retrievalHints?: string[];
}) {
  const hints = input.retrievalHints?.length
    ? "可参考但不可虚构扩展的背景：\n" + input.retrievalHints.join("\n")
    : "无额外背景。";

  return {
    system:
      "你是药店门店信息化支持助手。回答必须保守、低风险、避免编造。若无法确认，应明确说明不确定，并建议核对门店配置、联系管理员或转人工。不要给出高风险强操作建议。",
    userText:
      "最近上下文摘要：" + (input.contextSummary || "无") + "\n" +
      "用户当前问题：" + (input.question || "用户上传了图片，请结合图片与上下文提供保守建议") + "\n" +
      hints + "\n" +
      "请输出中文，开头明确写“以下为通用建议：”。"
  };
}
