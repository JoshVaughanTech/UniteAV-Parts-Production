import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/rbac";
import { roleAtLeast, CATEGORY_LABELS } from "@/lib/constants";
import { startStocktake } from "@/lib/stocktake-actions";
import { ActionForm } from "@/components/ActionForm";
import { Card, EmptyState, Badge, input } from "@/components/ui";
import { fmtNum, fmtDate } from "@/lib/format";

const TONE: Record<string, string> = {
  OPEN: "text-brand",
  COMMITTED: "text-good",
  ABANDONED: "text-muted",
};

export default async function StocktakePage() {
  const user = await currentUser();
  if (!roleAtLeast(user?.role, "OPERATOR")) redirect("/");

  const [takes, categories] = await Promise.all([
    prisma.stocktake.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { _count: { select: { entries: true } }, user: { select: { name: true, email: true } } },
    }),
    prisma.item.groupBy({
      by: ["category"],
      where: { type: { in: ["PART", "ASSEMBLY"] }, active: true },
      _count: true,
      orderBy: { category: "asc" },
    }),
  ]);
  const open = takes.find((t) => t.status === "OPEN");

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-ink">Stocktake</h1>
        <p className="text-sm text-muted">
          Count on your phone — scan or search, type what&rsquo;s on the shelf. Nothing moves until you commit, so a
          count can run over hours or days.
        </p>
      </header>

      {open ? (
        <Card title={`${open.number} is open`}>
          <div className="space-y-3 p-4">
            <p className="text-sm text-ink-2">
              {fmtNum(open._count.entries)} item{open._count.entries === 1 ? "" : "s"} counted so far
              {open.category ? ` · ${CATEGORY_LABELS[open.category] ?? open.category} only` : " · whole catalogue"}
              {open.note ? ` · ${open.note}` : ""}
            </p>
            <Link href={`/count/${open.id}`} className="block rounded-lg bg-brand px-4 py-3.5 text-center text-base font-medium text-white">
              Carry on counting →
            </Link>
          </div>
        </Card>
      ) : (
        <Card title="Start a stocktake">
          <ActionForm action={startStocktake} submitLabel="Start counting" className="space-y-3 p-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-2">What are you counting?</span>
              <select className={`${input} py-3 text-base`} name="category" defaultValue="">
                <option value="">Everything — all parts and boards</option>
                {categories.map((c) => (
                  <option key={c.category ?? "none"} value={c.category ?? ""}>
                    {CATEGORY_LABELS[c.category ?? ""] ?? c.category ?? "Uncategorised"} ({c._count} items)
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-2">Note (optional)</span>
              <input className={`${input} py-3 text-base`} name="note" placeholder="Shelf B, end of month…" />
            </label>
            <p className="text-xs text-muted">
              One stocktake runs at a time, so two counts can&rsquo;t both adjust the same part.
            </p>
          </ActionForm>
        </Card>
      )}

      <Card title="Past stocktakes">
        {takes.length === 0 ? (
          <EmptyState title="No stocktakes yet." hint="Start one above and count a shelf." />
        ) : (
          <ul className="divide-y">
            {takes.map((t) => (
              <li key={t.id}>
                <Link href={`/count/${t.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{t.number}</span>
                      <Badge className={TONE[t.status] ?? ""}>
                        {t.status.charAt(0) + t.status.slice(1).toLowerCase()}
                      </Badge>
                      {t.category && <Badge>{CATEGORY_LABELS[t.category] ?? t.category}</Badge>}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {fmtNum(t._count.entries)} counted ·{" "}
                      {t.committedAt ? `committed ${fmtDate(t.committedAt)}` : `started ${fmtDate(t.createdAt)}`}
                      {t.user ? ` · ${t.user.name ?? t.user.email}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-muted" aria-hidden>
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
