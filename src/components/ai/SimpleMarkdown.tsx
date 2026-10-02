import { Fragment, type ReactNode } from "react";

/** Bold, inline code, bullet and numbered lists, headings: enough for short answers. Text stays escaped by React. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith("`") && part.endsWith("`") ? <code key={i} className="rounded bg-bg px-1 text-xs">{part.slice(1, -1)}</code> : <Fragment key={i}>{part}</Fragment>,
  );
}

export function SimpleMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(<Tag key={blocks.length} className={`my-2 space-y-1 pl-5 ${list.ordered ? "list-decimal" : "list-disc"}`}>{list.items.map((it, i) => <li key={i}>{inline(it)}</li>)}</Tag>);
    list = null;
  };
  for (const line of text.split("\n")) {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flush();
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) blocks.push(<p key={blocks.length} className="mt-3 font-semibold">{inline(heading[1])}</p>);
    else if (line.trim()) blocks.push(<p key={blocks.length} className="my-2">{inline(line)}</p>);
  }
  flush();
  return <div className="text-sm leading-relaxed">{blocks}</div>;
}
