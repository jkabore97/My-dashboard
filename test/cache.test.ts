import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, pgliteDb, useDb } from "@/lib/server/db";
import { getSetting } from "@/lib/server/store/settings";
import { collect, forgetExternalMemory, invalidateExternal } from "@/lib/aggregate";

vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: (fn: () => unknown) => void fn() }));

type Snap = { key: string; at: number; data: string } | null;

describe("shared platform data snapshot", () => {
  beforeAll(async () => {
    await useDb(await pgliteDb());
  });
  beforeEach(async () => {
    await (await getDb()).exec("truncate settings");
    forgetExternalMemory();
  });

  it("saves what was fetched, encrypted, and a fresh instance renders from it", async () => {
    const first = await collect();
    const snap = await getSetting<Snap>("cache:external", null);
    expect(snap?.data).toMatch(/^v1:/);

    forgetExternalMemory(); // as on a cold start
    const second = await collect();
    expect(second.externalAt).toBe(snap!.at);
    // Round-tripping through the database changes nothing the pages use.
    for (const k of ["repos", "hosting", "databases", "emails", "websites", "stripe"] as const) {
      expect(JSON.parse(JSON.stringify(second[k]))).toEqual(JSON.parse(JSON.stringify(first[k])));
    }
    // Platform sources keep the time they were fetched; database ones are read per request.
    const stamps = (c: typeof first) => Object.fromEntries(c.sources.map((s) => [s.source, s.fetchedAt]));
    expect(stamps(second).GitHub).toBe(stamps(first).GitHub);
    expect(stamps(second).Stripe).toBe(stamps(first).Stripe);
  });

  it("refetches in the background once the snapshot is over a minute old", async () => {
    await collect();
    const db = await getDb();
    const old = Date.now() - 5 * 60_000;
    await db.query("update settings set value = jsonb_set(value, '{at}', $1::text::jsonb) where key = 'cache:external'", [String(old)]);
    forgetExternalMemory();
    const c = await collect();
    expect(c.externalAt).toBe(old); // served at once from the old snapshot
    await vi.waitFor(async () => expect((await getSetting<Snap>("cache:external", null))!.at).toBeGreaterThan(old));
  });

  it("is dropped when a connection changes", async () => {
    await collect();
    await invalidateExternal();
    expect(await getSetting<Snap>("cache:external", null)).toBeNull();
  });
});
