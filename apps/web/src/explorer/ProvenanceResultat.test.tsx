import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import exemple from "../../../../contracts/executions/contextuel-detail.json";
import { THEMES } from "../charts/theme";
import { expectAccessible, renderThemed } from "../test/a11y";
import { decodeExecution } from "../executions/model";
import { age, certification, ProvenanceResultat } from "./ProvenanceResultat";

const run = decodeExecution(exemple.body, "finance");
if (run.proof === null) throw new Error("Preuve attendue");
const avecPreuve = { ...run, proof: run.proof };

it.each([true, false])("copie ou signale l'échec (%s)", async (ok) => {
  const writeText = vi.fn().mockImplementation(() => ok ? Promise.resolve() : Promise.reject(new Error()));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  render(<ProvenanceResultat run={avecPreuve} />);
  await userEvent.click(screen.getByRole("button", { name: "Copier l'empreinte" }));
  expect(await screen.findByText(ok ? "Empreinte copiée." : "Copie indisponible.")).toBeInTheDocument();
  expect(writeText).toHaveBeenCalledWith(avecPreuve.proof.sqlHash);
});

it("résume la certification et l'âge sans inventer d'information", () => {
  const source = avecPreuve.proof.sources[0];
  if (source === undefined) throw new Error("Source attendue");
  const cert = { ...source, certification_status: "CERTIFIED", data_age_seconds: 5 };
  const non = { ...source, certification_status: "UNCERTIFIED", data_age_seconds: 10 };
  expect(certification([cert])).toBe("certifié");
  expect(certification([non])).toBe("non certifié");
  expect(certification([cert, non])).toBe("mixte");
  expect(certification([source])).toBe("inconnue");
  expect(age([cert, non])).toBe("10 s");
  expect(age([cert, source])).toBe("inconnu");
});

describe.each(THEMES)("preuves accessibles sous $label", (theme) => {
  it("ouvre le panneau, rend la preuve expurgée et rend le focus à la fermeture", async () => {
    const proof = { ...avecPreuve.proof, filters: [...avecPreuve.proof.filters, { column: "region", operator: "eq", origin: "exploration" as const, modelKey: null, value: "<redacted>", definitionHash: null }] };
    const { container } = renderThemed(<ProvenanceResultat run={{ ...avecPreuve, proof }} />, theme);
    const bouton = screen.getByRole("button", { name: "Preuves" });
    await userEvent.click(bouton);
    const panneau = screen.getByRole("region", { name: "Preuves" });
    expect(panneau).toHaveFocus();
    expect(panneau).toHaveTextContent("Imposé par vos droits (non retirable)");
    expect(panneau).toHaveTextContent("Exploration");
    expect(panneau).toHaveTextContent("CERTIFIED");
    expect(panneau).not.toHaveTextContent("SELECT");
    await expectAccessible(container);
    await userEvent.keyboard("{Escape}");
    expect(bouton).toHaveFocus();
    await userEvent.click(bouton);
    expect(bouton).toHaveAttribute("aria-expanded", "true");
    expect(bouton).toHaveAttribute("aria-controls", screen.getByRole("region", { name: "Preuves" }).id);
    await userEvent.click(bouton);
    expect(bouton).toHaveFocus();
  });
});

it("présente les détails disponibles et les absences explicites", async () => {
  const source = avecPreuve.proof.sources[0];
  if (source === undefined) throw new Error("Source attendue");
  const proof = { ...avecPreuve.proof, duration: null, statementId: null, policy: { ...avecPreuve.proof.policy, reasons: ["Avertissement"] }, sources: [{ ...source, data_age_seconds: 15, load_age_seconds: 30 }], filters: [{ column: "base_filter", operator: "sql", origin: "policy" as const, modelKey: "orders", definitionHash: "empreinte", value: null }] };
  render(<ProvenanceResultat run={{ ...avecPreuve, proof, truncated: true }} />);
  const bouton = screen.getByRole("button", { name: "Preuves" });
  await userEvent.click(bouton);
  await userEvent.keyboard("{ArrowDown}");
  const panneau = screen.getByRole("region", { name: "Preuves" });
  expect(panneau).toHaveTextContent("sans valeur · empreinte empreinte");
  expect(panneau).toHaveTextContent("âge des données 15 s · âge du chargement 30 s");
  expect(panneau).toHaveTextContent("Avertissement");
  expect(panneau).toHaveTextContent("durée inconnue · identifiant de requête inconnu");
  expect(panneau).toHaveTextContent("résultat tronqué");
  await userEvent.click(bouton);
  expect(screen.queryByRole("region", { name: "Preuves" })).not.toBeInTheDocument();
});
