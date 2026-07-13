"use client";

import { useState } from "react";
import Link from "next/link";
import type { PartRow } from "@/lib/metrics";
import { StatusBadge, input } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { bulkUpdateParts } from "@/lib/actions";
import { fmtNum, fmtCost } from "@/lib/format";

export function PartsTable({
  rows,
  suppliers,
  currency,
  canEdit,
}: {
  rows: PartRow[];
  suppliers: { id: string; name: string }[];
  currency: string;
  canEdit: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  return (
    <div>
      {canEdit && selected.size > 0 && (
        <div className="no-print sticky top-0 z-10 border-b bg-surface-2 px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-ink">{selected.size} selected</span>
            <button onClick={() => setSelected(new Set())} className="text-xs text-muted hover:text-ink">
              Clear
            </button>
          </div>
          <ActionForm
            action={bulkUpdateParts}
            submitLabel={`Apply to ${selected.size}`}
            className="flex flex-wrap items-end gap-2"
          >
            <input type="hidden" name="ids" value={[...selected].join(",")} />
            <Field label="Supplier">
              <select className={`${input} w-40`} name="supplierId" defaultValue="">
                <option value="">— unchanged —</option>
                <option value="__none__">Unassign</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Lead time (d)">
              <input className={`${input} w-24`} name="leadTimeDays" type="number" min="0" placeholder="—" />
            </Field>
            <Field label="Reorder pt">
              <input className={`${input} w-24`} name="safetyStock" type="number" min="0" placeholder="—" />
            </Field>
            <Field label="Pack qty">
              <input className={`${input} w-24`} name="minPackQty" type="number" min="1" placeholder="—" />
            </Field>
            <Field label="Unit cost">
              <input className={`${input} w-24`} name="unitCost" type="number" min="0" step="any" placeholder="—" />
            </Field>
          </ActionForm>
          <p className="mt-1 text-xs text-muted">Blank fields are left unchanged.</p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
              {canEdit && (
                <th className="no-print w-8 px-4 py-2.5">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                </th>
              )}
              <th className="px-4 py-2.5 font-medium">Part</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 text-right font-medium">On hand</th>
              <th
                className="px-4 py-2.5 text-right font-medium"
                title="Reorder point = avg daily use × lead time + safety stock. Reorder when on-hand drops to this."
              >
                Reorder point
              </th>
              <th
                className="px-4 py-2.5 text-right font-medium"
                title="Average daily use — parts consumed by builds over the usage window ÷ days."
              >
                Avg daily use
              </th>
              <th className="px-4 py-2.5 text-right font-medium">Lead</th>
              <th className="px-4 py-2.5 text-right font-medium">Used in</th>
              <th className="px-4 py-2.5 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={`border-b last:border-0 hover:bg-surface-2 ${selected.has(p.id) ? "bg-brand/5" : ""}`}>
                {canEdit && (
                  <td className="no-print px-4 py-2.5">
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Select ${p.partNumber}`} />
                  </td>
                )}
                <td className="px-4 py-2.5">
                  <Link href={`/parts/${p.id}`} className="font-medium text-ink hover:text-brand">
                    {p.partNumber}
                  </Link>
                  <div className="max-w-xs truncate text-xs text-muted">
                    {p.value ? `${p.value} · ` : ""}
                    {p.name}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={p.reorder.status} />
                </td>
                <td className="px-4 py-2.5 text-right tnum">{fmtNum(p.onHand)}</td>
                <td className="px-4 py-2.5 text-right tnum">{fmtNum(p.reorder.rop, 1)}</td>
                <td className="px-4 py-2.5 text-right tnum">{p.adu > 0 ? fmtNum(p.adu, 2) : "—"}</td>
                <td className="px-4 py-2.5 text-right tnum">{p.leadTimeDays == null ? "—" : `${p.leadTimeDays}d`}</td>
                <td className="px-4 py-2.5 text-right tnum">{fmtNum(p.usedInCount)}</td>
                <td className="px-4 py-2.5 text-right tnum">{p.unitCost == null ? "—" : fmtCost(p.unitCost, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}
