"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteRun } from "@/lib/production/run-actions";

/**
 * Two-step delete for a run. A run holds no catalogue data and a built one is refused
 * server-side, so this needs a confirmation but not the full impact dialog an item gets.
 */
export function DeleteRunButton({
  runId,
  runNumber,
  redirectTo,
  className = "text-xs font-medium text-ink-2 hover:text-critical disabled:opacity-50",
}: {
  runId: string;
  runNumber: string;
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
          title={`Delete ${runNumber}`}
        >
          Delete
        </button>
        {error && <span className="ml-2 text-xs text-critical">{error}</span>}
      </>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-xs text-muted">Delete {runNumber}?</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await deleteRun(runId);
            if (res.ok) {
              // replace, not push: the run we are leaving is gone, so Back must skip it.
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
