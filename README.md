# Unite AV — Parts & Production Dashboard

Ingest BOMs → build a product catalog → track inventory → log daily builds (which consume parts) →
get reorder alerts based on **usage × lead time + safety stock**. Built to add automated ordering later.

## Stack

- **Next.js 16** (App Router, TypeScript) + **Tailwind CSS v4**
- **Prisma** ORM — SQLite for local dev, Postgres (Neon/Supabase) for production
- **Auth.js (NextAuth v5)** — credentials + role-based access (Admin / Manager / Operator / Viewer)

## Run locally

```powershell
npm install
npx prisma db push        # create the SQLite dev.db from the schema
npx tsx scripts/seed.ts    # seed demo users + import the 3 sample BOMs
npm run dev                # http://localhost:3000
```

**Demo logins** (password `password123`): `admin@unite.local`, `manager@unite.local`,
`operator@unite.local`, `viewer@unite.local`.

Useful scripts:

- `npx tsx scripts/seed.ts` — (re)seed users and import every BOM in `sample-boms/`
- `npx tsx scripts/verify.ts` — assert the consumption + reorder engine against seeded data
- `npm run build` — production build / typecheck

## What each role can do

| Capability | Viewer | Operator | Manager | Admin |
|---|:-:|:-:|:-:|:-:|
| View everything | ✓ | ✓ | ✓ | ✓ |
| Log production, receive/adjust stock | | ✓ | ✓ | ✓ |
| Edit part planning, suppliers, import BOMs, reverse builds | | | ✓ | ✓ |
| Manage users + reorder settings | | | | ✓ |

## Data model (see `prisma/schema.prisma`)

- **Item** — products, assemblies, and parts in one table; multi-level BOMs + shared parts via **BomLine** edges.
- **ExplodedBom** — cached product→leaf-part totals (rebuilt on import).
- **InventoryTxn** — append-only ledger; on-hand is mirrored on `Item.onHand`.
- **ProductionLog** — a build; consumes exploded parts.
- **Supplier**, **User**, **Settings**, **ImportBatch**.

BOM import matches parts by **Item Number**, so a part shared across products is one master record.
Re-importing updates quantities/descriptions without clobbering on-hand, cost, lead time, or supplier.

## Reorder logic

- **ADU** (avg daily usage) = BUILD_CONSUMPTION over the usage window ÷ window days
- **Reorder point** = ADU × lead time + safety stock
- **Suggested order qty** = raise to (ROP + ADU × review period) − on hand, rounded up to pack/MOQ
- Set lead time, safety stock, pack qty, cost, and supplier per part on its detail page.
  (These aren't in the BOM files — only manufacturer + MPN are.)

## Deploying to cloud Postgres + Vercel

1. Create a Postgres DB (Neon or Supabase) and copy its connection string.
2. In `prisma/schema.prisma`, set `datasource db { provider = "postgresql" }`.
3. Set env vars (`.env` locally / Vercel project settings):
   - `DATABASE_URL` = your Postgres URL
   - `AUTH_SECRET` = output of `npx auth secret`
4. `npx prisma migrate deploy` (or `db push`) then `npx tsx scripts/seed.ts` to seed.
5. Deploy to Vercel (`vercel` or connect the git repo). Set the same env vars there.

## Roadmap

- **Automation (later):** a Vercel Cron reorder check + an `OrderAction` interface
  (`AlertOnly` → `EmailSupplier` / `SupplierApi`). The To-Order page is the seam.
- Usage-trend charts, CSV/PDF export, finished-goods that combine multiple boards.
