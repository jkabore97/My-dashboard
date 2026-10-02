import { demoRepos } from "../demo";
import { businessFor, type BusinessRule } from "../server/config";
import { githubToken } from "../server/credentials";
import { errorMessage, fromSource, getJson } from "../source";
import type { Notification, Repo, Severity } from "../types";

const API = "https://api.github.com";

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

interface GhRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  private: boolean;
  language: string | null;
  default_branch: string;
  open_issues_count: number;
  pushed_at: string;
  archived: boolean;
}

export async function getRepos(rules: BusinessRule[]) {
  const token = await githubToken();
  return fromSource<Repo[]>(
    "GitHub",
    !!token,
    async (fail) => {
      const repos = await getJson<GhRepo[]>(
        `${API}/user/repos?per_page=100&sort=pushed&affiliation=owner,organization_member`,
        { headers: headers(token!) },
      );
      const active = repos.filter((r) => !r.archived);
      // open_issues_count includes PRs; count PRs separately for the most active repos.
      const prCounts = await Promise.all(
        active.slice(0, 15).map((r) =>
          getJson<unknown[]>(`${API}/repos/${r.full_name}/pulls?state=open&per_page=100`, { headers: headers(token!) })
            .then((prs) => prs.length)
            .catch((err) => (fail(r.full_name, `${r.full_name} pull requests: ${errorMessage(err)}`), null)),
        ),
      );
      // Commit activity for the few most recently pushed repos only: one call
      // each, cached for hours (GitHub computes these stats lazily anyway).
      const activity = await Promise.all(active.slice(0, ACTIVITY_REPOS).map((r) => commitActivity(token!, r.full_name)));
      return active.map((r, i) => {
        // Repos beyond the first 15 aren't counted: their issue count includes PRs.
        const prs = i < prCounts.length ? prCounts[i] : 0;
        return {
          id: String(r.id),
          name: r.name,
          fullName: r.full_name,
          url: r.html_url,
          private: r.private,
          language: r.language,
          defaultBranch: r.default_branch,
          openIssues: prs == null ? null : Math.max(0, r.open_issues_count - prs),
          openPullRequests: prs,
          pushedAt: r.pushed_at,
          business: businessFor(r.name, rules),
          ...(activity[i] ? { activity: activity[i] } : {}),
        };
      });
    },
    demoRepos,
  );
}

const ACTIVITY_REPOS = 8;
const ACTIVITY_WEEKS = 26;

/**
 * GitHub's weekly commit activity ({ week: unix seconds, days: [7 counts] }),
 * trimmed to the last `weeks`. Null while GitHub is still computing (202 with
 * an empty body) or for anything that isn't the documented shape.
 */
export function parseCommitActivity(json: unknown, weeks = ACTIVITY_WEEKS): { weekStart: string; days: number[] }[] | null {
  if (!Array.isArray(json) || json.length === 0) return null;
  const out: { weekStart: string; days: number[] }[] = [];
  for (const w of json) {
    if (!w || typeof w !== "object") return null;
    const { week, days } = w as { week?: unknown; days?: unknown };
    if (typeof week !== "number" || !Array.isArray(days) || days.length !== 7 || !days.every((d) => typeof d === "number")) return null;
    out.push({ weekStart: new Date(week * 1000).toISOString().slice(0, 10), days: days as number[] });
  }
  return out.slice(-weeks);
}

async function commitActivity(token: string, fullName: string) {
  try {
    const res = await fetch(`${API}/repos/${fullName}/stats/commit_activity`, { headers: headers(token), next: { revalidate: 6 * 3600 } });
    if (res.status !== 200) return null;
    return parseCommitActivity(await res.json());
  } catch {
    return null; // optional extra: the repo list stands without it
  }
}

interface GhNotification {
  id: string;
  reason: string;
  updated_at: string;
  subject: { title: string; type: string; url: string | null };
  repository: { full_name: string; html_url: string };
}

const REASON_SEVERITY: Record<string, Severity> = {
  security_alert: "critical",
  ci_activity: "high",
  review_requested: "high",
  assign: "medium",
  mention: "medium",
  team_mention: "medium",
};

export async function getGithubNotifications() {
  const token = await githubToken();
  return fromSource<Notification[]>(
    "GitHub",
    !!token,
    async () => {
      const items = await getJson<GhNotification[]>(`${API}/notifications?per_page=30`, { headers: headers(token!) });
      return items.map((n) => ({
        id: `gh-${n.id}-${n.updated_at}`,
        source: "GitHub",
        title: n.subject.title,
        body: `${n.repository.full_name} · ${n.reason.replace(/_/g, " ")}`,
        at: n.updated_at,
        severity: REASON_SEVERITY[n.reason] ?? "low",
        url: n.repository.html_url,
      }));
    },
    () => [],
  );
}
