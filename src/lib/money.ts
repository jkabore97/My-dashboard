// Amounts are stored in the currency's minor unit (cents), like Stripe.
// Zero-decimal currencies (JPY, XOF, …) have no minor unit; a few (BHD, KWD, …)
// have three decimals.
const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);
const THREE_DECIMAL = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);

/** Digits after the decimal point. */
export const decimals = (currency: string) => (ZERO_DECIMAL.has(currency.toLowerCase()) ? 0 : THREE_DECIMAL.has(currency.toLowerCase()) ? 3 : 2);

export const minorUnits = (currency: string) => 10 ** decimals(currency);

export function formatMoney(minor: number, currency: string, opts: { compact?: boolean } = {}) {
  const value = minor / minorUnits(currency);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      // Only shorten big numbers: "$15.6K" reads well, "$21.3" for $21.25 doesn't.
      ...(opts.compact && Math.abs(value) >= 10_000
        ? { notation: "compact", maximumFractionDigits: 1 }
        : { minimumFractionDigits: decimals(currency), maximumFractionDigits: decimals(currency) }),
    }).format(value);
  } catch {
    return `${value.toFixed(decimals(currency))} ${currency.toUpperCase()}`;
  }
}

/** Parses "1,234.56" typed by a person into minor units. Null when invalid (including more decimals than the currency has). */
export function parseAmount(input: string, currency: string): number | null {
  const clean = input.replace(/[\s,]/g, "");
  const n = decimals(currency);
  if (!new RegExp(n ? `^\\d+(\\.\\d{1,${n}})?$` : "^\\d+$").test(clean)) return null;
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
export const toInputAmount = (minor: number, currency: string) => (minor / minorUnits(currency)).toFixed(decimals(currency));
