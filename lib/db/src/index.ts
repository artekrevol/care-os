import { drizzle } from "drizzle-orm/node-postgres";
import type { Logger } from "drizzle-orm/logger";
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

interface QueryCountStore {
  count: number;
}

export const queryCountStore = new AsyncLocalStorage<QueryCountStore>();

const countingLogger: Logger = {
  logQuery(_query: string, _params: unknown[]): void {
    const store = queryCountStore.getStore();
    if (store) store.count++;
  },
};

export const db = drizzle(pool, { schema, logger: countingLogger });

export function getRequestQueryCount(): number {
  return queryCountStore.getStore()?.count ?? -1;
}

export * from "./schema";
