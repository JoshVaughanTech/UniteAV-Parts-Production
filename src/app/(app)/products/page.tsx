import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSettings, getOnOrderQtyMap } from "@/lib/metrics";
import { Card, EmptyState, Badge } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { ListMemory } from "@/components/ListMemory";
import { fmtNum, fmtMoney } from "@/lib/format";

export default async function ProductsPage() {
  const [settings, onOrder] = await Promise.all([getSettings(), getOnOrderQtyMap()]);

  const products = await prisma.item.findMany({
    where: { type: "PRODUCT" },
    orderBy: { name: "asc" },
    include: {
      bomParents: {
        include: { child: { include: { _count: { select: { bomParents: true } } } } },
        orderBy: { child: { name: "asc" } },
      },
      explodedProduct: {
        include: { leaf: { select: { unitCost: true, partNumber: true, name: true } } },
      },
    },
  });

  // Boards not (yet) part of any finished product.
  const orphanBoards = await prisma.item.findMany({
    where: { type: "ASSEMBLY", bomChildren: { none: {} } },
    include: { _count: { select: { bomParents: true } }, bomParents: { select: { childItemId: true } } },
    orderBy: { name: "asc" },
  });

  const buildCost = (rows: { totalQtyPer: number; leaf: { unitCost: number | null } }[]) =>
    rows.reduce((s, r) => s + r.totalQtyPer * (r.leaf.unitCost ?? 0), 0);

  return (
    <div className="space-y-6">
      <ListMemory listKey="products" />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Products</h1>
          <p className="text-sm text-muted">Finished products and the boards that build them. Click a product to expand its boards.</p>
        </div>
        <PrintButton label="Print products" />
      </header>

      {products.length === 0 ? (
        <Card>
          <EmptyState title="No finished products yet." hint="Import BOMs and assemble boards into products." />
        </Card>
      ) : (
        <div className="space-y-3">
          {products.map((p) => {
            const totalParts = p.explodedProduct.length;
            const cost = buildCost(p.explodedProduct);
            // Parts of this product with outstanding qty on a sent PO.
            const onOrderParts = p.explodedProduct
              .filter((r) => onOrder.has(r.leafPartId))
              .map((r) => ({ id: r.leafPartId, ...r.leaf, qty: onOrder.get(r.leafPartId)! }))
              .sort((a, b) => a.partNumber.localeCompare(b.partNumber));
            return (
              // Collapsed by default — with 7 products the page was one long wall of tables.
              // PrintButton re-opens every <details> before printing, so print output is unaffected.
              <details key={p.id} className="group rounded-xl border bg-surface">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
                  <span className="text-muted transition-transform group-open:rotate-90" aria-hidden>
                    ▶
                  </span>
                  <div className="flex-1">
                    <div className="font-semibold text-ink">{p.name}</div>
                    <div className="text-xs text-muted">
                      {fmtNum(p.bomParents.length)} boards · {fmtNum(totalParts)} distinct parts
                      {onOrderParts.length > 0 && (
                        <span className="font-medium text-brand"> · {fmtNum(onOrderParts.length)} on order</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold tnum text-ink">{fmtMoney(cost, settings.currency)}</div>
                    <div className="text-xs text-muted">parts cost / unit</div>
                  </div>
                </summary>

                <div className="border-t">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                        <th className="px-4 py-2 pl-11 font-medium">Board / sub-assembly</th>
                        <th className="px-4 py-2 font-medium">Item number</th>
                        <th className="px-4 py-2 text-right font-medium">Qty / unit</th>
                        <th className="px-4 py-2 text-right font-medium">Parts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.bomParents.map((bl) => (
                        <tr key={bl.id} data-mem-id={bl.child.id} className="border-b last:border-0 hover:bg-surface-2">
                          <td className="px-4 py-2 pl-11">
                            <Link href={`/products/${bl.child.id}`} className="font-medium text-ink hover:text-brand">
                              {bl.child.name}
                            </Link>
                          </td>
                          <td className="px-4 py-2">
                            <Badge>{bl.child.partNumber}</Badge>
                          </td>
                          <td className="px-4 py-2 text-right tnum">{fmtNum(bl.qtyPer)}</td>
                          <td className="px-4 py-2 text-right tnum">{fmtNum(bl.child._count.bomParents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {onOrderParts.length > 0 && (
                    <div className="border-t">
                      <div className="px-4 py-2 pl-11 text-xs font-semibold uppercase tracking-wide text-brand">
                        On order — {fmtNum(onOrderParts.length)} part{onOrderParts.length === 1 ? "" : "s"}
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                            <th className="px-4 py-2 pl-11 font-medium">Part</th>
                            <th className="px-4 py-2 font-medium">Description</th>
                            <th
                              className="px-4 py-2 text-right font-medium"
                              title="Outstanding quantity on sent purchase orders (ordered − received)."
                            >
                              Qty on order
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {onOrderParts.map((part) => (
                            <tr key={part.id} data-mem-id={part.id} className="border-b last:border-0 hover:bg-surface-2">
                              <td className="px-4 py-2 pl-11">
                                <Link href={`/parts/${part.id}`} className="font-medium text-ink hover:text-brand">
                                  {part.partNumber}
                                </Link>
                              </td>
                              <td className="max-w-sm truncate px-4 py-2 text-ink-2">{part.name}</td>
                              <td className="px-4 py-2 text-right tnum font-medium text-brand">{fmtNum(part.qty)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}

      {orphanBoards.length > 0 && (
        <Card title="Standalone boards (not in a finished product)">
          <table className="w-full text-sm">
            <tbody>
              {orphanBoards.map((b) => {
                const onOrderCount = b.bomParents.filter((l) => onOrder.has(l.childItemId)).length;
                return (
                  <tr key={b.id} data-mem-id={b.id} className="border-b last:border-0 hover:bg-surface-2">
                    <td className="px-4 py-2">
                      <Link href={`/products/${b.id}`} className="font-medium text-ink hover:text-brand">
                        {b.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <Badge>{b.partNumber}</Badge>
                    </td>
                    <td className="px-4 py-2 text-right tnum">
                      {fmtNum(b._count.bomParents)} parts
                      {onOrderCount > 0 && (
                        <span className="font-medium text-brand"> · {fmtNum(onOrderCount)} on order</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
