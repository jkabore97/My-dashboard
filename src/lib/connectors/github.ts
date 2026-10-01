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
        };
      });
    },
    demoRepos,
  );
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
