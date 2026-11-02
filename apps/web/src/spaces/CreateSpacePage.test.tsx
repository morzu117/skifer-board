import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";

import creation from "../../../../contracts/espaces/creation.json";
import existant from "../../../../contracts/espaces/espace-existant.json";
import interdit from "../../../../contracts/espaces/interdit.json";
import liste from "../../../../contracts/espaces/liste.json";
import administration from "../../../../contracts/espaces/liste-administration.json";
import locale from "../../../../contracts/espaces/liste-locale.json";
import modeLocal from "../../../../contracts/espaces/mode-local.json";
import inconnue from "../../../../contracts/espaces/personne-inconnue.json";
import personnes from "../../../../contracts/espaces/personnes.json";
import requeteInvalide from "../../../../contracts/espaces/requete-invalide.json";
import type { Fetch } from "./api";
import { bareName, CreateSpacePage, NAME_MAX } from "./CreateSpacePage";
import { decodeSpaceList, type Space } from "./model";

type Exemple = { status: number; body: unknown };
const reponse = (exemple: Exemple) => Response.json(exemple.body, { status: exemple.status });
const ADMINISTRATION = { status: "ok", value: decodeSpaceList(administration.body) } as const;
function differee() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((ok) => { resolve = ok; });
  return { promise, resolve };
}
const formulaire = () => screen.getByRole("form", { name: "Créer un espace" });
const identifiant = () => within(formulaire()).getByRole("textbox", { name: /^Identifiant/ });
const nom = () => within(formulaire()).getByRole("textbox", { name: /^Nom affiché/ });
const groupe = () => within(formulaire()).getByRole("textbox", { name: /Nom exact du groupe/ });
const creer = () => within(formulaire()).getByRole("button", { name: /Créer l'espace|Création…/ });
const envoye = (fetcher: Mock<Fetch>, rang = 0) => JSON.parse(fetcher.mock.calls[rang]?.[1]?.body as string) as unknown;

function ouvrir(fetcher: Fetch = vi.fn<Fetch>(), onCreated: (space: Space) => void = vi.fn()) {
  render(<CreateSpacePage listed={ADMINISTRATION} fetcher={fetcher} onCreated={onCreated} />);
}
async function remplir(id: string, affiche: string, nomGroupe: string) {
  if (id !== "") await userEvent.type(identifiant(), id);
  if (affiche !== "") await userEvent.type(nom(), affiche);
  if (nomGroupe !== "") await userEvent.type(groupe(), nomGroupe);
}

describe("Création d'un espace : qui peut créer (E6, E11)", () => {
  it("annonce la lecture des droits, sans formulaire", () => {
    render(<CreateSpacePage listed={{ status: "loading" }} fetcher={vi.fn<Fetch>()} onCreated={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Nouvel espace" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Lecture de vos droits…");
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it.each([
    ["erreur", { status: "error", message: "Le serveur Board ne répond pas." }, "Droits indisponibles : Le serveur Board ne répond pas."],
    ["introuvable", { status: "not_found" }, "Droits indisponibles : réponse inattendue du serveur."],
  ] as const)("des droits illisibles (%s) ferment la création", (_cas, listed, texte) => {
    render(<CreateSpacePage listed={listed} fetcher={vi.fn<Fetch>()} onCreated={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(texte);
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("en mode local, aucun autre espace ne se crée", () => {
    render(<CreateSpacePage listed={{ status: "ok", value: decodeSpaceList(locale.body) }} fetcher={vi.fn<Fetch>()} onCreated={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("En mode local, Board n'a qu'un espace implicite : on n'en crée pas d'autre.");
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("le mode local l'emporte même si la liste se dit administrée", () => {
    const corps = { ...locale.body, platform_admin: true };
    render(<CreateSpacePage listed={{ status: "ok", value: decodeSpaceList(corps) }} fetcher={vi.fn<Fetch>()} onCreated={vi.fn()} />);
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("une personne qui n'administre pas la plateforme ne crée pas d'espace", () => {
    render(<CreateSpacePage listed={{ status: "ok", value: decodeSpaceList(liste.body) }} fetcher={vi.fn<Fetch>()} onCreated={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Seuls les administrateurs de la plateforme créent des espaces.");
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("l'administration de la plateforme a le formulaire, avec le rappel sur les données", () => {
    ouvrir();
    expect(screen.getByText(/Un rôle dans un espace ne donne aucun droit sur les données/)).toBeInTheDocument();
    expect(identifiant()).toHaveAttribute("maxLength", "40");
    expect(identifiant()).toHaveAccessibleDescription("Définitif : il figure dans les adresses de l'espace.");
    expect(nom()).toHaveAttribute("maxLength", String(NAME_MAX));
    expect(NAME_MAX).toBe(80);
    expect(within(formulaire()).getByRole("group", { name: "Premier administrateur" })).toBeInTheDocument();
    expect(creer()).toHaveTextContent("Créer l'espace");
  });
});

describe("Création d'un espace : saisie et envoi", () => {
  it("rien ne part tant que la saisie est incomplète ; les problèmes s'affichent après le premier envoi", async () => {
    const fetcher = vi.fn<Fetch>();
    ouvrir(fetcher);
    // Avant l'envoi, aucun problème n'est signalé.
    expect(identifiant()).not.toHaveAttribute("aria-invalid");
    await userEvent.click(creer());
    expect(fetcher).not.toHaveBeenCalled();
    expect(identifiant()).toHaveAttribute("aria-invalid", "true");
    expect(identifiant()).toHaveAccessibleDescription(/Définitif.*L'identifiant compte 2 à 40 caractères/);
    expect(nom()).toHaveAttribute("aria-invalid", "true");
    expect(nom()).toHaveAccessibleDescription("Le nom est obligatoire.");
    expect(within(formulaire()).getByText("Choisissez le premier administrateur : un groupe ou une personne connue.")).toBeInTheDocument();
    // Corriger fait disparaître le problème aussitôt.
    await userEvent.type(identifiant(), "finance");
    expect(identifiant()).not.toHaveAttribute("aria-invalid");
    expect(within(formulaire()).queryByText(/L'identifiant compte/)).not.toBeInTheDocument();
    await userEvent.type(nom(), "   ");
    expect(nom()).toHaveAttribute("aria-invalid", "true");
    await userEvent.type(groupe(), "g");
    expect(within(formulaire()).queryByText(/Choisissez le premier administrateur/)).not.toBeInTheDocument();
    await userEvent.click(creer());
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["Finance", "a", "-finance", "finance-", "fin_ance", "fin ance", "finé", "a".repeat(41)])("refuse l'identifiant hors format E1 %j sans rien envoyer", async (id) => {
    const fetcher = vi.fn<Fetch>();
    ouvrir(fetcher);
    // La limite de saisie coupe à 40 : la valeur de 41 caractères est posée directement.
    fireEvent.change(identifiant(), { target: { value: id } });
    await remplir("", "Finance", "g");
    await userEvent.click(creer());
    expect(fetcher).not.toHaveBeenCalled();
    expect(identifiant()).toHaveAttribute("aria-invalid", "true");
  });

  it.each(["ab", "f-1", "0-9", "a".repeat(40)])("accepte l'identifiant %j", async (id) => {
    const fetcher = vi.fn<Fetch>().mockResolvedValue(reponse(creation));
    ouvrir(fetcher);
    await remplir(id, "Finance", "g");
    await userEvent.click(creer());
    expect(envoye(fetcher)).toMatchObject({ id });
  });

  it("crée l'espace : nom rogné, groupe exact, puis ouvre l'espace créé", async () => {
    const attente = differee();
    const fetcher = vi.fn<Fetch>().mockReturnValue(attente.promise);
    const onCreated = vi.fn();
    ouvrir(fetcher, onCreated);
    await remplir("finance", "  Finance  ", " finance-admins ");
    await userEvent.click(creer());
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/spaces", expect.objectContaining({ method: "POST" }));
    expect(envoye(fetcher)).toEqual({ id: "finance", name: "Finance", first_admin: { kind: "group", name: " finance-admins " } });
    // Pendant l'envoi, rien ne se modifie ni ne se renvoie.
    expect(creer()).toHaveTextContent("Création…");
    expect(creer()).toBeDisabled();
    expect(identifiant()).toBeDisabled();
    expect(nom()).toBeDisabled();
    expect(within(formulaire()).getByRole("group", { name: "Premier administrateur" })).toBeDisabled();
    await act(async () => { attente.resolve(reponse(creation)); await Promise.resolve(); });
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated.mock.calls[0]?.[0]).toMatchObject({ id: "finance", name: "Finance", role: null, implicit: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("le premier administrateur peut être une personne connue cherchée", async () => {
    const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(reponse(url.startsWith("/api/people") ? personnes : creation)));
    ouvrir(fetcher);
    await remplir("finance", "Finance", "");
    await userEvent.click(within(formulaire()).getByRole("radio", { name: "Personne connue" }));
    await userEvent.click(creer());
    expect(within(formulaire()).getByText(/Choisissez le premier administrateur/)).toBeInTheDocument();
    await userEvent.type(within(formulaire()).getByRole("searchbox"), "dominique{Enter}");
    await userEvent.click(await within(formulaire()).findByRole("button", { name: /Dominique Leroy/ }));
    await userEvent.click(creer());
    expect(envoye(fetcher, 1)).toEqual({ id: "finance", name: "Finance", first_admin: { kind: "person", issuer: "https://id.example.invalid", subject: "00u5d6e7f8" } });
  });

  it.each([
    ["identifiant pris", existant, "Cet identifiant est déjà pris par un espace."],
    ["personne inconnue", inconnue, "Cette personne n'est pas connue de Board : elle doit s'être connectée une fois."],
    ["requête invalide", { status: 400, body: { error: { code: "invalid_request", field: "id" } } }, "La demande est incomplète ou mal formée. Champ en cause : identifiant."],
    ["champ nommé", requeteInvalide, "Champ en cause : type de premier administrateur."],
    ["interdit", interdit, "Votre rôle ne permet pas cette action."],
    ["mode local", modeLocal, "En mode local, l'espace n'a pas de membres à gérer."],
  ] as [string, Exemple, string][])("un refus (%s) est rendu avec sa raison, la saisie gardée", async (_cas, exemple, texte) => {
    const onCreated = vi.fn();
    ouvrir(vi.fn<Fetch>().mockResolvedValue(reponse(exemple)), onCreated);
    await remplir("finance", "Finance", "finance-admins");
    await userEvent.click(creer());
    expect(await within(formulaire()).findByRole("alert")).toHaveTextContent(texte);
    expect(onCreated).not.toHaveBeenCalled();
    expect(identifiant()).toHaveValue("finance");
    expect(nom()).toHaveValue("Finance");
    expect(groupe()).toHaveValue("finance-admins");
    expect(creer()).toBeEnabled();
  });

  it("une panne n'est pas une création ; renvoyer efface l'échec précédent", async () => {
    const attente = differee();
    const fetcher = vi.fn<Fetch>().mockRejectedValueOnce(new TypeError("réseau")).mockReturnValueOnce(attente.promise);
    const onCreated = vi.fn();
    ouvrir(fetcher, onCreated);
    await remplir("finance", "Finance", "g");
    await userEvent.click(creer());
    expect(await screen.findByRole("alert")).toHaveTextContent("Création non confirmée : Le serveur Board ne répond pas.");
    await userEvent.click(creer());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => { attente.resolve(reponse(creation)); await Promise.resolve(); });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });
});

describe("Nom sans blancs autour, comme `str.strip` du serveur (E12)", () => {
  it.each([
    ["Finance", "Finance"],
    ["  Finance  ", "Finance"],
    ["\t\n\v\f\rFinance\r\n", "Finance"],
    [" Finance　", "Finance"],
    ["  Finance  ", "Finance"],
    // Blancs que Python retire et que `\s` de JavaScript ne connaît pas.
    ["\u001cFinance\u001f", "Finance"],
    ["\u001d\u001eFinance", "Finance"],
    ["\u0085Finance\u0085", "Finance"],
    ["\u0085 \u001c", ""],
    // L'intérieur du nom est gardé tel quel.
    ["Fi  nance\u0085RH", "Fi  nance\u0085RH"],
    ["", ""],
    ["   ", ""],
    // Ni un caractère de contrôle qui n'est pas un blanc, ni un espace sans chasse ne sont retirés.
    ["\u001bFinance​", "\u001bFinance​"],
  ])("%j → %j", (saisi, attendu) => {
    expect(bareName(saisi)).toBe(attendu);
  });

  it("un nom entouré de blancs que seul Python connaît part sans eux", async () => {
    const fetcher = vi.fn<Fetch>().mockResolvedValue(reponse(creation));
    ouvrir(fetcher);
    await remplir("finance", "x", "g");
    fireEvent.change(nom(), { target: { value: "\u0085\u001cFinance RH\u001f" } });
    await userEvent.click(creer());
    expect(envoye(fetcher)).toMatchObject({ name: "Finance RH" });
  });

  it("un nom fait seulement de ces blancs est obligatoire, et rien ne part", async () => {
    const fetcher = vi.fn<Fetch>();
    ouvrir(fetcher);
    await remplir("finance", "x", "g");
    fireEvent.change(nom(), { target: { value: "\u0085\u001c\u001d" } });
    await userEvent.click(creer());
    expect(fetcher).not.toHaveBeenCalled();
    expect(nom()).toHaveAttribute("aria-invalid", "true");
  });
});

describe("Création d'un espace : problèmes reliés et focus", () => {
  const premier = () => within(formulaire()).getByRole("group", { name: "Premier administrateur" });
  const PROBLEME = "Choisissez le premier administrateur : un groupe ou une personne connue.";

  it("le problème du premier administrateur est rendu dans son groupe de champs et le décrit", async () => {
    ouvrir();
    expect(premier()).not.toHaveAttribute("aria-describedby");
    await remplir("finance", "Finance", "");
    await userEvent.click(creer());
    const probleme = within(premier()).getByText(PROBLEME);
    expect(premier()).toHaveAccessibleDescription(PROBLEME);
    expect(premier().getAttribute("aria-describedby")).toBe(probleme.id);
    expect(probleme).toHaveAttribute("tabindex", "-1");
    await userEvent.type(groupe(), "g");
    expect(premier()).not.toHaveAttribute("aria-describedby");
    expect(within(formulaire()).queryByText(PROBLEME)).not.toBeInTheDocument();
  });

  it.each([
    ["tout manque", "", "", "", "identifiant"],
    ["identifiant hors format", "Finance", "Finance", "g", "identifiant"],
    ["le nom manque", "finance", "", "g", "nom"],
    ["le nom est blanc", "finance", "   ", "g", "nom"],
    ["le nom et le premier administrateur manquent", "finance", "", "", "nom"],
    ["seul le premier administrateur manque", "finance", "Finance", "", "premier administrateur"],
  ])("un envoi refusé par la page met le focus sur le premier champ en cause (%s)", async (_cas, id, affiche, nomGroupe, cible) => {
    ouvrir();
    await remplir(id, affiche, nomGroupe);
    await userEvent.click(creer());
    const attendu = { identifiant: identifiant, nom: nom, "premier administrateur": () => within(premier()).getByText(PROBLEME) }[cible];
    expect(attendu?.()).toHaveFocus();
  });

  it("une personne non choisie met le focus sur le problème du premier administrateur", async () => {
    ouvrir();
    await remplir("finance", "Finance", "");
    await userEvent.click(within(formulaire()).getByRole("radio", { name: "Personne connue" }));
    await userEvent.click(creer());
    expect(within(premier()).getByText(PROBLEME)).toHaveFocus();
  });

  it("chaque nouvel envoi refusé reprend le focus, même pour le même champ", async () => {
    ouvrir();
    await userEvent.click(creer());
    expect(identifiant()).toHaveFocus();
    await userEvent.click(nom());
    expect(nom()).toHaveFocus();
    await userEvent.click(creer());
    expect(identifiant()).toHaveFocus();
    // Entrée dans un champ envoie aussi le formulaire.
    await userEvent.type(identifiant(), "finance");
    await userEvent.click(nom());
    await userEvent.keyboard("{Enter}");
    expect(nom()).toHaveFocus();
  });

  it("le focus ne bouge pas avant le premier envoi, ni pendant la saisie", async () => {
    ouvrir();
    await userEvent.click(groupe());
    await userEvent.type(groupe(), "g");
    expect(groupe()).toHaveFocus();
  });
});
