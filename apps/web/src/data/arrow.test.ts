import { tableFromArrays } from "apache-arrow";
import { describe, expect, it } from "vitest";

import { ColumnError, numberColumn, rowsOf, stringColumn } from "./arrow";

const table = tableFromArrays({
  region: ["IDF", "OCC"],
  ca: Float64Array.from([7.2, 3.9]),
  flag: [true, false],
});

describe("lecture Arrow", () => {
  it("lit les colonnes texte et numériques", () => {
    expect(stringColumn(table, "region")).toEqual(["IDF", "OCC"]);
    expect(numberColumn(table, "ca")).toEqual([7.2, 3.9]);
  });

  it("garde les valeurs nulles d'une colonne numérique", () => {
    const withNull = tableFromArrays({ v: [1.5, null] });
    expect(numberColumn(withNull, "v")).toEqual([1.5, null]);
  });

  it("refuse une colonne absente ou d'un autre type", () => {
    expect(() => stringColumn(table, "absente")).toThrow(ColumnError);
    expect(() => stringColumn(table, "ca")).toThrow("Valeur non textuelle en ligne 0 de ca");
    expect(() => numberColumn(table, "region")).toThrow("Valeur non numérique en ligne 0 de region");
  });

  it("convertit en lignes pour le tableau", () => {
    expect(rowsOf(table, ["region", "ca", "flag"])).toEqual([
      { region: "IDF", ca: 7.2, flag: null },
      { region: "OCC", ca: 3.9, flag: null },
    ]);
  });
});
