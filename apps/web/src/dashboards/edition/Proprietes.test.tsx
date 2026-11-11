import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { decodeDashboardDraft } from "../document";
import { ANALYSES, N, openEditor, ROOT, sampleDraft } from "./testing";

const ready = async (options: Parameters<typeof openEditor>[0] = {}) => {
  const view = openEditor(options);
  await screen.findByRole("heading", { name: "Pilotage", level: 1 });
  return view;
};
const announce = () => document.querySelector(".sb-editor__announce")?.textContent ?? "";
const refusal = () => document.querySelector(".sb-banner--danger .sb-banner__text")?.textContent ?? "";
const select = async (label: string | RegExp) => { await userEvent.click(await screen.findByRole("button", { name: label })); };
const withPresentation = (visual: object, kpi: object = {}, defaults: object = {}) => decodeDashboardDraft({
  ...sampleDraft(), defaults,
  layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [
    { id: N.visual, type: "analysis", reference: { analysis_id: N.bars, revision: 1 }, presentation: visual },
    { id: N.kpi, type: "kpi", reference: { analysis_id: N.total, revision: 1 }, presentation: kpi },
  ] }] }] }] },
});
const VISUAL = /^Visuel · Chiffre d'affaires par région$/;
const start = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
const field = (name: string) => screen.getByRole("textbox", { name: start(name) });
const combo = (name: string) => screen.getByRole("combobox", { name: start(name) });

describe("propriétés du dashboard", () => {
  it("nom et description se valident à la sortie du champ, une modification à la fois", async () => {
    await ready();
    expect(screen.getByRole("heading", { name: "Propriétés · Dashboard" })).toBeInTheDocument();
    await userEvent.clear(field("Nom du dashboard"));
    await userEvent.type(field("Nom du dashboard"), "Nouveau nom");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Pilotage");
    await userEvent.tab();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Nouveau nom");
    expect(announce()).toBe("Nom modifié.");
    await userEvent.type(field("Description"), " Plus.");
    await userEvent.tab();
    expect(announce()).toBe("Description modifiée.");
    await userEvent.clear(field("Nom du dashboard"));
    await userEvent.type(field("Nom du dashboard"), "Par Entrée{Enter}");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Par Entrée");
    // Rien ne change si le texte revient à la valeur : pas de commande.
    await userEvent.type(field("Nom du dashboard"), "{Enter}");
    await userEvent.tab();
    await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(announce()).toBe("Dernière modification annulée.");
    expect(field("Nom du dashboard")).toHaveValue("Nouveau nom");
  });

  it("un nom vide est refusé par le modèle, avec la raison", async () => {
    await ready();
    await userEvent.clear(field("Nom du dashboard"));
    await userEvent.tab();
    expect(refusal()).toMatch(/^Refusé : /);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Pilotage");
  });

  it("la visibilité se choisit, et dit ce que le serveur refusera", async () => {
    await ready();
    expect(screen.getByText(/Un dashboard partagé ne peut épingler que des analyses partagées/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Partagé" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Personnel" }));
    expect(announce()).toBe("Visibilité : Personnel.");
    expect(screen.getByRole("radio", { name: "Personnel" })).toBeChecked();
    expect(screen.getByText(/Éditeur de dashboard · Personnel/)).toBeInTheDocument();
  });

  it("les valeurs par défaut se posent et se retirent, sans clé vide", async () => {
    await ready();
    await userEvent.selectOptions(combo("Légende"), "hidden");
    expect(announce()).toBe("Légende par défaut modifié.");
    await userEvent.selectOptions(combo("Format des nombres"), "percent");
    await userEvent.selectOptions(combo("Infobulle"), "value_and_definition");
    expect(combo("Légende")).toHaveValue("hidden");
    await userEvent.selectOptions(combo("Légende"), "");
    expect(announce()).toBe("Légende par défaut retiré.");
    expect(combo("Légende")).toHaveValue("");
    expect(combo("Format des nombres")).toHaveValue("percent");
  });
});

describe("propriétés d'une section, d'une colonne et des nœuds sans propriété", () => {
  it("le titre de la section se pose et se retire par un titre vide", async () => {
    await ready();
    await select("Section 1 · Ventes");
    expect(field("Titre de la section")).toHaveValue("Ventes");
    await userEvent.clear(field("Titre de la section"));
    await userEvent.type(field("Titre de la section"), "Chiffres");
    await userEvent.tab();
    expect(announce()).toBe("Titre de la section modifié.");
    expect(screen.getByRole("button", { name: "Section 1 · Chiffres" })).toBeInTheDocument();
    await userEvent.clear(field("Titre de la section"));
    await userEvent.tab();
    expect(announce()).toBe("Titre de la section retiré.");
    expect(screen.getByRole("button", { name: "Section 1" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Section 2" }));
    expect(field("Titre de la section")).toHaveValue("");
  });

  it("la largeur d'une colonne se règle en douzièmes ; un non-entier est refusé, un débordement aussi", async () => {
    await ready();
    await select("Colonne 1 · 4/12");
    const width = screen.getByRole("spinbutton", { name: "Largeur (douzièmes, de 1 à 12)" });
    expect(width).toHaveValue(4);
    await userEvent.clear(width);
    await userEvent.type(width, "3{Enter}");
    expect(announce()).toBe("Colonne 1 : largeur 3 douzièmes sur 12.");
    expect(screen.getByRole("button", { name: "Colonne 1 · 3/12" })).toBeInTheDocument();
    await userEvent.clear(width);
    await userEvent.type(width, "2.5{Enter}");
    expect(refusal()).toBe("La largeur est un nombre entier de douzièmes, de 1 à 12.");
    await userEvent.clear(width);
    await userEvent.type(width, "9{Enter}");
    expect(refusal()).toMatch(/^Refusé : Le dashboard ne serait plus valide\./);
  });

  it("un conteneur et un séparateur n'ont aucune propriété, et le disent", async () => {
    await ready();
    await select("Conteneur");
    expect(screen.getByText("Conteneur : aucune propriété. Il se place, se déplace et se supprime depuis la mise en page.")).toBeInTheDocument();
    await select("Séparateur");
    expect(screen.getByText(/^Séparateur : aucune propriété/)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: /^Rangée 1$/ })[0] as HTMLElement);
    expect(screen.getByText(/^Rangée : aucune propriété/)).toBeInTheDocument();
  });
});

describe("présentation d'un visuel (B9)", () => {
  it("dit l'origine de chaque champ et ne propose que les types de graphique compatibles", async () => {
    await ready();
    await select(VISUAL);
    expect(screen.getByText(/Analyse épinglée : Chiffre d'affaires par région · révision 1\. La présentation ne change jamais la requête soumise\./)).toBeInTheDocument();
    expect(field("Titre")).toHaveValue("Chiffre d'affaires par région");
    const origins = screen.getAllByText(/^Origine : /).map((badge) => badge.textContent);
    expect(origins).toEqual(["Origine : Analyse", "Origine : Analyse", "Origine : Thème", "Origine : Thème", "Origine : Thème"]);
    expect(within(combo("Type de graphique")).getAllByRole("option").map((option) => option.textContent)).toEqual(["Barres", "Ligne", "Barres groupées"]);
    expect(screen.getByText("Seuls les types compatibles avec les 1 dimension de l'analyse sont proposés.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retirer la surcharge/ })).not.toBeInTheDocument();
    expect(screen.getByText("Aucun seuil : ni l'analyse ni le dashboard n'en portent.")).toBeInTheDocument();
  });

  it("un KPI n'a ni type de graphique ni légende", async () => {
    await ready();
    await select(/^KPI · Total$/);
    expect(screen.queryByRole("combobox", { name: /^Type de graphique/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /^Légende/ })).not.toBeInTheDocument();
    expect(combo("Format des nombres")).toBeInTheDocument();
    await userEvent.selectOptions(combo("Format des nombres"), "integer");
    expect(announce()).toBe("Format des nombres modifié.");
    await userEvent.click(screen.getByRole("button", { name: "Retirer la surcharge : format des nombres" }));
    expect(announce()).toBe("Surcharge retirée : format des nombres.");
  });

  it("chaque surcharge se pose avec son origine « Composant » et se retire", async () => {
    await ready();
    await select(VISUAL);
    await userEvent.selectOptions(combo("Type de graphique"), "line");
    expect(announce()).toBe("Type de graphique modifié.");
    await userEvent.selectOptions(combo("Légende"), "hidden");
    await userEvent.selectOptions(combo("Format des nombres"), "decimal_2");
    await userEvent.selectOptions(combo("Infobulle"), "value_and_definition");
    await userEvent.clear(field("Titre"));
    await userEvent.type(field("Titre"), "Mon titre");
    await userEvent.tab();
    expect(announce()).toBe("Titre modifié.");
    expect(screen.getByRole("button", { name: /^Visuel · Mon titre$/ })).toBeInTheDocument();
    const removers = screen.getAllByRole("button", { name: /^Retirer la surcharge : / }).map((button) => button.textContent);
    expect(removers).toEqual(["Retirer la surcharge : titre", "Retirer la surcharge : type de graphique", "Retirer la surcharge : légende", "Retirer la surcharge : format des nombres", "Retirer la surcharge : infobulle"]);
    for (const name of removers) await userEvent.click(screen.getByRole("button", { name }));
    expect(screen.queryByRole("button", { name: /Retirer la surcharge/ })).not.toBeInTheDocument();
    expect(field("Titre")).toHaveValue("Chiffre d'affaires par région");
    expect(screen.getByText("Tout est enregistré")).toBeInTheDocument();
  });

  it("un titre vidé retire la surcharge de titre", async () => {
    await ready({ draft: withPresentation({ title: "Titre posé" }) });
    await select(/^Visuel · Titre posé$/);
    await userEvent.clear(field("Titre"));
    await userEvent.tab();
    expect(announce()).toBe("Surcharge retirée : titre.");
    expect(field("Titre")).toHaveValue("Chiffre d'affaires par région");
  });

  it("un type incompatible déjà posé est signalé, jamais masqué", async () => {
    await ready({ draft: withPresentation({ chart: "value" }), tiles: [{ id: N.visual, state: "ready" }, { id: N.kpi, state: "ready" }] });
    await select(/^Visuel/);
    expect(within(combo("Type de graphique")).getByRole("option", { name: "Valeur (incompatible)" })).toBeInTheDocument();
    expect(screen.getByText(/Type de graphique incompatible avec les dimensions de l'analyse\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Enregistrer$/ })).toBeDisabled();
  });

  it("les valeurs du dashboard se lisent avec leur origine, celles de l'analyse aussi pour le type", async () => {
    await ready({ draft: withPresentation({}, {}, { legend: "shown", number_format: "compact" }) });
    await select(/^Visuel/);
    expect(combo("Légende")).toHaveValue("shown");
    expect(combo("Format des nombres")).toHaveValue("compact");
    expect(screen.getAllByText("Origine : Dashboard")).toHaveLength(2);
  });

  it("le seuil : refuse une valeur ou un libellé manquant, se pose, se lit avec son origine et se retire", async () => {
    await ready();
    await select(VISUAL);
    await userEvent.click(screen.getByRole("button", { name: "Appliquer le seuil" }));
    expect(refusal()).toBe("Le seuil demande une valeur numérique.");
    await userEvent.type(screen.getByRole("spinbutton", { name: "Valeur du seuil" }), "5");
    await userEvent.click(screen.getByRole("button", { name: "Appliquer le seuil" }));
    expect(refusal()).toBe("Le seuil demande un libellé.");
    await userEvent.type(screen.getByRole("textbox", { name: "Libellé du seuil" }), "Cible");
    await userEvent.click(screen.getByRole("button", { name: "Appliquer le seuil" }));
    expect(announce()).toBe("Seuil modifié.");
    expect(screen.queryByText("Aucun seuil : ni l'analyse ni le dashboard n'en portent.")).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Valeur du seuil" })).toHaveValue(5);
    await userEvent.click(screen.getByRole("button", { name: "Retirer la surcharge : seuil" }));
    expect(announce()).toBe("Surcharge retirée : seuil.");
    expect(screen.getByRole("spinbutton", { name: "Valeur du seuil" })).toHaveValue(null);
  });

  it("sans analyse épinglée lisible, rien n'est deviné : avertissement, aucun champ", async () => {
    await ready({ analyses: {} });
    await select(/^Visuel/);
    expect(screen.getByText(/L'analyse épinglée n'est pas lue : sa présentation ne se modifie pas tant qu'elle n'est pas connue\./)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /^Titre/ })).not.toBeInTheDocument();
  });
});

describe("texte", () => {
  const textDraft = (blocks: object[]) => decodeDashboardDraft({ ...sampleDraft(), filters: [], layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [{ id: N.text, type: "text", blocks }] }] }] }] } });
  const open = async (blocks: object[]) => { await ready({ draft: textDraft(blocks), tiles: [] }); await select(/^Texte$/); };

  it("modifie un paragraphe, son gras et son italique, une commande à la fois", async () => {
    await open([{ type: "paragraph", content: [{ text: "Bonjour" }] }]);
    expect(screen.getByText(/^Bloc 1 · Paragraphe$/)).toBeInTheDocument();
    await userEvent.clear(screen.getByRole("textbox", { name: /^Texte/ }));
    await userEvent.type(screen.getByRole("textbox", { name: /^Texte/ }), "Salut");
    await userEvent.tab();
    expect(announce()).toBe("Bloc 1 modifié.");
    expect(document.querySelector(".sb-text")?.textContent).toBe("Salut");
    await userEvent.click(screen.getByRole("checkbox", { name: "Gras" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Italique" }));
    expect(document.querySelector(".sb-text strong em")?.textContent).toBe("Salut");
    await userEvent.click(screen.getByRole("checkbox", { name: "Gras" }));
    expect(document.querySelector(".sb-text strong")).toBeNull();
    expect(document.querySelector(".sb-text em")?.textContent).toBe("Salut");
    await userEvent.click(screen.getByRole("checkbox", { name: "Italique" }));
    expect(document.querySelector(".sb-text em")).toBeNull();
  });

  it("ajoute chaque genre de bloc, les déplace et les supprime", async () => {
    await open([]);
    expect(screen.getByText("Ce texte n'a aucun bloc.")).toBeInTheDocument();
    expect(screen.getByText("Texte vide : ajoutez des blocs dans les propriétés.")).toBeInTheDocument();
    for (const name of ["Paragraphe", "Intertitre 1", "Intertitre 2", "Liste à puces", "Liste numérotée"]) await userEvent.click(screen.getByRole("button", { name: `+ ${name}` }));
    expect(announce()).toBe("Liste numérotée ajouté.");
    expect(document.querySelectorAll(".sb-text > *")).toHaveLength(5);
    expect(document.querySelector(".sb-text__heading--1")?.textContent).toContain("Intertitre de niveau 1 : Nouveau texte");
    expect(document.querySelector(".sb-text__heading--2")).not.toBeNull();
    expect(document.querySelector(".sb-text ul")).not.toBeNull();
    expect(document.querySelector(".sb-text ol")).not.toBeNull();
    expect(screen.getByText("Bloc 2 · Intertitre 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Monter le bloc 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Descendre le bloc 5" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Descendre le bloc 1" }));
    expect(announce()).toBe("Bloc 1 déplacé en position 2.");
    expect(document.querySelector(".sb-text > :first-child")?.className).toContain("sb-text__heading--1");
    await userEvent.click(screen.getByRole("button", { name: "Monter le bloc 2" }));
    await userEvent.click(screen.getByRole("button", { name: "Supprimer le bloc 5" }));
    expect(announce()).toBe("Bloc 5 supprimé.");
    expect(document.querySelectorAll(".sb-text > *")).toHaveLength(4);
  });

  it("une liste : élément modifiable, ajout, retrait, numérotation", async () => {
    await open([{ type: "list", ordered: false, items: [[{ text: "Un" }], [{ text: "Deux" }]] }]);
    await userEvent.clear(screen.getByRole("textbox", { name: "Élément 1" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Élément 1" }), "Premier");
    await userEvent.tab();
    expect(document.querySelector(".sb-text li")?.textContent).toBe("Premier");
    await userEvent.click(screen.getByRole("button", { name: "Ajouter un élément" }));
    expect(document.querySelectorAll(".sb-text li")).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: "Retirer l'élément 2" }));
    expect(document.querySelectorAll(".sb-text li")).toHaveLength(2);
    await userEvent.click(screen.getByRole("checkbox", { name: "Liste numérotée" }));
    expect(document.querySelector(".sb-text ol")).not.toBeNull();
  });

  it("des segments multiples ou mêlés ne sont pas modifiables ici et restent intacts", async () => {
    await open([{ type: "paragraph", content: [{ text: "A ", strong: true }, { text: "b", emphasis: true }] }, { type: "heading", level: 2, content: [{ text: "T" }] }]);
    expect(screen.getByText("Texte : plusieurs segments, non modifiables ici. Le texte reste tel quel.")).toBeInTheDocument();
    expect(document.querySelector(".sb-text strong")?.textContent).toBe("A ");
    expect(document.querySelector(".sb-text em")?.textContent).toBe("b");
    expect(screen.getByRole("textbox", { name: /^Texte/ })).toHaveValue("T");
  });
});

describe("lecture seule", () => {
  it("les propriétés sont lisibles et désactivées", async () => {
    await ready({ revise: false });
    await select(VISUAL);
    expect(field("Titre")).toBeDisabled();
    expect(combo("Légende")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Appliquer le seuil" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Texte" }));
    expect(screen.getByRole("button", { name: "+ Paragraphe" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: /^Texte/ })).toBeDisabled();
    expect(fireEvent.click(screen.getByRole("button", { name: "Monter le bloc 1" }))).toBe(true);
    await waitFor(() => { expect(ANALYSES[N.bars]).toBeDefined(); });
    expect(ROOT).toContain("finance");
  });
});

describe("cas limites", () => {
  it("appliquer deux fois le même seuil ne change rien et le dit", async () => {
    await ready();
    await select(VISUAL);
    await userEvent.type(screen.getByRole("spinbutton", { name: "Valeur du seuil" }), "5");
    await userEvent.type(screen.getByRole("textbox", { name: "Libellé du seuil" }), "Cible");
    await userEvent.click(screen.getByRole("button", { name: "Appliquer le seuil" }));
    expect(announce()).toBe("Seuil modifié.");
    await userEvent.click(screen.getByRole("button", { name: "Appliquer le seuil" }));
    expect(announce()).toBe("Aucun changement.");
  });

  it("une analyse à deux dimensions le dit au pluriel", async () => {
    const two = { ...(ANALYSES[N.bars] as (typeof ANALYSES)[string]), query: { ...(ANALYSES[N.bars] as (typeof ANALYSES)[string]).query, dimensions: ["region", "channel"] } };
    await ready({ analyses: { ...ANALYSES, [N.bars]: two } });
    await select(VISUAL);
    expect(screen.getByText("Seuls les types compatibles avec les 2 dimensions de l'analyse sont proposés.")).toBeInTheDocument();
  });
});

describe("texte à plusieurs blocs", () => {
  it("modifier un bloc laisse les autres tels quels", async () => {
    const draft = decodeDashboardDraft({ ...sampleDraft(), filters: [], layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [{ id: N.text, type: "text", blocks: [
      { type: "paragraph", content: [{ text: "Un" }] }, { type: "paragraph", content: [{ text: "Deux" }] },
    ] }] }] }] }] } });
    await ready({ draft, tiles: [] });
    await select(/^Texte$/);
    const boxes = screen.getAllByRole("textbox", { name: /^Texte/ });
    await userEvent.clear(boxes[1] as HTMLElement);
    await userEvent.type(boxes[1] as HTMLElement, "Second");
    await userEvent.tab();
    expect(document.querySelector(".sb-text")?.textContent).toBe("UnSecond");
    await userEvent.clear(boxes[0] as HTMLElement);
    await userEvent.type(boxes[0] as HTMLElement, "Premier");
    await userEvent.tab();
    expect(document.querySelector(".sb-text")?.textContent).toBe("PremierSecond");
  });
});
