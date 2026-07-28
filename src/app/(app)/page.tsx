import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDashboardData, getSettings } from "@/lib/metrics";
import { Card, StatTile, StatusBadge, EmptyState } from "@/components/ui";
import { fmtNum, fmtMoney, fmtDate } from "@/lib/format";

export default async function OverviewPage() {
  const [{ parts, kpis }, settings, recentBuilds] = await Promise.all([
    getDashboardData(),
    getSettings(),
    prisma.productionLog.findMany({
      orderBy: { date: "desc" },
      take: 6,
      include: { product: { select: { name: true, partNumber: true } } },
    }),
  ]);

  const needAttention = parts
    .filter((p) => p.reorder.status === "OUT" || p.reorder.status === "REORDER" || p.reorder.status === "LOW")
    .sort((a, b) => (a.reorder.daysOfCover ?? 1e9) - (b.reorder.daysOfCover ?? 1e9))
    .slice(0, 8);

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
  const projDate = (days: number) => fmtDate(new Date(Date.now() + days * 864e5));

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

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="Needs attention"
          actions={
            <Link href="/to-order" className="text-xs font-medium text-brand hover:underline">
              View to-order →
            </Link>
          }
        >
          {needAttention.length === 0 ? (
            <EmptyState title="Everything is above its reorder point." hint="Log production to start tracking usage." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-medium">Part</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">On hand</th>
                  <th className="px-4 py-2 text-right font-medium">Days cover</th>
                </tr>
              </thead>
              <tbody>
                {needAttention.map((p) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-surface-2">
                    <td className="px-4 py-2">
                      <Link href={`/parts/${p.id}`} className="font-medium text-ink hover:text-brand">
                        {p.partNumber}
                      </Link>
                      <div className="max-w-xs truncate text-xs text-muted">{p.mpn ?? p.name}</div>
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={p.reorder.status} />
                    </td>
                    <td className={`px-4 py-2 text-right tnum ${p.onHand < 0 ? "font-medium text-critical" : ""}`}>
                      {fmtNum(p.onHand)}
                    </td>
                    <td className="px-4 py-2 text-right tnum">
                      {p.reorder.daysOfCover == null ? "—" : fmtNum(p.reorder.daysOfCover)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Recent production">
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
      </div>

      {forecast.length > 0 && (
        <Card
          title="Reorder forecast — next 30 days"
          actions={<span className="text-xs text-muted">learned from your production logs</span>}
        >
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
        </Card>
      )}
    </div>
  );
}
