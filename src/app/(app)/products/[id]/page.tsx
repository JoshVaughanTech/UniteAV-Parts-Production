import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getOnOrderQtyMap, getSettings } from "@/lib/metrics";
import { loadBomTree } from "@/lib/bom/rollup";
import { currentUser } from "@/lib/rbac";
import { roleAtLeast } from "@/lib/constants";
import { Card, EmptyState, Badge, StatTile } from "@/components/ui";
import { ListMemory, BackLink } from "@/components/ListMemory";
import { DeleteItemButton } from "@/components/DeleteItemButton";
import { RenameItemForm } from "@/components/RenameItemForm";
import { AddBomLineForm } from "@/components/AddBomLineForm";
import { fmtNum, fmtMoney, fmtCost } from "@/lib/format";

type Tree = Awaited<ReturnType<typeof loadBomTree>>;

type BomLineRow = {
  id: string;
  qtyPer: number;
  child: {
    id: string;
    partNumber: string;
    name: string;
    type: string;
    manufacturer: string | null;
    onHand: number;
    unitCost: number | null;
  };
};

/**
 * What one of this line's child costs. A part carries its own unit cost; a board has none
 * of its own, so it is worth whatever its parts roll up to.
 */
function unitCostOf(child: BomLineRow["child"], tree: Tree): { cost: number; known: boolean } {
  if (child.type !== "PART") return { cost: tree.costOf(child.id), known: true };
  return { cost: child.unitCost ?? 0, known: child.unitCost != null };
}

/** One band of a BOM. A board row links through to its own page; a part to the part. */
function BomTable({
  title,
  hint,
  lines,
  onOrder,
  tree,
  currency,
}: {
  title: string;
  hint?: string;
  lines: BomLineRow[];
  onOrder: Map<string, number>;
  tree: Tree;
  currency: string;
}) {
  const subtotal = lines.reduce((s, l) => s + l.qtyPer * unitCostOf(l.child, tree).cost, 0);
  const unpriced = lines.filter((l) => !unitCostOf(l.child, tree).known).length;

  return (
    <Card
      title={
        <span className="flex flex-wrap items-baseline gap-2">
          {title}
          {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
        </span>
      }
      actions={
        <span className="text-sm font-semibold tnum text-ink">
          {fmtMoney(subtotal, currency)} <span className="text-xs font-normal text-muted">/ unit</span>
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
              <th className="px-4 py-2 font-medium">Manufacturer</th>
              <th className="px-4 py-2 text-right font-medium">On hand</th>
              <th
                className="px-4 py-2 text-right font-medium"
                title="Outstanding quantity on sent purchase orders (ordered − received)."
              >
                On order
              </th>
              <th className="px-4 py-2 text-right font-medium" title="A board's cost is what its own parts roll up to.">
                Unit cost
              </th>
              <th className="px-4 py-2 text-right font-medium">Line cost</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const onOrderQty = onOrder.get(l.child.id) ?? 0;
              const isBoard = l.child.type !== "PART";
              const { cost, known } = unitCostOf(l.child, tree);
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
                  <td className="px-4 py-2 text-ink-2">{l.child.manufacturer ?? "—"}</td>
                  <td className={`px-4 py-2 text-right tnum ${l.child.onHand < 0 ? "font-medium text-critical" : ""}`}>
                    {fmtNum(l.child.onHand)}
                  </td>
                  <td className="px-4 py-2 text-right tnum">
                    {onOrderQty > 0 ? <span className="font-medium text-brand">{fmtNum(onOrderQty)}</span> : "—"}
                  </td>
                  <td className="px-4 py-2 text-right tnum">
                    {known ? (
                      fmtCost(cost, currency)
                    ) : (
                      <span className="text-serious" title="No unit cost on this part — it counts as zero">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tnum font-medium">
                    {known ? fmtMoney(l.qtyPer * cost, currency) : <span className="text-serious">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {unpriced > 0 && (
        <p className="border-t px-4 py-2 text-xs text-muted">
          {fmtNum(unpriced)} line{unpriced === 1 ? "" : "s"} {unpriced === 1 ? "has" : "have"} no unit cost, so this
          subtotal is low by whatever {unpriced === 1 ? "it costs" : "they cost"}.
        </p>
      )}
    </Card>
  );
}

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [product, onOrder, settings, user, tree] = await Promise.all([
    prisma.item.findUnique({ where: { id } }),
    getOnOrderQtyMap(),
    getSettings(),
    currentUser(),
    loadBomTree(),
  ]);
  if (!product || (product.type !== "PRODUCT" && product.type !== "ASSEMBLY")) notFound();
  const isAssembly = product.type === "ASSEMBLY";
  const canDelete = roleAtLeast(user?.role, "ADMIN");
  const canRename = roleAtLeast(user?.role, "MANAGER");
  const canEditBom = roleAtLeast(user?.role, "MANAGER");

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

  // Rolled all the way down, so a board contributes what its own components cost. Equals
  // the sum of the line costs below, since each board line is priced by the same rollup.
  const totalCost = tree.costOf(id);
  const unpricedLeaves = [...tree.leavesOf(id).keys()].filter((leafId) => tree.item(leafId)?.unitCost == null).length;

  // A board's BOM takes parts; a product's takes parts and other boards. Suppliers are
  // for the inline "create this part" fields when an unknown item number is typed.
  const [addOptions, suppliers] = canEditBom
    ? await Promise.all([
        prisma.item.findMany({
          where: {
            active: true,
            id: { not: id },
            type: isAssembly ? { in: ["PART"] } : { in: ["PART", "ASSEMBLY"] },
          },
          select: { partNumber: true, name: true },
          orderBy: { partNumber: "asc" },
        }),
        prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      ])
    : [[], []];

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
          {product.rev && <Badge className="text-brand">Rev {product.rev}</Badge>}
          <Badge>{isAssembly ? "Sub-assembly / board" : "Finished product"}</Badge>
          {!product.active && <Badge className="text-serious">Archived</Badge>}
          {canDelete && (
            <span className="no-print ml-auto">
              <DeleteItemButton
                itemId={product.id}
                label={isAssembly ? "Delete board" : "Delete product"}
                currency={settings.currency}
                // Back to the list it came from — the Boards tab for a board.
                redirectTo={isAssembly ? "/products?tab=boards" : "/products"}
              />
            </span>
          )}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label={isAssembly ? "Total BOM cost" : "Total BOM cost / unit"}
          value={fmtMoney(totalCost, settings.currency)}
          hint={
            unpricedLeaves > 0
              ? `${fmtNum(unpricedLeaves)} unpriced part${unpricedLeaves === 1 ? "" : "s"} — low`
              : "every part priced"
          }
          tone={unpricedLeaves > 0 ? "warn" : "default"}
          title="Rolled all the way down to parts, so a board contributes what its own components cost."
        />
        <StatTile
          label={isAssembly ? "Parts" : "SMD Boards"}
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
        <BomTable title="Parts on this board" lines={lines} onOrder={onOrder} tree={tree} currency={settings.currency} />
      ) : (
        <>
          <BomTable
            title={`SMD Boards — ${fmtNum(boardLines.length)}`}
            hint="Click a board for the parts that build it."
            lines={boardLines}
            onOrder={onOrder}
            tree={tree}
            currency={settings.currency}
          />
          {hardwareLines.length > 0 ? (
            <BomTable
              title={`Metalwork, hardware & packaging — ${fmtNum(hardwareLines.length)}`}
              lines={hardwareLines}
              onOrder={onOrder}
              tree={tree}
              currency={settings.currency}
            />
          ) : (
            <Card title="Metalwork, hardware & packaging">
              <EmptyState
                title="Nothing on this product's top level but boards."
                hint="Its chassis, looms, screws and packaging haven't been imported yet — add them below, or import its workbook."
              />
            </Card>
          )}
        </>
      )}

      {canEditBom && (
        <Card title="Add to this BOM" className="no-print">
          <AddBomLineForm
            parentItemId={product.id}
            options={addOptions}
            suppliers={suppliers}
            isAssembly={isAssembly}
          />
        </Card>
      )}
    </div>
  );
}
