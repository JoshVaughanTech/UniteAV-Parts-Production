import Link from "next/link";
import { getToOrderBySupplier, getSettings } from "@/lib/metrics";
import { Card, StatusBadge, EmptyState, Badge } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { fmtNum, fmtMoney } from "@/lib/format";

export default async function ToOrderPage() {
  const [groups, settings] = await Promise.all([getToOrderBySupplier(), getSettings()]);
  const grandTotal = groups.reduce((s, g) => s + g.total, 0);
  const lineCount = groups.reduce((s, g) => s + g.parts.length, 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">To-Order</h1>
          <p className="text-sm text-muted">
            Parts at or below their reorder point, grouped by supplier. {fmtNum(lineCount)} line(s) ·{" "}
            {fmtMoney(grandTotal, settings.currency)} est.
          </p>
        </div>
        <PrintButton label="Print order list" />
      </header>

      {groups.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing to order right now."
            hint="Parts appear here once on-hand drops to the reorder point (usage × lead time + safety stock)."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <Card
              key={g.supplierId ?? "none"}
              title={
                <span className="flex items-center gap-2">
                  {g.supplierName}
                  {!g.supplierId && <Badge className="text-serious">assign a supplier</Badge>}
                </span>
              }
              actions={<span className="text-sm font-semibold text-ink tnum">{fmtMoney(g.total, settings.currency)}</span>}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-2 font-medium">Part</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 text-right font-medium">On hand</th>
                      <th
                        className="px-4 py-2 text-right font-medium"
                        title="Reorder point = avg daily use × lead time + safety stock."
                      >
                        Reorder point
                      </th>
                      <th className="px-4 py-2 text-right font-medium">Order qty</th>
                      <th className="px-4 py-2 text-right font-medium">Est. cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.parts.map((p) => (
                      <tr key={p.id} className="border-b last:border-0 hover:bg-surface-2">
                        <td className="px-4 py-2">
                          <Link href={`/parts/${p.id}`} className="font-medium text-ink hover:text-brand">
                            {p.partNumber}
                          </Link>
                          <div className="max-w-xs truncate text-xs text-muted">{p.name}</div>
                        </td>
                        <td className="px-4 py-2">
                          <StatusBadge status={p.reorder.status} />
                        </td>
                        <td className="px-4 py-2 text-right tnum">{fmtNum(p.onHand)}</td>
                        <td className="px-4 py-2 text-right tnum">{fmtNum(p.reorder.rop, 1)}</td>
                        <td className="px-4 py-2 text-right tnum font-semibold">{fmtNum(p.reorder.suggestedOrderQty)}</td>
                        <td className="px-4 py-2 text-right tnum">
                          {p.unitCost == null ? "—" : fmtMoney(p.unitCost * p.reorder.suggestedOrderQty, settings.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}

          <p className="text-xs text-muted">
            Automated purchasing (email or supplier API) will plug in here in a later phase — for now this is your
            manual order list.
          </p>
        </div>
      )}
    </div>
  );
}
