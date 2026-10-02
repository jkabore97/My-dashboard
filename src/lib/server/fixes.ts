import { githubToken, supabaseToken, vercelCreds } from "./credentials";
import type { Fix } from "../fix-match";

export { fixForTask, type Fix } from "../fix-match";

// One-click fixes offered next to the problems they fix. Every fix asks for
// confirmation in the UI, runs with the platform credentials you connected,
// and is written to the audit log by the calling action.

async function call(url: string, token: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) }, cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint = res.status === 403 || res.status === 404 ? " (the connected token may be read-only; reconnect with write access to use this fix)" : "";
    throw new Error(`${res.status} from ${new URL(url).host}${hint}${body ? `: ${body.slice(0, 160)}` : ""}`);
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}

/** Runs a fix. Returns a short success message. */
export async function runFix(fix: Fix): Promise<string> {
  if (fix.kind === "vercel-redeploy") {
    const c = await vercelCreds();
    if (!c) throw new Error("Vercel isn't connected");
    const team = c.teamId ? `teamId=${encodeURIComponent(c.teamId)}&` : "";
    const list = (await call(`https://api.vercel.com/v6/deployments?${team}projectId=${encodeURIComponent(fix.projectId)}&target=production&limit=1`, c.token)) as { deployments?: { uid: string; name: string }[] };
    const last = list?.deployments?.[0];
    if (!last) throw new Error("No production deployment found to redeploy");
    // Redeploying an existing deployment rebuilds the same commit and config.
    const created = (await call(`https://api.vercel.com/v13/deployments?${team}forceNew=1`, c.token, { method: "POST", body: JSON.stringify({ name: last.name, deploymentId: last.uid, target: "production" }) })) as { url?: string } | null;
    return `Redeploy started${created?.url ? ` (${created.url})` : ""}.`;
  }
  if (fix.kind === "supabase-restore") {
    const token = await supabaseToken();
    if (!token) throw new Error("Supabase isn't connected");
    await call(`https://api.supabase.com/v1/projects/${encodeURIComponent(fix.ref)}/restore`, token, { method: "POST" });
    return "Restore started; the project is back in a few minutes.";
  }
  const token = await githubToken();
  if (!token) throw new Error("GitHub isn't connected");
  await call(`https://api.github.com/repos/${fix.repo}/actions/runs/${fix.runId}/rerun-failed-jobs`, token, { method: "POST", headers: { "X-GitHub-Api-Version": "2022-11-28" } });
  return "Failed jobs re-queued on GitHub.";
}
