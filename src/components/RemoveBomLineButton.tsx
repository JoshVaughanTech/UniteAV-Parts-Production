"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeBomLine } from "@/lib/bom-actions";
import { btn, btnGhost, Badge } from "@/components/ui";

/**
 * Remove one row from a BOM. Confirms first: the part stays in inventory, and
 * re-importing the sheet puts the line back if it is still listed.
 */
export function RemoveBomLineButton({
  lineId,
  partNumber,
  partName,
  parentKind,
}: {
  lineId: string;
  partNumber: string;
  partName: string;
  /** Whose sheet a re-import would restore this line from. */
  parentKind: "board" | "product";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const sheet = parentKind === "board" ? "this board's BOM sheet" : "this product's BOM sheet";

  function close() {
    setOpen(false);
    setError(null);
  }

  function confirm() {
    setError(null);
    start(async () => {
      const res = await removeBomLine(lineId);
      if (res.ok) {
        close();
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="text-xs font-medium text-ink-2 hover:text-critical"
        title={`Remove ${partNumber} from this BOM`}
      >
        Remove
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Remove ${partNumber} from this BOM`}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) close();
          }}
        >
          <div className="w-full max-w-md rounded-xl border bg-surface shadow-lg">
            <header className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold text-ink">Remove this line from the BOM?</h2>
              <p className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                <Badge>{partNumber}</Badge>
                <span className="truncate">{partName}</span>
              </p>
            </header>

            <div className="space-y-2 px-4 py-3 text-sm text-ink-2">
              <p>This deletes only this BOM line. The part stays in inventory.</p>
              <p>
                Re-importing {sheet} will restore the line if the sheet still lists it.
              </p>
              {error && <p className="text-xs text-critical">{error}</p>}
            </div>

            <footer className="flex justify-end gap-2 border-t px-4 py-3">
              <button type="button" onClick={close} className={btnGhost} disabled={pending}>
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={pending}
                className={`${btn} border-transparent bg-critical text-white hover:opacity-90`}
              >
                {pending ? "Removing…" : "Remove line"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
