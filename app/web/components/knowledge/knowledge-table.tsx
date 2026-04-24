"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ImageLightbox } from "@/components/knowledge/image-lightbox";
import { KnowledgeEditForm, KnowledgeItemActions } from "@/components/knowledge/knowledge-admin";

type KnowledgeItemRow = {
  id: string;
  categoryL1: string;
  categoryL2: string;
  question: string;
  answer: string;
  sourceFile: string | null;
  sourceType: string;
  imagePathsJson: string | null;
  imagePath: string | null;
};

export function KnowledgeTable({ items }: { items: KnowledgeItemRow[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);

  return (
    <>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="pb-2 pr-4 font-medium">分类</th>
            <th className="pb-2 pr-4 font-medium">问题</th>
            <th className="pb-2 pr-4 font-medium">来源</th>
            <th className="pb-2 pr-4 font-medium">图片</th>
            <th className="pb-2 font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const imagePaths: string[] = item.imagePathsJson
              ? JSON.parse(item.imagePathsJson)
              : item.imagePath
                ? [item.imagePath]
                : [];

            return (
              <tr key={item.id} className="border-b border-border/50 align-top">
                {editingId === item.id ? (
                  <td colSpan={5} className="py-3">
                    <KnowledgeEditForm
                      item={item}
                      onCancel={() => setEditingId(null)}
                    />
                  </td>
                ) : (
                  <>
                    <td className="py-3 pr-4">
                      <div className="max-w-[160px]">
                        {item.categoryL1} / {item.categoryL2}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="max-w-[300px]">
                        <div className="font-medium">{item.question}</div>
                        <div className="mt-1 text-muted line-clamp-2">{item.answer}</div>
                        {imagePaths.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {imagePaths.map((img, i) => (
                              <img
                                key={i}
                                src={`/api/files/${img}`}
                                alt=""
                                className="h-16 cursor-pointer rounded border border-border object-contain transition hover:opacity-80"
                                onClick={() => setLightbox({ images: imagePaths, index: i })}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="text-xs text-muted">
                        {item.sourceFile || item.sourceType}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      {imagePaths.length > 0 ? (
                        <div className="flex gap-1">
                          {imagePaths.slice(0, 2).map((img, i) => (
                            <img
                              key={i}
                              src={`/api/files/${img}`}
                              alt=""
                              className="h-8 w-8 cursor-pointer rounded border border-border object-cover"
                              onClick={() => setLightbox({ images: imagePaths, index: i })}
                            />
                          ))}
                          {imagePaths.length > 2 && (
                            <span className="text-xs text-muted self-center">
                              +{imagePaths.length - 2}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted">-</span>
                      )}
                    </td>
                    <td className="py-3">
                      <KnowledgeItemActions
                        id={item.id}
                        onEdit={() => setEditingId(item.id)}
                      />
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          initialIndex={lightbox.index}
          open={true}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}
