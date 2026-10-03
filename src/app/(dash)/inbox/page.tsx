import Link from "next/link";
import { ChevronLeft, ChevronRight, Flag, Paperclip, PenSquare, Search, X } from "lucide-react";
import { requireSection } from "@/lib/server/auth";
import { getDashboard } from "@/lib/server/dashboard";
import { aiEnabled } from "@/lib/server/ai";
import { getPrefs } from "@/lib/server/alerts/store";
import { businessTimeZone } from "@/lib/dates";
import { errorMessage } from "@/lib/source";
import { isFullOwner } from "@/lib/access";
import { canSendFrom, toKey } from "@/lib/mail/access";
import type { MailFolder, MailPage, WellKnownFolder } from "@/lib/mail/types";
import { defaultFolder, listFolders, listMessages, MailAccessError, mailboxesFor, messageHref, openMailbox, validFolderId, wellKnownId, type OpenMailbox } from "@/lib/server/mail";
import { Card, Empty, PageHeader, btn } from "@/components/ui";
import { Chip, ChipRow, ab } from "@/components/command/hud";
import { ProviderMark, ReconnectNotice } from "@/components/mail/bits";
import { TriageView } from "@/components/mail/TriageView";
import { listQuery, mailDate, personName } from "@/components/mail/format";

const ORDER: WellKnownFolder[] = ["inbox", "sent", "drafts", "archive", "junk", "deleted"];
const LABEL: Record<WellKnownFolder, string> = { inbox: "Inbox", sent: "Sent", drafts: "Drafts", archive: "Archive", junk: "Junk", deleted: "Deleted" };

type Params = Record<string, string | string[] | undefined>;

export default async function InboxPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireSection("inbox");
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const [mailboxes, s, prefs] = await Promise.all([mailboxesFor(user).catch(() => []), getDashboard(), getPrefs(user.email).catch(() => null)]);
  const tz = prefs?.timeZone ?? businessTimeZone();
  const ai = aiEnabled() && s.modes.inbox === "live";
  const triage = one("view") === "triage" || mailboxes.length === 0;
  const current = triage ? null : (mailboxes.find((m) => m.key === one("mb")) ?? mailboxes[0]);
  const byId = new Map(mailboxes.map((m) => [m.id, m]));
  const sent = one("sent");

  const header = (
    <PageHeader
      mode={triage ? s.modes.inbox : undefined}
      title="Inbox"
      subtitle={triage ? `The last 14 days of every mailbox you can see${s.emails.some((e) => e.owner) ? ", plus your own (private to you)," : ""} ranked by urgency${ai ? " and read by Claude" : ""}.` : current?.owner ? "Your own mailbox: private to you." : `${current?.business ? `${current.business} · ` : ""}connected on Platforms · only full owners see it.`}
    >
      {current && canSendFrom(user, user.email, current) && (
        <Link href={`/inbox/m/${current.key}/new`} className={`${btn("solid")} inline-flex min-h-10 items-center gap-1.5 [--b:#ff5fd7] sm:min-h-0`}><PenSquare size={14} />New message</Link>
      )}
      <Link href="/settings#my-mail" className="inline-flex min-h-10 items-center text-xs text-cyan hover:underline sm:min-h-0">My mailbox ›</Link>
    </PageHeader>
  );

  const mailboxRow = mailboxes.length > 0 && (
    <div className="mb-4">
      <ChipRow label="Mailbox">
        <Chip href="/inbox?view=triage" active={triage}>Triage · 14 days</Chip>
        {mailboxes.map((m) => (
          <Chip key={m.key} href={`/inbox?mb=${m.key}`} active={current?.key === m.key}>
            <ProviderMark mailbox={m} />
            <span className="font-sans normal-case tracking-normal">{m.label}</span>
            {m.owner && <span className="border border-cyan/40 px-1 text-[9.5px] text-cyan">Mine</span>}
          </Chip>
        ))}
      </ChipRow>
    </div>
  );

  const sentBanner = sent && (
    <p role="status" className="mb-4 border-l-2 border-emerald bg-emerald/10 px-3 py-2 text-[13px] text-[#c9ffe6]">
      {sent === "demo" ? "Sample mailbox: the message was filed under Sent, nothing left this computer." : "✓ Message sent."}
    </p>
  );

  if (triage || !current) {
    return (
      <>
        {header}
        {sentBanner}
        {mailboxRow}
        <TriageView
          emails={s.emails}
          account={one("account")}
          ai={ai}
          hrefFor={(e) => (byId.has(e.mailbox) ? messageHref(e) : null)}
          canReply={(e) => {
            const m = byId.get(e.mailbox);
            return !!m && canSendFrom(user, user.email, m);
          }}
        />
      </>
    );
  }

  const folder = one("f") && validFolderId(current.provider, one("f")!) ? one("f")! : defaultFolder(current.provider);
  const q = (one("q") ?? "").trim().slice(0, 200);
  const unread = one("unread") === "1";
  const cursor = one("c") ?? null;

  let o: OpenMailbox | null = null;
  let error: string | null = null;
  try {
    o = await openMailbox(user, current.key, "read");
  } catch (err) {
    error = err instanceof MailAccessError ? err.message : `Couldn't open ${current.address}: ${errorMessage(err)}`;
  }
  const [folders, page] = o
    ? await Promise.all([
        listFolders(o).catch(() => null),
        listMessages(o, { folder, search: q || null, unread, cursor }).catch((err): MailPage | string => errorMessage(err)),
      ])
    : [null, null];
  if (typeof page === "string") error = page;

  const known: MailFolder[] = folders?.filter((f) => f.wellKnown) ?? ORDER.map((k) => ({ id: wellKnownId(current.provider, k), name: LABEL[k], unread: null, total: null, wellKnown: k }));
  const others = folders?.filter((f) => !f.wellKnown) ?? [];
  const folderName = [...known, ...others].find((f) => f.id === folder)?.name ?? "Folder";
  const sentLike = known.some((f) => f.id === folder && (f.wellKnown === "sent" || f.wellKnown === "drafts"));
  const base = { mb: current.key, f: folder === defaultFolder(current.provider) ? undefined : folder };
  const here = listQuery({ ...base, q, unread, c: cursor });
  const items = page && typeof page !== "string" ? page.items : [];

  return (
    <>
      {header}
      {sentBanner}
      {mailboxRow}
      {o?.perms.reconnect && (
        <div className="mb-4">
          <ReconnectNotice mailbox={current} canReconnect={current.owner ? current.owner === user.email : isFullOwner(user)} />
        </div>
      )}

      <div className="mb-3">
        <ChipRow label="Folder">
          {known.map((f) => (
            <Chip key={f.id} href={`/inbox?${listQuery({ mb: current.key, f: f.id === defaultFolder(current.provider) ? undefined : f.id })}`} active={f.id === folder} count={f.unread ? f.unread : undefined}>
              {f.name}
            </Chip>
          ))}
          {others.length > 0 && (
            <details className="relative shrink-0">
              <summary className={`inline-flex min-h-10 cursor-pointer list-none items-center gap-1.5 border px-3 font-display text-[12px] font-semibold uppercase tracking-[0.12em] sm:min-h-0 sm:py-1.5 ${others.some((f) => f.id === folder) ? "border-[var(--ga,#3fd0ff)] text-[var(--ga,#3fd0ff)]" : "border-line text-muted hover:text-ink"}`}>
                {others.find((f) => f.id === folder)?.name ?? "More folders"} ▾
              </summary>
              <div className="hud-panel absolute left-0 z-20 mt-1 max-h-[60vh] w-[min(280px,80vw)] overflow-y-auto">
                {others.map((f) => (
                  <Link key={f.id} href={`/inbox?${listQuery({ mb: current.key, f: f.id })}`} className={`flex min-h-10 items-center justify-between gap-2 border-b border-line/50 px-3 text-[13px] last:border-0 hover:bg-cyan/5 ${f.id === folder ? "text-cyan" : ""}`}>
                    <span className="min-w-0 truncate">{f.name}</span>
                    {f.unread ? <span className="font-mono text-[11px] text-cyan">{f.unread}</span> : null}
                  </Link>
                ))}
              </div>
            </details>
          )}
        </ChipRow>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form action="/inbox" className="flex min-w-0 flex-1 basis-[260px] gap-2" role="search">
          <input type="hidden" name="mb" value={current.key} />
          {base.f && <input type="hidden" name="f" value={base.f} />}
          {unread && <input type="hidden" name="unread" value="1" />}
          <input name="q" defaultValue={q} placeholder={`Search ${folderName.toLowerCase()}`} aria-label="Search mail" className="hud-input min-h-10 min-w-0 flex-1 px-3 text-base sm:text-sm" />
          <button type="submit" className={`${ab} min-h-10 justify-center sm:min-h-10`} aria-label="Search"><Search size={14} /><span className="hidden sm:inline">Search</span></button>
        </form>
        <Chip href={`/inbox?${listQuery({ ...base, q, unread: !unread })}`} active={unread}>Unread only</Chip>
        {q && <Link href={`/inbox?${listQuery({ ...base, unread })}`} className={ab}><X size={13} />Clear search</Link>}
      </div>

      <Card
        title={<span className="flex min-w-0 items-center gap-2"><ProviderMark mailbox={current} /><span className="truncate">{folderName}{q ? ` · “${q}”` : ""}</span></span>}
        accent="pink"
        flush
        action={o ? `${current.address}${cursor ? " · older" : ""}` : current.address}
      >
        {error ? (
          <p className="px-4 py-6 text-[13.5px] text-[#ffc2d1] sm:px-5">{error}</p>
        ) : items.length === 0 ? (
          <Empty>{q ? "No messages match." : unread ? "No unread messages here." : "This folder is empty."}</Empty>
        ) : (
          <ul>
            {items.map((m) => {
              const who = sentLike ? `To: ${m.to.map(personName).join(", ") || "(no recipients)"}` : personName(m.from) || "(unknown sender)";
              return (
                <li key={m.id} className="border-b border-line/50 last:border-0">
                  <Link href={`/inbox/m/${current.key}/${toKey(m.id)}?${here}`} prefetch={false} className="grid min-h-[60px] grid-cols-[8px_minmax(0,1fr)] gap-x-3 px-4 py-3 transition hover:bg-cyan/5 sm:px-5">
                    <span className={`mt-1.5 h-2 w-2 rounded-full ${m.unread ? "bg-cyan shadow-[0_0_8px_#3fd0ff]" : ""}`} aria-label={m.unread ? "Unread" : undefined} />
                    <div className="min-w-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className={`min-w-0 truncate text-[14px] ${m.unread ? "font-semibold text-[#f2faff]" : "text-[#c5d3de]"}`}>{who}</span>
                        <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-muted">{mailDate(m.receivedAt, tz)}</span>
                      </div>
                      <div className="flex min-w-0 items-center gap-1.5">
                        {m.draft && <span className="shrink-0 font-display text-[10.5px] uppercase tracking-[0.1em] text-high">Draft</span>}
                        <span className={`min-w-0 truncate text-[13.5px] ${m.unread ? "text-[#e3eef6]" : "text-[#9fb2c2]"}`}>{m.subject}</span>
                        {m.important && <span className="shrink-0 text-[12px] font-bold text-high" title="High importance">!</span>}
                        {m.hasAttachments && <Paperclip size={12} className="shrink-0 text-muted" aria-label="Has attachments" />}
                        {m.flagged && <Flag size={12} className="shrink-0 text-gold" aria-label="Flagged" />}
                      </div>
                      <div className="truncate text-[12.5px] text-[#7f97ab]">{m.preview}</div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {(cursor || (page && typeof page !== "string" && page.next)) && (
          <nav className="flex items-center justify-between gap-2 border-t border-line/60 px-4 py-3 sm:px-5" aria-label="Pages">
            {cursor ? <Link href={`/inbox?${listQuery({ ...base, q, unread })}`} className={ab}><ChevronLeft size={14} />Newest</Link> : <span />}
            {page && typeof page !== "string" && page.next ? <Link href={`/inbox?${listQuery({ ...base, q, unread, c: page.next })}`} className={ab}>Older<ChevronRight size={14} /></Link> : null}
          </nav>
        )}
      </Card>
    </>
  );
}
