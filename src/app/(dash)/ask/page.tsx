import { requireSection } from "@/lib/server/auth";
import { aiEnabled } from "@/lib/server/ai";
import { Card, PageHeader } from "@/components/ui";
import { AskForm } from "@/components/ai/AskForm";

const SEES = ["Tasks", "Money", "Clients", "Sites", "Calendar", "Inbox", "Solar", "Cameras"];

export default async function AskPage() {
  await requireSection("ask");
  const enabled = aiEnabled();
  return (
    <>
      <PageHeader title="Ask the dashboard" subtitle="Questions about your tasks, money, clients, sites, calendar, inbox, solar and cameras, answered by Claude from the live data on this dashboard." />
      <div className="grid items-start gap-4 lg:gap-[22px] xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card title="Ask" accent="cyan" action={enabled ? "Claude · live data" : "not configured"}>
          {!enabled && <p className="mb-4 text-sm text-muted">Claude isn&apos;t set up on this dashboard yet. An owner can add <code className="bg-cyan/10 px-1 font-mono text-xs text-cyan">ANTHROPIC_API_KEY</code> to the environment to turn on questions.</p>}
          <AskForm enabled={enabled} />
        </Card>
        <Card title="How it works" accent="violet">
          <div className="flex flex-wrap gap-1.5">
            {SEES.map((x) => <span key={x} className="hud-cut border border-violet/40 bg-violet/10 px-2 py-0.5 font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-[#d9ccff]">{x}</span>)}
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">Each question sends a summary of the dashboard&apos;s current data (no passwords or tokens) to Anthropic&apos;s API. Answers can be wrong; check the source page before acting on money.</p>
        </Card>
      </div>
    </>
  );
}
