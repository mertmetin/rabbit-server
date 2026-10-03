import { db } from "./db";

// A branch is open for orders while at least one driver is online there:
// the driver app's "You're online" switch opens and closes it. Set
// ORDERING_NEEDS_DRIVER=false to take orders regardless.
export const orderingNeedsDriver = () => process.env.ORDERING_NEEDS_DRIVER !== "false";

export async function openStoreIds(): Promise<Set<number> | null> {
  if (!orderingNeedsDriver()) return null; // null: every active branch is open
  const drivers = await db.user.findMany({
    where: { driverOnline: true, role: { in: ["driver", "admin"] }, driverStoreId: { not: null } },
    select: { driverStoreId: true },
  });
  return new Set(drivers.map((d) => d.driverStoreId!));
}

export async function isStoreOpen(storeId: number) {
  const open = await openStoreIds();
  return open === null || open.has(storeId);
}
