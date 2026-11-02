import { requireSection } from "@/lib/server/auth";
import { aiEnabled } from "@/lib/server/ai";
import { Card, PageHeader, SYS, Tag } from "@/components/ui";
import { AskForm } from "@/components/ai/AskForm";

const SEES = ["Tasks", "Money", "Clients", "Sites", "Calendar", "Inbox", "Solar", "Cameras"];

export default async function AskPage() {
  await requireSection("ask");
  const enabled = aiEnabled();
  return (
    <>
      <PageHeader title="Ask the dashboard" subtitle="Questions about your tasks, money, clients, sites, calendar, inbox, solar and cameras, answered by Claude from the live data on this dashboard." />
      <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-8">
        <Card title="Ask" action={enabled ? "Claude · live data" : "Not configured"}>
          {!enabled && <p className="mb-4 rounded-[14px] bg-accent/10 px-4 py-3 text-[15px] text-ink"><b className="font-semibold text-cyan">Not set up yet.</b> An owner can add <code className="rounded-md bg-fill px-1.5 font-mono text-[12.5px] text-ink">ANTHROPIC_API_KEY</code> to the environment to turn on questions.</p>}
          <AskForm enabled={enabled} />
        </Card>
        <Card title="How it works">
          <div className="text-[13px] text-muted">Claude can see</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {SEES.map((x) => <Tag key={x} color={SYS.indigo}>{x}</Tag>)}
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">Each question sends a summary of the dashboard&apos;s current data (no passwords or tokens) to Anthropic&apos;s API. Answers can be wrong; check the source page before acting on money.</p>
        </Card>
      </div>
    </>
  );
}
