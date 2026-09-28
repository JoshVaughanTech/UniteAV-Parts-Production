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

type BomLineRow = {
  id: string;
  qtyPer: number;
  child: {
    id: string;
    partNumber: string;
    name: string;
    type: string;
    value: string | null;
    manufacturer: string | null;
    onHand: number;
  };
};

/** One band of a BOM. A board row links through to its own page; a part to the part. */
function BomTable({
  title,
  hint,
  lines,
  onOrder,
}: {
  title: string;
  hint?: string;
  lines: BomLineRow[];
  onOrder: Map<string, number>;
}) {
  return (
    <Card
      title={
        <span className="flex flex-wrap items-baseline gap-2">
          {title}
          {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
        </span>
      }
    >
      <div className="overflow-x-auto">
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
              const isBoard = l.child.type !== "PART";
              return (
                <tr key={l.id} data-mem-id={l.child.id} className="border-b last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-2 text-right tnum font-medium">{fmtNum(l.qtyPer)}</td>
                  <td className="px-4 py-2">
                    <Link
                      href={isBoard ? `/products/${l.child.id}` : `/parts/${l.child.id}`}
                      className={isBoard ? "font-medium text-ink hover:text-brand" : "text-ink hover:text-brand"}
                    >
                      {l.child.partNumber}
                    </Link>
                  </td>
                  <td className="max-w-sm truncate px-4 py-2 text-ink-2">{l.child.name}</td>
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
      </div>
    </Card>
  );
}

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

  // A product's top level is boards plus the hardware fitted around them; they read
  // very differently, so they get their own tables.
  const boardLines = lines.filter((l) => l.child.type !== "PART");
  const hardwareLines = lines.filter((l) => l.child.type === "PART");

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
        <StatTile
          label={isAssembly ? "Parts" : "Boards"}
          value={fmtNum(isAssembly ? lines.length : boardLines.length)}
          hint={isAssembly ? undefined : `+ ${fmtNum(hardwareLines.length)} hardware & packaging`}
        />
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

      {lines.length === 0 ? (
        <Card title="Bill of materials">
          <EmptyState title="No parts on this BOM." />
        </Card>
      ) : isAssembly ? (
        // A board's BOM is one flat list of components — nothing to group.
        <BomTable title="Parts on this board" lines={lines} onOrder={onOrder} />
      ) : (
        <>
          <BomTable
            title={`Boards — ${fmtNum(boardLines.length)}`}
            hint="Click a board for the parts that build it."
            lines={boardLines}
            onOrder={onOrder}
          />
          {hardwareLines.length > 0 ? (
            <BomTable
              title={`Metalwork, hardware & packaging — ${fmtNum(hardwareLines.length)}`}
              lines={hardwareLines}
              onOrder={onOrder}
            />
          ) : (
            <Card title="Metalwork, hardware & packaging">
              <EmptyState
                title="Nothing on this product's top level but boards."
                hint="Its chassis, looms, screws and packaging haven't been imported yet."
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
