import { defineConfig } from "vitest/config";

// Overrides vite.config.ts during `vitest` runs — the react-router dev
// plugin writes to `.react-router/types/` which fails in sandboxed /
// read-only-bind environments. Tests don't need that plugin.
export default defineConfig({
  test: {
    include: ["app/**/__tests__/**/*.test.ts"],
  },
});
