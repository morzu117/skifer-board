import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import espace from "../../../../contracts/espaces/espace.json";
import liste from "../../../../contracts/espaces/liste.json";
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
