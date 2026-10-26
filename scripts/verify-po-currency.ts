/**
 * Check the two directions money travels when an order is placed in a foreign currency.
 *
 * A part's cost is held in the home currency because every valuation reads it — inventory
 * value, BOM cost, reorder suggestions. A line on a US supplier's order is in US dollars.
 * Getting the direction wrong in either place is silent: nothing errors, the BOM is simply
 * out by a third and stays that way.
 *
 *   npx tsx scripts/verify-po-currency.ts
 */
import { toOrderCurrency, toHomeCurrency } from "@/lib/po-create";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`}`);
}
function near(label: string, actual: number, expected: number, tol = 1e-9) {
  const ok = Math.abs(actual - expected) < tol;
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got ${actual}, wanted ${expected}`}`);
}

// AUD is home. A US order is priced in USD, and 1 USD is worth about 1.43 AUD.
const USD_TO_AUD = 1.4286;

console.log("\nA home-currency order converts to itself");
check("an AUD cost on an AUD order is unchanged", toOrderCurrency(84.2, 1), 84.2);
check("an AUD line price writes back unchanged", toHomeCurrency(84.2, 1), 84.2);

console.log("\nSeeding a US order from parts costed in AUD");
// A part the system values at A$26.35 should appear on a Digikey order at about US$18.44.
near("an AUD part cost becomes a USD line price", toOrderCurrency(26.35, USD_TO_AUD), 26.35 / USD_TO_AUD);
near("and it is the smaller number", toOrderCurrency(26.35, USD_TO_AUD), 18.4446, 0.001);

console.log("\nA USD price typed on the order writes back as AUD");
// This is the one that matters: USD 18.44 must not land in Item.unitCost as 18.44.
near("a USD line price becomes an AUD part cost", toHomeCurrency(18.44, USD_TO_AUD), 18.44 * USD_TO_AUD);
near("and it is the larger number", toHomeCurrency(18.44, USD_TO_AUD), 26.3433, 0.001);

console.log("\nThe round trip loses nothing");
near("home → order → home", toHomeCurrency(toOrderCurrency(26.35, USD_TO_AUD), USD_TO_AUD), 26.35, 1e-9);
near("order → home → order", toOrderCurrency(toHomeCurrency(18.44, USD_TO_AUD), USD_TO_AUD), 18.44, 1e-9);

console.log("\nA missing rate leaves figures alone rather than zeroing them");
// fxToHome falls back to 1 when no rate can be had. Wrong, but visibly wrong, and the
// order is still placeable — dividing by zero or by null would destroy the price.
check("a rate of zero does not divide", toOrderCurrency(26.35, 0), 26.35);
check("a negative rate does not invert the price", toOrderCurrency(26.35, -2), 26.35);
check("a rate of 1 is a no-op", toOrderCurrency(26.35, 1), 26.35);

console.log("\nZero costs stay zero in both directions");
check("an unpriced part seeds a zero line", toOrderCurrency(0, USD_TO_AUD), 0);
check("a zero line writes back zero", toHomeCurrency(0, USD_TO_AUD), 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
