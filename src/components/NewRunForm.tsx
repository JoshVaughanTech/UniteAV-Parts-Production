"use client";

import { useActionState, useState } from "react";
import type { RunResult } from "@/lib/production/run-actions";
import { btnPrimary, input } from "@/components/ui";

let nextKey = 1;

/**
 * A run is usually more than one item, so the form grows rows. Each row posts a parallel
 * productItemId/qty pair; the action zips and merges them.
 *
 * The same form serves both kinds — an SMD run lists boards, a finished build lists
 * products — and posts `kind` so the action can refuse a mismatched item.
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
  const noun = isSmd ? "SMD board" : "product";

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
          <div key={key} className="flex gap-2">
            <select className={`${input} flex-1`} name="productItemId" required defaultValue="">
              <option value="" disabled>
                Choose {isSmd ? "a board" : "a product"}…
              </option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                  {isSmd && it.onHand !== undefined ? ` (${it.onHand} in stock)` : ""}
                </option>
              ))}
            </select>
            <input
              className={`${input} w-20`}
              name="qty"
              type="number"
              min="1"
              defaultValue={1}
              required
              aria-label="Quantity"
            />
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                className="px-1 text-muted hover:text-critical"
                aria-label={`Remove this ${noun}`}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setRows((r) => [...r, nextKey++])}
        className="text-xs font-medium text-brand hover:opacity-80"
      >
        + Add another {noun}
      </button>

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

      <button className={btnPrimary} disabled={pending}>
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
