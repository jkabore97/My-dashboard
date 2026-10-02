// Which one-click fix (if any) applies to a task. Pure, so pages can show
// the button; server/fixes.ts runs it.

export type Fix =
  | { kind: "vercel-redeploy"; projectId: string; label: string }
  | { kind: "supabase-restore"; ref: string; label: string }
  | { kind: "github-rerun"; repo: string; runId: string; label: string };

/** Which fix (if any) applies to a task, from its stable key or link. */
export function fixForTask(sourceKey: string | null, url: string | null | undefined): Fix | null {
  if (!sourceKey) return null;
  let m = sourceKey.match(/^vercel\/deploy-failed:(.+)$/);
  if (m) return { kind: "vercel-redeploy", projectId: m[1], label: "Redeploy" };
  m = sourceKey.match(/^supabase\/paused:([a-z0-9]{10,40})$/);
  if (m) return { kind: "supabase-restore", ref: m[1], label: "Restore project" };
  if (sourceKey.startsWith("github-ci:") && url) {
    const r = url.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/actions\/runs\/(\d+)/);
    if (r) return { kind: "github-rerun", repo: r[1], runId: r[2], label: "Re-run failed jobs" };
  }
  return null;
}
