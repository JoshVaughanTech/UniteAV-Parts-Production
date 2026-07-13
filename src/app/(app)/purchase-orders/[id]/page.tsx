import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/rbac";
import { roleAtLeast } from "@/lib/constants";
import {
  setPoSupplier,
  updatePoLineQty,
  removePoLine,
  addPoLine,
  markPoOrdered,
  cancelPo,
  receivePo,
} from "@/lib/po-actions";
import { Card, Badge, EmptyState, input, btnPrimary, btnGhost } from "@/components/ui";
import { PoStatusBadge } from "@/components/PoStatusBadge";
import { PrintButton } from "@/components/PrintButton";
import { fmtNum, fmtMoney, fmtCost, fmtDate } from "@/lib/format";

export default async function PurchaseOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!roleAtLeast(user?.role, "OPERATOR")) redirect("/");
  const canManage = roleAtLeast(user?.role, "MANAGER");

  const [po, suppliers, parts] = await Promise.all([
    prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        lines: { include: { item: { select: { id: true, partNumber: true, name: true, onHand: true } } }, orderBy: { item: { partNumber: "asc" } } },
      },
    }),
    prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.item.findMany({ where: { type: { in: ["PART", "ASSEMBLY"] } }, select: { partNumber: true }, orderBy: { partNumber: "asc" } }),
  ]);
  if (!po) notFound();

  const cur = po.currency;
  const total = po.lines.reduce((s, l) => s + l.qtyOrdered * l.unitCost, 0);
  const isDraft = po.status === "DRAFT";
  const isOpen = po.status === "ORDERED" || po.status === "PARTIAL";
  const closed = po.status === "RECEIVED" || po.status === "CANCELLED";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/purchase-orders" className="text-xs text-muted hover:text-brand">
            ← Purchase Orders
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-xl font-semibold text-ink">{po.poNumber}</h1>
            <PoStatusBadge status={po.status} />
          </div>
          <p className="mt-1 text-sm text-ink-2">
            {po.supplier?.name ?? "Unassigned supplier"} · {fmtNum(po.lines.length)} line(s) ·{" "}
            <span className="font-semibold">{fmtMoney(total, cur)}</span>
            {po.orderedAt ? ` · ordered ${fmtDate(po.orderedAt)}` : ` · created ${fmtDate(po.createdAt)}`}
          </p>
        </div>
        <PrintButton label="Print PO" />
      </header>

      {po.autoCreated && isDraft && (
        <div className="rounded-xl border px-4 py-3 text-sm text-ink-2" style={{ borderColor: "var(--serious)" }}>
          🤖 <strong className="text-ink">Auto-created — awaiting approval.</strong> This PO exceeded the auto-approve
          limit. Review the lines, then <em>Approve &amp; mark ordered</em> to send it, or Cancel.
        </div>
      )}

      {/* DRAFT: assign supplier */}
      {isDraft && canManage && (
        <Card title="Supplier">
          <form action={setPoSupplier} className="flex flex-wrap items-end gap-2 p-4">
            <input type="hidden" name="poId" value={po.id} />
            <select className={`${input} w-56`} name="supplierId" defaultValue={po.supplierId ?? ""}>
              <option value="">— Unassigned —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button className={btnGhost}>Save supplier</button>
          </form>
        </Card>
      )}

      <Card title="Lines">
        {po.lines.length === 0 ? (
          <EmptyState title="No lines yet." hint={canManage ? "Add parts below." : undefined} />
        ) : isOpen ? (
          /* RECEIVE MODE */
          <form action={receivePo}>
            <input type="hidden" name="poId" value={po.id} />
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-medium">Part</th>
                  <th className="px-4 py-2 text-right font-medium">Ordered</th>
                  <th className="px-4 py-2 text-right font-medium">Received</th>
                  <th className="px-4 py-2 text-right font-medium">On hand</th>
                  <th className="px-4 py-2 text-right font-medium">Receive now</th>
                </tr>
              </thead>
              <tbody>
                {po.lines.map((l) => {
                  const remaining = Math.max(0, l.qtyOrdered - l.qtyReceived);
                  return (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="px-4 py-2">
                        <Link href={`/parts/${l.item.id}`} className="font-medium text-ink hover:text-brand">
                          {l.item.partNumber}
                        </Link>
                        <div className="max-w-xs truncate text-xs text-muted">{l.item.name}</div>
                      </td>
                      <td className="px-4 py-2 text-right tnum">{fmtNum(l.qtyOrdered)}</td>
                      <td className="px-4 py-2 text-right tnum">{fmtNum(l.qtyReceived)}</td>
                      <td className="px-4 py-2 text-right tnum">{fmtNum(l.item.onHand)}</td>
                      <td className="px-4 py-2 text-right">
                        <input
                          className={`${input} w-24 text-right`}
                          name={`recv_${l.id}`}
                          type="number"
                          min="0"
                          defaultValue={remaining}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex items-center gap-2 border-t p-4">
              <button className={btnPrimary}>Record receipt (updates stock)</button>
              <span className="text-xs text-muted">On-hand increases and the ledger records each receipt.</span>
            </div>
          </form>
        ) : (
          /* DRAFT or CLOSED: read/edit */
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-medium">Part</th>
                <th className="px-4 py-2 text-right font-medium">Qty</th>
                <th className="px-4 py-2 text-right font-medium">Unit cost</th>
                <th className="px-4 py-2 text-right font-medium">Line total</th>
                {closed && <th className="px-4 py-2 text-right font-medium">Received</th>}
                {isDraft && canManage && <th className="no-print px-4 py-2" />}
              </tr>
            </thead>
            <tbody>
              {po.lines.map((l) => (
                <tr key={l.id} className="border-b last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-2">
                    <Link href={`/parts/${l.item.id}`} className="font-medium text-ink hover:text-brand">
                      {l.item.partNumber}
                    </Link>
                    <div className="max-w-xs truncate text-xs text-muted">{l.item.name}</div>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {isDraft && canManage ? (
                      <form action={updatePoLineQty} className="no-print flex items-center justify-end gap-1">
                        <input type="hidden" name="poId" value={po.id} />
                        <input type="hidden" name="lineId" value={l.id} />
                        <input className={`${input} w-20 text-right`} name="qty" type="number" min="0" defaultValue={l.qtyOrdered} />
                        <button className="text-xs text-brand hover:underline">save</button>
                      </form>
                    ) : (
                      <span className="tnum">{fmtNum(l.qtyOrdered)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tnum">{fmtCost(l.unitCost, cur)}</td>
                  <td className="px-4 py-2 text-right tnum">{fmtMoney(l.qtyOrdered * l.unitCost, cur)}</td>
                  {closed && <td className="px-4 py-2 text-right tnum">{fmtNum(l.qtyReceived)}</td>}
                  {isDraft && canManage && (
                    <td className="no-print px-4 py-2 text-right">
                      <form action={removePoLine}>
                        <input type="hidden" name="poId" value={po.id} />
                        <input type="hidden" name="lineId" value={l.id} />
                        <button className="text-xs text-muted hover:text-critical">remove</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-semibold">
                <td className="px-4 py-2" colSpan={3}>
                  Total
                </td>
                <td className="px-4 py-2 text-right tnum">{fmtMoney(total, cur)}</td>
                {closed && <td />}
                {isDraft && canManage && <td className="no-print" />}
              </tr>
            </tfoot>
          </table>
        )}
      </Card>

      {/* DRAFT: add line + submit order */}
      {isDraft && canManage && (
        <div className="no-print grid gap-4 lg:grid-cols-2">
          <Card title="Add a part">
            <form action={addPoLine} className="flex flex-wrap items-end gap-2 p-4">
              <input type="hidden" name="poId" value={po.id} />
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-2">Item number</span>
                <input className={`${input} w-48`} name="partNumber" list="parts-dl" placeholder="e.g. CAPS-00085" required />
                <datalist id="parts-dl">
                  {parts.map((p) => (
                    <option key={p.partNumber} value={p.partNumber} />
                  ))}
                </datalist>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-2">Qty</span>
                <input className={`${input} w-24`} name="qty" type="number" min="1" defaultValue={1} />
              </label>
              <button className={btnGhost}>Add line</button>
            </form>
          </Card>
          <Card title="Actions">
            <div className="flex flex-wrap items-center gap-2 p-4">
              <form action={markPoOrdered}>
                <input type="hidden" name="poId" value={po.id} />
                <button className={btnPrimary} disabled={po.lines.length === 0}>
                  {po.autoCreated ? "Approve & mark ordered" : "Mark as ordered"}
                </button>
              </form>
              <form action={cancelPo}>
                <input type="hidden" name="poId" value={po.id} />
                <button className={btnGhost}>Cancel PO</button>
              </form>
            </div>
            <p className="px-4 pb-4 text-xs text-muted">
              Marking as ordered locks the lines and opens the receive flow. (Emailing/auto-ordering plugs in here later.)
            </p>
          </Card>
        </div>
      )}

      {isOpen && canManage && (
        <form action={cancelPo} className="no-print">
          <input type="hidden" name="poId" value={po.id} />
          <button className={btnGhost}>Cancel PO</button>
        </form>
      )}

      {po.status === "PARTIAL" && (
        <Badge className="text-serious">Some lines still outstanding — receive the rest when it arrives.</Badge>
      )}
    </div>
  );
}
