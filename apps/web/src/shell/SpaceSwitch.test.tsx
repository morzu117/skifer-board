import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import espace from "../../../../contracts/espaces/espace.json";
import liste from "../../../../contracts/espaces/liste.json";
import administration from "../../../../contracts/espaces/liste-administration.json";
import locale from "../../../../contracts/espaces/liste-locale.json";
import { decodeSpace, decodeSpaceList, type Space } from "../spaces/model";
import { SpaceSwitch } from "./SpaceSwitch";

const { spaces } = decodeSpaceList(liste.body);
const [finance, rh] = spaces as [Space, Space];
/** Espace courant tel que le serveur le confirme : son rôle peut différer de celui de la liste. */
const confirme = decodeSpace(espace.body, "espace");
const choix = () => screen.getByRole("combobox", { name: "Espace" });
const options = () => within(choix()).getAllByRole("option");

describe("Sélecteur d'espace (plan 08, 8.3)", () => {
  it("dit que les espaces ne sont pas lus, sans pastille de rôle", () => {
    render(<SpaceSwitch spaces={null} current={null} onChange={vi.fn()} />);
    expect(choix()).toHaveValue("");
    expect(options().map((option) => option.textContent)).toEqual(["Espaces indisponibles"]);
    expect(options()[0]).toBeDisabled();
    expect(screen.queryByText(/Rôle/)).not.toBeInTheDocument();
  });

  it("pendant la lecture des espaces, le dit sans pastille ni choix possible", () => {
    render(<SpaceSwitch spaces="loading" current={null} onChange={vi.fn()} />);
    expect(choix()).toHaveValue("");
    expect(options().map((option) => option.textContent)).toEqual(["Lecture des espaces…"]);
    expect(options()[0]).toBeDisabled();
    expect(screen.queryByText(/Rôle/)).not.toBeInTheDocument();
  });

  it("pendant la relecture de la liste, l'espace courant reste choisi avec son rôle confirmé", () => {
    render(<SpaceSwitch spaces="loading" current={confirme} onChange={vi.fn()} />);
    expect(choix()).toHaveValue("finance");
    expect(options().map((option) => option.textContent)).toEqual(["Lecture des espaces…", "Finance"]);
    expect(screen.getByText("Rôle : Administrateur", { exact: true })).toBeInTheDocument();
  });

  it("dit qu'il n'y a aucun espace", () => {
    render(<SpaceSwitch spaces={[]} current={null} onChange={vi.fn()} />);
    expect(options().map((option) => option.textContent)).toEqual(["Aucun espace"]);
    expect(screen.queryByText(/Rôle/)).not.toBeInTheDocument();
  });

  it("hors d'un espace, propose les espaces sans en choisir un ni afficher de rôle", () => {
    render(<SpaceSwitch spaces={spaces} current={null} onChange={vi.fn()} />);
    expect(choix()).toHaveValue("");
    expect(options().map((option) => [option.textContent, option.getAttribute("value")])).toEqual([["Choisir un espace", ""], ["Finance", "finance"], ["Ressources humaines", "rh"]]);
    expect(screen.queryByText(/Rôle/)).not.toBeInTheDocument();
  });

  it("la pastille dit le rôle confirmé par le serveur pour l'espace courant, pas celui de la liste", () => {
    // La liste dit « creator » pour finance ; le serveur confirme « admin » pour l'espace courant.
    expect(finance.role).toBe("creator");
    render(<SpaceSwitch spaces={spaces} current={confirme} onChange={vi.fn()} />);
    expect(choix()).toHaveValue("finance");
    expect(screen.getByText("Rôle : Administrateur", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(/Créateur/)).not.toBeInTheDocument();
  });

  it("la pastille suit le rôle confirmé même s'il est plus faible que celui de la liste", () => {
    render(<SpaceSwitch spaces={spaces} current={{ ...finance, role: "reader" }} onChange={vi.fn()} />);
    expect(screen.getByText("Rôle : Lecteur", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(/Créateur/)).not.toBeInTheDocument();
  });

  it("la pastille dit l'administration de la plateforme quand le rôle est nul", () => {
    render(<SpaceSwitch spaces={spaces} current={{ ...finance, role: null }} onChange={vi.fn()} />);
    expect(screen.getByText("Rôle : Administration de la plateforme", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(/Créateur|Lecteur/)).not.toBeInTheDocument();
  });

  it("un espace courant absent de la liste est proposé en tête, une seule fois", () => {
    const autre: Space = { ...rh, id: "achats", name: "Achats", role: "reader" };
    render(<SpaceSwitch spaces={spaces} current={autre} onChange={vi.fn()} />);
    expect(options().map((option) => option.getAttribute("value"))).toEqual(["", "achats", "finance", "rh"]);
    expect(choix()).toHaveValue("achats");
    expect(screen.getByText("Rôle : Lecteur", { exact: true })).toBeInTheDocument();
  });

  it("un espace courant présent n'est pas dupliqué, et garde le nom de la liste", () => {
    render(<SpaceSwitch spaces={spaces} current={confirme} onChange={vi.fn()} />);
    expect(options().map((option) => option.getAttribute("value"))).toEqual(["", "finance", "rh"]);
  });

  it("l'espace courant reste choisi quand la liste est illisible", () => {
    render(<SpaceSwitch spaces={null} current={confirme} onChange={vi.fn()} />);
    expect(options().map((option) => option.getAttribute("value"))).toEqual(["", "finance"]);
    expect(choix()).toHaveValue("finance");
    expect(screen.getByText("Rôle : Administrateur", { exact: true })).toBeInTheDocument();
  });

  it("changer d'espace transmet l'identifiant choisi", async () => {
    const onChange = vi.fn();
    render(<SpaceSwitch spaces={spaces} current={confirme} onChange={onChange} />);
    await userEvent.selectOptions(choix(), "Ressources humaines");
    expect(onChange).toHaveBeenCalledExactlyOnceWith("rh");
  });

  it("se choisit au clavier", async () => {
    const onChange = vi.fn();
    render(<SpaceSwitch spaces={spaces} current={null} onChange={onChange} />);
    await userEvent.tab();
    expect(choix()).toHaveFocus();
    await userEvent.selectOptions(choix(), "finance");
    expect(onChange).toHaveBeenCalledExactlyOnceWith("finance");
  });

  it("deux sélecteurs ont chacun leur étiquette", () => {
    render(<><SpaceSwitch spaces={spaces} current={null} onChange={vi.fn()} /><SpaceSwitch spaces={spaces} current={null} onChange={vi.fn()} /></>);
    const [premier, second] = screen.getAllByRole("combobox", { name: "Espace" });
    expect(premier?.id).not.toBe(second?.id);
  });
});

describe("Sélecteur d'espace : droit de déployer (plan 09, 9.3)", () => {
  const ligne = () => screen.queryByText(/^Déploiement :/);

  it.each([
    ["non lus", null],
    ["en lecture", "loading"],
    ["aucun espace", []],
    ["hors d'un espace", spaces],
  ] as [string, readonly Space[] | "loading" | null][])("sans espace courant (%s), aucune ligne « Déploiement »", (_cas, listed) => {
    render(<SpaceSwitch spaces={listed} current={null} onChange={vi.fn()} />);
    expect(ligne()).not.toBeInTheDocument();
    expect(screen.queryByText(/Déploiement/)).not.toBeInTheDocument();
  });

  it("dit les droits de l'espace courant, sous la pastille du rôle", () => {
    render(<SpaceSwitch spaces={spaces} current={finance} onChange={vi.fn()} />);
    const texte = ligne();
    expect(texte).toHaveTextContent(/^Déploiement : DEV$/);
    const pastille = screen.getByText("Rôle : Créateur", { exact: true });
    expect(pastille.compareDocumentPosition(texte as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Une ligne de texte, pas une pastille ni un contrôle.
    expect(texte?.tagName).toBe("SPAN");
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });

  it("suit l'espace courant confirmé par le serveur, pas l'entrée de la liste", () => {
    // La liste dit DEV pour finance ; le serveur confirme l'espace sans aucun accord.
    expect(finance.environments.find((found) => found.code === "DEV")?.deploy).toBe(true);
    render(<SpaceSwitch spaces={spaces} current={confirme} onChange={vi.fn()} />);
    expect(ligne()).toHaveTextContent(/^Déploiement : aucun$/);
  });

  it("dit « aucun » pour un lecteur et pour l'administration de la plateforme sans rôle", () => {
    const { rerender } = render(<SpaceSwitch spaces={spaces} current={rh} onChange={vi.fn()} />);
    expect(ligne()).toHaveTextContent(/^Déploiement : aucun$/);
    const plateforme = decodeSpaceList(administration.body).spaces[0] as Space;
    rerender(<SpaceSwitch spaces={[plateforme]} current={plateforme} onChange={vi.fn()} />);
    expect(screen.getByText("Rôle : Administration de la plateforme", { exact: true })).toBeInTheDocument();
    expect(ligne()).toHaveTextContent(/^Déploiement : aucun$/);
  });

  it("en mode local, les trois environnements", () => {
    const local = decodeSpaceList(locale.body).spaces[0] as Space;
    render(<SpaceSwitch spaces={[local]} current={local} onChange={vi.fn()} />);
    expect(ligne()).toHaveTextContent(/^Déploiement : DEV, TEST, PROD$/);
  });

  it("garde la ligne de l'espace courant pendant la relecture ou quand la liste est illisible", () => {
    const { rerender } = render(<SpaceSwitch spaces="loading" current={finance} onChange={vi.fn()} />);
    expect(ligne()).toHaveTextContent(/^Déploiement : DEV$/);
    rerender(<SpaceSwitch spaces={null} current={finance} onChange={vi.fn()} />);
    expect(ligne()).toHaveTextContent(/^Déploiement : DEV$/);
  });

  it("les codes sont en mono (RULES §5), « aucun » ne l'est pas ; le texte complet reste le même", () => {
    const local = decodeSpaceList(locale.body).spaces[0] as Space;
    const { rerender } = render(<SpaceSwitch spaces={[local]} current={local} onChange={vi.fn()} />);
    const codes = ligne()?.querySelectorAll(".sb-mono");
    expect(codes).toHaveLength(1);
    expect(codes?.[0]).toHaveTextContent(/^DEV, TEST, PROD$/);
    expect(ligne()?.textContent).toBe("Déploiement : DEV, TEST, PROD");
    rerender(<SpaceSwitch spaces={spaces} current={rh} onChange={vi.fn()} />);
    expect(ligne()?.textContent).toBe("Déploiement : aucun");
    expect(ligne()?.querySelector(".sb-mono")).toBeNull();
    expect(screen.queryByText("aucun", { selector: ".sb-mono" })).not.toBeInTheDocument();
  });

  it("la ligne dit les codes dans l'ordre DEV, TEST, PROD, même pour un espace courant construit dans le désordre", () => {
    const desordre: Space = { ...finance, environments: [{ code: "PROD", deploy: true }, { code: "TEST", deploy: false }, { code: "DEV", deploy: true }] };
    render(<SpaceSwitch spaces={spaces} current={desordre} onChange={vi.fn()} />);
    expect(ligne()).toHaveTextContent(/^Déploiement : DEV, PROD$/);
    expect(screen.getByText("DEV, PROD", { selector: ".sb-mono" })).toBeInTheDocument();
  });

  it("la ligne disparaît avec l'espace courant, et change avec lui", () => {
    const { rerender } = render(<SpaceSwitch spaces={spaces} current={finance} onChange={vi.fn()} />);
    expect(ligne()).toHaveTextContent("Déploiement : DEV");
    rerender(<SpaceSwitch spaces={spaces} current={{ ...finance, environments: [{ code: "DEV", deploy: false }, { code: "TEST", deploy: true }, { code: "PROD", deploy: true }] }} onChange={vi.fn()} />);
    expect(ligne()).toHaveTextContent(/^Déploiement : TEST, PROD$/);
    rerender(<SpaceSwitch spaces={spaces} current={null} onChange={vi.fn()} />);
    expect(ligne()).not.toBeInTheDocument();
  });
});
