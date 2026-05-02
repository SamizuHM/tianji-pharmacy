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

export type ModelChatMessage = {
  role: "user" | "assistant";
  content: string;
  imagePaths?: string[];
};

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
  imagePaths?: string[];
}) {
  const content: ChatContentPart[] = [
    {
      type: "text",
      text:
        input.instruction +
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
  messages: ModelChatMessage[];
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
        ...input.messages.map((message) => ({
          role: message.role,
          content: message.content
        }))
      ]
    }) as any
  ) as unknown as Promise<AsyncIterable<any>>;
}

export async function buildMultimodalQueryText(input: { question: string; imagePaths: string[] }) {
  if (input.imagePaths.length === 0) {
    return input.question || "用户未输入明确问题";
  }

  const content = await createMultimodalUserContent({
    instruction:
      "请仅把用户当前问题与全部图片信息整理成适合知识库检索的一段中文查询文本。输出纯文本，不要分点，不要解释，不要编造未出现的细节。",
    question: input.question,
    imagePaths: input.imagePaths
  });

  const text = await completeText({ userContent: content });
  return text || input.question || "用户上传了图片，请根据图片内容推断检索关键词";
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("大模型未返回有效 JSON");
  }
  return candidate.slice(start, end + 1);
}

export type TicketKnowledgeMaterialForModel = {
  id: string;
  roleLabel: string;
  sourceLabel: string;
  contentText: string;
  createdAt: string;
  imagePaths: string[];
};

export type GeneratedTicketKnowledgeDraft = {
  categoryL1: string;
  categoryL2: string;
  question: string;
  answer: string;
  tags: string[];
};

export async function generateTicketKnowledgeDraftWithModel(input: {
  ticketNo: string;
  title: string;
  materials: TicketKnowledgeMaterialForModel[];
}) {
  const imagePaths = Array.from(new Set(input.materials.flatMap((item) => item.imagePaths)));
  const materialText = input.materials
    .map((item, index) => {
      const imageNote = item.imagePaths.length ? `\n附件图片：${item.imagePaths.join("、")}` : "";
      return [
        `素材 ${index + 1}`,
        `角色：${item.roleLabel}`,
        `来源：${item.sourceLabel}`,
        `时间：${item.createdAt}`,
        `内容：${item.contentText || "无文字内容"}` + imageNote
      ].join("\n");
    })
    .join("\n\n");

  const userContent: ChatContentPart[] = [
    {
      type: "text",
      text:
        "工单编号：" + input.ticketNo + "\n" +
        "工单标题：" + input.title + "\n\n" +
        "客服勾选的有效素材如下：\n" + materialText + "\n\n" +
        "请输出严格 JSON，不要输出 Markdown，不要解释。"
    }
  ];

  for (const imagePath of imagePaths) {
    userContent.push(await attachmentToImagePart(imagePath));
  }

  const text = await completeText({
    system:
      "你是药店客服工单知识沉淀助手。你的任务是把客服勾选的对话和附件整理成一条可复用的知识库 QA。" +
      "只能基于给定素材和图片内容整理，不得编造未出现的事实、政策、剂量、操作步骤或风险结论。" +
      "不要提及具体工单、具体用户、客服姓名、聊天过程或“根据对话”。" +
      "问题要改写成门店今后可能会问的标准问题；答案要清晰、可执行、适合直接进入知识库。" +
      "如素材涉及用药、疾病、儿童、孕妇、老人、处方药、不良反应或剂量风险，答案必须提示遵说明书并咨询执业药师或医生。" +
      "输出 JSON 字段必须为 categoryL1、categoryL2、question、answer、tags；tags 为字符串数组，最多 5 个。",
    userContent
  });

  const parsed = JSON.parse(extractJsonObject(text)) as Partial<GeneratedTicketKnowledgeDraft>;
  if (!parsed.question?.trim() || !parsed.answer?.trim()) {
    throw new Error("大模型生成的知识草稿缺少问题或答案");
  }

  return {
    categoryL1: parsed.categoryL1?.trim() || "人工经验沉淀",
    categoryL2: parsed.categoryL2?.trim() || "工单闭环新增",
    question: parsed.question.trim(),
    answer: parsed.answer.trim(),
    tags: Array.isArray(parsed.tags) ? parsed.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 5) : []
  } satisfies GeneratedTicketKnowledgeDraft;
}

export async function streamKbStyledAnswer(input: {
  question: string;
  referenceQuestion: string;
  referenceAnswer: string;
  referenceSnippets: string[];
  historyMessages: ModelChatMessage[];
}) {
  const prompt = buildKbStyledPrompt(input);

  return streamChatText({
    system: prompt.system,
    messages: [...input.historyMessages, { role: "user", content: prompt.userText }]
  });
}

export async function streamGeneralPharmacyAnswer(input: {
  question: string;
  historyMessages: ModelChatMessage[];
}) {
  const prompt = buildGeneralPharmacyPrompt(input);

  return streamChatText({
    system: prompt.system,
    messages: [...input.historyMessages, { role: "user", content: prompt.userText }]
  });
}

export function buildKbStyledPrompt(input: {
  question: string;
  referenceQuestion: string;
  referenceAnswer: string;
  referenceSnippets: string[];
}) {
  return {
    system:
      "你是药店门店知识库问答整理助手。你只能基于给定的参考问题、参考标准答案和参考片段，做表达形式上的整理与润色，不能引入任何新的事实、步骤、原因、风险判断或结论。输出必须简短、清晰，开头写“根据知识库：”，正文可用1到3条短句或短项整理，但信息量不得超出参考内容。若参考答案本身很短，就保持克制。",
    userText:
      "用户当前问题：" + (input.question || "用户上传了图片，请结合知识库回答") + "\n" +
      "参考问题：" + input.referenceQuestion + "\n" +
      "参考标准答案：" + input.referenceAnswer + "\n" +
      "参考片段：" + (input.referenceSnippets.length ? input.referenceSnippets.join("\n") : "无")
  };
}

export function buildGeneralPharmacyPrompt(input: {
  question: string;
}) {
  return {
    system:
      "你是药店场景智能问答助手。用户问题未命中知识库时，你可以基于通用药店场景知识回答门店信息化、医保/ERP/设备基础排查、药品常识、用药咨询等问题。不要声称答案来自知识库，不要引用或编造未提供的知识库内容。回答要直接、实用、中文表达清晰。涉及用药、疾病、孕婴、儿童、老人、过敏、处方药、不良反应、剂量调整等风险时，必须提示遵药品说明书并咨询执业药师或医生；不得诊断疾病、开处方、替代专业医疗建议或给出高风险强操作。非医疗风险问题不要机械追加仅供参考、咨询医生、转人工等安全句。",
    userText:
      "用户当前问题：" + (input.question || "用户上传了图片，请结合图片与上下文回答") + "\n" +
      "请输出中文，不要使用“以下为通用建议：”作为固定开头。"
  };
}
