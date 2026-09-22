import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSettings, getOnOrderQtyMap } from "@/lib/metrics";
import { loadBomTree } from "@/lib/bom/rollup";
import { Card, EmptyState, Badge } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { ListMemory } from "@/components/ListMemory";
import { fmtNum, fmtMoney } from "@/lib/format";

const TABS = [
  { key: "products", label: "Products" },
  { key: "boards", label: "Boards" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: rawTab } = await searchParams;
  const tab: Tab = rawTab === "boards" ? "boards" : "products";

  const [settings, onOrder, tree, productCount, boardCount] = await Promise.all([
    getSettings(),
    getOnOrderQtyMap(),
    loadBomTree(),
    prisma.item.count({ where: { type: "PRODUCT" } }),
    prisma.item.count({ where: { type: "ASSEMBLY" } }),
  ]);
  const counts: Record<Tab, number> = { products: productCount, boards: boardCount };

  return (
    <div className="space-y-6">
      <ListMemory listKey={`products-${tab}`} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Products</h1>
          <p className="text-sm text-muted">
            {tab === "products"
              ? "Finished products and the boards that build them. Click a product to expand it."
              : "Every board and sub-assembly, the products that fit them, and board stock on hand."}
          </p>
        </div>
        <PrintButton label={tab === "products" ? "Print products" : "Print boards"} />
      </header>

      <nav className="no-print flex gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={{ pathname: "/products", query: t.key === "products" ? {} : { tab: t.key } }}
            aria-current={tab === t.key ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.key ? "border-brand text-brand" : "border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs tnum text-muted">{fmtNum(counts[t.key])}</span>
          </Link>
        ))}
      </nav>

      {tab === "products" ? (
        <ProductsTab tree={tree} onOrder={onOrder} currency={settings.currency} />
      ) : (
        <BoardsTab tree={tree} onOrder={onOrder} currency={settings.currency} />
      )}
    </div>
  );
}

type Tree = Awaited<ReturnType<typeof loadBomTree>>;
type TabProps = { tree: Tree; onOrder: Map<string, number>; currency: string };

async function ProductsTab({ tree, onOrder, currency }: TabProps) {
  const products = await prisma.item.findMany({
    where: { type: "PRODUCT" },
    orderBy: { name: "asc" },
    include: {
      bomParents: {
        include: { child: { include: { _count: { select: { bomParents: true } } } } },
        orderBy: { child: { name: "asc" } },
      },
    },
  });

  if (products.length === 0) {
    return (
      <Card>
        <EmptyState title="No finished products yet." hint="Import BOMs and assemble boards into products." />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {products.map((p) => {
        // Distinct parts + cost come from the live BOM tree, not the ExplodedBom cache,
        // so these numbers always match the lines listed underneath.
        const leaves = tree.leavesOf(p.id);
        const boardCount = p.bomParents.filter((bl) => bl.child.type !== "PART").length;
        const onOrderParts = [...leaves.keys()]
          .filter((leafId) => onOrder.has(leafId))
          .map((leafId) => ({ ...tree.item(leafId)!, qty: onOrder.get(leafId)! }))
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
                  {fmtNum(boardCount)} board{boardCount === 1 ? "" : "s"} · {fmtNum(leaves.size)} distinct parts
                  {onOrderParts.length > 0 && (
                    <span className="font-medium text-brand"> · {fmtNum(onOrderParts.length)} on order</span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold tnum text-ink">{fmtMoney(tree.costOf(p.id), currency)}</div>
                <div className="text-xs text-muted">parts cost / unit</div>
              </div>
            </summary>

            <div className="border-t">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-2 pl-11 font-medium">Board / part</th>
                    <th className="px-4 py-2 font-medium">Item number</th>
                    <th className="px-4 py-2 text-right font-medium">Qty / unit</th>
                    <th className="px-4 py-2 text-right font-medium">Parts</th>
                  </tr>
                </thead>
                <tbody>
                  {p.bomParents.map((bl) => {
                    const isBoard = bl.child.type !== "PART";
                    return (
                      <tr key={bl.id} data-mem-id={bl.child.id} className="border-b last:border-0 hover:bg-surface-2">
                        <td className="px-4 py-2 pl-11">
                          <Link
                            href={isBoard ? `/products/${bl.child.id}` : `/parts/${bl.child.id}`}
                            className="font-medium text-ink hover:text-brand"
                          >
                            {bl.child.name}
                          </Link>
                        </td>
                        <td className="px-4 py-2">
                          <Badge>{bl.child.partNumber}</Badge>
                        </td>
                        <td className="px-4 py-2 text-right tnum">{fmtNum(bl.qtyPer)}</td>
                        <td className="px-4 py-2 text-right tnum text-muted">
                          {isBoard ? fmtNum(bl.child._count.bomParents) : "—"}
                        </td>
                      </tr>
                    );
                  })}
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
  );
}

async function BoardsTab({ tree, onOrder, currency }: TabProps) {
  const boards = await prisma.item.findMany({
    where: { type: "ASSEMBLY" },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { bomParents: true } }, // BOM lines on this board
      bomChildren: { include: { parent: { select: { id: true, name: true } } } }, // products that fit it
    },
  });

  if (boards.length === 0) {
    return (
      <Card>
        <EmptyState title="No boards yet." hint="Import a board BOM to add one." />
      </Card>
    );
  }

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2 font-medium">Board / sub-assembly</th>
              <th className="px-4 py-2 font-medium">Item number</th>
              <th className="px-4 py-2 text-right font-medium">Parts</th>
              <th className="px-4 py-2 font-medium">Fitted to</th>
              <th className="px-4 py-2 text-right font-medium" title="Assembled boards currently in stock.">
                On hand
              </th>
              <th className="px-4 py-2 text-right font-medium">Parts cost / board</th>
            </tr>
          </thead>
          <tbody>
            {boards.map((b) => {
              const fittedTo = b.bomChildren.map((l) => l.parent);
              const onOrderCount = [...tree.leavesOf(b.id).keys()].filter((id) => onOrder.has(id)).length;
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
                    {fmtNum(b._count.bomParents)}
                    {onOrderCount > 0 && (
                      <div className="text-xs font-medium text-brand">{fmtNum(onOrderCount)} on order</div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {fittedTo.length === 0 ? (
                      <span className="text-xs text-serious">Not fitted to any product</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {fittedTo.map((u) => (
                          <Link key={u.id} href={`/products/${u.id}`} className="hover:opacity-80">
                            <Badge>{u.name}</Badge>
                          </Link>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className={`px-4 py-2 text-right tnum ${b.onHand < 0 ? "font-medium text-critical" : ""}`}>
                    {fmtNum(b.onHand)}
                  </td>
                  <td className="px-4 py-2 text-right tnum">{fmtMoney(tree.costOf(b.id), currency)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
