"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { restoreItem } from "@/lib/item-actions";

/** Bring an archived item back into the catalogue. It does not return to any BOM. */
export function RestoreItemButton({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await restoreItem(itemId);
            if (res.ok) router.refresh();
            else setError(res.error ?? "Restore failed.");
          })
        }
        className="text-xs font-medium text-brand hover:opacity-80 disabled:opacity-50"
        title="Return this item to the catalogue (not to any BOM)"
      >
        {pending ? "…" : "Restore"}
      </button>
      {error && <span className="ml-2 text-xs text-critical">{error}</span>}
    </>
  );
}
