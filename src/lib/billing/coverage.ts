import type { SourceMode } from "../types";
import { vendorKey } from "./email";
import type { ApiSpend } from "./spend";
import type { Bills, PlatformBilling } from "./types";

// "Bill coverage": for every connected platform, how its bill is known —
// a billing API, an e-mail receipt, a manual entry, or not at all — with
// the one change that would improve it.

export type CoverageHow = "api" | "email" | "manual" | "none";

export interface CoverageRow {
  id: string;
  name: string;
  how: CoverageHow;
  detail: string;
  /** One-line fix, when there is something to do. */
  fix: string | null;
}

interface PlatformInfo {
  vendor: string;
  name: string;
  /** Fix when nothing tracks this platform's bill. */
  fix: string;
}

/** Connected platform id → whose bill it is. Platforms we don't pay for (website monitor, solar) are left out. */
export const PLATFORM_BILLS: Record<string, PlatformInfo> = {
  msadmin: { vendor: "microsoft", name: "Microsoft 365 / Azure", fix: "Connect Microsoft 365 admin with a Billing account reader role." },
  microsoft: { vendor: "microsoft", name: "Microsoft 365 / Azure", fix: "Connect Microsoft 365 admin on Platforms to read invoices." },
  gcloud: { vendor: "google-cloud", name: "Google Cloud / Firebase", fix: "Set the BigQuery billing-export table on Platforms → Google Cloud." },
  gmail: { vendor: "google-workspace", name: "Google Workspace", fix: "No billing API: make sure Workspace invoices (payments-noreply@google.com) reach a shared mailbox, or add it by hand." },
  github: { vendor: "github", name: "GitHub", fix: "Give the GitHub token \"Plan: read\" (fine-grained, account permissions)." },
  vercel: { vendor: "vercel", name: "Vercel", fix: "Billing charges need a Pro or Enterprise team; on Hobby there is nothing to bill." },
  cloudflare: { vendor: "cloudflare", name: "Cloudflare", fix: "Add \"Billing: Read\" to the Cloudflare API token." },
  supabase: { vendor: "supabase", name: "Supabase", fix: "No billing API: let receipts reach a shared mailbox or add the plan by hand." },
  stripe: { vendor: "stripe", name: "Stripe processing fees", fix: "Fees come from the live Stripe balance; connect a live key." },
  claude: { vendor: "anthropic", name: "Anthropic (Claude API)", fix: "Set ANTHROPIC_ADMIN_KEY (sk-ant-admin…) to read the cost report, or let receipts reach a shared mailbox." },
  resend: { vendor: "resend", name: "Resend", fix: "No billing API: let Resend receipts reach a shared mailbox or add it by hand." },
  hikvision: { vendor: "hik-connect", name: "Hik-Connect / recorders", fix: "Add any cloud or support plan by hand (no billing API)." },
  reviews: { vendor: "google-cloud", name: "Google Places API", fix: "Billed on a Google Cloud billing account: connect Google Cloud." },
};

const STATUS_DETAIL: Record<NonNullable<PlatformBilling["status"]>, string> = {
  ok: "Billing API",
  free: "Free plan: nothing billed",
  plan: "Plan known, no amounts",
  permission: "Billing API: no permission",
  error: "Billing API failed",
};

export function billCoverage(input: {
  /** Connected platforms: id → mode (live / error). */
  connected: { id: string; mode: SourceMode | null }[];
  bills: Bills;
  api: ApiSpend[];
  subs: { vendor: string; active: boolean }[];
}): CoverageRow[] {
  const seen = new Set<string>();
  const rows: CoverageRow[] = [];
  const all = input.connected.map((c) => c.id);
  // Microsoft billing is read through the admin connection; show it once.
  const ids = all.filter((id) => !(id === "microsoft" && all.includes("msadmin")));
  for (const id of ids) {
    const info = PLATFORM_BILLS[id];
    if (!info || seen.has(info.vendor + info.name)) continue;
    seen.add(info.vendor + info.name);
    const api = input.api.find((a) => a.vendor === info.vendor);
    const pb = input.bills.platforms.find((p) => p.platform === info.vendor);
    const emails = input.bills.email.filter((e) => e.vendorKey === info.vendor);
    const manual = input.subs.some((s) => s.active && vendorKey(s.vendor) === info.vendor);
    const msError = info.vendor === "microsoft" ? input.bills.microsoft.billing.error : null;
    const gExport = info.vendor === "google-cloud" ? input.bills.google.export : null;
    const apiFix = pb && pb.status && pb.status !== "ok" ? pb.message : msError ?? (gExport && gExport.status !== "ok" ? gExport.error ?? info.fix : null);
    if (api) rows.push({ id, name: info.name, how: "api", detail: `Billing API · ${api.basis}`, fix: null });
    else if (emails.length) rows.push({ id, name: info.name, how: "email", detail: `From e-mail · last ${emails[0].date}`, fix: apiFix });
    else if (manual) rows.push({ id, name: info.name, how: "manual", detail: pb?.status === "free" ? STATUS_DETAIL.free : "Manual entry", fix: apiFix });
    else if (pb?.status === "free") rows.push({ id, name: info.name, how: "none", detail: STATUS_DETAIL.free, fix: null });
    else rows.push({ id, name: info.name, how: "none", detail: pb?.status ? STATUS_DETAIL[pb.status] : "Not tracked", fix: apiFix ?? info.fix });
  }
  const order: Record<CoverageHow, number> = { none: 0, manual: 1, email: 2, api: 3 };
  return rows.sort((a, b) => order[a.how] - order[b.how] || a.name.localeCompare(b.name));
}
