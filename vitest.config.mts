import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    // .next/standalone holds a copy of the project after `next build`.
    exclude: ["**/node_modules/**", ".next/**"],
    setupFiles: ["./tests/setup.ts"],
    // Tests share one database, so run files one at a time.
    fileParallelism: false,
  },
});
