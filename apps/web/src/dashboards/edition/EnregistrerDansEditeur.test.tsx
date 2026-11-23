import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { ANALYSES, N, openEditor, sampleDraft, type AnalysisSpec } from "./testing";

it("bloque les deux actions pendant une saisie non enregistrée", async () => {
  openEditor();
  await screen.findByRole("heading", { name: "Pilotage", level: 1 });
  const model = screen.getByRole("button", { name: "Enregistrer comme modèle" });
  await waitFor(() => { expect(model).toBeEnabled(); });
  fireEvent.change(screen.getByRole("textbox", { name: "Nom du dashboard" }), { target: { value: "Modifié" } });
  await waitFor(() => { expect(model).toBeDisabled(); });
  expect(screen.getByText("Enregistrez les modifications du dashboard avant de créer un contenu.")).toBeInTheDocument();
});
it("refuse localement une analyse personnelle et ne propose pas l'action sur le texte", async () => {
  openEditor({ analyses: { ...ANALYSES, [N.bars]: { ...ANALYSES[N.bars] as AnalysisSpec, visibility: "personal" } } });
  fireEvent.click(await screen.findByRole("button", { name: /^Visuel · Chiffre/ }));
  expect(await screen.findByText("Une analyse personnelle ne peut pas être enregistrée comme composant.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Enregistrer comme composant" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /^Texte/ }));
  expect(screen.queryByRole("button", { name: "Enregistrer comme composant" })).not.toBeInTheDocument();
});
it("bloque le modèle si un composant référencé n'est pas disponible", async () => {
  const base = sampleDraft();
  const draft = { ...base, filters: [], layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [{ id: N.visual, type: "component" as const, component: { component_id: N.text, revision: 1 } }] }] }] }] } };
  openEditor({ draft, tiles: [{ id: N.visual, state: "ready" }] });
  const action = await screen.findByRole("button", { name: "Enregistrer comme modèle" });
  expect(action).toBeDisabled();
  expect(await screen.findByText(/problèmes bloquants|composant référencé/)).toBeInTheDocument();
});
