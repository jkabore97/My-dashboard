"use server";

import { revalidatePath } from "next/cache";
import { businessDenied, requireSection } from "@/lib/server/auth";
import { getConfig } from "@/lib/server/config";
import { audit } from "@/lib/server/store/audit";
import { rowBusiness } from "@/lib/server/store/ownership";
import { createPortal, portalClientId, revokePortal } from "@/lib/server/store/portals";
import { appUrl } from "@/lib/server/reports";
import { inBusiness } from "@/lib/access";

export interface PortalState {
  error?: string;
  ok?: string;
  link?: string;
  at?: number;
}

/** Creates (or replaces) a client's read-only status link. */
export async function createPortalAction(_prev: PortalState, f: FormData): Promise<PortalState> {
  const user = await requireSection("clients");
  const clientId = String(f.get("clientId") ?? "");
  const business = await rowBusiness("clients", clientId);
  if (business === undefined) return { error: "That client no longer exists." };
  const denied = businessDenied(user, business);
  if (denied) return { error: denied };
  // Only sites the dashboard monitors, and only ones this person can see.
  const { sites } = await getConfig();
  const allowed = new Set(sites.filter((s) => inBusiness(user, s.business)).map((s) => s.domain));
  const chosen = [...new Set(f.getAll("sites").map(String))].filter((d) => allowed.has(d));
  const showProjects = f.get("showProjects") === "on";
  if (!chosen.length && !showProjects) return { error: "Pick at least one site, or show projects." };
  const { token, portal } = await createPortal({ clientId, sites: chosen, showProjects, by: user.email });
  await audit(user.email, "portal.create", clientId, { id: portal.id, sites: chosen, showProjects });
  revalidatePath("/clients");
  return { ok: "Status page ready. Send the client this link; it's shown only now (make a new one if you lose it). Any earlier link for this client stopped working.", link: `${appUrl()}/c/${token}`, at: Date.now() };
}

export async function revokePortalAction(id: string): Promise<PortalState> {
  const user = await requireSection("clients");
  const clientId = await portalClientId(id);
  if (!clientId) return { error: "That link no longer exists." };
  const denied = businessDenied(user, await rowBusiness("clients", clientId));
  if (denied) return { error: denied };
  await revokePortal(id);
  await audit(user.email, "portal.revoke", clientId, { id });
  revalidatePath("/clients");
  return { ok: "Link turned off.", at: Date.now() };
}
