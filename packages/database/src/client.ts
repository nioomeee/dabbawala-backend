/**
 * Database client — PostgreSQL connection via Drizzle ORM
 * ref: AGENTS.md §8 (configuration strictly via env vars)
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;
let _pool: Pool | undefined;

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/** Initialize the database connection. Call once at application startup. */
export function initDatabase(databaseUrl: string): Database {
  _pool = new Pool({ connectionString: databaseUrl });
  _db = drizzle(_pool, { schema });
  return _db;
}

/** Get the active database client. Must call initDatabase() first. */
export function getDatabase(): Database {
  if (!_db) {
    throw new Error("Database not initialized. Call initDatabase() before getDatabase().");
  }
  return _db;
}

/** Close the database connection pool. */
export async function closeDatabase(): Promise<void> {
  await _pool?.end();
  _db = undefined;
  _pool = undefined;
}

