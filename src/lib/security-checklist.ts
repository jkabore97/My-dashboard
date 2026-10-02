// Accounts whose two-factor sign-in the dashboard can't read through an API.
// You confirm each one on the Security page; the confirmation expires after a
// year so it gets re-checked.
export interface ChecklistItem {
  id: string;
  name: string;
  url: string | null;
  /** Which source (collect().modes key) proves you use this platform. */
  usedWhen: string;
}

export const ACCOUNT_CHECKLIST: ChecklistItem[] = [
  { id: "google", name: "Google account (Gmail / Workspace)", url: "https://myaccount.google.com/signinoptions/two-step-verification", usedWhen: "gmail" },
  { id: "vercel", name: "Vercel", url: "https://vercel.com/account/security", usedWhen: "vercel" },
  { id: "cloudflare", name: "Cloudflare", url: "https://dash.cloudflare.com/profile/authentication", usedWhen: "workers" },
  { id: "supabase", name: "Supabase", url: "https://supabase.com/dashboard/account/security", usedWhen: "supabase" },
  { id: "stripe", name: "Stripe", url: "https://dashboard.stripe.com/settings/user", usedWhen: "stripe" },
  { id: "registrar", name: "Domain registrar", url: null, usedWhen: "domains" },
];

export const CONFIRMATION_VALID_DAYS = 365;
