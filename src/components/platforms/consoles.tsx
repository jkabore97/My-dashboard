import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { AZURE_BILLING, M365_ADMIN } from "@/lib/billing/microsoft";
import { firebaseConsole, gcpConsole } from "@/lib/billing/google";
import type { Bills } from "@/lib/billing/types";
import type { SourceMode } from "@/lib/types";
import { ModePill, SYS, Tag } from "@/components/ui";

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
  { id: "m365", name: "Microsoft 365 admin", url: "https://admin.microsoft.com", color: SYS.blue },
  { id: "entra", name: "Entra admin", url: "https://entra.microsoft.com", color: SYS.indigo },
  { id: "azure-billing", name: "Azure billing", url: AZURE_BILLING, color: SYS.cyan },
  { id: "gcp", name: "Google Cloud console", url: "https://console.cloud.google.com", color: SYS.teal },
  { id: "firebase", name: "Firebase console", url: "https://console.firebase.google.com", color: SYS.yellow },
  { id: "workspace", name: "Google Workspace admin", url: "https://admin.google.com", color: SYS.green },
];
const colorOf = (id: string) => CONSOLES.find((c) => c.id === id)?.color ?? SYS.gray;

const link = "inline-flex min-h-9 items-center gap-1 text-[14px] text-cyan hover:opacity-70 sm:min-h-7";

/** Compact quick-launch strip: pills that scroll sideways on phones. */
export function ConsoleStrip() {
  return (
    <nav aria-label="Consoles" className="mb-6 flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="text-[13px] text-muted">Consoles</span>
      <div className="no-scrollbar -mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {CONSOLES.map((c) => (
          <a key={c.id} href={c.url} target="_blank" rel="noreferrer" className="inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-panel px-3.5 text-[14px] font-medium text-ink shadow-[0_0_0_1px_var(--color-line)] transition hover:bg-panel-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color }} />
            {c.name}
            <ExternalLink size={12} className="text-muted" aria-hidden />
          </a>
        ))}
      </div>
    </nav>
  );
}

const Status = ({ on, label }: { on: boolean; label: string }) => <Tag color={on ? SYS.green : SYS.gray}>{label}</Tag>;

/** One row per console: tile, name, what the dashboard reads from it, status, links. */
function ConsoleRow({ id, title, status, children, links }: { id: string; title: string; status: ReactNode; children: ReactNode; links: ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span aria-hidden className="mt-0.5 grid h-[29px] w-[29px] shrink-0 place-items-center rounded-[7px] text-white" style={{ background: colorOf(id) }}><ExternalLink size={15} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="min-w-0 text-[15px] text-ink">{title}</span>
          <span className="shrink-0">{status}</span>
        </div>
        <div className="mt-0.5 text-[13px] leading-snug text-muted">{children}</div>
        <div className="mt-1 flex flex-wrap gap-x-4">{links}</div>
      </div>
    </div>
  );
}

/** One row per console, with what the dashboard reads from it. */
export function ConsoleCards({ bills, modes, msadminConnected, gcloudConnected, msAppConfigured }: { bills: Bills; modes: Record<string, SourceMode>; msadminConnected: boolean; gcloudConnected: boolean; msAppConfigured: boolean }) {
  const ms = bills.microsoft;
  // Links come from the connector's data only once it's really connected (never sample projects).
  const g = gcloudConnected ? bills.google : { ...bills.google, projects: [], billingAccounts: [] };
  const billingOk = msadminConnected && !ms.billing.error && ms.billing.accounts.length > 0;
  const firebase = g.projects.filter((p) => p.firebase);
  const waste = ms.licences.filter((l) => !l.free && l.unassigned > 0).reduce((n, l) => n + l.unassigned, 0);
  const ext = <ExternalLink size={12} aria-hidden />;
  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <div className="overflow-hidden rounded-[14px] bg-panel shadow-[0_0_0_1px_var(--color-line)] [&>*+*]:border-t [&>*+*]:border-line">
        <ConsoleRow id="m365" title="Microsoft 365 admin center" status={msadminConnected ? <ModePill mode={modes.msadmin ?? "demo"} /> : <Status on={false} label="Not connected" />}
          links={<>
            <a href={M365_ADMIN} target="_blank" rel="noreferrer" className={link}>Open admin center {ext}</a>
            <a href={`${M365_ADMIN}#/licenses`} target="_blank" rel="noreferrer" className={link}>Licences {ext}</a>
            <a href={`${M365_ADMIN}#/servicehealth`} target="_blank" rel="noreferrer" className={link}>Service health {ext}</a>
          </>}>
          Users, licences, billing, service health.
          {msadminConnected && (
            <>
              <span className="mt-1 block text-ink">{ms.tenant ?? ms.account ?? ""}{ms.licences.length ? ` · ${ms.licences.filter((l) => !l.free).length} paid licence types${waste ? `, ${waste} unassigned seats` : ""}` : ""}{ms.health.length ? ` · ${ms.health.length} open health issue${ms.health.length === 1 ? "" : "s"}` : ""}</span>
              {ms.healthNote && <span className="mt-1 block">{ms.healthNote}</span>}
            </>
          )}
        </ConsoleRow>
        <ConsoleRow id="entra" title="Entra admin" status={<Status on={msAppConfigured} label={msAppConfigured ? "App configured" : "App not set"} />}
          links={<>
            <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noreferrer" className={link}>App registrations {ext}</a>
            <a href="https://entra.microsoft.com" target="_blank" rel="noreferrer" className={link}>Open Entra {ext}</a>
          </>}>
          App registration and API permissions for the Microsoft connections (Outlook, Microsoft 365 admin).
        </ConsoleRow>
        <ConsoleRow id="azure-billing" title="Azure portal · billing" status={<Status on={billingOk} label={billingOk ? "Billing readable" : msadminConnected ? "No billing access" : "Not connected"} />}
          links={<a href={AZURE_BILLING} target="_blank" rel="noreferrer" className={link}>Open billing {ext}</a>}>
          Billing accounts, invoices and roles (Cost Management + Billing).
          {msadminConnected && ms.billing.error && <span className="mt-1 block text-warn">{ms.billing.error}</span>}
        </ConsoleRow>
      </div>
      <div className="overflow-hidden rounded-[14px] bg-panel shadow-[0_0_0_1px_var(--color-line)] [&>*+*]:border-t [&>*+*]:border-line">
        <ConsoleRow id="gcp" title="Google Cloud console" status={gcloudConnected ? <ModePill mode={modes.gcloud ?? "demo"} /> : <Status on={false} label="Not connected" />}
          links={<>
            <a href={gcpConsole()} target="_blank" rel="noreferrer" className={link}>Open console {ext}</a>
            {g.projects.slice(0, 4).map((p) => <a key={p.projectId} href={gcpConsole(p.projectId)} target="_blank" rel="noreferrer" className={link}>{p.name} {ext}</a>)}
          </>}>
          {gcloudConnected ? `${g.projects.length} project${g.projects.length === 1 ? "" : "s"} · ${g.billingAccounts.length} billing account${g.billingAccounts.length === 1 ? "" : "s"}` : "Projects, APIs, billing and the BigQuery billing export."}
        </ConsoleRow>
        <ConsoleRow id="firebase" title="Firebase console" status={gcloudConnected ? <Status on={firebase.length > 0} label={`${firebase.length} project${firebase.length === 1 ? "" : "s"}`} /> : <Status on={false} label="Not connected" />}
          links={firebase.length ? firebase.slice(0, 5).map((p) => <a key={p.projectId} href={firebaseConsole(p.projectId)} target="_blank" rel="noreferrer" className={link}>{p.name} {ext}</a>) : <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer" className={link}>Open Firebase {ext}</a>}>
          Firebase apps, hosting and usage. Its costs show under Google Cloud on Platform spend.
        </ConsoleRow>
        <ConsoleRow id="workspace" title="Google Workspace admin" status={<Tag>No billing API</Tag>}
          links={<>
            <a href="https://admin.google.com" target="_blank" rel="noreferrer" className={link}>Open admin {ext}</a>
            <a href="https://admin.google.com/ac/billing/subscriptions" target="_blank" rel="noreferrer" className={link}>Billing {ext}</a>
          </>}>
          Google offers no Workspace billing API to customers. Workspace invoices are recognised from payments-noreply@google.com e-mails in a shared mailbox and shown on Platform spend to track.
        </ConsoleRow>
      </div>
    </div>
  );
}
