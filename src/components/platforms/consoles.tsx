import type { CSSProperties } from "react";
import { ExternalLink } from "lucide-react";
import { AZURE_BILLING, M365_ADMIN } from "@/lib/billing/microsoft";
import { firebaseConsole, gcpConsole } from "@/lib/billing/google";
import type { Bills } from "@/lib/billing/types";
import type { SourceMode } from "@/lib/types";
import { ModePill, Tag } from "@/components/ui";
import { HeadPanel } from "@/components/admin/bits";

// Admin consoles the owner jumps to: Microsoft 365, Entra, Azure billing,
// Google Cloud, Firebase, Google Workspace. Links only (plus the status of
// the connector behind each, where there is one). Platforms page = owners only.

export interface ConsoleLink {
  id: string;
  name: string;
  url: string;
  color: string;
}

export const CONSOLES: ConsoleLink[] = [
  { id: "m365", name: "Microsoft 365 admin", url: "https://admin.microsoft.com", color: "#3fd0ff" },
  { id: "entra", name: "Entra admin", url: "https://entra.microsoft.com", color: "#7aa2ff" },
  { id: "azure-billing", name: "Azure billing", url: AZURE_BILLING, color: "#5ee6ff" },
  { id: "gcp", name: "Google Cloud console", url: "https://console.cloud.google.com", color: "#2ef2d0" },
  { id: "firebase", name: "Firebase console", url: "https://console.firebase.google.com", color: "#ffd84d" },
  { id: "workspace", name: "Google Workspace admin", url: "https://admin.google.com", color: "#3df5a0" },
];

const link = "inline-flex min-h-10 items-center gap-1.5 text-xs text-cyan hover:underline sm:min-h-0";

/** Compact quick-launch strip. */
export function ConsoleStrip() {
  return (
    <nav aria-label="Consoles" className="hud-panel mb-5 flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5" style={{ "--a": "#3fd0ff" } as CSSProperties}>
      <span className="hud-label mr-1 text-[11px] text-muted">Consoles</span>
      {CONSOLES.map((c) => (
        <a key={c.id} href={c.url} target="_blank" rel="noreferrer" className="hud-btn inline-flex min-h-10 items-center gap-1.5 px-2.5 py-1 text-[11px] sm:min-h-8" style={{ "--b": c.color } as CSSProperties}>
          {c.name}
          <ExternalLink size={11} aria-hidden />
        </a>
      ))}
    </nav>
  );
}

const Status = ({ on, label }: { on: boolean; label: string }) => <Tag color={on ? "#3df5a0" : "#7f97ab"}>{label}</Tag>;

/** One card per console, with what the dashboard reads from it. */
export function ConsoleCards({ bills, modes, msadminConnected, gcloudConnected, msAppConfigured }: { bills: Bills; modes: Record<string, SourceMode>; msadminConnected: boolean; gcloudConnected: boolean; msAppConfigured: boolean }) {
  const ms = bills.microsoft;
  // Links come from the connector's data only once it's really connected (never sample projects).
  const g = gcloudConnected ? bills.google : { ...bills.google, projects: [], billingAccounts: [] };
  const billingOk = msadminConnected && !ms.billing.error && ms.billing.accounts.length > 0;
  const firebase = g.projects.filter((p) => p.firebase);
  const waste = ms.licences.filter((l) => !l.free && l.unassigned > 0).reduce((n, l) => n + l.unassigned, 0);
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <HeadPanel accent="#3fd0ff" title="Microsoft 365 admin center" status={msadminConnected ? <ModePill mode={modes.msadmin ?? "demo"} /> : <Status on={false} label="Not connected" />}>
        <p className="text-[13px] text-muted">Users, licences, billing, service health.</p>
        {msadminConnected && (
          <p className="mt-2 text-sm">{ms.tenant ?? ms.account ?? ""}{ms.licences.length ? ` · ${ms.licences.filter((l) => !l.free).length} paid licence types${waste ? `, ${waste} unassigned seats` : ""}` : ""}{ms.health.length ? ` · ${ms.health.length} open health issue${ms.health.length === 1 ? "" : "s"}` : ""}</p>
        )}
        <div className="mt-auto flex flex-wrap gap-x-4 pt-3">
          <a href={M365_ADMIN} target="_blank" rel="noreferrer" className={link}>Open admin center <ExternalLink size={11} /></a>
          <a href={`${M365_ADMIN}#/licenses`} target="_blank" rel="noreferrer" className={link}>Licences <ExternalLink size={11} /></a>
          <a href={`${M365_ADMIN}#/servicehealth`} target="_blank" rel="noreferrer" className={link}>Service health <ExternalLink size={11} /></a>
        </div>
      </HeadPanel>
      <HeadPanel accent="#7aa2ff" title="Entra admin" status={<Status on={msAppConfigured} label={msAppConfigured ? "App configured" : "App not set"} />}>
        <p className="text-[13px] text-muted">App registration and API permissions for the Microsoft connections (Outlook, Microsoft 365 admin).</p>
        <div className="mt-auto flex flex-wrap gap-x-4 pt-3">
          <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noreferrer" className={link}>App registrations <ExternalLink size={11} /></a>
          <a href="https://entra.microsoft.com" target="_blank" rel="noreferrer" className={link}>Open Entra <ExternalLink size={11} /></a>
        </div>
      </HeadPanel>
      <HeadPanel accent="#5ee6ff" title="Azure portal · billing" status={<Status on={billingOk} label={billingOk ? "Billing readable" : msadminConnected ? "No billing access" : "Not connected"} />}>
        <p className="text-[13px] text-muted">Billing accounts, invoices and roles (Cost Management + Billing).</p>
        {msadminConnected && ms.billing.error && <p className="mt-2 text-xs text-high">{ms.billing.error}</p>}
        <div className="mt-auto flex flex-wrap gap-x-4 pt-3">
          <a href={AZURE_BILLING} target="_blank" rel="noreferrer" className={link}>Open billing <ExternalLink size={11} /></a>
        </div>
      </HeadPanel>
      <HeadPanel accent="#2ef2d0" title="Google Cloud console" status={gcloudConnected ? <ModePill mode={modes.gcloud ?? "demo"} /> : <Status on={false} label="Not connected" />}>
        <p className="text-[13px] text-muted">{gcloudConnected ? `${g.projects.length} project${g.projects.length === 1 ? "" : "s"} · ${g.billingAccounts.length} billing account${g.billingAccounts.length === 1 ? "" : "s"}` : "Projects, APIs, billing and the BigQuery billing export."}</p>
        <div className="mt-auto flex flex-wrap gap-x-4 pt-3">
          <a href={gcpConsole()} target="_blank" rel="noreferrer" className={link}>Open console <ExternalLink size={11} /></a>
          {g.projects.slice(0, 4).map((p) => <a key={p.projectId} href={gcpConsole(p.projectId)} target="_blank" rel="noreferrer" className={link}>{p.name} <ExternalLink size={11} /></a>)}
        </div>
      </HeadPanel>
      <HeadPanel accent="#ffd84d" title="Firebase console" status={gcloudConnected ? <Status on={firebase.length > 0} label={`${firebase.length} project${firebase.length === 1 ? "" : "s"}`} /> : <Status on={false} label="Not connected" />}>
        <p className="text-[13px] text-muted">Firebase apps, hosting and usage. Its costs show under Google Cloud on Platform spend.</p>
        <div className="mt-auto flex flex-wrap gap-x-4 pt-3">
          {firebase.length ? firebase.slice(0, 5).map((p) => <a key={p.projectId} href={firebaseConsole(p.projectId)} target="_blank" rel="noreferrer" className={link}>{p.name} <ExternalLink size={11} /></a>) : <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer" className={link}>Open Firebase <ExternalLink size={11} /></a>}
        </div>
      </HeadPanel>
      <HeadPanel accent="#3df5a0" title="Google Workspace admin" status={<Tag>No billing API</Tag>}>
        <p className="text-[13px] text-muted">Google offers no Workspace billing API to customers. Workspace invoices are recognised from payments-noreply@google.com e-mails in a shared mailbox and shown on Platform spend to track.</p>
        <div className="mt-auto flex flex-wrap gap-x-4 pt-3">
          <a href="https://admin.google.com" target="_blank" rel="noreferrer" className={link}>Open admin <ExternalLink size={11} /></a>
          <a href="https://admin.google.com/ac/billing/subscriptions" target="_blank" rel="noreferrer" className={link}>Billing <ExternalLink size={11} /></a>
        </div>
      </HeadPanel>
    </div>
  );
}
