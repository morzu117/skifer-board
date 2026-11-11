import { createEvent, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decodeDashboardDraft } from "../document";
import { SHORTCUTS } from "./Canevas";
import { N, openEditor, sampleDraft } from "./testing";

const ready = async (options: Parameters<typeof openEditor>[0] = {}) => {
  const view = openEditor(options);
  await screen.findByRole("heading", { name: "Pilotage", level: 1 });
  return view;
};
const announce = () => document.querySelector(".sb-editor__announce")?.textContent ?? "";
const refusal = () => document.querySelector(".sb-banner--danger .sb-banner__text")?.textContent ?? "";
const node = (label: string | RegExp) => screen.getByRole("button", { name: label });
const slider = (id: string) => document.getElementById(`sb-handle-${id}`) as HTMLElement;
const frame = (id: string) => document.querySelector(`[data-node="${id}"]`) as HTMLElement;
const labels = () => [...document.querySelectorAll(".sb-node__select")].map((button) => button.textContent);

afterEach(() => { vi.restoreAllMocks(); });

/** jsdom n'a pas de `DragEvent` : les coordonnées du pointeur sont posées sur l'évènement. */
const dragAt = (target: Element, type: "dragOver" | "drop", at: { clientX?: number; clientY?: number } = {}): void => {
  const event = createEvent[type](target);
  for (const [name, value] of Object.entries(at)) Object.defineProperty(event, name, { value });
  fireEvent(target, event);
};

describe("sélection et rendu", () => {
  it("dessine la mise en page, sélectionne un nœud et ouvre ses propriétés", async () => {
    await ready();
    await screen.findByRole("button", { name: "Visuel · Chiffre d'affaires par région" });
    await screen.findByRole("button", { name: "KPI · Total" });
    expect(labels()).toEqual([
      "Section 1 · Ventes", "Rangée 1", "Colonne 1 · 4/12", "Visuel · Chiffre d'affaires par région", "Texte", "Colonne 2 · 4/12", "KPI · Total", "Séparateur",
      "Colonne 3 · 4/12", "Conteneur", "Rangée 1", "Colonne 1 · 12/12", "Section 2",
    ]);
    expect(screen.getByText("Bonjour")).toBeInTheDocument();
    expect(document.querySelector("hr.sb-node__rule")).not.toBeNull();
    expect(screen.getByText("Colonne vide : ajoutez-y un texte, un séparateur ou un conteneur.")).toBeInTheDocument();
    expect(screen.getByText("Section vide : ajoutez-y une rangée.")).toBeInTheDocument();
    expect(node("Texte")).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(node("Texte"));
    expect(node("Texte")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Propriétés · Texte" })).toBeInTheDocument();
    expect(frame(N.text)).toHaveClass("sb-node--selected");
  });

  it("documente ses raccourcis, que chaque nœud référence", async () => {
    await ready();
    const help = document.getElementById("sb-canvas-help") as HTMLElement;
    for (const shortcut of SHORTCUTS) expect(within(help).getByText(shortcut.keys)).toBeInTheDocument();
    expect(node("Texte")).toHaveAttribute("aria-describedby", "sb-canvas-help");
  });

  it("dit les états vides : aucune section, rangée, colonne, conteneur", async () => {
    const { unmount } = await ready({ draft: decodeDashboardDraft({ ...sampleDraft(), filters: [], layout: { sections: [] } }), tiles: [] });
    expect(screen.getByText("Aucune section : ajoutez-en une avec la palette.")).toBeInTheDocument();
    unmount();
    await ready({ tiles: [], draft: decodeDashboardDraft({ ...sampleDraft(), filters: [], layout: { sections: [
      { id: N.s1, rows: [{ id: N.r1, columns: [] }, { id: N.r2, columns: [{ id: N.c1, span: 12, children: [{ id: N.box, type: "container", rows: [] }] }] }] },
    ] } }) });
    expect(screen.getByText("Rangée vide : ajoutez-y une colonne.")).toBeInTheDocument();
    expect(screen.getByText("Conteneur vide : ajoutez-y une rangée.")).toBeInTheDocument();
  });
});

describe("déplacement au clavier", () => {
  it("Alt + flèche déplace d'un cran parmi les frères, annonce la place et garde le focus", async () => {
    await ready();
    node("Texte").focus();
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(announce()).toBe("Déplacé : Texte, position 1 sur 2, dans Colonne 1 · 4/12.");
    expect(labels().slice(3, 5)).toEqual(["Texte", "Visuel · Chiffre d'affaires par région"]);
    await waitFor(() => { expect(node("Texte")).toHaveFocus(); });
    await userEvent.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    expect(refusal()).toBe("Texte : déjà en première position.");
    await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(announce()).toContain("Texte, position 2 sur 2");
    await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(refusal()).toBe("Texte : déjà en dernière position.");
  });

  it("Alt + Maj + flèche passe dans le parent suivant ou précédent, et le modèle peut refuser", async () => {
    await ready();
    const press = (label: string, key: string) => { node(label).focus(); fireEvent.keyDown(node(label), { key, altKey: true, shiftKey: true }); };
    press("Texte", "ArrowRight");
    expect(announce()).toBe("Déplacé dans un autre parent : Texte, position 1 sur 3, dans Colonne 2 · 4/12.");
    press("Texte", "ArrowLeft");
    expect(announce()).toContain("dans Colonne 1 · 4/12");
    press("Texte", "ArrowUp");
    expect(refusal()).toBe("Texte : aucun parent précédent ne l'accueille.");
    // Le conteneur est seul dans sa colonne : y ajouter un texte est refusé, avec la raison fermée du modèle.
    press("Texte", "ArrowRight");
    press("Texte", "ArrowRight");
    expect(refusal()).toMatch(/^Refusé : Le dashboard ne serait plus valide\./);
    press("Conteneur", "ArrowDown");
    expect(refusal()).toBe("Conteneur : aucun parent suivant ne l'accueille.");
  });

  it("Maj + gauche ou droite sur une colonne la rétrécit ou l'élargit d'un douzième", async () => {
    await ready();
    node("Colonne 1 · 4/12").focus();
    await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(announce()).toBe("Colonne 1 : largeur 3 douzièmes sur 12.");
    expect(node("Colonne 1 · 3/12")).toHaveFocus();
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(announce()).toBe("Colonne 1 : largeur 4 douzièmes sur 12.");
    // La rangée est pleine : l'élargir fait déborder les douze douzièmes, le modèle refuse.
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(refusal()).toMatch(/^Refusé : Le dashboard ne serait plus valide\./);
    expect(node("Colonne 1 · 4/12")).toBeInTheDocument();
  });

  it("une colonne ne descend pas sous un douzième ni ne dépasse douze", async () => {
    await ready();
    const sole = node(/^Colonne 1 · 12\/12$/);
    sole.focus();
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(refusal()).toBe("Colonne 1 : la largeur reste entre 1 et 12 douzièmes.");
    for (let step = 0; step < 11; step += 1) await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(announce()).toBe("Colonne 1 : largeur 1 douzièmes sur 12.");
    await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(refusal()).toBe("Colonne 1 : la largeur reste entre 1 et 12 douzièmes.");
  });

  it("Suppr supprime le nœud avec son contenu, sélectionne son parent et lui donne le focus ; Alt + Suppr est ignoré", async () => {
    await ready();
    await userEvent.click(node("Texte"));
    node("Texte").focus();
    await userEvent.keyboard("{Alt>}{Delete}{/Alt}");
    expect(node("Texte")).toBeInTheDocument();
    await userEvent.keyboard("{Delete}");
    expect(announce()).toBe("Texte supprimé, avec ce qu'il contenait.");
    expect(screen.queryByText("Bonjour")).not.toBeInTheDocument();
    expect(node("Colonne 1 · 4/12")).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => { expect(node("Colonne 1 · 4/12")).toHaveFocus(); });
    node("Section 2").focus();
    await userEvent.keyboard("{Delete}");
    expect(screen.getByRole("heading", { name: "Propriétés · Dashboard" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Section 2" })).not.toBeInTheDocument();
  });

  it("une autre touche n'a aucun effet", async () => {
    await ready();
    node("Texte").focus();
    await userEvent.keyboard("{Shift>}{ArrowUp}{/Shift}a");
    expect(announce()).toBe("");
    expect(screen.getByText("Tout est enregistré")).toBeInTheDocument();
  });
});

describe("poignée de largeur", () => {
  it("expose un curseur accessible : bornes, valeur, texte, orientation", async () => {
    await ready();
    const handle = slider(N.c1);
    expect(handle).toHaveAttribute("role", "slider");
    expect(handle).toHaveAttribute("aria-valuemin", "1");
    expect(handle).toHaveAttribute("aria-valuemax", "12");
    expect(handle).toHaveAttribute("aria-valuenow", "4");
    expect(handle).toHaveAttribute("aria-valuetext", "4 douzièmes sur 12");
    expect(handle).toHaveAttribute("aria-orientation", "horizontal");
    expect(handle).toHaveAttribute("aria-readonly", "false");
    expect(handle).toHaveAttribute("tabindex", "0");
  });

  it.each([
    ["{ArrowLeft}", 3], ["{ArrowDown}", 3], ["Home", 1],
  ])("la touche %s règle la largeur à %i", async (key, span) => {
    await ready();
    slider(N.c1).focus();
    await userEvent.keyboard(key === "Home" ? "{Home}" : key);
    expect(announce()).toBe(`Colonne 1 : largeur ${String(span)} douzièmes sur 12.`);
    await waitFor(() => { expect(slider(N.c1)).toHaveFocus(); });
  });

  it.each(["{ArrowRight}", "{ArrowUp}", "{End}"])("la touche %s élargit au-delà de la rangée : refusée avec la raison du modèle", async (key) => {
    await ready();
    slider(N.c1).focus();
    await userEvent.keyboard(key);
    expect(refusal()).toMatch(/^Refusé : Le dashboard ne serait plus valide\./);
    expect(slider(N.c1)).toHaveAttribute("aria-valuenow", "4");
  });

  it("une autre touche est ignorée", async () => {
    await ready();
    slider(N.c1).focus();
    await userEvent.keyboard("a{Tab}");
    expect(announce()).toBe("");
  });
});

describe("redimensionnement au pointeur", () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function rect(this: Element) {
      return this.hasAttribute("data-row") ? { width: 1200, height: 100, top: 0, left: 0, right: 1200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) } : { width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) };
    });
  });

  it("montre la largeur pendant le glissement et l'enregistre au relâchement", async () => {
    await ready();
    const handle = slider(N.c1);
    fireEvent.pointerDown(handle, { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 400 });
    expect(handle).toHaveAttribute("aria-valuenow", "3");
    expect(frame(N.c1).style.getPropertyValue("--span")).toBe("3");
    expect(announce()).toBe("");
    fireEvent.pointerUp(window);
    expect(announce()).toBe("Colonne 1 : largeur 3 douzièmes sur 12.");
    expect(slider(N.c1)).toHaveAttribute("aria-valuenow", "3");
    await waitFor(() => { expect(slider(N.c1)).toHaveFocus(); });
    // Les écouteurs sont retirés : un mouvement ultérieur ne change plus rien.
    fireEvent.pointerMove(window, { clientX: 900 });
    expect(slider(N.c1)).toHaveAttribute("aria-valuenow", "3");
  });

  it("un relâchement sans changement n'écrit rien, et la largeur reste entre 1 et 12", async () => {
    await ready();
    const handle = slider(N.c1);
    fireEvent.pointerDown(handle, { clientX: 500 });
    fireEvent.pointerUp(window);
    expect(announce()).toBe("");
    fireEvent.pointerDown(handle, { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: -5000 });
    expect(handle).toHaveAttribute("aria-valuenow", "1");
    fireEvent.pointerMove(window, { clientX: 5000 });
    expect(handle).toHaveAttribute("aria-valuenow", "12");
    fireEvent.pointerUp(window);
    expect(refusal()).toMatch(/^Refusé : /);
    expect(handle).toHaveAttribute("aria-valuenow", "4");
  });

  it("en lecture seule, la poignée ne réagit pas", async () => {
    await ready({ revise: false });
    const handle = slider(N.c1);
    expect(handle).toHaveAttribute("aria-readonly", "true");
    expect(handle).toHaveAttribute("tabindex", "-1");
    fireEvent.pointerDown(handle, { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 400 });
    expect(handle).toHaveAttribute("aria-valuenow", "4");
  });
});

describe("glisser-déposer", () => {
  const transfer = () => ({ setData: vi.fn(), effectAllowed: "" });
  beforeEach(() => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
  });

  it("déplace un nœud avant ou après un autre de sa famille, selon la moitié visée", async () => {
    await ready();
    const text = node("Texte");
    expect(text).toHaveAttribute("draggable", "true");
    const data = transfer();
    fireEvent.dragStart(text, { dataTransfer: data });
    expect(data.setData).toHaveBeenCalledWith("text/plain", N.text);
    dragAt(frame(N.visual), "dragOver", { clientY: 10 });
    expect(frame(N.visual)).toHaveAttribute("data-drop", "before");
    dragAt(frame(N.visual), "dragOver", { clientY: 90 });
    expect(frame(N.visual)).toHaveAttribute("data-drop", "after");
    dragAt(frame(N.visual), "dragOver", { clientY: 95 });
    expect(frame(N.visual)).toHaveAttribute("data-drop", "after");
    dragAt(frame(N.visual), "dragOver", { clientY: 10 });
    dragAt(frame(N.visual), "drop", { clientY: 10 });
    expect(announce()).toBe("Déplacé : Texte, position 1 sur 2, dans Colonne 1 · 4/12.");
    expect(frame(N.visual)).not.toHaveAttribute("data-drop");
    expect(labels().slice(3, 5)).toEqual(["Texte", "Visuel · Chiffre d'affaires par région"]);
  });

  it("sur une colonne, la moitié se juge sur l'axe horizontal ; sur le parent qui l'accueille, en queue", async () => {
    await ready();
    fireEvent.dragStart(node("Colonne 1 · 4/12"), { dataTransfer: transfer() });
    dragAt(frame(N.c2), "dragOver", { clientX: 90 });
    expect(frame(N.c2)).toHaveAttribute("data-drop", "after");
    dragAt(frame(N.c2), "drop", { clientX: 90 });
    expect(announce()).toBe("Déplacé : Colonne 2 · 4/12, position 2 sur 3, dans Rangée 1.");
    fireEvent.dragStart(node("Séparateur"), { dataTransfer: transfer() });
    dragAt(frame(N.c1), "drop", {});
    expect(announce()).toBe("Déplacé : Séparateur, position 3 sur 3, dans Colonne 2 · 4/12.");
  });

  it("ne propose que ce que le modèle accepterait : cible hors famille, soi-même, sans glisser", async () => {
    await ready();
    dragAt(frame(N.visual), "dragOver", { clientY: 10 });
    expect(frame(N.visual)).not.toHaveAttribute("data-drop");
    dragAt(frame(N.visual), "drop", { clientY: 10 });
    expect(announce()).toBe("");
    fireEvent.dragStart(node("Texte"), { dataTransfer: transfer() });
    dragAt(frame(N.s2), "dragOver", { clientY: 10 });
    expect(frame(N.s2)).not.toHaveAttribute("data-drop");
    dragAt(frame(N.s2), "drop", { clientY: 10 });
    dragAt(frame(N.text), "dragOver", { clientY: 10 });
    expect(frame(N.text)).not.toHaveAttribute("data-drop");
    fireEvent.dragEnd(node("Texte"));
    dragAt(frame(N.visual), "dragOver", { clientY: 10 });
    expect(frame(N.visual)).not.toHaveAttribute("data-drop");
    expect(announce()).toBe("");
  });

  it("un dépôt que le modèle refuse dit sa raison ; la fin du glisser efface l'indication", async () => {
    await ready();
    fireEvent.dragStart(node("Texte"), { dataTransfer: transfer() });
    dragAt(frame(N.c3), "dragOver", { clientX: 10 });
    expect(frame(N.c3)).toHaveAttribute("data-drop", "before");
    fireEvent.dragEnd(node("Texte"));
    expect(frame(N.c3)).not.toHaveAttribute("data-drop");
    fireEvent.dragStart(node("Texte"), { dataTransfer: transfer() });
    dragAt(frame(N.c3), "drop", {});
    expect(refusal()).toMatch(/^Refusé : /);
  });

  it("en lecture seule, rien ne se glisse", async () => {
    await ready({ revise: false });
    expect(node("Texte")).toHaveAttribute("draggable", "false");
  });
});
