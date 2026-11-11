import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    coverage: {
      provider: "v8",
      include: ["src/domain/**", "src/ingestion/**", "src/lib/**"],
      exclude: ["src/generated/**", "**/*.test.ts"],
      reporter: ["text-summary", "lcov"],
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/integration/setup.ts"],
          // One database for the whole project: run files one at a time.
          fileParallelism: false,
        },
      },
    ],
  },
});
