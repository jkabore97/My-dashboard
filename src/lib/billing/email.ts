import { minorUnits } from "../money";
import type { EmailMessage } from "../types";
import type { DetectedBill } from "./types";

// Bills recognised in shared mailboxes: invoice and receipt e-mails from
// known senders. Extraction is deliberately conservative: a message counts
// only when it comes from the vendor's own domain (or Stripe on its behalf),
// talks about an invoice / receipt / payment, and names exactly one amount
// with an unambiguous currency. Personal mailboxes are never read here.

/** Groups vendor names so manual entries, API bills and e-mails line up. */
export function vendorKey(name: string): string {
  const n = name.toLowerCase();
  if (/google\s*workspace|g\s?suite/.test(n)) return "google-workspace";
  if (/google\s*cloud|\bgcp\b|firebase|cloud platform/.test(n)) return "google-cloud";
  if (/microsoft|office\s*365|\bm365\b|azure|exchange online|\bentra\b/.test(n)) return "microsoft";
  if (/claude|anthropic/.test(n)) return "anthropic";
  if (/github|copilot/.test(n)) return "github";
  if (/stripe/.test(n)) return "stripe";
  return n.replace(/\b(inc|llc|ltd|pbc|corp|corporation|limited)\b\.?/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

interface Sender {
  /** Sender domains (the address must be @domain or @sub.domain). */
  domains: string[];
  vendor: (text: string) => string;
  /** Extra words the subject must have (on top of the billing words). */
  subject?: RegExp;
}

const fixed = (v: string) => () => v;

const SENDERS: Sender[] = [
  {
    domains: ["google.com"],
    vendor: (t) => (/google\s*workspace|g\s?suite/i.test(t) ? "Google Workspace" : /google\s*cloud|cloud platform|firebase/i.test(t) ? "Google Cloud" : /google\s*play/i.test(t) ? "Google Play" : /google\s*one/i.test(t) ? "Google One" : /domains/i.test(t) ? "Google Domains" : "Google"),
  },
  { domains: ["microsoft.com"], vendor: (t) => (/azure/i.test(t) ? "Microsoft Azure" : "Microsoft") },
  { domains: ["vercel.com"], vendor: fixed("Vercel") },
  { domains: ["supabase.com", "supabase.io"], vendor: fixed("Supabase") },
  { domains: ["github.com"], vendor: fixed("GitHub"), subject: /receipt|payment|billing|invoice/i },
  { domains: ["cloudflare.com"], vendor: fixed("Cloudflare") },
  { domains: ["anthropic.com"], vendor: fixed("Anthropic") },
  { domains: ["resend.com", "resend.dev"], vendor: fixed("Resend") },
  { domains: ["twilio.com"], vendor: fixed("Twilio") },
  { domains: ["namecheap.com"], vendor: fixed("Namecheap") },
  { domains: ["godaddy.com"], vendor: fixed("GoDaddy") },
  { domains: ["squarespace.com"], vendor: fixed("Squarespace") },
  { domains: ["starlink.com", "spacex.com"], vendor: fixed("Starlink") },
  { domains: ["apple.com"], vendor: (t) => (/developer/i.test(t) ? "Apple Developer Program" : "Apple") },
  { domains: ["zoom.us", "zoom.com"], vendor: fixed("Zoom") },
  { domains: ["canva.com"], vendor: fixed("Canva") },
  { domains: ["intuit.com", "quickbooks.com"], vendor: fixed("QuickBooks") },
  { domains: ["hik-connect.com", "hikvision.com"], vendor: fixed("Hik-Connect") },
  { domains: ["neon.tech"], vendor: fixed("Neon") },
];

/** Vendors whose receipts Stripe sends ("Your receipt from Vercel Inc. #1234"). */
const STRIPE_VENDORS: [RegExp, string][] = [
  [/vercel/i, "Vercel"], [/supabase/i, "Supabase"], [/anthropic/i, "Anthropic"], [/github/i, "GitHub"], [/cloudflare/i, "Cloudflare"],
  [/resend/i, "Resend"], [/neon/i, "Neon"], [/canva/i, "Canva"], [/openai/i, "OpenAI"], [/linear/i, "Linear"], [/notion/i, "Notion"],
];

const BILLING_WORDS = /\b(invoice|receipt|payment|billing statement|your bill|statement|order confirmation|charged|renewal)\b/i;
// Not a confirmed charge: failures, refunds, trials and future reminders.
const NOT_A_BILL = /fail|declin|unsuccessful|refund|credit note|trial|upcoming|will be charged|will renew|update your payment|action required|expir/i;

const SYMBOL: Record<string, string> = { "US$": "usd", "CA$": "cad", "C$": "cad", "A$": "aud", "AU$": "aud", "NZ$": "nzd", "S$": "sgd", "HK$": "hkd", "$": "usd", "€": "eur", "£": "gbp" };
const CODES = "USD|EUR|GBP|CAD|AUD|CHF|NZD|SGD|HKD|XOF|JPY";

const NUM = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\d,.]*\d)`;
const PREFIX = new RegExp(String.raw`(?<![A-Za-z])(US\$|CA\$|C\$|AU\$|A\$|NZ\$|HK\$|S\$|\$|€|£|(?:${CODES})\s)\s?${NUM}`, "g");
const SUFFIX = new RegExp(String.raw`(?<![\d.,])(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+\.\d{2})\s?(${CODES}|€|£)(?![A-Za-z])`, "g");

/** Every amount in the text with a clear currency, de-duplicated. */
export function amountsIn(text: string): { currency: string; amountMinor: number }[] {
  const found = new Map<string, { currency: string; amountMinor: number }>();
  const add = (cur: string, num: string) => {
    const currency = (SYMBOL[cur.trim()] ?? cur.trim()).toLowerCase();
    if (!/^[a-z]{3}$/.test(currency)) return;
    const value = Number(num.replace(/,/g, ""));
    if (!Number.isFinite(value)) return;
    const amountMinor = Math.round(value * minorUnits(currency));
    found.set(`${currency}:${amountMinor}`, { currency, amountMinor });
  };
  for (const m of text.matchAll(PREFIX)) add(m[1], m[2]);
  for (const m of text.matchAll(SUFFIX)) add(m[2], m[1]);
  return [...found.values()];
}

const onDomain = (domain: string, base: string) => domain === base || domain.endsWith(`.${base}`);
const senderAddress = (from: string) => (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();

/**
 * Whether the message's Authentication-Results vouch for the From domain:
 * DMARC pass, or a passing DKIM signature / SPF check aligned with it. "unknown"
 * when no header was available (the inbox listing doesn't carry headers).
 */
export function senderAuth(header: string | null | undefined, fromDomain: string): "pass" | "fail" | "unknown" {
  if (!header || !header.trim()) return "unknown";
  const h = header.toLowerCase();
  if (/\bdmarc=pass\b/.test(h)) return "pass";
  const aligned = (d: string) => !!d && (fromDomain === d || fromDomain.endsWith(`.${d}`) || d.endsWith(`.${fromDomain}`));
  for (const m of h.matchAll(/\bdkim=pass\b[^;]*?header\.[di]=@?([a-z0-9.-]+)/g)) if (aligned(m[1])) return "pass";
  for (const m of h.matchAll(/\bspf=pass\b[^;]*?smtp\.mailfrom=(?:[^@\s;]*@)?([a-z0-9.-]+)/g)) if (aligned(m[1])) return "pass";
  return "fail";
}

export type BillInput = Pick<EmailMessage, "id" | "from" | "subject" | "snippet" | "receivedAt" | "account" | "url" | "business" | "owner"> & {
  /** Authentication-Results header(s), when the mailbox API returned them. */
  auth?: string | null;
};

/** A bill in one e-mail, or null when it isn't one, the amount isn't unambiguous, or the sender failed authentication. */
export function detectBill(e: BillInput): DetectedBill | null {
  if (e.owner) return null; // someone's own mailbox: never
  const address = senderAddress(e.from);
  const domain = address.split("@")[1] ?? "";
  if (!domain) return null;
  const text = `${e.subject} ${e.snippet}`;
  if (!BILLING_WORDS.test(text) || NOT_A_BILL.test(e.subject)) return null;

  let vendor: string | null = null;
  if (onDomain(domain, "stripe.com")) {
    const named = /receipt from ([^#\n]+?)(?:\s*#|\s*$)/i.exec(e.subject)?.[1] ?? "";
    vendor = STRIPE_VENDORS.find(([re]) => re.test(named))?.[1] ?? null;
  } else {
    const s = SENDERS.find((x) => x.domains.some((d) => onDomain(domain, d)));
    if (s && (!s.subject || s.subject.test(e.subject))) vendor = s.vendor(text);
  }
  if (!vendor) return null;
  const auth = senderAuth(e.auth, domain);
  if (auth === "fail") return null; // spoofed or unauthenticated sender

  const amounts = amountsIn(text).filter((a) => a.amountMinor > 0);
  if (amounts.length !== 1) return null; // none, or several: ambiguous
  const [{ currency, amountMinor }] = amounts;
  return {
    id: e.id,
    vendor,
    vendorKey: vendorKey(vendor),
    amountMinor,
    currency,
    date: e.receivedAt.slice(0, 10),
    interval: /\b(annual|yearly|per year|\/yr|12 months)\b/i.test(text) ? "year" : "month",
    verified: auth === "pass",
    subject: e.subject.slice(0, 160),
    account: e.account,
    business: e.business ?? null,
    url: e.url ?? null,
  };
}

/** Bills from a list of messages: shared mailboxes only, newest first, one per message. */
export function detectBills(emails: BillInput[]): DetectedBill[] {
  const seen = new Set<string>();
  const out: DetectedBill[] = [];
  for (const e of emails) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const b = detectBill(e);
    if (b) out.push(b);
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.vendor.localeCompare(b.vendor));
}
