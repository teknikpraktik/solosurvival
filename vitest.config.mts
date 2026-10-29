import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  // testTimeout: several simulation tests take 5–6 s under full parallel load and failed intermittently at Vitest's default 5 s (also before apps/mini).
  test: { environment: "node", include: ["src/tests/**/*.test.ts", "experiments/**/*.test.ts"], testTimeout: 30_000 },
});
