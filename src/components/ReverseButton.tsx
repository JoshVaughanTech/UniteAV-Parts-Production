"use client";

import { useActionState } from "react";
import { reverseProduction, type ActionResult } from "@/lib/actions";

export function ReverseButton({ logId }: { logId: string }) {
  const [state, formAction, pending] = useActionState(reverseProduction, null);
  return (
    <form action={formAction}>
      <input type="hidden" name="logId" value={logId} />
      <button
        className="text-xs font-medium text-ink-2 hover:text-critical disabled:opacity-50"
        disabled={pending}
        title="Reverse this entry and restore consumed stock"
      >
        {pending ? "…" : "Reverse"}
      </button>
      {state && state.ok === false && <span className="ml-2 text-xs text-critical">{state.error}</span>}
    </form>
  );
}
