import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Test setup.
 *
 * `main` carried three test files plus hand-written `declare module "vitest"`
 * stubs, but no runner — so they type-checked against `expect: any` and never
 * actually executed. This makes them real; the stub file is gone.
 *
 * No Vite plugins on purpose: @vitejs/plugin-react resolves a different major
 * of Vite than Vitest does, and the two type-clash. Everything the tests need
 * is the JSX transform and the path alias, both of which are one line here.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@data": fileURLToPath(new URL("./data", import.meta.url)),
    },
  },
  // tsconfig sets `jsx: "preserve"` because Next compiles JSX itself. Vitest
  // has no Next pipeline, so it needs the automatic runtime spelled out or
  // components compile to bare `React.createElement` with no React in scope.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node", // per-file `@vitest-environment jsdom` opts in
    include: ["src/**/*.test.{ts,tsx}"],
    globals: false,
  },
});
