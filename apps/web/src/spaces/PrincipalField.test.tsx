import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import personnes from "../../../../contracts/espaces/personnes.json";
import rechercheInvalide from "../../../../contracts/espaces/recherche-invalide.json";
import type { Fetch } from "./api";
import type { KnownPerson } from "./model";
import { EMPTY_DRAFT, GROUP_MAX, PrincipalField, principalOf, QUERY_MAX, type PrincipalDraft } from "./PrincipalField";

const DOMINIQUE: KnownPerson = {
  issuer: "https://id.example.invalid",
  subject: "00u5d6e7f8",
  name: "Dominique Leroy",
  email: "dominique.leroy@example.invalid",
  lastLogin: new Date("2026-11-02T08:45:00Z"),
};
const servir = (status: number, body: unknown) => vi.fn<Fetch>().mockResolvedValue(Response.json(body, { status }));
function differee() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((ok) => { resolve = ok; });
  return { promise, resolve };
}

/** Champ contrôlé dans un formulaire, comme dans les pages qui l'utilisent. */
function Banc({ fetcher, initial = EMPTY_DRAFT, onChange, onSubmit, disabled }: { fetcher: Fetch; initial?: PrincipalDraft; onChange?: (draft: PrincipalDraft) => void; onSubmit?: () => void; disabled?: boolean }) {
  const [draft, setDraft] = useState(initial);
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit?.(); }}>
      <PrincipalField legend="Membre" draft={draft} onChange={(next) => { onChange?.(next); setDraft(next); }} fetcher={fetcher} disabled={disabled ?? false} />
    </form>
  );
}
const recherche = () => screen.getByRole("searchbox", { name: "Nom ou adresse" });
const passerAPersonne = async () => { await userEvent.click(screen.getByRole("radio", { name: "Personne connue" })); };

describe("Principal à envoyer (E3)", () => {
  it("un groupe vide n'est pas un principal ; un groupe est envoyé tel quel, espaces et casse compris", () => {
    expect(principalOf(EMPTY_DRAFT)).toBeNull();
    expect(principalOf({ kind: "group", name: " Finance-Admins " })).toEqual({ kind: "group", name: " Finance-Admins " });
    expect(principalOf({ kind: "group", name: " " })).toEqual({ kind: "group", name: " " });
  });

  it("une personne non choisie n'est pas un principal ; une personne choisie l'est par émetteur et sujet seulement", () => {
    expect(principalOf({ kind: "person", person: null })).toBeNull();
    expect(principalOf({ kind: "person", person: DOMINIQUE })).toEqual({ kind: "person", issuer: DOMINIQUE.issuer, subject: DOMINIQUE.subject });
  });

  it("garde les limites du serveur", () => {
    expect([QUERY_MAX, GROUP_MAX]).toEqual([200, 256]);
  });
});

describe("Saisie d'un groupe", () => {
  it("propose un groupe par défaut, nommé à la lettre, avec son indication", async () => {
    const onChange = vi.fn();
    render(<Banc fetcher={vi.fn<Fetch>()} onChange={onChange} />);
    expect(screen.getByRole("group", { name: "Membre" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Groupe du fournisseur" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Personne connue" })).not.toBeChecked();
    const champ = screen.getByRole("textbox", { name: /Nom exact du groupe/ });
    expect(champ).toHaveAttribute("maxLength", "256");
    expect(champ).toHaveAttribute("spellcheck", "false");
    expect(champ).toHaveAccessibleDescription("Valeur exacte du claim des groupes, casse comprise.");
    await userEvent.type(champ, " Fi ");
    expect(onChange).toHaveBeenLastCalledWith({ kind: "group", name: " Fi " });
    expect(champ).toHaveValue(" Fi ");
  });

  it("les deux choix d'un même champ forment un seul groupe radio, distinct d'un autre champ", () => {
    render(<><Banc fetcher={vi.fn<Fetch>()} /><Banc fetcher={vi.fn<Fetch>()} /></>);
    const radios = screen.getAllByRole("radio");
    const noms = radios.map((radio) => radio.getAttribute("name"));
    expect(noms[0]).toBe(noms[1]);
    expect(noms[2]).toBe(noms[3]);
    expect(noms[0]).not.toBe(noms[2]);
  });

  it("passer à une personne puis revenir au groupe repart d'une saisie vide", async () => {
    const onChange = vi.fn();
    render(<Banc fetcher={vi.fn<Fetch>()} onChange={onChange} />);
    await userEvent.type(screen.getByRole("textbox", { name: /Nom exact du groupe/ }), "g");
    await passerAPersonne();
    expect(onChange).toHaveBeenLastCalledWith({ kind: "person", person: null });
    await userEvent.click(screen.getByRole("radio", { name: "Groupe du fournisseur" }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: "group", name: "" });
    expect(screen.getByRole("textbox", { name: /Nom exact du groupe/ })).toHaveValue("");
  });

  it("désactivé, rien ne se saisit", () => {
    render(<Banc fetcher={vi.fn<Fetch>()} disabled />);
    expect(screen.getByRole("group", { name: "Membre" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: /Nom exact du groupe/ })).toBeDisabled();
  });
});

describe("Recherche d'une personne connue (E5)", () => {
  it("cherche par nom ou adresse : bouton inactif sur une recherche vide, résultat choisi par clic", async () => {
    const fetcher = servir(200, personnes.body);
    const onChange = vi.fn();
    render(<Banc fetcher={fetcher} onChange={onChange} />);
    await passerAPersonne();
    expect(recherche()).toHaveAttribute("maxLength", "200");
    expect(recherche()).toHaveAccessibleDescription("Seules les personnes déjà connectées une fois sont connues de Board.");
    const chercher = screen.getByRole("button", { name: "Chercher" });
    expect(chercher).toBeDisabled();
    await userEvent.type(recherche(), "   ");
    expect(chercher).toBeDisabled();
    await userEvent.clear(recherche());
    await userEvent.type(recherche(), " domi ");
    await userEvent.click(chercher);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/people?q=domi", expect.objectContaining({ signal: expect.any(AbortSignal) as AbortSignal }));
    const resultats = await screen.findByRole("list", { name: "Personnes trouvées" });
    const choix = within(resultats).getByRole("button", { name: /Dominique Leroy/ });
    expect(choix).toHaveTextContent("Dominique Leroydominique.leroy@example.invalid");
    await userEvent.click(choix);
    expect(onChange).toHaveBeenLastCalledWith({ kind: "person", person: DOMINIQUE });
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByText("Dominique Leroy")).toBeInTheDocument();
    expect(screen.getByText(/dominique\.leroy@example\.invalid/)).toBeInTheDocument();
  });

  it("Entrée cherche sans envoyer le formulaire ; une recherche vide n'interroge rien", async () => {
    const fetcher = servir(200, personnes.body);
    const onSubmit = vi.fn();
    render(<Banc fetcher={fetcher} onSubmit={onSubmit} />);
    await passerAPersonne();
    await userEvent.type(recherche(), "  {Enter}");
    expect(fetcher).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.type(recherche(), "dom{Enter}");
    expect(await screen.findByRole("list", { name: "Personnes trouvées" })).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    // Une autre touche ne cherche pas.
    fireEvent.keyDown(recherche(), { key: "a" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("annonce la recherche en cours, puis l'absence de résultat avec la marche à suivre", async () => {
    const attente = differee();
    render(<Banc fetcher={vi.fn<Fetch>().mockReturnValue(attente.promise)} />);
    await passerAPersonne();
    await userEvent.type(recherche(), "zoé{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent("Recherche…");
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    await act(async () => { attente.resolve(Response.json({ people: [] })); await Promise.resolve(); });
    expect(await screen.findByRole("status")).toHaveTextContent("Aucune personne connue ne correspond. Une personne s'ajoute après sa première connexion, ou par un groupe.");
  });

  it("rend un refus avec sa raison, et une panne comme une recherche impossible", async () => {
    const fetcher = vi.fn<Fetch>()
      .mockResolvedValueOnce(Response.json(rechercheInvalide.body, { status: rechercheInvalide.status }))
      .mockRejectedValueOnce(new TypeError("réseau"));
    render(<Banc fetcher={fetcher} />);
    await passerAPersonne();
    await userEvent.type(recherche(), "x{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("La recherche est vide ou trop longue.");
    await userEvent.type(recherche(), "y{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Recherche impossible : Le serveur Board ne répond pas.");
  });

  it("distingue des homonymes par l'adresse, sinon par le sujet, sinon par l'émetteur", async () => {
    const people = [
      { issuer: "https://a", subject: "s1", name: "Alex", email: "alex@a", last_login: "2026-11-02T08:00:00Z" },
      { issuer: "https://a", subject: "s2", name: "Alex", email: null, last_login: "2026-11-02T08:00:00Z" },
      { issuer: "https://a", subject: "s3", name: null, email: "anon@a", last_login: "2026-11-02T08:00:00Z" },
      { issuer: "https://b", subject: "s4", name: null, email: null, last_login: "2026-11-02T08:00:00Z" },
    ];
    render(<Banc fetcher={servir(200, { people })} />);
    await passerAPersonne();
    await userEvent.type(recherche(), "a{Enter}");
    const boutons = within(await screen.findByRole("list", { name: "Personnes trouvées" })).getAllByRole("button");
    expect(boutons.map((bouton) => bouton.textContent)).toEqual(["Alexalex@a", "Alexs2", "anon@as3", "s4https://b"]);
  });

  // Un nom ou une adresse blancs comptent comme absents, comme pour le libellé (`personLabel`).
  it("un nom ou une adresse blancs ne servent pas de détail d'un résultat", async () => {
    const people = [
      { issuer: "https://a", subject: "s2", name: "Alex", email: "", last_login: "2026-11-02T08:00:00Z" },
      { issuer: "https://a", subject: "s3", name: " ", email: "anon@a", last_login: "2026-11-02T08:00:00Z" },
      { issuer: "https://b", subject: "s4", name: "", email: "", last_login: "2026-11-02T08:00:00Z" },
    ];
    render(<Banc fetcher={servir(200, { people })} />);
    await passerAPersonne();
    await userEvent.type(recherche(), "a{Enter}");
    const boutons = within(await screen.findByRole("list", { name: "Personnes trouvées" })).getAllByRole("button");
    expect(boutons.map((bouton) => bouton.textContent)).toEqual(["Alexs2", "anon@as3", "s4https://b"]);
  });

  it("« Changer de personne » rouvre la recherche", async () => {
    const onChange = vi.fn();
    render(<Banc fetcher={servir(200, personnes.body)} initial={{ kind: "person", person: DOMINIQUE }} onChange={onChange} />);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Changer de personne" }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: "person", person: null });
    expect(recherche()).toBeInTheDocument();
  });

  it("une personne choisie sans nom se présente par son adresse ou son sujet", () => {
    render(<Banc fetcher={vi.fn<Fetch>()} initial={{ kind: "person", person: { ...DOMINIQUE, name: null } }} />);
    expect(screen.getByText("dominique.leroy@example.invalid", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/00u5d6e7f8/)).toBeInTheDocument();
  });

  it("une recherche plus récente remplace l'ancienne : l'ancienne est abandonnée et sa réponse ignorée", async () => {
    const premiere = differee();
    const seconde = differee();
    const fetcher = vi.fn<Fetch>().mockReturnValueOnce(premiere.promise).mockReturnValueOnce(seconde.promise);
    render(<Banc fetcher={fetcher} />);
    await passerAPersonne();
    await userEvent.type(recherche(), "a{Enter}");
    await userEvent.type(recherche(), "b{Enter}");
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/people?q=ab");
    await act(async () => { premiere.resolve(Response.json(personnes.body)); await Promise.resolve(); });
    expect(screen.queryByRole("list", { name: "Personnes trouvées" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Recherche…");
    await act(async () => { seconde.resolve(Response.json({ people: [] })); await Promise.resolve(); });
    expect(await screen.findByText(/Aucune personne connue ne correspond/)).toBeInTheDocument();
  });

  it("une recherche abandonnée qui échoue ensuite ne s'affiche pas", async () => {
    // Le navigateur rejette la requête abandonnée : rien ne doit en remonter.
    const fetcher = vi.fn<Fetch>().mockImplementation((_url, init) => new Promise<Response>((_ok, echec) => {
      init?.signal?.addEventListener("abort", () => { echec(new DOMException("abandon", "AbortError")); });
    }));
    render(<Banc fetcher={fetcher} />);
    await passerAPersonne();
    await userEvent.type(recherche(), "a{Enter}");
    await userEvent.click(screen.getByRole("radio", { name: "Groupe du fournisseur" }));
    await act(async () => { await Promise.resolve(); });
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("revenir au groupe abandonne la recherche en cours", async () => {
    const attente = differee();
    const fetcher = vi.fn<Fetch>().mockReturnValue(attente.promise);
    render(<Banc fetcher={fetcher} />);
    await passerAPersonne();
    await userEvent.type(recherche(), "a{Enter}");
    await userEvent.click(screen.getByRole("radio", { name: "Groupe du fournisseur" }));
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await act(async () => { attente.resolve(Response.json(personnes.body)); await Promise.resolve(); });
    expect(screen.queryByRole("list", { name: "Personnes trouvées" })).not.toBeInTheDocument();
  });

  it("désactivé, la recherche et le choix sont désactivés", () => {
    render(<Banc fetcher={vi.fn<Fetch>()} initial={{ kind: "person", person: null }} disabled />);
    expect(recherche()).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Groupe du fournisseur" })).toBeDisabled();
  });
});
