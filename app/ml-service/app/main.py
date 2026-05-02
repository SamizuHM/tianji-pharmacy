from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

import dashscope
from dashscope import MultiModalConversation, MultiModalEmbedding, TextReRank
from docx import Document
from docx.oxml.ns import qn
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from openai import OpenAI
from pydantic import BaseModel
from pypdf import PdfReader


ROOT_DIR = Path(os.getenv("ROOT_DIR") or str(Path(__file__).resolve().parents[3]))
UPLOAD_DIR = ROOT_DIR / os.getenv("UPLOAD_DIR", "./uploads").replace("./", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "")
DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY", os.getenv("OPENAI_API_KEY", ""))

dashscope.api_key = DASHSCOPE_API_KEY

app = FastAPI(title="药店门店智能问答 ML Service")


# ---------- Request Models ----------

class EmbedRequest(BaseModel):
    texts: list[str]


class RerankRequest(BaseModel):
    query: str
    documents: list[str]


class MultimodalEmbedItem(BaseModel):
    text: str
    image_path: str | None = None
    image_paths: list[str] | None = None


class MultimodalEmbedRequest(BaseModel):
    items: list[MultimodalEmbedItem]


class MultimodalRerankDoc(BaseModel):
    text: str
    image_path: str | None = None
    image_paths: list[str] | None = None


class MultimodalRerankRequest(BaseModel):
    query: str
    query_image_paths: list[str] | None = None
    documents: list[MultimodalRerankDoc]


class ParseDocumentRequest(BaseModel):
    file_path: str


class MultiModalChatMessage(BaseModel):
    role: str
    text: str
    image_paths: list[str] | None = None


class MultiModalChatStreamRequest(BaseModel):
    system_prompt: str
    user_text: str | None = None
    image_paths: list[str] | None = None
    model: str | None = None
    messages: list[MultiModalChatMessage] | None = None


# ---------- Clients ----------

def get_openai_client() -> OpenAI:
    if not OPENAI_BASE_URL or not OPENAI_API_KEY or not OPENAI_MODEL:
        raise HTTPException(status_code=500, detail="未配置 OpenAI 兼容模型环境变量")
    return OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)


def normalize_relative_image_path(image_path: str) -> Path:
    candidate = Path(image_path)
    if candidate.is_absolute():
        return candidate
    normalized = image_path.replace("\\", "/").lstrip("/")
    if normalized.startswith("uploads/"):
        return ROOT_DIR / normalized
    return UPLOAD_DIR / normalized


def get_rerank_client() -> OpenAI:
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="未配置 OPENAI_API_KEY")
    return OpenAI(api_key=OPENAI_API_KEY, base_url="https://dashscope.aliyuncs.com/compatible-api/v1")


# ---------- Health ----------

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# ---------- Text-only Embed / Rerank (kept for compat) ----------

@app.post("/embed")
def embed(request: EmbedRequest) -> dict[str, list[list[float]]]:
    if not request.texts:
        return {"vectors": []}
    items = [MultimodalEmbedItem(text=t) for t in request.texts]
    return _embed_multimodal_impl(items)


@app.post("/rerank")
def rerank(request: RerankRequest) -> dict[str, list[float]]:
    if not request.documents:
        return {"scores": []}
    docs = [MultimodalRerankDoc(text=d) for d in request.documents]
    return _rerank_multimodal_impl(request.query, [], docs)


@app.post("/chat-multimodal-stream")
def chat_multimodal_stream(request: MultiModalChatStreamRequest):
    if not DASHSCOPE_API_KEY:
        raise HTTPException(status_code=500, detail="未配置 DASHSCOPE_API_KEY 或 OPENAI_API_KEY")

    model_name = request.model or OPENAI_MODEL
    if not model_name:
        raise HTTPException(status_code=500, detail="未配置多模态聊天模型")

    messages = _build_multimodal_messages(
        system_prompt=request.system_prompt,
        user_text=request.user_text or "",
        image_paths=request.image_paths or [],
        messages=request.messages or [],
    )

    def generate():
        try:
            response = MultiModalConversation.call(
                api_key=DASHSCOPE_API_KEY,
                model=model_name,
                messages=messages,
                stream=True,
                enable_thinking=False,
            )
            for chunk in response:
                try:
                    message = chunk.output.choices[0].message
                except Exception:
                    continue

                content = getattr(message, "content", None)
                if not content:
                    content = message.get("content", []) if hasattr(message, "get") else []

                if not content:
                    continue

                for item in content:
                    text = item.get("text") if isinstance(item, dict) else None
                    if text:
                        yield text
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"多模态对话流式调用失败：{exc}") from exc

    return StreamingResponse(generate(), media_type="text/plain; charset=utf-8")


# ---------- Multimodal Embed ----------

@app.post("/embed-multimodal")
def embed_multimodal(request: MultimodalEmbedRequest) -> dict[str, list[list[float]]]:
    if not request.items:
        return {"vectors": []}
    return _embed_multimodal_impl(request.items)


def _encode_image_b64(image_path: str) -> tuple[str, str]:
    """返回 (data_url, mime_subtype)。image_path 相对于 uploads 目录。"""
    abs_path = normalize_relative_image_path(image_path)
    if not abs_path.exists():
        raise HTTPException(status_code=404, detail=f"图片不存在：{image_path}")
    ext = abs_path.suffix.lstrip(".").lower() or "png"
    mime = "jpeg" if ext == "jpg" else ext
    with open(abs_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    return f"data:image/{mime};base64,{b64}", mime


def _build_multimodal_messages(
    system_prompt: str,
    user_text: str,
    image_paths: list[str],
    messages: list[MultiModalChatMessage] | None = None,
) -> list[dict[str, Any]]:
    if not messages:
        content = _build_multimodal_content(user_text, image_paths)
        if content and "text" in content[-1]:
            content[-1]["text"] = f"{system_prompt.strip()}\n\n{content[-1]['text']}".strip()
        elif system_prompt.strip():
            content.append({"text": system_prompt.strip()})
        return [{"role": "user", "content": content}]

    converted_messages: list[dict[str, Any]] = []
    for index, message in enumerate(messages):
        role = "assistant" if message.role == "assistant" else "user"
        text = message.text
        if index == len(messages) - 1 and role == "user":
            text = f"{system_prompt.strip()}\n\n{text.strip()}".strip()
        content = _build_multimodal_content(text, message.image_paths or [])
        if content:
            converted_messages.append({"role": role, "content": content})

    return converted_messages


def _build_multimodal_content(text: str, image_paths: list[str]) -> list[dict[str, str]]:
    content: list[dict[str, str]] = []
    for image_path in image_paths:
        try:
            data_url, _ = _encode_image_b64(image_path)
        except HTTPException:
            continue
        content.append({"image": data_url})

    if text.strip():
        content.append({"text": text.strip()})

    return content


def _embed_multimodal_impl(items: list[MultimodalEmbedItem]) -> dict[str, list[list[float]]]:
    all_vectors: list[list[float]] = []
    # dashscope API 支持批量，但为稳定性逐条调用
    for item in items:
        image_candidates = [p for p in (item.image_paths or []) if p]
        if item.image_path and item.image_path not in image_candidates:
            image_candidates.insert(0, item.image_path)
        item_text = item.text
        if len(image_candidates) > 1:
            summary = summarize_images_for_retrieval(item.text, image_candidates[1:])
            if summary:
                item_text = f"{item.text}\n补充图片线索：{summary}"
        input_data: list[dict[str, str]] = []
        entry: dict[str, str] = {"text": item_text}
        if image_candidates:
            data_url, _ = _encode_image_b64(image_candidates[0])
            entry["image"] = data_url
        input_data.append(entry)

        try:
            resp = MultiModalEmbedding.call(
                model="tongyi-embedding-vision-flash-2026-03-06",
                input=input_data,
                dimension=1024,
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"多模态 Embedding 调用失败：{exc}") from exc

        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"多模态 Embedding 失败：{resp.message}")

        embeddings = resp.output.get("embeddings", [])
        if not embeddings:
            raise HTTPException(status_code=502, detail="多模态 Embedding 返回空结果")
        all_vectors.append(embeddings[0]["embedding"])

    return {"vectors": all_vectors}


def summarize_images_for_retrieval(text: str, image_paths: list[str]) -> str:
    if not image_paths:
        return ""

    client = get_openai_client()
    content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text":
                "请仅基于这些图片，总结与检索相关的简短中文线索。不要分点，不要扩展，不要编造。\n"
                f"用户问题：{text or '用户上传了图片，请根据图片理解诉求'}"
        }
    ]
    for image_path in image_paths:
        data_url, _ = _encode_image_b64(image_path)
        content.append({"type": "image_url", "image_url": {"url": data_url}})

    response = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[{"role": "user", "content": content}],
    )
    return response.choices[0].message.content.strip() if response.choices else ""


# ---------- Multimodal Rerank ----------

@app.post("/rerank-multimodal")
def rerank_multimodal(request: MultimodalRerankRequest) -> dict[str, list[float]]:
    if not request.documents:
        return {"scores": []}
    return _rerank_multimodal_impl(request.query, request.query_image_paths or [], request.documents)


def _rerank_multimodal_impl(
    query: str,
    query_image_paths: list[str],
    documents: list[MultimodalRerankDoc],
) -> dict[str, list[float]]:
    normalized_query = query
    if len(query_image_paths) > 1:
        summary = summarize_images_for_retrieval(query, query_image_paths[1:])
        if summary:
            normalized_query = f"{query}\n补充图片线索：{summary}"

    query_input: dict[str, str] = {"text": normalized_query}
    if query_image_paths:
        data_url, _ = _encode_image_b64(query_image_paths[0])
        query_input["image"] = data_url

    doc_inputs: list[dict[str, str]] = []
    # 记录每个原始文档在 doc_inputs 中占用的索引范围
    doc_index_map: list[tuple[int, int]] = []  # (start, end)
    for doc in documents:
        start = len(doc_inputs)
        doc_image_paths = [p for p in (doc.image_paths or []) if p]
        if doc.image_path and doc.image_path not in doc_image_paths:
            doc_image_paths.insert(0, doc.image_path)
        doc_text = doc.text
        if len(doc_image_paths) > 1:
            summary = summarize_images_for_retrieval(doc.text, doc_image_paths[1:])
            if summary:
                doc_text = f"{doc.text}\n补充图片线索：{summary}"
        if doc_image_paths:
            data_url, _ = _encode_image_b64(doc_image_paths[0])
            doc_inputs.append({"image": data_url})
        doc_inputs.append({"text": doc_text})
        doc_index_map.append((start, len(doc_inputs)))

    try:
        resp = TextReRank.call(
            model="qwen3-vl-rerank",
            query=query_input,
            documents=doc_inputs,
            top_n=len(doc_inputs),
            return_documents=False,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"多模态 Rerank 调用失败：{exc}") from exc

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"多模态 Rerank 失败：{resp.message}")

    # 构建 doc_inputs 索引 → score 映射
    input_scores: dict[int, float] = {}
    for item in resp.output.get("results", []):
        idx = item.get("index", 0)
        input_scores[idx] = float(item.get("relevance_score", 0.0))

    # 每个原始文档取其所有 entry 中的最高分
    scores: list[float] = []
    for start, end in doc_index_map:
        best = max((input_scores.get(i, 0.0) for i in range(start, end)), default=0.0)
        scores.append(best)

    return {"scores": scores}


# ---------- Document Parsing ----------

@app.post("/parse-document")
def parse_document(request: ParseDocumentRequest) -> dict[str, Any]:
    target = Path(request.file_path)
    if not target.is_absolute():
        target = ROOT_DIR / request.file_path

    if not target.exists():
        raise HTTPException(status_code=404, detail=f"文件不存在：{target}")

    suffix = target.suffix.lower()
    if suffix in {".txt", ".md"}:
        text = target.read_text(encoding="utf-8")
        if suffix == ".md" and "![](images/" in text:
            items = parse_md_with_images(text, target)
        else:
            items = parse_knowledge_items(text, target.name, suffix, {})
    elif suffix == ".pdf":
        text = extract_pdf_text(target)
        items = parse_knowledge_items(text, target.name, suffix, {})
    elif suffix == ".docx":
        text, image_map = extract_docx_with_image_map(target)
        items = parse_knowledge_items(text, target.name, suffix, image_map)
    elif suffix == ".doc":
        converted_docx = convert_doc_to_docx(target)
        if not converted_docx:
            raise HTTPException(status_code=500, detail="旧版 .doc 文件转换失败。请安装 LibreOffice。")
        text, image_map = extract_docx_with_image_map(converted_docx)
        items = parse_knowledge_items(text, target.name, suffix, image_map)
    elif suffix in {".png", ".jpg", ".jpeg", ".webp"}:
        items = [describe_image_as_knowledge(target)]
    else:
        raise HTTPException(status_code=400, detail=f"暂不支持的文件类型：{suffix}")

    return {"items": items}


# ---------- PDF ----------

def extract_pdf_text(target: Path) -> str:
    reader = PdfReader(str(target))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


# ---------- DOCX Parsing (v2: tables + image map) ----------

def extract_docx_with_image_map(target: Path) -> tuple[str, dict[int, list[str]]]:
    """解析 docx，返回 (规范化文本, {段落索引: [图片相对路径]})。"""
    document = Document(str(target))

    # 构建 rId → 图片文件名映射
    image_rels: dict[str, str] = {}
    try:
        with zipfile.ZipFile(target) as archive:
            rels_xml = archive.read("word/_rels/document.xml.rels")
            rels_root = ET.fromstring(rels_xml)
            for rel in rels_root:
                target_file = rel.get("Target", "")
                if "media/" in target_file:
                    image_rels[rel.get("Id")] = Path(target_file).name
    except (zipfile.BadZipFile, KeyError):
        pass

    # 提取图片到磁盘
    output_dir = UPLOAD_DIR / "knowledge-assets" / target.stem
    output_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target) as archive:
        for name in archive.namelist():
            if name.startswith("word/media/"):
                data = archive.read(name)
                (output_dir / Path(name).name).write_bytes(data)

    # 遍历 body 子元素，保持段落/表格交织顺序
    lines: list[str] = []
    image_map: dict[int, list[str]] = {}
    para_idx = 0

    for element in document.element.body:
        tag = element.tag.split("}")[-1] if "}" in element.tag else element.tag

        if tag == "p":
            # 提取段落文本
            texts = [t.text for t in element.findall(".//" + qn("w:t")) if t.text]
            text = "".join(texts).strip()

            # 检查段落中的图片引用
            para_images: list[str] = []
            for blip in element.findall(".//{http://schemas.openxmlformats.org/drawingml/2006/main}blip"):
                rId = blip.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed")
                if rId and rId in image_rels:
                    img_name = image_rels[rId]
                    img_file = output_dir / img_name
                    if img_file.exists():
                        para_images.append(img_file.relative_to(ROOT_DIR).as_posix())

            if text:
                lines.append(text)
                if para_images:
                    image_map[para_idx] = para_images
                para_idx += 1

        elif tag == "tbl":
            # 提取表格内容为 \t 分隔行
            rows = element.findall(qn("w:tr"))
            for ri, row in enumerate(rows):
                cells = row.findall(qn("w:tc"))
                cell_texts: list[str] = []
                row_images: list[str] = []

                for cell in cells:
                    ct = "".join(t.text for t in cell.findall(".//" + qn("w:t")) if t.text).strip()
                    cell_texts.append(ct)
                    # 检查单元格中的图片
                    for blip in cell.findall(".//{http://schemas.openxmlformats.org/drawingml/2006/main}blip"):
                        rId = blip.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed")
                        if rId and rId in image_rels:
                            img_name = image_rels[rId]
                            img_file = output_dir / img_name
                            if img_file.exists():
                                row_images.append(img_file.relative_to(ROOT_DIR).as_posix())

                # 跳过表头行
                if ri == 0 and any(h in "".join(cell_texts) for h in ["序号", "具体问题", "简要标准答案"]):
                    continue

                if any(ct for ct in cell_texts):
                    lines.append("\t".join(cell_texts))
                    if row_images:
                        image_map[para_idx] = row_images
                    para_idx += 1

    return "\n".join(lines), image_map


# ---------- DOC Conversion ----------

def convert_doc_to_docx(target: Path) -> Path | None:
    """将 .doc 转换为临时 .docx 并返回路径。"""
    with tempfile.TemporaryDirectory() as temp_dir_str:
        temp_dir = Path(temp_dir_str)
        converted = convert_doc_with_office(target, temp_dir)
        if converted:
            persistent_dir = UPLOAD_DIR / "knowledge-assets" / "_converted"
            persistent_dir.mkdir(parents=True, exist_ok=True)
            persistent_path = persistent_dir / converted.name
            shutil.copy2(converted, persistent_path)
            return persistent_path

        antiword_text = convert_doc_with_tool(target, ["antiword", str(target)])
        if antiword_text:
            # antiword 无法提取图片，返回 None（回退到纯文本）
            return None

        catdoc_text = convert_doc_with_tool(target, ["catdoc", str(target)])
        if catdoc_text:
            return None

        return None


def convert_doc_with_office(target: Path, output_dir: Path) -> Path | None:
    for binary in ["soffice", "libreoffice"]:
        command = [
            binary, "--headless", "--convert-to", "docx",
            str(target), "--outdir", str(output_dir),
        ]
        try:
            subprocess.run(command, check=True, capture_output=True, text=True, timeout=120)
            converted = output_dir / f"{target.stem}.docx"
            if converted.exists():
                return converted
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
            continue
    return None


def convert_doc_with_tool(target: Path, command: list[str]) -> str | None:
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True)
        content = result.stdout.strip()
        return content or None
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


# ---------- Knowledge Item Parsing ----------

# ---------- Markdown with images ----------

def parse_md_with_images(text: str, source: Path) -> list[dict[str, Any]]:
    """解析含 ![](images/xxx.jpg) 的 markdown 文件，按章节拆分问答条目并关联图片。"""
    source_dir = source.parent
    output_dir = UPLOAD_DIR / "knowledge-assets" / source.stem
    output_dir.mkdir(parents=True, exist_ok=True)

    lines = text.splitlines()

    # 第一步：预处理 — 提取图片、复制到 uploads、生成 image_map
    img_pattern = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")
    image_map: dict[int, list[str]] = {}
    clean_lines: list[str] = []

    for raw_line in lines:
        stripped = raw_line.strip()
        img_matches = img_pattern.findall(stripped)
        text_without_imgs = img_pattern.sub("", stripped).strip()

        if img_matches:
            line_idx = len(clean_lines)
            uploaded: list[str] = []
            for img_rel in img_matches:
                img_path = source_dir / img_rel
                if img_path.exists():
                    dest = output_dir / img_path.name
                    if not dest.exists():
                        shutil.copy2(img_path, dest)
                    uploaded.append(f"knowledge-assets/{source.stem}/{img_path.name}")
            if uploaded:
                image_map.setdefault(line_idx, []).extend(uploaded)
            # 图片行如果有伴随文字，保留
            if text_without_imgs:
                clean_lines.append(text_without_imgs)
            continue

        # 跳过空行和 HTML table
        if not stripped or stripped.startswith("<table") or stripped.startswith("</table"):
            continue
        if stripped.startswith("<tr>") or stripped.startswith("</tr>"):
            continue
        if stripped.startswith("<td>") or stripped.startswith("<td>"):
            continue

        clean_lines.append(stripped)

    # 第二步：按章节 + 子分类拆分问答条目
    # 模式：
    #   # 一、 第一章：章名：1，条目内容   → 章标题 + 首条目混合
    #   # 第X章：章名                      → 纯章标题
    #   一、分类名：1，条目内容            → 子分类 + 首条目混合
    #   2，后续条目
    items: list[dict[str, Any]] = []
    chapter = ""
    section = ""
    buffer_start = 0
    buffer_lines: list[str] = []

    def flush_buffer(start: int, end: int):
        if not buffer_lines:
            return
        content = "\n".join(buffer_lines).strip()
        if not content or len(content) < 3:
            return

        first_line = buffer_lines[0]
        answer_lines = buffer_lines[1:]
        question = first_line

        # 清理问题前缀：# 号、中文数字序号
        question = re.sub(r"^#+\s*", "", question)
        question = re.sub(r"^[一二三四五六七八九十]+、\s*", "", question)
        question = re.sub(r"^第[一二三四五六七八九十\d]+章[：:]\s*", "", question)
        question = re.sub(r"^\d+[，,]\s*", "", question)
        question = question.strip()

        # 尝试在冒号处拆分问题与答案
        for sep in ["：", ":"]:
            if sep in first_line:
                parts = first_line.split(sep, 1)
                question = parts[0].strip()
                rest = parts[1].strip()
                if rest:
                    answer_lines = [rest] + answer_lines
                break

        answer = "\n".join(answer_lines).strip() if answer_lines else content
        if not answer:
            answer = content

        tags = derive_tags(chapter, section, question)
        imgs = _get_images_for_range(image_map, start, end)
        items.append(build_item(chapter, section, question, answer, tags, source.name, ".md", imgs))

    # 正则：匹配 "中文数字、标题" 行（可能带 # 前缀）
    heading_re = re.compile(r"^(#+\s*)?([一二三四五六七八九十]+)、\s*(.*)$")
    # 正则：匹配 "第X章：标题" 行
    chapter_re = re.compile(r"^#+\s*第[一二三四五六七八九十\d]+章[：:]\s*(.*)$")
    # 正则：匹配 "数字，内容" 子条目
    sub_item_re = re.compile(r"^(\d+)[，,]\s*(.*)$")

    for i, line in enumerate(clean_lines):
        # 检查章标题：# 第X章：...
        ch_match = chapter_re.match(line)
        if ch_match:
            flush_buffer(buffer_start, i)
            buffer_lines = []
            buffer_start = i
            chapter = ch_match.group(1).strip()
            continue

        # 检查 "中文数字、标题" 行（可能含首条目）
        hd_match = heading_re.match(line)
        if hd_match:
            flush_buffer(buffer_start, i)
            buffer_start = i
            section = hd_match.group(3).strip()
            # 如果没有章名，用第一个分类名做章名
            if not chapter:
                chapter = section
            # 检查是否混合了首条目： "分类名：1，内容"
            for sep in ["：", ":"]:
                if sep in section:
                    section = section.split(sep)[0].strip()
                    break
            buffer_lines = [line]
            continue

        # 数字序号子条目
        sub_match = sub_item_re.match(line)
        if sub_match:
            buffer_lines.append(sub_match.group(2).strip())
            continue

        # 其他文本行追加到缓冲
        buffer_lines.append(line)

    flush_buffer(buffer_start, len(clean_lines))
    return items


def parse_knowledge_items(
    text: str,
    source_file: str,
    doc_type: str,
    image_map: dict[int, list[str]],
) -> list[dict[str, Any]]:
    lines = [normalize_line(line) for line in text.splitlines()]
    lines = [line for line in lines if line]

    # 尝试显式标签格式
    explicit_items = parse_explicit_label_items(lines, source_file, doc_type, image_map)
    if explicit_items:
        return explicit_items

    # 尝试表格/结构化问答
    structured_items = parse_table_qa_items(lines, source_file, doc_type, image_map)
    if structured_items:
        return structured_items

    # 通用切片
    return build_generic_items("\n".join(lines), source_file, doc_type, image_map)


def _get_images_for_range(
    image_map: dict[int, list[str]],
    start_line: int,
    end_line: int,
) -> list[str]:
    """收集 [start_line, end_line) 范围内的所有图片。"""
    images: list[str] = []
    for idx in range(start_line, end_line):
        if idx in image_map:
            images.extend(image_map[idx])
    return images


def parse_explicit_label_items(
    lines: list[str],
    source_file: str,
    doc_type: str,
    image_map: dict[int, list[str]],
) -> list[dict[str, Any]]:
    if not any("具体问题" in line for line in lines):
        return []

    category_l1 = "知识文档"
    category_l2 = "未分类"
    question = ""
    answer = ""
    question_line = -1
    tags: list[str] = []
    items: list[dict[str, Any]] = []

    for i, line in enumerate(lines):
        if line.startswith("一级分类："):
            category_l1 = line.replace("一级分类：", "", 1).strip()
        elif line.startswith("二级分类："):
            category_l2 = line.replace("二级分类：", "", 1).strip()
        elif line.startswith("具体问题："):
            if question and answer:
                imgs = _get_images_for_range(image_map, question_line, i)
                items.append(build_item(category_l1, category_l2, question, answer, tags, source_file, doc_type, imgs))
                tags = []
            question = line.replace("具体问题：", "", 1).strip()
            answer = ""
            question_line = i
        elif line.startswith("简要标准答案："):
            answer = line.replace("简要标准答案：", "", 1).strip()
        elif line.startswith("标签："):
            tags = [item.strip() for item in re.split(r"[，,、]", line.replace("标签：", "", 1)) if item.strip()]

    if question and answer:
        imgs = _get_images_for_range(image_map, question_line, len(lines))
        items.append(build_item(category_l1, category_l2, question, answer, tags, source_file, doc_type, imgs))

    return items


def parse_table_qa_items(
    lines: list[str],
    source_file: str,
    doc_type: str,
    image_map: dict[int, list[str]],
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    category_l1 = "知识文档"
    category_l2 = "未分类"

    for i, line in enumerate(lines):
        # 分类标题
        if re.match(r"^[一二三四五六七八九十]+、", line):
            category_l1 = line.split("、", 1)[1].strip()
            continue
        if re.match(r"^\d+\.\d+\s+", line):
            category_l2 = re.sub(r"^\d+\.\d+\s+", "", line).strip()
            continue

        # \t 分隔的表格行（序号\t问题\t答案）
        if "\t" in line:
            parts = line.split("\t")
            if len(parts) >= 3:
                question = parts[1].strip()
                answer = parts[2].strip()
                if question and answer and question != "具体问题":
                    tags = derive_tags(category_l1, category_l2, question)
                    imgs = _get_images_for_range(image_map, i, i + 1)
                    items.append(build_item(category_l1, category_l2, question, answer, tags, source_file, doc_type, imgs))
            continue

        # 兼容旧格式：纯数字序号后跟问题行
        if re.match(r"^\d+$", line):
            question_index = i + 1
            answer_index = i + 2
            if question_index >= len(lines) or answer_index >= len(lines):
                break
            question = lines[question_index]
            answer_lines: list[str] = []
            cursor = answer_index
            while cursor < len(lines):
                cursor_line = lines[cursor]
                if (re.match(r"^\d+$", cursor_line)
                    or re.match(r"^[一二三四五六七八九十]+、", cursor_line)
                    or re.match(r"^\d+\.\d+\s+", cursor_line)):
                    break
                if cursor_line not in {"序号", "具体问题", "简要标准答案"}:
                    answer_lines.append(cursor_line)
                cursor += 1
            answer = "\n".join(answer_lines).strip()
            if question and answer:
                tags = derive_tags(category_l1, category_l2, question)
                imgs = _get_images_for_range(image_map, i, cursor)
                items.append(build_item(category_l1, category_l2, question, answer, tags, source_file, doc_type, imgs))

    return items


def build_generic_items(
    text: str,
    source_file: str,
    doc_type: str,
    image_map: dict[int, list[str]],
) -> list[dict[str, Any]]:
    chunks = chunk_text(text)
    if not chunks:
        return []
    all_images: list[str] = []
    for imgs in image_map.values():
        all_images.extend(imgs)
    return [
        build_item(
            "知识文档", "原文切片",
            f"{Path(source_file).stem} - 第 {idx + 1} 段",
            chunk, [Path(source_file).stem],
            source_file, doc_type,
            all_images if idx == 0 else [],
            original_text=text,
            normalized_text=text,
            chunk_texts=[chunk],
        )
        for idx, chunk in enumerate(chunks)
    ]


def build_item(
    category_l1: str,
    category_l2: str,
    question: str,
    answer: str,
    tags: list[str],
    source_file: str,
    doc_type: str,
    image_paths: list[str],
    *,
    original_text: str | None = None,
    normalized_text: str | None = None,
    chunk_texts: list[str] | None = None,
) -> dict[str, Any]:
    merged_text = f"一级分类：{category_l1}\n二级分类：{category_l2}\n具体问题：{question}\n简要标准答案：{answer}"
    return {
        "categoryL1": category_l1,
        "categoryL2": category_l2,
        "question": question,
        "answer": answer,
        "tags": tags,
        "docType": doc_type,
        "sourceFile": source_file,
        "imagePath": image_paths[0] if image_paths else None,
        "imagePaths": image_paths,
        "originalText": original_text or merged_text,
        "normalizedText": normalized_text or merged_text,
        "chunkTexts": chunk_texts or chunk_text(merged_text),
    }


def describe_image_as_knowledge(target: Path) -> dict[str, Any]:
    client = get_openai_client()
    image_bytes = target.read_bytes()
    encoded = base64.b64encode(image_bytes).decode("utf-8")
    image_ext = target.suffix.lower().replace(".", "") or "png"

    response = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "请根据图片生成适合知识库检索的结构化中文文本，包含：图片内容摘要、OCR文本、关键对象/界面元素、"
                            "操作场景、可能问题关键词。请输出 JSON，字段为 summary、ocr_text、elements、scene、keywords。"
                        ),
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/{image_ext};base64,{encoded}"},
                    },
                ],
            }
        ],
    )

    raw = response.choices[0].message.content.strip()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        payload = {"summary": raw, "ocr_text": "", "elements": "", "scene": "", "keywords": target.stem}

    merged_text = (
        f"图片内容摘要：{payload.get('summary', '')}\n"
        f"OCR 提取文本：{payload.get('ocr_text', '')}\n"
        f"关键对象/界面元素：{payload.get('elements', '')}\n"
        f"操作场景：{payload.get('scene', '')}\n"
        f"可能问题关键词：{payload.get('keywords', '')}"
    )
    rel_path = target.relative_to(ROOT_DIR).as_posix()

    return {
        "categoryL1": "图片知识文档",
        "categoryL2": "图片问题索引",
        "question": f"{target.stem} 图片可能对应什么问题？",
        "answer": merged_text,
        "tags": derive_tags("图片知识文档", "图片问题索引", target.stem),
        "docType": "image",
        "sourceFile": target.name,
        "imagePath": rel_path,
        "imagePaths": [rel_path],
        "originalText": merged_text,
        "normalizedText": merged_text,
        "chunkTexts": [merged_text],
    }


# ---------- Utilities ----------

def normalize_line(value: str) -> str:
    return re.sub(r"[^\S\t]+", " ", value).strip()


def chunk_text(text: str, chunk_size: int = 560, overlap: int = 100) -> list[str]:
    compact = re.sub(r"\s+", " ", text).strip()
    if not compact:
        return []
    if len(compact) <= chunk_size:
        return [compact]
    chunks: list[str] = []
    start = 0
    while start < len(compact):
        end = min(start + chunk_size, len(compact))
        chunks.append(compact[start:end])
        if end >= len(compact):
            break
        start = max(end - overlap, 0)
    return chunks


def derive_tags(category_l1: str, category_l2: str, question: str) -> list[str]:
    raw = [category_l1, category_l2] + re.split(r"[，。；、,\s（）()]+", question)
    tags = [item for item in raw if item and len(item) >= 2]
    deduped: list[str] = []
    for tag in tags:
        if tag not in deduped:
            deduped.append(tag)
    return deduped[:8]
