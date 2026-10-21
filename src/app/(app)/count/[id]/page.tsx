import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/rbac";
import { roleAtLeast, CATEGORY_LABELS } from "@/lib/constants";
import { getSettings } from "@/lib/metrics";
import { StocktakeCounter } from "@/components/StocktakeCounter";
import { StocktakeReview } from "@/components/StocktakeReview";
import { Card, EmptyState, Badge } from "@/components/ui";
import { fmtNum, fmtMoney, fmtDate } from "@/lib/format";

export default async function StocktakeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!roleAtLeast(user?.role, "OPERATOR")) redirect("/");

  const [take, settings] = await Promise.all([
    prisma.stocktake.findUnique({
      where: { id },
      include: {
        entries: {
          orderBy: { countedAt: "desc" },
          include: { item: { select: { id: true, partNumber: true, name: true, unitCost: true, onHand: true } } },
        },
        user: { select: { name: true, email: true } },
      },
    }),
    getSettings(),
  ]);
  if (!take) notFound();

  const isOpen = take.status === "OPEN";
  const canCommit = roleAtLeast(user?.role, "MANAGER");

  // The parts in scope. A committed stocktake needs none of this — it shows what it found.
  const parts = isOpen
    ? await prisma.item.findMany({
        where: {
          type: { in: ["PART", "ASSEMBLY"] },
          active: true,
          ...(take.category ? { category: take.category } : {}),
        },
        orderBy: { partNumber: "asc" },
        select: { id: true, partNumber: true, name: true, mpn: true, onHand: true },
      })
    : [];

  const rows = take.entries.map((e) => ({
    id: e.id,
    itemId: e.item.id,
    partNumber: e.item.partNumber,
    name: e.item.name,
    counted: e.counted,
    expected: e.expected,
    variance: e.counted - e.expected,
    unitCost: e.item.unitCost,
    // On-hand may have moved since counting; commit applies a delta, so that is fine —
    // but it is worth showing when it happened.
    onHandNow: e.item.onHand,
    countedAt: e.countedAt,
  }));
  const variances = rows.filter((r) => r.variance !== 0);
  const valueImpact = variances.reduce((s, r) => s + r.variance * (r.unitCost ?? 0), 0);
  const scopeLabel = take.category ? (CATEGORY_LABELS[take.category] ?? take.category) : "all parts & boards";

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        <Link href="/count" className="text-xs text-muted hover:text-brand">
          ← Stocktakes
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-ink">{take.number}</h1>
          <Badge className={isOpen ? "text-brand" : take.status === "COMMITTED" ? "text-good" : "text-muted"}>
            {take.status.charAt(0) + take.status.slice(1).toLowerCase()}
          </Badge>
          <Badge>{scopeLabel}</Badge>
        </div>
        <p className="mt-1 text-xs text-muted">
          {take.committedAt ? `Committed ${fmtDate(take.committedAt)}` : `Started ${fmtDate(take.createdAt)}`}
          {take.user ? ` by ${take.user.name ?? take.user.email}` : ""}
          {take.note ? ` · ${take.note}` : ""}
        </p>
      </header>

      {isOpen && (
        <StocktakeCounter
          stocktakeId={take.id}
          parts={parts}
          entries={rows.map((r) => ({
            id: r.id,
            itemId: r.itemId,
            partNumber: r.partNumber,
            counted: r.counted,
            expected: r.expected,
          }))}
          scopeLabel={scopeLabel}
        />
      )}

      {rows.length === 0 ? (
        !isOpen && (
          <Card title="Nothing counted">
            <EmptyState title="This stocktake recorded no counts." />
          </Card>
        )
      ) : (
        <StocktakeReview
          stocktakeId={take.id}
          status={take.status}
          canCommit={canCommit}
          rows={rows.map((r) => ({ ...r, countedAt: r.countedAt.toISOString() }))}
          currency={settings.currency}
          counted={rows.length}
          varianceCount={variances.length}
          valueImpact={valueImpact}
        />
      )}

      {isOpen && rows.length === 0 && (
        <p className="px-1 text-center text-xs text-muted">
          Counts appear here as you go. Nothing changes stock until {take.number} is committed.
        </p>
      )}

      {!isOpen && variances.length > 0 && (
        <p className="px-1 text-center text-xs text-muted">
          {take.status === "COMMITTED"
            ? `${fmtNum(variances.length)} adjustment(s) were posted, worth ${fmtMoney(valueImpact, settings.currency)}.`
            : "Abandoned — these counts were never posted to stock."}
        </p>
      )}
    </div>
  );
}
