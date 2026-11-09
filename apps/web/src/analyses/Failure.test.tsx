import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { analysisRefusalText, Unavailable } from "./Failure";

it("un refus se lit par son libellé de serveur ; analysis_in_use ajoute les consommateurs qui bloquent", () => {
  expect(analysisRefusalText({ code: "analysis_in_use", field: null, consumers: [{ kind: "dashboard", id: "d1" }, { kind: "dashboard", id: "d2" }], others: 0 })).toBe("Cette analyse est encore utilisée : retirez d'abord ce qui en dépend. Consommateurs : dashboard d1, dashboard d2.");
  expect(analysisRefusalText({ code: "analysis_in_use", field: null, consumers: [{ kind: "dashboard", id: "d1" }], others: 2 })).toBe("Cette analyse est encore utilisée : retirez d'abord ce qui en dépend. Consommateurs : dashboard d1. Autres dépendants que vous ne voyez pas : 2.");
  expect(analysisRefusalText({ code: "analysis_in_use", field: null, consumers: [], others: 3 })).toBe("Cette analyse est encore utilisée : retirez d'abord ce qui en dépend. Autres dépendants que vous ne voyez pas : 3.");
  expect(analysisRefusalText({ code: "analysis_in_use", field: null, consumers: [{ kind: "dashboard", id: "d1" }] })).toBe("Cette analyse est encore utilisée : retirez d'abord ce qui en dépend. Consommateurs : dashboard d1.");
  expect(analysisRefusalText({ code: "analysis_in_use", field: null })).toBe("Cette analyse est encore utilisée : retirez d'abord ce qui en dépend.");
  expect(analysisRefusalText({ code: "revision_conflict", field: null })).toBe("Une autre révision a été enregistrée entre-temps : relisez l'analyse.");
});

it("le mode local est neutre, tout autre refus est une alerte et une erreur dit qu'il n'y a rien à afficher", () => {
  const { container, rerender } = render(<Unavailable outcome={{ status: "refused", code: "local_mode", field: null }} title="T" local="Pas en local." />);
  expect(screen.getByRole("status")).toHaveTextContent("Pas en local.");
  rerender(<Unavailable outcome={{ status: "refused", code: "forbidden", field: null }} title="T" local="Pas en local." />);
  expect(screen.getByRole("alert")).toHaveTextContent("Votre rôle ne permet pas cette action.");
  rerender(<Unavailable outcome={{ status: "error", message: "HTTP 500." }} title="Analyses indisponibles" local="Pas en local." />);
  expect(container).toHaveTextContent("Analyses indisponibles : HTTP 500. Rien n'est affiché.");
});
