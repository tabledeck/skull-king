import { PrismaClient } from "./db/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

declare global {
  var __prisma: PrismaClient | undefined;
}

export function getPrisma(_context: unknown): PrismaClient {
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      adapter: new PrismaLibSql({
        url: process.env.DATABASE_URL ?? "file:./dev.db",
      }),
    });
  }
  return global.__prisma;
}
