import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock("@/lib/server/auth", async (orig) => ({ ...(await orig<object>()), currentUser: async () => auth.user, clientIp: async () => null }));

import { canReadMailbox, canSendFrom, fromKey, mailGrants, mailPermissions, needsReconnect, parseAddressList, toKey } from "@/lib/mail/access";
import { buildSrcdoc, hasRemoteImages, htmlToText, MAIL_SANDBOX, mailCsp, prependToHtmlBody, sanitizeEmailHtml, textToHtml } from "@/lib/mail/html";
import { buildOutlookListPath, draftPatch, listOutlookMessages, outlookCursor, sendOutlook, validOutlookCursor } from "@/lib/mail/outlook";
import { buildGmailListPath, buildMime, gmailSendPayload } from "@/lib/mail/gmail";
import { parseSendForm, sameOrigin } from "@/lib/mail/compose";
import { contentDisposition, safeContentType } from "@/lib/mail/download";
import type { MailMessage, SendRequest } from "@/lib/mail/types";
import { forgetMsTokens, msToken, MS_READ_SCOPES, MS_SCOPES } from "@/lib/server/microsoft";
import { authorizeUrl } from "@/lib/server/connect";
import { GOOGLE_SCOPES, hasGoogleScope } from "@/lib/server/google";
import { getDb, pgliteDb, useDb } from "@/lib/server/db";
import { listConnections, saveConnection } from "@/lib/server/store/connections";
import { mailboxesFor, openMailbox, MailAccessError, replyRecipients, replySubject, sendMail, messageHref } from "@/lib/server/mail";
import { listAudit } from "@/lib/server/store/audit";
import { GET as attachmentRoute } from "@/app/api/mail/attachment/route";
import { POST as sendRoute } from "@/app/api/mail/send/route";
import type { Access } from "@/lib/access";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const OWNER: Access = { role: "owner", businesses: null, sections: null };
const ASSISTANT_CONSULTING: Access = { role: "assistant", businesses: ["Kaj Consulting"], sections: null };
const DEVELOPER: Access = { role: "developer", businesses: null, sections: null };
const SCOPED_OWNER: Access = { role: "owner", businesses: ["Kaj Consulting"], sections: null };

// ─── Access ──────────────────────────────────────────────────────────────────

describe("mailbox access", () => {
  const shared = { owner: null, business: "Kaj Consulting" };
  const otherBiz = { owner: null, business: "Kaj Store" };
  const untagged = { owner: null, business: null };
  const brosOwn = { owner: "bro@kaj.com", business: null };

  it("personal mailboxes are their owner's alone, full owners included", () => {
    expect(canReadMailbox(OWNER, "boss@kaj.com", brosOwn)).toBe(false);
    expect(canSendFrom(OWNER, "boss@kaj.com", brosOwn)).toBe(false);
    expect(canReadMailbox(ASSISTANT_CONSULTING, "amy@kaj.com", brosOwn)).toBe(false);
    const bro: Access = { role: "developer", businesses: null, sections: ["inbox"] };
    expect(canReadMailbox(bro, "bro@kaj.com", brosOwn)).toBe(true);
    expect(canSendFrom(bro, "bro@kaj.com", brosOwn)).toBe(true);
    // Without the Inbox, not even their own.
    expect(canReadMailbox(DEVELOPER, "bro@kaj.com", brosOwn)).toBe(false);
  });

  it("shared mailboxes follow role and business; only full owners send", () => {
    expect(canReadMailbox(ASSISTANT_CONSULTING, "amy@kaj.com", shared)).toBe(true);
    expect(canSendFrom(ASSISTANT_CONSULTING, "amy@kaj.com", shared)).toBe(false);
    // Another business's mailbox and an untagged one stay hidden.
    expect(canReadMailbox(ASSISTANT_CONSULTING, "amy@kaj.com", otherBiz)).toBe(false);
    expect(canReadMailbox(ASSISTANT_CONSULTING, "amy@kaj.com", untagged)).toBe(false);
    // No Inbox section: nothing.
    expect(canReadMailbox(DEVELOPER, "dev@kaj.com", shared)).toBe(false);
    // An owner limited to some businesses reads them but isn't a full owner: no sending.
    expect(canReadMailbox(SCOPED_OWNER, "o@kaj.com", shared)).toBe(true);
    expect(canSendFrom(SCOPED_OWNER, "o@kaj.com", shared)).toBe(false);
    expect(canSendFrom(OWNER, "boss@kaj.com", shared)).toBe(true);
    expect(canSendFrom(OWNER, "boss@kaj.com", untagged)).toBe(true);
  });

  it("permissions combine access with what the token was granted", () => {
    const full = mailGrants("outlook", ["openid", "https://graph.microsoft.com/Mail.ReadWrite", "https://graph.microsoft.com/Mail.Send"]);
    const reader = mailPermissions(ASSISTANT_CONSULTING, "amy@kaj.com", shared, full);
    expect(reader).toMatchObject({ read: true, triage: true, organize: false, send: false });
    expect(reader.sendBlocked).toMatch(/Only the dashboard owner/);
    expect(mailPermissions(OWNER, "boss@kaj.com", shared, full)).toMatchObject({ read: true, triage: true, organize: true, send: true, reconnect: false });
    const readOnly = mailGrants("outlook", ["Mail.Read", "User.Read"]);
    const p = mailPermissions(OWNER, "boss@kaj.com", shared, readOnly);
    expect(p).toMatchObject({ read: true, triage: false, organize: false, send: false, reconnect: true });
    expect(p.sendBlocked).toMatch(/Reconnect/);
  });
});

describe("token scope detection", () => {
  it("reads Microsoft and Google grants", () => {
    expect(mailGrants("outlook", null)).toEqual({ read: null, modify: null, send: null });
    expect(needsReconnect(mailGrants("outlook", null))).toBe(false);
    expect(mailGrants("outlook", ["https://graph.microsoft.com/Mail.Read"])).toEqual({ read: true, modify: false, send: false });
    expect(needsReconnect(mailGrants("outlook", ["Mail.ReadWrite"]))).toBe(true); // no Mail.Send
    expect(needsReconnect(mailGrants("outlook", ["mail.readwrite", "MAIL.SEND"]))).toBe(false);
    expect(mailGrants("gmail", [GOOGLE_SCOPES.gmail])).toEqual({ read: true, modify: false, send: false });
    expect(mailGrants("gmail", [GOOGLE_SCOPES.gmailModify, GOOGLE_SCOPES.gmailSend])).toEqual({ read: true, modify: true, send: true });
    expect(hasGoogleScope([GOOGLE_SCOPES.gmailModify], "gmail")).toBe(true);
  });

  it("asks Microsoft and Google for write and send when connecting", () => {
    vi.stubEnv("MS_CLIENT_ID", "id");
    vi.stubEnv("MS_CLIENT_SECRET", "secret");
    vi.stubEnv("GOOGLE_CLIENT_ID", "gid");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "gs");
    for (const personal of [undefined, { email: "bro@kaj.com" }]) {
      const scope = new URL(authorizeUrl("microsoft", "https://x/cb", "s", personal)).searchParams.get("scope")!;
      expect(scope.split(" ")).toEqual(expect.arrayContaining(["Mail.ReadWrite", "Mail.Send", "Calendars.Read", "offline_access"]));
    }
    const g = new URL(authorizeUrl("gmail", "https://x/cb", "s")).searchParams.get("scope")!;
    expect(g.split(" ")).toEqual(expect.arrayContaining([GOOGLE_SCOPES.gmailModify, GOOGLE_SCOPES.gmailSend]));
  });

  it("falls back to the read-only scopes when the old token wasn't consented, and reports what was granted", async () => {
    forgetMsTokens();
    vi.stubEnv("MS_CLIENT_ID", "id");
    vi.stubEnv("MS_CLIENT_SECRET", "secret");
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      const scope = new URLSearchParams(String(init.body)).get("scope")!;
      asked.push(scope);
      if (scope === MS_SCOPES) return json({ error: "invalid_grant", error_codes: [65001], error_description: "AADSTS65001: not consented" }, 400);
      return json({ access_token: "at-old", expires_in: 3600, scope: "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read" });
    });
    const t = await msToken({ account: "legacy@kaj.com", refreshToken: "rt-legacy" });
    expect(t.token).toBe("at-old");
    expect(asked).toEqual([MS_SCOPES, MS_READ_SCOPES]);
    expect(needsReconnect(mailGrants("outlook", t.scopes))).toBe(true);
  });

  it("an upgraded token reports write and send", async () => {
    forgetMsTokens();
    vi.stubEnv("MS_CLIENT_ID", "id");
    vi.stubEnv("MS_CLIENT_SECRET", "secret");
    vi.stubGlobal("fetch", async () => json({ access_token: "at-new", expires_in: 3600, scope: "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send" }));
    const t = await msToken({ account: "new@kaj.com", refreshToken: "rt-new" });
    expect(mailGrants("outlook", t.scopes)).toEqual({ read: true, modify: true, send: true });
  });
});

// ─── Listing ─────────────────────────────────────────────────────────────────

describe("list queries and paging", () => {
  it("builds Graph list paths: newest first, unread filter, search", () => {
    const p = new URL(`https://graph.microsoft.com/v1.0${buildOutlookListPath({ folder: "inbox" })}`);
    expect(p.pathname).toBe("/v1.0/me/mailFolders/inbox/messages");
    expect(p.searchParams.get("$top")).toBe("25");
    expect(p.searchParams.get("$orderby")).toBe("receivedDateTime desc");
    expect(p.searchParams.get("$filter")).toBeNull();
    const u = new URL(`https://g/v1.0${buildOutlookListPath({ folder: "sentitems", unread: true, top: 10 })}`);
    expect(u.searchParams.get("$filter")).toBe("receivedDateTime ge 1900-01-01T00:00:00Z and isRead eq false");
    expect(u.searchParams.get("$top")).toBe("10");
    const s = new URL(`https://g/v1.0${buildOutlookListPath({ folder: "inbox", search: 'invoice "march" \\ x', unread: true })}`);
    expect(s.searchParams.get("$search")).toBe('"invoice march x"');
    // $search can't be combined with $orderby / $filter in Graph.
    expect(s.searchParams.get("$orderby")).toBeNull();
    expect(s.searchParams.get("$filter")).toBeNull();
    expect(buildOutlookListPath({ folder: "AAMkAD+abc/def=" })).toContain("/me/mailFolders/AAMkAD%2Babc%2Fdef%3D/messages");
    expect(() => buildOutlookListPath({ folder: "../me" })).toThrow();
  });

  it("only accepts list cursors for this mailbox's messages", () => {
    const next = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?%24top=25&%24skip=25";
    expect(outlookCursor(next)).toBe("/me/mailFolders/inbox/messages?%24top=25&%24skip=25");
    expect(outlookCursor("https://evil.example/v1.0/me/mailFolders/inbox/messages?x")).toBeNull();
    expect(validOutlookCursor("/me/messages/abc/attachments")).toBe(false);
    expect(validOutlookCursor("/users/other@kaj.com/mailFolders/inbox/messages?x")).toBe(false);
    expect(validOutlookCursor("/me/mailFolders/inbox/messages?x=https://evil")).toBe(false);
  });

  it("pages through Graph with the nextLink and filters a search for unread", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      calls.push(u);
      return json({
        value: [
          { id: "m1", subject: "A", receivedDateTime: "2026-10-01T10:00:00Z", isRead: false, bodyPreview: "x", hasAttachments: true, flag: { flagStatus: "flagged" }, from: { emailAddress: { name: "Ama", address: "ama@x.com" } } },
          { id: "m2", subject: null, receivedDateTime: "2026-10-01T09:00:00Z", isRead: true },
        ],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?%24search=%22a%22&%24skiptoken=abc",
      });
    });
    const page = await listOutlookMessages("tok", { folder: "inbox", search: "a", unread: true });
    expect(page.items.map((m) => m.id)).toEqual(["m1"]);
    expect(page.items[0]).toMatchObject({ flagged: true, hasAttachments: true, from: { name: "Ama", address: "ama@x.com" } });
    expect(page.next).toBe("/me/mailFolders/inbox/messages?%24search=%22a%22&%24skiptoken=abc");
    await listOutlookMessages("tok", { folder: "inbox", cursor: page.next });
    expect(calls[1]).toBe(`https://graph.microsoft.com/v1.0${page.next}`);
    // A tampered cursor is ignored: the first page is fetched instead.
    await listOutlookMessages("tok", { folder: "inbox", cursor: "/me/messages/x/attachments/y/$value" });
    expect(calls[2]).toContain("/me/mailFolders/inbox/messages?");
  });

  it("builds Gmail list queries", () => {
    const q = (o: Parameters<typeof buildGmailListPath>[0]) => new URL(`https://g${buildGmailListPath(o)}`).searchParams;
    expect(Object.fromEntries(q({ folder: "INBOX" }))).toEqual({ maxResults: "25", labelIds: "INBOX" });
    expect(q({ folder: "INBOX", unread: true, search: 'from:"x" bills', cursor: "tok123" }).get("q")).toBe("is:unread from: x bills");
    expect(q({ folder: "INBOX", cursor: "tok123" }).get("pageToken")).toBe("tok123");
    expect(q({ folder: "archive" }).get("q")).toContain("-in:inbox");
    expect(q({ folder: "TRASH" }).get("includeSpamTrash")).toBe("true");
    expect(() => buildGmailListPath({ folder: "../x" })).toThrow();
  });
});

// ─── Sending ─────────────────────────────────────────────────────────────────

const req = (o: Partial<SendRequest>): SendRequest => ({ mode: "new", to: [{ name: "Ama", address: "ama@x.com" }], cc: [], bcc: [], subject: "Hi", body: "Hello\n\nThanks", attachments: [], ...o });

function graphRecorder(draft: Record<string, unknown> = { id: "D1", body: { contentType: "html", content: "<html><body><div>quoted</div></body></html>" } }, failOn?: string) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    calls.push({ method, url: url.replace("https://graph.microsoft.com/v1.0", ""), body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (failOn && url.endsWith(failOn)) return json({ error: { code: "ErrorAccessDenied", message: "no" } }, 403);
    if (method === "POST" && /create(Reply|ReplyAll|Forward)$|\/me\/messages$/.test(url)) return json(draft, 201);
    return new Response(null, { status: method === "POST" && url.endsWith("/send") ? 202 : 204 });
  });
  return calls;
}

describe("send payloads", () => {
  it("reply: createReply → set recipients, subject and body above the quote → send", async () => {
    const calls = graphRecorder();
    await sendOutlook("tok", req({ mode: "reply", messageId: "M/1", subject: "Re: Hi", cc: [{ name: "", address: "ops@x.com" }], bcc: [{ name: "", address: "me@x.com" }] }));
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /me/messages/M%2F1/createReply", "PATCH /me/messages/D1", "POST /me/messages/D1/send"]);
    expect(calls[0].body).toEqual({});
    const patch = calls[1].body as ReturnType<typeof draftPatch>;
    expect(patch.toRecipients).toEqual([{ emailAddress: { address: "ama@x.com", name: "Ama" } }]);
    expect(patch.ccRecipients).toEqual([{ emailAddress: { address: "ops@x.com" } }]);
    expect(patch.bccRecipients).toEqual([{ emailAddress: { address: "me@x.com" } }]);
    expect(patch.subject).toBe("Re: Hi");
    expect(patch.body.contentType).toBe("HTML");
    expect(patch.body.content).toMatch(/^<html><body><div[^>]*><p[^>]*>Hello<\/p><p[^>]*>Thanks<\/p><\/div><br><div>quoted<\/div>/);
  });

  it("reply all and forward use their own Graph actions; attachments are added before sending", async () => {
    let calls = graphRecorder();
    await sendOutlook("tok", req({ mode: "replyAll", messageId: "M1" }));
    expect(calls[0].url).toBe("/me/messages/M1/createReplyAll");
    calls = graphRecorder();
    await sendOutlook("tok", req({ mode: "forward", messageId: "M1", body: "", attachments: [{ name: "a.txt", contentType: "text/plain", data: new TextEncoder().encode("hi") }] }));
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /me/messages/M1/createForward", "PATCH /me/messages/D1", "POST /me/messages/D1/attachments", "POST /me/messages/D1/send"]);
    expect(calls[2].body).toEqual({ "@odata.type": "#microsoft.graph.fileAttachment", name: "a.txt", contentType: "text/plain", contentBytes: "aGk=" });
  });

  it("new message: one draft with everything, then send", async () => {
    const calls = graphRecorder({ id: "N1" });
    await sendOutlook("tok", req({ body: "<b>not html</b>" }));
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /me/messages", "POST /me/messages/N1/send"]);
    const body = calls[0].body as ReturnType<typeof draftPatch>;
    expect(body.subject).toBe("Hi");
    expect(body.toRecipients).toEqual([{ emailAddress: { address: "ama@x.com", name: "Ama" } }]);
    // What was typed is text: it's escaped, never sent as markup.
    expect(body.body.content).toContain("&lt;b&gt;not html&lt;/b&gt;");
  });

  it("deletes the draft when sending fails", async () => {
    const calls = graphRecorder(undefined, "/send");
    await expect(sendOutlook("tok", req({ mode: "reply", messageId: "M1" }))).rejects.toThrow(/Reconnect/);
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", url: "/me/messages/D1" });
  });

  it("Gmail: an RFC 822 reply in the thread, headers safe from injection", () => {
    const original: MailMessage = {
      id: "g1", subject: "Hi", from: { name: "Ama", address: "ama@x.com" }, to: [], cc: [], bcc: [], replyTo: [], preview: "", receivedAt: "2026-10-01T10:00:00Z", sentAt: null,
      unread: false, flagged: false, hasAttachments: false, important: false, draft: false, html: null, text: "Original text", attachments: [], webLink: null,
      threadId: "T1", messageIdHeader: "<abc@mail>", references: "<root@mail>",
    };
    const raw = buildMime({ from: "me@kaj.com", req: req({ mode: "reply", messageId: "g1", subject: "Re: Hi\r\nBcc: evil@x.com", bcc: [{ name: "", address: "boss@kaj.com" }] }), original, boundary: "B", date: new Date("2026-10-02T00:00:00Z") });
    const head = raw.split("\r\n\r\n")[0];
    expect(head).toContain("To: \"Ama\" <ama@x.com>");
    expect(head).toContain("Bcc: boss@kaj.com");
    expect(head).toContain("Subject: Re: Hi Bcc: evil@x.com");
    expect(head.match(/^Bcc:/gm)).toHaveLength(1);
    expect(head).toContain("In-Reply-To: <abc@mail>");
    expect(head).toContain("References: <root@mail> <abc@mail>");
    const text = Buffer.from(raw.split("Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n")[1].split("\r\n--")[0].replace(/\r\n/g, ""), "base64").toString();
    expect(text).toContain("Hello");
    expect(text).toContain("> Original text");
    const payload = gmailSendPayload(raw, original);
    expect(payload.threadId).toBe("T1");
    expect(Buffer.from(payload.raw, "base64url").toString()).toBe(raw);
    expect(buildMime({ from: "me@kaj.com", req: req({ subject: "Café" }), boundary: "B" })).toContain(`Subject: =?UTF-8?B?${Buffer.from("Café").toString("base64")}?=`);
  });

  it("validates the composer's form", async () => {
    const f = (e: Record<string, string>) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries({ mailbox: "abc", mode: "new", to: "", subject: "Hi", body: "Hello", ...e })) fd.set(k, v);
      return fd;
    };
    expect(await parseSendForm(f({}))).toEqual({ error: "Add at least one recipient." });
    expect(await parseSendForm(f({ to: "not an address" }))).toMatchObject({ error: expect.stringMatching(/isn't an e-mail address/) });
    expect(await parseSendForm(f({ mode: "reply", to: "a@x.com" }))).toMatchObject({ error: expect.stringMatching(/missing/) });
    expect(await parseSendForm(f({ mode: "drop" }))).toMatchObject({ error: expect.any(String) });
    const ok = await parseSendForm(f({ to: 'Ama <ama@x.com>; "Doe, J" <j@x.com>, ama@x.com', mode: "reply", message: toKey("M/1") }));
    expect(ok).toMatchObject({ mailbox: "abc", req: { mode: "reply", messageId: "M/1", to: [{ name: "Ama", address: "ama@x.com" }, { name: "Doe, J", address: "j@x.com" }] } });
    const big = f({ to: "a@x.com" });
    big.append("files", new File([new Uint8Array(3 * 1024 * 1024 + 1)], "big.bin"));
    expect(await parseSendForm(big)).toMatchObject({ error: expect.stringMatching(/big.bin is larger/) });
    expect(parseAddressList("a@x.com\nb@y.org")).toEqual({ list: [{ name: "", address: "a@x.com" }, { name: "", address: "b@y.org" }] });
  });

  it("default recipients and subjects for replies", () => {
    const m = { from: { name: "Ama", address: "ama@x.com" }, to: [{ name: "Me", address: "ME@kaj.com" }, { name: "Bo", address: "bo@x.com" }], cc: [{ name: "", address: "cc@x.com" }, { name: "", address: "ama@x.com" }], replyTo: [] };
    expect(replyRecipients("reply", m, "me@kaj.com")).toEqual({ to: "Ama <ama@x.com>", cc: "" });
    expect(replyRecipients("replyAll", m, "me@kaj.com")).toEqual({ to: "Ama <ama@x.com>, Bo <bo@x.com>", cc: "cc@x.com" });
    expect(replyRecipients("forward", m, "me@kaj.com")).toEqual({ to: "", cc: "" });
    expect(replySubject("reply", "Re: x")).toBe("Re: x");
    expect(replySubject("forward", "x")).toBe("Fw: x");
    expect(fromKey(toKey("ms:a@b.com"))).toBe("ms:a@b.com");
    expect(fromKey("../x")).toBeNull();
    expect(messageHref({ id: "ms:a@b.com:AAMk/1=", mailbox: "ms:a@b.com" })).toBe(`/inbox/m/${toKey("ms:a@b.com")}/${toKey("AAMk/1=")}`);
  });
});

// ─── HTML sandboxing ─────────────────────────────────────────────────────────

describe("message HTML is sandboxed", () => {
  const evil = `<html><head><meta http-equiv="refresh" content="0;url=https://evil"><base href="https://evil/"><script>steal()</script></head><body onload="x()"><img src="https://track.example/p.gif" onerror="alert(1)"><a href="javascript:alert(1)">x</a><iframe src="https://evil"></iframe><form action="https://evil"><input name=p></form><p>Hello</p></body></html>`;

  it("never allows scripts or same-origin in the iframe", () => {
    const tokens = MAIL_SANDBOX.split(" ");
    expect(tokens).not.toContain("allow-scripts");
    expect(tokens).not.toContain("allow-same-origin");
    expect(tokens).not.toContain("allow-forms");
    expect(tokens).not.toContain("allow-top-navigation");
  });

  it("puts a strict CSP first and blocks remote images until asked", () => {
    const doc = buildSrcdoc(evil, { showImages: false });
    expect(doc.indexOf('http-equiv="Content-Security-Policy"')).toBeLessThan(doc.indexOf("<body>"));
    expect(mailCsp(false)).toContain("script-src 'none'");
    expect(mailCsp(false)).toContain("default-src 'none'");
    expect(mailCsp(false)).toContain("form-action 'none'");
    expect(mailCsp(false)).toMatch(/img-src data: cid:;/);
    expect(mailCsp(true)).toMatch(/img-src data: cid: https: http:/);
    expect(buildSrcdoc(evil, { showImages: true })).toContain("img-src data: cid: https: http:");
  });

  it("strips scripts, handlers, script URLs, frames, forms and head tags", () => {
    const clean = sanitizeEmailHtml(evil);
    expect(clean).not.toMatch(/<script|onload|onerror|javascript:|<iframe|<form|<input|http-equiv="refresh"|<base/i);
    expect(clean).toContain("<p>Hello</p>");
    expect(hasRemoteImages(evil)).toBe(true);
    expect(hasRemoteImages('<img src="data:image/png;base64,xx">')).toBe(false);
    expect(hasRemoteImages('<div style="background:url(https://t.example/a.png)">')).toBe(true);
  });

  it("converts between text and HTML", () => {
    expect(textToHtml("a <b>\nc\n\nhttps://x.com/a?b=1")).toContain('&lt;b&gt;<br>c</p><p style="margin:0 0 12px"><a href="https://x.com/a?b=1">');
    expect(htmlToText("<p>Hi&nbsp;there</p><br><ul><li>One</li></ul><style>x{}</style>")).toBe("Hi there\n\n• One");
    expect(prependToHtmlBody('<html><body class="x">Q</body></html>', "A")).toBe('<html><body class="x">AQ</body></html>');
  });

  it("downloads never render on the dashboard's origin", () => {
    expect(safeContentType("text/html; charset=utf-8")).toBe("application/octet-stream");
    expect(safeContentType("image/svg+xml")).toBe("application/octet-stream");
    expect(safeContentType("application/pdf")).toBe("application/pdf");
    expect(contentDisposition('évil"\r\nX: y.pdf')).toBe(`attachment; filename="_vil_X: y.pdf"; filename*=UTF-8''${encodeURIComponent("évil_X: y.pdf")}`);
  });
});

// ─── With a database: mailboxes, attachment route, send route ───────────────

describe("mail client access end to end (PGlite)", () => {
  beforeAll(async () => {
    await useDb(await pgliteDb());
  });
  beforeEach(async () => {
    forgetMsTokens();
    vi.stubEnv("ALLOWED_EMAILS", "boss@kaj.com");
    vi.stubEnv("MS_CLIENT_ID", "id");
    vi.stubEnv("MS_CLIENT_SECRET", "secret");
    vi.stubEnv("SAMPLE_DATA", "off");
    const db = await getDb();
    await db.exec("truncate connections, users, audit_log, rate_limits cascade");
    await db.query(`insert into users (email, role, businesses, sections) values
      ('boss@kaj.com', null, null, null),
      ('amy@kaj.com', 'assistant', '["Kaj Consulting"]'::jsonb, null),
      ('bro@kaj.com', 'developer', null, '["inbox"]'::jsonb)`);
    await saveConnection({ provider: "microsoft", account: "office@kaj.com", label: "Consulting", business: "Kaj Consulting", secret: { refreshToken: "rt-office" } });
    await saveConnection({ provider: "microsoft", account: "store@kaj.com", label: "Store", business: "Kaj Store", secret: { refreshToken: "rt-store" } });
    await saveConnection({ provider: "microsoft", account: "bro@kaj.com", secret: { refreshToken: "rt-bro" }, ownerEmail: "bro@kaj.com" });
    vi.stubGlobal("fetch", async (u: string, init?: RequestInit) => {
      const url = String(u);
      if (url.includes("login.microsoftonline.com")) return json({ access_token: "at", expires_in: 3600, scope: "Mail.ReadWrite Mail.Send" });
      if (url.endsWith("/attachments/A1?$select=id,name,contentType,size")) return json({ id: "A1", name: "invoice.html", contentType: "text/html", size: 5 });
      if (url.endsWith("/attachments/A1/$value")) return new Response("<b>x</b>");
      if (init?.method === "POST" && url.endsWith("/createReply")) return json({ id: "D1", body: { contentType: "html", content: "<html><body>q</body></html>" } });
      if (init?.method) return new Response(null, { status: 202 });
      return json({ error: { message: "not stubbed" } }, 404);
    });
  });

  const boss = { ...OWNER, email: "boss@kaj.com" };
  const amy = { ...ASSISTANT_CONSULTING, email: "amy@kaj.com" };
  const bro = { role: "developer" as const, businesses: null, sections: ["inbox" as const], email: "bro@kaj.com" };

  it("lists only the mailboxes each person may open", async () => {
    expect((await mailboxesFor(boss)).map((m) => m.address)).toEqual(["office@kaj.com", "store@kaj.com"]);
    expect((await mailboxesFor(amy)).map((m) => m.address)).toEqual(["office@kaj.com"]);
    expect((await mailboxesFor(bro)).map((m) => m.address)).toEqual(["office@kaj.com", "store@kaj.com", "bro@kaj.com"]);
    await expect(openMailbox(boss, toKey("ms:bro@kaj.com"), "read")).rejects.toBeInstanceOf(MailAccessError);
    await expect(openMailbox(amy, toKey("ms:store@kaj.com"), "read")).rejects.toBeInstanceOf(MailAccessError);
    await expect(openMailbox(amy, toKey("ms:office@kaj.com"), "send")).rejects.toThrow(/Only the dashboard owner/);
    await expect(openMailbox(amy, toKey("ms:office@kaj.com"), "organize")).rejects.toBeInstanceOf(MailAccessError);
    expect((await openMailbox(amy, toKey("ms:office@kaj.com"), "triage")).perms.triage).toBe(true);
    expect((await openMailbox(bro, toKey("ms:bro@kaj.com"), "send")).perms.send).toBe(true);
    // The refreshed token's scopes were recorded on the connection.
    const office = (await listConnections("microsoft")).find((c) => c.account === "office@kaj.com")!;
    expect(office.meta.scopes).toEqual(["Mail.ReadWrite", "Mail.Send"]);
  });

  it("the attachment route checks access on every request and serves downloads only", async () => {
    const url = (mb: string) => new Request(`http://localhost/api/mail/attachment?mb=${toKey(mb)}&m=${toKey("M1")}&a=${toKey("A1")}`);
    auth.user = null;
    expect((await attachmentRoute(url("ms:office@kaj.com"))).status).toBe(401);
    auth.user = { ...amy, hasTotp: true, name: "Amy", envOwner: false };
    expect((await attachmentRoute(url("ms:store@kaj.com"))).status).toBe(403);
    expect((await attachmentRoute(url("ms:bro@kaj.com"))).status).toBe(403);
    const ok = await attachmentRoute(url("ms:office@kaj.com"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/octet-stream");
    expect(ok.headers.get("content-disposition")).toMatch(/^attachment; filename="invoice.html"/);
    expect(ok.headers.get("content-security-policy")).toContain("sandbox");
    expect(await ok.text()).toBe("<b>x</b>");
    auth.user = { ...boss, hasTotp: true, name: "Boss", envOwner: true };
    expect((await attachmentRoute(url("ms:bro@kaj.com"))).status).toBe(403);
  });

  it("the send route: same origin, owner-only for shared mailboxes, audited without the body", async () => {
    const post = (fields: Record<string, string>, origin = "http://localhost") => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      return new Request("http://localhost/api/mail/send", { method: "POST", body: fd, headers: { origin, host: "localhost" } });
    };
    const fields = { mailbox: toKey("ms:office@kaj.com"), mode: "reply", message: toKey("M1"), to: "ama@x.com", subject: "Re: Hi", body: "Secret body text" };
    auth.user = { ...boss, hasTotp: true, name: "Boss", envOwner: true };
    expect((await sendRoute(post(fields, "https://evil.example"))).status).toBe(403);
    auth.user = { ...amy, hasTotp: true, name: "Amy", envOwner: false };
    const denied = await sendRoute(post(fields));
    expect(denied.status).toBe(400);
    expect((await denied.json()).error).toMatch(/Only the dashboard owner/);
    auth.user = { ...boss, hasTotp: true, name: "Boss", envOwner: true };
    const sent = await sendRoute(post(fields));
    expect(await sent.json()).toEqual({ ok: true });
    const log = await listAudit(10);
    const entry = log.find((e) => e.action === "mail.send")!;
    expect(entry).toMatchObject({ actor: "boss@kaj.com", target: "office@kaj.com" });
    expect(entry.detail).toMatchObject({ mailbox: "office@kaj.com", mode: "reply", to: ["ama@x.com"], subject: "Re: Hi" });
    expect(JSON.stringify(entry.detail)).not.toContain("Secret body");
    expect(log.find((e) => e.action === "mail.send_failed")).toBeUndefined();
    // Nobody sends from someone else's personal mailbox.
    expect(await sendMail(boss, toKey("ms:bro@kaj.com"), { mode: "new", to: [{ name: "", address: "a@x.com" }], cc: [], bcc: [], subject: "x", body: "y", attachments: [] })).toMatchObject({ ok: false });
    expect(sameOrigin(new Request("http://localhost/x", { method: "POST" }))).toBe(false);
  });
});
