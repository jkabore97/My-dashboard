import { ALWAYS, OWNER_ONLY, ROLE_SECTIONS, sectionsFor, type Access, type Role, type Section } from "@/lib/access";

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
  return coverage(ROLE_SECTIONS[role], sections);
}

/** Pure: does this list cover all, some or none of the row's sections? */
export function coverage(allowed: readonly Section[], sections: Section[]): "all" | "some" | "none" {
  const n = sections.filter((s) => allowed.includes(s)).length;
  return n === 0 ? "none" : n === sections.length ? "all" : "some";
}

export const initials = (nameOrEmail: string) => {
  const base = nameOrEmail.includes("@") ? nameOrEmail.split("@")[0].replace(/[._-]+/g, " ") : nameOrEmail;
  const parts = base.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? "")).toUpperCase();
};

type Groups = { id?: string; label?: string; color?: string; pages: { href: string; label: string }[] }[];

/** Pure: the page names this person can open, in navigation order (invite page and email). */
export function sectionLabels(a: Access, groups: Groups, pathSection: Record<string, Section>): string[] {
  const allowed = sectionsFor(a);
  const seen = new Set<Section>();
  const out: string[] = [];
  for (const g of groups) {
    for (const p of g.pages) {
      const s = pathSection[p.href];
      if (!s || !allowed.includes(s) || seen.has(s)) continue;
      seen.add(s);
      out.push(p.label);
    }
  }
  return out;
}

/** Pure: the page names a role can open, in navigation order. */
export const roleSectionLabels = (role: Role, groups: Groups, pathSection: Record<string, Section>) => sectionLabels({ role, businesses: null }, groups, pathSection);

export interface SectionChoice {
  section: Section;
  /** The pages it opens ("Money · Platform spend"). */
  label: string;
  /** Always on (personal pages) or never pickable (owner only). */
  fixed: "always" | "owner" | null;
}

/** Pure: the section checkboxes, grouped like the navigation. */
export function sectionChoices(groups: Required<Groups[number]>[], pathSection: Record<string, Section>): { id: string; label: string; color: string; items: SectionChoice[] }[] {
  return groups.map((g) => {
    const items = new Map<Section, string[]>();
    for (const p of g.pages) {
      const s = pathSection[p.href];
      if (s) items.set(s, [...(items.get(s) ?? []), p.label]);
    }
    return {
      id: g.id,
      label: g.label,
      color: g.color,
      items: [...items].map(([section, labels]) => ({ section, label: labels.join(" · "), fixed: ALWAYS.includes(section) ? ("always" as const) : OWNER_ONLY.includes(section) ? ("owner" as const) : null })),
    };
  });
}
