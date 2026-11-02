import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, Flag, Paperclip, PenSquare, Search, X } from "lucide-react";
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
import { Empty, PageHeader, btn } from "@/components/ui";
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
        <Link href={`/inbox/m/${current.key}/new`} className={`${btn("solid")} min-h-10 rounded-full px-4`}><PenSquare size={15} />New message</Link>
      )}
      <Link href="/settings#my-mail" className={btn("plain")}>My mailbox</Link>
    </PageHeader>
  );

  const mailboxRow = mailboxes.length > 0 && (
    <div className="mb-4">
      <ChipRow label="Mailbox">
        <Chip href="/inbox?view=triage" active={triage}>Triage · 14 days</Chip>
        {mailboxes.map((m) => (
          <Chip key={m.key} href={`/inbox?mb=${m.key}`} active={current?.key === m.key}>
            <ProviderMark mailbox={m} />
            <span>{m.label}</span>
            {m.owner && <span className={`text-[12px] font-semibold ${current?.key === m.key ? "opacity-70" : "text-cyan"}`}>Mine</span>}
          </Chip>
        ))}
      </ChipRow>
    </div>
  );

  const sentBanner = sent && (
    <p role="status" className="mb-4 rounded-[14px] bg-ok/10 px-4 py-3 text-[15px] text-ink">
      <b className="font-semibold text-ok">{sent === "demo" ? "Filed under Sent." : "Sent ✓"}</b>{" "}
      {sent === "demo" ? "Sample mailbox: nothing left this computer." : "Your message is on its way."}
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
              <summary className={`inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[14px] font-medium transition [&::-webkit-details-marker]:hidden ${others.some((f) => f.id === folder) ? "bg-ink text-bg" : "bg-panel text-ink shadow-[0_0_0_1px_var(--color-line)] hover:bg-panel-2"}`}>
                {others.find((f) => f.id === folder)?.name ?? "More folders"}
                <ChevronDown size={14} className="opacity-60" />
              </summary>
              <div className="absolute left-0 z-20 mt-1.5 max-h-[60vh] w-[min(280px,80vw)] overflow-y-auto rounded-[14px] bg-panel shadow-[0_10px_40px_rgb(0_0_0/0.18),0_0_0_1px_var(--color-line)]">
                {others.map((f) => (
                  <Link key={f.id} href={`/inbox?${listQuery({ mb: current.key, f: f.id })}`} className={`flex min-h-11 items-center justify-between gap-2 border-b border-line px-4 text-[15px] last:border-0 hover:bg-fill ${f.id === folder ? "font-semibold text-cyan" : "text-ink"}`}>
                    <span className="min-w-0 truncate">{f.name}</span>
                    {f.unread ? <span className="text-[13px] tabular-nums text-muted">{f.unread}</span> : null}
                  </Link>
                ))}
              </div>
            </details>
          )}
        </ChipRow>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form action="/inbox" className="relative flex min-w-0 flex-1 basis-[260px] items-center" role="search">
          <input type="hidden" name="mb" value={current.key} />
          {base.f && <input type="hidden" name="f" value={base.f} />}
          {unread && <input type="hidden" name="unread" value="1" />}
          <Search size={16} className="pointer-events-none absolute left-3 text-muted" aria-hidden />
          <input name="q" defaultValue={q} placeholder={`Search ${folderName.toLowerCase()}`} aria-label="Search mail" className="hud-input min-h-10 min-w-0 flex-1 bg-fill pl-9 pr-20 text-base placeholder:text-muted sm:text-[15px]" />
          <button type="submit" className="absolute right-1 min-h-8 rounded-[8px] px-3 text-[15px] text-cyan hover:bg-fill" aria-label="Search">Search</button>
        </form>
        <Chip href={`/inbox?${listQuery({ ...base, q, unread: !unread })}`} active={unread}>Unread only</Chip>
        {q && <Link href={`/inbox?${listQuery({ ...base, unread })}`} className={ab}><X size={13} />Clear search</Link>}
      </div>

      <section className="overflow-hidden rounded-[14px] bg-panel shadow-[0_0_0_1px_var(--color-line)]">
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-3 sm:px-5">
          <h2 className="flex min-w-0 items-center gap-2 text-[17px] font-semibold text-ink"><ProviderMark mailbox={current} /><span className="truncate">{folderName}{q ? ` · “${q}”` : ""}</span></h2>
          <span className="min-w-0 truncate text-[13px] text-muted">{o ? `${current.address}${cursor ? " · older" : ""}` : current.address}</span>
        </header>
        {error ? (
          <p className="px-4 py-6 text-[15px] text-critical sm:px-5">{error}</p>
        ) : items.length === 0 ? (
          <Empty>{q ? "No messages match." : unread ? "No unread messages here ✓" : "This folder is empty."}</Empty>
        ) : (
          <ul className="[&>li+li>a>div]:border-t [&>li+li>a>div]:border-line">
            {items.map((m) => {
              const who = sentLike ? `To: ${m.to.map(personName).join(", ") || "(no recipients)"}` : personName(m.from) || "(unknown sender)";
              return (
                <li key={m.id}>
                  <Link href={`/inbox/m/${current.key}/${toKey(m.id)}?${here}`} prefetch={false} className="flex min-h-[72px] gap-2.5 pl-2.5 transition-colors hover:bg-fill active:bg-fill sm:pl-3">
                    <span className="mt-[19px] flex w-3 shrink-0 justify-center self-start" aria-label={m.unread ? "Unread" : undefined}>
                      {m.unread && <span className="h-2.5 w-2.5 rounded-full bg-cyan" />}
                    </span>
                    <div className="min-w-0 flex-1 py-3 pr-4 sm:pr-5">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className={`min-w-0 truncate text-[15px] text-ink ${m.unread ? "font-semibold" : "font-medium"}`}>{who}</span>
                        <span className="flex shrink-0 items-center gap-1 text-[13px] tabular-nums text-muted">
                          {m.flagged && <Flag size={12} className="fill-current text-high" aria-label="Flagged" />}
                          {m.hasAttachments && <Paperclip size={12} aria-label="Has attachments" />}
                          {mailDate(m.receivedAt, tz)}
                          <ChevronRight size={14} className="text-low/60" aria-hidden />
                        </span>
                      </div>
                      <div className="flex min-w-0 items-center gap-1.5">
                        {m.draft && <span className="shrink-0 text-[14px] font-medium text-warn">Draft</span>}
                        {m.important && <span className="shrink-0 text-[14px] font-bold text-warn" title="High importance">!</span>}
                        <span className="min-w-0 truncate text-[14px] text-ink">{m.subject}</span>
                      </div>
                      <div className="line-clamp-2 text-[14px] leading-snug text-muted">{m.preview}</div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {(cursor || (page && typeof page !== "string" && page.next)) && (
          <nav className="flex items-center justify-between gap-2 border-t border-line px-4 py-3 sm:px-5" aria-label="Pages">
            {cursor ? <Link href={`/inbox?${listQuery({ ...base, q, unread })}`} className={ab}><ChevronLeft size={14} />Newest</Link> : <span />}
            {page && typeof page !== "string" && page.next ? <Link href={`/inbox?${listQuery({ ...base, q, unread, c: page.next })}`} className={ab}>Older<ChevronRight size={14} /></Link> : null}
          </nav>
        )}
      </section>
    </>
  );
}
