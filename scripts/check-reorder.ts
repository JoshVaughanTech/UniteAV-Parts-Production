import { computeReorder } from "@/lib/reorder";

const cases: { name: string; i: Parameters<typeof computeReorder>[0]; expect: string }[] = [
  { name: "zero, no lead time", i: { onHand: 0, adu: 0, leadTimeDays: null, safetyStock: 0, minPackQty: 10, reviewPeriodDays: 7 }, expect: "OUT" },
  { name: "below zero, no lead time", i: { onHand: -5, adu: 0, leadTimeDays: null, safetyStock: 0, minPackQty: 1, reviewPeriodDays: 7 }, expect: "OUT" },
  { name: "positive, no lead time", i: { onHand: 100, adu: 0, leadTimeDays: null, safetyStock: 0, minPackQty: 1, reviewPeriodDays: 7 }, expect: "NO_LEADTIME" },
  { name: "below safety, no lead time", i: { onHand: 5, adu: 0, leadTimeDays: null, safetyStock: 10, minPackQty: 1, reviewPeriodDays: 7 }, expect: "REORDER" },
  { name: "zero, with lead time", i: { onHand: 0, adu: 2, leadTimeDays: 14, safetyStock: 50, minPackQty: 100, reviewPeriodDays: 7 }, expect: "OUT" },
];

let pass = true;
for (const c of cases) {
  const r = computeReorder(c.i);
  const ok = r.status === c.expect && (c.expect === "NO_LEADTIME" ? r.suggestedOrderQty === 0 : r.suggestedOrderQty > 0);
  if (!ok) pass = false;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name.padEnd(26)} status=${r.status} suggested=${r.suggestedOrderQty}`);
}
process.exit(pass ? 0 : 1);
