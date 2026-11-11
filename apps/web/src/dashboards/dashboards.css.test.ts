import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("le diff sur fond clair garde des en-têtes sombres dans le thème ardoise", () => {
  const path = "./dashboards.css";
  const css = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
  expect(css).toMatch(/\.sb-theme-skifer-ardoise \.sb-dashboard-diff \.sb-table th\s*\{\s*color:\s*var\(--sb-ink-2\)/);
});

it("le diff défile dans son conteneur sans couper les libellés et les radios sont côte à côte", () => {
  const path = "./dashboards.css";
  const css = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
  expect(css).toMatch(/\.sb-dashboard-diff \.sb-table\s*\{\s*min-width:\s*760px/);
  expect(css).toContain("overflow-wrap: normal; word-break: normal");
  expect(css).toContain(".sb-dashboards__visibility { display: flex; flex-wrap: wrap");
  expect(css).toContain(".sb-props__choice.sb-props__visibility { display: flex; flex-wrap: wrap");
});

it("les libellés du diff restent entiers et sa légende reste visible ; le résumé est une grille", () => {
  const path = "./dashboards.css";
  const css = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
  expect(css).toMatch(/\.sb-dashboard-diff \.sb-table caption\s*\{\s*text-align:\s*start/);
  expect(css).toMatch(/\.sb-dashboard-diff \.sb-table thead th, \.sb-dashboard-diff \.sb-table td:nth-child\(-n\+2\)\s*\{\s*white-space:\s*nowrap/);
  expect(css).toMatch(/\.sb-filters__summary\s*\{\s*display:\s*grid/);
  expect(css).toMatch(/\.sb-analysis-choice\[aria-pressed="true"\]\s*\{\s*outline:\s*2px solid/);
});
