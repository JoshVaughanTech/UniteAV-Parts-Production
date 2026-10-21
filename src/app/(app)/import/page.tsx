import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/rbac";
import { roleAtLeast } from "@/lib/constants";
import { importBomAction, importTopLevelAction } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { ImportBomForm } from "@/components/ImportBomForm";
import { Card, EmptyState, Badge } from "@/components/ui";
import { fmtDate, fmtNum } from "@/lib/format";

export default async function ImportPage() {
  const user = await currentUser();
  if (!roleAtLeast(user?.role, "MANAGER")) redirect("/");

  const [batches, products, boardRows] = await Promise.all([
    prisma.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 15 }),
    prisma.item.findMany({
      where: { type: "PRODUCT", active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.item.findMany({
      where: { type: "ASSEMBLY", active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        partNumber: true,
        rev: true,
        _count: { select: { bomParents: true } },
        // Which products fit this board — the form narrows its list to the chosen one.
        bomChildren: { select: { parentItemId: true } },
      },
    }),
  ]);
  const boards = boardRows.map((b) => ({
    id: b.id,
    name: b.name,
    partNumber: b.partNumber,
    rev: b.rev,
    lines: b._count.bomParents,
    productIds: b.bomChildren.map((l) => l.parentItemId),
  }));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Import BOM</h1>
        <p className="text-sm text-muted">
          Upload an Altium-style purchasing BOM (.xlsx or .csv). Parts are matched by Item Number, so shared parts stay
          as one master record across products.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Import a board BOM">
          <ImportBomForm action={importBomAction} products={products} boards={boards} />
        </Card>

        <Card title="Expected columns">
          <div className="space-y-2 p-4 text-sm text-ink-2">
            <p>The importer recognizes these headers (case-insensitive):</p>
            <div className="flex flex-wrap gap-1.5">
              {["Quantity", "Item Number", "Comment", "Item Name", "Footprint", "Manufacturer 1", "Manufacturer Item 1"].map(
                (c) => (
                  <Badge key={c}>{c}</Badge>
                ),
              )}
            </div>
            <p className="text-xs text-muted">
              Re-importing the same product updates quantities and descriptions without duplicating parts or clobbering
              your on-hand, cost, lead-time, or supplier data.
            </p>
          </div>
        </Card>
      </div>

      <Card title="Top-level BOM — update cost &amp; stock">
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <div>
            <p className="mb-3 text-sm text-ink-2">
              Upload the <strong>Encode/Decode Top Level</strong> purchasing sheet (with <em>Price Each</em> and{" "}
              <em>Quantity in Stock</em> columns) to set unit cost and on-hand inventory across all parts at once.
              Missing parts are created; existing stock is adjusted through the ledger.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {["Price Each", "Quantity in Stock"].map((c) => (
                <Badge key={c}>{c}</Badge>
              ))}
            </div>
          </div>
          <ActionForm action={importTopLevelAction} submitLabel="Update cost &amp; stock" className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-2">Top-level BOM file</span>
              <input
                className="w-full rounded-lg border bg-surface px-3 py-2 text-sm text-ink file:mr-3 file:rounded file:border-0 file:bg-surface-2 file:px-2 file:py-1 file:text-ink"
                name="file"
                type="file"
                accept=".xlsx,.xls,.csv"
                required
              />
            </label>
          </ActionForm>
        </div>
      </Card>

      <Card title="Import history">
        {batches.length === 0 ? (
          <EmptyState title="No imports yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">File</th>
                  <th className="px-4 py-2 font-medium">Product</th>
                  <th className="px-4 py-2 text-right font-medium">Rows</th>
                  <th className="px-4 py-2 text-right font-medium">New / Upd</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-b last:border-0">
                    <td className="px-4 py-2 text-xs text-muted">{fmtDate(b.createdAt)}</td>
                    <td className="px-4 py-2 max-w-xs truncate text-ink-2">{b.filename}</td>
                    <td className="px-4 py-2 text-ink">{b.productLabel ?? "—"}</td>
                    <td className="px-4 py-2 text-right tnum">{fmtNum(b.rowCount)}</td>
                    <td className="px-4 py-2 text-right tnum">
                      {fmtNum(b.createdCount)} / {fmtNum(b.updatedCount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
