import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    // policy-engine/domain dist is CJS and cannot be loaded at runtime (their
    // package.json `exports` has no `require`/`default` condition). Tests run
    // them from source until T4 fixes the manifests. After T4 this alias only
    // removes a build dependency for bare `pnpm test`.
    alias: {
      "@dabbawala/policy-engine": src("../policy-engine/src/index.ts"),
      "@dabbawala/domain": src("../domain/src/index.ts"),
    },
  },
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
