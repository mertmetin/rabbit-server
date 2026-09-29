import { config } from "dotenv";
import { afterAll, beforeEach, vi } from "vitest";

config({ path: ".env.test", override: true, quiet: true });

// Capture texts instead of sending them; tests read codes from here.
export const sentSms: { phone: string; text: string }[] = [];
vi.mock("@/lib/sms", () => ({
  sendSms: async (phone: string, text: string) => {
    sentSms.push({ phone, text });
  },
}));

beforeEach(async () => {
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
