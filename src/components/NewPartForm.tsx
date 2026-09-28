"use client";

import { useActionState, useState } from "react";
import { createPart, type PartResult } from "@/lib/part-actions";
import { btnPrimary, input } from "@/components/ui";

/**
 * Create a part by hand. Folded away by default — the Parts page is a working list, not a
 * data-entry screen, and this is the exception rather than the rule.
 */
export function NewPartForm({ suppliers }: { suppliers: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState<PartResult | null, FormData>(createPart, null);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-brand hover:opacity-80"
      >
        + New part
      </button>
    );
  }

  return (
    <form action={formAction} className="w-full space-y-3 rounded-xl border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">New part</h2>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:text-ink">
          Close
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Item number" hint="must be unique">
          <input className={input} name="partNumber" placeholder="MECH-00099" required />
        </Field>
        <Field label="Description" className="lg:col-span-3">
          <input className={input} name="name" placeholder="Rubber grommet, 8mm" required />
        </Field>
        <Field label="Value / comment">
          <input className={input} name="value" placeholder="8mm" />
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
        <Field label="Unit">
          <input className={input} name="uom" placeholder="each" />
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
        <Field label="Lead time (days)">
          <input className={input} name="leadTimeDays" type="number" min="0" />
        </Field>
        <Field label="Reorder point">
          <input className={input} name="safetyStock" type="number" min="0" step="any" />
        </Field>
        <Field label="Pack qty">
          <input className={input} name="minPackQty" type="number" min="1" step="any" placeholder="1" />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <input className={input} name="notes" />
        </Field>
      </div>

      {state && state.ok === false && <p className="text-sm text-critical">{state.error}</p>}
      {state && state.ok === true && <p className="text-sm text-good">{state.message}</p>}

      <div className="flex items-center gap-3">
        <button className={btnPrimary} disabled={pending}>
          {pending ? "Creating…" : "Create part"}
        </button>
        <span className="text-xs text-muted">
          Starts with no stock — receive it or count it in. The category comes from the item-number prefix.
        </span>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-ink-2">
        {label}
        {hint && <span className="ml-1 font-normal text-muted">({hint})</span>}
      </span>
      {children}
    </label>
  );
}
