import { defineConfig } from "drizzle-kit";
<<<<<<< HEAD
import { config } from "dotenv";
import path from "node:path";

// Load the workspace-root .env explicitly — drizzle-kit runs from the
// package directory, and dotenv does not search parent dirs.
// ref: implementation.md §5, AGENTS.md §8
config({ path: path.resolve(import.meta.dirname, "../../../.env") });
=======
>>>>>>> 8902192ad8df810e30542a626bce32edd96805bf

if (!process.env["DATABASE_URL"]) {
  throw new Error("DATABASE_URL environment variable is required for drizzle-kit");
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_URL"],
  },
  verbose: true,
  strict: true,
});

