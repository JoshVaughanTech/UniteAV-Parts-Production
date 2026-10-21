import Link from "next/link";
import type { PartStatus } from "@/lib/reorder";
import { STATUS_META } from "@/lib/reorder";

export function Card({
  children,
  className = "",
  title,
  actions,
}: {
  children: React.ReactNode;
  className?: string;
  title?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className={`rounded-xl border bg-surface ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
  href,
  title,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
  href?: string;
  title?: string;
}) {
  const toneColor =
    tone === "bad" ? "text-critical" : tone === "warn" ? "text-serious" : tone === "good" ? "text-good" : "text-ink";
  const inner = (
    <div
      className="rounded-xl border bg-surface px-3 py-3.5 transition-colors hover:border-brand/40 sm:px-4"
      title={title}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      {/* Two tiles across a 360px phone leave about 134px inside one. A money figure at
          text-2xl needs 170px and pushed the whole page wider than the screen, so it is a
          step smaller there and wraps rather than overflowing. */}
      <div className={`mt-1.5 break-words text-xl font-semibold tnum sm:text-2xl ${toneColor}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-2">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

const TONE_CLASSES: Record<string, string> = {
  ok: "text-good",
  warn: "text-serious",
  bad: "text-critical",
  muted: "text-muted",
  info: "text-brand",
};
const TONE_DOT: Record<string, string> = {
  ok: "bg-good",
  warn: "bg-warn",
  bad: "bg-critical",
  muted: "bg-muted",
  info: "bg-brand",
};

/** Status pill — always carries an icon (dot) + text label, never color alone. */
export function StatusBadge({ status }: { status: PartStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[meta.tone]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[meta.tone]}`} aria-hidden />
      {meta.label}
    </span>
  );
}

export function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-md border bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2 ${className}`}>
      {children}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}

// Button style helpers (shared by links + form buttons).
export const btn =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
export const btnPrimary = `${btn} border-transparent bg-brand text-white hover:opacity-90`;
export const btnGhost = `${btn} bg-surface text-ink hover:bg-surface-2`;
export const input =
  "w-full rounded-lg border bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
