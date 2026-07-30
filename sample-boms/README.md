# sample-boms

Drop the source BOM files here to (re)seed the catalog: `npm run seed`.

The actual `.xlsx` BOM files are **git-ignored by default** because they contain
proprietary pricing and supplier data. If you want them version-controlled, use a
**private** repo and remove the `sample-boms/*` lines from `.gitignore`.

Recognized files:

- **Board BOMs** — Altium purchasing exports (`Quantity, Item Number, Comment, Item
  Name, Footprint, Manufacturer 1, Manufacturer Item 1`). Each becomes a board.
- **Top-level / master purchasing sheets** — files named `*Top Level*` or
  `All products purchasing*`, which additionally carry `Price Each` / `Cost Each`
  and `Quantity in Stock` / `Stock Level` columns. These update cost + on-hand and
  (for the top level) build the connector sub-assembly.
- **Product workbooks** — one file per finished product (U74 / UR86 / UR64): a chassis
  rollup sheet (`Total Cost`) plus one sheet per PCB. The chassis rows carry no item
  number, so stable `MECH-…` numbers are synthesized from the drawing number or name.
  These files never touch an existing part's cost or on-hand. Registered in
  `src/lib/bom/product-workbook.ts` (`PRODUCT_WORKBOOKS`) — a new one needs an entry
  there naming its sheets, or the seeder will mistake it for a price sheet.

Finished-product groupings are defined in `src/lib/bom/assemble.ts`; the three chassis
products above are built by `src/lib/bom/product-workbook.ts` instead, because they carry
chassis lines that `buildFinishedGoods` would prune.
