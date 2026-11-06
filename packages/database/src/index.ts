/**
 * @dabbawala/database - public API
 * Re-exports schema tables, client utilities, and drizzle query helpers.
 */

export * from "./schema/index.js";
export * from "./client.js";

// Re-export commonly used drizzle-orm query helpers so consumers
// don't need drizzle-orm as a direct dependency.
export { eq, and, lt, or, sql, desc, asc } from "drizzle-orm";
