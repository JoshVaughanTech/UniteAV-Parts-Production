"use client";

import { useActionState, useState } from "react";
import type { RunResult } from "@/lib/production/run-actions";
import { btnPrimary, input } from "@/components/ui";

let nextKey = 1;

/**
 * A run is usually more than one product, so the form grows rows. Each row posts a
 * parallel productItemId/qty pair; the action zips and merges them.
 */
export function NewRunForm({
  action,
  products,
  today,
}: {
  action: (prev: RunResult | null, formData: FormData) => Promise<RunResult>;
  products: { id: string; name: string }[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [rows, setRows] = useState<number[]>([0]);

  if (products.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted">No products to build yet — import a BOM first.</p>;
  }

  return (
    <form action={formAction} className="space-y-3 p-4">
      <div className="space-y-2">
        {rows.map((key, i) => (
          <div key={key} className="flex gap-2">
            <select className={`${input} flex-1`} name="productItemId" required defaultValue="">
              <option value="" disabled>
                Choose a product…
              </option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
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
                aria-label="Remove this product"
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
        + Add another product
      </button>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-2">Build date</span>
          <input className={input} name="plannedAt" type="date" defaultValue={today} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-2">Note (optional)</span>
          <input className={input} name="note" placeholder="Order #, customer…" />
        </label>
      </div>

      {state && state.ok === false && <p className="text-sm text-critical">{state.error}</p>}

      <button className={btnPrimary} disabled={pending}>
        {pending ? "Working…" : "Plan run"}
      </button>
      <p className="text-xs text-muted">Planning changes no stock. You&rsquo;ll see coverage before building.</p>
    </form>
  );
}
