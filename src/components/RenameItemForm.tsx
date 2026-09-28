"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renameItem } from "@/lib/item-actions";
import { btn, btnPrimary, input } from "@/components/ui";

/**
 * Editable heading for a product or board. Shows the name as an <h1> until you click
 * Rename, so the page reads normally and the control stays out of the way.
 */
export function RenameItemForm({
  itemId,
  name,
  canEdit,
  label = "product",
}: {
  itemId: string;
  name: string;
  canEdit: boolean;
  label?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const res = await renameItem(itemId, value);
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-ink">{name}</h1>
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setValue(name);
              setError(null);
              setEditing(true);
            }}
            className="no-print text-xs font-medium text-muted hover:text-brand"
            title={`Rename this ${label}`}
          >
            Rename
          </button>
        )}
        {error && <span className="text-xs text-critical">{error}</span>}
      </div>
    );
  }

  return (
    <div className="no-print space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") setEditing(false);
          }}
          maxLength={120}
          aria-label={`Name of this ${label}`}
          className={`${input} max-w-sm text-lg font-semibold`}
        />
        <button type="button" onClick={save} disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setEditing(false)} disabled={pending} className={btn}>
          Cancel
        </button>
      </div>
      {error ? (
        <p className="text-xs text-critical">{error}</p>
      ) : (
        <p className="text-xs text-muted">The item number doesn&rsquo;t change — only the name shown in the app.</p>
      )}
    </div>
  );
}
