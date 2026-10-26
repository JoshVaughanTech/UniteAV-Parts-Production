import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/rbac";
import { roleAtLeast } from "@/lib/constants";
import { upsertSupplier } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { Card, EmptyState, input } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { fmtNum } from "@/lib/format";

export default async function SuppliersPage() {
  const user = await currentUser();
  if (!roleAtLeast(user?.role, "MANAGER")) redirect("/");

  const suppliers = await prisma.supplier.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { items: true } } },
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Suppliers</h1>
          <p className="text-sm text-muted">Vendors and default lead times. Assign parts to a supplier from each part&apos;s page.</p>
        </div>
        <PrintButton label="Print suppliers" />
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="no-print lg:col-span-1">
          <Card title="Add supplier">
            <ActionForm action={upsertSupplier} submitLabel="Add supplier" className="space-y-3 p-4">
              <Field label="Name">
                <input className={input} name="name" required placeholder="e.g. Digi-Key" />
              </Field>
              <Field label="Email">
                <input className={input} name="email" type="email" placeholder="orders@vendor.com" />
              </Field>
              <Field label="Contact">
                <input className={input} name="contact" placeholder="Rep name / phone" />
              </Field>
              <Field label="Postal address">
                <textarea
                  className={`${input} min-h-20`}
                  name="address"
                  rows={3}
                  placeholder={"3 Industrial Ave\nMelbourne VIC 3000"}
                />
              </Field>
              <Field label="Default lead time (days)">
                <input className={input} name="defaultLeadTimeDays" type="number" min="0" defaultValue={14} />
              </Field>
              <label className="flex items-start gap-2 text-sm text-ink-2">
                <input type="checkbox" name="chargesGst" defaultChecked className="mt-0.5" />
                <span>
                  Charges GST
                  <span className="block text-xs text-muted">
                    Untick for an overseas supplier — their orders print no GST line.
                  </span>
                </span>
              </label>
            </ActionForm>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card title="All suppliers">
            {suppliers.length === 0 ? (
              <EmptyState title="No suppliers yet." hint="Add your first vendor on the left." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-2 font-medium">Name</th>
                      <th className="px-4 py-2 font-medium">Email</th>
                      <th className="px-4 py-2 font-medium">Address</th>
                      <th className="px-4 py-2 font-medium">GST</th>
                      <th className="px-4 py-2 text-right font-medium">Lead</th>
                      <th className="px-4 py-2 text-right font-medium">Parts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.map((s) => (
                      <tr key={s.id} className="border-b last:border-0 hover:bg-surface-2">
                        <td className="px-4 py-2 font-medium text-ink">{s.name}</td>
                        <td className="px-4 py-2 text-ink-2">{s.email ?? "—"}</td>
                        <td className="px-4 py-2 text-ink-2">
                          {s.address ? (
                            <span className="text-xs">{s.address.split("\n")[0]}</span>
                          ) : (
                            <span className="text-xs text-serious">missing</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs text-ink-2">{s.chargesGst ? "yes" : "no — overseas"}</td>
                        <td className="px-4 py-2 text-right tnum">{s.defaultLeadTimeDays}d</td>
                        <td className="px-4 py-2 text-right tnum">{fmtNum(s._count.items)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Existing suppliers had no edit path at all, so there was nowhere to put the
              address a purchase order has to be sent to. One form each, folded away. */}
          {suppliers.length > 0 && (
            <Card title="Edit a supplier" className="no-print mt-6">
              <p className="px-4 pt-4 text-sm text-muted">
                A supplier with no address prints an order with nowhere to send it.
              </p>
              <ul className="divide-y">
                {suppliers.map((s) => (
                  <li key={s.id}>
                    <details>
                      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink hover:bg-surface-2">
                        {s.name}
                        {!s.address && <span className="ml-2 text-xs font-normal text-serious">no address</span>}
                      </summary>
                      <ActionForm action={upsertSupplier} submitLabel="Save supplier" className="space-y-3 px-4 pb-4">
                        <input type="hidden" name="id" value={s.id} />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label="Name">
                            <input className={input} name="name" required defaultValue={s.name} />
                          </Field>
                          <Field label="Email">
                            <input className={input} name="email" type="email" defaultValue={s.email ?? ""} />
                          </Field>
                          <Field label="Contact">
                            <input className={input} name="contact" defaultValue={s.contact ?? ""} />
                          </Field>
                          <Field label="Default lead time (days)">
                            <input
                              className={input}
                              name="defaultLeadTimeDays"
                              type="number"
                              min="0"
                              defaultValue={s.defaultLeadTimeDays}
                            />
                          </Field>
                        </div>
                        <Field label="Postal address">
                          <textarea
                            className={`${input} min-h-20`}
                            name="address"
                            rows={3}
                            defaultValue={s.address ?? ""}
                            placeholder={"3 Industrial Ave\nMelbourne VIC 3000"}
                          />
                        </Field>
                        <label className="flex items-start gap-2 text-sm text-ink-2">
                          <input type="checkbox" name="chargesGst" defaultChecked={s.chargesGst} className="mt-0.5" />
                          <span>
                            Charges GST
                            <span className="block text-xs text-muted">
                              Untick for an overseas supplier — their orders print no GST line.
                            </span>
                          </span>
                        </label>
                      </ActionForm>
                    </details>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
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
