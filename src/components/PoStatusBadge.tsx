const TONE: Record<string, { label: string; cls: string; dot: string }> = {
  DRAFT: { label: "Draft", cls: "text-ink-2", dot: "bg-muted" },
  ORDERED: { label: "Ordered", cls: "text-brand", dot: "bg-brand" },
  PARTIAL: { label: "Partially received", cls: "text-serious", dot: "bg-warn" },
  RECEIVED: { label: "Received", cls: "text-good", dot: "bg-good" },
  CANCELLED: { label: "Cancelled", cls: "text-muted", dot: "bg-muted" },
};

export function PoStatusBadge({ status }: { status: string }) {
  const t = TONE[status] ?? TONE.DRAFT;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${t.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} aria-hidden />
      {t.label}
    </span>
  );
}
