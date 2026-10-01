import { cache } from "react";
import { env } from "../source";
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
  try {
    rules = await getSetting<BusinessRule[] | null>("business_rules", null);
    sites = await getSetting<SiteConfig[] | null>("websites", null);
  } catch {
    /* database unavailable: env only */
  }
  return {
    businessRules: rules ?? parseBusinessRules(env("BUSINESS_MAP") ?? ""),
    sites: sites ?? parseSites(env("WEBSITES") ?? ""),
  };
});

export function businessFor(name: string, rules: BusinessRule[]): string | undefined {
  const n = name.toLowerCase();
  return rules.find((r) => n.includes(r.match.toLowerCase()))?.business;
}
