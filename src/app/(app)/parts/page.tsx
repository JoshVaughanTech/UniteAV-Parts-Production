import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getPartRows, getSettings } from "@/lib/metrics";
import { currentUser } from "@/lib/rbac";
import { roleAtLeast } from "@/lib/constants";
import { Card, EmptyState, input } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { PartsTable } from "@/components/PartsTable";
import { fmtNum, fmtDate } from "@/lib/format";
import type { PartStatus } from "@/lib/reorder";

const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "attention", label: "Needs attention" },
  { key: "REORDER", label: "Reorder" },
  { key: "OUT", label: "Out" },
  { key: "LOW", label: "Low" },
  { key: "OK", label: "OK" },
];

export default async function PartsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { q = "", status = "all" } = await searchParams;
  const [rows, settings, suppliers, user] = await Promise.all([
    getPartRows(),
    getSettings(),
    prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    currentUser(),
  ]);
  const canEdit = roleAtLeast(user?.role, "MANAGER");

  const query = q.trim().toLowerCase();
  const filtered = rows.filter((p) => {
    if (query) {
      const hay = `${p.partNumber} ${p.name} ${p.value ?? ""} ${p.mpn ?? ""} ${p.manufacturer ?? ""}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    const s = p.reorder.status;
    if (status === "attention") return s === "REORDER" || s === "OUT" || s === "LOW";
    if (status !== "all") return s === (status as PartStatus);
    return true;
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Parts &amp; Inventory</h1>
          <p className="text-sm text-muted">
            Master parts list with on-hand stock, usage, and reorder status. {fmtNum(filtered.length)} of{" "}
            {fmtNum(rows.length)} shown.
          </p>
        </div>
        <PrintButton label="Print list" />
      </header>

      {/* Report heading shown only when printing */}
      <div className="print-only mb-3">
        <h1 style={{ fontSize: "16px", fontWeight: 700 }}>Unite AV — Inventory List</h1>
        <p style={{ fontSize: "11px" }}>
          {fmtNum(filtered.length)} parts
          {q ? ` · search "${q}"` : ""}
          {status !== "all" ? ` · filter: ${status}` : ""} · Generated {fmtDate(new Date())}
        </p>
      </div>

      <form className="no-print flex flex-wrap items-center gap-2" method="get">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search part #, description, MPN…"
          className={`${input} max-w-xs`}
        />
        <input type="hidden" name="status" value={status} />
        <button className="rounded-lg border bg-surface px-3 py-1.5 text-sm text-ink hover:bg-surface-2">Search</button>
        <div className="ml-auto flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={{ pathname: "/parts", query: { ...(q ? { q } : {}), status: f.key } }}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                status === f.key ? "border-brand bg-brand/10 text-brand" : "text-ink-2 hover:bg-surface-2"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </form>

      <Card>
        {filtered.length === 0 ? (
          <EmptyState title="No parts match." hint="Try clearing the search or filter." />
        ) : (
          <PartsTable rows={filtered} suppliers={suppliers} currency={settings.currency} canEdit={canEdit} />
        )}
      </Card>
    </div>
  );
}
