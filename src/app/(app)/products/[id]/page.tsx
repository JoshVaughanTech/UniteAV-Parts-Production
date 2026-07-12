import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Card, EmptyState, Badge, StatTile } from "@/components/ui";
import { fmtNum } from "@/lib/format";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const product = await prisma.item.findUnique({ where: { id } });
  if (!product || (product.type !== "PRODUCT" && product.type !== "ASSEMBLY")) notFound();
  const isAssembly = product.type === "ASSEMBLY";

  // Direct BOM lines (this product's immediate children) with the child part details.
  const lines = await prisma.bomLine.findMany({
    where: { parentItemId: id },
    include: { child: true },
    orderBy: { child: { partNumber: "asc" } },
  });

  const builds = await prisma.productionLog.aggregate({ _sum: { qtyBuilt: true }, where: { productItemId: id } });
  const totalBuilt = builds._sum.qtyBuilt ?? 0;

  return (
    <div className="space-y-6">
      <header>
        <Link href="/products" className="text-xs text-muted hover:text-brand">
          ← Products
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-ink">{product.name}</h1>
        <div className="mt-1 flex items-center gap-2">
          <Badge>{product.partNumber}</Badge>
          <Badge>{isAssembly ? "Sub-assembly / board" : "Finished product"}</Badge>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label={isAssembly ? "Parts" : "Boards"} value={fmtNum(lines.length)} />
        <StatTile
          label="Total qty / build"
          value={fmtNum(lines.reduce((s, l) => s + l.qtyPer, 0))}
          hint="sum of line quantities"
        />
        <StatTile label="Units built (all time)" value={fmtNum(totalBuilt)} />
      </div>

      <Card title="Bill of materials">
        {lines.length === 0 ? (
          <EmptyState title="No parts on this BOM." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2 text-right font-medium">Qty</th>
                <th className="px-4 py-2 font-medium">Item number</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 font-medium">Comment</th>
                <th className="px-4 py-2 font-medium">Manufacturer</th>
                <th className="px-4 py-2 text-right font-medium">On hand</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-2 text-right tnum font-medium">{fmtNum(l.qtyPer)}</td>
                  <td className="px-4 py-2">
                    <Link
                      href={l.child.type === "PART" ? `/parts/${l.child.id}` : `/products/${l.child.id}`}
                      className="text-ink hover:text-brand"
                    >
                      {l.child.partNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2 max-w-sm truncate text-ink-2">{l.child.name}</td>
                  <td className="px-4 py-2 text-ink-2">{l.child.value ?? "—"}</td>
                  <td className="px-4 py-2 text-ink-2">{l.child.manufacturer ?? "—"}</td>
                  <td className="px-4 py-2 text-right tnum">{fmtNum(l.child.onHand)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
