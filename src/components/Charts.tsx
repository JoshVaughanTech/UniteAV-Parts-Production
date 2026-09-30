import { fmtNum } from "@/lib/format";

/**
 * Server-rendered charts, built from plain HTML so they reflow at any width, inherit the
 * theme tokens (so dark mode needs no second palette), and ship no client JavaScript.
 * Hover text rides on `title`, which the browser renders natively.
 *
 * Colours come from the app's validated token set. The status trio below was run through
 * the palette validator in both light and dark: red / neutral / green passes the CVD,
 * normal-vision and contrast checks, and the neutral deliberately reads gray because it
 * means "not assessed" — every segment is labelled, so identity never rests on colour.
 */

export interface Segment {
  label: string;
  value: number;
  /** A CSS colour — a token var, not a literal. */
  color: string;
  hint?: string;
}

/**
 * One bar showing how a whole divides up. Segments carry a 2px surface gap so they read as
 * separate marks, and only the outer ends round.
 */
export function StackedShare({ segments, total, unit }: { segments: Segment[]; total: number; unit: string }) {
  const shown = segments.filter((s) => s.value > 0);
  if (total <= 0 || shown.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted">Nothing to show yet.</p>;
  }

  return (
    <div className="space-y-3 px-4 py-4">
      <div className="flex h-7 gap-0.5 overflow-hidden" role="img" aria-label={`${unit} by state`}>
        {shown.map((s, i) => {
          const pct = (s.value / total) * 100;
          return (
            <div
              key={s.label}
              // Minimum width keeps a tiny slice visible and hoverable rather than vanishing.
              style={{ flexGrow: s.value, flexBasis: 0, minWidth: "0.5rem", background: s.color }}
              className={`${i === 0 ? "rounded-l" : ""} ${i === shown.length - 1 ? "rounded-r" : ""}`}
              title={`${s.label}: ${fmtNum(s.value)} ${unit} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
        {shown.map((s) => (
          <li key={s.label} className="flex items-baseline gap-1.5 text-xs">
            <span
              className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: s.color }}
              aria-hidden
            />
            <span className="text-ink-2">{s.label}</span>
            <span className="font-semibold tnum text-ink">{fmtNum(s.value)}</span>
            <span className="tnum text-muted">{((s.value / total) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>

      {shown.some((s) => s.hint) && (
        <p className="text-xs text-muted">{shown.find((s) => s.hint)?.hint}</p>
      )}
    </div>
  );
}

export interface BarRow {
  label: string;
  value: number;
  /** Printed at the end of the bar. Falls back to the formatted number. */
  display?: string;
  sub?: string;
  /** Overrides the series hue — for an aggregate row like "Other", which is not a
   *  category of its own and should not compete with the real ones. */
  color?: string;
}

/**
 * Horizontal bars for a magnitude comparison. One series, so one hue and no legend — the
 * card title names the measure. Bars anchor at the left and round only their data end.
 */
export function BarList({
  rows,
  color = "var(--brand)",
  labelWidth = "w-32",
  emptyHint,
}: {
  rows: BarRow[];
  color?: string;
  /** Widen it when the labels are long — they truncate with a tooltip rather than wrap. */
  labelWidth?: string;
  emptyHint?: string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  if (rows.length === 0 || max <= 0) {
    return <p className="px-4 py-6 text-sm text-muted">{emptyHint ?? "Nothing to show yet."}</p>;
  }

  return (
    <ul className="space-y-1.5 px-4 py-4">
      {rows.map((r) => {
        const pct = (r.value / max) * 100;
        const text = r.display ?? fmtNum(r.value);
        return (
          <li key={r.label} className="flex items-center gap-3 text-sm" title={`${r.label}: ${text}`}>
            <span className={`${labelWidth} shrink-0 truncate text-ink-2`} title={r.label}>
              {r.label}
            </span>
            {/* Track keeps every bar on the same scale; it is also the only grid line.
                The fill is square at the baseline it grows from and rounded at its data end. */}
            <span className="relative h-4 min-w-0 flex-1 rounded-[4px] bg-surface-2">
              <span
                className="absolute inset-y-0 left-0 rounded-r-[4px]"
                style={{ width: `${Math.max(pct, 0.75)}%`, background: r.color ?? color }}
              />
            </span>
            <span className="w-24 shrink-0 text-right tnum font-medium text-ink">{text}</span>
            {r.sub && <span className="w-14 shrink-0 text-right text-xs tnum text-muted">{r.sub}</span>}
          </li>
        );
      })}
    </ul>
  );
}
