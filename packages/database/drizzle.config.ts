import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load the workspace-root .env explicitly — drizzle-kit runs from the
// package directory, and dotenv does not search parent dirs.
// ref: implementation.md §5, AGENTS.md §8
config({ path: path.resolve(__dirname, "../../.env") });

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

