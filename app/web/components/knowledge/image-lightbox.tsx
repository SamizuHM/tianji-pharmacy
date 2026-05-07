"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { getFileUrl } from "@/lib/utils";

type ImageLightboxProps = {
  images: string[];
  initialIndex?: number;
  open: boolean;
  onClose: () => void;
};

export function ImageLightbox({ images, initialIndex = 0, open, onClose }: ImageLightboxProps) {
  const [index, setIndex] = useState(initialIndex);

  useEffect(() => {
    setIndex(initialIndex);
  }, [initialIndex]);

  const prev = useCallback(() => setIndex((i) => (i > 0 ? i - 1 : images.length - 1)), [images.length]);
  const next = useCallback(() => setIndex((i) => (i < images.length - 1 ? i + 1 : 0)), [images.length]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, prev, next]);

  if (!open || !images.length) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={getFileUrl(images[index])}
          alt={`图片 ${index + 1}`}
          className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
        />

        {images.length > 1 && (
          <>
            <button
              onClick={prev}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-card/80 px-2 py-1 text-lg hover:bg-card"
            >
              ‹
            </button>
            <button
              onClick={next}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-card/80 px-2 py-1 text-lg hover:bg-card"
            >
              ›
            </button>
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs text-white">
              {index + 1} / {images.length}
            </div>
          </>
        )}

        <button
          onClick={onClose}
          className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-card text-sm shadow hover:bg-secondary"
        >
          ✕
        </button>
      </div>
    </div>,
    document.body
  );
}
