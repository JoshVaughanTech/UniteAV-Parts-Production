"use client";

import { useMemo, useRef, useState } from "react";
import { recordCount, removeCount } from "@/lib/stocktake-actions";
import { input, btnPrimary, btnGhost } from "@/components/ui";
import { fmtNum } from "@/lib/format";

export interface CountablePart {
  id: string;
  partNumber: string;
  name: string;
  mpn: string | null;
  onHand: number;
}

export interface ExistingEntry {
  id: string;
  itemId: string;
  partNumber: string;
  counted: number;
  expected: number;
}

/**
 * The counting screen, built for a phone held in one hand: search for the part, type the
 * number on the numeric keypad, confirm, repeat. Nothing here moves stock — counts
 * accumulate on the stocktake and post together when it is committed.
 *
 * Progress and the running variance stay on screen, because the two questions mid-count
 * are always "how much is left" and "does this shelf look wrong".
 */
export function StocktakeCounter({
  stocktakeId,
  parts,
  entries: initialEntries,
  scopeLabel,
}: {
  stocktakeId: string;
  parts: CountablePart[];
  entries: ExistingEntry[];
  scopeLabel: string;
}) {
  const [entries, setEntries] = useState<ExistingEntry[]>(initialEntries);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CountablePart | null>(null);
  const [count, setCount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const countRef = useRef<HTMLInputElement>(null);

  const countedIds = useMemo(() => new Set(entries.map((e) => e.itemId)), [entries]);
  const variances = entries.filter((e) => e.counted !== e.expected);
  const netUnits = variances.reduce((s, e) => s + (e.counted - e.expected), 0);

  function select(p: CountablePart) {
    setSelected(p);
    // Deliberately blank, not pre-filled with on-hand: a prefilled expected value is how
    // a stocktake ends up confirming the number it was meant to check.
    setCount("");
    setMsg(null);
    setQuery("");
    setTimeout(() => countRef.current?.focus(), 50);
  }

  async function save() {
    if (!selected) return;
    const n = Number(count);
    if (count.trim() === "" || !Number.isFinite(n) || n < 0) {
      setMsg({ text: "Enter a count of 0 or more.", ok: false });
      return;
    }
    setBusy(true);
    const res = await recordCount(stocktakeId, selected.id, n);
    setBusy(false);
    if (!res.ok) {
      setMsg({ text: res.error, ok: false });
      return;
    }
    setEntries((es) => [
      { id: "", itemId: res.itemId, partNumber: res.partNumber, counted: res.counted, expected: res.expected },
      ...es.filter((e) => e.itemId !== res.itemId),
    ]);
    const v = res.variance;
    setMsg({
      text:
        v === 0
          ? `${res.partNumber} matches at ${fmtNum(res.counted)}.`
          : `${res.partNumber}: counted ${fmtNum(res.counted)}, expected ${fmtNum(res.expected)} (${v > 0 ? "+" : ""}${fmtNum(v)}).`,
      ok: v === 0,
    });
    setSelected(null);
    setCount("");
  }

  async function undo(itemId: string) {
    const entry = entries.find((e) => e.itemId === itemId);
    if (!entry?.id) {
      // Recorded this session — no row id to hand the server, so just reload.
      setMsg({ text: "Reload to remove a count taken a moment ago.", ok: false });
      return;
    }
    setBusy(true);
    const res = await removeCount(entry.id);
    setBusy(false);
    if (res.ok) setEntries((es) => es.filter((e) => e.itemId !== itemId));
    else setMsg({ text: res.error, ok: false });
  }

  const q = query.trim().toLowerCase();
  const matches =
    q.length === 0
      ? []
      : parts
          .filter(
            (p) =>
              p.partNumber.toLowerCase().includes(q) ||
              p.name.toLowerCase().includes(q) ||
              (p.mpn ?? "").toLowerCase().includes(q),
          )
          .slice(0, 8);

  const pct = parts.length > 0 ? (entries.length / parts.length) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Progress rides at the top of the scroll on a phone. */}
      <div className="sticky top-0 z-10 space-y-2 rounded-xl border bg-surface p-3 shadow-sm">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-semibold text-ink">
            {fmtNum(entries.length)} <span className="font-normal text-muted">of {fmtNum(parts.length)} counted</span>
          </span>
          <span className="text-xs text-muted">{scopeLabel}</span>
        </div>
        <span className="block h-2 w-full overflow-hidden rounded-[4px] bg-surface-2">
          <span
            className="block h-full rounded-r-[4px] bg-brand"
            style={{ width: `${Math.max(pct, entries.length > 0 ? 1 : 0)}%` }}
          />
        </span>
        {variances.length > 0 && (
          <p className="text-xs text-serious">
            {fmtNum(variances.length)} variance{variances.length === 1 ? "" : "s"} so far · net{" "}
            {netUnits > 0 ? "+" : ""}
            {fmtNum(netUnits)} units
          </p>
        )}
      </div>

      {selected ? (
        <div className="rounded-xl border-2 border-brand/50 bg-surface p-4">
          <div className="text-lg font-semibold text-ink">{selected.partNumber}</div>
          <div className="mb-3 max-w-full truncate text-sm text-muted">{selected.name}</div>
          <label className="mb-1 block text-sm font-medium text-ink-2">How many on the shelf?</label>
          <input
            ref={countRef}
            className={`${input} py-4 text-center text-3xl font-semibold tnum`}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save();
              }
            }}
            type="number"
            inputMode="numeric"
            min="0"
            placeholder="0"
            autoFocus
          />
          <p className="mt-1 text-xs text-muted">
            The system expects {fmtNum(selected.onHand)} — enter what you actually count.
          </p>
          <div className="mt-3 flex gap-2">
            <button onClick={save} disabled={busy} className={`${btnPrimary} flex-1 py-3.5 text-base`}>
              {busy ? "Saving…" : "Save count"}
            </button>
            <button
              onClick={() => {
                setSelected(null);
                setCount("");
              }}
              className={`${btnGhost} py-3.5`}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border bg-surface p-3">
          <div className="space-y-3">
            <input
              className={`${input} py-3.5 text-base`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search part number / description / MPN"
              autoComplete="off"
              autoFocus
            />
            {matches.length > 0 && (
              <ul className="divide-y rounded-lg border">
                {matches.map((p) => {
                  const done = countedIds.has(p.id);
                  return (
                    <li key={p.id}>
                      <button
                        onClick={() => select(p)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-3 text-left hover:bg-surface-2"
                      >
                        <span className="min-w-0">
                          <span className="font-medium text-ink">{p.partNumber}</span>
                          <span className="block truncate text-xs text-muted">{p.name}</span>
                        </span>
                        <span className="shrink-0 text-right text-xs">
                          {done ? (
                            <span className="font-medium text-good">counted</span>
                          ) : (
                            <span className="text-muted">expects {fmtNum(p.onHand)}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {q.length > 0 && matches.length === 0 && (
              <p className="px-1 py-2 text-center text-sm text-muted">
                Nothing matches &ldquo;{query.trim()}&rdquo;.
              </p>
            )}
          </div>
        </div>
      )}

      {msg && (
        <p className={`rounded-lg px-3 py-2 text-center text-sm font-medium ${msg.ok ? "text-good" : "text-serious"}`}>
          {msg.text}
        </p>
      )}

      {entries.length > 0 && (
        <div className="rounded-xl border bg-surface">
          <div className="border-b px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted">
            Counted ({fmtNum(entries.length)}) — newest first
          </div>
          <ul className="divide-y">
            {entries.slice(0, 40).map((e) => {
              const v = e.counted - e.expected;
              return (
                <li key={e.itemId} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{e.partNumber}</span>
                  <span className="shrink-0 tnum text-muted">
                    {fmtNum(e.expected)} → <span className="font-semibold text-ink">{fmtNum(e.counted)}</span>
                  </span>
                  <span
                    className={`w-16 shrink-0 text-right tnum text-xs font-semibold ${
                      v === 0 ? "text-good" : v > 0 ? "text-brand" : "text-critical"
                    }`}
                  >
                    {v === 0 ? "match" : `${v > 0 ? "+" : ""}${fmtNum(v)}`}
                  </span>
                  <button
                    onClick={() => undo(e.itemId)}
                    disabled={busy}
                    className="shrink-0 px-1 text-muted hover:text-critical disabled:opacity-40"
                    aria-label={`Remove the count for ${e.partNumber}`}
                    title="Remove this count"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
          {entries.length > 40 && (
            <p className="border-t px-4 py-2 text-xs text-muted">
              Showing the latest 40 of {fmtNum(entries.length)}. The review list has them all.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
