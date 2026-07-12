import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/metrics";
import { Card, EmptyState, Badge } from "@/components/ui";
import { fmtNum, fmtMoney } from "@/lib/format";

export default async function ProductsPage() {
  const settings = await getSettings();

  const products = await prisma.item.findMany({
    where: { type: "PRODUCT" },
    orderBy: { name: "asc" },
    include: {
      bomParents: {
        include: { child: { include: { _count: { select: { bomParents: true } } } } },
        orderBy: { child: { name: "asc" } },
      },
      explodedProduct: { include: { leaf: { select: { unitCost: true } } } },
    },
  });

  // Boards not (yet) part of any finished product.
  const orphanBoards = await prisma.item.findMany({
    where: { type: "ASSEMBLY", bomChildren: { none: {} } },
    include: { _count: { select: { bomParents: true } } },
    orderBy: { name: "asc" },
  });

  const buildCost = (rows: { totalQtyPer: number; leaf: { unitCost: number | null } }[]) =>
    rows.reduce((s, r) => s + r.totalQtyPer * (r.leaf.unitCost ?? 0), 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Products</h1>
        <p className="text-sm text-muted">Finished products and the boards that build them. Click a product to expand its boards.</p>
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
            return (
              <details key={p.id} className="group rounded-xl border bg-surface" open>
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
                  <span className="text-muted transition-transform group-open:rotate-90" aria-hidden>
                    ▶
                  </span>
                  <div className="flex-1">
                    <div className="font-semibold text-ink">{p.name}</div>
                    <div className="text-xs text-muted">
                      {fmtNum(p.bomParents.length)} boards · {fmtNum(totalParts)} distinct parts
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
                        <tr key={bl.id} className="border-b last:border-0 hover:bg-surface-2">
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
              {orphanBoards.map((b) => (
                <tr key={b.id} className="border-b last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-2">
                    <Link href={`/products/${b.id}`} className="font-medium text-ink hover:text-brand">
                      {b.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <Badge>{b.partNumber}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right tnum">{fmtNum(b._count.bomParents)} parts</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
