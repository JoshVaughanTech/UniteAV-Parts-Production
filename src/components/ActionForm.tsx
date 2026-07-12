"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/actions";
import { btnPrimary } from "@/components/ui";

export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  className = "",
  submitClassName = btnPrimary,
}: {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  submitLabel?: string;
  className?: string;
  submitClassName?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      {children}
      {state && state.ok === false && <p className="text-sm text-critical">{state.error}</p>}
      {state && state.ok === true && <p className="text-sm text-good">{state.message ?? "Done."}</p>}
      <button className={submitClassName} disabled={pending}>
        {pending ? "Working…" : submitLabel}
      </button>
    </form>
  );
}
