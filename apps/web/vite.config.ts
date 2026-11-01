import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Deux pages : l'application, et la mesure du rendu, hors du bundle applicatif (plan 02, 2.5).
  build: { rolldownOptions: { input: { main: "index.html", bench: "bench.html" } } },
  // Les tokens du design system sont lus dans docs/design, hors de la racine Vite (plan 02, W4).
  server: { fs: { allow: [repoRoot] } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Seule la feuille de tokens est lue en test, pour le contrôle de concordance (W4).
    css: { include: [/docs\/design\/tokens\.css/] },
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/main.tsx", "src/bench-main.tsx", "src/test/**", "src/**/testing.ts", "src/**/*.test.{ts,tsx}", "src/vite-env.d.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
