"use client";

import { Fragment, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

/** Bold, inline code, code blocks, bullet and numbered lists, headings, rules: enough for short answers. Text stays escaped by React. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i} className="font-semibold text-ink">{part.slice(2, -2)}</strong> : part.startsWith("`") && part.endsWith("`") ? <code key={i} className="rounded-md bg-fill px-1.5 font-mono text-[12.5px] text-ink">{part.slice(1, -1)}</code> : <Fragment key={i}>{part}</Fragment>,
  );
}

/** A code block (e.g. a prompt to paste elsewhere) with a copy button. */
function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the text can still be selected */
    }
  };
  return (
    <div className="relative my-3 overflow-hidden rounded-[12px] bg-panel-2 shadow-[0_0_0_1px_var(--color-line)]">
      <button type="button" onClick={copy} className="hud-btn absolute right-2 top-2 min-h-8 rounded-full bg-panel px-3 py-1 text-[13px] shadow-[0_0_0_1px_var(--color-line)]">
        {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words p-4 pr-24 font-mono text-[12.5px] leading-relaxed text-ink">{code}</pre>
    </div>
  );
}

type Item = { n: number | null; text: string };

export function SimpleMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: Item[] } | null = null;
  let fence: string[] | null = null;
  const flush = () => {
    if (!list) return;
    const { ordered, items } = list;
    const Tag = ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={blocks.length} className={`my-2 space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
        {items.map((it, i) => <li key={i} value={it.n ?? undefined}>{inline(it.text)}</li>)}
      </Tag>,
    );
    list = null;
  };
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (fence) {
        blocks.push(<CodeBlock key={blocks.length} code={fence.join("\n").replace(/^\n+|\n+$/g, "")} />);
        fence = null;
      } else {
        flush();
        fence = [];
      }
      continue;
    }
    if (fence) {
      fence.push(line);
      continue;
    }
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      // Keep the number written, so a list interrupted by a blank line or text doesn't restart at 1.
      list.items.push(numbered ? { n: Number(numbered[1]), text: numbered[2] } : { n: null, text: bullet![1] });
      continue;
    }
    // An indented line right under a list item continues that item.
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1].text += ` ${line.trim()}`;
      continue;
    }
    if (!line.trim()) continue; // blank lines don't end a list
    flush();
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) blocks.push(<p key={blocks.length} className="mt-3 text-[15px] font-semibold text-ink">{inline(heading[1])}</p>);
    else if (/^\s*([-*_])\1{2,}\s*$/.test(line)) blocks.push(<hr key={blocks.length} className="my-3 border-line" />);
    else blocks.push(<p key={blocks.length} className="my-2">{inline(line)}</p>);
  }
  if (fence) blocks.push(<CodeBlock key={blocks.length} code={fence.join("\n")} />); // unclosed block
  flush();
  return <div className="text-[15px] leading-relaxed text-ink">{blocks}</div>;
}
