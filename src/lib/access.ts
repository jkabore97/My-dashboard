// Team access: what each role can open, and which businesses a person sees.
// Pure, so pages, actions, the sidebar and tests share one definition.
//
// Roles decide the sections; a business list (null = every business) decides
// the rows inside them. Anything with no business attached (a domain nobody
// mapped, a manual task without a business) is only shown to people who see
// every business, so a scoped teammate never sees another business's data by
// accident.

export type Role = "owner" | "developer" | "assistant" | "accountant";
export const ROLES: Role[] = ["owner", "developer", "assistant", "accountant"];

export type Section =
  | "overview" | "tasks" | "ask" | "inbox" | "notifications" | "agenda" | "money" | "clients" | "deadlines" | "analytics"
  | "websites" | "domains" | "security" | "repos" | "hosting" | "databases" | "cameras" | "solar" | "reports"
  | "platforms" | "team" | "settings";

/** Personal pages everyone has (their own 2FA, devices, sign-out). */
const EVERYONE: Section[] = ["overview", "tasks", "settings"];

export const ROLE_SECTIONS: Record<Role, readonly Section[]> = {
  owner: ["overview", "tasks", "ask", "inbox", "notifications", "agenda", "money", "clients", "deadlines", "analytics", "websites", "domains", "security", "repos", "hosting", "databases", "cameras", "solar", "reports", "platforms", "team", "settings"],
  developer: [...EVERYONE, "ask", "notifications", "analytics", "websites", "domains", "security", "repos", "hosting", "databases"],
  assistant: [...EVERYONE, "ask", "inbox", "notifications", "agenda", "clients", "deadlines", "cameras", "solar"],
  accountant: [...EVERYONE, "ask", "money", "deadlines", "clients", "reports"],
};

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", developer: "Developer", assistant: "Assistant", accountant: "Accountant" };

export const ROLE_DESCRIPTION: Record<Role, string> = {
  owner: "Everything, including connections, settings, the team and the audit log.",
  developer: "Repos, hosting, databases, websites, domains, security, analytics and their tasks.",
  assistant: "Inbox, agenda (every connected calendar, whatever the business), clients, deadlines, cameras, solar and their tasks.",
  accountant: "Money, invoices, subscriptions, deadlines, clients and weekly reports.",
};

export interface Access {
  role: Role;
  /** Businesses this person sees; null means all of them. */
  businesses: string[] | null;
}

export const OWNER_ACCESS: Access = { role: "owner", businesses: null };

export const canSee = (a: Access, section: Section) => ROLE_SECTIONS[a.role].includes(section);

export const allBusinesses = (a: Access) => a.businesses === null;

/** Whether a row tagged with this business is visible. Untagged rows need access to every business. */
export const inBusiness = (a: Access, business: string | null | undefined) => a.businesses === null || (!!business && a.businesses.includes(business));

/** Owners with every business: the only people who manage connections, settings and the team. */
export const isFullOwner = (a: Access) => a.role === "owner" && a.businesses === null;

/** The page a path belongs to, for the sidebar. */
export const PATH_SECTION: Record<string, Section> = {
  "/": "overview", "/tasks": "tasks", "/ask": "ask", "/inbox": "inbox", "/notifications": "notifications", "/agenda": "agenda",
  "/money": "money", "/clients": "clients", "/deadlines": "deadlines", "/analytics": "analytics", "/websites": "websites",
  "/domains": "domains", "/security": "security", "/repos": "repos", "/hosting": "hosting", "/databases": "databases",
  "/cameras": "cameras", "/solar": "solar", "/reports": "reports", "/platforms": "platforms", "/team": "team", "/settings": "settings",
};

// Task scopes (derived "scope/key") and webhook key prefixes → the section they belong to.
const SCOPE_SECTION: Record<string, Section> = {
  connector: "platforms", github: "repos", vercel: "hosting", workers: "hosting", supabase: "databases", d1: "databases",
  gmail: "inbox", outlook: "inbox", websites: "websites", stripe: "money", invoices: "money", subscriptions: "money",
  deadlines: "deadlines", checklist: "security", domains: "domains", security: "security", pipeline: "clients",
  reviews: "analytics", analytics: "analytics", cameras: "cameras", solar: "solar",
};
const EVENT_PREFIX: [string, Section][] = [
  ["github-ci:", "repos"], ["github-dependabot:", "security"], ["github-secret:", "security"],
  ["stripe-", "money"], ["hikvision:", "cameras"], ["supabase-", "databases"], ["vercel-", "hosting"],
];

/** Section a task belongs to; manual and unknown tasks are general ("tasks"). */
export function taskSection(sourceKey: string | null | undefined): Section {
  if (!sourceKey) return "tasks";
  const scope = sourceKey.match(/^([a-z0-9]+)\//)?.[1];
  if (scope && SCOPE_SECTION[scope]) return SCOPE_SECTION[scope];
  return EVENT_PREFIX.find(([p]) => sourceKey.startsWith(p))?.[1] ?? "tasks";
}

/**
 * A task is visible when it's assigned to you, or when you can open its
 * section and see its business.
 */
export function canSeeTask(a: Access, email: string, t: { business?: string | null; sourceKey?: string | null; assignee?: string | null }) {
  if (t.assignee && t.assignee === email) return true;
  return canSee(a, taskSection(t.sourceKey)) && inBusiness(a, t.business);
}

/** Section an event (notification) belongs to, from its source label. */
export function eventSection(source: string): Section {
  if (/^(Email|Outlook)\b/.test(source)) return "inbox";
  if (/^Stripe/.test(source)) return "money";
  if (/^GitHub security/.test(source)) return "security";
  if (/^GitHub/.test(source)) return "repos";
  if (/^(Vercel|Cloudflare)/.test(source)) return "hosting";
  if (/^Supabase/.test(source)) return "databases";
  if (/^Website monitor/.test(source)) return "websites";
  if (/^Cameras/.test(source)) return "cameras";
  if (/^Solar/.test(source)) return "solar";
  if (/^Google reviews/.test(source)) return "analytics";
  return "notifications";
}

/** Parses a business list from a form: blank means every business. */
export function parseBusinessList(values: string[]): string[] | null {
  const list = [...new Set(values.map((v) => v.trim().slice(0, 80)).filter(Boolean))];
  return list.length ? list.sort() : null;
}
