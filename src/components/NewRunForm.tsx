"use client";

import { useActionState, useState } from "react";
import type { RunResult } from "@/lib/production/run-actions";
import { btnPrimary, input } from "@/components/ui";

let nextKey = 1;

/**
 * A run is usually more than one item, so the form grows a row at a time. Each row posts a
 * parallel productItemId/qty pair; the action zips and merges them, so every row must post
 * both fields to keep the two arrays aligned by index.
 *
 * The same form serves both kinds — an SMD run lists boards with their stock, a finished
 * build lists products — and posts `kind` so the action can refuse a mismatched item.
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
  const [rows, setRows] = useState<number[]>([0]);
  const isSmd = kind === "SMD";
  const noun = isSmd ? "board" : "product";

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

      <div className="space-y-2">
        {rows.map((key, i) => (
          <div key={key} className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              {i === 0 && (
                <span className="mb-1 block text-xs font-medium text-ink-2">
                  {isSmd ? "SMD board" : "Product"}
                </span>
              )}
              <select className={input} name="productItemId" required defaultValue="">
                <option value="" disabled>
                  Choose {isSmd ? "a board" : "a product"}…
                </option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                    {isSmd && it.onHand !== undefined ? ` — ${it.onHand} in stock` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-24 shrink-0">
              {i === 0 && <span className="mb-1 block text-xs font-medium text-ink-2">Quantity</span>}
              <input
                className={`${input} text-right`}
                name="qty"
                type="number"
                min="1"
                step="1"
                defaultValue={1}
                required
                aria-label="Quantity"
              />
            </label>
            <button
              type="button"
              onClick={() => setRows((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : r))}
              disabled={rows.length === 1}
              className="pb-2 text-muted hover:text-critical disabled:opacity-30"
              aria-label={`Remove this ${noun}`}
              title={`Remove this ${noun}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setRows((r) => [...r, nextKey++])}
        className="text-sm font-medium text-brand hover:opacity-80"
      >
        + Add another {noun}
      </button>

      <div className="flex flex-wrap items-end gap-3 border-t pt-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-2">Build date</span>
          <input className={`${input} w-40`} name="plannedAt" type="date" defaultValue={today} />
        </label>
        <label className="block min-w-48 flex-1">
          <span className="mb-1 block text-xs font-medium text-ink-2">Note (optional)</span>
          <input className={input} name="note" placeholder={isSmd ? "Panel, machine…" : "Order #, customer…"} />
        </label>
        <button className={btnPrimary} disabled={pending}>
          {pending ? "Working…" : isSmd ? "Plan SMD run" : "Plan build"}
        </button>
      </div>

      {state && state.ok === false && <p className="text-sm text-critical">{state.error}</p>}
      <p className="text-xs text-muted">
        {isSmd
          ? "Planning changes no stock. Building puts the boards into stock for a finished build to draw on."
          : "Planning changes no stock. You’ll see which boards stock covers before building."}
      </p>
    </form>
  );
}
