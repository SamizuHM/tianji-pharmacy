import type { AttachmentItem } from "@pharmacy/shared";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function truncateText(value: string, length = 80) {
  if (value.length <= length) {
    return value;
  }

  return `${value.slice(0, length)}...`;
}

export function buildTicketNo() {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const tail = Math.random().toString().slice(2, 8);
  return `TK${date}${tail}`;
}

export function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

export function getAttachmentItems(value: string | null | undefined) {
  return safeJsonParse<AttachmentItem[]>(value, []).filter((item) => Boolean(item?.path));
}

export function getAttachmentPaths(value: string | null | undefined) {
  return Array.from(
    new Set(
      getAttachmentItems(value)
        .map((item) => item.path)
        .filter(Boolean)
    )
  );
}

export function getFileUrl(filePath: string) {
  return `/api/files/${filePath.replace(/^uploads\//, "")}`;
}

export function isImageAttachment(item: { mimeType?: string; path?: string }) {
  if (item.mimeType?.startsWith("image/")) {
    return true;
  }

  return /\.(png|jpe?g|webp|gif)$/i.test(item.path ?? "");
}
