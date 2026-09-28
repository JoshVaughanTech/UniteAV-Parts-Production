# sample-boms

Drop the source BOM files here to (re)seed the catalog: `npm run seed`.

The actual `.xlsx` BOM files are **git-ignored by default** because they contain
proprietary pricing and supplier data. If you want them version-controlled, use a
**private** repo and remove the `sample-boms/*` lines from `.gitignore`.

Recognized files:

- **Board BOMs** — Altium purchasing exports (`Quantity, Item Number, Comment, Item
  Name, Footprint, Manufacturer 1, Manufacturer Item 1`). Each becomes a board.
- **Build / placement exports** — Altium "Part List Report" (`.xlsm`), one row per
  **designator** with a `Fitted` flag and no `Quantity` column. Detected by the
  `Designator` header; Not-Fitted (DNP) placements are dropped and quantity per part is
  the number of fitted placements. These sheets carry no description column, so import
  them with `preserveMissing` — otherwise every part is renamed to its item number.
  Useful as a cross-check: the an3170 export confirmed all 136 stored lines and
  quantities, and turned up one missing line (MECH-00046 ×2).
- **Top-level / master purchasing sheets** — files named `*Top Level*` or
  `All products purchasing*`, which additionally carry `Price Each` / `Cost Each`
  and `Quantity in Stock` / `Stock Level` columns. These update cost + on-hand and
  (for the top level) build the connector sub-assembly.
- **Product workbooks** — one file per finished product (U74 / UR86 / UR64 / AMP One V2):
  a chassis rollup sheet (`Total Cost`) plus one sheet per PCB. The chassis rows carry no
  item number, so stable `MECH-…` numbers are synthesized from the drawing number or name.
  These files never touch an existing part's cost or on-hand. Registered in
  `src/lib/bom/product-workbook.ts` (`PRODUCT_WORKBOOKS`) — a new one needs an entry
  there naming its sheets, or the seeder will mistake it for a price sheet.

Finished-product groupings are defined in `src/lib/bom/assemble.ts`; the four products
above are built by `src/lib/bom/product-workbook.ts` instead, because they carry chassis
lines that `buildFinishedGoods` would prune. Anything listed in BOTH places will lose its
chassis on the next seed.

Known gap: `PROD-DSP`, `PROD-ENCDEC` and `PROD-AN3010DSP` have no chassis rollup among
these files, so their top-level BOM is boards only — no metalwork, hardware or packaging.
Adding one is a matter of dropping the workbook here and registering it.
