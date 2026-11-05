// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // Enforce no unhandled string throws
      "@typescript-eslint/no-throw-literal": "error",
      // Enforce typed result objects
      "@typescript-eslint/no-explicit-any": "error",
      // Ensure exhaustive switch
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      // No unused vars
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // No floating promises
      "@typescript-eslint/no-floating-promises": "error",
      // Consistent type imports
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
    },
  },
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/*.js",
      "contracts/**",
      "circuits/**",
    ],
  }
);

