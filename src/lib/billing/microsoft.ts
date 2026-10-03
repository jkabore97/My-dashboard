import { minorUnits } from "../money";
import type { Severity } from "../types";
import type { BillingAgreement, InvoiceStatus, MsBillingAccount, MsHealthIssue, MsInvoice, MsLicence } from "./types";

// Pure parsing of Microsoft Graph (licences, service health) and Azure
// Billing (billing accounts, invoices) responses. Unit-tested with recorded
// shapes; the fetching lives in connectors/msadmin.ts.

export const M365_ADMIN = "https://admin.microsoft.com/Adminportal/Home";
export const AZURE_BILLING = "https://portal.azure.com/#view/Microsoft_Azure_GTM/ModernBillingMenuBlade";

/** Friendly names for the SKUs a small business usually has. */
const SKU_NAMES: Record<string, string> = {
  O365_BUSINESS_ESSENTIALS: "Microsoft 365 Business Basic",
  O365_BUSINESS_PREMIUM: "Microsoft 365 Business Standard",
  SPB: "Microsoft 365 Business Premium",
  O365_BUSINESS: "Microsoft 365 Apps for business",
  OFFICESUBSCRIPTION: "Microsoft 365 Apps for enterprise",
  EXCHANGESTANDARD: "Exchange Online (Plan 1)",
  EXCHANGEENTERPRISE: "Exchange Online (Plan 2)",
  EXCHANGEESSENTIALS: "Exchange Online Essentials",
  SPE_E3: "Microsoft 365 E3",
  SPE_E5: "Microsoft 365 E5",
  ENTERPRISEPACK: "Office 365 E3",
  ENTERPRISEPREMIUM: "Office 365 E5",
  STANDARDPACK: "Office 365 E1",
  AAD_PREMIUM: "Entra ID P1",
  AAD_PREMIUM_P2: "Entra ID P2",
  POWER_BI_PRO: "Power BI Pro",
  PROJECTPROFESSIONAL: "Project Plan 3",
  VISIOCLIENT: "Visio Plan 2",
  Microsoft_Teams_Essentials: "Teams Essentials",
  TEAMS_ESSENTIALS_AAD: "Teams Essentials",
  MCOEV: "Teams Phone Standard",
  INTUNE_A: "Intune Plan 1",
  Microsoft_365_Copilot: "Microsoft 365 Copilot",
};

const FREE_SKU = /FREE|TRIAL|VIRAL|WINDOWS_STORE|POWER_BI_STANDARD|STREAM|DEVELOPERPACK|_DEV\b|FLOW_PER_USER_DEPT|RIGHTSMANAGEMENT_ADHOC|MCOPSTNC|CCIBOTS/i;

interface GraphSku {
  skuId?: string;
  skuPartNumber?: string;
  capabilityStatus?: string;
  consumedUnits?: number;
  prepaidUnits?: { enabled?: number; suspended?: number; warning?: number; lockedOut?: number };
}

/** subscribedSkus → purchased vs assigned seats per product. */
export function parseSkus(value: GraphSku[] | undefined): MsLicence[] {
  return (value ?? [])
    .filter((s) => s.skuPartNumber)
    .map((s) => {
      const sku = s.skuPartNumber!;
      const purchased = Math.max(0, Number(s.prepaidUnits?.enabled ?? 0) + Number(s.prepaidUnits?.warning ?? 0));
      const assigned = Math.max(0, Number(s.consumedUnits ?? 0));
      return {
        sku,
        name: SKU_NAMES[sku] ?? sku.replace(/_/g, " "),
        purchased,
        assigned,
        unassigned: Math.max(0, purchased - assigned),
        status: s.capabilityStatus ?? "Unknown",
        // Free SKUs come with thousands of "seats"; nobody pays for them.
        free: FREE_SKU.test(sku) || purchased >= 10_000,
      };
    })
    .sort((a, b) => Number(a.free) - Number(b.free) || b.purchased - a.purchased || a.name.localeCompare(b.name));
}

/** Paid licences with seats nobody uses. */
export const licenceWaste = (licences: MsLicence[]) => licences.filter((l) => !l.free && l.status === "Enabled" && l.unassigned > 0);

interface GraphIssue {
  id?: string;
  title?: string;
  service?: string;
  status?: string;
  classification?: string;
  isResolved?: boolean;
  startDateTime?: string;
  impactDescription?: string;
}

const RESOLVED = new Set(["serviceOperational", "serviceRestored", "postIncidentReviewPublished", "falsePositive", "resolved", "resolvedExternal", "mitigated", "mitigatedExternal", "investigationSuspended"]);

/** Open service-health issues affecting the tenant, worst first. */
export function parseHealthIssues(value: GraphIssue[] | undefined): MsHealthIssue[] {
  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return (value ?? [])
    .filter((i) => i.id && !i.isResolved && !RESOLVED.has(i.status ?? ""))
    .map((i) => {
      const incident = i.classification === "incident";
      const severity: Severity = incident ? (i.status === "serviceInterruption" ? "critical" : "high") : i.status === "serviceDegradation" ? "medium" : "low";
      return {
        id: i.id!,
        title: (i.title ?? "Service issue").slice(0, 200),
        service: i.service ?? "Microsoft 365",
        status: i.status ?? "unknown",
        classification: incident ? ("incident" as const) : ("advisory" as const),
        severity,
        startedAt: i.startDateTime ?? null,
        impact: i.impactDescription ? i.impactDescription.slice(0, 300) : null,
        url: `${M365_ADMIN}#/servicehealth/:/alerts/${encodeURIComponent(i.id!)}`,
      };
    })
    .sort((a, b) => order[a.severity] - order[b.severity] || (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
}

interface ArmBillingAccount {
  id?: string;
  name?: string;
  properties?: { displayName?: string; agreementType?: string; accountType?: string };
}

const AGREEMENT: Record<string, BillingAgreement> = {
  MicrosoftCustomerAgreement: "mca",
  MicrosoftOnlineServicesProgram: "mosp",
  EnterpriseAgreement: "ea",
};

/** Billing account names go into URL paths: only the characters ARM uses. */
export const safeAccountName = (name: string) => /^[A-Za-z0-9:._@-]{1,200}$/.test(name);

export function parseBillingAccounts(value: ArmBillingAccount[] | undefined): MsBillingAccount[] {
  return (value ?? [])
    .filter((a) => a.name && safeAccountName(a.name))
    .map((a) => ({ name: a.name!, displayName: a.properties?.displayName || a.name!, agreement: AGREEMENT[a.properties?.agreementType ?? ""] ?? "other" }));
}

type Amount = { currency?: string; value?: number | string } | number | string | null | undefined;

interface ArmInvoice {
  id?: string;
  name?: string;
  properties?: {
    invoiceDate?: string;
    dueDate?: string;
    invoicePeriodStartDate?: string;
    invoicePeriodEndDate?: string;
    status?: string;
    totalAmount?: Amount;
    billedAmount?: Amount;
    amountDue?: Amount;
    subTotal?: Amount;
    taxAmount?: Amount;
    currency?: string;
    billingCurrency?: string;
    billingProfileDisplayName?: string;
    billingProfileId?: string;
    documentType?: string;
  };
}

const day = (v: string | undefined | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

function amountOf(a: Amount): { value: number; currency: string | null } | null {
  if (a === null || a === undefined) return null;
  if (typeof a === "number" || typeof a === "string") {
    const n = Number(a);
    return Number.isFinite(n) ? { value: n, currency: null } : null;
  }
  const n = Number(a.value);
  return Number.isFinite(n) ? { value: n, currency: a.currency ? a.currency.toLowerCase() : null } : null;
}

const toMinor = (value: number, currency: string) => Math.round(value * minorUnits(currency));

function invoiceStatus(s: string | undefined, dueMinor: number | null, dueDate: string | null, today: string): InvoiceStatus {
  const v = (s ?? "").toLowerCase();
  if (v === "paid") return "paid";
  if (v === "void" || v === "voided" || v === "cancelled") return "void";
  if (v === "overdue" || v === "pastdue") return "overdue";
  if (v === "due" || v === "locked" || v === "issued") return dueDate && dueDate < today && (dueMinor ?? 1) > 0 ? "overdue" : "due";
  return "other";
}

/**
 * Invoices from Microsoft.Billing (api-version 2024-04-01). Microsoft
 * Customer Agreement invoices carry amount objects ({currency, value});
 * older MOSP invoices may carry plain numbers with a separate currency, or no
 * amounts at all (then totalMinor is null and the portal has the PDF).
 */
export function parseInvoices(account: string, value: ArmInvoice[] | undefined, today: string, businessOf: (name: string) => string | null = () => null): MsInvoice[] {
  return (value ?? [])
    .filter((i) => i.name || i.id)
    .map((i) => {
      const p = i.properties ?? {};
      const total = amountOf(p.totalAmount) ?? amountOf(p.billedAmount) ?? (() => {
        const sub = amountOf(p.subTotal);
        const tax = amountOf(p.taxAmount);
        return sub ? { value: sub.value + (tax?.value ?? 0), currency: sub.currency ?? tax?.currency ?? null } : null;
      })();
      const due = amountOf(p.amountDue);
      const currency = (total?.currency ?? due?.currency ?? p.currency ?? p.billingCurrency ?? null)?.toLowerCase() ?? null;
      const totalMinor = total && currency ? toMinor(total.value, currency) : null;
      const dueMinor = due && currency ? toMinor(due.value, currency) : null;
      const dueDate = day(p.dueDate);
      const profile = p.billingProfileDisplayName ?? null;
      return {
        id: `${account}/${i.name ?? i.id}`,
        account,
        number: i.name ?? (i.id ?? "").split("/").pop() ?? "",
        date: day(p.invoiceDate),
        periodStart: day(p.invoicePeriodStartDate),
        periodEnd: day(p.invoicePeriodEndDate),
        dueDate,
        status: invoiceStatus(p.status, dueMinor, dueDate, today),
        currency,
        totalMinor,
        dueMinor,
        profile,
        business: businessOf(profile ?? account),
        url: `${M365_ADMIN}#/billoverview/invoice-list`,
      };
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

/** Why Azure billing couldn't be read, in words the owner can act on. */
export function billingErrorMessage(status: number, code: string | undefined, account: string | null): string {
  const who = account ? ` (${account})` : "";
  if (status === 401 || status === 403 || code === "AuthorizationFailed" || code === "InvalidAuthenticationTokenTenant") {
    return `The signed-in admin${who} can't read billing. Give them the "Billing account reader" role (Microsoft 365 admin center → Billing → Billing accounts → Roles, or Azure Cost Management + Billing → Access control), then wait a few minutes.`;
  }
  return `Azure billing returned ${status}${code ? ` (${code})` : ""}. It will be retried in a few hours.`;
}

/** The message for a failed ARM token (consent missing, permission not added). */
export function armTokenMessage(error: string): string {
  if (/AADSTS65001|consent/i.test(error)) return "Admin consent for Azure Service Management (user_impersonation) is missing. Grant it in Entra, then reconnect Microsoft 365 admin.";
  if (/AADSTS650057|AADSTS70011|invalid_scope|not listed in the requested permissions/i.test(error)) return "Add the API permission \"Azure Service Management → user_impersonation\" to the app registration, grant admin consent, then reconnect.";
  if (/invalid_grant|AADSTS700082|AADSTS50173/i.test(error)) return "Microsoft 365 admin access expired or was revoked; reconnect it on Platforms.";
  return `Couldn't get an Azure billing token (${error.slice(0, 160)}).`;
}
