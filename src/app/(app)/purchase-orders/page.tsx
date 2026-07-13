import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/rbac";
import { roleAtLeast } from "@/lib/constants";
import { getSettings } from "@/lib/metrics";
import { createBlankPo } from "@/lib/po-actions";
import { Card, EmptyState, Badge, input, btnPrimary } from "@/components/ui";
import { PoStatusBadge } from "@/components/PoStatusBadge";
import { fmtNum, fmtMoney, fmtDate } from "@/lib/format";

export default async function PurchaseOrdersPage() {
  const user = await currentUser();
  if (!roleAtLeast(user?.role, "MANAGER")) redirect("/");

  const [settings, suppliers, pos] = await Promise.all([
    getSettings(),
    prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.purchaseOrder.findMany({
      orderBy: { createdAt: "desc" },
      include: { supplier: { select: { name: true } }, lines: { select: { qtyOrdered: true, unitCost: true } } },
    }),
  ]);

  const total = (lines: { qtyOrdered: number; unitCost: number }[]) =>
    lines.reduce((s, l) => s + l.qtyOrdered * l.unitCost, 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Purchase Orders</h1>
        <p className="text-sm text-muted">Draft, order, and receive against POs. Receiving updates on-hand stock automatically.</p>
      </header>

      <Card title="New blank PO">
        <form action={createBlankPo} className="flex flex-wrap items-end gap-2 p-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-2">Supplier</span>
            <select className={`${input} w-56`} name="supplierId" defaultValue="">
              <option value="">— Unassigned —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button className={btnPrimary}>Create draft</button>
          <span className="text-xs text-muted">Or create one pre-filled from the To-Order page.</span>
        </form>
      </Card>

      <Card>
        {pos.length === 0 ? (
          <EmptyState title="No purchase orders yet." hint="Create one above, or from the To-Order page." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">PO</th>
                <th className="px-4 py-2.5 font-medium">Supplier</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">Lines</th>
                <th className="px-4 py-2.5 text-right font-medium">Total</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {pos.map((po) => (
                <tr key={po.id} className="border-b last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-2.5">
                    <Link href={`/purchase-orders/${po.id}`} className="font-medium text-ink hover:text-brand">
                      {po.poNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-ink-2">{po.supplier?.name ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <PoStatusBadge status={po.status} />
                      {po.autoCreated && <Badge>Auto</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tnum">{fmtNum(po.lines.length)}</td>
                  <td className="px-4 py-2.5 text-right tnum">{fmtMoney(total(po.lines), settings.currency)}</td>
                  <td className="px-4 py-2.5 text-xs text-muted">{fmtDate(po.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
