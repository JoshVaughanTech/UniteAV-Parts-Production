"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";

export function AppShell({
  user,
  children,
}: {
  user: { name?: string | null; email?: string | null; role: string };
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile drawer whenever the route changes. Adjusting during render rather
  // than in an effect — an effect would paint the drawer open on the new page first.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  // h-dvh, not h-screen: on a phone 100vh is the viewport with the browser chrome
  // retracted, so a shell locked to it hangs the bottom of the page behind the URL bar —
  // and because the shell forbids page scrolling, nothing brings it back. The dynamic
  // viewport height tracks what is actually on screen.
  return (
    <div data-app-shell className="flex h-dvh overflow-hidden">
      {/* Mobile drawer backdrop */}
      {open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setOpen(false)} aria-hidden />}

      {/* Sidebar: static on desktop, slide-in drawer on mobile */}
      <div
        className={`fixed inset-y-0 left-0 z-40 w-64 transform transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar user={user} onNavigate={() => setOpen(false)} />
      </div>

      {/* Content column. min-w-0 so a wide table inside can't push the column past the
          screen edge — a flex item refuses to shrink below its content without it. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile top bar */}
        <div className="no-print flex items-center gap-3 border-b bg-surface px-4 py-3 md:hidden">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="-ml-1 rounded-lg p-1 text-2xl leading-none text-ink hover:bg-surface-2">
            ☰
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-xs font-bold text-white">U</div>
            <span className="font-semibold text-ink">Unite AV</span>
          </div>
        </div>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
