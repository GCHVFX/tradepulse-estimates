// Single source of truth for estimate markdown rendering.
// Do not duplicate this config in other files. Import this component.
"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-xl font-bold text-zinc-900 mt-6 mb-2 first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-base font-bold text-zinc-900 mt-6 mb-2 uppercase tracking-wide">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-base font-semibold text-zinc-700 mt-4 mb-1.5">{children}</h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-zinc-700 text-sm leading-relaxed mb-3">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-3 space-y-1 pl-1">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-3 space-y-1 pl-1 list-decimal list-inside">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="text-zinc-700 text-sm leading-relaxed flex gap-2">
      <span className="text-amber-500 mt-0.5 shrink-0">•</span>
      <span>{children}</span>
    </li>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-zinc-900">{children}</strong>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="mb-4 overflow-x-auto rounded-lg border border-zinc-200">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-zinc-100">{children}</thead>
  ),
  th: ({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) => (
    <th
      className="px-3 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide"
      style={{ textAlign: style?.textAlign ?? "left" }}
    >
      {children}
    </th>
  ),
  td: ({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) => (
    <td
      className="px-3 py-2.5 text-zinc-700 border-t border-zinc-200"
      style={{ textAlign: style?.textAlign ?? "left" }}
    >
      {children}
    </td>
  ),
  hr: () => <hr className="border-zinc-200 my-4" />,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="text-zinc-400 text-xs leading-relaxed mb-4 not-italic">{children}</blockquote>
  ),
};

export function EstimateMarkdown({ content }: { content: string }) {
  const filtered = content
    .split("\n")
    .filter((line) => !line.startsWith("# "))
    .join("\n");

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {filtered}
    </ReactMarkdown>
  );
}
