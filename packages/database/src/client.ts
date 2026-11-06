/**
<<<<<<< HEAD
 * Database client - PostgreSQL connection via Drizzle ORM
 *
 * Uses the `pg` driver with NeonDB cloud PostgreSQL.
 * sslmode=require is mandatory per implementation.md §5 D2.
 * ref: AGENTS.md §8, implementation.md §5
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

const { Pool } = pg;

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;
let _pool: InstanceType<typeof Pool> | undefined;

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Initialize the database connection.
 * Call once at application startup.
 * The DATABASE_URL must contain `sslmode=require` for NeonDB.
 * ref: implementation.md §5, R2 risk (use direct endpoint for migrations)
 */
export function initDatabase(databaseUrl: string): Database {
  _pool = new Pool({
    connectionString: databaseUrl,
    // NeonDB requires SSL. The sslmode=require in the URL is honoured by pg;
    // we also set ssl here as a belt-and-braces guard.
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
=======
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
>>>>>>> 8902192ad8df810e30542a626bce32edd96805bf
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
<<<<<<< HEAD
=======

>>>>>>> 8902192ad8df810e30542a626bce32edd96805bf
