import { redirect } from "next/navigation";
import { auth } from "@/auth";

/**
 * The shell for documents that leave the building.
 *
 * Deliberately not the app shell: no sidebar, no navigation, no status badges, nothing
 * that belongs to the dashboard. A supplier-facing page should be unable to show internal
 * figures by accident, and the surest way to achieve that is for the chrome not to be
 * there in the first place rather than for a stylesheet to hide it.
 *
 * Auth still applies — the `(app)` layout does it and this sits outside that layout, so it
 * has to do it itself. Forgetting this would publish every purchase order to the internet.
 */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return <div className="min-h-full bg-white">{children}</div>;
}
