export function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Explicit currency symbols so AUD is never rendered as a bare "$" (machine-locale
// dependent). Keeps the currency unambiguous on the dashboard.
const CURRENCY_SYMBOL: Record<string, string> = {
  AUD: "A$",
  USD: "US$",
  NZD: "NZ$",
  EUR: "€",
  GBP: "£",
};
function symbolFor(currency: string): string {
  return CURRENCY_SYMBOL[currency] ?? `${currency} `;
}

export function fmtMoney(n: number | null | undefined, currency = "AUD"): string {
  if (n == null) return "—";
  return symbolFor(currency) + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Unit-cost formatter that keeps full precision for sub-cent prices (e.g. A$0.0018)
 * while still showing at least 2 decimals. Shows up to 4 decimal places.
 */
export function fmtCost(n: number | null | undefined, currency = "AUD"): string {
  if (n == null) return "—";
  return symbolFor(currency) + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}
