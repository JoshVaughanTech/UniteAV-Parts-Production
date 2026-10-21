"use client";

import { useMemo, useRef, useState } from "react";
import { recordCount, removeCount, addPartAndCount, type CountMode, type CountResult } from "@/lib/stocktake-actions";
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

const BLANK_PART = {
  partNumber: "",
  name: "",
  value: "",
  footprint: "",
  manufacturer: "",
  mpn: "",
  counted: "",
};

/**
 * The counting screen, built for a phone held in one hand: search for the part, type the
 * number on the numeric keypad, confirm, repeat. Nothing here moves stock — counts
 * accumulate on the stocktake and post together when it is committed.
 *
 * Progress and the running variance stay on screen, because the two questions mid-count
 * are always "how much is left" and "does this shelf look wrong".
 *
 * Two things a real count needs that a tidy one does not. The same part turns up in a
 * second place, so a counted part can be topped up rather than recounted from scratch —
 * the alternative is mental arithmetic on a ladder. And a count finds stock the catalogue
 * has never heard of, so a part can be created from here; leaving the count to go and make
 * it is how that stock ends up uncounted.
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
  // Parts created during this count. The server list arrived with the page and will not
  // include them, so they are kept here to stay searchable without a reload.
  const [extraParts, setExtraParts] = useState<CountablePart[]>([]);
  const [adding, setAdding] = useState(false);
  const [newPart, setNewPart] = useState(BLANK_PART);
  const countRef = useRef<HTMLInputElement>(null);

  const allParts = useMemo(() => [...extraParts, ...parts], [extraParts, parts]);
  const countedIds = useMemo(() => new Set(entries.map((e) => e.itemId)), [entries]);
  const variances = entries.filter((e) => e.counted !== e.expected);
  const netUnits = variances.reduce((s, e) => s + (e.counted - e.expected), 0);

  /** The count already on the stocktake for whatever is selected, if there is one. */
  const already = selected ? (entries.find((e) => e.itemId === selected.id) ?? null) : null;
  const typed = Number(count);
  const topUpTotal =
    already && count.trim() !== "" && Number.isFinite(typed) && typed >= 0 ? already.counted + typed : null;

  function select(p: CountablePart) {
    setSelected(p);
    // Deliberately blank, not pre-filled with on-hand: a prefilled expected value is how
    // a stocktake ends up confirming the number it was meant to check.
    setCount("");
    setMsg(null);
    setQuery("");
    setAdding(false);
    setTimeout(() => countRef.current?.focus(), 50);
  }

  /** Reopen a part from the counted list, which is how finding more of it starts. */
  function reselect(e: ExistingEntry) {
    const known = allParts.find((p) => p.id === e.itemId);
    select(known ?? { id: e.itemId, partNumber: e.partNumber, name: "", mpn: null, onHand: e.expected });
  }

  function cancel() {
    setSelected(null);
    setCount("");
  }

  function applyCount(res: CountResult) {
    setEntries((es) => [
      { id: "", itemId: res.itemId, partNumber: res.partNumber, counted: res.counted, expected: res.expected },
      ...es.filter((e) => e.itemId !== res.itemId),
    ]);
    const v = res.variance;
    const variance = v === 0 ? "matches" : `${v > 0 ? "+" : ""}${fmtNum(v)}`;
    setMsg({
      text:
        res.mode === "add"
          ? `${res.partNumber}: added ${fmtNum(res.added)}, now ${fmtNum(res.counted)} against ${fmtNum(res.expected)} expected (${variance}).`
          : v === 0
            ? `${res.partNumber} matches at ${fmtNum(res.counted)}.`
            : `${res.partNumber}: counted ${fmtNum(res.counted)}, expected ${fmtNum(res.expected)} (${variance}).`,
      ok: v === 0,
    });
  }

  async function save(mode: CountMode) {
    if (!selected) return;
    const n = Number(count);
    if (count.trim() === "" || !Number.isFinite(n) || n < 0) {
      setMsg({ text: mode === "add" ? "Enter how many more you found." : "Enter a count of 0 or more.", ok: false });
      return;
    }
    setBusy(true);
    const res = await recordCount(stocktakeId, selected.id, n, mode);
    setBusy(false);
    if (!res.ok) {
      setMsg({ text: res.error, ok: false });
      return;
    }
    applyCount(res);
    setSelected(null);
    setCount("");
  }

  async function createAndCount() {
    const n = Number(newPart.counted);
    if (!newPart.partNumber.trim()) {
      setMsg({ text: "An item number is needed — it is what every BOM and order joins on.", ok: false });
      return;
    }
    if (!newPart.name.trim()) {
      setMsg({ text: "Give the part a description.", ok: false });
      return;
    }
    if (newPart.counted.trim() === "" || !Number.isFinite(n) || n < 0) {
      setMsg({ text: "Enter how many you found.", ok: false });
      return;
    }
    setBusy(true);
    const res = await addPartAndCount(
      stocktakeId,
      {
        partNumber: newPart.partNumber.trim(),
        name: newPart.name.trim(),
        value: newPart.value.trim() || null,
        footprint: newPart.footprint.trim() || null,
        manufacturer: newPart.manufacturer.trim() || null,
        mpn: newPart.mpn.trim() || null,
      },
      n,
    );
    setBusy(false);
    if (!res.ok) {
      setMsg({ text: res.error, ok: false });
      return;
    }
    setExtraParts((ps) => [res.part, ...ps]);
    applyCount(res);
    setMsg({
      text: `Added ${res.partNumber} and counted ${fmtNum(res.counted)}. It posts as found stock when this stocktake is committed.`,
      ok: true,
    });
    setNewPart(BLANK_PART);
    setAdding(false);
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
      : allParts
          .filter(
            (p) =>
              p.partNumber.toLowerCase().includes(q) ||
              p.name.toLowerCase().includes(q) ||
              (p.mpn ?? "").toLowerCase().includes(q),
          )
          .slice(0, 8);

  const total = allParts.length;
  const pct = total > 0 ? Math.min(100, (entries.length / total) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Progress rides at the top of the scroll on a phone. */}
      <div className="sticky top-0 z-10 space-y-2 rounded-xl border bg-surface p-3 shadow-sm">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-semibold text-ink">
            {fmtNum(entries.length)} <span className="font-normal text-muted">of {fmtNum(total)} counted</span>
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
          {selected.name && <div className="max-w-full truncate text-sm text-muted">{selected.name}</div>}
          {already ? (
            <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">
              Already counted <strong className="text-ink">{fmtNum(already.counted)}</strong> against{" "}
              {fmtNum(already.expected)} expected.
            </p>
          ) : null}
          <label className="mb-1 mt-3 block text-sm font-medium text-ink-2">
            {already ? "How many more have you found?" : "How many on the shelf?"}
          </label>
          <input
            ref={countRef}
            className={`${input} py-4 text-center text-3xl font-semibold tnum`}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                // Enter does the obvious thing: top up a part already counted, otherwise
                // save the count.
                void save(already ? "add" : "set");
              }
            }}
            type="number"
            inputMode="numeric"
            min="0"
            placeholder="0"
            autoFocus
          />
          {already ? (
            <>
              <p className="mt-1 text-xs text-muted">
                Adding keeps what you counted before. Use Replace only if you are recounting the lot from scratch.
              </p>
              <button
                onClick={() => save("add")}
                disabled={busy}
                className={`${btnPrimary} mt-3 w-full py-3.5 text-base disabled:opacity-60`}
              >
                {busy
                  ? "Saving…"
                  : topUpTotal != null
                    ? `Add — makes ${fmtNum(topUpTotal)}`
                    : "Add to the count"}
              </button>
              <div className="mt-2 flex gap-2">
                <button onClick={() => save("set")} disabled={busy} className={`${btnGhost} flex-1 py-3 text-sm`}>
                  Replace the count
                </button>
                <button onClick={cancel} className={`${btnGhost} py-3 text-sm`}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-1 text-xs text-muted">
                The system expects {fmtNum(selected.onHand)} — enter what you actually count.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => save("set")}
                  disabled={busy}
                  className={`${btnPrimary} flex-1 py-3.5 text-base disabled:opacity-60`}
                >
                  {busy ? "Saving…" : "Save count"}
                </button>
                <button onClick={cancel} className={`${btnGhost} py-3.5`}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border bg-surface p-3">
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
                          <span className="font-medium text-good">counted — tap to add more</span>
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
            <p className="px-1 py-2 text-center text-sm text-muted">Nothing matches &ldquo;{query.trim()}&rdquo;.</p>
          )}

          {adding ? (
            <div className="space-y-2 rounded-lg border bg-surface-2 p-3">
              <p className="text-xs text-muted">
                A part with no stock and no price — enough to count it now. Cost, supplier and lead time can be filled
                in later on the Parts page.
              </p>
              <input
                className={`${input} py-3 text-base`}
                value={newPart.partNumber}
                onChange={(e) => setNewPart({ ...newPart, partNumber: e.target.value })}
                placeholder="Item number, e.g. CAPS-00231"
                autoComplete="off"
                autoCapitalize="characters"
              />
              <input
                className={`${input} py-3 text-base`}
                value={newPart.name}
                onChange={(e) => setNewPart({ ...newPart, name: e.target.value })}
                placeholder="Description, e.g. Capacitor 100nF 50V X7R"
                autoComplete="off"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={`${input} py-3`}
                  value={newPart.value}
                  onChange={(e) => setNewPart({ ...newPart, value: e.target.value })}
                  placeholder="Value (optional)"
                  autoComplete="off"
                />
                <input
                  className={`${input} py-3`}
                  value={newPart.footprint}
                  onChange={(e) => setNewPart({ ...newPart, footprint: e.target.value })}
                  placeholder="Package (optional)"
                  autoComplete="off"
                />
                <input
                  className={`${input} py-3`}
                  value={newPart.manufacturer}
                  onChange={(e) => setNewPart({ ...newPart, manufacturer: e.target.value })}
                  placeholder="Manufacturer (optional)"
                  autoComplete="off"
                />
                <input
                  className={`${input} py-3`}
                  value={newPart.mpn}
                  onChange={(e) => setNewPart({ ...newPart, mpn: e.target.value })}
                  placeholder="MPN (optional)"
                  autoComplete="off"
                />
              </div>
              <input
                className={`${input} py-3.5 text-center text-2xl font-semibold tnum`}
                value={newPart.counted}
                onChange={(e) => setNewPart({ ...newPart, counted: e.target.value })}
                type="number"
                inputMode="numeric"
                min="0"
                placeholder="How many found?"
              />
              <div className="flex gap-2">
                <button
                  onClick={createAndCount}
                  disabled={busy}
                  className={`${btnPrimary} flex-1 py-3.5 text-base disabled:opacity-60`}
                >
                  {busy ? "Adding…" : "Add the part and count it"}
                </button>
                <button
                  onClick={() => {
                    setAdding(false);
                    setNewPart(BLANK_PART);
                  }}
                  className={`${btnGhost} py-3.5`}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className={`${btnGhost} w-full py-3 text-sm`}>
              + Add a part that isn&rsquo;t in the list
            </button>
          )}
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
            Counted ({fmtNum(entries.length)}) — tap one to add more
          </div>
          <ul className="divide-y">
            {entries.slice(0, 40).map((e) => {
              const v = e.counted - e.expected;
              return (
                <li key={e.itemId} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                  <button
                    onClick={() => reselect(e)}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left hover:opacity-70"
                    title={`Found more ${e.partNumber}? Tap to add to its count.`}
                  >
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
                  </button>
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
