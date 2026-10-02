// Amounts are stored in the currency's minor unit (cents), like Stripe.
// Zero-decimal currencies (JPY, XOF, …) have no minor unit.
const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);

export const minorUnits = (currency: string) => (ZERO_DECIMAL.has(currency.toLowerCase()) ? 1 : 100);

export function formatMoney(minor: number, currency: string, opts: { compact?: boolean } = {}) {
  const value = minor / minorUnits(currency);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      // Only shorten big numbers: "$15.6K" reads well, "$21.3" for $21.25 doesn't.
      ...(opts.compact && Math.abs(value) >= 10_000 ? { notation: "compact", maximumFractionDigits: 1 } : {}),
      ...(minorUnits(currency) === 1 ? { maximumFractionDigits: 0 } : {}),
    }).format(value);
  } catch {
    return `${value.toFixed(minorUnits(currency) === 1 ? 0 : 2)} ${currency.toUpperCase()}`;
  }
}

/** Parses "1,234.56" typed by a person into minor units. Null when invalid. */
export function parseAmount(input: string, currency: string): number | null {
  const clean = input.replace(/[\s,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const value = Math.round(Number(clean) * minorUnits(currency));
  return Number.isSafeInteger(value) ? value : null;
}

export type Interval = "day" | "week" | "month" | "year";

/** Normalizes a recurring amount to a monthly figure. */
export function toMonthly(amount: number, interval: Interval, count = 1) {
  const perMonth = { day: 365 / 12, week: 52 / 12, month: 1, year: 1 / 12 }[interval];
  return (amount * perMonth) / Math.max(1, count);
}

export interface CurrencyAmount {
  currency: string;
  amount: number;
}

/** Sums amounts per currency, largest first. */
export function sumByCurrency(items: CurrencyAmount[]): CurrencyAmount[] {
  const m = new Map<string, number>();
  for (const i of items) m.set(i.currency.toLowerCase(), (m.get(i.currency.toLowerCase()) ?? 0) + i.amount);
  return [...m].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount);
}

/** "$1,200 + €300" — every currency kept separate, never converted. */
export const formatTotals = (totals: CurrencyAmount[], opts?: { compact?: boolean }) =>
  totals.length ? totals.map((t) => formatMoney(t.amount, t.currency, opts)).join(" + ") : "—";

/** Minor units → the plain number a form field shows ("1250.00"). */
export const toInputAmount = (minor: number, currency: string) => (minor / minorUnits(currency)).toFixed(minorUnits(currency) === 1 ? 0 : 2);
