import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/rbac";
import { roleAtLeast, ROLES } from "@/lib/constants";
import { getSettings } from "@/lib/metrics";
import { updateSettings, createUser } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { RoleForm } from "@/components/RoleForm";
import { Card, EmptyState, Badge, input } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export default async function SettingsPage() {
  const user = await currentUser();
  if (!roleAtLeast(user?.role, "ADMIN")) redirect("/");

  const [settings, users] = await Promise.all([
    getSettings(),
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Settings &amp; Users</h1>
        <p className="text-sm text-muted">Reorder policy defaults and user access.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Reorder policy">
          <ActionForm action={updateSettings} submitLabel="Save settings" className="space-y-3 p-4">
            <Field label="Usage averaging window (days)" hint="How far back to average daily part usage.">
              <input className={input} name="usageWindowDays" type="number" min="1" defaultValue={settings.usageWindowDays} />
            </Field>
            <Field label="Review period (days)" hint="Extra cover added to each suggested order quantity.">
              <input className={input} name="reviewPeriodDays" type="number" min="1" defaultValue={settings.reviewPeriodDays} />
            </Field>
            <Field label="Default safety-stock (days)" hint="Guidance for new parts (set per-part on the part page).">
              <input
                className={input}
                name="defaultSafetyStockDays"
                type="number"
                min="0"
                defaultValue={settings.defaultSafetyStockDays}
              />
            </Field>
            <Field label="Currency" hint="Display currency for costs and inventory value.">
              <select className={input} name="currency" defaultValue={settings.currency}>
                {["AUD", "USD", "EUR", "GBP", "NZD"].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </ActionForm>
        </Card>

        <Card title="Add user">
          <ActionForm action={createUser} submitLabel="Create user" className="space-y-3 p-4">
            <Field label="Email">
              <input className={input} name="email" type="email" required />
            </Field>
            <Field label="Name">
              <input className={input} name="name" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Role">
                <select className={input} name="role" defaultValue="OPERATOR">
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r.charAt(0) + r.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Temp password">
                <input className={input} name="password" type="text" minLength={6} required />
              </Field>
            </div>
          </ActionForm>
        </Card>
      </div>

      <Card title="Users">
        {users.length === 0 ? (
          <EmptyState title="No users." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-medium">User</th>
                <th className="px-4 py-2 font-medium">Created</th>
                <th className="px-4 py-2 font-medium">Role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="px-4 py-2">
                    <div className="font-medium text-ink">{u.name || u.email}</div>
                    <div className="text-xs text-muted">{u.email}</div>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted">{fmtDate(u.createdAt)}</td>
                  <td className="px-4 py-2">
                    {u.id === user?.id ? (
                      <Badge>{u.role.charAt(0) + u.role.slice(1).toLowerCase()} (you)</Badge>
                    ) : (
                      <RoleForm userId={u.id} role={u.role} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
