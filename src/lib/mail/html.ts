// E-mail HTML is hostile content. It is shown only inside an iframe with
// `sandbox` (no allow-scripts, no allow-same-origin: scripts never run and the
// frame has an opaque origin, so it can't reach the dashboard, its cookies or
// its storage), from `srcdoc`, under a Content-Security-Policy that blocks
// scripts, forms, frames, plugins and (until "Show images") every remote
// request, so opening a message doesn't tell the sender it was read.
// sanitizeEmailHtml() below is a second layer that strips the obvious
// dangerous parts; the sandbox and the CSP are what make it safe.

/** The iframe's sandbox: links may open a new tab; nothing else is allowed (no scripts, no same-origin, no forms, no top navigation). */
export const MAIL_SANDBOX = "allow-popups allow-popups-to-escape-sandbox";

/** The Content-Security-Policy put at the top of every rendered message. */
export function mailCsp(showImages: boolean) {
  return [
    "default-src 'none'",
    `img-src data: cid:${showImages ? " https: http:" : ""}`,
    "style-src 'unsafe-inline'",
    "font-src data:",
    "script-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "media-src 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

const DROP_WITH_CONTENT = ["script", "noscript", "iframe", "frame", "frameset", "object", "embed", "applet", "template", "title"];
const DROP_TAG_ONLY = ["meta", "base", "link", "form", "input", "button", "select", "textarea", "option", "html", "head", "body", "!doctype"];

/** Removes scripts, event handlers, script URLs, frames, forms and head-level tags from e-mail HTML. */
export function sanitizeEmailHtml(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const t of DROP_WITH_CONTENT) {
    out = out.replace(new RegExp(`<${t}\\b[\\s\\S]*?<\\/${t}\\s*>`, "gi"), "");
    // An unclosed one swallows the rest, as a browser would.
    out = out.replace(new RegExp(`<${t}\\b[\\s\\S]*$`, "i"), "");
  }
  for (const t of DROP_TAG_ONLY) out = out.replace(new RegExp(`<\\/?${t}\\b[^>]*>`, "gi"), "");
  // Event handlers (onload=, onerror=, …), quoted or not.
  out = out.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // javascript:, vbscript: and data:text/html URLs in any attribute.
  out = out.replace(/(\s(?:href|src|action|formaction|background|poster|xlink:href|srcset)\s*=\s*["']?)\s*(?:javascript|vbscript|data:text\/html|data:application)[^"'\s>]*/gi, "$1#blocked");
  // CSS expressions / behaviours (old IE) and @import of remote styles.
  out = out.replace(/expression\s*\(/gi, "blocked(").replace(/@import[^;]*;?/gi, "");
  return out;
}

/** Whether the message loads remote images (so a "Show images" button is worth showing). */
export function hasRemoteImages(html: string): boolean {
  return /<img\b[^>]*\ssrc\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html) || /url\(\s*["']?\s*(?:https?:)?\/\//i.test(html) || /\sbackground\s*=\s*["']?\s*https?:/i.test(html) || /\ssrcset\s*=\s*["'][^"']*https?:/i.test(html);
}

/** The full document given to the iframe's srcdoc. */
export function buildSrcdoc(html: string, opts: { showImages: boolean }): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${mailCsp(opts.showImages)}"><meta name="referrer" content="no-referrer"><base target="_blank"><style>html{color-scheme:light}body{margin:0;padding:16px;background:#fff;color:#1b1f24;font:14px/1.5 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}a{color:#0b62c4}</style></head><body>${sanitizeEmailHtml(html)}</body></html>`;
}

/** Inline images (src="cid:…") replaced with data: URIs of their attachments. */
export function replaceCid(html: string, images: Record<string, string>): string {
  return html.replace(/(["'(\s=])cid:([^"')\s>]+)/gi, (all, pre: string, id: string) => {
    const hit = images[id] ?? images[id.replace(/^<|>$/g, "")] ?? images[decodeURIComponentSafe(id)];
    return hit ? `${pre}${hit}` : all;
  });
}

const decodeURIComponentSafe = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** What the person typed (plain text) as simple HTML: paragraphs, line breaks and clickable links. */
export function textToHtml(text: string): string {
  const paras = text.replace(/\r\n?/g, "\n").trim().split(/\n{2,}/);
  const body = paras
    .map((p) => `<p style="margin:0 0 12px">${escapeHtml(p).replace(/https?:\/\/[^\s<>"']+/g, (u) => `<a href="${u}">${u}</a>`).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;line-height:1.5">${body}</div>`;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** Readable plain text from HTML (for Claude's draft, the text fallback and quoting). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table)>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t ]+\n/g, "\n")
    .replace(/[ \t ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Puts `insert` at the top of an HTML document's body (a reply above the quoted thread). */
export function prependToHtmlBody(doc: string, insert: string): string {
  const m = doc.match(/<body\b[^>]*>/i);
  if (!m || m.index === undefined) return `${insert}${doc}`;
  const at = m.index + m[0].length;
  return `${doc.slice(0, at)}${insert}${doc.slice(at)}`;
}
