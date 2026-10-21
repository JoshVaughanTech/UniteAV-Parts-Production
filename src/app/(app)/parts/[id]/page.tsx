import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getPartRow, getSettings } from "@/lib/metrics";
import { currentUser } from "@/lib/rbac";
import { roleAtLeast } from "@/lib/constants";
import { updatePart, receiveStock } from "@/lib/actions";
import { updatePartDetails } from "@/lib/part-actions";
import { ActionForm } from "@/components/ActionForm";
import { Card, StatTile, StatusBadge, Badge, EmptyState, input } from "@/components/ui";
import { BackLink } from "@/components/ListMemory";
import { DeleteItemButton } from "@/components/DeleteItemButton";
import { fmtNum, fmtCost, fmtDate } from "@/lib/format";

export default async function PartDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [p, settings, user, suppliers, item, priceHistory] = await Promise.all([
    getPartRow(id),
    getSettings(),
    currentUser(),
    prisma.supplier.findMany({ orderBy: { name: "asc" } }),
    prisma.item.findUnique({
      where: { id },
      include: {
        bomChildren: { include: { parent: { select: { id: true, name: true, partNumber: true } } } },
        invTxns: { orderBy: { createdAt: "desc" }, take: 12 },
      },
    }),
    prisma.priceHistory.findMany({
      where: { itemId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { user: { select: { name: true, email: true } } },
    }),
  ]);
  if (!item) notFound();
  const canEdit = roleAtLeast(user?.role, "MANAGER");
  const canReceive = roleAtLeast(user?.role, "OPERATOR");
  const canDelete = roleAtLeast(user?.role, "ADMIN");

  return (
    <div className="space-y-6">
      <header>
        <BackLink href="/parts" className="text-xs text-muted hover:text-brand">
          ← Parts
        </BackLink>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-xl font-semibold text-ink">{item.partNumber}</h1>
          {p && <StatusBadge status={p.reorder.status} />}
          {!item.active && <Badge className="text-serious">Archived</Badge>}
          {canDelete && (
            <span className="no-print ml-auto">
              <DeleteItemButton
                itemId={item.id}
                label="Delete part"
                currency={settings.currency}
                redirectTo="/parts"
              />
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-ink-2">{item.name}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.category && <Badge>{item.category}</Badge>}
          {item.value && <Badge>{item.value}</Badge>}
          {item.footprint && <Badge>{item.footprint}</Badge>}
          {item.mpn && <Badge>{item.manufacturer ? `${item.manufacturer} · ` : ""}{item.mpn}</Badge>}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="On hand"
          value={fmtNum(item.onHand)}
          tone={p && p.reorder.status !== "OK" && p.reorder.status !== "ON_ORDER" ? "bad" : "default"}
          hint={p && p.onOrderQty > 0 ? `+${fmtNum(p.onOrderQty)} on order` : undefined}
        />
        <StatTile
          label="Reorder point"
          value={p ? fmtNum(p.reorder.rop, 1) : "—"}
          hint="avg daily use × lead + safety"
          title="Reorder point = avg daily use × lead time + safety stock. Reorder when on-hand drops to this."
        />
        <StatTile
          label="Avg daily use"
          value={p && p.adu > 0 ? fmtNum(p.adu, 2) : "—"}
          hint={`${settings.usageWindowDays}-day avg`}
          title="Average daily use — parts consumed by builds over the usage window ÷ days."
        />
        <StatTile
          label="Suggested order"
          value={p ? fmtNum(p.reorder.suggestedOrderQty) : "—"}
          tone={p && p.reorder.suggestedOrderQty > 0 ? "warn" : "default"}
        />
      </div>

      {canEdit && (
        <Card title="Details" className="no-print">
          <ActionForm action={updatePartDetails} submitLabel="Save details" className="space-y-3 p-4">
            <input type="hidden" name="itemId" value={item.id} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Description">
                <input className={input} name="name" defaultValue={item.name} required />
              </Field>
              <Field label="Value / comment">
                <input className={input} name="value" defaultValue={item.value ?? ""} />
              </Field>
              <Field label="Footprint">
                <input className={input} name="footprint" defaultValue={item.footprint ?? ""} />
              </Field>
              <Field label="Manufacturer">
                <input className={input} name="manufacturer" defaultValue={item.manufacturer ?? ""} />
              </Field>
              <Field label="Manufacturer part no.">
                <input className={input} name="mpn" defaultValue={item.mpn ?? ""} />
              </Field>
              <Field label="Unit">
                <input className={input} name="uom" defaultValue={item.uom} />
              </Field>
              <Field label="Notes">
                <input className={input} name="notes" defaultValue={item.notes ?? ""} />
              </Field>
            </div>
            <p className="text-xs text-muted">
              Description, value, footprint, manufacturer and MPN come from the BOM sheets and are refreshed whenever a
              BOM carrying this part is imported. Unit and notes are app-only and always stay.
            </p>
          </ActionForm>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Planning fields */}
        <Card title="Planning">
          {canEdit ? (
            <ActionForm action={updatePart} submitLabel="Save planning" className="space-y-3 p-4">
              <input type="hidden" name="itemId" value={item.id} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Lead time (days)">
                  <input className={input} name="leadTimeDays" type="number" min="0" defaultValue={item.leadTimeDays ?? ""} />
                </Field>
                <Field label="Safety stock">
                  <input className={input} name="safetyStock" type="number" min="0" step="any" defaultValue={item.safetyStock} />
                </Field>
                <Field label="Pack / MOQ">
                  <input className={input} name="minPackQty" type="number" min="1" step="any" defaultValue={item.minPackQty} />
                </Field>
                <Field label="Unit cost">
                  <input className={input} name="unitCost" type="number" min="0" step="any" defaultValue={item.unitCost ?? ""} />
                </Field>
              </div>
              <Field label="Supplier">
                {/* Keyed so the form reset after a save lands on the saved supplier rather
                    than the one this select mounted with. */}
                <select
                  key={item.supplierId ?? "unassigned"}
                  className={input}
                  name="supplierId"
                  defaultValue={item.supplierId ?? ""}
                >
                  <option value="">— Unassigned —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            </ActionForm>
          ) : (
            <dl className="grid grid-cols-2 gap-3 p-4 text-sm">
              <Info label="Lead time" value={item.leadTimeDays == null ? "—" : `${item.leadTimeDays} days`} />
              <Info label="Safety stock" value={fmtNum(item.safetyStock)} />
              <Info label="Pack / MOQ" value={fmtNum(item.minPackQty)} />
              <Info label="Unit cost" value={item.unitCost == null ? "—" : fmtCost(item.unitCost, settings.currency)} />
              <Info label="Supplier" value={p?.supplierName ?? "—"} />
            </dl>
          )}
        </Card>

        {/* Stock movement */}
        <Card title="Adjust stock">
          {canReceive ? (
            <ActionForm action={receiveStock} submitLabel="Apply" className="space-y-3 p-4">
              <input type="hidden" name="itemId" value={item.id} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Action">
                  <select className={input} name="mode" defaultValue="RECEIPT">
                    <option value="RECEIPT">Receive (add)</option>
                    <option value="ADJUSTMENT">Adjust (+/−)</option>
                    <option value="COUNT">Set count to…</option>
                  </select>
                </Field>
                <Field label="Quantity">
                  <input className={input} name="qty" type="number" step="any" defaultValue={0} />
                </Field>
              </div>
              <Field label="Note (optional)">
                <input className={input} name="note" placeholder="PO #, count reason…" />
              </Field>
            </ActionForm>
          ) : (
            <EmptyState title="View only" hint="Operator role or higher can adjust stock." />
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Used in ${item.bomChildren.length} product(s)`}>
          {item.bomChildren.length === 0 ? (
            <EmptyState title="Not used on any BOM." />
          ) : (
            <ul className="divide-y">
              {item.bomChildren.map((bl) => (
                <li key={bl.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <Link href={`/products/${bl.parent.id}`} className="text-ink hover:text-brand">
                    {bl.parent.name}
                  </Link>
                  <span className="tnum text-muted">{fmtNum(bl.qtyPer)} / unit</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Price history">
          {priceHistory.length === 0 ? (
            <EmptyState
              title="No price changes recorded yet."
              hint="Prices update here from PO pricing, part edits, and BOM imports."
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 text-right font-medium">Price</th>
                  <th className="px-4 py-2 text-right font-medium">Change</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {priceHistory.map((h) => {
                  const delta = h.previousCost == null ? null : h.unitCost - h.previousCost;
                  const pct =
                    h.previousCost != null && h.previousCost > 0
                      ? ((h.unitCost - h.previousCost) / h.previousCost) * 100
                      : null;
                  return (
                    <tr key={h.id} className="border-b last:border-0">
                      <td className="px-4 py-2 text-xs text-muted">{fmtDate(h.createdAt)}</td>
                      <td className="px-4 py-2 text-right tnum font-medium">
                        {fmtCost(h.unitCost, settings.currency)}
                      </td>
                      <td
                        className={`px-4 py-2 text-right tnum ${
                          delta == null || delta === 0 ? "text-muted" : delta > 0 ? "text-critical" : "text-good"
                        }`}
                      >
                        {delta == null
                          ? "first price"
                          : `${delta > 0 ? "▲" : "▼"} ${fmtCost(Math.abs(delta), settings.currency)}${
                              pct != null ? ` (${pct > 0 ? "+" : ""}${pct.toFixed(0)}%)` : ""
                            }`}
                      </td>
                      <td className="px-4 py-2 text-ink-2">
                        {h.note ?? "—"}
                        {h.user && <span className="text-xs text-muted"> · {h.user.name ?? h.user.email}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Recent movements">
          {item.invTxns.length === 0 ? (
            <EmptyState title="No inventory movements yet." />
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {item.invTxns.map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="px-4 py-2 text-xs text-muted">{fmtDate(t.createdAt)}</td>
                    <td className="px-4 py-2 text-ink-2">{t.type.replace("_", " ").toLowerCase()}</td>
                    <td className={`px-4 py-2 text-right tnum font-medium ${t.qtyDelta < 0 ? "text-critical" : "text-good"}`}>
                      {t.qtyDelta > 0 ? "+" : ""}
                      {fmtNum(t.qtyDelta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
