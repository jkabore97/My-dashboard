"use client";

import { useState, useTransition } from "react";
import { Copy, Share2 } from "lucide-react";
import { useFormState } from "@/components/useFormState";
import { createPortalAction, revokePortalAction, type PortalState } from "@/app/actions/portals";

const small = "inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-accent/50 hover:text-ink disabled:opacity-50";

export function ShareClient({ clientId, clientName, sites, suggested, active }: {
  clientId: string;
  clientName: string;
  /** Monitored sites this person may share. */
  sites: string[];
  /** Pre-ticked sites (the client's website, when monitored). */
  suggested: string[];
  active: { id: string; sites: string[]; showProjects: boolean; createdAt: string; lastViewedAt: string | null } | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useFormState<PortalState>(createPortalAction, {});
  const [revoking, start] = useTransition();
  const [revoked, setRevoked] = useState<PortalState | null>(null);
  const [copied, setCopied] = useState(false);

  if (!open) {
    return <button className={small} onClick={() => setOpen(true)} title="Share a read-only status page"><Share2 size={12} />{active ? "Status page · on" : "Status page"}</button>;
  }
  return (
    <div className="mt-2 w-full basis-full rounded-lg border border-line bg-bg p-3 text-sm">
      <p className="mb-2 text-xs text-muted">A read-only page for {clientName}: uptime of the sites you pick and the stage of their projects. No amounts, notes or next steps are shown.</p>
      {active && !revoked?.ok && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ok">Link is on</span>
          <span className="text-muted">· {active.sites.length ? active.sites.join(", ") : "no sites"}{active.showProjects ? " + projects" : ""} · {active.lastViewedAt ? `last opened ${new Date(active.lastViewedAt).toLocaleDateString()}` : "not opened yet"}</span>
          <button className={small} disabled={revoking} onClick={() => confirm("Turn off this client's status link?") && start(async () => setRevoked(await revokePortalAction(active.id)))}>Turn off</button>
        </div>
      )}
      {revoked && <p className={`mb-2 text-xs ${revoked.error ? "text-critical" : "text-ok"}`}>{revoked.error ?? revoked.ok}</p>}
      <form onSubmit={action} className="grid gap-2">
        <input type="hidden" name="clientId" value={clientId} />
        {sites.length ? (
          <fieldset className="grid gap-1">
            <legend className="mb-1 text-xs text-muted">Sites</legend>
            {sites.map((d) => <label key={d} className="flex items-center gap-2"><input type="checkbox" name="sites" value={d} defaultChecked={(active?.sites ?? suggested).includes(d)} /> {d}</label>)}
          </fieldset>
        ) : <p className="text-xs text-muted">No monitored sites yet (Settings → Websites).</p>}
        <label className="flex items-center gap-2"><input type="checkbox" name="showProjects" defaultChecked={active?.showProjects ?? true} /> Show their projects</label>
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={pending} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-50">{active ? "Make a new link" : "Create link"}</button>
          <button type="button" className={small} onClick={() => setOpen(false)}>Close</button>
        </div>
        {state.error && <p className="text-xs text-critical">{state.error}</p>}
        {state.ok && (
          <div className="grid gap-1">
            <p className="text-xs text-ok">{state.ok}</p>
            {state.link && (
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-panel px-2 py-1 text-xs">{state.link}</code>
                <button type="button" className={small} onClick={async () => { await navigator.clipboard.writeText(state.link!); setCopied(true); }}><Copy size={12} />{copied ? "Copied" : "Copy"}</button>
              </div>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
