import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/rbac";
import { roleAtLeast } from "@/lib/constants";
import { getSettings } from "@/lib/metrics";
import { buildPoDocument } from "@/lib/po-document";
import { PoDocumentSheet, PO_DOCUMENT_CSS } from "@/components/PoDocument";
import { PrintButton } from "@/components/PrintButton";

/**
 * The purchase order a supplier receives.
 *
 * Its own route rather than a print stylesheet over the app page. The dashboard page shows
 * on-hand quantities, received totals, the internal USD conversion, editable inputs and
 * the approval state — hiding all of that for print is a fight that has to be re-won every
 * time something is added to that page, and one missed `no-print` puts internal stock
 * levels on a supplier's desk. Here those figures were never in scope to begin with.
 */
export default async function PurchaseOrderDocument({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!roleAtLeast(user?.role, "OPERATOR")) redirect("/");

  const [po, settings] = await Promise.all([
    prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        lines: {
          include: { item: { select: { partNumber: true, name: true, mpn: true } } },
          orderBy: { item: { partNumber: "asc" } },
        },
      },
    }),
    getSettings(),
  ]);
  if (!po) notFound();

  // PurchaseOrder carries a userId but has no relation to User, so this is its own lookup.
  const raiser = po.userId
    ? await prisma.user.findUnique({ where: { id: po.userId }, select: { name: true, email: true } })
    : null;

  const doc = buildPoDocument(po, settings, raiser?.name ?? raiser?.email ?? null);

  return (
    <>
      <style>{PO_DOCUMENT_CSS}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-3 text-sm">
        <Link href={`/purchase-orders/${po.id}`} className="text-neutral-500 hover:text-neutral-900">
          ← Back to {po.poNumber}
        </Link>
        <span className="flex flex-wrap items-center gap-3">
          {po.status === "DRAFT" && (
            <span className="font-medium text-amber-700">Still a draft — not yet marked as ordered.</span>
          )}
          {doc.missingCompanyDetails.length > 0 && (
            <Link href="/settings" className="font-medium text-red-700 underline">
              No {doc.missingCompanyDetails.join(", ")} — fill in Settings → Company details
            </Link>
          )}
          <PrintButton label="Print / Save as PDF" />
        </span>
      </div>

      <div className="doc-page">
        <PoDocumentSheet doc={doc} />
      </div>
    </>
  );
}
