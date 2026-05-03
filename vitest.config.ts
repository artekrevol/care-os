import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "lib/services/src/**/*.test.ts",
      "artifacts/api-server/src/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    pool: "forks",
    isolate: true,
  },
});
