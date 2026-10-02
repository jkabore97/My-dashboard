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
  /**
   * Sections picked for this person, replacing the role's; null or missing
   * means the role's own. Owner-only sections are never granted this way.
   */
  sections?: Section[] | null;
}

export const OWNER_ACCESS: Access = { role: "owner", businesses: null, sections: null };

/** Sections only a full owner opens (connections and the team). A custom list can't include them. */
export const OWNER_ONLY: readonly Section[] = ["platforms", "team"];
/** Personal pages everyone keeps, whatever is picked. */
export const ALWAYS: readonly Section[] = EVERYONE;
/** Every section, in navigation order. */
export const ALL_SECTIONS: readonly Section[] = ROLE_SECTIONS.owner;
/** Sections that can be ticked for a person. */
export const GRANTABLE: readonly Section[] = ALL_SECTIONS.filter((s) => !OWNER_ONLY.includes(s) && !ALWAYS.includes(s));

/** Cleans a picked list: only grantable sections, once each, in a fixed order. */
export function normalizeSections(values: readonly string[]): Section[] {
  const set = new Set(values.map((v) => v.trim()));
  return GRANTABLE.filter((s) => set.has(s));
}

/** The grantable part of a role's sections (what the checkboxes start from). */
export const roleDefaultSections = (role: Role): Section[] => GRANTABLE.filter((s) => ROLE_SECTIONS[role].includes(s));

/**
 * The custom list to store for a form's picks: null when it matches the role
 * (so the person follows the role), and always null for owners, whose role
 * is everything.
 */
export function customSections(role: Role, picked: readonly string[]): Section[] | null {
  if (role === "owner") return null;
  const list = normalizeSections(picked);
  const def = roleDefaultSections(role);
  return list.length === def.length && list.every((s, i) => s === def[i]) ? null : list;
}

/**
 * What this person may open. Full owners: everything. A custom list replaces
 * the role's sections, plus the personal pages; it never adds owner-only ones.
 * The one place access is decided: canSee, the sidebar, alerts and pushes all
 * come through here.
 */
export function sectionsFor(a: Access): readonly Section[] {
  if (isFullOwner(a)) return ROLE_SECTIONS.owner;
  if (a.role !== "owner" && Array.isArray(a.sections)) {
    const picked = normalizeSections(a.sections);
    return ALL_SECTIONS.filter((s) => ALWAYS.includes(s) || picked.includes(s));
  }
  return ROLE_SECTIONS[a.role];
}

export const canSee = (a: Access, section: Section) => sectionsFor(a).includes(section);

/** Whether the person may connect their own mailbox / calendar. */
export const canConnectPersonal = (a: Access) => canSee(a, "inbox") || canSee(a, "agenda");

export const allBusinesses = (a: Access) => a.businesses === null;

/** Whether a row tagged with this business is visible. Untagged rows need access to every business. */
export const inBusiness = (a: Access, business: string | null | undefined) => a.businesses === null || (!!business && a.businesses.includes(business));

/** Owners with every business: the only people who manage connections, settings and the team. */
export function isFullOwner(a: Access) {
  return a.role === "owner" && a.businesses === null;
}

/** The page a path belongs to, for the sidebar. */
export const PATH_SECTION: Record<string, Section> = {
  "/": "overview", "/tasks": "tasks", "/ask": "ask", "/inbox": "inbox", "/notifications": "notifications", "/agenda": "agenda",
  "/money": "money", "/spend": "money", "/clients": "clients", "/deadlines": "deadlines", "/analytics": "analytics", "/websites": "websites",
  "/domains": "domains", "/security": "security", "/repos": "repos", "/hosting": "hosting", "/databases": "databases",
  "/cameras": "cameras", "/solar": "solar", "/reports": "reports", "/platforms": "platforms", "/team": "team", "/settings": "settings",
};

// Task scopes (derived "scope/key") and webhook key prefixes → the section they belong to.
const SCOPE_SECTION: Record<string, Section> = {
  connector: "platforms", github: "repos", vercel: "hosting", workers: "hosting", supabase: "databases", d1: "databases",
  gmail: "inbox", outlook: "inbox", mymail: "inbox", websites: "websites", stripe: "money", invoices: "money", subscriptions: "money",
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

export interface TaskVisibility {
  business?: string | null;
  sourceKey?: string | null;
  assignee?: string | null;
  /** Personal tasks (from someone's own mailbox): only that person, never anyone else, owners included. */
  privateTo?: string | null;
}

/**
 * A personal task is visible to its owner only (while they can open its
 * section; a "reconnect your mailbox" task always). Any other task is visible
 * when it's assigned to you, or when you can open its section and see its business.
 */
export function canSeeTask(a: Access, email: string, t: TaskVisibility) {
  if (t.privateTo) return t.privateTo === email && (canSee(a, taskSection(t.sourceKey)) || !!t.sourceKey?.endsWith("/reconnect"));
  if (t.assignee && t.assignee === email) return true;
  return canSee(a, taskSection(t.sourceKey)) && inBusiness(a, t.business);
}

/** Items carrying an owner (personal mail, calendar events, their notifications) are for that person alone. */
export const ownItem = (email: string) => (x: { owner?: string | null }) => !x.owner || x.owner === email;

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
