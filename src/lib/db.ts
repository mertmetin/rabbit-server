import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@/generated/prisma/client";

// DATABASE_TLS=true (production, RDS) requires an encrypted connection with a
// verified certificate; the RDS CA is trusted through NODE_EXTRA_CA_CERTS.
function databaseUrl() {
  const url = new URL(process.env.DATABASE_URL!);
  if (process.env.DATABASE_TLS === "true") url.searchParams.set("ssl", "true");
  return url.toString();
}

// Reuse one client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl()) });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
