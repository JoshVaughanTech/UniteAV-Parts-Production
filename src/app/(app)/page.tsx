import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDashboardData, getSettings } from "@/lib/metrics";
import { loadBomTree } from "@/lib/bom/rollup";
import { CATEGORY_LABELS } from "@/lib/constants";
import { Card, StatTile, EmptyState } from "@/components/ui";
import { StackedShare, BarList, type Segment, type BarRow } from "@/components/Charts";
import { fmtNum, fmtMoney, fmtDate } from "@/lib/format";

export default async function OverviewPage() {
  const [{ parts, kpis, now }, settings, recentBuilds, tree, productItems] = await Promise.all([
    getDashboardData(),
    getSettings(),
    prisma.productionLog.findMany({
      orderBy: { date: "desc" },
      take: 6,
      include: { product: { select: { name: true, partNumber: true } } },
    }),
    loadBomTree(),
    prisma.item.findMany({ where: { type: "PRODUCT", active: true }, select: { id: true, name: true } }),
  ]);

  // Rolled all the way down to parts, the same figure the products pages quote.
  const productCosts: BarRow[] = productItems
    .map((p) => ({ label: p.name, value: tree.costOf(p.id), display: fmtMoney(tree.costOf(p.id), settings.currency) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  // How much of the catalogue the reorder maths can actually speak to. A part with no lead
  // time and no reorder point has no threshold to test, so it is neither fine nor flagged —
  // it is simply unassessed, and that is the number worth seeing.
  const attention = parts.filter(
    (p) => p.reorder.status === "OUT" || p.reorder.status === "REORDER" || p.reorder.status === "LOW",
  ).length;
  const blind = parts.filter((p) => p.reorder.status === "NO_LEADTIME").length;
  const healthy = parts.length - attention - blind;
  const stockHealth: Segment[] = [
    { label: "Needs attention", value: attention, color: "var(--critical)" },
    {
      label: "No lead time set",
      value: blind,
      color: "var(--muted)",
      hint: "A part with no lead time and no reorder point has no threshold to test, so it never flags — it only shows up once it hits zero.",
    },
    { label: "Covered", value: healthy, color: "var(--good)" },
  ];

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
        title="Stock health"
        actions={
          <span className="text-sm text-muted">
            <span className="font-semibold tnum text-ink">{fmtNum(parts.length)}</span> parts &amp; boards
          </span>
        }
      >
        <StackedShare segments={stockHealth} total={parts.length} unit="parts" />
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
          <BarList rows={productCosts} labelWidth="w-40" emptyHint="No products with a BOM yet." />
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
