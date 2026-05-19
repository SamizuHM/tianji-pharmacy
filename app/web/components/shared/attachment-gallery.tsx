import type { AttachmentItem } from "@pharmacy/shared";

import { getFileUrl, isImageAttachment } from "@/lib/utils";

export function AttachmentGallery(props: {
  attachments: AttachmentItem[];
  className?: string;
  imageClassName?: string;
  linkClassName?: string;
}) {
  if (!props.attachments.length) {
    return null;
  }

  return (
    <div className={props.className ?? "mt-3 flex flex-wrap gap-2"}>
      {props.attachments.map((item) => {
        const fileUrl = getFileUrl(item.path);

        if (isImageAttachment(item)) {
          return (
            <a key={item.path} href={fileUrl} target="_blank" rel="noreferrer" className="block">
              <img
                src={fileUrl}
                alt={item.name}
                className={
                  props.imageClassName ??
                  "max-h-48 rounded-xl border border-border object-contain transition hover:opacity-80"
                }
              />
            </a>
          );
        }

        return (
          <a
            key={item.path}
            href={fileUrl}
            target="_blank"
            rel="noreferrer"
            className={
              props.linkClassName ??
              "rounded-xl border border-border bg-white px-3 py-2 text-xs hover:bg-secondary dark:bg-card"
            }
          >
            {item.name}
          </a>
        );
      })}
    </div>
  );
}
