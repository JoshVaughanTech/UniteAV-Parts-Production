/**
 * Production-safe seeding: ensures Settings + a single ADMIN user from env
 * (ADMIN_EMAIL / ADMIN_PASSWORD). Does NOT create the shared demo accounts.
 * The admin then creates employee logins in Settings → Users.
 */
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

async function main() {
  await prisma.settings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });

  const email = (process.env.ADMIN_EMAIL ?? "").toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || password.length < 8) {
    throw new Error("Set ADMIN_EMAIL and a strong ADMIN_PASSWORD (8+ chars) before running seed:admin.");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name: "Admin", role: "ADMIN", passwordHash },
    update: { role: "ADMIN", passwordHash },
  });
  console.log(`Admin ready: ${user.email}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
