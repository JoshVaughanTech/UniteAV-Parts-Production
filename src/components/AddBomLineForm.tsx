"use client";

import { useActionState } from "react";
import { addBomLine, type BomResult } from "@/lib/bom-actions";
import { btnPrimary, input } from "@/components/ui";

/**
 * Add an existing part or board to this BOM. The item has to exist already — creating a
 * part is a separate step on the Parts page, so a typo can't quietly invent one.
 */
export function AddBomLineForm({
  parentItemId,
  options,
  isAssembly,
}: {
  parentItemId: string;
  options: { partNumber: string; name: string }[];
  isAssembly: boolean;
}) {
  const [state, formAction, pending] = useActionState<BomResult | null, FormData>(addBomLine, null);
  const listId = `bom-add-${parentItemId}`;

  return (
    <form action={formAction} className="space-y-2 p-4">
      <div className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="parentItemId" value={parentItemId} />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-2">Item number</span>
          <input
            className={`${input} w-56`}
            name="partNumber"
            list={listId}
            placeholder={isAssembly ? "e.g. CAPS-00085" : "part or board"}
            required
          />
          <datalist id={listId}>
            {options.map((o) => (
              <option key={o.partNumber} value={o.partNumber}>
                {o.name}
              </option>
            ))}
          </datalist>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-2">Qty / unit</span>
          <input className={`${input} w-24`} name="qtyPer" type="number" min="0" step="any" defaultValue={1} required />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-2">Designators (optional)</span>
          <input className={`${input} w-40`} name="reference" placeholder="R1, C2…" />
        </label>
        <button className={btnPrimary} disabled={pending}>
          {pending ? "Adding…" : "Add to BOM"}
        </button>
      </div>
      {state && state.ok === false && <p className="text-sm text-critical">{state.error}</p>}
      {state && state.ok === true && <p className="text-sm text-good">{state.message}</p>}
      <p className="text-xs text-muted">
        Re-importing this BOM from its spreadsheet rebuilds it from the sheet, which drops lines the sheet
        doesn&rsquo;t carry — including ones added here.
      </p>
    </form>
  );
}
