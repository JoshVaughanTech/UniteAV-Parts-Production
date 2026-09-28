import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSettings, getOnOrderQtyMap } from "@/lib/metrics";
import { loadBomTree } from "@/lib/bom/rollup";
import { planRun } from "@/lib/production/netting";
import { currentUser } from "@/lib/rbac";
import { roleAtLeast } from "@/lib/constants";
import { orderRunShortfall } from "@/lib/production/run-actions";
import { RunActions } from "@/components/RunActions";
import { Card, EmptyState, Badge, StatTile, btnGhost } from "@/components/ui";
import { BackLink } from "@/components/ListMemory";
import { PrintButton } from "@/components/PrintButton";
import { fmtNum, fmtMoney, fmtDate } from "@/lib/format";

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [run, tree, settings, onOrder, user] = await Promise.all([
    prisma.productionRun.findUnique({
      where: { id },
      include: {
        lines: { include: { product: { select: { id: true, name: true, partNumber: true } } }, orderBy: { id: "asc" } },
        user: { select: { name: true, email: true } },
      },
    }),
    loadBomTree(),
    getSettings(),
    getOnOrderQtyMap(),
    currentUser(),
  ]);
  if (!run) notFound();

  const canPlan = roleAtLeast(user?.role, "OPERATOR");
  const canManage = roleAtLeast(user?.role, "MANAGER");
  const isPlanned = run.status === "PLANNED";
  const isBuilt = run.status === "BUILT";

  // A built run is shown as it was built; a planned one as it stands now.
  const plan = planRun(
    tree,
    run.lines.map((l) => ({ productId: l.productItemId, qty: isBuilt ? l.qtyBuilt : l.qtyPlanned })),
  );

  const partMeta = await prisma.item.findMany({
    where: { id: { in: plan.shortParts.map((p) => p.itemId) } },
    select: { id: true, unitCost: true, supplier: { select: { name: true } } },
  });
  const meta = new Map(partMeta.map((p) => [p.id, p]));
  const shortCost = plan.shortParts.reduce((s, p) => s + p.toMake * (meta.get(p.itemId)?.unitCost ?? 0), 0);
  const unpriced = plan.shortParts.filter((p) => meta.get(p.itemId)?.unitCost == null).length;

  const plannedUnits = run.lines.reduce((s, l) => s + l.qtyPlanned, 0);
  const builtUnits = run.lines.reduce((s, l) => s + l.qtyBuilt, 0);
  const boardsToBuild = plan.boards.filter((b) => b.toMake > 0);
  const boardsFromStock = plan.boards.filter((b) => b.fromStock > 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <BackLink href="/production" className="text-xs text-muted hover:text-brand">
            ← Production
          </BackLink>
          <h1 className="mt-1 text-xl font-semibold text-ink">{run.runNumber}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge className={isBuilt ? "text-good" : run.status === "CANCELLED" ? "text-muted" : "text-brand"}>
              {run.status.charAt(0) + run.status.slice(1).toLowerCase()}
            </Badge>
            {run.plannedAt && <span className="text-xs text-muted">planned {fmtDate(run.plannedAt)}</span>}
            {run.builtAt && <span className="text-xs text-muted">built {fmtDate(run.builtAt)}</span>}
            {run.note && <span className="text-xs text-ink-2">{run.note}</span>}
          </div>
        </div>
        <PrintButton label="Print pick list" />
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={isBuilt ? "Units built" : "Units planned"} value={fmtNum(isBuilt ? builtUnits : plannedUnits)} />
        <StatTile
          label="Boards to build"
          value={fmtNum(boardsToBuild.reduce((s, b) => s + b.toMake, 0))}
          hint={boardsFromStock.length > 0 ? `${fmtNum(boardsFromStock.length)} drawn from stock` : "none in stock"}
        />
        <StatTile label="Distinct parts" value={fmtNum(plan.parts.length)} />
        <StatTile
          label="Parts short"
          value={fmtNum(plan.shortParts.length)}
          tone={plan.shortParts.length === 0 ? "good" : "bad"}
          hint={plan.shortParts.length > 0 ? `${fmtMoney(shortCost, settings.currency)} to buy` : "stock covers the run"}
        />
      </div>

      <Card title="Products in this run">
        {run.lines.length === 0 ? (
          <EmptyState title="No products on this run." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-medium">Product</th>
                <th className="px-4 py-2 text-right font-medium">{isBuilt ? "Planned" : "Quantity"}</th>
                {isBuilt ? (
                  <th className="px-4 py-2 text-right font-medium">Built</th>
                ) : (
                  <th
                    className="px-4 py-2 text-right font-medium"
                    title="How many current stock covers, after the lines above it have taken their share."
                  >
                    Stock covers
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {run.lines.map((l, i) => {
                const covered = plan.lines[i]?.buildableNow ?? 0;
                return (
                  <tr key={l.id} className="border-b last:border-0 hover:bg-surface-2">
                    <td className="px-4 py-2">
                      <Link href={`/products/${l.product.id}`} className="font-medium text-ink hover:text-brand">
                        {l.product.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right tnum">{fmtNum(l.qtyPlanned)}</td>
                    <td className="px-4 py-2 text-right tnum">
                      {isBuilt ? (
                        <span className="font-medium">{fmtNum(l.qtyBuilt)}</span>
                      ) : covered >= l.qtyPlanned ? (
                        <span className="font-medium text-good">all {fmtNum(l.qtyPlanned)}</span>
                      ) : (
                        <span className={covered === 0 ? "font-medium text-critical" : "font-medium text-serious"}>
                          {fmtNum(covered)} of {fmtNum(l.qtyPlanned)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {plan.shortParts.length > 0 && (
        <Card
          title={`Short — ${fmtNum(plan.shortParts.length)} part${plan.shortParts.length === 1 ? "" : "s"} to order`}
          actions={
            canManage &&
            isPlanned && (
              <form action={orderRunShortfall} className="no-print">
                <input type="hidden" name="runId" value={run.id} />
                <button className={`${btnGhost} py-1`}>Create draft POs</button>
              </form>
            )
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-medium">Part</th>
                  <th className="px-4 py-2 font-medium">Supplier</th>
                  <th className="px-4 py-2 text-right font-medium">Needed</th>
                  <th className="px-4 py-2 text-right font-medium">On hand</th>
                  <th className="px-4 py-2 text-right font-medium">On order</th>
                  <th className="px-4 py-2 text-right font-medium">Short</th>
                  <th className="px-4 py-2 text-right font-medium">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {plan.shortParts.map((p) => {
                  const m = meta.get(p.itemId);
                  const inbound = onOrder.get(p.itemId) ?? 0;
                  return (
                    <tr key={p.itemId} className="border-b last:border-0 hover:bg-surface-2">
                      <td className="px-4 py-2">
                        <Link href={`/parts/${p.itemId}`} className="font-medium text-ink hover:text-brand">
                          {p.partNumber}
                        </Link>
                        <div className="max-w-xs truncate text-xs text-muted">{p.name}</div>
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {m?.supplier?.name ?? <span className="text-serious">unassigned</span>}
                      </td>
                      <td className="px-4 py-2 text-right tnum">{fmtNum(p.required)}</td>
                      <td className={`px-4 py-2 text-right tnum ${p.onHand < 0 ? "text-critical" : ""}`}>
                        {fmtNum(p.onHand)}
                      </td>
                      <td className="px-4 py-2 text-right tnum">
                        {inbound > 0 ? <span className="text-brand">{fmtNum(inbound)}</span> : "—"}
                      </td>
                      <td className="px-4 py-2 text-right tnum font-semibold text-critical">{fmtNum(p.toMake)}</td>
                      <td className="px-4 py-2 text-right tnum">
                        {m?.unitCost == null ? "—" : fmtMoney(p.toMake * m.unitCost, settings.currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {unpriced > 0 && (
            <p className="border-t px-4 py-2 text-xs text-muted">
              {fmtNum(unpriced)} short part{unpriced === 1 ? " has" : "s have"} no unit cost, so the estimate is low.
            </p>
          )}
        </Card>
      )}

      {plan.boards.length > 0 && (
        <Card title={`Boards — ${fmtNum(plan.boards.length)}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-medium">Board</th>
                <th className="px-4 py-2 text-right font-medium">Needed</th>
                <th
                  className="px-4 py-2 text-right font-medium"
                  title="Assembled boards already on the shelf — their components are not required again."
                >
                  From stock
                </th>
                <th className="px-4 py-2 text-right font-medium">To build</th>
              </tr>
            </thead>
            <tbody>
              {plan.boards.map((b) => (
                <tr key={b.itemId} className="border-b last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-2">
                    <Link href={`/products/${b.itemId}`} className="font-medium text-ink hover:text-brand">
                      {b.name}
                    </Link>
                    <div className="text-xs text-muted">{b.partNumber}</div>
                  </td>
                  <td className="px-4 py-2 text-right tnum">{fmtNum(b.required)}</td>
                  <td className="px-4 py-2 text-right tnum">
                    {b.fromStock > 0 ? <span className="font-medium text-good">{fmtNum(b.fromStock)}</span> : "—"}
                  </td>
                  <td className="px-4 py-2 text-right tnum font-medium">{fmtNum(b.toMake)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card title={`Parts required — ${fmtNum(plan.parts.length)}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-medium">Part</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 text-right font-medium">Needed</th>
                <th className="px-4 py-2 text-right font-medium">On hand</th>
                <th className="px-4 py-2 text-right font-medium">Short</th>
              </tr>
            </thead>
            <tbody>
              {plan.parts.map((p) => (
                <tr key={p.itemId} className="border-b last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-2">
                    <Link href={`/parts/${p.itemId}`} className="text-ink hover:text-brand">
                      {p.partNumber}
                    </Link>
                  </td>
                  <td className="max-w-sm truncate px-4 py-2 text-ink-2">{p.name}</td>
                  <td className="px-4 py-2 text-right tnum font-medium">{fmtNum(p.required)}</td>
                  <td className={`px-4 py-2 text-right tnum ${p.onHand < 0 ? "text-critical" : ""}`}>
                    {fmtNum(p.onHand)}
                  </td>
                  <td className="px-4 py-2 text-right tnum">
                    {p.toMake > 0 ? <span className="font-semibold text-critical">{fmtNum(p.toMake)}</span> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {canPlan && run.status !== "CANCELLED" && (
        <RunActions
          runId={run.id}
          status={run.status}
          canManage={canManage}
          fullyCovered={plan.fullyCovered}
          shortCount={plan.shortParts.length}
          lines={run.lines.map((l) => ({ id: l.id, name: l.product.name, qtyPlanned: l.qtyPlanned }))}
        />
      )}
    </div>
  );
}
