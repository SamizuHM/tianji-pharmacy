"use client";

import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

export function MarkdownMessage(props: { content: string; className?: string }) {
  return (
    <div className={cn("markdown-message text-sm leading-6", props.className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: ({ className, ...linkProps }) => (
            <a
              className={cn("text-primary underline underline-offset-4", className)}
              target="_blank"
              rel="noreferrer"
              {...linkProps}
            />
          ),
          code: ({ className, children, ...codeProps }) => {
            const value = String(children ?? "");
            const isBlock = value.includes("\n");
            if (!isBlock) {
              return (
                <code
                  className={cn("rounded bg-secondary px-1.5 py-0.5 text-[0.92em]", className)}
                  {...codeProps}
                >
                  {children}
                </code>
              );
            }

            return (
              <code
                className={cn(
                  "block overflow-x-auto whitespace-pre p-3 text-xs leading-5",
                  className
                )}
                {...codeProps}
              >
                {children}
              </code>
            );
          },
          pre: ({ className, ...preProps }) => (
            <pre
              className={cn(
                "my-3 overflow-hidden rounded-lg border border-border bg-secondary/50",
                className
              )}
              {...preProps}
            />
          ),
          table: ({ className, ...tableProps }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-border">
              <table
                className={cn("w-full border-collapse text-left text-sm", className)}
                {...tableProps}
              />
            </div>
          ),
          th: ({ className, ...thProps }) => (
            <th
              className={cn(
                "border-b border-border bg-secondary/60 px-3 py-2 font-medium",
                className
              )}
              {...thProps}
            />
          ),
          td: ({ className, ...tdProps }) => (
            <td
              className={cn(
                "border-b border-border px-3 py-2 align-top last:border-b-0",
                className
              )}
              {...tdProps}
            />
          ),
        }}
      >
        {props.content}
      </ReactMarkdown>
    </div>
  );
}
