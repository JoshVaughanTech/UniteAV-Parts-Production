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
              <Field label="Default lead time (days)">
                <input className={input} name="defaultLeadTimeDays" type="number" min="0" defaultValue={14} />
              </Field>
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
                      <th className="px-4 py-2 text-right font-medium">Lead</th>
                      <th className="px-4 py-2 text-right font-medium">Parts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.map((s) => (
                      <tr key={s.id} className="border-b last:border-0 hover:bg-surface-2">
                        <td className="px-4 py-2 font-medium text-ink">{s.name}</td>
                        <td className="px-4 py-2 text-ink-2">{s.email ?? "—"}</td>
                        <td className="px-4 py-2 text-right tnum">{s.defaultLeadTimeDays}d</td>
                        <td className="px-4 py-2 text-right tnum">{fmtNum(s._count.items)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
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
