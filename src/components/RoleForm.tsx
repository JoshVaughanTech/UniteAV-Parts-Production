"use client";

import { useActionState } from "react";
import { setUserRole, type ActionResult } from "@/lib/actions";
import { ROLES } from "@/lib/constants";
import { input } from "@/components/ui";

export function RoleForm({ userId, role }: { userId: string; role: string }) {
  const [, formAction, pending] = useActionState(setUserRole, null);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <select name="role" defaultValue={role} className={`${input} w-32 py-1`} disabled={pending}>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r.charAt(0) + r.slice(1).toLowerCase()}
          </option>
        ))}
      </select>
      <button className="text-xs font-medium text-brand hover:underline disabled:opacity-50" disabled={pending}>
        {pending ? "…" : "Update"}
      </button>
    </form>
  );
}
