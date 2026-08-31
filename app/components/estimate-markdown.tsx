"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function isDirectlyBold(children: React.ReactNode): boolean {
  return (
    !!children &&
    typeof children === "object" &&
    "type" in (children as object) &&
    (children as React.ReactElement).type === "strong"
  );
}

const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-xl font-bold text-[#26211B] mt-6 mb-2 first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2
      className="text-base font-bold mt-6 mb-2 uppercase tracking-wide text-[#26211B] pl-3"
      style={{ borderLeft: "3px solid #f59e0b" }}
    >
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-base font-semibold text-[#5C4A2E] mt-4 mb-1.5">{children}</h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => {
    const text = Array.isArray(children)
      ? children.filter((c): c is string => typeof c === "string").join("")
      : typeof children === "string"
        ? children
        : "";
    const totalMatch = text.trim().match(/^(?:Estimated total|Total):\s*(\$[\d,]+(?:\.\d+)?)/i);
    if (totalMatch) {
      return (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-medium text-[#5C4A2E]">Estimated total</span>
          <span className="text-xl font-bold text-[#26211B]">{totalMatch[1]}</span>
        </div>
      );
    }
    return <p className="text-[#5C4A2E] text-sm leading-relaxed mb-3">{children}</p>;
  },
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-3 space-y-1 pl-1">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-3 space-y-1 pl-1 list-decimal list-inside">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="text-[#5C4A2E] text-sm leading-relaxed flex gap-2">
      <span className="text-amber-500 mt-0.5 shrink-0">•</span>
      <span>{children}</span>
    </li>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-[#26211B]">{children}</strong>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="mb-4 overflow-x-auto rounded-lg border border-[#C9B384]">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-[#EADCC0]">{children}</thead>
  ),
  th: ({
    children,
    style,
  }: {
    children?: React.ReactNode;
    style?: React.CSSProperties;
  }) => (
    <th
      className="px-3 py-2.5 text-xs font-semibold text-[#5C4A2E] uppercase tracking-wide"
      style={{ textAlign: style?.textAlign ?? "left" }}
    >
      {children}
    </th>
  ),
  td: ({
    children,
    style,
  }: {
    children?: React.ReactNode;
    style?: React.CSSProperties;
  }) => {
    const bold = isDirectlyBold(children);
    return (
      <td
        className={`px-3 border-t ${
          bold
            ? "py-3 border-[#C9B384] text-base font-bold text-[#26211B]"
            : "py-2.5 border-[#C9B384] text-[#5C4A2E]"
        }`}
        style={{ textAlign: style?.textAlign ?? "left" }}
      >
        {children}
      </td>
    );
  },
  hr: () => <hr className="border-[#C9B384] my-4" />,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="text-[#5C4A2E] text-xs leading-relaxed mb-4 not-italic">
      {children}
    </blockquote>
  ),
};

export function EstimateMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  );
}
