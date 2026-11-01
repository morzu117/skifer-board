import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";
import { EnvironmentSwitch } from "./EnvironmentSwitch";
import { IdentityPill } from "./IdentityPill";
import type { SectionId } from "./sections";
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

  it("dit quand aucun espace n'est rattaché", () => {
    render(<Sidebar available={new Set()} onNavigate={vi.fn()} workspace={null} />);
    expect(screen.getByText("Aucun espace rattaché")).toBeInTheDocument();
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
    render(<IdentityPill identity={{ subject: "Claire M.", entity: "FR" }} />);
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
    await userEvent.click(screen.getByRole("button", { name: "TEST" }));
    expect(onEnvironmentChange).toHaveBeenCalledWith("TEST");
  });

  it("transmet la section active", () => {
    render(
      <AppShell workspace={null} available={new Set<SectionId>(["dashboards"])} active="dashboards" onNavigate={vi.fn()} breadcrumb={["Dashboards"]} environment="PROD" onEnvironmentChange={vi.fn()} identity={null}>
        <p>contenu</p>
      </AppShell>,
    );
    expect(screen.getByRole("button", { name: "Dashboards" })).toHaveAttribute("aria-current", "page");
  });
});
