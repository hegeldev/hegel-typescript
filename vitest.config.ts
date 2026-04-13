import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
  resolve: {
    alias: {
      hegel: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/index.ts"],
      reporter: ["text", "json", "json-summary"],
      thresholds: {
        lines: 100,
        // Branch coverage is ~96% because v8 tracks branches inside
        // /* v8 ignore start/stop */ blocks for defensive error handlers.
        branches: 96,
        functions: 100,
        statements: 100,
      },
    },
  },
});
