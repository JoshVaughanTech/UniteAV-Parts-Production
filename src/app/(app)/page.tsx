import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDashboardData, getSettings } from "@/lib/metrics";
import { loadBomTree } from "@/lib/bom/rollup";
import { planRun } from "@/lib/production/netting";
import { CATEGORY_LABELS } from "@/lib/constants";
import { Card, StatTile, EmptyState, Badge } from "@/components/ui";
import { BarList, type BarRow } from "@/components/Charts";
import { fmtNum, fmtMoney, fmtDate } from "@/lib/format";

export default async function OverviewPage() {
  const [{ parts, kpis, now }, settings, recentBuilds, tree, productItems, openRuns] = await Promise.all([
    getDashboardData(),
    getSettings(),
    prisma.productionLog.findMany({
      orderBy: { date: "desc" },
      take: 6,
      include: { product: { select: { name: true, partNumber: true } } },
    }),
    loadBomTree(),
    prisma.item.findMany({ where: { type: "PRODUCT", active: true }, select: { id: true, name: true } }),
    prisma.productionRun.findMany({
      where: { status: "PLANNED" },
      orderBy: [{ plannedAt: "asc" }, { createdAt: "asc" }],
      take: 6,
      include: { lines: { include: { product: { select: { name: true } } } } },
    }),
  ]);

  // Rolled all the way down to parts, the same figure the products pages quote.
  const productCosts: BarRow[] = productItems
    .map((p) => ({ label: p.name, value: tree.costOf(p.id), display: fmtMoney(tree.costOf(p.id), settings.currency) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  // Planned-but-unbuilt runs, netted the same way the run page nets them, so the dashboard
  // and the run itself never quote different coverage.
  const inFlight = openRuns.map((run) => {
    const plan = planRun(
      tree,
      run.lines.map((l) => ({ productId: l.productItemId, qty: l.qtyPlanned })),
    );
    const planned = run.lines.reduce((s, l) => s + l.qtyPlanned, 0);
    const covered = plan.lines.reduce((s, l) => s + l.buildableNow, 0);
    return {
      id: run.id,
      runNumber: run.runNumber,
      isSmd: run.kind === "SMD",
      what: run.lines.map((l) => `${l.product.name} ×${l.qtyPlanned}`).join(", "),
      planned,
      covered,
      shortCount: plan.shortParts.length + plan.shortBoards.length,
      plannedAt: run.plannedAt,
    };
  });

  // Where the money actually sits. Long tail of 27 categories, so the rest folds into Other
  // rather than becoming 17 unreadable slivers.
  const catTotals = new Map<string, { value: number; n: number }>();
  for (const p of parts) {
    if (p.onHand <= 0 || p.unitCost == null) continue;
    const key = p.category ?? "Uncategorised";
    const g = catTotals.get(key) ?? { value: 0, n: 0 };
    g.value += p.onHand * p.unitCost;
    g.n++;
    catTotals.set(key, g);
  }
  const ranked = [...catTotals.entries()].sort((a, b) => b[1].value - a[1].value);
  const topCats = ranked.slice(0, 8);
  const restCats = ranked.slice(8);
  const restValue = restCats.reduce((s, [, g]) => s + g.value, 0);
  const valueByCategory: BarRow[] = [
    ...topCats.map(([label, g]) => ({
      label: CATEGORY_LABELS[label] ?? label,
      value: g.value,
      display: fmtMoney(g.value, settings.currency),
      sub: `${fmtNum(g.n)} parts`,
    })),
    ...(restCats.length > 0
      ? [
          {
            label: `Other (${restCats.length})`,
            value: restValue,
            display: fmtMoney(restValue, settings.currency),
            sub: `${fmtNum(restCats.reduce((s, [, g]) => s + g.n, 0))} parts`,
            // An aggregate, not a category — it outranks several named ones, so it must
            // not read as one of them.
            color: "var(--muted)",
          },
        ]
      : []),
  ];

  // Predictive: parts trending toward their reorder point within 30 days (from usage).
  const forecast = parts
    .filter(
      (p) =>
        (p.reorder.status === "OK" || p.reorder.status === "LOW") &&
        p.reorder.daysUntilReorder != null &&
        p.reorder.daysUntilReorder > 0 &&
        p.reorder.daysUntilReorder <= 30,
    )
    .sort((a, b) => (a.reorder.daysUntilReorder ?? 1e9) - (b.reorder.daysUntilReorder ?? 1e9))
    .slice(0, 10);
  const projDate = (days: number) => fmtDate(new Date(now.getTime() + days * 864e5));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Overview</h1>
        <p className="text-sm text-muted">
          Usage averaged over {settings.usageWindowDays} days · reorder covers lead time + {settings.reviewPeriodDays}-day
          review.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Products" value={fmtNum(kpis.productCount)} href="/products" />
        <StatTile label="Distinct parts" value={fmtNum(kpis.partCount)} href="/parts" />
        <StatTile
          label="Need reorder"
          value={fmtNum(kpis.reorderCount)}
          tone={kpis.reorderCount > 0 ? "bad" : "good"}
          hint={`${fmtNum(kpis.outCount)} out of stock`}
          href="/to-order"
        />
        <StatTile
          label="Inventory value"
          value={fmtMoney(kpis.inventoryValue, settings.currency)}
          hint={`${fmtNum(kpis.buildsLast30)} built in 30 days`}
        />
      </div>

      <Card
        title="Runs in flight"
        actions={
          <Link href="/production" className="text-xs font-medium text-brand hover:underline">
            Production →
          </Link>
        }
      >
        {inFlight.length === 0 ? (
          <EmptyState
            title="No runs planned."
            hint="Plan an SMD run or a finished build and it will show here with what stock covers."
          />
        ) : (
          <ul className="divide-y">
            {inFlight.map((r) => {
              const pct = r.planned > 0 ? (r.covered / r.planned) * 100 : 0;
              const full = r.covered >= r.planned;
              return (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <Link href={`/production/${r.id}`} className="font-semibold text-ink hover:text-brand">
                      {r.runNumber}
                    </Link>
                    <Badge className="text-brand">{r.isSmd ? "SMD build" : "Finished build"}</Badge>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-2" title={r.what}>
                      {r.what}
                    </span>
                    {r.plannedAt && <span className="text-xs text-muted">{fmtDate(r.plannedAt)}</span>}
                  </div>

                  {/* The two labels beside the bar come to 240-odd fixed pixels, which left
                      the bar about thirty on a phone. There they wrap under it instead. */}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 sm:flex-nowrap">
                    {/* How much of the run current stock covers. Square at the baseline,
                        rounded at the data end, the track doubling as the only grid line. */}
                    <span className="relative h-3 w-full min-w-0 rounded-[4px] bg-surface-2 sm:w-auto sm:flex-1">
                      <span
                        className="absolute inset-y-0 left-0 rounded-r-[4px]"
                        style={{
                          width: `${Math.max(pct, pct > 0 ? 0.75 : 0)}%`,
                          background: full ? "var(--good)" : "var(--brand)",
                        }}
                      />
                    </span>
                    <span className="shrink-0 text-xs tnum text-ink-2">
                      stock covers <span className="font-semibold text-ink">{fmtNum(r.covered)}</span> of{" "}
                      {fmtNum(r.planned)}
                    </span>
                    <span className="shrink-0 text-right text-xs tnum sm:w-28">
                      {r.shortCount === 0 ? (
                        <span className="font-medium text-good">nothing short</span>
                      ) : (
                        <span className="font-medium text-critical">
                          {fmtNum(r.shortCount)} part{r.shortCount === 1 ? "" : "s"} short
                        </span>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Inventory value by category"
          actions={
            <Link href="/parts" className="text-xs font-medium text-brand hover:underline">
              All parts →
            </Link>
          }
        >
          <BarList rows={valueByCategory} emptyHint="No priced stock on hand yet." />
        </Card>

        <Card
          title="Parts cost per product"
          actions={
            <Link href="/products" className="text-xs font-medium text-brand hover:underline">
              All products →
            </Link>
          }
        >
          <BarList rows={productCosts} labelWidth="sm:w-40" emptyHint="No products with a BOM yet." />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1" title="Recent production">
          {recentBuilds.length === 0 ? (
            <EmptyState title="No builds logged yet." hint="Go to Production Log to record daily builds." />
          ) : (
            <ul className="divide-y">
              {recentBuilds.map((b) => (
                <li key={b.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div>
                    <div className="font-medium text-ink">{b.product.name}</div>
                    <div className="text-xs text-muted">{fmtDate(b.date)}</div>
                  </div>
                  <div className="tnum font-semibold text-ink">{fmtNum(b.qtyBuilt)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          className="lg:col-span-2"
          title="Reorder forecast — next 30 days"
          actions={<span className="text-xs text-muted">learned from your production logs</span>}
        >
          {forecast.length === 0 ? (
            <EmptyState
              title="Nothing forecast to hit its reorder point."
              hint="The forecast needs recorded builds and a lead time on the part to project from."
            />
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-medium">Part</th>
                  <th className="px-4 py-2 text-right font-medium">On hand</th>
                  <th className="px-4 py-2 text-right font-medium">Usage / day</th>
                  <th className="px-4 py-2 text-right font-medium">Reorder in</th>
                  <th className="px-4 py-2 text-right font-medium">≈ Reorder date</th>
                </tr>
              </thead>
              <tbody>
                {forecast.map((p) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-surface-2">
                    <td className="px-4 py-2">
                      <Link href={`/parts/${p.id}`} className="font-medium text-ink hover:text-brand">
                        {p.partNumber}
                      </Link>
                      <div className="max-w-xs truncate text-xs text-muted">{p.mpn ?? p.name}</div>
                    </td>
                    <td className="px-4 py-2 text-right tnum">{fmtNum(p.onHand)}</td>
                    <td className="px-4 py-2 text-right tnum">{fmtNum(p.adu, 2)}</td>
                    <td className="px-4 py-2 text-right tnum font-medium">~{Math.round(p.reorder.daysUntilReorder!)}d</td>
                    <td className="px-4 py-2 text-right text-muted">{projDate(p.reorder.daysUntilReorder!)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </Card>
      </div>
    </div>
  );
}
