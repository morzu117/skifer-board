import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { navigate } from "../../shell/route";
import { expectAccessible } from "../../test/a11y";
import { ID, route } from "../testing";
import { decodeDashboardDraft } from "../document";
import { ANALYSES, dashboardBody, echo, N, openEditor, ROOT, sampleDraft, type AnalysisSpec, type TileInfo } from "./testing";

afterEach(() => { window.history.replaceState(null, "", "/"); });

const ready = async (options: Parameters<typeof openEditor>[0] = {}) => {
  const view = openEditor(options);
  await screen.findByRole("heading", { name: options.draft?.name ?? "Pilotage", level: 1 });
  return view;
};
const toolbar = () => within(screen.getByRole("toolbar", { name: "Actions de l'éditeur" }));
const announce = () => document.querySelector(".sb-editor__announce")?.textContent ?? "";
const add = (name: string) => userEvent.click(screen.getByRole("button", { name }));
const select = (name: RegExp) => userEvent.click(screen.getByRole("button", { name }));
const unavailable = (reason: string): TileInfo[] => [{ id: N.visual, state: "unavailable", reason }, { id: N.kpi, state: "ready" }];
const refused = (name: string) => { const example = route(name); return Response.json(example.body, { status: example.status }); };

describe("ouverture", () => {
  it("annonce l'état, la révision, la visibilité et dit que tout est enregistré", async () => {
    await ready();
    expect(screen.getByText(/Éditeur de dashboard · Partagé · révision 1/)).toBeInTheDocument();
    expect(screen.getByText("Prêt")).toBeInTheDocument();
    expect(screen.getByText("Toutes les tuiles sont prêtes.")).toBeInTheDocument();
    expect(screen.getByText("Tout est enregistré")).toBeInTheDocument();
    expect(toolbar().getByRole("button", { name: "Annuler" })).toBeDisabled();
    expect(toolbar().getByRole("button", { name: "Rétablir" })).toBeDisabled();
  });

  it("une révision dont l'état est en retard ou non vérifié le dit avec sa raison", async () => {
    await ready({ state: "unverified", tiles: [{ id: N.visual, state: "unverified" }, { id: N.kpi, state: "unverified" }] });
    expect(screen.getByText("Non vérifié")).toBeInTheDocument();
    expect(screen.getByText(/aucune n'est exécutée/)).toBeInTheDocument();
  });

  it("sans droit de révision : lecture seule déclarée, rien ne se modifie ni ne s'enregistre", async () => {
    const { server } = await ready({ revise: false });
    expect(screen.getByText(/il s'ouvre en lecture seule/)).toBeInTheDocument();
    expect(toolbar().getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ajouter une section" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Nom du dashboard" })).toBeDisabled();
    // Un raccourci n'est pas ignoré en silence : le refus est dit.
    const node = screen.getByRole("button", { name: "Section 2" });
    node.focus();
    await userEvent.keyboard("{Delete}");
    expect(screen.getByText("Le serveur n'accorde pas la modification de ce dashboard à votre compte.", { selector: ".sb-banner__text" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Section 2" })).toBeInTheDocument();
    fireEvent.keyDown(node, { key: "ArrowDown", altKey: true });
    fireEvent.keyDown(screen.getAllByRole("slider", { name: "Largeur de Colonne 1" })[0] as HTMLElement, { key: "ArrowRight" });
    expect(server.saved()).toEqual([]);
  });
});

describe("édition, annulation et enregistrement", () => {
  it("ajoute une section par la palette, l'annonce, puis annule et rétablit", async () => {
    await ready();
    await add("Ajouter une section");
    expect(announce()).toBe("Section ajouté : Section 3, position 3 sur 3.");
    expect(screen.getByText("Modifications non enregistrées")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Section 3" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(toolbar().getByRole("button", { name: "Annuler" }));
    expect(announce()).toBe("Dernière modification annulée.");
    expect(screen.queryByRole("button", { name: "Section 3" })).not.toBeInTheDocument();
    expect(screen.getByText("Tout est enregistré")).toBeInTheDocument();
    await userEvent.click(toolbar().getByRole("button", { name: "Rétablir" }));
    expect(announce()).toBe("Modification rétablie.");
    expect(screen.getByRole("button", { name: "Section 3" })).toBeInTheDocument();
  });

  it("annule et rétablit au clavier, hors des champs de saisie, et dit quand il n'y a rien", async () => {
    await ready();
    fireEvent.keyDown(screen.getByRole("heading", { name: "Mise en page" }), { key: "z", ctrlKey: true });
    expect(announce()).toBe("Rien à annuler.");
    fireEvent.keyDown(screen.getByRole("heading", { name: "Mise en page" }), { key: "y", ctrlKey: true });
    expect(announce()).toBe("Rien à rétablir.");
    await add("Ajouter une section");
    fireEvent.keyDown(screen.getByRole("heading", { name: "Mise en page" }), { key: "z", metaKey: true });
    expect(announce()).toBe("Dernière modification annulée.");
    fireEvent.keyDown(screen.getByRole("heading", { name: "Mise en page" }), { key: "z", metaKey: true, shiftKey: true });
    expect(announce()).toBe("Modification rétablie.");
    fireEvent.keyDown(screen.getByRole("heading", { name: "Mise en page" }), { key: "z", ctrlKey: true });
    // Dans un champ de saisie, Ctrl+Z reste celui du champ.
    const field = screen.getByRole("textbox", { name: "Nom du dashboard" });
    fireEvent.keyDown(field, { key: "z", ctrlKey: true });
    fireEvent.keyDown(field, { key: "y", ctrlKey: true });
    fireEvent.keyDown(screen.getByRole("heading", { name: "Mise en page" }), { key: "a", ctrlKey: true });
    fireEvent.keyDown(screen.getByRole("heading", { name: "Mise en page" }), { key: "z" });
    expect(announce()).toBe("Dernière modification annulée.");
  });

  it("une annonce identique à la précédente reste distincte pour être relue", async () => {
    await ready();
    fireEvent.keyDown(screen.getByRole("heading", { name: "Mise en page" }), { key: "z", ctrlKey: true });
    const first = announce();
    fireEvent.keyDown(screen.getByRole("heading", { name: "Mise en page" }), { key: "z", ctrlKey: true });
    expect(announce()).toBe(`${first}${String.fromCharCode(160)}`);
  });

  it("enregistre avec la révision attendue, puis la suivante avec la révision rendue", async () => {
    const { server } = await ready();
    await add("Ajouter une section");
    await userEvent.click(toolbar().getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Révision 2 enregistrée.");
    expect(server.saved()).toHaveLength(1);
    const body = server.saved()[0] as { expected_revision: number; layout: { sections: unknown[] }; name: string };
    expect(body.expected_revision).toBe(1);
    expect(body.layout.sections).toHaveLength(3);
    expect(Object.keys(body)).not.toContain("id");
    expect(screen.getByText("Tout est enregistré")).toBeInTheDocument();
    expect(screen.getByText(/révision 2/)).toBeInTheDocument();
    await add("Ajouter une section");
    await userEvent.click(toolbar().getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => { expect(server.saved()).toHaveLength(2); });
    expect((server.saved()[1] as { expected_revision: number }).expected_revision).toBe(2);
  });

  it("sans changement, dit qu'il n'y a rien à enregistrer et n'envoie rien", async () => {
    const { server } = await ready();
    await userEvent.click(toolbar().getByRole("button", { name: "Enregistrer" }));
    expect(screen.getByText(/Rien à enregistrer/)).toBeInTheDocument();
    expect(server.saved()).toEqual([]);
  });

  it("pendant l'enregistrement le bouton est occupé : pas de double envoi", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { server } = await ready({ overrides: { [`POST ${ROOT}/dashboards/${ID}/revisions`]: async (init) => { await gate; return echo(init, 2); } } });
    await add("Ajouter une section");
    await userEvent.click(toolbar().getByRole("button", { name: "Enregistrer" }));
    expect(toolbar().getByRole("button", { name: "Enregistrement…" })).toBeDisabled();
    fireEvent.click(toolbar().getByRole("button", { name: "Enregistrement…" }));
    act(() => { release(); });
    await screen.findByText("Révision 2 enregistrée.");
    expect(server.fetcher.mock.calls.filter(([url, init]) => init?.method === "POST" && url.endsWith("/revisions"))).toHaveLength(1);
  });

  it("un contenu identique à la révision courante ne crée pas de révision", async () => {
    await ready({ overrides: { [`POST ${ROOT}/dashboards/${ID}/revisions`]: (init) => echo(init, 1, 200) } });
    await add("Ajouter une section");
    await userEvent.click(toolbar().getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Contenu identique à la révision courante : aucune révision créée.");
    expect(screen.getByText(/révision 1/)).toBeInTheDocument();
  });

  it("un contenu que le serveur a changé n'est pas donné pour enregistré", async () => {
    await ready({ overrides: { [`POST ${ROOT}/dashboards/${ID}/revisions`]: () => Response.json(dashboardBody(sampleDraft(), { revision: 2 }), { status: 201 }) } });
    await add("Ajouter une section");
    await userEvent.click(toolbar().getByRole("button", { name: "Enregistrer" }));
    await screen.findByText(/Le serveur a enregistré la révision 2 avec un contenu différent de celui envoyé : vos modifications restent non enregistrées\./);
    expect(screen.getByText("Modifications non enregistrées")).toBeInTheDocument();
  });

  it("le conflit de révision se lit tel quel : rien n'est écrasé et le brouillon reste ouvert", async () => {
    const { server } = await ready({ overrides: { [`POST ${ROOT}/dashboards/${ID}/revisions`]: () => refused("refus-revision-conflit") } });
    await add("Ajouter une section");
    await userEvent.click(toolbar().getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByRole("region", { name: "Conflit de révision" })).toBeInTheDocument();
    expect(screen.getByText("Modifications non enregistrées")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Section 3" })).toBeInTheDocument();
    expect(toolbar().getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    expect(server.fetcher.mock.calls.filter(([url, init]) => init?.method === "POST" && url.endsWith("/revisions"))).toHaveLength(1);
  });

  it("un refus du serveur dit sa règle et son chemin", async () => {
    await ready({ overrides: { [`POST ${ROOT}/dashboards/${ID}/revisions`]: () => refused("refus-dashboard-invalide-filtre") } });
    await add("Ajouter une section");
    await userEvent.click(toolbar().getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText(/\/filters\/0.*:/)).toBeInTheDocument();
  });

  it("une panne ne confirme rien : il faut rouvrir avant de recommencer", async () => {
    await ready({ overrides: { [`POST ${ROOT}/dashboards/${ID}/revisions`]: () => Response.json({}, { status: 500 }) } });
    await add("Ajouter une section");
    await userEvent.click(toolbar().getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText(/Enregistrement non confirmé : .* Rien ne dit que la révision existe : rouvrez le dashboard avant de recommencer\./)).toBeInTheDocument();
    expect(screen.getByText("Modifications non enregistrées")).toBeInTheDocument();
  });

  it("des modifications faites pendant l'enregistrement restent non enregistrées", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await ready({ overrides: { [`POST ${ROOT}/dashboards/${ID}/revisions`]: async (init) => { await gate; return echo(init, 2); } } });
    await add("Ajouter une section");
    await userEvent.click(toolbar().getByRole("button", { name: "Enregistrer" }));
    await add("Ajouter une section");
    act(() => { release(); });
    await screen.findByText("Révision 2 enregistrée.");
    expect(screen.getByText("Modifications non enregistrées")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Section 4" })).toBeInTheDocument();
  });
});

describe("problèmes bloquants", () => {
  it("une tuile indisponible bloque l'enregistrement, le dit, et le problème mène au nœud", async () => {
    const { server } = await ready({ tiles: unavailable("analysis_unavailable"), state: "unresolved_reference" });
    expect(toolbar().getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    expect(screen.getByText(/Enregistrement impossible : 1 problème bloquant\./)).toBeInTheDocument();
    await add("Ajouter une section");
    expect(toolbar().getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    await userEvent.click(screen.getByRole("tab", { name: /Structure/ }));
    await userEvent.click(toolbar().getByRole("button", { name: "Voir les problèmes" }));
    expect(screen.getByRole("tab", { name: /Problèmes/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Problèmes/ })).toHaveFocus();
    const link = within(screen.getByRole("tabpanel")).getByRole("button", { name: /Analyse indisponible/ });
    await userEvent.click(link);
    const node = screen.getByRole("button", { name: /^Visuel/ });
    expect(node).toHaveAttribute("aria-pressed", "true");
    expect(node).toHaveFocus();
    fireEvent.click(toolbar().getByRole("button", { name: "Enregistrer" }));
    expect(server.saved()).toEqual([]);
  });

  it("plusieurs problèmes bloquants se comptent au pluriel", async () => {
    await ready({ state: "unresolved_reference", tiles: [{ id: N.visual, state: "unavailable", reason: "analysis_unavailable" }, { id: N.kpi, state: "unavailable", reason: "filter_incompatible" }] });
    expect(screen.getByText(/Enregistrement impossible : 2 problèmes bloquants\./)).toBeInTheDocument();
  });
});

describe("garde de sortie", () => {
  it("sans changement, on part sans question", async () => {
    await ready();
    act(() => { navigate({ page: "dashboards", space: "finance" }); });
    expect(window.location.hash).toBe("#/espaces/finance/dashboards");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("avec des changements : le dialogue propose de rester (Échap aussi) ou de quitter sans enregistrer", async () => {
    await ready();
    await add("Ajouter une section");
    act(() => { navigate({ page: "dashboards", space: "finance" }); });
    const dialog = await screen.findByRole("dialog", { name: "Quitter sans enregistrer ?" });
    expect(within(dialog).getByRole("button", { name: "Rester" })).toHaveFocus();
    expect(window.location.hash).toBe("");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Section 3" })).toBeInTheDocument();
    act(() => { navigate({ page: "home" }); });
    await userEvent.click(await screen.findByRole("button", { name: "Quitter sans enregistrer" }));
    expect(window.location.hash).toBe("#/");
  });

  it("retient aussi un lien d'ancre, et l'enregistrement lève la garde", async () => {
    const { container } = await ready();
    const link = document.createElement("a");
    link.href = "#/espaces/finance/analyses";
    link.textContent = "Analyses";
    container.append(link);
    await add("Ajouter une section");
    await userEvent.click(link);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Rester" }));
    await userEvent.click(toolbar().getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Révision 2 enregistrée.");
    await userEvent.click(link);
    expect(window.location.hash).toBe("#/espaces/finance/analyses");
  });
});

describe("garde de sortie : une saisie en cours est un changement non enregistré", () => {
  const typeName = async () => {
    const name = screen.getByRole("textbox", { name: "Nom du dashboard" });
    await userEvent.type(name, " bis");
    expect(name).toHaveFocus();
    return name;
  };
  const unload = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it("avant la validation du champ, le rechargement, navigate, un lien, Précédent et une adresse saisie sont tous retenus", async () => {
    // L'éditeur est ouvert sur sa propre adresse, avec une entrée d'historique avant elle.
    window.history.pushState(null, "", "#/espaces/finance/dashboards/ici");
    const { container } = await ready();
    expect(unload()).toBe(false);
    await typeName();
    // Le document n'a pas changé : seul le champ porte la modification.
    expect(toolbar().getByRole("button", { name: "Annuler" })).toBeDisabled();
    expect(screen.getByText("Modifications non enregistrées")).toBeInTheDocument();
    expect(unload()).toBe(true);
    act(() => { navigate({ page: "dashboards", space: "finance" }); });
    await userEvent.click(await screen.findByRole("button", { name: "Rester" }));
    const link = document.createElement("a");
    link.href = "#/espaces/finance/analyses";
    container.append(link);
    await userEvent.click(link);
    await userEvent.click(await screen.findByRole("button", { name: "Rester" }));
    window.history.back();
    await userEvent.click(await screen.findByRole("button", { name: "Rester" }));
    expect(window.location.hash).toBe("#/espaces/finance/dashboards/ici");
    window.location.hash = "#/espaces/finance/analyses";
    await userEvent.click(await screen.findByRole("button", { name: "Rester" }));
    expect(window.location.hash).toBe("#/espaces/finance/dashboards/ici");
    expect(screen.getByRole("textbox", { name: "Nom du dashboard" })).toHaveValue("Pilotage bis");
  });

  it("valider le champ, ou rétablir sa valeur, change l'état selon le document : la saisie rétablie ne retient plus rien", async () => {
    await ready();
    const name = await typeName();
    await userEvent.type(name, "{Backspace}{Backspace}{Backspace}{Backspace}");
    expect(name).toHaveValue("Pilotage");
    expect(screen.getByText("Tout est enregistré")).toBeInTheDocument();
    expect(unload()).toBe(false);
    await userEvent.type(name, " bis{Enter}");
    expect(toolbar().getByRole("button", { name: "Annuler" })).toBeEnabled();
    expect(unload()).toBe(true);
  });

  it("un champ qui disparaît pendant la saisie ne retient plus rien", async () => {
    await ready();
    await select(/^Section 1/);
    const title = screen.getByRole("textbox", { name: /^Titre de la section/ });
    await userEvent.type(title, "x");
    expect(unload()).toBe(true);
    // Changer de sélection sort du champ : sa valeur est validée vers le document, donc annulable.
    await select(/^Section 2/);
    expect(toolbar().getByRole("button", { name: "Annuler" })).toBeEnabled();
  });
});

describe("garde de sortie : Précédent et adresse saisie à la main", () => {
  it("un changement d'adresse avec des modifications rétablit l'adresse, garde l'état et demande confirmation", async () => {
    await ready();
    await add("Ajouter une section");
    window.location.hash = "#/espaces/finance/analyses";
    const dialog = await screen.findByRole("dialog", { name: "Quitter sans enregistrer ?" });
    expect(window.location.hash).toBe("");
    expect(screen.getByRole("button", { name: "Section 3" })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Rester" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.location.hash).toBe("");
    expect(screen.getByRole("button", { name: "Section 3" })).toBeInTheDocument();
    window.location.hash = "#/espaces/finance/analyses";
    await userEvent.click(await screen.findByRole("button", { name: "Quitter sans enregistrer" }));
    expect(window.location.hash).toBe("#/espaces/finance/analyses");
  });

  it("sans modification, l'adresse change sans question", async () => {
    await ready();
    window.location.hash = "#/espaces/finance/analyses";
    await waitFor(() => { expect(window.location.hash).toBe("#/espaces/finance/analyses"); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("thème et accessibilité", () => {
  it.each(["Skifer clair", "Skifer ardoise"])("sans défaut d'accessibilité, thème %s", async (theme) => {
    const { container } = await ready();
    await userEvent.click(screen.getByRole("button", { name: theme }));
    await screen.findAllByText("Preuve");
    await expectAccessible(container);
    expect(container.firstElementChild).toHaveClass(theme === "Skifer clair" ? "sb-theme-skifer-clair" : "sb-theme-skifer-ardoise");
  });
});

describe("double envoi", () => {
  it("deux clics dans le même instant n'envoient qu'un enregistrement", async () => {
    const { server } = await ready({ overrides: { [`POST ${ROOT}/dashboards/${ID}/revisions`]: (init) => echo(init, 2) } });
    await add("Ajouter une section");
    const button = toolbar().getByRole("button", { name: "Enregistrer" });
    act(() => { button.click(); button.click(); });
    await waitFor(() => { expect(screen.getByText(/révision 2/)).toBeInTheDocument(); });
    expect(server.fetcher.mock.calls.filter(([, init]) => init?.method === "POST" && (init.body as string).includes("expected_revision"))).toHaveLength(1);
  });
});

it("propose de comparer, adopter et garder une révision d'analyse, sans adoption implicite", async () => {
  const { server } = await ready({ analyses: { ...ANALYSES, [N.bars]: { ...ANALYSES[N.bars] as AnalysisSpec, current: 2 } } });
  await waitFor(() => { expect(screen.getAllByText(/Analyse épinglée r1 ; révision courante r2/).length).toBeGreaterThan(0); });
  const actions = screen.getAllByLabelText("Révision d'analyse plus récente")[0] as HTMLElement;
  expect(within(actions).getByRole("link", { name: "Comparer les révisions" })).toHaveAttribute("href", `#/espaces/finance/analyses/${N.bars}/historique/1/2`);
  expect(server.fetcher.mock.calls.filter(([url]) => url.endsWith(`/analyses/${N.bars}/revisions/2`))).toHaveLength(0);
  await userEvent.click(within(actions).getByRole("button", { name: "Adopter r2" }));
  await waitFor(() => { expect(server.fetcher.mock.calls.filter(([url]) => url.endsWith(`/analyses/${N.bars}/revisions/2`)).length).toBeGreaterThan(0); });
  await userEvent.click(toolbar().getByRole("button", { name: "Annuler" }));
  await waitFor(() => { expect(screen.getAllByText(/Analyse épinglée r1 ; révision courante r2/).length).toBeGreaterThan(0); });
  const readsBefore = server.fetcher.mock.calls.filter(([url]) => url.endsWith(`/analyses/${N.bars}/revisions/2`)).length;
  const submissions = server.submitted().length;
  const keptAction = screen.getAllByLabelText("Révision d'analyse plus récente")[0] as HTMLElement;
  await userEvent.click(within(keptAction).getByRole("button", { name: "Garder l'épingle" }));
  expect(keptAction).not.toBeInTheDocument();
  expect(server.fetcher.mock.calls.filter(([url]) => url.endsWith(`/analyses/${N.bars}/revisions/2`))).toHaveLength(readsBefore);
  expect(server.submitted()).toHaveLength(submissions);
  expect(screen.getByText("Tout est enregistré")).toBeInTheDocument();
});

it("après conflit bloque toute nouvelle écriture, lit l'écart et rouvre seulement après confirmation", async () => {
  let reads = 0;
  const revised = dashboardBody(sampleDraft(), { revision: 2 });
  const { server } = await ready({ overrides: {
    [`GET ${ROOT}/dashboards/${ID}`]: () => Response.json(reads++ === 0 ? dashboardBody(sampleDraft()) : revised),
    [`POST ${ROOT}/dashboards/${ID}/revisions`]: () => refused("refus-revision-conflit"),
    [`GET ${ROOT}/dashboards/${ID}/diff?base=1&other=2`]: () => refused("ecart"),
  } });
  await add("Ajouter une section");
  await userEvent.click(toolbar().getByRole("button", { name: "Enregistrer" }));
  const conflict = await screen.findByRole("region", { name: "Conflit de révision" });
  expect(toolbar().getByRole("button", { name: "Enregistrer" })).toBeDisabled();
  await userEvent.click(await within(conflict).findByRole("button", { name: "Voir l'écart" }));
  expect(await within(conflict).findByText(/\/name/)).toBeInTheDocument();
  expect(server.fetcher.mock.calls.filter(([url]) => url.endsWith("/diff?base=1&other=2"))).toHaveLength(1);
  expect(server.fetcher.mock.calls.filter(([url, init]) => init?.method === "POST" && url.endsWith("/revisions"))).toHaveLength(1);
  await userEvent.click(within(conflict).getByRole("button", { name: "Rouvrir la révision courante" }));
  expect(screen.getByRole("group", { name: "Abandonner les modifications" })).toBeInTheDocument();
  await userEvent.click(within(conflict).getByRole("button", { name: "Abandonner et rouvrir" }));
  expect(screen.queryByRole("region", { name: "Conflit de révision" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Section 3" })).not.toBeInTheDocument();
  expect(screen.getByText("Tout est enregistré")).toBeInTheDocument();
  expect(screen.getByText(/Éditeur de dashboard · Partagé · révision 2/)).toBeInTheDocument();
  await add("Ajouter une section");
  await userEvent.click(toolbar().getByRole("button", { name: "Enregistrer" }));
  await waitFor(() => { expect(server.fetcher.mock.calls.filter(([url, init]) => init?.method === "POST" && url.endsWith("/revisions"))).toHaveLength(2); });
  const posts = server.fetcher.mock.calls.filter(([url, init]) => init?.method === "POST" && url.endsWith("/revisions"));
  expect(JSON.parse(posts[1]?.[1]?.body as string)).toMatchObject({ expected_revision: 2 });
});

it("crée une copie indépendante puis y enregistre le brouillon sans réécrire l'original", async () => {
  const copyId = "00000000-0000-4000-8000-000000000099";
  const duplicate = JSON.parse(JSON.stringify(route("dupliquer").body).replaceAll(ID, copyId)) as Record<string, unknown>;
  const { server } = await ready({ overrides: {
    [`POST ${ROOT}/dashboards/${ID}/revisions`]: () => refused("refus-revision-conflit"),
    [`POST ${ROOT}/dashboards/${ID}/duplicate`]: Response.json(duplicate, { status: 201 }),
    [`POST ${ROOT}/dashboards/${copyId}/revisions`]: (init) => {
      const sent = JSON.parse(init?.body as string) as Record<string, unknown>;
      delete sent.expected_revision;
      const body = dashboardBody(decodeDashboardDraft(sent), { revision: 2 });
      return Response.json({ ...body, id: copyId, dashboard: { ...body.dashboard, id: copyId } }, { status: 201 });
    },
  } });
  await add("Ajouter une section");
  await userEvent.click(toolbar().getByRole("button", { name: "Enregistrer" }));
  const conflict = await screen.findByRole("region", { name: "Conflit de révision" });
  await userEvent.click(within(conflict).getByRole("button", { name: "Copie indépendante" }));
  expect(await within(conflict).findByRole("link", { name: "Ouvrir la copie" })).toHaveAttribute("href", `#/espaces/finance/dashboards/${copyId}`);
  const writes = server.fetcher.mock.calls.filter(([url, init]) => init?.method === "POST" && url.includes("/dashboards/"));
  expect(writes.map(([url]) => url)).toEqual([`${ROOT}/dashboards/${ID}/revisions`, `${ROOT}/dashboards/${ID}/duplicate`, `${ROOT}/dashboards/${copyId}/revisions`]);
  const sent = JSON.parse(writes[2]?.[1]?.body as string) as { expected_revision: number; visibility: string; layout: { sections: { id: string }[] } };
  expect(sent).toMatchObject({ expected_revision: 1, visibility: "personal" });
  expect(sent.layout.sections.map((section) => section.id)).toContain(N.s1);
  expect(within(conflict).getByText(/Copie enregistrée/)).toBeInTheDocument();
  act(() => { navigate({ page: "dashboards", space: "finance" }); });
  expect(screen.queryByRole("dialog", { name: "Quitter sans enregistrer ?" })).not.toBeInTheDocument();
  expect(window.location.hash).toBe("#/espaces/finance/dashboards");
});

it("conserve une saisie de filtre pendant l'aperçu", async () => {
  await ready();
  await userEvent.click(screen.getByRole("tab", { name: /^Filtres/ }));
  await userEvent.click(screen.getByRole("button", { name: "Nouveau filtre" }));
  await userEvent.type(screen.getByRole("textbox", { name: "Libellé" }), "Saisie en cours");
  await add("Aperçu lecteur");
  expect(screen.getByRole("heading", { name: "Aperçu lecteur · Pilotage" })).toBeInTheDocument();
  await add("Retour à l'éditeur");
  expect(screen.getByRole("textbox", { name: "Libellé" })).toHaveValue("Saisie en cours");
});

it("la garde retient l'ouverture de l'historique tant que le brouillon est modifié", async () => {
  await ready();
  await add("Ajouter une section");
  await userEvent.click(screen.getByRole("link", { name: "Historique des révisions" }));
  expect(screen.getByRole("dialog", { name: "Quitter sans enregistrer ?" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Section 3" })).toBeInTheDocument();
});

describe("aperçu lecteur et responsive", () => {
  it("conserve résultats et refus, masque les outils et ne resoumet rien en changeant de largeur", async () => {
    const { server, container } = await ready({ outcomes: { [N.total]: "deny" } });
    await screen.findByText(/DENY/);
    await waitFor(() => { expect(server.submitted()).toHaveLength(2); });
    const submitted = structuredClone(server.submitted());
    await add("Aperçu lecteur");
    expect(screen.getByText(/les données restent celles de l'éditeur/)).toBeInTheDocument();
    expect(screen.queryByRole("toolbar", { name: "Actions de l'éditeur" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ajouter une section" })).not.toBeInTheDocument();
    const preview = screen.getByRole("region", { name: "Aperçu lecteur" });
    expect(within(preview).getByText(/DENY/)).toBeInTheDocument();
    expect(within(preview).getByText("Bonjour")).toBeInTheDocument();
    expect(container.querySelector(".sb-preview__row")).toHaveAttribute("data-stacked", "false");
    await userEvent.click(screen.getByRole("radio", { name: "Tablette · 768 px" }));
    expect(container.querySelector(".sb-preview__row")).toHaveAttribute("data-stacked", "false");
    await userEvent.click(screen.getByRole("radio", { name: "Téléphone · 390 px" }));
    expect(container.querySelector(".sb-preview__row")).toHaveAttribute("data-stacked", "true");
    await userEvent.click(screen.getByRole("radio", { name: "Bureau · 1 280 px" }));
    expect(server.submitted()).toEqual(submitted);
    await expectAccessible(container);
    await add("Retour à l'éditeur");
    expect(screen.getByRole("toolbar", { name: "Actions de l'éditeur" })).toBeInTheDocument();
    expect(server.submitted()).toEqual(submitted);
  });
});

it("la garde protège aussi les modifications pendant l'aperçu", async () => {
  await ready();
  await add("Ajouter une section");
  await add("Aperçu lecteur");
  act(() => { navigate({ page: "dashboards", space: "finance" }); });
  const dialog = await screen.findByRole("dialog", { name: "Quitter sans enregistrer ?" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Rester" }));
  expect(screen.getByRole("heading", { name: "Aperçu lecteur · Pilotage" })).toBeInTheDocument();
  act(() => { navigate({ page: "dashboards", space: "finance" }); });
  await userEvent.click(within(await screen.findByRole("dialog", { name: "Quitter sans enregistrer ?" })).getByRole("button", { name: "Quitter sans enregistrer" }));
  expect(window.location.hash).toBe("#/espaces/finance/dashboards");
});

it("garder l'épingle masque l'invite sans lire r2 ni modifier le document", async () => {
  const { server } = await ready({ analyses: { ...ANALYSES, [N.bars]: { ...ANALYSES[N.bars] as AnalysisSpec, current: 2 } } });
  const invite = (await screen.findAllByLabelText("Révision d'analyse plus récente"))[0] as HTMLElement;
  expect(server.fetcher.mock.calls.filter(([url]) => url.endsWith(`/analyses/${N.bars}/revisions/2`))).toHaveLength(0);
  await userEvent.click(within(invite).getByRole("button", { name: "Garder l'épingle" }));
  expect(invite).not.toBeInTheDocument();
  expect(server.fetcher.mock.calls.filter(([url]) => url.endsWith(`/analyses/${N.bars}/revisions/2`))).toHaveLength(0);
  expect(server.saved()).toHaveLength(0);
  expect(screen.getByText("Tout est enregistré")).toBeInTheDocument();
});
