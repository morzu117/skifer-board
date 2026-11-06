import { DateDay, DateMillisecond, Decimal, makeData, makeVector, Table, TimestampSecond, TimestampMillisecond, TimestampMicrosecond, TimestampNanosecond, tableFromIPC, tableToIPC, tableFromArrays } from "apache-arrow";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import champs from "../../../../contracts/executions/champs.json";
import { chartOf } from "../charts/testing";
import { THEMES } from "../charts/theme";
import { expectAccessible, renderThemed } from "../test/a11y";
import { decodeFields } from "./model";
import { genreInitial, Resultat, texteDecimal } from "./Resultat";
import { texteTemporel } from "./temps";

const model = decodeFields(champs.body).models[0] as ReturnType<typeof decodeFields>["models"][number];
const input = { connection: "source", environment: "DEV" as const, model: "orders", metrics: ["revenue"], dimensions: [] as string[], filters: [] };
it.each([
  [[], "valeur"], [["region"], "barres"], [["jour"], "ligne"], [["region", "jour"], "groupees"],
])("propose le type de graphique pour %j", (dimensions, genre) => {
  expect(genreInitial({ ...input, dimensions }, model)).toBe(genre);
});
it.each([["123", 2, "1.23"], ["-1", 3, "-0.001"], ["123", 0, "123"], ["12", -2, "1200"]])("place la virgule exactement", (entier, scale, attendu) => { expect(texteDecimal(entier, scale)).toBe(attendu); });

describe.each(THEMES)("résultat accessible sous $label", (theme) => {
  it("change de graphique et parcourt les onglets au clavier", async () => {
    const table = tableFromArrays({ region: ["Nord", "Sud"], revenue: [1, 2] });
    const { container } = renderThemed(<Resultat table={table} input={{ ...input, dimensions: ["region"] }} model={model} theme={theme} />, theme);
    expect(screen.getByLabelText("Type de graphique")).toHaveValue("barres");
    await userEvent.selectOptions(screen.getByLabelText("Type de graphique"), "ligne");
    expect(screen.getByLabelText("Type de graphique")).toHaveValue("ligne");
    await expectAccessible(container);
    screen.getByRole("tab", { name: "Graphique" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Tableau" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("cell", { name: "Nord" })).toBeInTheDocument();
    await expectAccessible(container);
  });
});
it("affiche les grands entiers et les décimaux Arrow sans arrondi", async () => {
  const decimal = makeVector(makeData({ type: new Decimal(2, 30), length: 1, data: new Uint32Array(new BigInt64Array([9007199254740993n, 0n]).buffer) }));
  const entier = makeVector(new BigInt64Array([9007199254740993n]));
  const table = new Table({ revenue: decimal, grand: entier });
  renderThemed(<Resultat table={table} input={input} model={model} theme={THEMES[0]} />, THEMES[0]);
  await userEvent.click(screen.getByRole("tab", { name: "Tableau" }));
  expect(screen.getByRole("cell", { name: "90071992547409.93" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "9007199254740993" })).toBeInTheDocument();
});

it("regroupe les barres selon la dernière dimension et garde les valeurs associées", async () => {
  const table = tableFromArrays({ region: ["Nord", "Nord", "Sud", "Sud"], jour: ["A", "B", "A", "B"], revenue: [1, 2, 3, 4] });
  const { container } = renderThemed(<Resultat table={table} input={{ ...input, dimensions: ["region", "jour"] }} model={model} theme={THEMES[0]} />, THEMES[0]);
  expect(screen.getByLabelText("Type de graphique")).toHaveValue("groupees");
  expect(container.querySelector("svg")).not.toBeNull();
  const graphique = container.querySelector("[role=img]") as HTMLElement;
  const series = chartOf(graphique).getOption().series as { name: string; data: { value: string }[] }[];
  expect(series.map((item) => [item.name, item.data.map((point) => point.value)])).toEqual([["A · revenue", ["1", "3"]], ["B · revenue", ["2", "4"]]]);
  await userEvent.click(screen.getByRole("tab", { name: "Tableau" }));
  expect(screen.getAllByRole("cell", { name: "Nord" })).toHaveLength(2);
});

it("présente les valeurs nulles et booléennes et les groupes incomplets", async () => {
  const table = tableFromArrays({ region: ["Nord", "Nord", "Sud"], jour: ["A", "B", "A"], revenue: [null, 2, 3], actif: [true, false, true] });
  renderThemed(<Resultat table={table} input={{ ...input, dimensions: ["region", "jour"] }} model={model} theme={THEMES[0]} />, THEMES[0]);
  await userEvent.click(screen.getByRole("tab", { name: "Tableau" }));
  expect(screen.getByRole("cell", { name: "—" })).toBeInTheDocument();
  expect(screen.getAllByRole("cell", { name: "true" })).toHaveLength(2);
  await userEvent.selectOptions(screen.getByLabelText("Type de graphique"), "barres");
  await userEvent.selectOptions(screen.getByLabelText("Type de graphique"), "ligne");
});

it("affiche les valeurs absentes et permet les quatre types", async () => {
  const table = tableFromArrays({ revenue: [] as number[] });
  renderThemed(<Resultat table={table} input={input} model={model} theme={THEMES[0]} />, THEMES[0]);
  expect(screen.getByLabelText("Type de graphique")).toHaveValue("valeur");
  for (const genre of ["groupees", "ligne", "barres"]) {
    await userEvent.selectOptions(screen.getByLabelText("Type de graphique"), genre);
    expect(screen.getByLabelText("Type de graphique")).toHaveValue(genre);
  }
});


it("présente une valeur complexe et une dimension absente", async () => {
  const table = tableFromArrays({ region: ["Nord"], revenue: [1], detail: [[1, 2]] });
  renderThemed(<Resultat table={table} input={{ ...input, dimensions: ["region", "inconnue"] }} model={model} theme={THEMES[0]} />, THEMES[0]);
  await userEvent.click(screen.getByRole("tab", { name: "Tableau" }));
  expect(screen.getByRole("cell", { name: "Valeur complexe" })).toBeInTheDocument();
});

it("n'affiche pas les étiquettes de plus de quarante barres", () => {
  const table = tableFromArrays({ region: Array.from({ length: 41 }, (_, index) => `R${String(index)}`), revenue: Array.from({ length: 41 }, () => 1) });
  const { container } = renderThemed(<Resultat table={table} input={{ ...input, dimensions: ["region"] }} model={model} theme={THEMES[0]} />, THEMES[0]);
  const graphique = container.querySelector("[role=img]") as HTMLElement;
  const series = chartOf(graphique).getOption().series as { label: { show: boolean } }[];
  expect(series[0]?.label.show).toBe(false);
});

it("désactive Valeur quand plusieurs lignes sont chargées et revient au type proposé", async () => {
  const unique = tableFromArrays({ jour: ["A"], revenue: [1] });
  const plusieurs = tableFromArrays({ jour: ["A", "B"], revenue: [1, 2] });
  const demande = { ...input, dimensions: ["jour"] };
  const { rerender } = renderThemed(<Resultat table={unique} input={demande} model={model} theme={THEMES[0]} />, THEMES[0]);
  await userEvent.selectOptions(screen.getByLabelText("Type de graphique"), "valeur");
  rerender(<div className={`sb-theme-${THEMES[0].id}`}><Resultat table={plusieurs} input={demande} model={model} theme={THEMES[0]} /></div>);
  expect(screen.getByLabelText("Type de graphique")).toHaveValue("ligne");
  expect(screen.getByRole("option", { name: "Valeur" })).toBeDisabled();
  expect(screen.getByLabelText("Type de graphique")).toHaveAccessibleDescription("Valeur indisponible : le résultat contient plusieurs lignes.");
  rerender(<div className={`sb-theme-${THEMES[0].id}`}><Resultat table={unique} input={demande} model={model} theme={THEMES[0]} /></div>);
  expect(screen.getByLabelText("Type de graphique")).toHaveValue("ligne");
  expect(screen.getByRole("option", { name: "Valeur" })).toBeEnabled();
});

it("ne propose pas Valeur par défaut pour plusieurs lignes sans dimension", () => {
  renderThemed(<Resultat table={tableFromArrays({ revenue: [1, 2] })} input={input} model={model} theme={THEMES[0]} />, THEMES[0]);
  expect(screen.getByLabelText("Type de graphique")).toHaveValue("barres");
  expect(screen.getByRole("option", { name: "Valeur" })).toBeDisabled();
});


it("rend les dates et horodatages Arrow exacts dans le tableau, la ligne et son annonce", async () => {
  const d = makeVector(makeData({ type: new DateDay(), length: 1, data: new Int32Array([20000]) }));
  const d64 = makeVector(makeData({ type: new DateMillisecond(), length: 1, data: new BigInt64Array([-86400000n]) }));
  const s = makeVector(makeData({ type: new TimestampSecond("Europe/Paris"), length: 1, data: new BigInt64Array([1700000000n]) }));
  const ms = makeVector(makeData({ type: new TimestampMillisecond(), length: 1, data: new BigInt64Array([-1n]) }));
  const us = makeVector(makeData({ type: new TimestampMicrosecond("Europe/Paris"), length: 1, data: new BigInt64Array([1700000000123457n]) }));
  const ns = makeVector(makeData({ type: new TimestampNanosecond(), length: 1, data: new BigInt64Array([1700000000123456789n]) }));
  const vide = makeVector(makeData({ type: new DateDay(), length: 1, nullCount: 1, nullBitmap: new Uint8Array([0]), data: new Int32Array([0]) }));
  const table = tableFromIPC(tableToIPC(new Table({ date32: d, date64: d64, secondes: s, millisecondes: ms, jour: us, nanosecondes: ns, vide, revenue: makeVector(new Float64Array([12])) }), "stream"));
  const { container } = renderThemed(<Resultat table={table} input={{ ...input, dimensions: ["jour"] }} model={model} theme={THEMES[0]} />, THEMES[0]);
  expect(screen.getByLabelText("Type de graphique")).toHaveValue("ligne");
  const graphique = container.querySelector("[role=img]") as HTMLElement;
  const axes = chartOf(graphique).getOption().xAxis as { data: string[] }[];
  expect(axes[0]?.data).toEqual(["2023-11-14T22:13:20.123457Z"]);
  screen.getByRole("group", { name: "Résultat" }).focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(container.querySelector(".sb-visually-hidden[aria-live]")).toHaveTextContent("2023-11-14T22:13:20.123457Z : 12");
  await userEvent.click(screen.getByRole("tab", { name: "Tableau" }));
  for (const valeur of ["2024-10-04", "1969-12-31", "2023-11-14T22:13:20Z", "1969-12-31T23:59:59.999", "2023-11-14T22:13:20.123457Z", "2023-11-14T22:13:20.123456789", "—"]) {
    expect(screen.getByRole("cell", { name: valeur })).toBeInTheDocument();
  }
});


it("lit une époque temporelle hors de la plage sûre de JavaScript sans flottant", async () => {
  const type = new TimestampSecond();
  const vecteur = makeVector(makeData({ type, length: 2, nullCount: 1, nullBitmap: new Uint8Array([1]), data: new BigInt64Array([9007199254740993n, 0n]) }));
  const table = new Table({ jour: vecteur, revenue: makeVector(new Float64Array([1, 2])) });
  renderThemed(<Resultat table={table} input={{ ...input, dimensions: ["jour"] }} model={model} theme={THEMES[0]} />, THEMES[0]);
  await userEvent.click(screen.getByRole("tab", { name: "Tableau" }));
  expect(screen.getByRole("cell", { name: texteTemporel(9007199254740993n, type) })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "—" })).toBeInTheDocument();
});
