import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "./Badge";
import { Banner } from "./Banner";
import { Card } from "./Card";
import { BrandMark, LockIcon } from "./icons";

describe("Badge", () => {
  it("porte le mot de l'état et sa variante", () => {
    render(<Badge tone="warning">tronqué</Badge>);
    expect(screen.getByText("tronqué")).toHaveClass("sb-badge--warning");
  });
});

describe("Banner", () => {
  it("annonce une attention comme un statut, avec son action", () => {
    render(
      <Banner tone="warning" action={<button type="button">Demander au moteur</button>}>
        Résultat tronqué
      </Banner>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Résultat tronqué");
    expect(screen.getByRole("button", { name: "Demander au moteur" })).toBeInTheDocument();
  });

  it("annonce un refus comme une alerte", () => {
    render(<Banner tone="danger">Accès refusé</Banner>);
    expect(screen.getByRole("alert")).toHaveTextContent("Accès refusé");
  });

  it("affiche une information neutre", () => {
    render(<Banner tone="neutral">Données de démonstration</Banner>);
    expect(screen.getByRole("status")).toHaveClass("sb-banner--neutral");
  });
});

describe("Card", () => {
  it("nomme sa région par son titre", () => {
    render(
      <Card title="CA net par région" actions={<button type="button">Exporter</button>}>
        contenu
      </Card>,
    );
    expect(screen.getByRole("region", { name: "CA net par région" })).toHaveClass("sb-card");
    expect(screen.getByRole("heading", { level: 2, name: "CA net par région" })).toBeInTheDocument();
  });

  it("ajoute une classe", () => {
    render(
      <Card title="Détail" className="wide">
        contenu
      </Card>,
    );
    expect(screen.getByRole("region", { name: "Détail" })).toHaveClass("sb-card", "wide");
  });
});

describe("icônes", () => {
  it("sont décoratives", () => {
    const { container } = render(
      <>
        <LockIcon size={20} />
        <BrandMark />
      </>,
    );
    for (const svg of container.querySelectorAll("svg")) {
      expect(svg).toHaveAttribute("aria-hidden", "true");
    }
  });
});
