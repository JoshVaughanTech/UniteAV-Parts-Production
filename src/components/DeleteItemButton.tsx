"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assessItemRemoval, removeItem } from "@/lib/item-actions";
import type { RemovalImpact } from "@/lib/item-removal";
import { btn, btnGhost, Badge } from "@/components/ui";
import { fmtNum, fmtMoney } from "@/lib/format";

const LABEL: Record<string, string> = { PRODUCT: "product", ASSEMBLY: "board", PART: "part" };

/**
 * Delete control for any item. Clicking it asks the server what would actually happen
 * first, so the dialog names the BOMs that lose a line, the products that get rebuilt and
 * the history that would be destroyed — before anything is written.
 */
export function DeleteItemButton({
  itemId,
  label = "Delete",
  className,
  currency = "AUD",
  redirectTo,
}: {
  itemId: string;
  label?: string;
  className?: string;
  currency?: string;
  /** Where to go once it's gone. Required on an item's own page — a hard delete leaves
   *  that route pointing at nothing, so refreshing in place would land on a 404. Omit it
   *  in a list, where refreshing just drops the row. */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [impact, setImpact] = useState<RemovalImpact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();

  function open() {
    setError(null);
    setTyped("");
    start(async () => {
      const res = await assessItemRemoval(itemId);
      if (res.ok) setImpact(res.impact);
      else setError(res.error);
    });
  }

  function close() {
    setImpact(null);
    setError(null);
    setTyped("");
  }

  function confirm() {
    start(async () => {
      const res = await removeItem(itemId);
      if (res.ok) {
        close();
        // replace, not push: the page we are leaving no longer exists, so Back must skip it.
        if (redirectTo) router.replace(redirectTo);
        else router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={pending}
        className={className ?? "text-xs font-medium text-ink-2 hover:text-critical disabled:opacity-50"}
        title="Delete or archive this item"
      >
        {pending && !impact ? "…" : label}
      </button>

      {error && !impact && <span className="ml-2 text-xs text-critical">{error}</span>}

      {impact && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Remove ${impact.partNumber}`}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="w-full max-w-lg rounded-xl border bg-surface shadow-lg">
            <header className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold text-ink">
                {impact.verdict === "BLOCKED"
                  ? `Can’t remove this ${LABEL[impact.type] ?? "item"}`
                  : impact.verdict === "ARCHIVE"
                    ? `Archive this ${LABEL[impact.type] ?? "item"}?`
                    : `Delete this ${LABEL[impact.type] ?? "item"}?`}
              </h2>
              <p className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                <Badge>{impact.partNumber}</Badge>
                <span className="truncate">{impact.name}</span>
              </p>
            </header>

            <div className="space-y-3 px-4 py-3 text-sm">
              {impact.verdict === "BLOCKED" ? (
                <p className="text-serious">{impact.blockedReason}</p>
              ) : (
                <>
                  {impact.verdict === "ARCHIVE" ? (
                    <p className="text-ink-2">
                      This has history that can’t be rebuilt, so it will be <strong className="text-ink">archived</strong>{" "}
                      rather than deleted: hidden from every list and picker, with its records kept.
                    </p>
                  ) : (
                    <p className="text-ink-2">
                      Nothing references this beyond its BOM lines, so it will be{" "}
                      <strong className="text-critical">permanently deleted</strong>. This can’t be undone.
                    </p>
                  )}

                  {impact.preserves.length > 0 && (
                    <Section title="Kept">
                      <ul className="list-inside list-disc text-ink-2">
                        {impact.preserves.map((k) => (
                          <li key={k}>{k}</li>
                        ))}
                      </ul>
                    </Section>
                  )}

                  {impact.usedBy.length > 0 && (
                    <Section title={`Removed from ${fmtNum(impact.usedBy.length)} BOM${impact.usedBy.length === 1 ? "" : "s"}`}>
                      <ul className="space-y-0.5 text-ink-2">
                        {impact.usedBy.map((u) => (
                          <li key={u.partNumber}>
                            {u.name} <span className="text-muted">({u.partNumber})</span>
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}

                  {impact.affectedProducts.length > 0 && (
                    <Section title={`${fmtNum(impact.affectedProducts.length)} product${impact.affectedProducts.length === 1 ? "" : "s"} rebuilt`}>
                      <p className="text-ink-2">{impact.affectedProducts.map((p) => p.name).join(", ")}</p>
                    </Section>
                  )}

                  {impact.ownLines > 0 && (
                    <Section title="Its own BOM">
                      <p className="text-ink-2">
                        {fmtNum(impact.ownLines)} line{impact.ownLines === 1 ? "" : "s"} — the parts stay in the
                        catalogue, only this {LABEL[impact.type] ?? "item"}’s lines to them go.
                      </p>
                    </Section>
                  )}

                  {impact.onHand !== 0 && (
                    <Section title="Stock on hand">
                      <p className={impact.verdict === "DELETE" ? "text-serious" : "text-ink-2"}>
                        {fmtNum(impact.onHand)} on hand
                        {impact.stockValue !== 0 && <> · {fmtMoney(impact.stockValue, currency)}</>}
                      </p>
                    </Section>
                  )}

                  {impact.verdict === "DELETE" && (
                    <label className="block pt-1">
                      <span className="mb-1 block text-xs font-medium text-ink-2">
                        Type <span className="font-mono text-ink">{impact.partNumber}</span> to confirm
                      </span>
                      <input
                        autoFocus
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                        className="w-full rounded-lg border bg-surface px-3 py-1.5 text-sm text-ink focus:border-critical focus:outline-none"
                      />
                    </label>
                  )}
                </>
              )}

              {error && <p className="text-xs text-critical">{error}</p>}
            </div>

            <footer className="flex justify-end gap-2 border-t px-4 py-3">
              <button type="button" onClick={close} className={btnGhost} disabled={pending}>
                Cancel
              </button>
              {impact.verdict !== "BLOCKED" && (
                <button
                  type="button"
                  onClick={confirm}
                  disabled={pending || (impact.verdict === "DELETE" && typed.trim() !== impact.partNumber)}
                  className={`${btn} border-transparent bg-critical text-white hover:opacity-90`}
                >
                  {pending ? "Working…" : impact.verdict === "ARCHIVE" ? "Archive" : "Delete permanently"}
                </button>
              )}
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-surface-2 px-3 py-2">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
