"use client";

import { useActionState, useMemo, useState } from "react";
import type { RunResult } from "@/lib/production/run-actions";
import { btnPrimary, input } from "@/components/ui";

/**
 * Everything buildable is listed with a quantity box beside it, rather than hidden behind
 * a dropdown — on a shop-floor screen you want to see what is available and what you have
 * picked at the same time. A row with no quantity is simply skipped by the action, so the
 * form posts every row and lets the server filter.
 *
 * The same form serves both kinds: an SMD run lists boards with their stock, a finished
 * build lists products. `kind` goes along so the action can refuse a mismatched item.
 */
export function NewRunForm({
  action,
  items,
  today,
  kind,
}: {
  action: (prev: RunResult | null, formData: FormData) => Promise<RunResult>;
  items: { id: string; name: string; onHand?: number }[];
  today: string;
  kind: "SMD" | "FINISHED";
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const isSmd = kind === "SMD";

  const chosen = useMemo(() => {
    const picked = items
      .map((it) => ({ name: it.name, qty: Math.floor(Number(qtys[it.id] ?? "")) || 0 }))
      .filter((p) => p.qty > 0);
    return { lines: picked, units: picked.reduce((s, p) => s + p.qty, 0) };
  }, [items, qtys]);

  if (items.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted">
        {isSmd ? "No SMD boards in the catalogue yet." : "No finished products yet."} Import a BOM first.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3 p-4">
      <input type="hidden" name="kind" value={kind} />

      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-xs font-medium text-ink-2">
            {isSmd ? "SMD boards to populate" : "Products to build"}
          </span>
          {chosen.lines.length > 0 && (
            <button
              type="button"
              onClick={() => setQtys({})}
              className="text-xs text-muted hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>
        {/* Scrolls only once the list is long enough to need it. */}
        <div className="max-h-72 space-y-1 overflow-y-auto pr-0.5">
          {items.map((it) => {
            const raw = qtys[it.id] ?? "";
            const picked = (Math.floor(Number(raw)) || 0) > 0;
            return (
              <label
                key={it.id}
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors ${
                  picked ? "border-brand bg-brand/5" : "hover:bg-surface-2"
                }`}
              >
                <span className={`min-w-0 flex-1 truncate text-sm ${picked ? "font-medium text-ink" : "text-ink-2"}`}>
                  {it.name}
                </span>
                {isSmd && it.onHand !== undefined && (
                  <span className="shrink-0 text-xs tnum text-muted" title="Assembled boards already in stock">
                    {it.onHand} in stock
                  </span>
                )}
                <input type="hidden" name="productItemId" value={it.id} />
                <input
                  className={`${input} w-16 shrink-0 py-1 text-right`}
                  name="qty"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={raw}
                  onChange={(e) => setQtys((q) => ({ ...q, [it.id]: e.target.value }))}
                  aria-label={`Quantity of ${it.name}`}
                />
              </label>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border bg-surface-2 px-3 py-2 text-xs">
        {chosen.lines.length === 0 ? (
          <span className="text-muted">
            Nothing chosen yet — put a quantity beside {isSmd ? "a board" : "a product"}.
          </span>
        ) : (
          <>
            <div className="mb-1 font-medium text-ink">
              {chosen.lines.length} {isSmd ? "board" : "product"}
              {chosen.lines.length === 1 ? "" : "s"} · {chosen.units} unit{chosen.units === 1 ? "" : "s"}
            </div>
            <ul className="space-y-0.5 text-ink-2">
              {chosen.lines.map((l) => (
                <li key={l.name} className="truncate">
                  {l.name} <span className="tnum text-muted">×{l.qty}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-2">Build date</span>
          <input className={input} name="plannedAt" type="date" defaultValue={today} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-2">Note (optional)</span>
          <input className={input} name="note" placeholder={isSmd ? "Panel, machine…" : "Order #, customer…"} />
        </label>
      </div>

      {state && state.ok === false && <p className="text-sm text-critical">{state.error}</p>}

      <button className={btnPrimary} disabled={pending || chosen.lines.length === 0}>
        {pending ? "Working…" : isSmd ? "Plan SMD run" : "Plan build"}
      </button>
      <p className="text-xs text-muted">
        {isSmd
          ? "Planning changes no stock. Building puts the boards into stock for a finished build to draw on."
          : "Planning changes no stock. You’ll see which boards stock covers before building."}
      </p>
    </form>
  );
}
