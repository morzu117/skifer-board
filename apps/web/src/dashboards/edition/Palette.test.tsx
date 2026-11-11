import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { decodeDashboardDraft } from "../document";
import { N, openEditor, sampleDraft } from "./testing";

const ready = async (options: Parameters<typeof openEditor>[0] = {}) => {
  const view = openEditor(options);
  await screen.findByRole("heading", { name: "Pilotage", level: 1 });
  return view;
};
const announce = () => document.querySelector(".sb-editor__announce")?.textContent ?? "";
const refusal = () => document.querySelector(".sb-banner--danger .sb-banner__text")?.textContent ?? "";
const add = (name: string) => userEvent.click(screen.getByRole("button", { name }));
const select = (name: string | RegExp) => userEvent.click(screen.getByRole("button", { name }));

describe("palette", () => {
  it("offre six genres de nœuds et l’ajout d’analyse", async () => {
    await ready();
    expect(screen.getAllByRole("button", { name: /^Ajouter / }).map((button) => button.textContent)).toEqual(["+ Section", "+ Rangée", "+ Colonne", "+ Conteneur", "+ Texte", "+ Séparateur", "Ajouter une analyse"]);
    expect(screen.getByText(/Ctrl ou Cmd \+ Maj \+ A/)).toBeInTheDocument();
  });

  it("une section se pose après la branche sélectionnée, ou en queue sans sélection", async () => {
    await ready();
    await add("Ajouter une section");
    expect(announce()).toBe("Section ajouté : Section 3, position 3 sur 3.");
    await select("Colonne 1 · 4/12");
    await add("Ajouter une section");
    expect(screen.getAllByRole("button", { name: /^Section \d/ }).map((button) => button.textContent)).toEqual(["Section 1 · Ventes", "Section 2", "Section 3", "Section 4"]);
    expect(announce()).toBe("Section ajouté : Section 2, position 2 sur 4.");
  });

  it("une rangée, une colonne, un texte, un séparateur et un conteneur se posent dans le plus proche parent qui les accueille", async () => {
    await ready();
    await select("Section 2");
    await add("Ajouter une rangée");
    expect(announce()).toBe("Rangée ajouté : Rangée 1, position 1 sur 1, dans Section 2.");
    await add("Ajouter une colonne");
    expect(announce()).toBe("Colonne ajouté : Colonne 1 · 12/12, position 1 sur 1, dans Rangée 1.");
    await add("Ajouter un texte");
    expect(announce()).toMatch(/^Texte ajouté : Texte, position 1 sur 1, dans Colonne 1 · 12\/12\.$/);
    await add("Ajouter un séparateur");
    expect(announce()).toBe("Séparateur ajouté : Séparateur, position 2 sur 2, dans Colonne 1 · 12/12.");
    await add("Ajouter un conteneur");
    expect(refusal()).toMatch(/^Refusé : /);
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(announce()).toBe("Dernière modification annulée.");
  });

  it("sans parent qui convienne, dit quoi sélectionner d'abord, sans rien poser", async () => {
    await ready();
    await select("Section 2");
    await add("Ajouter un texte");
    expect(refusal()).toBe("Sélectionnez d'abord une colonne pour y ajouter un texte.");
    expect(screen.getByText("Tout est enregistré")).toBeInTheDocument();
  });

  it("une colonne dans une rangée pleine est refusée par le modèle, avec sa raison", async () => {
    await ready();
    await userEvent.click(screen.getAllByRole("button", { name: /^Rangée 1$/ })[0] as HTMLElement);
    await add("Ajouter une colonne");
    expect(refusal()).toMatch(/^Refusé : /);
  });

  it("une rangée dans un document vide est refusée sans parent, et une section reste possible", async () => {
    await ready({ draft: decodeDashboardDraft({ ...sampleDraft(), filters: [], layout: { sections: [] } }), tiles: [] });
    await add("Ajouter une rangée");
    expect(refusal()).toBe("Sélectionnez d'abord une section ou un conteneur pour y ajouter une rangée.");
    await add("Ajouter une section");
    expect(announce()).toBe("Section ajouté : Section 1, position 1 sur 1.");
    expect(N.s1).toBeDefined();
  });

  it("est désactivée en lecture seule", async () => {
    await ready({ revise: false });
    for (const button of screen.getAllByRole("button", { name: /^Ajouter / })) expect(button).toBeDisabled();
  });
});
