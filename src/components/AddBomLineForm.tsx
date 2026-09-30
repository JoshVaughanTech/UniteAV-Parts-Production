"use client";

import { useActionState, useMemo, useState } from "react";
import { addBomLine, type BomResult } from "@/lib/bom-actions";
import { btnPrimary, input } from "@/components/ui";

/**
 * Add a line to this BOM, either from the catalogue or by creating the part here.
 *
 * Creating is an explicit mode rather than something that only appears once you happen to
 * type an unknown item number — but typing one in "existing" mode still opens the fields,
 * so neither route is a dead end.
 *
 * Matching is exact: the item number is the join key every BOM, purchase order and import
 * file uses, and MECH-00046 and mech-00046 would be two different parts to every import.
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
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [typed, setTyped] = useState("");
  const listId = `bom-add-${parentItemId}`;

  const known = useMemo(() => new Map(options.map((o) => [o.partNumber, o.name])), [options]);
  const trimmed = typed.trim();
  const match = known.get(trimmed);
  const isNew = mode === "new";
  // Asking to create something that already exists — offer the other mode instead.
  const clash = isNew && match !== undefined;
  const creating = !clash && (isNew || (trimmed !== "" && match === undefined));

  return (
    <form action={formAction} className="space-y-3 p-4">
      <div className="no-print flex gap-1 rounded-lg border bg-surface-2 p-1">
        {(
          [
            ["existing", "Add an existing item"],
            ["new", "Create a new part"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            aria-pressed={mode === key}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === key ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="parentItemId" value={parentItemId} />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-2">Item number</span>
          <input
            className={`${input} w-56`}
            name="partNumber"
            list={isNew ? undefined : listId}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={isNew ? "e.g. MECH-00099" : isAssembly ? "e.g. CAPS-00085" : "part or board"}
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
        <button className={btnPrimary} disabled={pending || clash}>
          {pending ? "Adding…" : creating ? "Create & add" : "Add to BOM"}
        </button>
      </div>

      {clash && (
        <p className="text-sm text-serious">
          <strong>{trimmed}</strong> is already in the catalogue ({match}). Switch to{" "}
          <button type="button" onClick={() => setMode("existing")} className="font-medium text-brand hover:opacity-80">
            Add an existing item
          </button>
          .
        </p>
      )}
      {!isNew && match !== undefined && <p className="text-xs text-ink-2">{match}</p>}

      {creating && (
        <div className="space-y-3 rounded-lg border border-brand/40 bg-surface-2 p-3">
          <p className="text-xs text-ink-2">
            {trimmed === "" ? (
              "Give the new part an item number above, then fill this in."
            ) : (
              <>
                <strong className="text-ink">{trimmed}</strong>
                {mode === "existing" ? " isn’t in the catalogue. Filling this in creates it" : " will be created"} as a
                part, added to this BOM, and listed in Parts &amp; Inventory.
              </>
            )}
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
