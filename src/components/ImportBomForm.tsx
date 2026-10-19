"use client";

import { useActionState, useMemo, useState } from "react";
import type { ActionResult } from "@/lib/actions";
import { btnPrimary, input } from "@/components/ui";

const REVS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export interface ImportBoardOption {
  id: string;
  name: string;
  partNumber: string;
  rev: string | null;
  lines: number;
  /** Products this board is fitted to. */
  productIds: string[];
}

/**
 * Importing a board BOM, with the three things a filename cannot know named explicitly:
 * the product it belongs to, which board it is, and its revision.
 *
 * The product comes first because it narrows the board list to that product's own boards —
 * on a catalogue of sixteen, scrolling past the fifteen that belong to something else is
 * how the wrong one gets picked. Changing the product clears a board that is no longer in
 * the list, so what is submitted is always what is on screen.
 */
export function ImportBomForm({
  action,
  products,
  boards,
}: {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  products: { id: string; name: string }[];
  boards: ImportBoardOption[];
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [productId, setProductId] = useState("");
  const [boardId, setBoardId] = useState("");

  // No product chosen means a standalone import, which can re-import any board.
  const visible = useMemo(
    () => (productId ? boards.filter((b) => b.productIds.includes(productId)) : boards),
    [boards, productId],
  );
  const chosen = visible.find((b) => b.id === boardId);
  const product = products.find((p) => p.id === productId);

  function pickProduct(next: string) {
    setProductId(next);
    // Drop a board that the new product does not fit, so the form never submits a choice
    // the list no longer offers.
    if (boardId && next && !boards.find((b) => b.id === boardId)?.productIds.includes(next)) setBoardId("");
  }

  return (
    <form action={formAction} className="space-y-3 p-4">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-2">Goes into which product?</span>
        <select className={input} name="productItemId" value={productId} onChange={(e) => pickProduct(e.target.value)}>
          <option value="">— standalone, not fitted to a product —</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-2">Which board is this?</span>
          <select className={input} name="boardId" value={boardId} onChange={(e) => setBoardId(e.target.value)}>
            <option value="">+ New board…</option>
            {visible.map((b) => (
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

      {product && (
        <p className="text-xs text-muted">
          {visible.length === 0 ? (
            <>
              <strong className="text-ink">{product.name}</strong> has no boards yet — this import will be its first.
            </>
          ) : (
            <>
              Showing the {visible.length} board{visible.length === 1 ? "" : "s"} already on{" "}
              <strong className="text-ink">{product.name}</strong>. Choose <em>New board</em> to add another.
            </>
          )}
        </p>
      )}

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
