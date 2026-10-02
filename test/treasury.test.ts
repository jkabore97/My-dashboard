import { describe, expect, it } from "vitest";
import { monthlyOf, nextDate, recentChanges, renewalsWithin, spendByBusiness, spendProblems, spendShare, spendTotals, spendTrend, yearlyOf } from "@/components/treasury/spend";
import type { Subscription } from "@/lib/server/store/ledger";

const sub = (o: Partial<Subscription> & { id: string }): Subscription => ({
  business: null, vendor: o.id, plan: null, amountMinor: 1000, currency: "usd", interval: "month", nextRenewal: null, autoRenew: true, url: null, notes: null, active: true, ...o,
});

describe("platform spend", () => {
  it("turns yearly plans into a monthly equivalent and monthly ones into a yearly run-rate", () => {
    expect(monthlyOf({ amountMinor: 22_800, interval: "year" })).toBe(1900);
    expect(monthlyOf({ amountMinor: 2000, interval: "month" })).toBe(2000);
    expect(yearlyOf({ amountMinor: 2000, interval: "month" })).toBe(24_000);
    expect(yearlyOf({ amountMinor: 22_800, interval: "year" })).toBe(22_800);
  });

  it("totals only active subscriptions, per currency, largest first, without converting", () => {
    const t = spendTotals([
      sub({ id: "a", amountMinor: 10_000 }),
      sub({ id: "b", amountMinor: 22_800, interval: "year" }),
      sub({ id: "c", amountMinor: 5000, active: false }),
      sub({ id: "d", amountMinor: 3000, currency: "eur" }),
      sub({ id: "e", amountMinor: 0 }),
    ]);
    expect(t.monthly).toEqual([{ currency: "usd", amount: 11_900 }, { currency: "eur", amount: 3000 }]);
    expect(t.yearly).toEqual([{ currency: "usd", amount: 142_800 }, { currency: "eur", amount: 36_000 }]);
    expect(t.count).toBe(4);
    expect(t.paid).toBe(3);
  });

  it("lists renewals in the next 30 days, rolling auto-renewing dates forward", () => {
    const today = "2026-10-02";
    const r = renewalsWithin([
      sub({ id: "monthly", nextRenewal: "2026-09-05" }), // rolls to Oct 5 (and Nov 5 is past the window)
      sub({ id: "early", nextRenewal: "2026-10-02" }), // today, and again Nov 2 (day 31: out)
      sub({ id: "twice", nextRenewal: "2026-08-03" }), // Oct 3 and Nov 3? Nov 3 is day 32: out
      sub({ id: "yearly", interval: "year", amountMinor: 22_800, nextRenewal: "2025-10-21" }), // Oct 21, full yearly charge
      sub({ id: "far", nextRenewal: "2026-12-01", autoRenew: false }),
      sub({ id: "ended", nextRenewal: "2026-09-20", autoRenew: false }), // past, not a renewal
      sub({ id: "off", nextRenewal: "2026-10-10", active: false }),
      sub({ id: "undated" }),
    ], today);
    expect(r.map((x) => [x.id, x.date, x.days])).toEqual([
      ["early", "2026-10-02", 0],
      ["twice", "2026-10-03", 1],
      ["monthly", "2026-10-05", 3],
      ["yearly", "2026-10-21", 19],
    ]);
    expect(r.find((x) => x.id === "yearly")!.amount).toBe(22_800);
  });

  it("counts a monthly plan twice when it charges twice in the window", () => {
    const r = renewalsWithin([sub({ id: "m", nextRenewal: "2026-02-01" })], "2026-02-01", 30);
    expect(r.map((x) => x.date)).toEqual(["2026-02-01", "2026-03-01"]);
  });

  it("keeps month-end anchors when rolling forward", () => {
    expect(nextDate({ nextRenewal: "2026-01-31", autoRenew: true, interval: "month" }, "2026-03-15")).toBe("2026-03-31");
    expect(nextDate({ nextRenewal: "2026-01-31", autoRenew: false, interval: "month" }, "2026-03-15")).toBe("2026-01-31");
  });

  it("flags plans that end soon without auto-renew, matching the to-do rule", () => {
    const p = spendProblems([
      sub({ id: "soon", nextRenewal: "2026-10-10", autoRenew: false }),
      sub({ id: "gone", nextRenewal: "2026-09-28", autoRenew: false }),
      sub({ id: "later", nextRenewal: "2026-11-30", autoRenew: false }),
      sub({ id: "auto", nextRenewal: "2026-10-03" }),
    ], "2026-10-02");
    expect(p.map((x) => [x.id, x.severity])).toEqual([["gone", "critical"], ["soon", "high"]]);
  });

  it("splits the monthly cost per business", () => {
    const b = spendByBusiness([
      sub({ id: "a", business: "Kaj", amountMinor: 1000 }),
      sub({ id: "b", business: "Kaj", amountMinor: 12_000, interval: "year" }),
      sub({ id: "c", amountMinor: 5000 }),
    ]);
    expect(b).toEqual([{ business: "Unassigned", totals: [{ currency: "usd", amount: 5000 }] }, { business: "Kaj", totals: [{ currency: "usd", amount: 2000 }] }]);
  });

  it("approximates a trend from when each subscription was added or stopped", () => {
    const t = spendTrend([
      sub({ id: "old", amountMinor: 1000, createdOn: "2026-05-10" }),
      sub({ id: "new", amountMinor: 500, createdOn: "2026-09-15" }),
      sub({ id: "stopped", amountMinor: 200, createdOn: "2026-04-01", active: false, updatedOn: "2026-07-03" }),
      sub({ id: "eur", amountMinor: 999, currency: "eur", createdOn: "2026-01-01" }),
      sub({ id: "unknown", amountMinor: 999 }),
    ], "2026-10-02", "usd");
    expect(t.months).toEqual([
      { month: "2026-05", amount: 1200 },
      { month: "2026-06", amount: 1200 },
      { month: "2026-07", amount: 1200 },
      { month: "2026-08", amount: 1000 },
      { month: "2026-09", amount: 1500 },
      { month: "2026-10", amount: 1500 },
    ]);
    expect(t.hasHistory).toBe(true);
    expect(spendTrend([sub({ id: "x", createdOn: "2026-10-01" })], "2026-10-02", "usd").hasHistory).toBe(false);
  });

  it("lists recent additions and stops", () => {
    const c = recentChanges([
      sub({ id: "added", createdOn: "2026-09-20" }),
      sub({ id: "old", createdOn: "2026-01-01" }),
      sub({ id: "stopped", active: false, updatedOn: "2026-09-25" }),
    ], "2026-10-02");
    expect(c.added.map((s) => s.id)).toEqual(["added"]);
    expect(c.stopped.map((s) => s.id)).toEqual(["stopped"]);
  });

  it("gives spend as a share of revenue only in the same currency", () => {
    expect(spendShare([{ currency: "usd", amount: 41_200 }], [{ currency: "usd", amount: 1_842_000 }])).toEqual({ pct: 2.2, currency: "usd", spend: 41_200, revenue: 1_842_000 });
    expect(spendShare([{ currency: "usd", amount: 100 }], [{ currency: "eur", amount: 1000 }])).toBeNull();
    expect(spendShare([], [{ currency: "usd", amount: 1000 }])).toBeNull();
  });
});
