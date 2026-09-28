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
  { key: "runs", label: "Runs" },
  { key: "log", label: "Build history" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const RUN_TONE: Record<string, string> = {
  PLANNED: "text-brand",
  BUILT: "text-good",
  CANCELLED: "text-muted",
};

export default async function ProductionPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const raw = (await searchParams).tab;
  const tab: Tab = raw === "log" ? "log" : "runs";

  const [user, products, runs, logs, runCount] = await Promise.all([
    currentUser(),
    prisma.item.findMany({ where: { type: "PRODUCT", active: true }, orderBy: { name: "asc" } }),
    tab === "runs"
      ? prisma.productionRun.findMany({
          orderBy: [{ createdAt: "desc" }],
          take: 40,
          include: {
            lines: { include: { product: { select: { name: true } } } },
            user: { select: { name: true, email: true } },
          },
        })
      : Promise.resolve([]),
    tab === "log"
      ? prisma.productionLog.findMany({
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          take: 40,
          include: {
            product: { select: { name: true, partNumber: true } },
            user: { select: { name: true, email: true } },
          },
        })
      : Promise.resolve([]),
    prisma.productionRun.count(),
  ]);
  const canLog = roleAtLeast(user?.role, "OPERATOR");
  const canManage = roleAtLeast(user?.role, "MANAGER");
  const today = fmtDateInput(new Date());

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Production</h1>
          <p className="text-sm text-muted">
            {tab === "runs"
              ? "Plan a run, see what stock covers and what has to be ordered, then build it."
              : "Every build recorded, newest first."}
          </p>
        </div>
        <PrintButton label="Print" />
      </header>

      <nav className="no-print flex gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={{ pathname: "/production", query: t.key === "runs" ? {} : { tab: t.key } }}
            aria-current={tab === t.key ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.key ? "border-brand text-brand" : "border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            {t.label}
            {t.key === "runs" && <span className="ml-1.5 text-xs tnum text-muted">{fmtNum(runCount)}</span>}
          </Link>
        ))}
      </nav>

      {tab === "runs" ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="no-print lg:col-span-1">
            <Card title="Plan a run">
              {canLog ? (
                <NewRunForm action={createRun} products={products} today={today} />
              ) : (
                <EmptyState title="View only" hint="Operator role or higher can plan a run." />
              )}
            </Card>
          </div>

          <div className="lg:col-span-2">
            <Card title="Runs">
              {runs.length === 0 ? (
                <EmptyState
                  title="No runs yet."
                  hint="Plan one to see what stock covers and what has to be ordered."
                />
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-2 font-medium">Run</th>
                      <th className="px-4 py-2 font-medium">Products</th>
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
              )}
            </Card>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="no-print lg:col-span-1">
            <Card title="Log a one-off build">
              {canLog ? (
                <ActionForm action={logProduction} submitLabel="Log production" className="space-y-3 p-4">
                  <p className="text-xs text-muted">
                    For a build that never had a run. Consumes the product&rsquo;s full BOM without netting against
                    board stock — plan a run instead when you can.
                  </p>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-ink-2">Product</span>
                    <select className={input} name="productItemId" required defaultValue="">
                      <option value="" disabled>
                        Choose a product…
                      </option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
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
              ) : (
                <EmptyState title="View only" hint="Operator role or higher can log production." />
              )}
            </Card>
          </div>

          <div className="lg:col-span-2">
            <Card title="History">
              {logs.length === 0 ? (
                <EmptyState title="No production logged yet." hint="Plan a run, or log a one-off build." />
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-4 py-2 font-medium">Product</th>
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
                        <td className="px-4 py-2 text-ink">{l.product.name}</td>
                        <td className="px-4 py-2 text-right tnum font-medium">{fmtNum(l.qtyBuilt)}</td>
                        <td className="px-4 py-2 text-xs">
                          {l.runId ? (
                            <Link href={`/production/${l.runId}`}>
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
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
