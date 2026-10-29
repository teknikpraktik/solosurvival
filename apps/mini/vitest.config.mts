import { defineConfig } from "vitest/config";
import path from "node:path";

// Mini Outbreaks tester. Körs från apps/mini med repo-rotens vitest (npm test här, eller npx vitest run --config apps/mini/vitest.config.mts).
export default defineConfig({
  root: import.meta.dirname,
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../../src") } },
  test: { environment: "node", include: ["tests/**/*.test.ts"], testTimeout: 30_000 },
});
