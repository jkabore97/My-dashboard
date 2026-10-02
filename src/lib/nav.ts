// Sections grouped for the rail and the sub-navigation. Group colors are identity
// colors (never red/orange, which mean "problem").
export interface NavPage { href: string; label: string }
export interface NavGroup { id: string; label: string; color: string; pages: NavPage[] }

export const NAV_GROUPS: NavGroup[] = [
  { id: "core", label: "Command", color: "#3fd0ff", pages: [
    { href: "/", label: "Overview" }, { href: "/tasks", label: "To-do" }, { href: "/inbox", label: "Inbox" },
    { href: "/agenda", label: "Agenda" }, { href: "/notifications", label: "Alerts" }, { href: "/ask", label: "Ask" },
  ] },
  { id: "money", label: "Treasury", color: "#ffd84d", pages: [
    { href: "/money", label: "Money" }, { href: "/spend", label: "Platform spend" }, { href: "/clients", label: "Clients" },
    { href: "/deadlines", label: "Deadlines" }, { href: "/reports", label: "Reports" },
  ] },
  { id: "web", label: "Web", color: "#2ef2d0", pages: [
    { href: "/websites", label: "Websites" }, { href: "/domains", label: "Domains" }, { href: "/analytics", label: "Analytics" }, { href: "/security", label: "Security" },
  ] },
  { id: "build", label: "Build", color: "#a98bff", pages: [
    { href: "/repos", label: "Repos" }, { href: "/hosting", label: "Hosting" }, { href: "/databases", label: "Databases" },
  ] },
  { id: "sites", label: "Sites", color: "#c6f432", pages: [{ href: "/cameras", label: "Cameras" }, { href: "/solar", label: "Solar" }] },
  { id: "admin", label: "Admin", color: "#ff5fd7", pages: [{ href: "/platforms", label: "Platforms" }, { href: "/team", label: "Team" }, { href: "/settings", label: "Settings" }] },
];

export const pageActive = (href: string, path: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

export function groupFor(path: string): NavGroup {
  return NAV_GROUPS.find((g) => g.pages.some((p) => pageActive(p.href, path))) ?? NAV_GROUPS[0];
}

/** The groups and pages this person may open. */
export function visibleNav(allowed: string[]): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, pages: g.pages.filter((p) => allowed.includes(p.href)) })).filter((g) => g.pages.length > 0);
}
