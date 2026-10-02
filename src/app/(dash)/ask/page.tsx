import { requireSection } from "@/lib/server/auth";
import { aiEnabled } from "@/lib/server/ai";
import { Card, PageHeader } from "@/components/ui";
import { AskForm } from "@/components/ai/AskForm";

export default async function AskPage() {
  await requireSection("ask");
  return (
    <>
      <PageHeader title="Ask the dashboard" subtitle="Questions about your tasks, money, clients, sites, calendar, inbox, solar and cameras, answered by Claude from the live data on this dashboard." />
      <Card>
        <AskForm enabled={aiEnabled()} />
      </Card>
      <p className="mt-4 text-xs text-muted">Each question sends a summary of the dashboard&apos;s current data (no passwords or tokens) to Anthropic&apos;s API. Answers can be wrong; check the source page before acting on money.</p>
    </>
  );
}
