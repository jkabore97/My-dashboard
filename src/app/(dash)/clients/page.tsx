import { getDashboard } from "@/lib/server/dashboard";
import { daysBetween, formatDate, relativeDays, today } from "@/lib/dates";
import { formatMoney, formatTotals, sumByCurrency, toInputAmount } from "@/lib/money";
import { OPEN_STAGES, type Deal } from "@/lib/server/store/pipeline";
import { Card, Empty, PageHeader, Stat } from "@/components/ui";
import { ArchiveClient, ClientForm, DealForm, DealMoves } from "@/components/pipeline";
import { STAGE_LABEL } from "@/lib/pipeline-labels";

const value = (d: Deal) => (d.valueMinor != null ? formatMoney(d.valueMinor, d.currency) : null);
const totals = (deals: Deal[]) => sumByCurrency(deals.filter((d) => d.valueMinor != null).map((d) => ({ currency: d.currency, amount: d.valueMinor! })));

export default async function ClientsPage() {
  const d = await getDashboard();
  const now = today();
  const { deals, clients } = d.records;
  const open = deals.filter((x) => OPEN_STAGES.includes(x.stage));
  const won = deals.filter((x) => x.stage === "won");
  const lost = deals.filter((x) => x.stage === "lost");
  const dueSoon = open.filter((x) => x.nextStepDue && daysBetween(now, x.nextStepDue) <= 0);
  const activeClients = clients.filter((c) => !c.archived);
  const businesses = [...new Set([...clients.map((c) => c.business), ...deals.map((x) => x.business), ...d.openTasks.map((t) => t.business)].filter(Boolean))].sort() as string[];
  const clientOptions = activeClients.map((c) => ({ id: c.id, name: c.name }));
  const draft = (x: Deal) => ({ id: x.id, clientId: x.clientId, title: x.title, value: x.valueMinor != null ? toInputAmount(x.valueMinor, x.currency) : "", currency: x.currency.toUpperCase(), stage: x.stage, expectedClose: x.expectedClose, nextStep: x.nextStep, nextStepDue: x.nextStepDue, business: x.business, notes: x.notes });

  return (
    <>
      <PageHeader title="Clients" subtitle="Your pipeline from first conversation to signed deal. Next steps show up on your to-do list when they're due.">
        <DealForm clients={clientOptions} businesses={businesses} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Open pipeline" value={formatTotals(totals(open).slice(0, 1), { compact: true })} hint={`${open.length} deal${open.length === 1 ? "" : "s"}`} />
        <Stat label="Follow-ups due" value={dueSoon.length} tone={dueSoon.length ? "high" : "ok"} hint="today or overdue" />
        <Stat label="Won (90 days)" value={formatTotals(totals(won).slice(0, 1), { compact: true })} tone="ok" hint={`${won.length} deal${won.length === 1 ? "" : "s"}`} />
        <Stat label="Win rate (90 days)" value={won.length + lost.length ? `${Math.round((won.length / (won.length + lost.length)) * 100)}%` : "—"} hint={`${won.length} won, ${lost.length} lost`} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {OPEN_STAGES.map((stage) => {
          const col = open.filter((x) => x.stage === stage);
          return (
            <Card key={stage} title={<span>{STAGE_LABEL[stage]} <span className="text-muted">{col.length}</span></span>} action={<span className="text-xs tabular-nums text-muted">{formatTotals(totals(col), { compact: true })}</span>}>
              {col.length === 0 ? <Empty>Nothing here.</Empty> : (
                <ul className="-my-2 divide-y divide-line">
                  {col.map((x) => {
                    const due = x.nextStepDue ? daysBetween(now, x.nextStepDue) : null;
                    return (
                      <li key={x.id} className="space-y-1.5 py-3">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium">{x.title}</span>
                          {value(x) && <span className="shrink-0 text-sm tabular-nums">{value(x)}</span>}
                        </div>
                        <div className="text-xs text-muted">{[x.clientName, x.business, x.expectedClose && `close ${formatDate(x.expectedClose)}`].filter(Boolean).join(" · ")}</div>
                        {x.nextStep ? (
                          <div className={`text-xs ${due !== null && due < 0 ? "text-critical" : due === 0 ? "text-high" : "text-ink"}`}>Next: {x.nextStep}{x.nextStepDue ? ` (${relativeDays(due!)})` : ""}</div>
                        ) : (
                          <div className="text-xs text-high">No next step</div>
                        )}
                        <div className="flex flex-wrap items-center gap-1">
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
        <Card className="mt-6" title="Closed in the last 90 days">
          <ul className="-my-2 divide-y divide-line text-sm">
            {[...won, ...lost].sort((a, b) => (b.closedOn ?? "").localeCompare(a.closedOn ?? "")).map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span><span className={x.stage === "won" ? "text-ok" : "text-muted"}>{STAGE_LABEL[x.stage]}</span> · {x.title}{x.clientName ? <span className="text-muted"> · {x.clientName}</span> : null}{value(x) ? <span className="tabular-nums"> · {value(x)}</span> : null}<span className="text-xs text-muted"> · {x.closedOn ? formatDate(x.closedOn) : ""}</span></span>
                <DealMoves id={x.id} stage={x.stage} title={x.title} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <h2 className="mb-3 mt-10 flex flex-wrap items-center justify-between gap-3 text-sm font-semibold uppercase tracking-wider text-muted">
        <span>Clients</span>
        <span className="normal-case tracking-normal"><ClientForm businesses={businesses} /></span>
      </h2>
      <Card>
        {clients.length === 0 ? <Empty>Add the people and companies you work with.</Empty> : (
          <ul className="-my-2 divide-y divide-line">
            {clients.map((c) => {
              const theirs = deals.filter((x) => x.clientId === c.id);
              const openValue = totals(theirs.filter((x) => OPEN_STAGES.includes(x.stage)));
              return (
                <li key={c.id} className={`flex flex-wrap items-start justify-between gap-3 py-3 ${c.archived ? "opacity-50" : ""}`}>
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="text-sm">{c.website ? <a href={c.website} target="_blank" rel="noreferrer" className="hover:text-accent">{c.name}</a> : c.name}{c.archived && <span className="ml-2 text-xs text-muted">(archived)</span>}</div>
                    <div className="text-xs text-muted">
                      {[c.contactName, c.email && <a key="e" href={`mailto:${c.email}`} className="hover:text-accent">{c.email}</a>, c.phone, c.business].filter(Boolean).map((v, i) => <span key={i}>{i ? " · " : ""}{v}</span>)}
                    </div>
                    <div className="text-xs text-muted">{theirs.length} deal{theirs.length === 1 ? "" : "s"}{openValue.length ? ` · ${formatTotals(openValue)} open` : ""}</div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <ClientForm label="Edit" businesses={businesses} client={{ id: c.id, name: c.name, contactName: c.contactName, email: c.email, phone: c.phone, website: c.website, business: c.business, notes: c.notes }} />
                    <ArchiveClient id={c.id} archived={c.archived} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
