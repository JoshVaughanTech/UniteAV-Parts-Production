import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/rbac";
import { roleAtLeast } from "@/lib/constants";
import {
  setPoSupplier,
  setPoDetails,
  updatePoLines,
  savePoLinePrices,
  removePoLine,
  addPoLine,
  markPoOrdered,
  returnPoToDraft,
  cancelPo,
  receivePo,
  receivePoLine,
  receivePoRemaining,
} from "@/lib/po-actions";
import { Card, Badge, EmptyState, input, btnPrimary, btnGhost } from "@/components/ui";
import { PoStatusBadge } from "@/components/PoStatusBadge";
import { fmtNum, fmtMoney, fmtCost, fmtDate } from "@/lib/format";
import { toUsd } from "@/lib/fx";

export default async function PurchaseOrderDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ problem?: string; note?: string }>;
}) {
  const { id } = await params;
  // The actions on this page are plain form actions with no return value, so a refusal
  // arrives in the query string. Without this the guards would look like dead buttons.
  const { problem, note } = await searchParams;
  const user = await currentUser();
  if (!roleAtLeast(user?.role, "OPERATOR")) redirect("/");
  const canManage = roleAtLeast(user?.role, "MANAGER");

  const [po, suppliers, parts] = await Promise.all([
    prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        lines: { include: { item: { select: { id: true, partNumber: true, name: true, mpn: true, onHand: true } } }, orderBy: { item: { partNumber: "asc" } } },
      },
    }),
    prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.item.findMany({
      where: { type: { in: ["PART", "ASSEMBLY"] }, active: true },
      select: { partNumber: true },
      orderBy: { partNumber: "asc" },
    }),
  ]);
  if (!po) notFound();

  const cur = po.currency;
  const total = po.lines.reduce((s, l) => s + l.qtyOrdered * l.unitCost, 0);
  // The rate was frozen when this PO was created, so its USD figures are what the order
  // was worth on the day — they do not move with the market afterwards.
  const usd = (amount: number) => toUsd(amount, po.usdRate);
  const isDraft = po.status === "DRAFT";
  const isOpen = po.status === "ORDERED" || po.status === "PARTIAL";
  const closed = po.status === "RECEIVED" || po.status === "CANCELLED";
  // A sent order can go back to draft only while nothing has arrived — a receipt is a real
  // stock movement, and reopening the order it was booked against orphans it.
  const nothingReceived = po.lines.every((l) => l.qtyReceived === 0);

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
            {usd(total) != null && <> · {fmtMoney(usd(total), "USD")}</>}
            {po.orderedAt ? ` · ordered ${fmtDate(po.orderedAt)}` : ` · created ${fmtDate(po.createdAt)}`}
          </p>
          {po.usdRate != null ? (
            <p className="mt-0.5 text-xs text-muted">
              USD at {po.usdRate.toFixed(4)} per {cur}, fixed when this PO was created on {fmtDate(po.createdAt)}.
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-serious">
              No USD rate was recorded for this PO, so USD values can&rsquo;t be shown.
            </p>
          )}
        </div>
        {/* The supplier's copy is its own document, not this page with the chrome hidden. */}
        <Link href={`/purchase-orders/${po.id}/print`} className={`${btnGhost} no-print`}>
          <span aria-hidden>🖨</span> Supplier copy
        </Link>
      </header>

      {problem && (
        <div
          className="no-print rounded-xl border px-4 py-3 text-sm text-ink-2"
          style={{ borderColor: "var(--critical)" }}
          role="alert"
        >
          <strong className="text-critical">Not done.</strong> {problem}
        </div>
      )}
      {note && (
        <div className="no-print rounded-xl border px-4 py-3 text-sm text-ink-2" style={{ borderColor: "var(--serious)" }}>
          {note}
        </div>
      )}

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
            {/* React resets an action form once it submits, and a <select> keeps the default
                option it mounted with — which snapped this back to "Unassigned" even though
                the supplier had saved. Keying it to the saved supplier remounts it on the
                revalidated value, so the choice stays on screen. */}
            <select
              key={po.supplierId ?? "unassigned"}
              className={`${input} w-56`}
              name="supplierId"
              defaultValue={po.supplierId ?? ""}
            >
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

      {/* Both of these print on the supplier's copy and had nowhere to be entered. */}
      {isDraft && canManage && (
        <Card title="Order details">
          <form action={setPoDetails} className="space-y-3 p-4">
            <input type="hidden" name="poId" value={po.id} />
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-2">Required by</span>
              <input
                className={`${input} w-48`}
                name="expectedAt"
                type="date"
                defaultValue={po.expectedAt ? po.expectedAt.toISOString().slice(0, 10) : ""}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-2">
                Note to the supplier
                <span className="ml-2 font-normal text-muted">printed on their copy</span>
              </span>
              <textarea
                className={`${input} min-h-20`}
                name="notes"
                rows={2}
                defaultValue={po.notes ?? ""}
                placeholder="Deliver to the rear dock. Call on arrival."
              />
            </label>
            <button className={btnGhost}>Save details</button>
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-2 font-medium">Part</th>
                    <th className="px-4 py-2 text-right font-medium">Ordered</th>
                    <th className="px-4 py-2 text-right font-medium">Received</th>
                    <th className="px-4 py-2 text-right font-medium">Outstanding</th>
                    <th className="px-4 py-2 text-right font-medium">Unit cost</th>
                    <th className="px-4 py-2 text-right font-medium">On hand</th>
                    <th className="px-4 py-2 text-right font-medium">Receive now</th>
                    <th className="no-print px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {po.lines.map((l) => {
                    const remaining = Math.max(0, l.qtyOrdered - l.qtyReceived);
                    const done = remaining <= 0;
                    return (
                      <tr key={l.id} className="border-b last:border-0">
                        <td className="px-4 py-2">
                          <Link href={`/parts/${l.item.id}`} className="font-medium text-ink hover:text-brand">
                            {l.item.partNumber}
                          </Link>
                          <div className="max-w-xs truncate text-xs text-muted">{l.item.mpn ?? l.item.name}</div>
                        </td>
                        <td className="px-4 py-2 text-right tnum">{fmtNum(l.qtyOrdered)}</td>
                        <td className="px-4 py-2 text-right tnum">{fmtNum(l.qtyReceived)}</td>
                        <td className="px-4 py-2 text-right tnum">
                          {done ? <span className="text-good">✓ complete</span> : <span className="text-serious">{fmtNum(remaining)}</span>}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {canManage ? (
                            <input
                              className={`${input} w-24 text-right`}
                              name={`cost_${l.id}`}
                              type="number"
                              min="0"
                              step="any"
                              defaultValue={l.unitCost}
                            />
                          ) : (
                            <span className="tnum">{fmtCost(l.unitCost, cur)}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tnum">{fmtNum(l.item.onHand)}</td>
                        <td className="px-4 py-2 text-right">
                          {/* Blank by default: type only what actually turned up, so untouched
                              lines stay outstanding and the PO reads "Partially received". */}
                          <input
                            className={`${input} w-24 text-right`}
                            name={`recv_${l.id}`}
                            type="number"
                            min="0"
                            step="any"
                            placeholder={done ? "—" : fmtNum(remaining)}
                            disabled={done}
                            aria-label={`Quantity received for ${l.item.partNumber}`}
                          />
                        </td>
                        <td className="no-print px-4 py-2 text-right">
                          {!done && (
                            <button
                              formAction={receivePoLine}
                              name="lineId"
                              value={l.id}
                              className={`${btnGhost} whitespace-nowrap`}
                              title={`Receive just this line. Leave the box blank to take all ${fmtNum(remaining)} outstanding.`}
                            >
                              Receive line
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t p-4">
              <button className={btnPrimary}>Receive entered quantities</button>
              <button formAction={receivePoRemaining} className={btnGhost}>
                Receive all outstanding
              </button>
              {canManage && (
                <button formAction={savePoLinePrices} className={btnGhost}>
                  Save prices only
                </button>
              )}
              <span className="text-xs text-muted">
                Type what arrived and receive lines one at a time or together — anything left blank stays outstanding and
                the PO shows as partially received. On-hand increases and the ledger records each receipt.
                {canManage ? " Prices you enter update the part's cost across the dashboard." : ""}
              </span>
            </div>
          </form>
        ) : (
          /* DRAFT or CLOSED: read/edit */
          <form action={updatePoLines}>
            <input type="hidden" name="poId" value={po.id} />
            <div className="overflow-x-auto">
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
                        <div className="max-w-xs truncate text-xs text-muted">{l.item.mpn ?? l.item.name}</div>
                      </td>
                      <td className="px-4 py-2 text-right">
                        {isDraft && canManage ? (
                          <input
                            className={`${input} w-20 text-right`}
                            name={`qty_${l.id}`}
                            type="number"
                            min="0"
                            defaultValue={l.qtyOrdered}
                          />
                        ) : (
                          <span className="tnum">{fmtNum(l.qtyOrdered)}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {isDraft && canManage ? (
                          <input
                            className={`${input} w-24 text-right`}
                            name={`cost_${l.id}`}
                            type="number"
                            min="0"
                            step="any"
                            defaultValue={l.unitCost}
                          />
                        ) : (
                          <span className="tnum">
                            {fmtCost(l.unitCost, cur)}
                            {usd(l.unitCost) != null && (
                              <div className="text-xs font-normal text-muted">{fmtCost(usd(l.unitCost), "USD")}</div>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tnum">
                        {fmtMoney(l.qtyOrdered * l.unitCost, cur)}
                        {usd(l.qtyOrdered * l.unitCost) != null && (
                          <div className="text-xs font-normal text-muted">{fmtMoney(usd(l.qtyOrdered * l.unitCost), "USD")}</div>
                        )}
                      </td>
                      {closed && <td className="px-4 py-2 text-right tnum">{fmtNum(l.qtyReceived)}</td>}
                      {isDraft && canManage && (
                        <td className="no-print px-4 py-2 text-right">
                          <button
                            formAction={removePoLine}
                            name="lineId"
                            value={l.id}
                            className="text-xs text-muted hover:text-critical"
                          >
                            remove
                          </button>
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
                    <td className="px-4 py-2 text-right tnum">
                      {fmtMoney(total, cur)}
                      {usd(total) != null && (
                        <div className="text-xs font-normal text-muted">{fmtMoney(usd(total), "USD")}</div>
                      )}
                    </td>
                    {closed && <td />}
                    {isDraft && canManage && <td className="no-print" />}
                  </tr>
                </tfoot>
              </table>
            </div>
            {isDraft && canManage && (
              <div className="no-print flex items-center gap-2 border-t p-4">
                <button className={btnPrimary}>Save lines</button>
                <span className="text-xs text-muted">
                  Prices you enter update the part&apos;s cost across the dashboard.
                </span>
              </div>
            )}
          </form>
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
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-2">Unit cost</span>
                <input
                  className={`${input} w-28`}
                  name="unitCost"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="part's cost"
                />
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
        <Card title="Order actions" className="no-print">
          <div className="flex flex-wrap items-center gap-2 p-4">
            {nothingReceived && (
              <form action={returnPoToDraft}>
                <input type="hidden" name="poId" value={po.id} />
                <button className={btnGhost}>Return to draft</button>
              </form>
            )}
            <form action={cancelPo}>
              <input type="hidden" name="poId" value={po.id} />
              <button className={btnGhost}>Cancel PO</button>
            </form>
          </div>
          <p className="px-4 pb-4 text-xs text-muted">
            {nothingReceived
              ? "Nothing has arrived yet, so this order can go back to draft and have its lines changed."
              : "Part of this order has arrived, so its lines are fixed. Cancelling gives up on the outstanding balance and keeps what was received."}
          </p>
        </Card>
      )}

      {po.status === "PARTIAL" && (
        <Badge className="text-serious">Some lines still outstanding — receive the rest when it arrives.</Badge>
      )}
    </div>
  );
}
