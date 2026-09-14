import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { validateStructure } from "../src/validate.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(testDir, "..", "fixtures");
const validDir = path.join(fixturesDir, "valid");
const invalidDir = path.join(fixturesDir, "invalid");

function readYaml(dir: string, file: string): unknown {
  return parse(readFileSync(path.join(dir, file), "utf8"));
}

interface Expected {
  layer: "structural" | "semantic";
  code: string;
  path: string;
}

const validFiles = readdirSync(validDir).filter((f) => f.endsWith(".yaml"));
const invalidFiles = readdirSync(invalidDir).filter((f) => f.endsWith(".yaml"));

describe("fixtures corpus", () => {
  it("has the expected number of fixtures", () => {
    expect(validFiles.length).toBe(10);
    expect(invalidFiles.length).toBe(16);
  });

  it.each(validFiles)("valid/%s produces no structural issue", (file) => {
    const document = readYaml(validDir, file);
    expect(validateStructure(document)).toEqual([]);
  });

  it.each(invalidFiles)("invalid/%s matches its expected layer", (file) => {
    const document = readYaml(invalidDir, file);
    const expectedRaw = readFileSync(
      path.join(invalidDir, file.replace(/\.yaml$/, ".expected.json")),
      "utf8",
    );
    const expected = JSON.parse(expectedRaw) as Expected;
    const issues = validateStructure(document);

    if (expected.layer === "semantic") {
      expect(issues).toEqual([]);
      return;
    }

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((issue) => issue.path === expected.path)).toBe(true);
  });
});
