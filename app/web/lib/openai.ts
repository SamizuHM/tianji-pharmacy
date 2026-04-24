import fs from "node:fs/promises";

import OpenAI from "openai";

import { env, uploadDirAbsolute } from "@/lib/env";

const UPLOADS_PREFIX_RE = /^uploads\//;

const client = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  baseURL: env.OPENAI_BASE_URL
});

async function attachmentToImagePart(filePath: string) {
  const normalizedPath = filePath.startsWith("/")
    ? filePath
    : uploadDirAbsolute + "/" + filePath.replace(UPLOADS_PREFIX_RE, "");
  const data = await fs.readFile(normalizedPath);
  const ext = normalizedPath.split(".").pop()?.toLowerCase() ?? "png";
  const mime = ext === "jpg" ? "jpeg" : ext;
  return {
    type: "image_url" as const,
    image_url: { url: "data:image/" + mime + ";base64," + data.toString("base64") }
  };
}

export async function buildMultimodalQueryText(input: { question: string; contextSummary: string; imagePaths: string[] }) {
  if (input.imagePaths.length === 0) {
    return [input.contextSummary, input.question].filter(Boolean).join("\n");
  }

  const content: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
  > = [
    {
      type: "text" as const,
      text:
        "请把用户当前问题、最近上下文与图片信息整理成适合知识库检索的一段中文查询文本。输出纯文本，不要分点，不要解释。" +
        "\n最近上下文摘要：" + (input.contextSummary || "无") +
        "\n当前问题：" + (input.question || "用户仅上传图片，请根据图片推断问题关键词")
    }
  ];

  for (const imagePath of input.imagePaths) {
    content.push(await attachmentToImagePart(imagePath));
  }

  const response = await client.chat.completions.create({
    model: env.OPENAI_MODEL,
    messages: [
      {
        role: "user",
        content
      }
    ]
  });

  return response.choices[0]?.message?.content?.trim() || input.question;
}

export async function generateConservativeAnswer(input: {
  question: string;
  contextSummary: string;
  retrievalHints?: string[];
}) {
  const hints = input.retrievalHints?.length
    ? "可参考但不可虚构扩展的背景：\n" + input.retrievalHints.join("\n")
    : "无额外背景。";

  const response = await client.chat.completions.create({
    model: env.OPENAI_MODEL,
    messages: [
      {
        role: "system",
        content:
          "你是药店门店信息化支持助手。回答必须保守、低风险、避免编造。若无法确认，应明确说明不确定，并建议核对门店配置、联系管理员或转人工。不要给出高风险强操作建议。"
      },
      {
        role: "user",
        content:
          "最近上下文摘要：" + (input.contextSummary || "无") + "\n" +
          "用户当前问题：" + input.question + "\n" +
          hints + "\n" +
          "请输出中文，开头明确写\u201c以下为通用建议：\u201d。"
      }
    ]
  });

  return response.choices[0]?.message?.content?.trim() ?? "以下为通用建议：请先核对门店系统配置、网络与设备状态，如仍无法确认原因，建议联系管理员或转人工处理。";
}
