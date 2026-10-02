import { requireSection } from "@/lib/server/auth";
import { getDashboard } from "@/lib/server/dashboard";
import { daysBetween, formatDate, relativeDays, today } from "@/lib/dates";
import { formatMoney, formatTotals, sumByCurrency, toInputAmount } from "@/lib/money";
import { OPEN_STAGES, type Deal, type DealStage } from "@/lib/server/store/pipeline";
import { Card, Empty, PageHeader, Tag, businessColor, type Accent } from "@/components/ui";
import { ArchiveClient, ClientForm, DealForm, DealMoves } from "@/components/pipeline";
import { ShareClient } from "@/components/ShareClient";
import { listPortals } from "@/lib/server/store/portals";
import { getConfig } from "@/lib/server/config";
import { inBusiness } from "@/lib/access";
import { STAGE_LABEL } from "@/lib/pipeline-labels";
import { FilterChip, Metrics, Monogram, SectionHead } from "@/components/treasury/ui";

const value = (d: Deal) => (d.valueMinor != null ? formatMoney(d.valueMinor, d.currency) : null);
const totals = (deals: Deal[]) => sumByCurrency(deals.filter((d) => d.valueMinor != null).map((d) => ({ currency: d.currency, amount: d.valueMinor! })));
const STAGE_ACCENT: Record<DealStage, Accent> = { lead: "cyan", proposal: "violet", negotiation: "pink", won: "emerald", lost: "cyan" };
const STAGE_COLOR: Record<string, string> = { lead: "#3fd0ff", proposal: "#a98bff", negotiation: "#ff5fd7", won: "#3df5a0" };
const short = (date: string) => formatDate(date).replace(/, \d{4}$/, "");

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ due?: string; archived?: string }> }) {
  const user = await requireSection("clients");
  const sp = await searchParams;
  const dueOnly = sp.due === "1";
  const showArchived = sp.archived === "1";
  const href = (o: { due?: boolean; archived?: boolean }) => {
    const q = new URLSearchParams();
    if (o.due ?? dueOnly) q.set("due", "1");
    if (o.archived ?? showArchived) q.set("archived", "1");
    const s = q.toString();
    return s ? `/clients?${s}` : "/clients";
  };
  const d = await getDashboard();
  const now = today();
  const { deals, clients } = d.records;
  const open = deals.filter((x) => OPEN_STAGES.includes(x.stage));
  const won = deals.filter((x) => x.stage === "won");
  const lost = deals.filter((x) => x.stage === "lost");
  const isDue = (x: Deal) => !!x.nextStepDue && daysBetween(now, x.nextStepDue) <= 0;
  const dueSoon = open.filter(isDue);
  const activeClients = clients.filter((c) => !c.archived);
  const archivedClients = clients.filter((c) => c.archived);
  const shownClients = showArchived ? archivedClients : activeClients;
  const businesses = [...new Set([...clients.map((c) => c.business), ...deals.map((x) => x.business), ...d.openTasks.map((t) => t.business)].filter(Boolean))].sort() as string[];
  const openBusinesses = new Set(open.map((x) => x.business).filter(Boolean)).size;
  const clientOptions = activeClients.map((c) => ({ id: c.id, name: c.name }));
  const [portals, { sites }] = d.dbError ? [[], { sites: [] }] : await Promise.all([listPortals().catch(() => []), getConfig()]);
  const shareable = sites.filter((x) => inBusiness(user, x.business)).map((x) => x.domain);
  const hostOf = (url: string | null) => { try { return url ? new URL(url).hostname.replace(/^www\./, "") : null; } catch { return null; } };
  const draft = (x: Deal) => ({ id: x.id, clientId: x.clientId, title: x.title, value: x.valueMinor != null ? toInputAmount(x.valueMinor, x.currency) : "", currency: x.currency.toUpperCase(), stage: x.stage, expectedClose: x.expectedClose, nextStep: x.nextStep, nextStepDue: x.nextStepDue, business: x.business, notes: x.notes });

  // Funnel widths follow the main currency's value (count when nothing has a value).
  const mainCur = totals([...open, ...won])[0]?.currency;
  const stageValue = (list: Deal[]) => (mainCur ? list.filter((x) => x.currency === mainCur).reduce((n, x) => n + (x.valueMinor ?? 0), 0) : list.length);
  const funnel = [...OPEN_STAGES.map((s) => ({ key: s as string, label: STAGE_LABEL[s], list: open.filter((x) => x.stage === s) })), { key: "won", label: "Won · 90d", list: won }];

  return (
    <>
      <PageHeader title="Clients" subtitle="Your pipeline from first conversation to signed deal. Next steps show up on your to-do list when they're due." />
      <div className="-mt-2 mb-5 flex flex-wrap items-center justify-end gap-2">
        <FilterChip href={href({ due: false })} on={!dueOnly}>All deals</FilterChip>
        <FilterChip href={href({ due: true })} on={dueOnly}>Due follow-ups{dueSoon.length ? ` · ${dueSoon.length}` : ""}</FilterChip>
        <DealForm label="New deal" clients={clientOptions} businesses={businesses} />
      </div>

      <Card flush title="Pipeline" action={`${open.length} open deal${open.length === 1 ? "" : "s"} · ${activeClients.length} active client${activeClients.length === 1 ? "" : "s"}`}>
        <Metrics
          items={[
            { label: "Open pipeline", value: formatTotals(totals(open).slice(0, 1), { compact: true }), tone: "cyan", hint: `${open.length} deal${open.length === 1 ? "" : "s"}${openBusinesses > 1 ? ` across ${openBusinesses} businesses` : ""}${totals(open).length > 1 ? ` · + ${formatTotals(totals(open).slice(1), { compact: true })}` : ""}` },
            { label: "Follow-ups due", value: dueSoon.length, tone: dueSoon.length ? "high" : "ok", hint: dueSoon.length ? <span className="text-high">today or overdue</span> : "nothing due today" },
            { label: "Won · 90 days", value: formatTotals(totals(won).slice(0, 1), { compact: true }), tone: "emerald", hint: `${won.length} deal${won.length === 1 ? "" : "s"}` },
            { label: "Win rate · 90 days", value: won.length + lost.length ? `${Math.round((won.length / (won.length + lost.length)) * 100)}%` : "—", tone: "gold", hint: `${won.length} won, ${lost.length} lost` },
          ]}
        />
        {open.length + won.length > 0 && (
          <div className="grid grid-cols-2 gap-1.5 p-4 sm:flex sm:gap-1 sm:px-5" aria-label="Pipeline by stage">
            {funnel.map((f, i) => {
              const c = STAGE_COLOR[f.key];
              const v = stageValue(f.list);
              return (
                <div
                  key={f.key}
                  className={`min-w-0 px-3 py-2 sm:py-2.5 ${i === 0 ? "sm:[clip-path:polygon(0_0,calc(100%-12px)_0,100%_50%,calc(100%-12px)_100%,0_100%)]" : "sm:pl-6 sm:[clip-path:polygon(0_0,calc(100%-12px)_0,100%_50%,calc(100%-12px)_100%,0_100%,12px_50%)]"}`}
                  style={{ flex: Math.max(v, 1) + (mainCur ? Math.max(...funnel.map((x) => stageValue(x.list))) * 0.25 : 1), background: `linear-gradient(90deg, color-mix(in srgb, ${c} 35%, transparent), color-mix(in srgb, ${c} 12%, transparent))` }}
                >
                  <div className="hud-label truncate text-[11px]" style={{ color: c }}>{f.label} · {f.list.length}</div>
                  <div className="truncate font-mono text-sm tabular-nums">{formatTotals(totals(f.list), { compact: true })}</div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-3">
        {OPEN_STAGES.map((stage) => {
          const col = open.filter((x) => x.stage === stage && (!dueOnly || isDue(x)));
          return (
            <Card key={stage} flush accent={STAGE_ACCENT[stage]} title={<>{STAGE_LABEL[stage]} <span className="ml-1 font-mono text-muted">{col.length}</span></>} action={<span className="font-mono tracking-normal tabular-nums">{formatTotals(totals(col), { compact: true })}</span>}>
              {col.length === 0 ? <Empty>{dueOnly ? "No follow-ups due here." : "Nothing here."}</Empty> : (
                <ul>
                  {col.map((x) => {
                    const due = x.nextStepDue ? daysBetween(now, x.nextStepDue) : null;
                    const tone = !x.nextStep ? "warn" : due !== null && due < 0 ? "crit" : due === 0 ? "warn" : "ok";
                    const box = { crit: "border-critical bg-critical/10 text-[#ffc4d3]", warn: "border-high bg-high/10 text-[#ffd9a8]", ok: "border-cyan bg-cyan/5 text-ink" }[tone];
                    return (
                      <li key={x.id} className="border-b border-line/50 px-4 py-3.5 last:border-0 sm:px-5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="min-w-0 text-[15px] font-medium">{x.title}</span>
                          {value(x) && <span className="shrink-0 font-mono text-sm tabular-nums text-[#eaf7ff]">{value(x)}</span>}
                        </div>
                        <div className="mb-2 mt-0.5 text-xs text-muted">{[x.clientName, x.business, x.expectedClose && `close ${short(x.expectedClose)}`].filter(Boolean).join(" · ")}</div>
                        <div className={`flex items-center gap-2 border-l-2 px-2.5 py-1.5 text-[13px] ${box}`}>
                          {tone === "crit" && <span className="sr-only">Overdue:</span>}
                          <span className="min-w-0 flex-1">{x.nextStep ? `Next: ${x.nextStep}` : "No next step"}</span>
                          {x.nextStep && x.nextStepDue && <em className="shrink-0 font-mono text-[11px] not-italic">{due! < 0 ? `${-due!} day${due === -1 ? "" : "s"} late` : due! <= 7 ? relativeDays(due!) : short(x.nextStepDue)}</em>}
                        </div>
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                          <DealMoves id={x.id} stage={x.stage} title={x.title} />
                          <DealForm label="Edit" deal={draft(x)} clients={clientOptions} businesses={businesses} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      {won.length + lost.length > 0 && (
        <Card flush accent="lime" className="mt-5" title="Closed in the last 90 days" action={`${won.length} won · ${lost.length} lost`}>
          <ul>
            {[...won, ...lost].sort((a, b) => (b.closedOn ?? "").localeCompare(a.closedOn ?? "")).map((x) => (
              <li key={x.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-2 border-b border-line/50 px-4 py-2.5 text-[13px] last:border-0 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] sm:px-5">
                {x.stage === "won" ? <Tag color="#3df5a0">Won</Tag> : <Tag>Lost</Tag>}
                <span className={`min-w-0 ${x.stage === "won" ? "" : "text-muted"}`}>{x.title}{x.clientName ? <span className="text-muted"> · {x.clientName}</span> : null}</span>
                <span className={`font-mono tabular-nums ${x.stage === "won" ? "" : "text-muted"}`}>{value(x) ?? ""}</span>
                <span className="text-muted max-sm:hidden">{x.closedOn ? short(x.closedOn) : ""}</span>
                <div className="col-span-full flex justify-end sm:col-span-1"><DealMoves id={x.id} stage={x.stage} title={x.title} /></div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <SectionHead title={`Clients · ${shownClients.length}`}>
        <FilterChip href={href({ archived: false })} on={!showArchived}>Active</FilterChip>
        <FilterChip href={href({ archived: true })} on={showArchived}>Archived{archivedClients.length ? ` · ${archivedClients.length}` : ""}</FilterChip>
        <ClientForm businesses={businesses} />
      </SectionHead>
      <Card flush accent="teal">
        {shownClients.length === 0 ? <Empty>{showArchived ? "No archived clients." : "Add the people and companies you work with."}</Empty> : (
          <ul>
            {shownClients.map((c) => {
              const theirs = deals.filter((x) => x.clientId === c.id);
              const openValue = totals(theirs.filter((x) => OPEN_STAGES.includes(x.stage)));
              const p = portals.find((x) => x.clientId === c.id);
              const host = hostOf(c.website);
              return (
                <li key={c.id} className={`flex flex-wrap items-center gap-x-1.5 gap-y-2 border-b border-line/50 px-4 py-3.5 last:border-0 sm:px-5 ${c.archived ? "opacity-50" : ""}`}>
                  <span className="mr-2.5"><Monogram name={c.name} size="md" color={c.archived ? "#7f97ab" : businessColor(c.name)} /></span>
                  <div className="mr-3 min-w-0 flex-1 basis-56">
                    <div className="text-[15px] font-medium">{c.website ? <a href={c.website} target="_blank" rel="noreferrer" className="hover:text-cyan">{c.name}</a> : c.name}{c.archived && <span className="ml-2 text-xs text-muted">(archived)</span>}</div>
                    <div className="break-words text-xs text-muted">
                      {[c.contactName, c.email && <a key="e" href={`mailto:${c.email}`} className="hover:text-cyan">{c.email}</a>, c.phone, c.business].filter(Boolean).map((v, i) => <span key={i}>{i ? " · " : ""}{v}</span>)}
                    </div>
                  </div>
                  <div className="mr-auto text-[13px] max-lg:basis-full lg:mr-3 lg:w-52">{theirs.length} deal{theirs.length === 1 ? "" : "s"}{openValue.length ? <> · <b className="font-mono font-medium tabular-nums text-[#eaf7ff]">{formatTotals(openValue)}</b> open</> : ""}</div>
                  <ClientForm label="Edit" businesses={businesses} client={{ id: c.id, name: c.name, contactName: c.contactName, email: c.email, phone: c.phone, website: c.website, business: c.business, notes: c.notes }} />
                  <ArchiveClient id={c.id} archived={c.archived} />
                  {!c.archived && !d.dbError && <ShareClient clientId={c.id} clientName={c.name} sites={shareable} suggested={host ? shareable.filter((x) => x === host || x.endsWith(`.${host}`)) : []} active={p ? { id: p.id, sites: p.sites, showProjects: p.showProjects, createdAt: p.createdAt, lastViewedAt: p.lastViewedAt } : null} />}
                  {p && !c.archived && (
                    <div className="flex basis-full flex-wrap items-center gap-2 text-xs text-muted sm:pl-[54px]">
                      <Tag color="#3df5a0">Live link</Tag>
                      {p.sites.length ? p.sites.join(", ") : "no sites"}{p.showProjects ? " + projects" : ""} · {p.lastViewedAt ? `last opened ${short(p.lastViewedAt.slice(0, 10))}` : "not opened yet"}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
