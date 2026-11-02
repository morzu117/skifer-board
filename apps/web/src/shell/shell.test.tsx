import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";
import { EnvironmentSwitch } from "./EnvironmentSwitch";
import { IdentityPill } from "./IdentityPill";
import type { SectionId } from "./sections";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("rend les six entrées et ne lie que les entrées livrées", async () => {
    const onNavigate = vi.fn();
    render(<Sidebar available={new Set<SectionId>(["explorer", "analyses"])} active="explorer" onNavigate={onNavigate} workspace="Finance Groupe" />);
    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    expect(within(nav).getAllByRole("listitem")).toHaveLength(6);
    expect(within(nav).getAllByRole("button")).toHaveLength(2);
    expect(within(nav).getByRole("button", { name: "Explorer" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("button", { name: "Analyses" })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByText("Déploiements")).toHaveTextContent("à venir");
    await userEvent.click(within(nav).getByRole("button", { name: "Analyses" }));
    expect(onNavigate).toHaveBeenCalledWith("analyses");
    expect(nav).toHaveTextContent("Finance Groupe");
  });

  it("affiche la mention propre d'une entrée indisponible, « à venir » sinon", () => {
    render(<Sidebar available={new Set()} onNavigate={vi.fn()} workspace={null} pending={{ catalogue: "dans un espace" }} />);
    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    expect(within(nav).getByText("Catalogue Atlas")).toHaveTextContent("Catalogue Atlasdans un espace");
    expect(within(nav).queryByRole("button")).not.toBeInTheDocument();
    for (const name of ["Explorer", "Analyses", "Dashboards", "Déploiements", "Espace & connexions"]) {
      expect(within(nav).getByText(name)).toHaveTextContent(`${name}à venir`);
    }
  });

  it("une entrée livrée ignore sa mention d'indisponibilité", () => {
    render(<Sidebar available={new Set<SectionId>(["catalogue"])} onNavigate={vi.fn()} workspace={null} pending={{ catalogue: "dans un espace" }} />);
    expect(screen.getByRole("button", { name: "Catalogue Atlas" })).toHaveTextContent(/^Catalogue Atlas$/);
  });

  it("dit quand aucun espace n'est choisi", () => {
    render(<Sidebar available={new Set()} onNavigate={vi.fn()} workspace={null} />);
    expect(screen.getByText("Aucun espace choisi")).toBeInTheDocument();
  });
});

describe("EnvironmentSwitch", () => {
  it("garde l'ordre DEV TEST PROD et signale le segment actif", async () => {
    const onChange = vi.fn();
    render(<EnvironmentSwitch value="TEST" onChange={onChange} />);
    const group = screen.getByRole("group", { name: "Environnement" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["DEV", "TEST", "PROD"]);
    expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
    await userEvent.click(within(group).getByRole("button", { name: "PROD" }));
    expect(onChange).toHaveBeenCalledWith("PROD");
  });
});

describe("IdentityPill", () => {
  it("affiche les droits évalués", () => {
    render(<IdentityPill identity={{ name: "Claire M.", entity: "FR" }} />);
    expect(screen.getByText(/Données évaluées pour Claire M\. · Entité FR/)).not.toHaveClass("sb-identity--unknown");
  });

  it("dit qu'aucune identité n'est établie", () => {
    render(<IdentityPill identity={null} />);
    expect(screen.getByText("Identité non établie · données de démonstration")).toHaveClass("sb-identity--unknown");
  });
});

describe("AppShell", () => {
  it("compose navigation, fil d'Ariane, environnement, identité et contenu", async () => {
    const onEnvironmentChange = vi.fn();
    render(
      <AppShell
        workspace="Finance Groupe"
        available={new Set()}
        onNavigate={vi.fn()}
        breadcrumb={["Finance Groupe", "Prototype"]}
        spaceSwitch={<p>sélecteur d'espace</p>}
        environment="DEV"
        onEnvironmentChange={onEnvironmentChange}
        identity={null}
      >
        <p>contenu</p>
      </AppShell>,
    );
    const crumbs = within(screen.getByRole("navigation", { name: "Fil d'Ariane" })).getAllByRole("listitem");
    expect(crumbs.map((crumb) => crumb.getAttribute("aria-current"))).toEqual([null, "page"]);
    expect(screen.getByRole("main")).toHaveTextContent("contenu");
    // Le sélecteur d'espace est en tête de la navigation latérale, sous la marque (plan 08, 8.3).
    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    expect(nav).toHaveTextContent("sélecteur d'espace");
    expect(screen.getByRole("banner")).not.toHaveTextContent("sélecteur d'espace");
    expect(screen.getByRole("main")).not.toHaveTextContent("sélecteur d'espace");
    const marque = within(nav).getByRole("link", { name: "Skifer Board" });
    const selecteur = within(nav).getByText("sélecteur d'espace");
    const liste = within(nav).getAllByRole("list")[0] as HTMLElement;
    expect(marque.compareDocumentPosition(selecteur) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(selecteur.compareDocumentPosition(liste) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "TEST" }));
    expect(onEnvironmentChange).toHaveBeenCalledWith("TEST");
  });

  it("transmet la mention des entrées indisponibles à la navigation", () => {
    render(
      <AppShell workspace={null} available={new Set()} onNavigate={vi.fn()} breadcrumb={["Vos espaces"]} spaceSwitch={null} pending={{ catalogue: "dans un espace" }} environment="DEV" onEnvironmentChange={vi.fn()} identity={null}>
        <p>contenu</p>
      </AppShell>,
    );
    expect(screen.getByText("Catalogue Atlas")).toHaveTextContent("dans un espace");
  });

  it("transmet la section active", () => {
    render(
      <AppShell workspace={null} available={new Set<SectionId>(["dashboards"])} active="dashboards" onNavigate={vi.fn()} breadcrumb={["Dashboards"]} spaceSwitch={null} environment="PROD" onEnvironmentChange={vi.fn()} identity={null}>
        <p>contenu</p>
      </AppShell>,
    );
    expect(screen.getByRole("button", { name: "Dashboards" })).toHaveAttribute("aria-current", "page");
  });
});

it("n'invente aucune entité pour l'identité établie", () => {
  render(<IdentityPill identity={{ name: "Camille Martin", entity: null }} />);
  expect(screen.getByText("Données évaluées pour Camille Martin", { exact: true })).toBeInTheDocument();
  expect(screen.queryByText(/Entité/)).not.toBeInTheDocument();
});
it.each([false, true])("TopBar propose la déconnexion seulement avec une action : %s", async (avecAction) => {
  const onLogout = vi.fn();
  render(<TopBar breadcrumb={["Accueil"]} environment="DEV" onEnvironmentChange={vi.fn()} identity={{ name: "Camille", entity: null }} onLogout={avecAction ? onLogout : undefined} />);
  if (avecAction) {
    await userEvent.click(screen.getByRole("button", { name: "Se déconnecter" }));
    expect(onLogout).toHaveBeenCalledOnce();
  } else expect(screen.queryByRole("button", { name: "Se déconnecter" })).not.toBeInTheDocument();
});
it("la coque transmet l'identité et l'action de déconnexion", async () => {
  const onLogout = vi.fn();
  render(<AppShell workspace={null} available={new Set()} onNavigate={vi.fn()} breadcrumb={["Accueil"]} spaceSwitch={null} environment="DEV" onEnvironmentChange={vi.fn()} identity={{ name: "Camille", entity: null }} onLogout={onLogout}><h1>Accueil</h1></AppShell>);
  expect(screen.getByText("Données évaluées pour Camille", { exact: true })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Se déconnecter" }));
  expect(onLogout).toHaveBeenCalledOnce();
});

describe("EnvironmentSwitch : marque du droit de déployer (plan 09, 9.3)", () => {
  type Env = "DEV" | "TEST" | "PROD";
  const CODES = ["DEV", "TEST", "PROD"] as const;
  const groupe = () => screen.getByRole("group", { name: "Environnement" });
  const segments = () => within(groupe()).getAllByRole("button");
  /** Contenu de la place réservée à la marque, par segment : « ● » ou vide. */
  const marques = () => segments().map((segment) => segment.querySelector(".sb-env__deploy")?.textContent);
  /** Le droit est la description du segment ; son nom reste son libellé (« DEV »). */
  function verifier(droits: readonly Env[]) {
    segments().forEach((segment, rang) => {
      const code = CODES[rang] as Env;
      expect(segment).toHaveAccessibleName(code);
      if (droits.includes(code)) {
        expect(segment).toHaveAccessibleDescription("Déploiement autorisé");
      } else {
        expect(segment).not.toHaveAttribute("aria-describedby");
        expect(segment).toHaveAccessibleDescription("");
      }
    });
    expect(marques()).toEqual(CODES.map((code) => (droits.includes(code) ? "●" : "")));
  }

  it.each([
    ["sans la prop", undefined],
    ["hors d'un espace (null)", null],
    ["dans un espace sans aucun droit", new Set<Env>()],
  ])("%s : aucune marque ni description, noms d'origine", (_cas, deploy) => {
    render(<EnvironmentSwitch value="DEV" onChange={vi.fn()} deploy={deploy} />);
    verifier([]);
    expect(segments().map((segment) => segment.textContent)).toEqual(["DEV", "TEST", "PROD"]);
    // La place de la marque est réservée partout (DESIGN-SYSTEM §1.5), vide et décorative.
    for (const segment of segments()) {
      expect(segment.querySelectorAll(".sb-env__deploy")).toHaveLength(1);
      expect(segment.querySelector(".sb-env__deploy")).toHaveAttribute("aria-hidden", "true");
    }
  });

  it.each([
    [["DEV"]],
    [["TEST"]],
    [["PROD"]],
    [["PROD", "DEV"]],
    [["PROD", "TEST", "DEV"]],
  ] as [Env[]][])("droit en %j : marque et description sur ces segments seulement, nom exact, ordre invariable", (droits) => {
    render(<EnvironmentSwitch value="DEV" onChange={vi.fn()} deploy={new Set(droits)} />);
    verifier(droits);
    for (const segment of segments()) {
      // Une seule place de marque, décorative ; aucun texte masqué en plus du libellé.
      expect(segment.querySelectorAll(".sb-env__deploy")).toHaveLength(1);
      expect(segment.querySelector(".sb-env__deploy")).toHaveAttribute("aria-hidden", "true");
      expect(segment).not.toHaveTextContent(/déploiement/i);
    }
  });

  it("la description est un seul élément masqué du groupe, partagé par les segments autorisés", () => {
    render(<EnvironmentSwitch value="DEV" onChange={vi.fn()} deploy={new Set<Env>(["DEV", "PROD"])} />);
    const [dev, test, prod] = segments() as [HTMLElement, HTMLElement, HTMLElement];
    const id = dev.getAttribute("aria-describedby");
    expect(id).not.toBeNull();
    expect(prod).toHaveAttribute("aria-describedby", id);
    expect(test).not.toHaveAttribute("aria-describedby");
    const description = document.getElementById(id ?? "");
    expect(description).toHaveTextContent(/^Déploiement autorisé$/);
    expect(description).not.toBeVisible();
    expect(groupe().contains(description)).toBe(true);
    expect(groupe().querySelectorAll("[hidden]")).toHaveLength(1);
    // Rien de lisible à l'écran en dehors des libellés et de la marque : le seul texte est masqué.
    expect(screen.getByText("Déploiement autorisé")).toBe(description);
  });

  it("deux bascules ont chacune leur description", () => {
    render(<><EnvironmentSwitch value="DEV" onChange={vi.fn()} deploy={new Set<Env>(["DEV"])} /><EnvironmentSwitch value="DEV" onChange={vi.fn()} deploy={new Set<Env>(["DEV"])} /></>);
    const [premier, second] = screen.getAllByRole("button", { name: "DEV" });
    expect(premier?.getAttribute("aria-describedby")).not.toBe(second?.getAttribute("aria-describedby"));
    expect(second).toHaveAccessibleDescription("Déploiement autorisé");
  });

  it.each(["DEV", "TEST", "PROD"] as Env[])("la marque ne change pas l'environnement choisi (%s) : aria-pressed suit seulement value", (value) => {
    const onChange = vi.fn();
    const { rerender } = render(<EnvironmentSwitch value={value} onChange={onChange} />);
    const avant = segments().map((segment) => segment.getAttribute("aria-pressed"));
    for (const droits of [new Set<Env>(["DEV"]), new Set<Env>(["PROD"]), new Set<Env>(["DEV", "TEST", "PROD"]), new Set<Env>(), null]) {
      rerender(<EnvironmentSwitch value={value} onChange={onChange} deploy={droits} />);
      expect(segments().map((segment) => segment.getAttribute("aria-pressed"))).toEqual(avant);
    }
    expect(avant).toEqual(CODES.map((code) => String(code === value)));
    // Changer les droits n'émet aucun changement d'environnement.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("un segment marqué ou non se choisit pareil, à la souris, sur la marque elle-même, et au clavier", async () => {
    const onChange = vi.fn();
    render(<EnvironmentSwitch value="TEST" onChange={onChange} deploy={new Set<Env>(["DEV"])} />);
    await userEvent.click(screen.getByRole("button", { name: "DEV" }));
    expect(onChange).toHaveBeenLastCalledWith("DEV");
    await userEvent.click(screen.getByRole("button", { name: "PROD" }));
    expect(onChange).toHaveBeenLastCalledWith("PROD");
    await userEvent.click(screen.getByRole("button", { name: "DEV" }).querySelector(".sb-env__deploy") as HTMLElement);
    expect(onChange).toHaveBeenLastCalledWith("DEV");
    (document.activeElement as HTMLElement).blur();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "DEV" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("DEV");
    expect(onChange).toHaveBeenCalledTimes(4);
  });
});

describe("Transmission du droit de déployer par la coque (plan 09, 9.3)", () => {
  const marques = () => within(screen.getByRole("group", { name: "Environnement" })).getAllByRole("button").map((segment) => segment.querySelector(".sb-env__deploy")?.textContent);

  it("TopBar transmet `deploy` à la bascule, et ne marque rien sans", () => {
    const { rerender } = render(<TopBar breadcrumb={["Finance"]} environment="TEST" onEnvironmentChange={vi.fn()} deploy={new Set(["TEST"] as const)} identity={null} />);
    expect(screen.getByRole("button", { name: "TEST" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "TEST" })).toHaveAccessibleDescription("Déploiement autorisé");
    expect(marques()).toEqual(["", "●", ""]);
    rerender(<TopBar breadcrumb={["Finance"]} environment="TEST" onEnvironmentChange={vi.fn()} identity={null} />);
    expect(screen.getByRole("button", { name: "TEST" })).toHaveAccessibleDescription("");
    expect(marques()).toEqual(["", "", ""]);
  });

  it("AppShell transmet `deploy` à la barre supérieure ; null ne marque rien", async () => {
    const onEnvironmentChange = vi.fn();
    const coque = (deploy: ReadonlySet<"DEV" | "TEST" | "PROD"> | null) => (
      <AppShell workspace="Finance" available={new Set()} onNavigate={vi.fn()} breadcrumb={["Finance"]} spaceSwitch={null} environment="DEV" onEnvironmentChange={onEnvironmentChange} deploy={deploy} identity={null}>
        <p>contenu</p>
      </AppShell>
    );
    const { rerender } = render(coque(new Set(["DEV", "PROD"] as const)));
    const bascule = within(screen.getByRole("banner")).getByRole("group", { name: "Environnement" });
    expect(within(bascule).getAllByRole("button").map((segment) => segment.textContent)).toEqual(["DEV●", "TEST", "PROD●"]);
    await userEvent.click(within(bascule).getByRole("button", { name: "PROD" }));
    expect(onEnvironmentChange).toHaveBeenCalledExactlyOnceWith("PROD");
    rerender(coque(null));
    expect(within(bascule).getAllByRole("button").map((segment) => segment.textContent)).toEqual(["DEV", "TEST", "PROD"]);
    expect(marques()).toEqual(["", "", ""]);
  });
});
