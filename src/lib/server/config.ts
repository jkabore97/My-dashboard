import { cache } from "react";
import { env } from "../source";
import { DEFAULT_DKIM_SELECTORS } from "./domains";
import { getSetting } from "./store/settings";

export interface BusinessRule {
  match: string;
  business: string;
}

export interface SiteConfig {
  domain: string;
  business: string;
  supabaseRef?: string;
}

// Parsing is shared by env vars and the Settings page so both accept the same
// format.
export function parseBusinessRules(text: string, separator: RegExp = /[,\n]/): BusinessRule[] {
  return text
    .split(separator)
    .map((line) => line.split("=").map((s) => s.trim()))
    .filter(([match, business]) => match && business)
    .map(([match, business]) => ({ match, business }));
}

export function parseSites(text: string, separator: RegExp = /[;\n]/): SiteConfig[] {
  return text
    .split(separator)
    .map((line) => line.split("|").map((s) => s.trim()))
    .filter(([domain]) => !!domain)
    .map(([domain, business, supabaseRef]) => ({
      domain: domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase(),
      business: business || "Unassigned",
      ...(supabaseRef ? { supabaseRef } : {}),
    }));
}

export const formatBusinessRules = (rules: BusinessRule[]) => rules.map((r) => `${r.match} = ${r.business}`).join("\n");
export const formatSites = (sites: SiteConfig[]) =>
  sites.map((s) => [s.domain, s.business, s.supabaseRef].filter(Boolean).join(" | ")).join("\n");

export const getConfig = cache(async () => {
  let rules: BusinessRule[] | null = null;
  let sites: SiteConfig[] | null = null;
  let extraDomains: string[] | null = null;
  let dkimSelectors: string[] | null = null;
  try {
    [rules, sites, extraDomains, dkimSelectors] = await Promise.all([
      getSetting<BusinessRule[] | null>("business_rules", null),
      getSetting<SiteConfig[] | null>("websites", null),
      getSetting<string[] | null>("domains_extra", null),
      getSetting<string[] | null>("dkim_selectors", null),
    ]);
  } catch {
    /* database unavailable: env only */
  }
  const resolvedSites = sites ?? parseSites(env("WEBSITES") ?? "");
  const extras = extraDomains ?? parseDomainList(env("EXTRA_DOMAINS") ?? "");
  return {
    businessRules: rules ?? parseBusinessRules(env("BUSINESS_MAP") ?? ""),
    sites: resolvedSites,
    extraDomains: extras,
    /** Every host to watch for registration, certificate and email health. */
    domains: [...new Set([...resolvedSites.map((s) => s.domain), ...extras])].filter((d) => !onSharedHost(d)),
    dkimSelectors: dkimSelectors ?? DEFAULT_DKIM_SELECTORS,
  };
});

export function parseDomainList(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean))];
}

/** Which business a domain belongs to, from the websites list. */
/**
 * Free addresses on a hosting platform (my-site.vercel.app): their registration,
 * certificate and email belong to the platform, so only uptime is watched.
 */
const SHARED_HOSTS = ["vercel.app", "workers.dev", "pages.dev", "netlify.app", "github.io", "onrender.com", "fly.dev", "herokuapp.com", "web.app", "firebaseapp.com", "supabase.co", "railway.app"];
export const onSharedHost = (domain: string) => SHARED_HOSTS.some((h) => domain === h || domain.endsWith(`.${h}`));

export function businessForDomain(domain: string, sites: SiteConfig[]): string | undefined {
  return sites.find((s) => s.domain === domain || domain.endsWith(`.${s.domain}`) || s.domain.endsWith(`.${domain}`))?.business;
}

export function businessFor(name: string, rules: BusinessRule[]): string | undefined {
  const n = name.toLowerCase();
  return rules.find((r) => n.includes(r.match.toLowerCase()))?.business;
}
