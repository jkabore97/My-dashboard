import { getSnapshot } from "@/lib/aggregate";
import { Card, ModePill, PageHeader } from "@/components/ui";

export default async function PlatformsPage() {
  const s = await getSnapshot();
  const errors = Object.fromEntries(s.sources.map((x) => [x.source, x.error]));
  return (
    <>
      <PageHeader title="Platforms" subtitle="Everything Kaj Consulting is connected to. Set the listed environment variables to go live." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {s.platforms.map((p) => (
          <Card key={p.id} title={p.name} action={<ModePill mode={p.available ? p.mode : "planned"} />}>
            <div className="text-xs uppercase tracking-wider text-muted">{p.category}</div>
            {p.note && <p className="mt-1 text-sm text-muted">{p.note}</p>}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {p.envKeys.map((k) => <code key={k} className="rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-muted">{k}</code>)}
            </div>
            {errors[p.name] && <p className="mt-3 text-xs text-critical">{errors[p.name]}</p>}
            {p.docsUrl !== "#" && <a href={p.docsUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-accent hover:underline">{p.available ? "Get a key →" : "Developer docs →"}</a>}
          </Card>
        ))}
      </div>
    </>
  );
}
