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
const ENDPOINT = "https://api.frankfurter.app/latest";
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

/** Today's USD rate for `base`, straight from the provider. Null if it can't be had. */
export async function fetchUsdRate(base: string): Promise<number | null> {
  if (base === "USD") return 1;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${ENDPOINT}?from=${encodeURIComponent(base)}&to=USD`, {
      signal: controller.signal,
      // A PO must be stamped with today's rate, never a cached one from a previous build.
      cache: "no-store",
    }).finally(() => clearTimeout(timer));

    if (!res.ok) return null;
    const body: unknown = await res.json();
    const rate = (body as { rates?: Record<string, unknown> })?.rates?.USD;
    return plausible(rate) ? rate : null;
  } catch {
    // Offline, blocked, timed out, or not JSON — the caller falls back.
    return null;
  }
}

/** The rate to stamp on a PO being created now: the day's rate, else the Settings one. */
export async function rateForNewPo(base: string): Promise<FxRate> {
  const fetched = await fetchUsdRate(base);
  if (fetched != null) return { rate: fetched, source: "fetched" };

  const settings = await prisma.settings.findUnique({ where: { id: 1 }, select: { usdRateFallback: true } });
  const fallback = settings?.usdRateFallback;
  if (plausible(fallback)) return { rate: fallback, source: "fallback" };
  return { rate: null, source: "none" };
}

/** Convert an amount in the PO's currency to USD, or null when there is no rate. */
export function toUsd(amount: number, rate: number | null | undefined): number | null {
  if (rate == null || !Number.isFinite(rate)) return null;
  return amount * rate;
}
