import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";

import dernier from "../../../../contracts/espaces/dernier-administrateur.json";
import espace from "../../../../contracts/espaces/espace.json";
import interdit from "../../../../contracts/espaces/interdit.json";
import introuvable from "../../../../contracts/espaces/introuvable.json";
import journal from "../../../../contracts/espaces/journal.json";
import journalAccords from "../../../../contracts/espaces/journal-accords.json";
import liaison from "../../../../contracts/espaces/liaison.json";
import liaisonInconnue from "../../../../contracts/espaces/liaison-inconnue.json";
import membres from "../../../../contracts/espaces/membres.json";
import inconnue from "../../../../contracts/espaces/personne-inconnue.json";
import personnes from "../../../../contracts/espaces/personnes.json";
import requeteInvalide from "../../../../contracts/espaces/requete-invalide.json";
import retrait from "../../../../contracts/espaces/retrait.json";
import { onSpaceLost } from "./lost";
import type { Fetch } from "./api";
import { decodeSpace } from "./model";
import { refusalText } from "./AdminParts";
import { MembersPage, NO_DATA_RIGHT } from "./MembersPage";

type Exemple = { status: number; body: unknown };
type Reponse = Exemple | (() => Promise<Response>);
const reponse = (exemple: Exemple) => (exemple.body === null ? new Response(null, { status: exemple.status }) : Response.json(exemple.body, { status: exemple.status }));
const FINANCE = decodeSpace(espace.body, "espace");
const MEMBRES = "GET /api/spaces/finance/members";
const JOURNAL = "GET /api/spaces/finance/events";
const POSE = "POST /api/spaces/finance/members";
const ID_ADMINS = "5b0e4c1e-7a51-4f0e-9a8e-1f2d3c4b5a60";
const ID_DOMINIQUE = "9c3f2a7d-0b14-4e6a-8d52-6a7b8c9d0e1f";

/** Serveur simulé : « MÉTHODE adresse » → réponse ; toute autre requête est inattendue. */
function serveur(table: Readonly<Record<string, Reponse>>): Mock<Fetch> {
  return vi.fn<Fetch>().mockImplementation((url, init) => {
    const cle = `${init?.method ?? "GET"} ${url}`;
    const exemple = table[cle];
    if (exemple === undefined) return Promise.reject(new Error(`appel inattendu : ${cle}`));
    return typeof exemple === "function" ? exemple() : Promise.resolve(reponse(exemple));
  });
}
const BASE = { [MEMBRES]: membres, [JOURNAL]: journal };
function differee() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((ok) => { resolve = ok; });
  return { promise, resolve };
}
const appels = (fetcher: Mock<Fetch>, cle: string) => fetcher.mock.calls.filter(([url, init]) => `${init?.method ?? "GET"} ${url}` === cle);
const corpsEnvoye = (fetcher: Mock<Fetch>, cle: string, rang = 0) => JSON.parse(appels(fetcher, cle)[rang]?.[1]?.body as string) as unknown;
const table = () => screen.getByRole("table", { name: "Liaisons de l'espace" });
const ligne = (nom: string | RegExp) => within(table()).getByRole("row", { name: nom });
const ouvrir = async (fetcher: Mock<Fetch>) => {
  render(<MembersPage space={FINANCE} fetcher={fetcher} />);
  await screen.findByRole("table", { name: "Liaisons de l'espace" });
  await screen.findByRole("list", { name: "Journal de l'espace" });
};
const membre = (id: string, principal: object, extra: object = {}) => ({
  id,
  principal,
  person: null,
  role: "reader",
  created_at: "2026-11-02T09:00:00+00:00",
  created_by: { issuer: "https://id.example.invalid", subject: "00u1a2b3c4" },
  created_by_person: null,
  ...extra,
});

describe("Membres et rôles : lecture (écrans §9, plan 08, 8.4)", () => {
  it("annonce les lectures, garde le rappel permanent, puis liste les liaisons", async () => {
    const liaisons = differee();
    const evenements = differee();
    const fetcher = serveur({ [MEMBRES]: () => liaisons.promise, [JOURNAL]: () => evenements.promise });
    render(<MembersPage space={FINANCE} fetcher={fetcher} />);
    expect(screen.getByRole("heading", { level: 1, name: "Membres et rôles" })).toBeInTheDocument();
    expect(screen.getByText("finance", { selector: ".sb-mono" }).parentElement).toHaveTextContent("Finance · finance");
    expect(screen.getByText(NO_DATA_RIGHT)).toBeInTheDocument();
    expect(NO_DATA_RIGHT).toBe("Un rôle ne donne aucun droit sur les données.");
    expect(screen.getByText("Lecture des liaisons…")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Lecture du journal…")).toHaveAttribute("aria-busy", "true");
    // Rien à ajouter tant que les liaisons ne sont pas lues.
    expect(screen.queryByRole("form", { name: "Ajouter une liaison" })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method, init?.signal instanceof AbortSignal])).toEqual([
      ["/api/spaces/finance/members", "GET", true],
      ["/api/spaces/finance/events", "GET", true],
    ]);
    await act(async () => { liaisons.resolve(reponse(membres)); evenements.resolve(reponse(journal)); await Promise.resolve(); });
    await screen.findByRole("table", { name: "Liaisons de l'espace" });
    expect(screen.getByText(NO_DATA_RIGHT)).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Ajouter une liaison" })).toBeInTheDocument();
  });

  it("chaque liaison dit son principal, son rôle, son auteur et sa date", async () => {
    await ouvrir(serveur(BASE));
    expect(within(table()).getAllByRole("columnheader").map((cellule) => cellule.textContent)).toEqual(["Membre", "Rôle", "Ajouté par", "Depuis", "Actions"]);
    const groupe = ligne(/Groupe finance-admins/);
    expect(within(groupe).getByRole("rowheader")).toHaveTextContent("Groupe finance-adminsGroupe");
    expect(within(groupe).getByRole("combobox", { name: "Rôle de Groupe finance-admins" })).toHaveValue("admin");
    expect(groupe).toHaveTextContent("Camille Martin");
    expect(groupe).toHaveTextContent(/2026.*UTC/);
    expect(within(groupe).getByRole("button", { name: "Retirer Groupe finance-admins" })).toHaveTextContent("Retirer");
    const personne = ligne(/Dominique Leroy/);
    expect(within(personne).getByRole("rowheader")).toHaveTextContent("Dominique LeroyPersonnedominique.leroy@example.invalid");
    expect(within(personne).getByRole("combobox", { name: "Rôle de Dominique Leroy" })).toHaveValue("reader");
    expect(within(within(personne).getByRole("combobox")).getAllByRole("option").map((option) => option.textContent)).toEqual(["Lecteur", "Créateur", "Administrateur"]);
  });

  it("une personne inconnue de Board se dit telle, nommée par son sujet et précisée par son émetteur ; un auteur inconnu se dit par son sujet", async () => {
    const liste = {
      members: [
        membre("a", { kind: "person", issuer: "https://id.example.invalid", subject: "sujet-x" }),
        membre("b", { kind: "person", issuer: "https://id.example.invalid", subject: "sujet-y" }, { person: { name: null, email: "y@ex" } }),
        membre("c", { kind: "person", issuer: "https://id.example.invalid", subject: "sujet-z" }, { person: { name: "Zoé", email: null } }),
      ],
    };
    await ouvrir(serveur({ [MEMBRES]: { status: 200, body: liste }, [JOURNAL]: journal }));
    const x = ligne(/sujet-x/);
    expect(within(x).getByRole("rowheader")).toHaveTextContent("sujet-xPersonneInconnue de Board ·https://id.example.invalid");
    expect(x).toHaveTextContent("00u1a2b3c4");
    // Connue sans nom : nommée par son adresse, précisée par son sujet.
    expect(within(ligne(/y@ex/)).getByRole("rowheader")).toHaveTextContent("y@exPersonnesujet-y");
    expect(within(ligne(/y@ex/)).getByRole("rowheader")).not.toHaveTextContent("Inconnue");
    // Connue sans adresse : précisée par son sujet.
    expect(within(ligne(/Zoé/)).getByRole("rowheader")).toHaveTextContent("ZoéPersonnesujet-z");
  });

  // Un nom blanc compte comme absent (libellé = adresse, détail = sujet), une adresse vide ne
  // s'affiche pas (détail = sujet), comme pour le libellé (`personLabel`).
  it("un nom ou une adresse blancs ne servent pas de détail d'une ligne", async () => {
    const liste = {
      members: [
        membre("b", { kind: "person", issuer: "https://id.example.invalid", subject: "sujet-y" }, { person: { name: "", email: "y@ex" } }),
        membre("c", { kind: "person", issuer: "https://id.example.invalid", subject: "sujet-z" }, { person: { name: "Zoé", email: " " } }),
      ],
    };
    await ouvrir(serveur({ [MEMBRES]: { status: 200, body: liste }, [JOURNAL]: journal }));
    expect(within(ligne(/y@ex/)).getByRole("rowheader")).toHaveTextContent("y@exPersonnesujet-y");
    expect(within(ligne(/Zoé/)).getByRole("rowheader")).toHaveTextContent("ZoéPersonnesujet-z");
  });

  it("une liste vide est dite, sans formulaire défaillant", async () => {
    await act(async () => { render(<MembersPage space={FINANCE} fetcher={serveur({ [MEMBRES]: { status: 200, body: { members: [] } }, [JOURNAL]: { status: 200, body: { events: [] } } })} />); await Promise.resolve(); });
    expect(await screen.findByText("Aucune liaison.")).toBeInTheDocument();
    expect(await screen.findByText("Aucun événement.")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Ajouter une liaison" })).toBeInTheDocument();
  });

  it("un rôle insuffisant est rendu tel que le serveur le dit, sans liste ni ajout", async () => {
    render(<MembersPage space={{ ...FINANCE, role: "creator" }} fetcher={serveur({ [MEMBRES]: interdit, [JOURNAL]: interdit })} />);
    await waitFor(() => { expect(screen.getAllByRole("alert")).toHaveLength(2); });
    for (const alerte of screen.getAllByRole("alert")) expect(alerte).toHaveTextContent("Votre rôle ne permet pas cette action.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Ajouter une liaison" })).not.toBeInTheDocument();
    expect(screen.getByText(NO_DATA_RIGHT)).toBeInTheDocument();
  });

  it("une panne de lecture n'affiche rien, et le dit", async () => {
    render(<MembersPage space={FINANCE} fetcher={serveur({ [MEMBRES]: () => Promise.reject(new TypeError("réseau")), [JOURNAL]: { status: 500, body: {} } })} />);
    await waitFor(() => { expect(screen.getAllByRole("alert")).toHaveLength(2); });
    const [liaisons, evenements] = screen.getAllByRole("alert");
    expect(liaisons).toHaveTextContent(/^Liaisons indisponibles : Le serveur Board ne répond pas\. Rien n'est affiché\.$/);
    expect(evenements).toHaveTextContent("Journal indisponible : Réponse inattendue du serveur (HTTP 500). Rien n'est affiché.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Journal de l'espace" })).not.toBeInTheDocument();
  });

  it("« Liaisons indisponibles », accordé au pluriel ; « Journal indisponible » au singulier", async () => {
    render(<MembersPage space={FINANCE} fetcher={serveur({ [MEMBRES]: () => Promise.reject(new TypeError("réseau")), [JOURNAL]: journal })} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Liaisons indisponibles : Le serveur Board ne répond pas. Rien n'est affiché.");
    expect(screen.queryByText(/Liaisons indisponible :/)).not.toBeInTheDocument();
  });

  it("un espace retiré pendant la lecture est signalé à la coque", async () => {
    const perdu = vi.fn();
    const quitter = onSpaceLost(perdu);
    try {
      render(<MembersPage space={FINANCE} fetcher={serveur({ [MEMBRES]: introuvable, [JOURNAL]: introuvable })} />);
      await waitFor(() => { expect(perdu).toHaveBeenCalledTimes(2); });
      expect(screen.getAllByRole("alert")[0]).toHaveTextContent("Espace introuvable.");
    } finally { quitter(); }
  });

  it("les onglets relient « Membres et rôles », courant, « Environnements » (plan 09, 9.4) et « Paramètres » (plan 10, 10.3)", async () => {
    await ouvrir(serveur(BASE));
    const onglets = screen.getByRole("navigation", { name: "Administration de l'espace" });
    expect(within(onglets).getAllByRole("link").map((lien) => [lien.textContent, lien.getAttribute("href"), lien.getAttribute("aria-current")])).toEqual([
      ["Membres et rôles", "#/espaces/finance/membres", "page"],
      ["Environnements", "#/espaces/finance/environnements", null],
      ["Paramètres", "#/espaces/finance/parametres", null],
    ]);
    // Les onglets suivent le titre et précèdent le rappel.
    const titre = screen.getByRole("heading", { level: 1, name: "Membres et rôles" });
    expect(titre.compareDocumentPosition(onglets) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(onglets.compareDocumentPosition(screen.getByText(NO_DATA_RIGHT)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("le journal raconte aussi les droits de déployer (plan 09, V6)", async () => {
    await ouvrir(serveur({ [MEMBRES]: membres, [JOURNAL]: journalAccords }));
    const entrees = within(screen.getByRole("list", { name: "Journal de l'espace" })).getAllByRole("listitem").map((item) => item.textContent.replace(/^.*UTC/, ""));
    expect(entrees.slice(0, 4)).toEqual([
      "Alix a retiré le droit de déployer en PROD au groupe finance-admins.",
      "Alix a accordé le droit de déployer en PROD au groupe finance-admins.",
      "Camille Martin a accordé le droit de déployer en DEV au groupe finance-createurs.",
      "Camille Martin a accordé le droit de déployer en TEST à Dominique Leroy.",
    ]);
  });

  it("encode l'identifiant de l'espace dans ses adresses", async () => {
    const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(Response.json(url.endsWith("/members") ? { members: [] } : { events: [] })));
    render(<MembersPage space={{ ...FINANCE, id: "a/b c" }} fetcher={fetcher} />);
    await screen.findByText("Aucune liaison.");
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/spaces/a%2Fb%20c/members", "/api/spaces/a%2Fb%20c/events"]);
  });
});

describe("Membres et rôles : changer un rôle, retirer une liaison", () => {
  it("un changement de rôle se confirme sur place ; le focus va au bouton de confirmation", async () => {
    const fetcher = serveur({ ...BASE, [POSE]: { status: 200, body: { ...liaison.body, role: "creator" } } });
    await ouvrir(fetcher);
    const role = within(ligne(/Dominique Leroy/)).getByRole("combobox", { name: "Rôle de Dominique Leroy" });
    await userEvent.selectOptions(role, "creator");
    const confirmation = within(ligne(/Dominique Leroy/)).getByRole("group", { name: "Passer Dominique Leroy de Lecteur à Créateur ?" });
    expect(confirmation).toHaveTextContent("Passer Dominique Leroy de Lecteur à Créateur ?");
    expect(within(confirmation).getByRole("button", { name: "Confirmer" })).toHaveFocus();
    expect(ligne(/Dominique Leroy/)).toHaveClass("sb-row--selected");
    // Rien n'est envoyé avant la confirmation.
    expect(appels(fetcher, POSE)).toHaveLength(0);
    await userEvent.keyboard("{Enter}");
    expect(corpsEnvoye(fetcher, POSE)).toEqual({ principal: { kind: "person", issuer: "https://id.example.invalid", subject: "00u5d6e7f8" }, role: "creator" });
    expect(await screen.findByText("Dominique Leroy : Créateur.")).toBeInTheDocument();
    expect(screen.getByText("Dominique Leroy : Créateur.").closest("[role]")).toHaveAttribute("role", "status");
    // La liste et le journal sont relus : ceux du serveur, jamais une copie corrigée sur place.
    await screen.findByRole("table", { name: "Liaisons de l'espace" });
    expect(appels(fetcher, MEMBRES)).toHaveLength(2);
    expect(appels(fetcher, JOURNAL)).toHaveLength(2);
    // Relue, la liste du serveur dit toujours « Lecteur » : c'est elle qui s'affiche.
    expect(within(ligne(/Dominique Leroy/)).getByRole("combobox")).toHaveValue("reader");
  });

  it("annuler rend le rôle d'origine, sans rien envoyer ; revenir au rôle d'origine retire la confirmation", async () => {
    const fetcher = serveur(BASE);
    await ouvrir(fetcher);
    const role = () => within(ligne(/Dominique Leroy/)).getByRole("combobox");
    await userEvent.selectOptions(role(), "admin");
    await userEvent.click(within(ligne(/Dominique Leroy/)).getByRole("button", { name: "Annuler" }));
    expect(role()).toHaveValue("reader");
    expect(within(ligne(/Dominique Leroy/)).queryByRole("group")).not.toBeInTheDocument();
    await userEvent.selectOptions(role(), "creator");
    expect(role()).toHaveValue("creator");
    await userEvent.selectOptions(role(), "reader");
    expect(within(ligne(/Dominique Leroy/)).queryByRole("group")).not.toBeInTheDocument();
    expect(within(ligne(/Dominique Leroy/)).getByRole("button", { name: "Retirer Dominique Leroy" })).toBeInTheDocument();
    expect(appels(fetcher, POSE)).toHaveLength(0);
  });

  it("un retrait se confirme sur place, au clavier, puis la liste est relue", async () => {
    const fetcher = serveur({ ...BASE, [`DELETE /api/spaces/finance/members/${ID_DOMINIQUE}`]: retrait });
    await ouvrir(fetcher);
    within(ligne(/Dominique Leroy/)).getByRole("button", { name: "Retirer Dominique Leroy" }).focus();
    await userEvent.keyboard("{Enter}");
    const confirmation = within(ligne(/Dominique Leroy/)).getByRole("group", { name: "Retirer Dominique Leroy ?" });
    const bouton = within(confirmation).getByRole("button", { name: "Retirer" });
    expect(bouton).toHaveFocus();
    // Le rôle ne se change pas pendant qu'un retrait attend sa confirmation.
    expect(within(ligne(/Dominique Leroy/)).getByRole("combobox")).toBeDisabled();
    await userEvent.keyboard("{Enter}");
    expect(appels(fetcher, `DELETE /api/spaces/finance/members/${ID_DOMINIQUE}`)).toHaveLength(1);
    expect(await screen.findByText("Liaison retirée : Dominique Leroy.")).toBeInTheDocument();
    await waitFor(() => { expect(appels(fetcher, MEMBRES)).toHaveLength(2); });
  });

  it("le dernier administrateur ne se retire pas : le refus s'affiche avec sa raison", async () => {
    const fetcher = serveur({ ...BASE, [`DELETE /api/spaces/finance/members/${ID_ADMINS}`]: dernier });
    await ouvrir(fetcher);
    await userEvent.click(within(ligne(/Groupe finance-admins/)).getByRole("button", { name: "Retirer Groupe finance-admins" }));
    await userEvent.click(within(ligne(/Groupe finance-admins/)).getByRole("button", { name: "Retirer" }));
    const alerte = await screen.findByRole("alert");
    expect(alerte).toHaveTextContent("C'est la dernière liaison administrateur de l'espace : ajoutez d'abord un autre administrateur.");
    await screen.findByRole("table", { name: "Liaisons de l'espace" });
    expect(ligne(/Groupe finance-admins/)).toBeInTheDocument();
    expect(appels(fetcher, MEMBRES)).toHaveLength(2);
  });

  it("le dernier administrateur ne s'abaisse pas non plus", async () => {
    const fetcher = serveur({ ...BASE, [POSE]: dernier });
    await ouvrir(fetcher);
    await userEvent.selectOptions(within(ligne(/Groupe finance-admins/)).getByRole("combobox"), "reader");
    expect(within(ligne(/Groupe finance-admins/)).getByRole("group")).toHaveAccessibleName("Passer Groupe finance-admins de Administrateur à Lecteur ?");
    await userEvent.click(within(ligne(/Groupe finance-admins/)).getByRole("button", { name: "Confirmer" }));
    expect(corpsEnvoye(fetcher, POSE)).toEqual({ principal: { kind: "group", name: "finance-admins" }, role: "reader" });
    expect(await screen.findByRole("alert")).toHaveTextContent(/dernière liaison administrateur/);
  });

  it("pendant l'envoi, aucune action n'est possible ; la réponse ferme la confirmation", async () => {
    const attente = differee();
    const fetcher = serveur({ ...BASE, [`DELETE /api/spaces/finance/members/${ID_DOMINIQUE}`]: () => attente.promise });
    await ouvrir(fetcher);
    await userEvent.click(within(ligne(/Dominique Leroy/)).getByRole("button", { name: "Retirer Dominique Leroy" }));
    const confirmer = within(ligne(/Dominique Leroy/)).getByRole("button", { name: "Retirer" });
    await userEvent.click(confirmer);
    expect(confirmer).toBeDisabled();
    expect(within(ligne(/Dominique Leroy/)).getByRole("button", { name: "Annuler" })).toBeDisabled();
    expect(within(ligne(/Groupe finance-admins/)).getByRole("button", { name: "Retirer Groupe finance-admins" })).toBeDisabled();
    expect(within(ligne(/Groupe finance-admins/)).getByRole("combobox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ajouter la liaison" })).toBeDisabled();
    // Un second clic n'envoie rien de plus.
    fireEvent.click(confirmer);
    expect(appels(fetcher, `DELETE /api/spaces/finance/members/${ID_DOMINIQUE}`)).toHaveLength(1);
    await act(async () => { attente.resolve(reponse(retrait)); await Promise.resolve(); });
    expect(await screen.findByText("Liaison retirée : Dominique Leroy.")).toBeInTheDocument();
  });

  it("une seule confirmation à la fois : en ouvrir une autre ferme la première et efface le message", async () => {
    const fetcher = serveur({ ...BASE, [`DELETE /api/spaces/finance/members/${ID_ADMINS}`]: dernier });
    await ouvrir(fetcher);
    await userEvent.click(within(ligne(/Groupe finance-admins/)).getByRole("button", { name: "Retirer Groupe finance-admins" }));
    await userEvent.click(within(ligne(/Groupe finance-admins/)).getByRole("button", { name: "Retirer" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await screen.findByRole("table", { name: "Liaisons de l'espace" });
    await userEvent.click(within(ligne(/Dominique Leroy/)).getByRole("button", { name: "Retirer Dominique Leroy" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.selectOptions(within(ligne(/Groupe finance-admins/)).getByRole("combobox"), "creator");
    expect(within(ligne(/Dominique Leroy/)).queryByRole("group")).not.toBeInTheDocument();
    expect(within(ligne(/Groupe finance-admins/)).getByRole("group")).toBeInTheDocument();
  });

  it.each([
    ["liaison disparue", liaisonInconnue, "Cette liaison n'existe plus : la liste a été relue."],
    ["rôle retiré entre-temps", interdit, "Votre rôle ne permet pas cette action."],
  ] as [string, Exemple, string][])("un refus du retrait (%s) est rendu avec sa raison", async (_cas, exemple, texte) => {
    const fetcher = serveur({ ...BASE, [`DELETE /api/spaces/finance/members/${ID_DOMINIQUE}`]: exemple });
    await ouvrir(fetcher);
    await userEvent.click(within(ligne(/Dominique Leroy/)).getByRole("button", { name: "Retirer Dominique Leroy" }));
    await userEvent.click(within(ligne(/Dominique Leroy/)).getByRole("button", { name: "Retirer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(texte);
  });

  it("une panne pendant l'écriture n'est pas un succès : elle est dite, et la liste relue", async () => {
    const fetcher = serveur({ ...BASE, [POSE]: () => Promise.reject(new TypeError("réseau")) });
    await ouvrir(fetcher);
    await userEvent.selectOptions(within(ligne(/Dominique Leroy/)).getByRole("combobox"), "admin");
    await userEvent.click(within(ligne(/Dominique Leroy/)).getByRole("button", { name: "Confirmer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Changement non confirmé : Le serveur Board ne répond pas. La liste a été relue.");
    await waitFor(() => { expect(appels(fetcher, MEMBRES)).toHaveLength(2); });
  });
});

describe("Membres et rôles : ajouter une liaison", () => {
  const formulaire = () => screen.getByRole("form", { name: "Ajouter une liaison" });
  const nomGroupe = () => within(formulaire()).getByRole("textbox", { name: /Nom exact du groupe/ });
  const roleAjout = () => within(formulaire()).getByRole("combobox", { name: "Rôle" });
  const ajouter = () => within(formulaire()).getByRole("button", { name: "Ajouter la liaison" });

  it("ajoute un groupe par son nom exact, sans le rogner, au rôle choisi", async () => {
    const fetcher = serveur({ ...BASE, [POSE]: { status: 200, body: { ...liaison.body, principal: { kind: "group", name: " Finance-Invités " }, person: null, role: "creator" } } });
    await ouvrir(fetcher);
    expect(roleAjout()).toHaveValue("reader");
    expect(ajouter()).toBeDisabled();
    await userEvent.type(nomGroupe(), " Finance-Invités ");
    await userEvent.selectOptions(roleAjout(), "creator");
    expect(ajouter()).toBeEnabled();
    await userEvent.click(ajouter());
    expect(corpsEnvoye(fetcher, POSE)).toEqual({ principal: { kind: "group", name: " Finance-Invités " }, role: "creator" });
    // Le message reprend le nom exact, espaces compris.
    expect(await screen.findByText("Groupe  Finance-Invités  : Créateur.", { normalizer: (texte) => texte })).toBeInTheDocument();
    await waitFor(() => { expect(appels(fetcher, MEMBRES)).toHaveLength(2); });
  });

  it("Entrée dans le nom du groupe envoie le formulaire", async () => {
    const fetcher = serveur({ ...BASE, [POSE]: liaison });
    await ouvrir(fetcher);
    await userEvent.type(nomGroupe(), "finance-x{Enter}");
    expect(corpsEnvoye(fetcher, POSE)).toEqual({ principal: { kind: "group", name: "finance-x" }, role: "reader" });
  });

  it("ajoute une personne connue cherchée par nom ou adresse", async () => {
    const autre = { ...personnes.body.people[0], subject: "00u-autre", name: "Dominique Autre", email: "d.autre@example.invalid" };
    const fetcher = serveur({ ...BASE, "GET /api/people?q=dominique": { status: 200, body: { people: [autre] } }, [POSE]: liaison });
    await ouvrir(fetcher);
    await userEvent.click(within(formulaire()).getByRole("radio", { name: "Personne connue" }));
    expect(ajouter()).toBeDisabled();
    await userEvent.type(within(formulaire()).getByRole("searchbox"), "dominique{Enter}");
    await userEvent.click(await within(formulaire()).findByRole("button", { name: /Dominique Autre/ }));
    await userEvent.selectOptions(roleAjout(), "admin");
    await userEvent.click(ajouter());
    expect(corpsEnvoye(fetcher, POSE)).toEqual({ principal: { kind: "person", issuer: "https://id.example.invalid", subject: "00u-autre" }, role: "admin" });
    expect(await screen.findByText("Dominique Autre : Administrateur.")).toBeInTheDocument();
  });

  it("un membre déjà lié au même rôle : rien ne changera, l'ajout est fermé", async () => {
    const fetcher = serveur(BASE);
    await ouvrir(fetcher);
    await userEvent.type(nomGroupe(), "finance-admins");
    await userEvent.selectOptions(roleAjout(), "admin");
    expect(within(formulaire()).getByRole("status")).toHaveTextContent("Groupe finance-admins a déjà le rôle Administrateur : rien ne changera.");
    expect(ajouter()).toBeDisabled();
    // Le même nom à la casse près est un autre groupe (E3) : il s'ajoute.
    await userEvent.clear(nomGroupe());
    await userEvent.type(nomGroupe(), "Finance-Admins");
    expect(within(formulaire()).queryByRole("status")).not.toBeInTheDocument();
    expect(ajouter()).toBeEnabled();
  });

  it("un membre déjà lié à un autre rôle : la page le dit et fait confirmer le changement", async () => {
    const fetcher = serveur({ ...BASE, "GET /api/people?q=leroy": personnes, [POSE]: { status: 200, body: { ...liaison.body, role: "admin" } } });
    await ouvrir(fetcher);
    await userEvent.click(within(formulaire()).getByRole("radio", { name: "Personne connue" }));
    await userEvent.type(within(formulaire()).getByRole("searchbox"), "leroy{Enter}");
    await userEvent.click(await within(formulaire()).findByRole("button", { name: /Dominique Leroy/ }));
    expect(within(formulaire()).getByRole("status")).toHaveTextContent("Dominique Leroy a déjà le rôle Lecteur : rien ne changera.");
    await userEvent.selectOptions(roleAjout(), "admin");
    expect(within(formulaire()).getByRole("status")).toHaveTextContent("Dominique Leroy a déjà le rôle Lecteur.");
    await userEvent.click(ajouter());
    const confirmation = within(formulaire()).getByRole("group", { name: "Passer Dominique Leroy de Lecteur à Administrateur ?" });
    expect(within(confirmation).getByRole("button", { name: "Confirmer" })).toHaveFocus();
    expect(appels(fetcher, POSE)).toHaveLength(0);
    // Annuler revient au bouton d'ajout ; changer le rôle ferme aussi la confirmation.
    await userEvent.click(within(confirmation).getByRole("button", { name: "Annuler" }));
    expect(within(formulaire()).queryByRole("group", { name: /Passer/ })).not.toBeInTheDocument();
    await userEvent.click(ajouter());
    await userEvent.selectOptions(roleAjout(), "creator");
    expect(within(formulaire()).queryByRole("group", { name: /Passer/ })).not.toBeInTheDocument();
    await userEvent.click(ajouter());
    await userEvent.click(within(formulaire()).getByRole("button", { name: "Confirmer" }));
    expect(corpsEnvoye(fetcher, POSE)).toEqual({ principal: { kind: "person", issuer: "https://id.example.invalid", subject: "00u5d6e7f8" }, role: "creator" });
    expect(await screen.findByText("Dominique Leroy : Créateur.")).toBeInTheDocument();
  });

  it("changer de membre ferme une confirmation en attente", async () => {
    await ouvrir(serveur(BASE));
    await userEvent.type(nomGroupe(), "finance-admins");
    await userEvent.click(ajouter());
    expect(within(formulaire()).getByRole("group", { name: /Passer Groupe finance-admins/ })).toBeInTheDocument();
    await userEvent.type(nomGroupe(), "2");
    expect(within(formulaire()).queryByRole("group", { name: /Passer/ })).not.toBeInTheDocument();
  });

  it.each([
    ["personne inconnue", inconnue, "Cette personne n'est pas connue de Board : elle doit s'être connectée une fois."],
    ["champ en cause connu", { status: 400, body: { error: { code: "invalid_request", field: "principal.name" } } }, "La demande est incomplète ou mal formée. Champ en cause : nom du groupe."],
    ["champ en cause nommé", requeteInvalide, "La demande est incomplète ou mal formée. Champ en cause : type de premier administrateur."],
    ["champ hors liste", { status: 400, body: { error: { code: "invalid_request", field: "principal.extra" } } }, "La demande est incomplète ou mal formée. Champ en cause : principal.extra."],
  ] as [string, Exemple, string][])("un refus de l'ajout (%s) est rendu avec sa raison", async (_cas, exemple, texte) => {
    const fetcher = serveur({ ...BASE, [POSE]: exemple });
    await ouvrir(fetcher);
    await userEvent.type(nomGroupe(), "g");
    await userEvent.click(ajouter());
    expect(await screen.findByRole("alert")).toHaveTextContent(texte);
  });

  it("le formulaire envoyé sans membre ne part pas", async () => {
    const fetcher = serveur(BASE);
    await ouvrir(fetcher);
    fireEvent.submit(formulaire());
    expect(appels(fetcher, POSE)).toHaveLength(0);
  });
});

describe("Journal de l'espace, en lecture", () => {
  const entrees = () => within(screen.getByRole("list", { name: "Journal de l'espace" })).getAllByRole("listitem").map((item) => item.textContent);

  it("raconte les événements de l'exemple, auteur nommé, personne citée nommée", async () => {
    await ouvrir(serveur(BASE));
    const [ajoutPersonne, ajoutGroupe, creation] = entrees();
    expect(ajoutPersonne).toMatch(/UTCCamille Martin a ajouté Dominique Leroy : Lecteur\.$/);
    expect(ajoutGroupe).toMatch(/Camille Martin a ajouté le groupe finance-admins : Administrateur\.$/);
    expect(creation).toMatch(/Camille Martin a créé l'espace « Finance »\.$/);
    // Aucune action ne s'écrit dans le journal depuis la page.
    expect(within(screen.getByRole("list", { name: "Journal de l'espace" })).queryByRole("button")).not.toBeInTheDocument();
  });

  it("raconte changements et retraits ; une action ou un détail inattendus sont montrés tels quels", async () => {
    const auteur = { issuer: "https://id.example.invalid", subject: "sujet-auteur" };
    const evenement = (id: number, action: string, detail: unknown, actorPerson: unknown = null) => ({ id, at: "2026-11-02T10:00:00+00:00", actor: auteur, actor_person: actorPerson, action, detail, principal_person: null });
    const groupe = { kind: "group", name: "finance-lecteurs" };
    const absente = { kind: "person", issuer: "https://id.example.invalid", subject: "sujet-parti" };
    const events = [
      evenement(9, "binding_changed", { principal: groupe, before: "reader", after: "creator" }, { name: null, email: "auteur@ex" }),
      evenement(8, "binding_removed", { principal: absente, before: "admin" }),
      evenement(7, "binding_purged", { principal: groupe }),
      evenement(6, "binding_added", { principal: groupe, after: "owner" }),
      evenement(5, "binding_added", { principal: { kind: "robot" }, after: "reader" }),
      evenement(4, "space_created", { title: "x" }),
      evenement(3, "binding_changed", "texte"),
      evenement(2, "binding_removed", null),
      evenement(1, "binding_added", { principal: { kind: "group", name: 3 }, after: "reader" }),
    ];
    await ouvrir(serveur({ [MEMBRES]: membres, [JOURNAL]: { status: 200, body: { events } } }));
    expect(entrees().map((texte) => texte.replace(/^.*UTC/, ""))).toEqual([
      "auteur@ex a changé le rôle de le groupe finance-lecteurs : Lecteur → Créateur.",
      "sujet-auteur a retiré sujet-parti (Administrateur).",
      'sujet-auteur action non reconnue : binding_purged {"principal":{"kind":"group","name":"finance-lecteurs"}}',
      'sujet-auteur action non reconnue : binding_added {"principal":{"kind":"group","name":"finance-lecteurs"},"after":"owner"}',
      'sujet-auteur action non reconnue : binding_added {"principal":{"kind":"robot"},"after":"reader"}',
      'sujet-auteur action non reconnue : space_created {"title":"x"}',
      'sujet-auteur action non reconnue : binding_changed "texte"',
      "sujet-auteur action non reconnue : binding_removed null",
      'sujet-auteur action non reconnue : binding_added {"principal":{"kind":"group","name":3},"after":"reader"}',
    ]);
  });

  it("le journal se lit même si les liaisons sont illisibles ; une personne citée est nommée par le serveur", async () => {
    render(<MembersPage space={FINANCE} fetcher={serveur({ [MEMBRES]: { status: 500, body: {} }, [JOURNAL]: journal })} />);
    await screen.findByRole("list", { name: "Journal de l'espace" });
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Liaisons indisponibles : Réponse inattendue du serveur \(HTTP 500\)\./);
    expect(entrees()[0]).toMatch(/a ajouté Dominique Leroy : Lecteur\.$/);
  });

  it("une personne retirée reste nommée par `principal_person`, sinon par son adresse, sinon son sujet", async () => {
    const auteur = { issuer: "https://id.example.invalid", subject: "sujet-auteur" };
    const partie = { kind: "person", issuer: "https://id.example.invalid", subject: "sujet-parti" };
    const evenement = (id: number, principalPerson: unknown) => ({
      id,
      at: "2026-11-02T10:00:00+00:00",
      actor: auteur,
      actor_person: null,
      action: "binding_removed",
      detail: { principal: partie, before: "reader" },
      principal_person: principalPerson,
    });
    const events = [
      evenement(4, { name: "Alix Partie", email: "alix@example.invalid" }),
      evenement(3, { name: " ", email: "alix@example.invalid" }),
      evenement(2, { name: null, email: null }),
      evenement(1, null),
    ];
    // La personne n'est plus dans les liaisons : son nom ne peut venir que du journal.
    await ouvrir(serveur({ [MEMBRES]: membres, [JOURNAL]: { status: 200, body: { events } } }));
    expect(entrees().map((texte) => texte.replace(/^.*UTC/, ""))).toEqual([
      "sujet-auteur a retiré Alix Partie (Lecteur).",
      "sujet-auteur a retiré alix@example.invalid (Lecteur).",
      "sujet-auteur a retiré sujet-parti (Lecteur).",
      "sujet-auteur a retiré sujet-parti (Lecteur).",
    ]);
  });

  it("un groupe cité n'est jamais nommé par `principal_person`, même si le serveur en donnait un", async () => {
    const events = [
      {
        id: 1,
        at: "2026-11-02T10:00:00+00:00",
        actor: { issuer: "i", subject: "s" },
        actor_person: null,
        action: "binding_added",
        detail: { principal: { kind: "group", name: "finance-x" }, after: "reader" },
        principal_person: { name: "Quelqu'un", email: null },
      },
    ];
    await ouvrir(serveur({ [MEMBRES]: membres, [JOURNAL]: { status: 200, body: { events } } }));
    expect(entrees()[0]).toMatch(/s a ajouté le groupe finance-x : Lecteur\.$/);
  });
});

describe("Libellé d'un refus", () => {
  it.each([
    [{ code: "last_admin", field: null }, "C'est la dernière liaison administrateur de l'espace : ajoutez d'abord un autre administrateur."],
    [{ code: "invalid_request", field: "id" }, "La demande est incomplète ou mal formée. Champ en cause : identifiant."],
    [{ code: "invalid_request", field: "name" }, "La demande est incomplète ou mal formée. Champ en cause : nom."],
    [{ code: "invalid_request", field: "role" }, "La demande est incomplète ou mal formée. Champ en cause : rôle."],
    [{ code: "invalid_request", field: "environment" }, "La demande est incomplète ou mal formée. Champ en cause : environnement."],
    [{ code: "grant_not_found", field: null }, "Ce droit de déployer n'existe plus : la liste a été relue."],
    [{ code: "invalid_request", field: "principal" }, "La demande est incomplète ou mal formée. Champ en cause : membre."],
    [{ code: "invalid_request", field: "first_admin" }, "La demande est incomplète ou mal formée. Champ en cause : premier administrateur."],
    [{ code: "invalid_request", field: "first_admin.name" }, "La demande est incomplète ou mal formée. Champ en cause : nom du groupe."],
    [{ code: "invalid_request", field: "body" }, "La demande est incomplète ou mal formée. Champ en cause : corps de la demande."],
    [{ code: "invalid_request", field: "principal.issuer" }, "La demande est incomplète ou mal formée. Champ en cause : personne."],
    [{ code: "invalid_request", field: "inconnu" }, "La demande est incomplète ou mal formée. Champ en cause : inconnu."],
  ] as const)("%j", (refus, texte) => {
    expect(refusalText(refus)).toBe(texte);
  });

  // Champs que le serveur peut nommer dans `invalid_request` (spaces/web.py : `_object`, `_text`,
  // `_principal`, `_role`, `_space_id`, `_space_name`) : aucun n'est montré brut.
  it.each([
    "body",
    "id",
    "name",
    "role",
    "environment",
    "principal",
    "principal.kind",
    "principal.name",
    "principal.issuer",
    "principal.subject",
    "first_admin",
    "first_admin.kind",
    "first_admin.name",
    "first_admin.issuer",
    "first_admin.subject",
  ])("le champ %s a un libellé lisible", (champ) => {
    const texte = refusalText({ code: "invalid_request", field: champ });
    expect(texte).toMatch(/Champ en cause : [a-zéèêàçô ]+\.$/);
    expect(texte).not.toContain(`: ${champ}.`);
  });
});

describe("Après une écriture : relecture, focus et coque prévenue", () => {
  const formulaire = () => screen.getByRole("form", { name: "Ajouter une liaison" });
  const nomGroupe = () => within(formulaire()).getByRole("textbox", { name: /Nom exact du groupe/ });
  const ajouter = () => within(formulaire()).getByRole("button", { name: "Ajouter la liaison" });
  const bandeau = () => document.querySelector<HTMLElement>(".sb-members__feedback");

  it.each([
    ["succès", { status: 200, body: { ...liaison.body, role: "admin" } }, "Dominique Leroy : Administrateur."],
    ["refus", dernier, "C'est la dernière liaison administrateur"],
    ["panne", { status: 503, body: "" }, "Changement non confirmé : Réponse inattendue du serveur (HTTP 503)."],
  ] as [string, Exemple, string][])("le focus va au bandeau de réponse (%s), la ligne confirmée ayant pu disparaître", async (_cas, exemple, texte) => {
    const fetcher = serveur({ ...BASE, [POSE]: exemple });
    await ouvrir(fetcher);
    await userEvent.selectOptions(within(ligne(/Dominique Leroy/)).getByRole("combobox"), "admin");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => { expect(bandeau()).toHaveFocus(); });
    expect(bandeau()).toHaveAttribute("tabindex", "-1");
    expect(bandeau()).toHaveTextContent(texte);
  });

  it("un nouveau message reprend le focus, même identique au précédent", async () => {
    const fetcher = serveur({ ...BASE, [POSE]: dernier });
    await ouvrir(fetcher);
    for (let fois = 0; fois < 2; fois += 1) {
      await userEvent.selectOptions(within(ligne(/Groupe finance-admins/)).getByRole("combobox"), "reader");
      expect(within(ligne(/Groupe finance-admins/)).getByRole("button", { name: "Confirmer" })).toHaveFocus();
      await userEvent.keyboard("{Enter}");
      await waitFor(() => { expect(bandeau()).toHaveFocus(); });
    }
    expect(appels(fetcher, POSE)).toHaveLength(2);
  });

  it.each([
    ["un changement de rôle", (rangee: HTMLElement) => userEvent.selectOptions(within(rangee).getByRole("combobox"), "admin")],
    ["un retrait", (rangee: HTMLElement) => userEvent.click(within(rangee).getByRole("button", { name: /^Retirer / }))],
  ] as [string, (rangee: HTMLElement) => Promise<void>][])("annuler %s rend le focus au bouton « Retirer » de la ligne", async (_cas, ouvrirConfirmation) => {
    await ouvrir(serveur(BASE));
    await ouvrirConfirmation(ligne(/Dominique Leroy/));
    await userEvent.click(within(ligne(/Dominique Leroy/)).getByRole("button", { name: "Annuler" }));
    expect(within(ligne(/Dominique Leroy/)).getByRole("button", { name: "Retirer Dominique Leroy" })).toHaveFocus();
  });

  it("annuler au clavier rend aussi le focus au bouton « Retirer »", async () => {
    await ouvrir(serveur(BASE));
    within(ligne(/Dominique Leroy/)).getByRole("button", { name: "Retirer Dominique Leroy" }).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.tab();
    expect(within(ligne(/Dominique Leroy/)).getByRole("button", { name: "Annuler" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(within(ligne(/Dominique Leroy/)).getByRole("button", { name: "Retirer Dominique Leroy" })).toHaveFocus();
  });

  it("ouvrir la confirmation d'une autre ligne ne ramène pas le focus sur la première", async () => {
    await ouvrir(serveur(BASE));
    await userEvent.click(within(ligne(/Dominique Leroy/)).getByRole("button", { name: "Retirer Dominique Leroy" }));
    await userEvent.click(within(ligne(/Groupe finance-admins/)).getByRole("button", { name: "Retirer Groupe finance-admins" }));
    expect(within(ligne(/Groupe finance-admins/)).getByRole("button", { name: "Retirer" })).toHaveFocus();
    expect(within(ligne(/Dominique Leroy/)).getByRole("button", { name: "Retirer Dominique Leroy" })).not.toHaveFocus();
  });

  it("la coque est prévenue après chaque écriture, refus et panne compris, jamais avant", async () => {
    const reponses: Exemple[] = [{ status: 200, body: { ...liaison.body, role: "admin" } }, dernier, { status: 500, body: "" }];
    const fetcher = serveur({ ...BASE, [POSE]: () => Promise.resolve(reponse(reponses.shift() ?? dernier)) });
    const ecrit = vi.fn();
    render(<MembersPage space={FINANCE} fetcher={fetcher} onWritten={ecrit} />);
    await screen.findByRole("table", { name: "Liaisons de l'espace" });
    expect(ecrit).not.toHaveBeenCalled();
    for (let fois = 1; fois <= 3; fois += 1) {
      await userEvent.selectOptions(within(ligne(/Dominique Leroy/)).getByRole("combobox"), "admin");
      expect(ecrit).toHaveBeenCalledTimes(fois - 1);
      await userEvent.click(within(ligne(/Dominique Leroy/)).getByRole("button", { name: "Confirmer" }));
      await waitFor(() => { expect(ecrit).toHaveBeenCalledTimes(fois); });
    }
    // Annuler n'écrit rien : la coque n'est pas prévenue.
    await userEvent.click(within(ligne(/Dominique Leroy/)).getByRole("button", { name: "Retirer Dominique Leroy" }));
    await userEvent.click(within(ligne(/Dominique Leroy/)).getByRole("button", { name: "Annuler" }));
    expect(ecrit).toHaveBeenCalledTimes(3);
  });

  it("pendant la relecture, la liste, le formulaire et le journal précédents restent affichés", async () => {
    const relecture = differee();
    let lectures = 0;
    const fetcher = serveur({
      [MEMBRES]: () => {
        lectures += 1;
        return lectures === 1 ? Promise.resolve(reponse(membres)) : relecture.promise;
      },
      [JOURNAL]: journal,
      [POSE]: inconnue,
    });
    await ouvrir(fetcher);
    await userEvent.type(nomGroupe(), "finance-x");
    await userEvent.click(ajouter());
    await waitFor(() => { expect(lectures).toBe(2); });
    expect(screen.queryByText("Lecture des liaisons…")).not.toBeInTheDocument();
    expect(screen.queryByText("Lecture du journal…")).not.toBeInTheDocument();
    expect(table()).toBeInTheDocument();
    expect(nomGroupe()).toHaveValue("finance-x");
    // La nouvelle liste du serveur remplace l'ancienne dès qu'elle arrive.
    const nouvelle = { members: [membres.body.members[0]] };
    await act(async () => { relecture.resolve(Response.json(nouvelle)); await Promise.resolve(); });
    await waitFor(() => { expect(within(table()).queryByRole("row", { name: /Dominique Leroy/ })).not.toBeInTheDocument(); });
    expect(nomGroupe()).toHaveValue("finance-x");
  });

  it.each([
    ["personne inconnue", inconnue],
    ["requête invalide", requeteInvalide],
    ["panne", { status: 502, body: "" }],
  ] as [string, Exemple][])("un ajout refusé (%s) garde la saisie, pour la corriger", async (_cas, exemple) => {
    const fetcher = serveur({ ...BASE, [POSE]: exemple });
    await ouvrir(fetcher);
    await userEvent.type(nomGroupe(), "Finance-X ");
    await userEvent.selectOptions(within(formulaire()).getByRole("combobox", { name: "Rôle" }), "creator");
    await userEvent.click(ajouter());
    await waitFor(() => { expect(bandeau()).toHaveFocus(); });
    await waitFor(() => { expect(appels(fetcher, MEMBRES)).toHaveLength(2); });
    expect(nomGroupe()).toHaveValue("Finance-X ");
    expect(within(formulaire()).getByRole("combobox", { name: "Rôle" })).toHaveValue("creator");
    expect(ajouter()).toBeEnabled();
  });

  it("une personne choisie reste choisie après un refus", async () => {
    const fetcher = serveur({ ...BASE, "GET /api/people?q=leroy": personnes, [POSE]: inconnue });
    await ouvrir(fetcher);
    await userEvent.click(within(formulaire()).getByRole("radio", { name: "Personne connue" }));
    await userEvent.type(within(formulaire()).getByRole("searchbox"), "leroy{Enter}");
    await userEvent.click(await within(formulaire()).findByRole("button", { name: /Dominique Leroy/ }));
    await userEvent.selectOptions(within(formulaire()).getByRole("combobox", { name: "Rôle" }), "admin");
    await userEvent.click(ajouter());
    await userEvent.click(within(formulaire()).getByRole("button", { name: "Confirmer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cette personne n'est pas connue de Board");
    expect(within(formulaire()).getByRole("radio", { name: "Personne connue" })).toBeChecked();
    expect(formulaire()).toHaveTextContent("Dominique Leroy");
  });

  it("un ajout accepté vide la saisie ; le rôle choisi reste", async () => {
    const fetcher = serveur({ ...BASE, [POSE]: liaison });
    await ouvrir(fetcher);
    await userEvent.type(nomGroupe(), "finance-x");
    await userEvent.selectOptions(within(formulaire()).getByRole("combobox", { name: "Rôle" }), "creator");
    await userEvent.click(ajouter());
    await waitFor(() => { expect(nomGroupe()).toHaveValue(""); });
    expect(ajouter()).toBeDisabled();
    expect(within(formulaire()).getByRole("combobox", { name: "Rôle" })).toHaveValue("creator");
  });
});
