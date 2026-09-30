"use client";

import { useActionState, useMemo, useState } from "react";
import { addBomLine, type BomResult } from "@/lib/bom-actions";
import { btnPrimary, input } from "@/components/ui";

/**
 * Add a line to this BOM. Typing an item number the catalogue doesn't have opens the
 * fields to create it, so a part that only exists on this board can be added without a
 * detour to the Parts page. Matching is exact — item numbers are the join key, and
 * MECH-00046 and mech-00046 would be two different parts to every import.
 */
export function AddBomLineForm({
  parentItemId,
  options,
  suppliers,
  isAssembly,
}: {
  parentItemId: string;
  options: { partNumber: string; name: string }[];
  suppliers: { id: string; name: string }[];
  isAssembly: boolean;
}) {
  const [state, formAction, pending] = useActionState<BomResult | null, FormData>(addBomLine, null);
  const [typed, setTyped] = useState("");
  const listId = `bom-add-${parentItemId}`;

  const known = useMemo(() => new Map(options.map((o) => [o.partNumber, o.name])), [options]);
  const trimmed = typed.trim();
  const match = known.get(trimmed);
  const isNew = trimmed !== "" && match === undefined;

  return (
    <form action={formAction} className="space-y-3 p-4">
      <div className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="parentItemId" value={parentItemId} />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-2">Item number</span>
          <input
            className={`${input} w-56`}
            name="partNumber"
            list={listId}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
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
          {pending ? "Adding…" : isNew ? "Create & add" : "Add to BOM"}
        </button>
      </div>

      {match !== undefined && <p className="text-xs text-ink-2">{match}</p>}

      {isNew && (
        <div className="space-y-3 rounded-lg border border-brand/40 bg-surface-2 p-3">
          <p className="text-xs text-ink-2">
            <strong className="text-ink">{trimmed}</strong> isn&rsquo;t in the catalogue. Fill this in and it will be
            created as a part, added to this BOM, and listed in Parts &amp; Inventory.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Description" className="sm:col-span-2">
              <input className={input} name="name" placeholder="Rubber grommet, 8mm" required />
            </Field>
            <Field label="Value / comment">
              <input className={input} name="value" />
            </Field>
            <Field label="Footprint">
              <input className={input} name="footprint" />
            </Field>
            <Field label="Manufacturer">
              <input className={input} name="manufacturer" />
            </Field>
            <Field label="Manufacturer part no.">
              <input className={input} name="mpn" />
            </Field>
            <Field label="Unit cost">
              <input className={input} name="unitCost" type="number" min="0" step="any" />
            </Field>
            <Field label="Supplier">
              <select className={input} name="supplierId" defaultValue="">
                <option value="">— none —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="text-xs text-muted">
            Stock starts at zero — receive it or count it in. The category comes from the item-number prefix.
          </p>
        </div>
      )}

      {state && state.ok === false && <p className="text-sm text-critical">{state.error}</p>}
      {state && state.ok === true && <p className="text-sm text-good">{state.message}</p>}
      <p className="text-xs text-muted">
        Re-importing this BOM from its spreadsheet rebuilds it from the sheet, which drops lines the sheet
        doesn&rsquo;t carry — including ones added here.
      </p>
    </form>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}
