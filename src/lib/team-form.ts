import { customSections, parseBusinessList, ROLES, type Role, type Section } from "./access";

// Reads the invite / change-access form. Pure, so it's unit-tested.

const text = (f: FormData, k: string, max: number) => String(f.get(k) ?? "").trim().slice(0, max);

export type AccessInput = { role: Role; businesses: string[] | null; sections: Section[] | null };

/**
 * Role, businesses and the picked sections. The section checkboxes start
 * from the role; ticks that match it exactly store nothing (the person keeps
 * following the role). Owner-only sections can't be picked, and an owner's
 * role is everything, so neither ever comes from here.
 */
export function accessFromForm(f: FormData): AccessInput | { error: string } {
  const role = text(f, "role", 20) as Role;
  if (!ROLES.includes(role)) return { error: "Pick a role." };
  // A form without the section checkboxes (an older page) keeps the role's.
  const sections = f.get("sectionsShown") === "1" ? customSections(role, f.getAll("sections").map(String)) : null;
  if (f.get("allBusinesses") === "on") return { role, businesses: null, sections };
  const businesses = parseBusinessList([...f.getAll("businesses").map(String), ...text(f, "otherBusinesses", 400).split(",")]);
  if (!businesses) return { error: "Pick at least one business, or All businesses." };
  if (businesses.length > 30) return { error: "That's too many businesses." };
  return { role, businesses, sections };
}
