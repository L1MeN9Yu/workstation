import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost/",
      },
    },
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "istanbul",
      include: ["src/lib/**/*.{ts,tsx}", "src/store/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/vite-env.d.ts",
        "**/tauri-env.d.ts",
      ],
      reporter: ["text", "lcov", "html"],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
