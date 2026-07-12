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

Finished-product groupings are defined in `src/lib/bom/assemble.ts`.
