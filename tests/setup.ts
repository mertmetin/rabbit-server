import { config } from "dotenv";
import { afterAll, beforeEach, vi } from "vitest";

config({ path: ".env.test", override: true, quiet: true });
// Most tests place orders without a driver online; tests/opening.test.ts
// covers branches opening and closing with their drivers.
process.env.ORDERING_NEEDS_DRIVER = "false";

// Capture texts instead of sending them; tests read codes from here.
export const sentSms: { phone: string; text: string }[] = [];
vi.mock("@/lib/sms", () => ({
  sendSms: async (phone: string, text: string) => {
    sentSms.push({ phone, text });
  },
  smsIsFake: () => false,
}));

// Capture push notifications instead of sending them.
export const sentPushes: { to: "customer" | "drivers"; userIds: number[]; title: string; body: string; data?: Record<string, unknown> }[] = [];
vi.mock("@/lib/push", () => ({
  pushCustomer: async (userId: number, push: { title: string; body: string; data?: Record<string, unknown> }) => {
    sentPushes.push({ to: "customer", userIds: [userId], ...push });
  },
  pushDrivers: async (userIds: number[], push: { title: string; body: string; data?: Record<string, unknown> }) => {
    if (userIds.length) sentPushes.push({ to: "drivers", userIds, ...push });
  },
}));

beforeEach(async () => {
  sentPushes.length = 0;
  (await import("@/lib/rate-limit")).resetRateLimits();
  sentSms.length = 0;
  const { db } = await import("@/lib/db");
  const tables = await db.$queryRawUnsafe<{ name: string }[]>(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> '_prisma_migrations'",
  );
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
    for (const { name } of tables) await tx.$executeRawUnsafe(`TRUNCATE TABLE \`${name}\``);
    await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
  });
});

afterAll(async () => {
  const { db } = await import("@/lib/db");
  await db.$disconnect();
});
