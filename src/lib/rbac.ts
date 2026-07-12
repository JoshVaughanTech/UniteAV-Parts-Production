import { auth } from "@/auth";
import { roleAtLeast, type Role } from "@/lib/constants";

/** Get the current session's user (or null). */
export async function currentUser() {
  const session = await auth();
  return session?.user ?? null;
}

/**
 * Assert the current user has at least `min` role. Throws (caught by server actions)
 * when not permitted. Returns the user on success.
 */
export async function requireRole(min: Role) {
  const user = await currentUser();
  if (!user) throw new Error("Not signed in.");
  if (!roleAtLeast(user.role, min)) {
    throw new Error(`Requires ${min} role or higher (you are ${user.role}).`);
  }
  return user;
}
