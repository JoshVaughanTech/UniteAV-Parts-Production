/**
 * Check the reorder status rules, in particular the two that were hiding parts.
 *
 * A part that a planned run needs more of than is on the shelf has to be flagged, whatever
 * its usage history says — most of this catalogue has no supplier and no lead time, so the
 * forecast has no opinion on it at all. And "on order" has to mean the gap is covered, not
 * merely that something is coming, or a part sitting at zero disappears behind a purchase
 * order for ten of them.
 *
 *   npx tsx scripts/verify-reorder.ts
 */
import { computeReorder, type ReorderInputs } from "@/lib/reorder";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`}`);
}

/** A part as most of this catalogue looks: no supplier, no lead time, no safety stock. */
function bare(over: Partial<ReorderInputs> = {}): ReorderInputs {
  return {
    onHand: 100,
    adu: 0,
    leadTimeDays: null,
    safetyStock: 0,
    minPackQty: 1,
    reviewPeriodDays: 7,
    ...over,
  };
}

console.log("\nWithout any committed run, nothing changes");
check("no lead time and no reorder point still has no opinion", computeReorder(bare()).status, "NO_LEADTIME");
check("zero on hand is still out", computeReorder(bare({ onHand: 0 })).status, "OUT");
check("a lead time still drives the forecast", computeReorder(bare({ onHand: 100, adu: 10, leadTimeDays: 5 })).status, "OK");
check(
  "and still flags a part under its reorder point",
  computeReorder(bare({ onHand: 40, adu: 10, leadTimeDays: 5 })).status,
  "REORDER",
);

console.log("\nA planned run outranks the forecast");
// RESS-00779 as it stands: 1 on hand, a run needs 720, no supplier, no history.
const runShort = computeReorder(bare({ onHand: 1, committed: 720 }));
check("a part a run is short of is flagged, not left as NO_LEADTIME", runShort.status, "REORDER");
check("the shortfall is the gap between the run and the shelf", runShort.shortForRuns, 719);
check("the suggestion covers the whole shortfall", runShort.suggestedOrderQty, 719);
check(
  "a part the runs are fully covered for is not flagged",
  computeReorder(bare({ onHand: 1000, committed: 720 })).status,
  "NO_LEADTIME",
);
check("covered means no shortfall", computeReorder(bare({ onHand: 1000, committed: 720 })).shortForRuns, 0);
check(
  "exactly enough is enough",
  computeReorder(bare({ onHand: 720, committed: 720 })).shortForRuns,
  0,
);
check(
  "a run beats an otherwise healthy forecast",
  computeReorder(bare({ onHand: 100, adu: 1, leadTimeDays: 5, committed: 900 })).status,
  "REORDER",
);

console.log("\nThe suggested order respects packs and the forecast");
check(
  "the shortfall is rounded up to a whole pack",
  computeReorder(bare({ onHand: 1, committed: 720, minPackQty: 100 })).suggestedOrderQty,
  800,
);
check(
  "a bigger forecast need wins over a smaller run shortfall",
  // rop = 10*5 + 0 = 50, target = 50 + 10*7 = 120, so 120-10 = 110 beats a shortfall of 5.
  computeReorder(bare({ onHand: 10, adu: 10, leadTimeDays: 5, committed: 15 })).suggestedOrderQty,
  110,
);

console.log("\nThe level stock has to reach");
check("with no run, it is the reorder point", computeReorder(bare({ onHand: 100, adu: 10, leadTimeDays: 5 })).requirement, 50);
check("with a bigger run, it is the run", computeReorder(bare({ onHand: 100, adu: 10, leadTimeDays: 5, committed: 900 })).requirement, 900);
check("with no lead time and no run, it is zero", computeReorder(bare()).requirement, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
