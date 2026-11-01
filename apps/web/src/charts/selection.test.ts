import { describe, expect, it } from "vitest";

import { isSelected, reduceSelection, selectionTotalRequest, toContextualSelection, type Selection } from "./selection";

const regions = (keys: string[]): Selection => ({ source: "ca-region", dimension: "region", keys });

describe("reduceSelection", () => {
  it("ajoute puis retire une valeur", () => {
    let state = reduceSelection(null, { type: "toggle", source: "ca-region", dimension: "region", key: "IDF" });
    state = reduceSelection(state, { type: "toggle", source: "ca-region", dimension: "region", key: "ARA" });
    expect(state).toEqual(regions(["IDF", "ARA"]));
    state = reduceSelection(state, { type: "toggle", source: "ca-region", dimension: "region", key: "IDF" });
    expect(state).toEqual(regions(["ARA"]));
  });

  it("vide la sélection quand la dernière valeur est retirée", () => {
    expect(reduceSelection(regions(["IDF"]), { type: "toggle", source: "ca-region", dimension: "region", key: "IDF" })).toBeNull();
  });

  it("repart de zéro quand la vue ou la dimension change", () => {
    expect(reduceSelection(regions(["IDF"]), { type: "toggle", source: "autre", dimension: "region", key: "OCC" })).toEqual({ source: "autre", dimension: "region", keys: ["OCC"] });
    expect(reduceSelection(regions(["IDF"]), { type: "toggle", source: "ca-region", dimension: "mois", key: "2026-03" })).toEqual({ source: "ca-region", dimension: "mois", keys: ["2026-03"] });
  });

  it("remplace et efface", () => {
    expect(reduceSelection(regions(["IDF", "ARA"]), { type: "replace", source: "ca-region", dimension: "region", key: "OCC" })).toEqual(regions(["OCC"]));
    expect(reduceSelection(regions(["IDF"]), { type: "clear", source: "ca-region" })).toBeNull();
  });
});

describe("isSelected", () => {
  it("vérifie la dimension et la valeur", () => {
    expect(isSelected(regions(["IDF"]), "region", "IDF")).toBe(true);
    expect(isSelected(regions(["IDF"]), "mois", "IDF")).toBe(false);
    expect(isSelected(null, "region", "IDF")).toBe(false);
  });
});

describe("traduction vers la couche contextuelle", () => {
  it("donne l'argument selection d'aggregate", () => {
    expect(toContextualSelection(regions(["IDF", "ARA"]))).toEqual({ region: ["IDF", "ARA"] });
    expect(toContextualSelection(null)).toBeNull();
  });

  it("formule le total de sélection", () => {
    expect(selectionTotalRequest(regions(["IDF"]), "ca_net")).toEqual({
      operation: "aggregate",
      metric: "ca_net",
      group_by: [],
      selection: { region: ["IDF"] },
      scope: "selection",
    });
  });
});
