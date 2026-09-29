// Enum-like values kept as string unions for provider portability (SQLite <-> Postgres).

export const ITEM_TYPES = ["PRODUCT", "ASSEMBLY", "PART"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

// BUILD_OUTPUT is stock coming INTO the store from assembly — an SMD board that has been
// built and is now on the shelf. BUILD_CONSUMPTION is what that build ate.
export const TXN_TYPES = ["RECEIPT", "BUILD_CONSUMPTION", "BUILD_OUTPUT", "ADJUSTMENT", "COUNT"] as const;
export type TxnType = (typeof TXN_TYPES)[number];

export const ROLES = ["ADMIN", "MANAGER", "OPERATOR", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

// Role capability helpers (used for RBAC in UI + API).
const RANK: Record<Role, number> = { VIEWER: 0, OPERATOR: 1, MANAGER: 2, ADMIN: 3 };
export function roleAtLeast(role: string | undefined | null, min: Role): boolean {
  if (!role || !(role in RANK)) return false;
  return RANK[role as Role] >= RANK[min];
}

// Known Item-Number category prefixes -> human label (from the Unite AV BOMs).
export const CATEGORY_LABELS: Record<string, string> = {
  CAPS: "Capacitor",
  RESS: "Resistor",
  INDS: "Inductor",
  ICMS: "IC - Memory",
  ICPS: "IC - Processor",
  ICXS: "IC - Other",
  ICWT: "IC - Power Mgmt",
  SMDS: "Diode / SMD",
  CONS: "Connector (SMT)",
  CONT: "Connector (TH)",
  MECH: "Mechanical",
  OPTT: "Optical",
};

export function categoryFromPartNumber(partNumber: string): string | null {
  const m = partNumber.match(/^([A-Z]{3,4})-/);
  return m ? m[1] : null;
}
