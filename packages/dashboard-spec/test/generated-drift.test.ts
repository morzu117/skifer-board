import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { compileFromFile } from "json-schema-to-typescript";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.join(testDir, "..");
const schemaPath = path.join(packageDir, "schema", "dashboard.v1.json");
const generatedPath = path.join(packageDir, "src", "generated", "dashboard.v1.ts");

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

describe("generated types", () => {
  it("match what json-schema-to-typescript produces from the schema", async () => {
    const freshlyGenerated = await compileFromFile(schemaPath);
    const committed = readFileSync(generatedPath, "utf8");
    expect(normalizeLineEndings(committed)).toBe(normalizeLineEndings(freshlyGenerated));
  });
});
