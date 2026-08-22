import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

/**
 * ESLint 9 flat config.
 *
 * `eslint-config-next` is still published in the legacy eslintrc format, so it
 * is bridged through FlatCompat rather than imported directly. The `lint`
 * script calls `eslint` itself instead of `next lint`, which Next 15.5
 * deprecates and removes in 16.
 */
const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const config = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "functions/lib/**",
      "functions/node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Tests and scripts legitimately use `any` at mock boundaries; keep it a
      // warning so a real one in app code is still visible in CI output.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default config;
