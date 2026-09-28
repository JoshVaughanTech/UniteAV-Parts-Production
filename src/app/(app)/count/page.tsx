import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/rbac";
import { roleAtLeast } from "@/lib/constants";
import { StockCount } from "@/components/StockCount";

export default async function CountPage() {
  const user = await currentUser();
  if (!roleAtLeast(user?.role, "OPERATOR")) redirect("/");

  const parts = await prisma.item.findMany({
    where: { type: { in: ["PART", "ASSEMBLY"] }, active: true },
    select: { id: true, partNumber: true, name: true, mpn: true, onHand: true },
    orderBy: { partNumber: "asc" },
  });

  return (
    <div className="mx-auto max-w-md space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-ink">Stock Count</h1>
        <p className="text-sm text-muted">
          Scan a barcode or search a part, enter the counted quantity, and on-hand updates instantly (recorded to the
          ledger). Best on a phone.
        </p>
      </header>
      <StockCount parts={parts} />
    </div>
  );
}
