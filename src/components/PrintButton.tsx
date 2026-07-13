"use client";

import { btnGhost } from "@/components/ui";

export function PrintButton({ label = "Print" }: { label?: string }) {
  function print() {
    // Expand any collapsed <details> (e.g. product boards) so the full list prints.
    document.querySelectorAll("details").forEach((d) => (d.open = true));
    window.print();
  }
  return (
    <button type="button" onClick={print} className={`${btnGhost} no-print`}>
      <span aria-hidden>🖨</span> {label}
    </button>
  );
}
