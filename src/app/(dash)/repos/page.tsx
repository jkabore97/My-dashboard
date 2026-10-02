import { requireSection } from "@/lib/server/auth";
import { Lock } from "lucide-react";
import { getDashboard } from "@/lib/server/dashboard";
import { BizLabel, businessColor, Card, PageHeader, timeAgo } from "@/components/ui";
import { Attention, cell, FilterChips, HudTable, MeterStat, StatusWord, tasksAsAttention } from "@/components/web/hud";
import { commitHeatmap, languageCounts, weeklyTotals } from "@/components/web/logic";

const LANG: Record<string, string> = { TypeScript: "#3fd0ff", JavaScript: "#ffd84d", Python: "#3df5a0", Dart: "#a98bff", Go: "#2ef2d0", Rust: "#c6f432", HTML: "#ff5fd7", CSS: "#7aa2ff", Swift: "#e58bff", Kotlin: "#b4f0a0" };
const langColor = (l: string) => LANG[l] ?? businessColor(l);

function Lang({ name }: { name: string | null }) {
  if (!name) return <span className="text-muted">—</span>;
  const c = langColor(name);
  return <span className="inline-flex items-center gap-2 text-xs text-[#c5d3de]"><i className="h-2 w-2 shrink-0 rounded-full" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />{name}</span>;
}

function Activity({ weeks }: { weeks: number[] }) {
  if (!weeks.length) return <span className="text-xs text-muted">—</span>;
  const max = Math.max(1, ...weeks);
  return (
    <span className="flex h-5 w-[124px] items-end gap-[2px]" role="img" aria-label={`${weeks.reduce((a, b) => a + b, 0)} commits in ${weeks.length} weeks`}>
      {weeks.map((v, i) => <i key={i} title={`${v} commit${v === 1 ? "" : "s"}`} className="block flex-1" style={{ height: `${Math.max(8, (v / max) * 100)}%`, background: v ? "linear-gradient(180deg,#a98bff,rgb(169 139 255 / 0.45))" : "rgb(169 139 255 / 0.2)" }} />)}
    </span>
  );
}

export default async function ReposPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireSection("repos");
  const s = await getDashboard();
  const { show } = await searchParams;

  // CI failures arrive as tasks from GitHub's workflow_run webhook ("github-ci:<repo>:…").
  const ciFailing = new Set(s.openTasks.flatMap((t) => (t.sourceKey?.startsWith("github-ci:") ? [t.sourceKey.split(":")[1]] : [])));
  const filters = {
    all: () => true,
    private: (r: (typeof s.repos)[number]) => r.private,
    prs: (r: (typeof s.repos)[number]) => (r.openPullRequests ?? 0) > 0,
    ci: (r: (typeof s.repos)[number]) => ciFailing.has(r.fullName),
  };
  const key = (show && show in filters ? show : "all") as keyof typeof filters;
  const repos = s.repos.filter(filters[key]);

  const priv = s.repos.filter((r) => r.private).length;
  const prs = s.repos.reduce((n, r) => n + (r.openPullRequests ?? 0), 0);
  const prRepos = s.repos.filter((r) => (r.openPullRequests ?? 0) > 0).length;
  const issues = s.repos.reduce((n, r) => n + (r.openIssues ?? 0), 0);
  const issueRepos = s.repos.filter((r) => (r.openIssues ?? 0) > 0).length;
  const unknownPrs = s.repos.some((r) => r.openPullRequests == null);
  const heat = commitHeatmap(s.repos);
  const langs = languageCounts(s.repos);
  const langTotal = langs.reduce((n, l) => n + l.count, 0);
  const owners = [...new Set(s.repos.map((r) => r.fullName.split("/")[0]))];
  const attention = tasksAsAttention(s.openTasks, "repos");
  const hasRerun = s.openTasks.some((t) => t.fix === "Re-run failed jobs");

  // Heatmap colour steps relative to the busiest day.
  const peak = heat ? Math.max(1, ...heat.weeks.flatMap((w) => w.days)) : 1;
  const level = (v: number) => (v === 0 ? 0.07 : v / peak < 0.25 ? 0.3 : v / peak < 0.55 ? 0.55 : v / peak < 0.8 ? 0.78 : 1);
  const monthTicks = heat ? heat.weeks.map((w, i) => ({ i, m: new Date(`${w.weekStart}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short" }) })).filter((x, i, a) => i === 0 || a[i - 1].m !== x.m) : [];

  return (
    <>
      <PageHeader mode={s.modes.github} title="Repositories" subtitle={`${s.repos.length} active repos${owners.length === 1 ? ` for ${owners[0]}` : ""}, most recently pushed first.`}>
        <FilterChips base="/repos" active={key} items={[{ key: "all", label: "All", count: s.repos.length }, { key: "private", label: "Private", count: priv }, { key: "prs", label: "Open PRs", count: prRepos }, ...(ciFailing.size ? [{ key: "ci", label: "CI failing", count: ciFailing.size }] : [])]} />
      </PageHeader>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
        <MeterStat accent="violet" tone="violet" label="Repositories" value={s.repos.length} hint={`${priv} private · ${s.repos.length - priv} public`} />
        <MeterStat accent="gold" tone="gold" label="Open pull requests" value={prs} hint={`across ${prRepos} repo${prRepos === 1 ? "" : "s"}${unknownPrs ? " · some not counted" : ""}`} />
        <MeterStat accent="cyan" tone="cyan" label="Open issues" value={issues} hint={`across ${issueRepos} repo${issueRepos === 1 ? "" : "s"}`} />
        <MeterStat accent="emerald" tone={ciFailing.size ? "high" : "ok"} label="CI failing" value={ciFailing.size} hint="default branch · via GitHub webhooks" />
      </div>

      <Attention items={attention} foot={hasRerun ? "Re-run failed jobs acts on GitHub with your connected account, asks to confirm first, and is written to the audit log." : undefined} />

      <Card accent="violet" flush className="mb-5" title="All repositories" action="sorted by last push">
        {repos.length === 0 ? <p className="py-8 text-center text-sm text-muted">{s.repos.length ? "No repos match this filter." : "Connect GitHub on the Platforms page to list your repos."}</p> : (
          <HudTable head={[{ label: "Repo" }, { label: "Business", wide: true }, { label: "Language", wide: true }, { label: "Open PRs", wide: true, right: true }, { label: "Issues", wide: true, right: true }, { label: "Commits · 12 wk", wide: true }, { label: "Last push", right: true }]}>
            {repos.map((r) => {
              const [owner, name] = r.fullName.split("/");
              return (
                <tr key={r.id}>
                  <td className={cell()}>
                    <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 hover:text-violet md:min-h-0">
                      <span className="w-3 shrink-0">{r.private && <Lock size={12} className="text-muted" aria-label="Private" />}</span>
                      <span className="[overflow-wrap:anywhere]"><span className="hidden text-muted sm:inline">{owner}/</span><span className="font-medium text-[#eaf7ff]">{name}</span></span>
                    </a>
                    {ciFailing.has(r.fullName) && <span className="ml-5 block"><StatusWord kind="warn">CI failing</StatusWord></span>}
                    <span className="ml-5 block text-[11px] text-muted md:hidden">{[r.language, r.openPullRequests ? `${r.openPullRequests} PR${r.openPullRequests === 1 ? "" : "s"}` : null, r.openIssues ? `${r.openIssues} issue${r.openIssues === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td className={cell({ wide: true })}>{r.business ? <BizLabel name={r.business} /> : <span className="text-muted">—</span>}</td>
                  <td className={cell({ wide: true })}><Lang name={r.language} /></td>
                  <td className={`${cell({ wide: true, right: true })} font-mono text-xs tabular-nums ${r.openPullRequests ? "text-gold" : "text-muted"}`}>{r.openPullRequests ?? "—"}</td>
                  <td className={`${cell({ wide: true, right: true })} font-mono text-xs tabular-nums ${(r.openIssues ?? 0) >= 10 ? "text-high" : r.openIssues ? "text-ink" : "text-muted"}`}>{r.openIssues ?? "—"}</td>
                  <td className={cell({ wide: true })}><Activity weeks={weeklyTotals(r)} /></td>
                  <td className={`${cell({ right: true })} whitespace-nowrap text-xs text-muted`}>{timeAgo(r.pushedAt)}</td>
                </tr>
              );
            })}
          </HudTable>
        )}
      </Card>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card accent="cyan" title="Commit activity · 26 weeks" action={heat ? `${heat.total.toLocaleString()} commits · ${heat.repos} most recent repos` : undefined}>
          {heat ? (
            <>
              <div className="overflow-x-auto">
                <div className="grid min-w-[300px] gap-[3px]" style={{ gridTemplateColumns: `repeat(${heat.weeks.length}, minmax(0, 1fr))`, gridTemplateRows: "repeat(7, auto)", gridAutoFlow: "column" }} role="img" aria-label={`${heat.total} commits on default branches over ${heat.weeks.length} weeks`}>
                  {heat.weeks.flatMap((w) =>
                    w.days.map((v, d) => {
                      const a = level(v);
                      return <i key={`${w.weekStart}-${d}`} title={`Week of ${w.weekStart}, ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]}: ${v} commit${v === 1 ? "" : "s"}`} className="block aspect-square" style={{ background: `rgb(169 139 255 / ${a})`, boxShadow: a === 1 ? "0 0 6px rgb(169 139 255 / 0.7)" : undefined }} />;
                    }),
                  )}
                </div>
                <div className="relative mt-2 h-4 min-w-[300px] font-mono text-[10px] text-muted">
                  {monthTicks.map((t) => <span key={t.i} className="absolute" style={{ left: `${(t.i / heat.weeks.length) * 100}%` }}>{t.m}</span>)}
                </div>
              </div>
              <p className="mt-2 text-xs text-muted">Commits on each default branch, from GitHub&apos;s weekly stats for the {heat.repos} most recently pushed repos.</p>
            </>
          ) : <p className="py-6 text-center text-sm text-muted">GitHub hasn&apos;t returned activity stats yet (it computes them on first request). They appear on a later refresh.</p>}
        </Card>

        <Card accent="violet" title="Languages" action="by repo">
          {langs.length ? (
            <>
              <div className="flex h-2.5 gap-[2px]" role="img" aria-label={langs.map((l) => `${l.language} ${l.count}`).join(", ")}>
                {langs.map((l) => <i key={l.language} className="block h-full" style={{ flex: l.count, background: langColor(l.language), boxShadow: `0 0 8px ${langColor(l.language)}` }} />)}
              </div>
              <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
                {langs.map((l) => <li key={l.language} className="flex items-center justify-between gap-2"><Lang name={l.language} /><span className="font-mono text-xs tabular-nums text-muted">{l.count}<span className="sr-only"> of {langTotal}</span></span></li>)}
              </ul>
            </>
          ) : <p className="py-4 text-center text-sm text-muted">No language data.</p>}
          {s.repos.length > 0 && (
            <>
              <div className="hud-label mb-2 mt-6 text-[11px] text-muted">Latest pushes</div>
              <ul className="space-y-2.5">
                {s.repos.slice(0, 4).map((r) => (
                  <li key={r.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                    <a href={r.url} target="_blank" rel="noreferrer" className="truncate hover:text-violet">{r.name}</a>
                    <span className="shrink-0 text-xs text-muted">{timeAgo(r.pushedAt)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
