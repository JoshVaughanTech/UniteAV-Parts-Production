"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/actions";
import { btnPrimary, input } from "@/components/ui";

const REVS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/**
 * Importing a board BOM, with the three things a filename can only guess at named
 * explicitly: which board this is, its revision, and the product it is fitted to.
 *
 * Choosing an existing board re-imports over it, which rebuilds its BOM from the sheet.
 * Choosing "New board" reveals its identity fields, defaulting to whatever the filename
 * suggests if left blank.
 */
export function ImportBomForm({
  action,
  products,
  boards,
}: {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  products: { id: string; name: string }[];
  boards: { id: string; name: string; partNumber: string; rev: string | null; lines: number }[];
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [boardId, setBoardId] = useState("");
  const chosen = boards.find((b) => b.id === boardId);

  return (
    <form action={formAction} className="space-y-3 p-4">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-2">BOM file (.xlsx / .xlsm / .csv)</span>
        <input
          className="w-full rounded-lg border bg-surface px-3 py-2 text-sm text-ink file:mr-3 file:rounded file:border-0 file:bg-surface-2 file:px-2 file:py-1 file:text-ink"
          name="file"
          type="file"
          accept=".xlsx,.xlsm,.xls,.csv"
          required
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-2">Which board is this?</span>
          <select className={input} name="boardId" value={boardId} onChange={(e) => setBoardId(e.target.value)}>
            <option value="">+ New board…</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.rev ? ` (rev ${b.rev})` : ""} — {b.lines} parts
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-2">Revision</span>
          <select className={input} name="rev" defaultValue={chosen?.rev ?? ""} key={boardId}>
            <option value="">— not set —</option>
            {REVS.map((r) => (
              <option key={r} value={r}>
                Rev {r}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!boardId && (
        <div className="grid gap-3 rounded-lg border border-brand/40 bg-surface-2 p-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-2">New board item number</span>
            <input className={input} name="newBoardNumber" placeholder="from filename" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-2">New board name</span>
            <input className={input} name="newBoardName" placeholder="from filename" />
          </label>
          <p className="text-xs text-muted sm:col-span-2">
            Left blank, both are taken from the filename — <code>…an3010_e_dsp…</code> becomes item number{" "}
            <code>an3010_e_dsp</code>.
          </p>
        </div>
      )}

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-2">Goes into which product?</span>
        <select className={input} name="productItemId" defaultValue="">
          <option value="">— standalone, not fitted to a product —</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      {chosen && (
        <p className="text-xs text-serious">
          Re-importing <strong>{chosen.partNumber}</strong> rebuilds its BOM from this sheet. Its current{" "}
          {chosen.lines} lines are replaced, and any line the sheet doesn&rsquo;t carry is dropped.
        </p>
      )}

      {state && state.ok === false && <p className="text-sm text-critical">{state.error}</p>}
      {state && state.ok === true && <p className="text-sm text-good">{state.message}</p>}

      <button className={btnPrimary} disabled={pending}>
        {pending ? "Importing…" : "Import BOM"}
      </button>
      <p className="text-xs text-muted">
        Parts match on Item Number, so a part shared with another board stays one record. On-hand, cost, lead time and
        supplier are never touched.
      </p>
    </form>
  );
}
