// Creates an admin account for the admin panel, or makes an existing account
// an admin. The password is typed at the prompt (not shown), so it never ends
// up in shell history, task settings or logs.
//   npx tsx prisma/create-admin.ts "Mert Metin" 6135551234 mert@example.com
import "dotenv/config";
import { createInterface } from "node:readline";
import bcrypt from "bcryptjs";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";
import { normalizePhone } from "../src/lib/phone";

const url = new URL(process.env.DATABASE_URL!);
if (process.env.DATABASE_TLS === "true") url.searchParams.set("ssl", "true");
const db = new PrismaClient({ adapter: new PrismaMariaDb(url.toString()) });

// One reader for every prompt (piped input arrives all at once); what's typed
// isn't echoed.
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const lines = rl[Symbol.asyncIterator]();
const echo = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput.bind(rl);
(rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};

async function askHidden(question: string): Promise<string> {
  echo(question);
  const { value } = await lines.next();
  process.stdout.write("\n");
  return value ?? "";
}

async function main() {
  const [name, phoneInput, email] = process.argv.slice(2);
  const phone = normalizePhone(phoneInput ?? "");
  if (!name || !phone || !email) throw new Error('Usage: create-admin.ts "Full Name" <10-digit phone> <email>');

  const password = await askHidden("Password (12+ characters): ");
  if (password.length < 12) throw new Error("Use at least 12 characters.");
  if ((await askHidden("Again: ")) !== password) throw new Error("The passwords don't match.");

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await db.user.upsert({
    where: { phone },
    update: { role: "admin", passwordHash, phoneVerifiedAt: new Date() },
    create: { name, phone, email, role: "admin", passwordHash, phoneVerifiedAt: new Date() },
  });
  console.log(`Admin ready: ${user.name} (${user.phone}). Sign in at /admin with this phone and password.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
    return db.$disconnect();
  });
