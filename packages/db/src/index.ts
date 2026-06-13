import { PrismaClient } from "./generated/client";

// Единый экземпляр PrismaClient, переиспользуемый ботом и админкой.
// В dev предотвращаем переподключения при hot-reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export * from "./generated/client";
export type {
  TestContent,
  Question,
  Interpretation,
  OptionPreset,
  AlertRule,
} from "./test-schema";
