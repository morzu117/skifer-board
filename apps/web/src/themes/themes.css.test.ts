import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("compose l'éditeur avec les classes et variables du design", () => {
  const path = "./themes.css";
  const css = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
  for (const name of ["workspace", "fields", "section", "grid", "token", "token-control", "palier", "palier-actions", "actions", "small", "danger", "hint", "preview", "preview-grid", "preview-link", "diff", "diff-path"]) expect(css).toContain(`.sb-themes__${name}`);
  expect(css).toContain(".sb-themes__diff .sb-table caption { text-align: start; }");
  expect(css).toContain("position: sticky");
  expect(css).toContain("overflow-y: auto");
  expect(css).toContain(".sb-themes__diff-path.sb-mono { overflow-wrap: normal; word-break: normal; }");
  expect(css).toContain("var(--sb-space-");
  expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\s*\(/i);
});
