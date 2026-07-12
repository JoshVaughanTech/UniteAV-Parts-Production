import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/rbac";
import { roleAtLeast } from "@/lib/constants";
import { logProduction } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { ReverseButton } from "@/components/ReverseButton";
import { Card, EmptyState, input } from "@/components/ui";
import { fmtNum, fmtDate, fmtDateInput } from "@/lib/format";

export default async function ProductionPage() {
  const [user, products, logs] = await Promise.all([
    currentUser(),
    prisma.item.findMany({ where: { type: "PRODUCT" }, orderBy: { name: "asc" } }),
    prisma.productionLog.findMany({
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 40,
      include: { product: { select: { name: true, partNumber: true } }, user: { select: { name: true, email: true } } },
    }),
  ]);
  const canLog = roleAtLeast(user?.role, "OPERATOR");
  const canReverse = roleAtLeast(user?.role, "MANAGER");
  const today = fmtDateInput(new Date());

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Production Log</h1>
        <p className="text-sm text-muted">Record how many of each product were built. Each entry consumes parts from inventory.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <Card title="Log a build">
            {canLog ? (
              <ActionForm action={logProduction} submitLabel="Log production" className="space-y-3 p-4">
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
              <EmptyState title="No production logged yet." hint="Use the form to record your first build." />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Product</th>
                    <th className="px-4 py-2 text-right font-medium">Qty</th>
                    <th className="px-4 py-2 font-medium">By</th>
                    {canReverse && <th className="px-4 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} className="border-b last:border-0 hover:bg-surface-2">
                      <td className="px-4 py-2 text-xs text-muted">{fmtDate(l.date)}</td>
                      <td className="px-4 py-2 text-ink">{l.product.name}</td>
                      <td className="px-4 py-2 text-right tnum font-medium">{fmtNum(l.qtyBuilt)}</td>
                      <td className="px-4 py-2 text-xs text-muted">{l.user?.name ?? l.user?.email ?? "—"}</td>
                      {canReverse && (
                        <td className="px-4 py-2 text-right">
                          <ReverseButton logId={l.id} />
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
    </div>
  );
}
