"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deletePo } from "@/lib/po-actions";

/**
 * Two-step delete for a purchase order that is finished with.
 *
 * A live order, and a cancelled one that took a delivery before it was closed, are both
 * refused server-side — so this needs a confirmation rather than the full impact dialog an
 * item gets. What it deletes holds nothing but its own lines, and they go with it.
 */
export function DeletePoButton({
  poId,
  poNumber,
  label = "Delete",
  redirectTo,
  className = "text-xs font-medium text-ink-2 hover:text-critical disabled:opacity-50",
}: {
  poId: string;
  poNumber: string;
  label?: string;
  /** Where to go once it's gone — omit to just refresh the current list. */
  redirectTo?: string;
  className?: string;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!armed) {
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setArmed(true);
          }}
          className={className}
          title={`Delete ${poNumber}`}
        >
          {label}
        </button>
        {error && <span className="ml-2 text-xs text-critical">{error}</span>}
      </>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted">Delete {poNumber} and its lines?</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await deletePo(poId);
            if (res.ok) {
              // replace, not push: the order we are leaving is gone, so Back must skip it.
              if (redirectTo) router.replace(redirectTo);
              else router.refresh();
            } else {
              setError(res.error);
              setArmed(false);
            }
          })
        }
        className="text-xs font-semibold text-critical hover:opacity-80 disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Yes, delete"}
      </button>
      <button type="button" onClick={() => setArmed(false)} className="text-xs text-muted hover:text-ink">
        Cancel
      </button>
    </span>
  );
}
