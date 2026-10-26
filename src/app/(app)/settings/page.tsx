import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/rbac";
import { roleAtLeast, ROLES } from "@/lib/constants";
import { getSettings } from "@/lib/metrics";
import {
  updateSettings,
  updateCompanyDetails,
  createUser,
  sendReorderDigestNow,
  updateAutoOrderSettings,
  runAutoOrderNow,
} from "@/lib/actions";
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

      <Card title="Company details">
        <ActionForm action={updateCompanyDetails} submitLabel="Save company details" className="space-y-3 p-4">
          <p className="text-sm text-muted">
            What a supplier reads on a purchase order. Until these are filled in, an order goes out with no letterhead
            — the document itself says so rather than printing a blank header.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Business name" hint="The legal entity that is placing the order.">
              <input className={input} name="companyName" defaultValue={settings.companyName ?? ""} placeholder="Unite AV Pty Ltd" />
            </Field>
            <Field label="ABN">
              <input className={input} name="companyAbn" defaultValue={settings.companyAbn ?? ""} placeholder="00 000 000 000" />
            </Field>
            <Field label="Phone">
              <input className={input} name="companyPhone" defaultValue={settings.companyPhone ?? ""} placeholder="+61 3 0000 0000" />
            </Field>
            <Field label="Orders email" hint="Where the supplier replies about the order.">
              <input className={input} name="companyEmail" type="email" defaultValue={settings.companyEmail ?? ""} />
            </Field>
          </div>
          <Field label="Business address" hint="One line per line — printed as typed.">
            <textarea
              className={`${input} min-h-20`}
              name="companyAddress"
              rows={3}
              defaultValue={settings.companyAddress ?? ""}
              placeholder={"12 Example St\nSuburb VIC 3000\nAustralia"}
            />
          </Field>
          <Field label="Deliver to" hint="Leave blank to use the business address. Add dock or hours notes here.">
            <textarea
              className={`${input} min-h-20`}
              name="deliverTo"
              rows={3}
              defaultValue={settings.deliverTo ?? ""}
              placeholder={"Rear dock, 12 Example St\nReceiving hours 9–4 Mon–Fri"}
            />
          </Field>
          <Field label="Order terms" hint="Printed at the foot of every purchase order.">
            <textarea
              className={`${input} min-h-20`}
              name="poTerms"
              rows={2}
              defaultValue={settings.poTerms ?? ""}
              placeholder="30 days from invoice. Please quote the order number on all invoices and delivery dockets."
            />
          </Field>
          <Field label="GST rate" hint="0.1 for 10%. Applied only to suppliers marked as charging GST.">
            <input
              className={input}
              name="gstRate"
              type="number"
              min="0"
              max="1"
              step="0.01"
              defaultValue={settings.gstRate}
            />
          </Field>
        </ActionForm>
      </Card>

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
            <Field
              label="Fallback USD rate"
              hint={`USD per 1 ${settings.currency}. A new PO fetches the day's rate and freezes it; this is only used when that fetch fails.`}
            >
              <input
                className={input}
                name="usdRateFallback"
                type="number"
                min="0.01"
                step="0.0001"
                defaultValue={settings.usdRateFallback}
              />
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

      <Card title="Auto-ordering (approval gate)">
        <div className="space-y-4 p-4">
          <p className="text-sm text-ink-2">
            When enabled, the daily job auto-creates purchase orders for low parts, grouped by supplier. POs at or under
            your approval limit are <strong>auto-ordered</strong>; larger ones are left as <strong>drafts awaiting
            approval</strong>. Only parts with an assigned supplier are auto-ordered, and nothing already on an open PO
            is re-ordered.
          </p>
          <ActionForm action={updateAutoOrderSettings} submitLabel="Save auto-ordering" className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input type="checkbox" name="autoOrderEnabled" defaultChecked={settings.autoOrderEnabled} className="h-4 w-4" />
              Enable automatic ordering
            </label>
            <Field label={`Auto-approve limit in ${settings.currency} (POs at or under this are ordered automatically)`}>
              <input
                className={input}
                name="autoApproveLimit"
                type="number"
                min="0"
                step="any"
                defaultValue={settings.autoApproveLimit}
              />
            </Field>
          </ActionForm>
          <div className="border-t pt-3">
            <ActionForm action={runAutoOrderNow} submitLabel="Run auto-order now">
              <></>
            </ActionForm>
            <p className="mt-1 text-xs text-muted">
              Runs the engine immediately (for testing). Supplier emails deliver once a verified sending domain is set;
              until then, POs are still created and marked for you to send.
            </p>
          </div>
        </div>
      </Card>

      <Card title="Reorder email alerts">
        <div className="space-y-3 p-4 text-sm">
          <p className="text-ink-2">
            A digest of parts to reorder is emailed automatically once a day (~8am AEST) to all Admins and Managers, and
            whenever you click below. Nothing is sent when there&apos;s nothing to reorder.
          </p>
          <p className="text-xs text-muted">
            To enable sending, add <code className="rounded bg-surface-2 px-1">RESEND_API_KEY</code> (and optionally{" "}
            <code className="rounded bg-surface-2 px-1">RESEND_FROM</code>,{" "}
            <code className="rounded bg-surface-2 px-1">ALERT_EMAILS</code>,{" "}
            <code className="rounded bg-surface-2 px-1">CRON_SECRET</code>) in Vercel → Settings → Environment Variables.
          </p>
          <ActionForm action={sendReorderDigestNow} submitLabel="Send digest now">
            <></>
          </ActionForm>
        </div>
      </Card>

      <Card title="Users">
        {users.length === 0 ? (
          <EmptyState title="No users." />
        ) : (
          <div className="overflow-x-auto">
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
          </div>
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
