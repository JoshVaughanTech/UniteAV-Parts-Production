"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const rowKey = (listKey: string) => `listmem:row:${listKey}`;
const CAN_BACK = "listmem:canBack";

/**
 * Drop into a list page to remember the row the user clicks into.
 * Rows opt in with data-mem-id. On return, the list scrolls back to that
 * row and highlights it (.row-visited).
 */
export function ListMemory({ listKey }: { listKey: string }) {
  useEffect(() => {
    const id = sessionStorage.getItem(rowKey(listKey));
    if (id) {
      const el = document.querySelector(`[data-mem-id="${CSS.escape(id)}"]`);
      if (el) {
        el.scrollIntoView({ block: "center" });
        el.classList.add("row-visited");
      }
    }

    // Record which row a navigation click came from.
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest("a")) return;
      const row = target.closest<HTMLElement>("[data-mem-id]");
      if (!row?.dataset.memId) return;
      sessionStorage.setItem(rowKey(listKey), row.dataset.memId);
      sessionStorage.setItem(CAN_BACK, "1");
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [listKey]);

  return null;
}

/**
 * Back link for detail pages: goes back through history (preserving list
 * filters + scroll) when the user navigated here from a list; otherwise
 * plain navigation to href.
 */
export function BackLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <Link
      href={href}
      className={className}
      onClick={(e) => {
        if (sessionStorage.getItem(CAN_BACK) && window.history.length > 1) {
          e.preventDefault();
          router.back();
        }
      }}
    >
      {children}
    </Link>
  );
}
