"use server";

import { revalidatePath } from "next/cache";
import { businessDenied, requireOwner, requireSection } from "@/lib/server/auth";
import { rowBusiness } from "@/lib/server/store/ownership";
import { audit } from "@/lib/server/store/audit";
import { deleteDeal, getDeal, saveClient, saveDeal, setClientArchived, setDealStage, STAGES, type DealStage } from "@/lib/server/store/pipeline";
import { setSetting } from "@/lib/server/store/settings";
import { requestSync } from "@/lib/server/sync";
import { parsePlaces } from "@/lib/connectors/reviews";
import { isDate, today } from "@/lib/dates";
import { decimals, parseAmount } from "@/lib/money";

export interface PipelineState {
  error?: string;
  ok?: string;
  at?: number;
}

const text = (f: FormData, k: string, max: number) => String(f.get(k) ?? "").trim().slice(0, max);
const optional = (f: FormData, k: string, max: number) => text(f, k, max) || null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function refresh() {
  await requestSync();
  revalidatePath("/", "layout");
}

export async function saveClientAction(_prev: PipelineState, f: FormData): Promise<PipelineState> {
  const user = await requireSection("clients");
  const id = optional(f, "id", 36);
  const denied = businessDenied(user, optional(f, "business", 80), id ? await rowBusiness("clients", id) : undefined);
  if (denied) return { error: denied };
  const name = text(f, "name", 120);
  const email = optional(f, "email", 160);
  const website = optional(f, "website", 300);
  if (id && !UUID.test(id)) return { error: "Unknown client." };
  if (!name) return { error: "Give the client a name." };
  if (email && !EMAIL.test(email)) return { error: "That email address doesn't look right." };
  if (website && !/^https?:\/\/\S+$/i.test(website)) return { error: "Websites must start with http:// or https://" };
  const saved = await saveClient({ id: id ?? undefined, name, email, website, business: optional(f, "business", 80), contactName: optional(f, "contactName", 120), phone: optional(f, "phone", 40), notes: optional(f, "notes", 1000) });
  if (!saved) return { error: "That client no longer exists." };
  await audit(user.email, id ? "client.update" : "client.create", name, { id: saved.id });
  await refresh();
  return { ok: `${name} saved.`, at: Date.now() };
}

export async function archiveClientAction(id: string, archived: boolean) {
  const user = await requireSection("clients");
  if (!UUID.test(id) || businessDenied(user, await rowBusiness("clients", id))) return;
  const row = await setClientArchived(id, archived);
  if (row) await audit(user.email, archived ? "client.archive" : "client.unarchive", row.name, { id });
  await refresh();
}

export async function saveDealAction(_prev: PipelineState, f: FormData): Promise<PipelineState> {
  const user = await requireSection("clients");
  const id = optional(f, "id", 36);
  const clientId = optional(f, "clientId", 36);
  const denied = businessDenied(user, optional(f, "business", 80), id ? await rowBusiness("deals", id) : undefined, clientId ? await rowBusiness("clients", clientId) : undefined);
  if (denied) return { error: denied };
  const title = text(f, "title", 160);
  const stage = text(f, "stage", 20) as DealStage;
  const currency = (text(f, "currency", 3) || "usd").toLowerCase();
  const valueText = text(f, "value", 20);
  const expectedClose = optional(f, "expectedClose", 10);
  const nextStep = optional(f, "nextStep", 200);
  const nextStepDue = optional(f, "nextStepDue", 10);
  if (id && !UUID.test(id)) return { error: "Unknown deal." };
  if (clientId && !UUID.test(clientId)) return { error: "Pick a client from the list." };
  if (!title) return { error: "Name the deal, e.g. \"Website redesign\"." };
  if (!STAGES.includes(stage)) return { error: "Pick a stage." };
  if (!/^[a-z]{3}$/.test(currency)) return { error: "Currency must be a 3-letter code like USD." };
  const value = valueText ? parseAmount(valueText, currency) : null;
  if (valueText && value === null) return { error: decimals(currency) ? `Enter the value, e.g. 4500${decimals(currency) === 3 ? ".000" : ".00"}` : "Enter the value in whole units (no decimals for this currency)." };
  if (expectedClose && !isDate(expectedClose)) return { error: "The expected close date isn't valid." };
  if (nextStepDue && !isDate(nextStepDue)) return { error: "The next-step date isn't valid." };
  if (nextStepDue && !nextStep) return { error: "Say what the next step is, or clear its date." };
  const saved = await saveDeal({ id: id ?? undefined, clientId, business: optional(f, "business", 80), title, valueMinor: value, currency, stage, expectedClose, nextStep, nextStepDue, notes: optional(f, "notes", 1000) }, today());
  if (!saved) return { error: "That deal no longer exists." };
  await audit(user.email, id ? "deal.update" : "deal.create", title, { id: saved.id, stage });
  await refresh();
  return { ok: `"${title}" saved.`, at: Date.now() };
}

export async function moveDealAction(id: string, stage: DealStage) {
  const user = await requireSection("clients");
  if (!UUID.test(id) || !STAGES.includes(stage) || businessDenied(user, await rowBusiness("deals", id))) return;
  const before = await getDeal(id);
  const row = await setDealStage(id, stage, today());
  if (row) await audit(user.email, "deal.stage", row.title, { id, from: before?.stage, to: stage });
  await refresh();
}

export async function deleteDealAction(id: string) {
  const user = await requireSection("clients");
  if (!UUID.test(id) || businessDenied(user, await rowBusiness("deals", id))) return;
  const row = await deleteDeal(id);
  if (row) await audit(user.email, "deal.delete", row.title, { id });
  await refresh();
}

/** Google place IDs for reviews: "placeId | Business", one per line. */
export async function savePlacesAction(_prev: PipelineState, f: FormData): Promise<PipelineState> {
  const user = await requireOwner();
  const places = parsePlaces(text(f, "places", 5000));
  const bad = places.find((p) => !/^[A-Za-z0-9_-]{10,300}$/.test(p.placeId));
  if (bad) return { error: `"${bad.placeId}" doesn't look like a Google place ID (it usually starts with ChIJ).` };
  if (places.length > 30) return { error: "Up to 30 places." };
  await setSetting("places", places);
  await audit(user.email, "settings.places", null, { count: places.length });
  await refresh();
  return { ok: `Saved ${places.length} place${places.length === 1 ? "" : "s"}.`, at: Date.now() };
}
