import { defineConfig } from "@playwright/test";

const PORT = 4174;

/**
 * Bout en bout et régression visuelle sur le build de production (plan 03, T6). Le
 * navigateur est le Chrome installé sur le poste : aucun navigateur n'est téléchargé.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  // Les captures de référence sont suffixées par plateforme : une autre machine a les siennes.
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}",
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled", caret: "hide" } },
  use: { baseURL: `http://localhost:${PORT}`, channel: "chrome", locale: "fr-FR", timezoneId: "Europe/Paris", trace: "retain-on-failure" },
  projects: [
    { name: "ordinateur", use: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 } },
    { name: "telephone", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    // Le build est fait par le script `e2e` ; `vite preview` est lancé seul pour s'arrêter proprement.
    command: `vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
