import { demoSecurity } from "../demo";
import { githubToken } from "../server/credentials";
import { errorMessage, fromSource } from "../source";
import type { Repo, RepoSecurity, SecurityAlert, SecurityReport, Severity } from "../types";

const API = "https://api.github.com";
const MAX_REPOS = 25;

const SEVERITY: Record<string, Severity> = { critical: "critical", high: "high", medium: "medium", moderate: "medium", low: "low" };

interface DependabotAlert {
  number: number;
  html_url: string;
  created_at: string;
  security_advisory?: { severity?: string; summary?: string };
  security_vulnerability?: { severity?: string; package?: { name?: string } };
  dependency?: { package?: { name?: string } };
}

interface SecretAlert {
  number: number;
  html_url: string;
  created_at: string;
  secret_type_display_name?: string;
  secret_type?: string;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function gh<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new HttpError(res.status, `${res.status} ${body.message ?? res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/**
 * GitHub answers 403 "…alerts are disabled…" when a feature is off for the
 * repo, and 404 when it isn't available (e.g. secret scanning on private repos
 * without Advanced Security). Anything else is a real failure (often a token
 * missing the "Dependabot alerts" / "Secret scanning alerts" read permission).
 */
export function classifyAlertError(err: unknown): "off" | "unavailable" | "error" {
  if (err instanceof HttpError) {
    if (err.status === 403 && /disabled/i.test(err.message)) return "off";
    if (err.status === 404) return "unavailable";
  }
  return "error";
}

export async function getSecurity(repos: Repo[], reposLive: boolean) {
  const token = await githubToken();
  return fromSource<SecurityReport>(
    "GitHub security",
    !!token && reposLive,
    async (fail) => {
      const me = await gh<{ login: string; two_factor_authentication?: boolean }>(token!, "/user");
      const targets = repos.slice(0, MAX_REPOS);
      const alerts: SecurityAlert[] = [];
      const status: RepoSecurity[] = [];
      await Promise.all(
        targets.map(async (r) => {
          const s: RepoSecurity = { repo: r.fullName, dependabot: "unknown", secretScanning: "unknown" };
          try {
            const list = await gh<DependabotAlert[]>(token!, `/repos/${r.fullName}/dependabot/alerts?state=open&per_page=100`);
            s.dependabot = "on";
            for (const a of list) {
              const pkg = a.dependency?.package?.name ?? a.security_vulnerability?.package?.name ?? "a dependency";
              alerts.push({ kind: "dependabot", repo: r.fullName, number: a.number, severity: SEVERITY[a.security_advisory?.severity ?? a.security_vulnerability?.severity ?? ""] ?? "high", title: `Vulnerable ${pkg}: ${a.security_advisory?.summary ?? "security advisory"}`, url: a.html_url, createdAt: a.created_at });
            }
          } catch (err) {
            const c = classifyAlertError(err);
            if (c === "off") s.dependabot = "off";
            else if (c === "error") fail(`dependabot:${r.fullName}`, `${r.fullName} Dependabot: ${errorMessage(err)}`);
          }
          try {
            const list = await gh<SecretAlert[]>(token!, `/repos/${r.fullName}/secret-scanning/alerts?state=open&per_page=100`);
            s.secretScanning = "on";
            for (const a of list) alerts.push({ kind: "secret", repo: r.fullName, number: a.number, severity: "critical", title: `Leaked ${a.secret_type_display_name ?? a.secret_type ?? "secret"}`, url: a.html_url, createdAt: a.created_at });
          } catch (err) {
            const c = classifyAlertError(err);
            if (c === "off" || c === "unavailable") s.secretScanning = "unavailable";
            else fail(`secret:${r.fullName}`, `${r.fullName} secret scanning: ${errorMessage(err)}`);
          }
          status.push(s);
        }),
      );
      return {
        alerts: alerts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        repos: status.sort((a, b) => a.repo.localeCompare(b.repo)),
        github2fa: typeof me.two_factor_authentication === "boolean" ? me.two_factor_authentication : null,
        githubLogin: me.login,
      };
    },
    demoSecurity,
  );
}
