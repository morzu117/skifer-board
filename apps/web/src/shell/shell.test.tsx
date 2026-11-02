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
