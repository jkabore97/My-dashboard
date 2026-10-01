"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/server/auth";
import { formatBusinessRules, formatSites, parseBusinessRules, parseSites } from "@/lib/server/config";
import { encrypt, randomToken } from "@/lib/server/crypto";
import { audit } from "@/lib/server/store/audit";
import { setSetting } from "@/lib/server/store/settings";
import type { WebhookProvider } from "@/lib/server/webhooks";

export interface SettingsState {
  error?: string;
  ok?: string;
  secret?: string;
}

const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export async function saveBusinessRules(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await requireUser();
  const text = String(form.get("rules") ?? "").slice(0, 10_000);
  const rules = parseBusinessRules(text, /\n/);
  await setSetting("business_rules", rules);
  await audit(user.email, "settings.business_rules", null, { count: rules.length });
  revalidatePath("/", "layout");
  return { ok: `Saved ${rules.length} rule${rules.length === 1 ? "" : "s"}.\n${formatBusinessRules(rules)}` };
}

export async function saveWebsites(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await requireUser();
  const sites = parseSites(String(form.get("sites") ?? "").slice(0, 10_000), /\n/);
  const bad = sites.find((s) => !DOMAIN.test(s.domain));
  if (bad) return { error: `"${bad.domain}" doesn't look like a domain name.` };
  const badRef = sites.find((s) => s.supabaseRef && !/^[a-z0-9]{10,40}$/.test(s.supabaseRef));
  if (badRef) return { error: `"${badRef.supabaseRef}" doesn't look like a Supabase project ref.` };
  await setSetting("websites", sites);
  await audit(user.email, "settings.websites", null, { count: sites.length });
  revalidatePath("/", "layout");
  return { ok: `Saved ${sites.length} site${sites.length === 1 ? "" : "s"}.\n${formatSites(sites)}` };
}

const PROVIDERS: WebhookProvider[] = ["github", "vercel", "stripe", "supabase"];

export async function saveWebhookSecret(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await requireUser();
  const provider = String(form.get("provider")) as WebhookProvider;
  if (!PROVIDERS.includes(provider)) return { error: "Unknown provider." };
  const generate = form.get("generate") === "1";
  const secret = generate ? randomToken(32) : String(form.get("secret") ?? "").trim();
  if (!generate && secret.length < 16) return { error: "Paste the full signing secret (16+ characters)." };
  await setSetting(`webhook_secret:${provider}`, encrypt(secret));
  await audit(user.email, "settings.webhook_secret", provider, { generated: generate });
  revalidatePath("/platforms");
  return generate ? { ok: "New secret generated. Copy it now; it won't be shown again.", secret } : { ok: "Secret saved." };
}
