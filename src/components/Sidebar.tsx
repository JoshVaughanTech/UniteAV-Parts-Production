"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { roleAtLeast, type Role } from "@/lib/constants";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  minRole?: Role;
}

const NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: "▚" },
  { href: "/products", label: "Products", icon: "▦" },
  { href: "/parts", label: "Parts & Inventory", icon: "◲" },
  { href: "/count", label: "Stocktake", icon: "▣", minRole: "OPERATOR" },
  { href: "/production", label: "Production Log", icon: "▶" },
  { href: "/to-order", label: "To-Order", icon: "⤓" },
  { href: "/purchase-orders", label: "Purchase Orders", icon: "▤", minRole: "MANAGER" },
  { href: "/suppliers", label: "Suppliers", icon: "☰", minRole: "MANAGER" },
  { href: "/import", label: "Import BOM", icon: "⇪", minRole: "MANAGER" },
  { href: "/settings", label: "Settings & Users", icon: "⚙", minRole: "ADMIN" },
];

export function Sidebar({
  user,
  onNavigate,
}: {
  user: { name?: string | null; email?: string | null; role: string };
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-full flex-col border-r bg-surface">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">U</div>
        <div>
          <div className="text-sm font-semibold leading-tight text-ink">Unite AV</div>
          <div className="text-xs text-muted">Parts &amp; Production</div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-2">
        {NAV.filter((n) => !n.minRole || roleAtLeast(user.role, n.minRole)).map((n) => {
          const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={onNavigate}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                active ? "bg-brand/10 font-medium text-brand" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
              }`}
            >
              <span className="w-4 text-center text-xs" aria-hidden>
                {n.icon}
              </span>
              {n.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t px-3 py-3">
        <div className="mb-2 px-1">
          <div className="truncate text-sm font-medium text-ink">{user.name || user.email}</div>
          <div className="text-xs capitalize text-muted">{user.role.toLowerCase()}</div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full rounded-lg border px-3 py-1.5 text-left text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
