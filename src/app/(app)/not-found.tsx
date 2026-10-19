import Link from "next/link";
import { Card, btnPrimary, btnGhost } from "@/components/ui";

/**
 * Shown whenever a page calls notFound() — most often an item that has since been deleted,
 * reached from a bookmark, a shared link, or the Back button. Renders inside the app shell
 * so the sidebar stays put and it reads as a wrong turn rather than a broken site.
 *
 * Deleting from an item's own page redirects to the list instead of landing here (see
 * DeleteItemButton's redirectTo); this catches the routes nothing can redirect.
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg py-10">
      <Card title="Not found">
        <div className="space-y-4 p-6">
          <p className="text-sm text-ink-2">
            This page doesn&rsquo;t exist. If you followed a link or a bookmark to a product, board or part, it has
            most likely been deleted since.
          </p>
          <p className="text-sm text-muted">
            An item that carried stock movements or build history was archived rather than deleted — look for it on the
            Archived tab under Products, where it can be restored.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/" className={btnPrimary}>
              Overview
            </Link>
            <Link href="/products" className={btnGhost}>
              Products
            </Link>
            <Link href="/products?tab=boards" className={btnGhost}>
              SMD Boards
            </Link>
            <Link href="/parts" className={btnGhost}>
              Parts &amp; Inventory
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
