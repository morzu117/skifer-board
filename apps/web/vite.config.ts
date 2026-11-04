import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Deux pages : l'application, et la mesure du rendu, hors du bundle applicatif (plan 02, 2.5).
  build: { rolldownOptions: { input: { main: "index.html", bench: "bench.html" } } },
  // Les tokens du design system sont lus dans docs/design, hors de la racine Vite (plan 02, W4).
  // En développement, l'API et la connexion sont servies par `skifer-board-api` (plans 04 et 06).
  server: { fs: { allow: [repoRoot] }, proxy: { "/api": "http://127.0.0.1:8000", "/auth": "http://127.0.0.1:8000" } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Les parcours de bout en bout tournent sous Playwright, pas sous Vitest (plan 03, T6).
    exclude: [...configDefaults.exclude, "e2e/**"],
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
