"use client";

import { useActionState, useState } from "react";
import { commitStocktake, abandonStocktake, type StocktakeResult } from "@/lib/stocktake-actions";
import { Card, btn, btnPrimary, btnGhost } from "@/components/ui";
import { fmtNum, fmtMoney, fmtDate } from "@/lib/format";

export interface ReviewRow {
  id: string;
  partNumber: string;
  name: string;
  counted: number;
  expected: number;
  variance: number;
  unitCost: number | null;
  onHandNow: number;
  countedAt: string;
}

/**
 * The variance list, and the one irreversible button in the whole stocktake.
 *
 * Variances lead, because they are the only rows anyone needs to look at — matches are
 * folded away. Commit posts a delta per row, so a part that legitimately moved after being
 * counted keeps that movement; where it has, the row says so rather than hiding it.
 */
export function StocktakeReview({
  stocktakeId,
  status,
  canCommit,
  rows,
  currency,
  counted,
  varianceCount,
  valueImpact,
}: {
  stocktakeId: string;
  status: string;
  canCommit: boolean;
  rows: ReviewRow[];
  currency: string;
  counted: number;
  varianceCount: number;
  valueImpact: number;
}) {
  const [commitState, commitAction, committing] = useActionState(commitStocktake, null);
  const [abandonState, abandonAction, abandoning] = useActionState(abandonStocktake, null);
  const [showMatches, setShowMatches] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const isOpen = status === "OPEN";
  const variances = rows.filter((r) => r.variance !== 0).sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
  const matches = rows.filter((r) => r.variance === 0);
  const drifted = rows.filter((r) => r.onHandNow !== r.expected);
  const state: StocktakeResult | null = commitState ?? abandonState;

  return (
    <Card
      title={isOpen ? "Review" : "What this stocktake found"}
      actions={
        <span className="text-xs text-muted">
          {fmtNum(counted)} counted · {fmtNum(varianceCount)} variance{varianceCount === 1 ? "" : "s"}
        </span>
      }
    >
      <div className="grid grid-cols-3 gap-px bg-line">
        <Stat label="Counted" value={fmtNum(counted)} />
        <Stat label="Variances" value={fmtNum(varianceCount)} tone={varianceCount > 0 ? "text-serious" : "text-good"} />
        <Stat
          label="Value impact"
          value={fmtMoney(valueImpact, currency)}
          tone={valueImpact < 0 ? "text-critical" : valueImpact > 0 ? "text-good" : undefined}
        />
      </div>

      {variances.length === 0 ? (
        <p className="px-4 py-4 text-sm text-good">
          Every counted item matches the system. {isOpen ? "Committing posts nothing." : "Nothing was adjusted."}
        </p>
      ) : (
        <ul className="divide-y">
          {variances.map((r) => (
            <li key={r.id || r.partNumber} className="px-4 py-2.5">
              <div className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-ink">{r.partNumber}</span>
                  <span className="block truncate text-xs text-muted">{r.name}</span>
                </span>
                <span className="shrink-0 text-right tnum text-xs text-muted">
                  {fmtNum(r.expected)} → <span className="font-semibold text-ink">{fmtNum(r.counted)}</span>
                </span>
                <span
                  className={`w-20 shrink-0 text-right tnum text-sm font-semibold ${
                    r.variance > 0 ? "text-brand" : "text-critical"
                  }`}
                >
                  {r.variance > 0 ? "+" : ""}
                  {fmtNum(r.variance)}
                </span>
                <span className="w-20 shrink-0 text-right tnum text-xs text-muted">
                  {r.unitCost == null ? "—" : fmtMoney(r.variance * r.unitCost, currency)}
                </span>
              </div>
              {r.onHandNow !== r.expected && (
                <p className="mt-1 text-xs text-serious">
                  On hand has moved to {fmtNum(r.onHandNow)} since this was counted on {fmtDate(r.countedAt)} —
                  committing applies the {r.variance > 0 ? "+" : ""}
                  {fmtNum(r.variance)} difference, so that movement is kept.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {matches.length > 0 && (
        <div className="border-t">
          <button
            type="button"
            onClick={() => setShowMatches((s) => !s)}
            className="w-full px-4 py-2 text-left text-xs font-medium text-muted hover:text-ink"
          >
            {showMatches ? "▾" : "▸"} {fmtNum(matches.length)} item{matches.length === 1 ? "" : "s"} matched exactly
          </button>
          {showMatches && (
            <ul className="divide-y border-t">
              {matches.map((r) => (
                <li key={r.id || r.partNumber} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-ink-2">{r.partNumber}</span>
                  <span className="shrink-0 tnum text-xs text-muted">{fmtNum(r.counted)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {state && state.ok === false && <p className="border-t px-4 py-2 text-sm text-critical">{state.error}</p>}
      {state && state.ok === true && <p className="border-t px-4 py-2 text-sm text-good">{state.message}</p>}

      {isOpen && (
        <div className="space-y-2 border-t p-4">
          {drifted.length > 0 && (
            <p className="text-xs text-muted">
              {fmtNum(drifted.length)} counted item{drifted.length === 1 ? " has" : "s have"} moved since being
              counted. Each posts as a difference, not an overwrite, so those movements survive.
            </p>
          )}

          {canCommit ? (
            confirming ? (
              <form action={commitAction} className="space-y-2">
                <input type="hidden" name="stocktakeId" value={stocktakeId} />
                <p className="text-sm text-ink-2">
                  Post {fmtNum(varianceCount)} adjustment{varianceCount === 1 ? "" : "s"} worth{" "}
                  <strong className="text-ink">{fmtMoney(valueImpact, currency)}</strong>? This writes to the stock
                  ledger and can&rsquo;t be undone in one step.
                </p>
                <div className="flex gap-2">
                  <button
                    className={`${btn} flex-1 border-transparent bg-critical py-3.5 text-base text-white`}
                    disabled={committing}
                  >
                    {committing ? "Posting…" : "Yes, commit"}
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} className={`${btnGhost} py-3.5`}>
                    Back
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className={`${btnPrimary} w-full py-3.5 text-base`}
              >
                Commit {fmtNum(counted)} count{counted === 1 ? "" : "s"}
              </button>
            )
          ) : (
            <p className="text-xs text-muted">
              Counting is done — a Manager commits the adjustments. Your counts are saved.
            </p>
          )}

          <form action={abandonAction}>
            <input type="hidden" name="stocktakeId" value={stocktakeId} />
            <button className={`${btn} w-full border-transparent py-2.5 text-ink-2 hover:text-critical`} disabled={abandoning}>
              {abandoning ? "Abandoning…" : "Abandon — change no stock"}
            </button>
          </form>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-surface px-3 py-2.5 text-center">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tnum ${tone ?? "text-ink"}`}>{value}</div>
    </div>
  );
}
