"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renamePart } from "@/lib/part-actions";
import { btn, btnPrimary, input } from "@/components/ui";

/**
 * Editable description for a part. Shows the name until an admin clicks Rename.
 * The item number is the join key and is not editable here.
 */
export function RenamePartForm({
  itemId,
  name,
  canEdit,
}: {
  itemId: string;
  name: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const res = await renamePart(itemId, value);
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
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <p className="text-sm text-ink-2">{name}</p>
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setValue(name);
              setError(null);
              setEditing(true);
            }}
            className="no-print text-xs font-medium text-muted hover:text-brand"
            title="Rename this part"
          >
            Rename
          </button>
        )}
        {error && <span className="text-xs text-critical">{error}</span>}
      </div>
    );
  }

  return (
    <div className="no-print mt-1 space-y-1.5">
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
          aria-label="Description of this part"
          className={`${input} max-w-lg`}
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
        <p className="text-xs text-muted">
          The item number doesn&rsquo;t change — only the description. Re-importing a BOM sheet that still lists this
          part refreshes the description from the sheet.
        </p>
      )}
    </div>
  );
}
