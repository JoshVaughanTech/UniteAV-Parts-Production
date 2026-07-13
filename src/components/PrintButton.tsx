"use client";

import { btnGhost } from "@/components/ui";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={`${btnGhost} no-print`}>
      <span aria-hidden>🖨</span> {label}
    </button>
  );
}
