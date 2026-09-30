"use client";

import { useActionState, useState } from "react";
import { buildRun, unbuildRun, cancelRun, updateRunLines, type RunResult } from "@/lib/production/run-actions";
import { DeleteRunButton } from "@/components/DeleteRunButton";
import { Card, btn, btnPrimary, btnGhost, input } from "@/components/ui";

type Line = { id: string; name: string; qtyPlanned: number };

/** Build / edit / cancel controls for a run, each its own action form. */
export function RunActions({
  runId,
  runNumber,
  status,
  isSmdRun,
  canManage,
  fullyCovered,
  shortCount,
  lines,
}: {
  runId: string;
  runNumber: string;
  status: string;
  isSmdRun: boolean;
  canManage: boolean;
  fullyCovered: boolean;
  shortCount: number;
  lines: Line[];
}) {
  if (status === "CANCELLED") {
    return canManage ? (
      <Card title="This run is cancelled">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4">
          <span className="text-sm text-ink-2">It moved no stock. Deleting removes it and its lines.</span>
          <DeleteRunButton runId={runId} runNumber={runNumber} redirectTo="/production" />
        </div>
      </Card>
    ) : null;
  }

  if (status === "BUILT") {
    return canManage ? (
      <Card title="This run is built">
        <div className="space-y-2 p-4">
          <p className="text-sm text-ink-2">
            Unbuilding restores every part it consumed
            {isSmdRun ? " and takes the boards back out of stock" : ""}, and puts the run back to planned. It has to
            be unbuilt before it can be deleted.
          </p>
          <SimpleForm action={unbuildRun} runId={runId} label="Unbuild run" className={btnGhost} />
        </div>
      </Card>
    ) : null;
  }

  return (
    <div className="no-print space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <BuildCard runId={runId} isSmdRun={isSmdRun} fullyCovered={fullyCovered} shortCount={shortCount} lines={lines} />
        <EditCard runId={runId} lines={lines} />
      </div>
      {canManage && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3">
          <span className="text-xs text-muted">
            Deleting removes the run and its lines. It has moved no stock, so nothing else changes.
          </span>
          <DeleteRunButton runId={runId} runNumber={runNumber} redirectTo="/production" />
        </div>
      )}
    </div>
  );
}

function BuildCard({
  runId,
  isSmdRun,
  fullyCovered,
  shortCount,
  lines,
}: {
  runId: string;
  isSmdRun: boolean;
  fullyCovered: boolean;
  shortCount: number;
  lines: Line[];
}) {
  const [state, formAction, pending] = useActionState(buildRun, null);
  const [short, setShort] = useState(false);

  return (
    <Card title={isSmdRun ? "Mark the SMD run built" : "Build this run"}>
      <form action={formAction} className="space-y-3 p-4">
        <p className="text-sm text-ink-2">
          {fullyCovered
            ? isSmdRun
              ? "Stock covers the run. Building consumes the parts listed above and puts the boards into stock."
              : "Stock covers the run. Building consumes the parts and boards listed above."
            : `${shortCount} part${shortCount === 1 ? " is" : "s are"} short — order them first, or build anyway and let those parts go below zero.`}
        </p>

        <div className="space-y-2">
          {lines.map((l) => (
            <label key={l.id} className="flex items-center gap-2">
              <span className="flex-1 truncate text-sm text-ink">{l.name}</span>
              <input
                className={`${input} w-20`}
                name={`built_${l.id}`}
                type="number"
                min="0"
                defaultValue={l.qtyPlanned}
                aria-label={`Quantity built of ${l.name}`}
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-muted">Enter what was actually built — a short build is still recorded.</p>

        {!fullyCovered && (
          <label className="flex items-start gap-2 rounded-lg border border-serious/40 bg-surface-2 px-3 py-2">
            <input type="checkbox" name="allowShort" checked={short} onChange={(e) => setShort(e.target.checked)} />
            <span className="text-xs text-ink-2">
              Build anyway, taking the short parts below zero. Use this when stock on the shelf is better than the
              records.
            </span>
          </label>
        )}

        <input type="hidden" name="runId" value={runId} />
        {state && state.ok === false && <p className="text-sm text-critical">{state.error}</p>}
        {state && state.ok === true && <p className="text-sm text-good">{state.message}</p>}
        <button className={btnPrimary} disabled={pending || (!fullyCovered && !short)}>
          {pending ? "Building…" : "Mark built"}
        </button>
      </form>
    </Card>
  );
}

function EditCard({ runId, lines }: { runId: string; lines: Line[] }) {
  const [state, formAction, pending] = useActionState(updateRunLines, null);

  return (
    <Card title="Change the run">
      <form action={formAction} className="space-y-3 p-4">
        <div className="space-y-2">
          {lines.map((l) => (
            <label key={l.id} className="flex items-center gap-2">
              <span className="flex-1 truncate text-sm text-ink">{l.name}</span>
              <input
                className={`${input} w-20`}
                name={`qty_${l.id}`}
                type="number"
                min="0"
                defaultValue={l.qtyPlanned}
                aria-label={`Planned quantity of ${l.name}`}
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-muted">Set a quantity to 0 to drop that line from the run.</p>

        <input type="hidden" name="runId" value={runId} />
        {state && state.ok === false && <p className="text-sm text-critical">{state.error}</p>}
        {state && state.ok === true && <p className="text-sm text-good">{state.message}</p>}
        <div className="flex gap-2">
          <button className={btnGhost} disabled={pending}>
            {pending ? "Saving…" : "Save quantities"}
          </button>
        </div>
      </form>
      <div className="border-t px-4 py-3">
        <SimpleForm
          action={cancelRun}
          runId={runId}
          label="Cancel run"
          className={`${btn} border-transparent text-ink-2 hover:text-critical`}
        />
      </div>
    </Card>
  );
}

function SimpleForm({
  action,
  runId,
  label,
  className,
}: {
  action: (prev: RunResult | null, formData: FormData) => Promise<RunResult>;
  runId: string;
  label: string;
  className: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction}>
      <input type="hidden" name="runId" value={runId} />
      <button className={className} disabled={pending}>
        {pending ? "Working…" : label}
      </button>
      {state && state.ok === false && <p className="mt-1 text-sm text-critical">{state.error}</p>}
      {state && state.ok === true && <p className="mt-1 text-sm text-good">{state.message}</p>}
    </form>
  );
}
