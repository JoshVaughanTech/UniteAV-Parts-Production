import { prisma } from "@/lib/prisma";

/**
 * The USD rate stamped on a purchase order.
 *
 * It is fetched once, when the PO is created, and stored on the row — a PO is a record of
 * what was committed on a day, so its USD figures must not drift with the market
 * afterwards. Nothing recomputes it later.
 *
 * Frankfurter publishes ECB reference rates and needs no API key. It is a third party on
 * the PO-creation path, so every failure mode falls back to the rate in Settings rather
 * than failing the order: a timeout, a non-200, malformed JSON, or a number outside a
 * sane band all land in the same place.
 */
const BASE = "https://api.frankfurter.app";
const ENDPOINT = `${BASE}/latest`;
const TIMEOUT_MS = 4000;

/** Guard against a garbled response quietly becoming a wrong price. */
function plausible(rate: unknown): rate is number {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0.01 && rate < 100;
}

export interface FxRate {
  /** USD per 1 unit of the base currency. */
  rate: number | null;
  source: "fetched" | "fallback" | "none";
}

/** `to` per 1 unit of `from`, today. Null if it can't be had. */
export async function fetchRate(from: string, to: string): Promise<number | null> {
  if (from === to) return 1;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${ENDPOINT}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
      signal: controller.signal,
      // A PO must be stamped with today's rate, never a cached one from a previous build.
      cache: "no-store",
    }).finally(() => clearTimeout(timer));

    if (!res.ok) return null;
    const body: unknown = await res.json();
    const rate = (body as { rates?: Record<string, unknown> })?.rates?.[to];
    return plausible(rate) ? rate : null;
  } catch {
    // Offline, blocked, timed out, or not JSON — the caller falls back.
    return null;
  }
}

/**
 * Home-currency units per 1 unit of an order's currency, to be frozen on the PO.
 *
 * An order placed with a US supplier is denominated in US dollars — that is what they
 * quote, invoice and are paid in — while everything the business reports internally is in
 * its home currency. This is the one number that connects them, and like the order itself
 * it is fixed on the day: what the order cost is settled when it is placed, not revalued
 * every time somebody opens the page.
 *
 * The Settings fallback is an AUD→USD rate, so it can only rescue the USD↔AUD pair. Any
 * other pair that can't be fetched gets no rate rather than a made-up one, and the PO
 * carries its own currency with no home conversion until somebody fixes it.
 */
export async function rateToHome(orderCurrency: string, homeCurrency: string): Promise<FxRate> {
  if (orderCurrency === homeCurrency) return { rate: 1, source: "fetched" };

  const fetched = await fetchRate(orderCurrency, homeCurrency);
  if (fetched != null) return { rate: fetched, source: "fetched" };

  const settings = await prisma.settings.findUnique({ where: { id: 1 }, select: { usdRateFallback: true } });
  const usdPerAud = settings?.usdRateFallback;
  if (plausible(usdPerAud)) {
    if (orderCurrency === "USD" && homeCurrency === "AUD") return { rate: 1 / usdPerAud, source: "fallback" };
    if (orderCurrency === "AUD" && homeCurrency === "USD") return { rate: usdPerAud, source: "fallback" };
  }
  return { rate: null, source: "none" };
}

/** Convert an amount in the order's currency to the home currency. */
export function toHome(amount: number, fxToHome: number | null | undefined): number | null {
  if (fxToHome == null || !Number.isFinite(fxToHome)) return null;
  return amount * fxToHome;
}

/**
 * The USD rate for `base` as it stood on a given day.
 *
 * Used to stamp a rate onto orders that predate this feature. Frankfurter answers a
 * weekend or holiday with the previous trading day's reference rate, which is the right
 * answer for a PO raised that day.
 */
export async function fetchUsdRateOn(base: string, day: Date): Promise<number | null> {
  if (base === "USD") return 1;
  const date = day.toISOString().slice(0, 10);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${BASE}/${date}?from=${encodeURIComponent(base)}&to=USD`, {
      signal: controller.signal,
      cache: "no-store",
    }).finally(() => clearTimeout(timer));

    if (!res.ok) return null;
    const body: unknown = await res.json();
    const rate = (body as { rates?: Record<string, unknown> })?.rates?.USD;
    return plausible(rate) ? rate : null;
  } catch {
    return null;
  }
}

