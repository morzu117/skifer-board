import { screen } from "@testing-library/react";
import { tableFromArrays } from "apache-arrow";
import { describe, expect, it } from "vitest";
import champs from "../../../../contracts/executions/champs.json";
import exemple from "../../../../contracts/executions/contextuel-detail.json";
import { THEMES } from "../charts/theme";
import { decodeExecution, ERRORS, type ExecutionError } from "../executions/model";
import { expectAccessible, renderThemed } from "../test/a11y";
import { decodeFields } from "./model";
import { EtatResultat } from "./EtatResultat";

const run = decodeExecution(exemple.body, "finance");
const model = decodeFields(champs.body).models[0] as ReturnType<typeof decodeFields>["models"][number];
const input = { connection: "source", environment: "DEV" as const, model: "orders", metrics: ["revenue"], dimensions: [], filters: [{ column: "region", operator: "in" as const, value: ["Nord", "Sud"] }] };
const submitted = { input, model };
const empty = tableFromArrays({ revenue: [] as number[] });
const one = tableFromArrays({ revenue: [12] });

describe.each(THEMES)("états accessibles sous $label", (theme) => {
  it("montre le squelette annulable et l'annonce polie", async () => {
    const { container } = renderThemed(<EtatResultat run={{ ...run, state: "running", canCancel: true }} result={null} submitted={submitted} busy={false} failure={null} theme={theme} />, theme);
    expect(screen.getByText(/L'exécution peut être annulée/)).toBeInTheDocument();
    expect(container.querySelector('[aria-live="polite"]')).toBeInTheDocument();
    await expectAccessible(container);
  });
  it("distingue le résultat vide et les filtres de la demande soumise", async () => {
    const { container } = renderThemed(<EtatResultat run={run} result={empty} submitted={submitted} busy={false} failure={null} theme={theme} />, theme);
    expect(screen.getByText("Aucune ligne pour ce contexte.")).toBeInTheDocument();
    expect(screen.getByText("region · in · Nord, Sud")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Tableau" })).not.toBeInTheDocument();
    await expectAccessible(container);
  });
  it.each(["deny", "require_human"] as const)("affiche la décision %s sans lignes", async (code) => {
    const { container } = renderThemed(<EtatResultat run={{ ...run, state: "denied", errorCode: code, proof: null }} result={one} submitted={submitted} busy={false} failure={null} theme={theme} />, theme);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(code === "deny" ? "DENY" : "REQUIRE_HUMAN");
    expect(screen.getByText(/Raisons détaillées non fournies par le serveur/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await expectAccessible(container);
  });
  it("annonce une erreur de l'exécution", async () => {
    const { container } = renderThemed(<EtatResultat run={{ ...run, state: "timed_out", errorCode: "execution_timed_out" }} result={null} submitted={submitted} busy={false} failure={null} theme={theme} />, theme);
    expect(screen.getByText(/Délai d'exécution dépassé/)).toHaveTextContent(run.id);
    await expectAccessible(container);
  });
  it("montre la troncature sans attribuer de cause non fournie", async () => {
    const { container } = renderThemed(<EtatResultat run={{ ...run, truncated: true }} result={one} submitted={submitted} busy={false} failure={null} theme={theme} />, theme);
    expect(screen.getByText(/Résultat partiel/)).toHaveTextContent("le serveur ne précise pas laquelle");
    await expectAccessible(container);
  });
});

it.each(ERRORS.filter((code) => code !== "deny" && code !== "require_human"))("rend l'erreur fermée %s avec l'identifiant", (code: ExecutionError) => {
  renderThemed(<EtatResultat run={{ ...run, state: "failed", errorCode: code }} result={null} submitted={submitted} busy={false} failure={null} theme={THEMES[0]} />, THEMES[0]);
  expect(screen.getByText(new RegExp(run.id))).not.toHaveTextContent(code);
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

it("rend le vide sans filtre et le chargement sans capacité d'annulation", () => {
  const { rerender } = renderThemed(<EtatResultat run={null} result={null} submitted={submitted} busy failure={null} theme={THEMES[0]} />, THEMES[0]);
  expect(screen.getByText(/Chargement du résultat/)).not.toHaveTextContent("peut être annulée");
  rerender(<EtatResultat run={run} result={empty} submitted={{ ...submitted, input: { ...input, filters: [] } }} busy={false} failure={null} theme={THEMES[0]} />);
  expect(screen.getByText("Aucun filtre d'exploration.")).toBeInTheDocument();
});

it("affiche un filtre scalaire sans inventer de preuve absente", () => {
  const demande = { ...submitted, input: { ...input, filters: [{ column: "actif", operator: "eq" as const, value: true }] } };
  renderThemed(<EtatResultat run={{ ...run, proof: null }} result={empty} submitted={demande} busy={false} failure={null} theme={THEMES[0]} />, THEMES[0]);
  expect(screen.getByText("actif · eq · true")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Preuves" })).not.toBeInTheDocument();
});

it("rend une erreur de lecture avec l'identifiant, sans résultat ni alerte assertive", () => {
  renderThemed(<EtatResultat run={run} result={null} submitted={submitted} busy={false} failure={{ status: "error", message: "Le serveur Board ne répond pas." }} theme={THEMES[0]} />, THEMES[0]);
  expect(screen.getByText(/Le serveur Board ne répond pas/)).toHaveTextContent(run.id);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText(/Chargement du résultat/)).not.toBeInTheDocument();
});

it("distingue une annulation confirmée d'une annulation demandée", () => {
  renderThemed(<EtatResultat run={{ ...run, state: "cancelled", errorCode: "cancelled" }} result={null} submitted={submitted} busy={false} failure={null} theme={THEMES[0]} />, THEMES[0]);
  expect(screen.getByText(/Exécution annulée/)).toHaveTextContent(run.id);
  expect(screen.queryByText(/Chargement du résultat/)).not.toBeInTheDocument();
});
