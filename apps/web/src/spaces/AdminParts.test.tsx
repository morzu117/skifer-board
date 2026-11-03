import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import espace from "../../../../contracts/espaces/espace.json";
import { AdminTabs, refusalText, samePrincipal } from "./AdminParts";
import { decodeSpace } from "./model";

// Pièces communes aux écrans d'administration d'un espace (plan 09, 9.4) : ce qui n'est pas déjà
// exercé au travers de « Membres et rôles » et « Environnements ».

const FINANCE = decodeSpace(espace.body, "espace");
const onglets = () => screen.getByRole("navigation", { name: "Administration de l'espace" });
const liens = () => within(onglets()).getAllByRole("link").map((lien) => [lien.textContent, lien.getAttribute("href"), lien.getAttribute("aria-current")]);

describe("Onglets d'administration (écrans §9)", () => {
  it.each([
    ["members", [["Membres et rôles", "#/espaces/finance/membres", "page"], ["Environnements", "#/espaces/finance/environnements", null], ["Paramètres", "#/espaces/finance/parametres", null], ["Connexions", "#/espaces/finance/connexions", null]]],
    ["environments", [["Membres et rôles", "#/espaces/finance/membres", null], ["Environnements", "#/espaces/finance/environnements", "page"], ["Paramètres", "#/espaces/finance/parametres", null], ["Connexions", "#/espaces/finance/connexions", null]]],
    ["parameters", [["Membres et rôles", "#/espaces/finance/membres", null], ["Environnements", "#/espaces/finance/environnements", null], ["Paramètres", "#/espaces/finance/parametres", "page"], ["Connexions", "#/espaces/finance/connexions", null]]],
    ["connections", [["Membres et rôles", "#/espaces/finance/membres", null], ["Environnements", "#/espaces/finance/environnements", null], ["Paramètres", "#/espaces/finance/parametres", null], ["Connexions", "#/espaces/finance/connexions", "page"]]],
  ] as const)("l'onglet courant (%s) porte aria-current=\"page\", et lui seul", (courant, attendus) => {
    render(<AdminTabs space={FINANCE} current={courant} />);
    expect(liens()).toEqual(attendus);
    expect(onglets().querySelectorAll("[aria-current]")).toHaveLength(1);
  });

  it("encode l'identifiant de l'espace dans les quatre liens", () => {
    render(<AdminTabs space={{ ...FINANCE, id: "a/b c#d" }} current="members" />);
    expect(liens().map(([, href]) => href)).toEqual(["#/espaces/a%2Fb%20c%23d/membres", "#/espaces/a%2Fb%20c%23d/environnements", "#/espaces/a%2Fb%20c%23d/parametres", "#/espaces/a%2Fb%20c%23d/connexions"]);
  });

  it("sont des liens, pas des onglets ARIA : ils changent de page", () => {
    render(<AdminTabs space={FINANCE} current="environments" />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });
});

describe("Même principal (E3)", () => {
  const groupe = (name: string) => ({ kind: "group", name }) as const;
  const personne = (issuer: string, subject: string) => ({ kind: "person", issuer, subject }) as const;

  it.each([
    [groupe("finance"), groupe("finance"), true],
    [groupe("finance"), groupe("Finance"), false],
    [groupe("finance"), groupe("finance "), false],
    [personne("i", "s"), personne("i", "s"), true],
    [personne("i", "s"), personne("j", "s"), false],
    [personne("i", "s"), personne("i", "t"), false],
    [groupe("s"), personne("i", "s"), false],
    [personne("i", "s"), groupe("s"), false],
  ] as const)("%j et %j : %s", (gauche, droite, attendu) => {
    expect(samePrincipal(gauche, droite)).toBe(attendu);
  });
});

describe("Libellé d'un refus des droits de déployer (V9)", () => {
  it("nomme l'environnement en cause et l'accord disparu", () => {
    expect(refusalText({ code: "invalid_request", field: "environment" })).toBe("La demande est incomplète ou mal formée. Champ en cause : environnement.");
    expect(refusalText({ code: "grant_not_found", field: null })).toBe("Ce droit de déployer n'existe plus : la liste a été relue.");
    expect(refusalText({ code: "local_mode", field: null })).toBe("En mode local, l'espace implicite ne se gère pas.");
  });
});
