"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePartIdentity } from "@/lib/part-actions";
import { btn, btnPrimary, input } from "@/components/ui";

/**
 * Admin edit for a part's item number and description. The page is addressed by id,
 * so changing the number does not move the URL. Shown only where the caller has
 * already decided the viewer is an admin.
 */
export function RenamePartForm({
  itemId,
  partNumber,
  name,
}: {
  itemId: string;
  partNumber: string;
  name: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [number, setNumber] = useState(partNumber);
  const [description, setDescription] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function open() {
    setNumber(partNumber);
    setDescription(name);
    setError(null);
    setEditing(true);
  }

  function save() {
    const nextNumber = number.trim();
    const nextName = description.trim();
    if (!nextNumber) {
      setError("Part number can't be empty.");
      return;
    }
    if (!nextName) {
      setError("Description can't be empty.");
      return;
    }
    if (nextNumber === partNumber && nextName === name) {
      setError("Nothing changed.");
      return;
    }
    setError(null);
    start(async () => {
      const res = await updatePartIdentity(itemId, nextNumber, nextName);
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
      <div className="no-print mt-1">
        <button
          type="button"
          onClick={open}
          className="text-xs font-medium text-muted hover:text-brand"
          title="Edit this part's number and description"
        >
          Edit number &amp; description
        </button>
        {error && <span className="ml-2 text-xs text-critical">{error}</span>}
      </div>
    );
  }

  return (
    <div className="no-print mt-2 space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-2">Part number</span>
          <input
            autoFocus
            value={number}
            placeholder={partNumber}
            onChange={(e) => setNumber(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
              if (e.key === "Escape") setEditing(false);
            }}
            maxLength={80}
            required
            aria-label="Part number"
            className={input}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-2">Description</span>
          <input
            value={description}
            placeholder={name}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
              if (e.key === "Escape") setEditing(false);
            }}
            required
            aria-label="Description"
            className={input}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : "Save changes"}
        </button>
        <button type="button" onClick={() => setEditing(false)} disabled={pending} className={btn}>
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-critical">{error}</p>}
      <p className="text-xs text-muted">
        A later BOM re-import matches by part number, so a sheet that still has the old number creates a new part
        instead of updating this one. Imports can also refresh the description from the sheet.
      </p>
    </div>
  );
}
