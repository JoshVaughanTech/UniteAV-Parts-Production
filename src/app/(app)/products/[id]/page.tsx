import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getOnOrderQtyMap, getSettings } from "@/lib/metrics";
import { currentUser } from "@/lib/rbac";
import { roleAtLeast } from "@/lib/constants";
import { Card, EmptyState, Badge, StatTile } from "@/components/ui";
import { ListMemory, BackLink } from "@/components/ListMemory";
import { DeleteItemButton } from "@/components/DeleteItemButton";
import { RenameItemForm } from "@/components/RenameItemForm";
import { fmtNum } from "@/lib/format";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [product, onOrder, settings, user] = await Promise.all([
    prisma.item.findUnique({ where: { id } }),
    getOnOrderQtyMap(),
    getSettings(),
    currentUser(),
  ]);
  if (!product || (product.type !== "PRODUCT" && product.type !== "ASSEMBLY")) notFound();
  const isAssembly = product.type === "ASSEMBLY";
  const canDelete = roleAtLeast(user?.role, "ADMIN");
  const canRename = roleAtLeast(user?.role, "MANAGER");

  // Direct BOM lines (this product's immediate children) with the child part details.
  const lines = await prisma.bomLine.findMany({
    where: { parentItemId: id },
    include: { child: true },
    orderBy: { child: { partNumber: "asc" } },
  });

  const builds = await prisma.productionLog.aggregate({ _sum: { qtyBuilt: true }, where: { productItemId: id } });
  const totalBuilt = builds._sum.qtyBuilt ?? 0;

  // BOM parts with outstanding qty on a sent PO.
  const onOrderParts = lines
    .filter((l) => onOrder.has(l.child.id))
    .map((l) => ({ id: l.child.id, partNumber: l.child.partNumber, name: l.child.name, qty: onOrder.get(l.child.id)! }))
    .sort((a, b) => a.partNumber.localeCompare(b.partNumber));

  return (
    <div className="space-y-6">
      <ListMemory listKey={`product-${id}`} />
      <header>
        <BackLink href="/products" className="text-xs text-muted hover:text-brand">
          ← Products
        </BackLink>
        <div className="mt-1">
          <RenameItemForm
            itemId={product.id}
            name={product.name}
            canEdit={canRename}
            label={isAssembly ? "board" : "product"}
          />
        </div>
        <div className="mt-1 flex items-center gap-2">
          <Badge>{product.partNumber}</Badge>
          <Badge>{isAssembly ? "Sub-assembly / board" : "Finished product"}</Badge>
          {!product.active && <Badge className="text-serious">Archived</Badge>}
          {canDelete && (
            <span className="no-print ml-auto">
              <DeleteItemButton
                itemId={product.id}
                label={isAssembly ? "Delete board" : "Delete product"}
                currency={settings.currency}
              />
            </span>
          )}
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

      {onOrderParts.length > 0 && (
        <Card title={`On order — ${fmtNum(onOrderParts.length)} part${onOrderParts.length === 1 ? "" : "s"}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-medium">Part</th>
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
                  <td className="px-4 py-2">
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
        </Card>
      )}

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
                <th
                  className="px-4 py-2 text-right font-medium"
                  title="Outstanding quantity on sent purchase orders (ordered − received)."
                >
                  On order
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const onOrderQty = onOrder.get(l.child.id) ?? 0;
                return (
                  <tr key={l.id} data-mem-id={l.child.id} className="border-b last:border-0 hover:bg-surface-2">
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
                    <td className={`px-4 py-2 text-right tnum ${l.child.onHand < 0 ? "font-medium text-critical" : ""}`}>
                      {fmtNum(l.child.onHand)}
                    </td>
                    <td className="px-4 py-2 text-right tnum">
                      {onOrderQty > 0 ? <span className="font-medium text-brand">{fmtNum(onOrderQty)}</span> : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
