import { describe, expect, it } from "vitest";

import tokensCss from "../../../../docs/design/tokens.css?raw";
import { cssColors, cssVariableName, flatColors, tokens } from "./tokens";

describe("tokens", () => {
  it("nomme les variables CSS comme tokens.css", () => {
    expect(cssVariableName(["ink2"])).toBe("--sb-ink-2");
    expect(cssVariableName(["slate900"])).toBe("--sb-slate-900");
    expect(cssVariableName(["seriesMutedLight"])).toBe("--sb-series-muted-light");
    expect(cssVariableName(["success", "bg"])).toBe("--sb-success-bg");
  });

  it("aplatit les couleurs imbriquées", () => {
    expect(flatColors({ a: "#abcdef", b: { fg: "#000000" } })).toEqual(
      new Map([
        ["--sb-a", "#ABCDEF"],
        ["--sb-b-fg", "#000000"],
      ]),
    );
  });

  it("garde tokens.css et tokens.json identiques", () => {
    expect(cssColors(tokensCss)).toEqual(flatColors());
  });

  it("expose les tokens typés", () => {
    expect(tokens.color.copper).toBe("#A4521F");
    expect(tokens.layout.targetMin).toBe(44);
  });
});
