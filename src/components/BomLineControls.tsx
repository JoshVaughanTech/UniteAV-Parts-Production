"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBomLineQty, removeBomLine } from "@/lib/bom-actions";
import { input } from "@/components/ui";

/**
 * Per-row quantity edit and remove for a BOM line. These call the server actions directly
 * rather than sitting in <form>s, because a row's controls live inside the BOM table and
 * a form can't nest inside another.
 */
export function BomLineControls({ lineId, qtyPer }: { lineId: string; qtyPer: number }) {
  const router = useRouter();
  const [qty, setQty] = useState(String(qtyPer));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const changed = qty.trim() !== "" && Number(qty) !== qtyPer;

  function save() {
    setError(null);
    start(async () => {
      const res = await setBomLineQty(lineId, Number(qty));
      if (res.ok) router.refresh();
      else {
        setError(res.error);
        setQty(String(qtyPer));
      }
    });
  }

  function remove() {
    setError(null);
    start(async () => {
      const res = await removeBomLine(lineId);
      if (res.ok) router.refresh();
      else {
        setError(res.error);
        setConfirming(false);
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && changed) {
            e.preventDefault();
            save();
          }
        }}
        type="number"
        min="0"
        step="any"
        disabled={pending}
        aria-label="Quantity per unit"
        className={`${input} w-20 py-1 text-right`}
      />
      {changed && (
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="text-xs font-semibold text-brand hover:opacity-80 disabled:opacity-50"
        >
          {pending ? "…" : "Save"}
        </button>
      )}
      {confirming ? (
        <>
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="text-xs font-semibold text-critical hover:opacity-80 disabled:opacity-50"
          >
            {pending ? "…" : "Remove"}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="text-xs text-muted hover:text-ink">
            no
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="px-1 text-muted hover:text-critical"
          title="Take this line off the BOM"
          aria-label="Remove this line"
        >
          ×
        </button>
      )}
      {error && <span className="text-xs text-critical">{error}</span>}
    </span>
  );
}
