import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSettings, getOnOrderQtyMap } from "@/lib/metrics";
import { loadBomTree } from "@/lib/bom/rollup";
import { currentUser } from "@/lib/rbac";
import { roleAtLeast } from "@/lib/constants";
import { Card, EmptyState, Badge } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { ListMemory } from "@/components/ListMemory";
import { DeleteItemButton } from "@/components/DeleteItemButton";
import { RestoreItemButton } from "@/components/RestoreItemButton";
import { fmtNum, fmtMoney } from "@/lib/format";

const TABS = [
  { key: "products", label: "Products" },
  { key: "boards", label: "SMD Boards" },
  { key: "archived", label: "Archived" },
] as const;
type Tab = (typeof TABS)[number]["key"];

function asTab(raw: string | undefined): Tab {
  return TABS.some((t) => t.key === raw) ? (raw as Tab) : "products";
}

const BLURB: Record<Tab, string> = {
  products: "Click a product to open its top-level BOM — boards, metalwork, hardware and packaging.",
  boards: "Every SMD board and sub-assembly, the products that fit them, and board stock on hand.",
  archived: "Removed items whose history was worth keeping. Restoring returns an item to the catalogue, not to its BOMs.",
};

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = asTab((await searchParams).tab);

  const [settings, onOrder, tree, user, productCount, boardCount, archivedCount] = await Promise.all([
    getSettings(),
    getOnOrderQtyMap(),
    loadBomTree(),
    currentUser(),
    prisma.item.count({ where: { type: "PRODUCT", active: true } }),
    prisma.item.count({ where: { type: "ASSEMBLY", active: true } }),
    prisma.item.count({ where: { active: false } }),
  ]);
  const counts: Record<Tab, number> = { products: productCount, boards: boardCount, archived: archivedCount };
  const canDelete = roleAtLeast(user?.role, "ADMIN");
  const shared = { tree, onOrder, currency: settings.currency, canDelete };

  return (
    <div className="space-y-6">
      <ListMemory listKey={`products-${tab}`} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Products</h1>
          <p className="text-sm text-muted">{BLURB[tab]}</p>
        </div>
        <PrintButton label={tab === "boards" ? "Print boards" : "Print products"} />
      </header>

      <nav className="no-print flex gap-1 border-b">
        {TABS.map((t) => (
          // The archived tab only earns its place once something is in it.
          t.key === "archived" && archivedCount === 0 && tab !== "archived" ? null : (
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
          )
        ))}
      </nav>

      {tab === "products" && <ProductsTab {...shared} />}
      {tab === "boards" && <BoardsTab {...shared} />}
      {tab === "archived" && <ArchivedTab canDelete={canDelete} />}
    </div>
  );
}

type Tree = Awaited<ReturnType<typeof loadBomTree>>;
type TabProps = { tree: Tree; onOrder: Map<string, number>; currency: string; canDelete: boolean };

async function ProductsTab({ tree, onOrder, currency }: TabProps) {
  const products = await prisma.item.findMany({
    where: { type: "PRODUCT", active: true },
    orderBy: { name: "asc" },
    include: { bomParents: { select: { child: { select: { type: true } } } } },
  });

  if (products.length === 0) {
    return (
      <Card>
        <EmptyState title="No finished products yet." hint="Import BOMs and assemble boards into products." />
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {products.map((p) => {
        // Distinct parts + cost come from the live BOM tree, not the ExplodedBom cache,
        // so these numbers always match the BOM the product opens to.
        const leaves = tree.leavesOf(p.id);
        const boards = p.bomParents.filter((bl) => bl.child.type !== "PART").length;
        const hardware = p.bomParents.length - boards;
        const onOrderCount = [...leaves.keys()].filter((id) => onOrder.has(id)).length;

        return (
          <Link
            key={p.id}
            href={`/products/${p.id}`}
            data-mem-id={p.id}
            className="flex items-center gap-4 rounded-xl border bg-surface px-4 py-3.5 transition-colors hover:border-brand/40 hover:bg-surface-2"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">{p.name}</span>
                <Badge>{p.partNumber}</Badge>
              </div>
              <div className="mt-0.5 text-xs text-muted">
                {fmtNum(boards)} SMD board{boards === 1 ? "" : "s"}
                {" · "}
                {hardware > 0 ? (
                  <>{fmtNum(hardware)} hardware &amp; packaging</>
                ) : (
                  <span className="text-serious">no hardware yet</span>
                )}
                {" · "}
                {fmtNum(leaves.size)} distinct parts
                {onOrderCount > 0 && (
                  <span className="font-medium text-brand"> · {fmtNum(onOrderCount)} on order</span>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold tnum text-ink">{fmtMoney(tree.costOf(p.id), currency)}</div>
              <div className="text-xs text-muted">parts cost / unit</div>
            </div>
            <span className="text-muted" aria-hidden>
              →
            </span>
          </Link>
        );
      })}
    </div>
  );
}

async function BoardsTab({ tree, onOrder, currency, canDelete }: TabProps) {
  const boards = await prisma.item.findMany({
    where: { type: "ASSEMBLY", active: true },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { bomParents: true } }, // BOM lines on this board
      bomChildren: { include: { parent: { select: { id: true, name: true } } } }, // products that fit it
    },
  });

  if (boards.length === 0) {
    return (
      <Card>
        <EmptyState title="No SMD boards yet." hint="Import a board BOM to add one." />
      </Card>
    );
  }

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2 font-medium">SMD board / sub-assembly</th>
              <th className="px-4 py-2 font-medium">Item number</th>
              <th className="px-4 py-2 text-right font-medium">Parts</th>
              <th className="px-4 py-2 font-medium">Fitted to</th>
              <th className="px-4 py-2 text-right font-medium" title="Assembled boards currently in stock.">
                On hand
              </th>
              <th className="px-4 py-2 text-right font-medium">Parts cost / board</th>
              {canDelete && <th className="no-print px-4 py-2" />}
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
                    <span className="flex flex-wrap items-center gap-1">
                      <Badge>{b.partNumber}</Badge>
                      {b.rev && <Badge className="text-brand">Rev {b.rev}</Badge>}
                    </span>
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
                  {canDelete && (
                    <td className="no-print px-4 py-2 text-right">
                      <DeleteItemButton itemId={b.id} currency={currency} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const TYPE_LABEL: Record<string, string> = { PRODUCT: "Product", ASSEMBLY: "Board", PART: "Part" };

async function ArchivedTab({ canDelete }: { canDelete: boolean }) {
  const items = await prisma.item.findMany({
    where: { active: false },
    orderBy: [{ type: "asc" }, { partNumber: "asc" }],
    select: {
      id: true,
      partNumber: true,
      name: true,
      type: true,
      onHand: true,
      _count: { select: { invTxns: true, productionLogs: true, priceHistory: true } },
    },
  });

  if (items.length === 0) {
    return (
      <Card>
        <EmptyState title="Nothing archived." hint="Items with history land here instead of being deleted outright." />
      </Card>
    );
  }

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2 font-medium">Item</th>
              <th className="px-4 py-2 font-medium">Item number</th>
              <th className="px-4 py-2 font-medium">Was</th>
              <th className="px-4 py-2 text-right font-medium">On hand</th>
              <th className="px-4 py-2 font-medium">History kept</th>
              {canDelete && <th className="no-print px-4 py-2" />}
            </tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const kept = [
                i._count.invTxns > 0 && `${fmtNum(i._count.invTxns)} stock`,
                i._count.productionLogs > 0 && `${fmtNum(i._count.productionLogs)} builds`,
                i._count.priceHistory > 0 && `${fmtNum(i._count.priceHistory)} prices`,
              ].filter(Boolean) as string[];
              return (
                <tr key={i.id} className="border-b last:border-0 hover:bg-surface-2">
                  <td className="max-w-sm truncate px-4 py-2 text-ink">{i.name}</td>
                  <td className="px-4 py-2">
                    <Badge>{i.partNumber}</Badge>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted">{TYPE_LABEL[i.type] ?? i.type}</td>
                  <td className="px-4 py-2 text-right tnum text-ink-2">{fmtNum(i.onHand)}</td>
                  <td className="px-4 py-2 text-xs text-muted">{kept.join(" · ") || "—"}</td>
                  {canDelete && (
                    <td className="no-print px-4 py-2 text-right">
                      <RestoreItemButton itemId={i.id} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
