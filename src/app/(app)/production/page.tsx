import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/rbac";
import { roleAtLeast } from "@/lib/constants";
import { logProduction } from "@/lib/actions";
import { createRun } from "@/lib/production/run-actions";
import { ActionForm } from "@/components/ActionForm";
import { ReverseButton } from "@/components/ReverseButton";
import { NewRunForm } from "@/components/NewRunForm";
import { DeleteRunButton } from "@/components/DeleteRunButton";
import { Card, EmptyState, Badge, input } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { fmtNum, fmtDate, fmtDateInput } from "@/lib/format";

const TABS = [
  { key: "smd", label: "SMD Builds" },
  { key: "finished", label: "Finished Builds" },
  { key: "log", label: "Build history" },
] as const;
type Tab = (typeof TABS)[number]["key"];

function asTab(raw: string | undefined): Tab {
  return TABS.some((t) => t.key === raw) ? (raw as Tab) : "smd";
}

const RUN_TONE: Record<string, string> = {
  PLANNED: "text-brand",
  BUILT: "text-good",
  CANCELLED: "text-muted",
};

const BLURB: Record<Tab, string> = {
  smd: "The machine run. Populates bare boards and puts them into board stock.",
  finished: "The rest of the build — hand-soldering, looms, metalwork, packing. Draws boards back out of stock.",
  log: "Every build recorded, newest first.",
};

export default async function ProductionPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = asTab((await searchParams).tab);
  const isSmd = tab === "smd";
  const runKind = isSmd ? "SMD" : "FINISHED";

  const [user, products, boards, runs, logs, smdCount, finishedCount] = await Promise.all([
    currentUser(),
    prisma.item.findMany({
      where: { type: "PRODUCT", active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.item.findMany({
      where: { type: "ASSEMBLY", active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, onHand: true },
    }),
    tab === "log"
      ? Promise.resolve([])
      : prisma.productionRun.findMany({
          where: { kind: runKind },
          orderBy: [{ createdAt: "desc" }],
          take: 40,
          include: {
            lines: { include: { product: { select: { name: true } } } },
            user: { select: { name: true, email: true } },
          },
        }),
    tab === "log"
      ? prisma.productionLog.findMany({
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          take: 80,
          include: {
            product: { select: { name: true, partNumber: true, type: true } },
            user: { select: { name: true, email: true } },
          },
        })
      : Promise.resolve([]),
    prisma.productionRun.count({ where: { kind: "SMD" } }),
    prisma.productionRun.count({ where: { kind: "FINISHED" } }),
  ]);
  const counts: Record<Tab, number | null> = { smd: smdCount, finished: finishedCount, log: null };
  const canLog = roleAtLeast(user?.role, "OPERATOR");
  const canManage = roleAtLeast(user?.role, "MANAGER");
  const today = fmtDateInput(new Date());
  // SMD boards and finished products are logged the same way but read as separate work.
  const boardLogs = logs.filter((l) => l.product.type === "ASSEMBLY");
  const productLogs = logs.filter((l) => l.product.type !== "ASSEMBLY");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Production</h1>
          <p className="text-sm text-muted">{BLURB[tab]}</p>
        </div>
        <PrintButton label="Print" />
      </header>

      <nav className="no-print flex gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={{ pathname: "/production", query: t.key === "smd" ? {} : { tab: t.key } }}
            aria-current={tab === t.key ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.key ? "border-brand text-brand" : "border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            {t.label}
            {counts[t.key] !== null && (
              <span className="ml-1.5 text-xs tnum text-muted">{fmtNum(counts[t.key]!)}</span>
            )}
          </Link>
        ))}
      </nav>

      {tab !== "log" ? (
        <div className="space-y-6">
          <div className="no-print">
            <Card title={isSmd ? "Plan an SMD run" : "Plan a finished build"}>
              {canLog ? (
                <NewRunForm
                  action={createRun}
                  items={isSmd ? boards : products}
                  today={today}
                  kind={isSmd ? "SMD" : "FINISHED"}
                />
              ) : (
                <EmptyState title="View only" hint="Operator role or higher can plan a run." />
              )}
            </Card>
          </div>

          <div>
            <Card title={isSmd ? "SMD runs" : "Finished builds"}>
              {runs.length === 0 ? (
                <EmptyState
                  title={isSmd ? "No SMD runs yet." : "No finished builds yet."}
                  hint={
                    isSmd
                      ? "Plan one to see what the machine run needs and what has to be ordered."
                      : "Plan one to see which boards stock covers and what has to be ordered."
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                        <th className="px-4 py-2 font-medium">Run</th>
                        <th className="px-4 py-2 font-medium">{isSmd ? "Boards" : "Products"}</th>
                        <th className="px-4 py-2 text-right font-medium">Units</th>
                        <th className="px-4 py-2 font-medium">Status</th>
                        <th className="px-4 py-2 font-medium">Planned</th>
                        {canManage && <th className="no-print px-4 py-2" />}
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((r) => {
                        const units = r.lines.reduce((s, l) => s + (r.status === "BUILT" ? l.qtyBuilt : l.qtyPlanned), 0);
                        return (
                          <tr key={r.id} className="border-b last:border-0 hover:bg-surface-2">
                            <td className="px-4 py-2">
                              <Link href={`/production/${r.id}`} className="font-medium text-ink hover:text-brand">
                                {r.runNumber}
                              </Link>
                              {r.note && <div className="max-w-xs truncate text-xs text-muted">{r.note}</div>}
                            </td>
                            <td className="px-4 py-2 text-ink-2">
                              {r.lines.length === 0
                                ? "—"
                                : r.lines
                                    .map((l) => `${l.product.name} ×${r.status === "BUILT" ? l.qtyBuilt : l.qtyPlanned}`)
                                    .join(", ")}
                            </td>
                            <td className="px-4 py-2 text-right tnum font-medium">{fmtNum(units)}</td>
                            <td className={`px-4 py-2 text-xs font-medium ${RUN_TONE[r.status] ?? ""}`}>
                              {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                            </td>
                            <td className="px-4 py-2 text-xs text-muted">
                              {r.plannedAt ? fmtDate(r.plannedAt) : fmtDate(r.createdAt)}
                            </td>
                            {canManage && (
                              <td className="no-print px-4 py-2 text-right">
                                {r.status === "BUILT" ? (
                                  <span className="text-xs text-muted" title="Unbuild it before deleting">
                                    —
                                  </span>
                                ) : (
                                  <DeleteRunButton runId={r.id} runNumber={r.runNumber} />
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {canLog && (
            <Card title="Log a one-off build" className="no-print">
              <ActionForm action={logProduction} submitLabel="Log build" className="space-y-3 p-4">
                <p className="text-xs text-muted">
                  For a build that never had a run. Stock is netted the same way a run nets it, so boards already on
                  the shelf are drawn from stock rather than rebuilt from their parts.
                </p>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink-2">What was built</span>
                  <select className={input} name="productItemId" required defaultValue="">
                    <option value="" disabled>
                      Choose an SMD board or a product…
                    </option>
                    <optgroup label="SMD boards — go into stock">
                      {boards.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({fmtNum(b.onHand)} on hand)
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Finished products">
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-ink-2">Quantity built</span>
                    <input className={input} name="qtyBuilt" type="number" min="1" defaultValue={1} required />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-ink-2">Date</span>
                    <input className={input} name="date" type="date" defaultValue={today} />
                  </label>
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink-2">Note (optional)</span>
                  <input className={input} name="note" placeholder="Shift, batch #…" />
                </label>
              </ActionForm>
            </Card>
          )}

          <BuildHistory
            title="SMD boards built"
            hint="Each build consumes the board's parts and puts the board into stock."
            logs={boardLogs}
            canManage={canManage}
            emptyTitle="No SMD boards built yet."
            emptyHint="Build one and it becomes board stock a run can draw on."
          />
          <BuildHistory
            title="Finished products built"
            hint="Consumes boards from stock where there are any, and parts for the rest."
            logs={productLogs}
            canManage={canManage}
            emptyTitle="No finished products built yet."
          />
        </div>
      )}
    </div>
  );
}

type HistoryLog = {
  id: string;
  date: Date;
  qtyBuilt: number;
  note: string | null;
  runId: string | null;
  product: { name: string; partNumber: string };
  user: { name: string | null; email: string } | null;
};

/** One band of build history. A run-sourced entry links to its run and can't be reversed alone. */
function BuildHistory({
  title,
  hint,
  logs,
  canManage,
  emptyTitle,
  emptyHint,
}: {
  title: string;
  hint: string;
  logs: HistoryLog[];
  canManage: boolean;
  emptyTitle: string;
  emptyHint?: string;
}) {
  const total = logs.reduce((s, l) => s + l.qtyBuilt, 0);
  return (
    <Card
      title={
        <span className="flex flex-wrap items-baseline gap-2">
          {title}
          <span className="text-xs font-normal text-muted">{hint}</span>
        </span>
      }
      actions={
        logs.length > 0 && (
          <span className="text-sm font-semibold tnum text-ink">
            {fmtNum(total)} <span className="text-xs font-normal text-muted">units</span>
          </span>
        )
      }
    >
      {logs.length === 0 ? (
        <EmptyState title={emptyTitle} hint={emptyHint} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Item</th>
                <th className="px-4 py-2 font-medium">Item number</th>
                <th className="px-4 py-2 text-right font-medium">Qty</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">By</th>
                {canManage && <th className="no-print px-4 py-2" />}
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-2 text-xs text-muted">{fmtDate(l.date)}</td>
                  <td className="max-w-xs truncate px-4 py-2 text-ink">{l.product.name}</td>
                  <td className="px-4 py-2">
                    <Badge>{l.product.partNumber}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right tnum font-medium">{fmtNum(l.qtyBuilt)}</td>
                  <td className="px-4 py-2 text-xs">
                    {l.runId ? (
                      <Link href={`/production/${l.runId}`} className="hover:opacity-80">
                        <Badge>{l.note ?? "run"}</Badge>
                      </Link>
                    ) : (
                      <span className="text-muted">one-off</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted">{l.user?.name ?? l.user?.email ?? "—"}</td>
                  {canManage && (
                    <td className="no-print px-4 py-2 text-right">
                      {l.runId ? (
                        <span className="text-xs text-muted" title="Unbuild the run instead">
                          —
                        </span>
                      ) : (
                        <ReverseButton logId={l.id} />
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
