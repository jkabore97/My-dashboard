import { ROLE_SECTIONS, type Role, type Section } from "@/lib/access";

/** Identity color per role (never red/orange). */
export const ROLE_COLOR: Record<Role, string> = { developer: "#a98bff", assistant: "#3fd0ff", accountant: "#ffd84d", owner: "#ff5fd7" };

/** Rows of the "what each role sees" matrix: a label and the sections it covers. */
export const ROLE_MATRIX_ROWS: { label: string; sections: Section[] }[] = [
  { label: "Inbox · Agenda", sections: ["inbox", "agenda"] },
  { label: "Money · Reports", sections: ["money", "reports"] },
  { label: "Clients · Deadlines", sections: ["clients", "deadlines"] },
  { label: "Web · Build", sections: ["websites", "domains", "security", "analytics", "repos", "hosting", "databases"] },
  { label: "Cameras · Solar", sections: ["cameras", "solar"] },
  { label: "Platforms · Team", sections: ["platforms", "team"] },
];

/** Pure: does this role see all, some or none of the row's sections? */
export function roleCoverage(role: Role, sections: Section[]): "all" | "some" | "none" {
  const n = sections.filter((s) => ROLE_SECTIONS[role].includes(s)).length;
  return n === 0 ? "none" : n === sections.length ? "all" : "some";
}

export const initials = (nameOrEmail: string) => {
  const base = nameOrEmail.includes("@") ? nameOrEmail.split("@")[0].replace(/[._-]+/g, " ") : nameOrEmail;
  const parts = base.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? "")).toUpperCase();
};

/** Pure: the page names a role can open, in navigation order (for the invite page). */
export function roleSectionLabels(role: Role, groups: { pages: { href: string; label: string }[] }[], pathSection: Record<string, Section>): string[] {
  const seen = new Set<Section>();
  const out: string[] = [];
  for (const g of groups) {
    for (const p of g.pages) {
      const s = pathSection[p.href];
      if (!s || !ROLE_SECTIONS[role].includes(s) || seen.has(s)) continue;
      seen.add(s);
      out.push(p.label);
    }
  }
  return out;
}
