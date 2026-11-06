import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { expectAccessible } from "../test/a11y";
import { OngletPreuves } from "./Preuves";
import { analysesServer, changed, ID, ROOT, route } from "./testing";

const LAST = `GET ${ROOT}/${ID}/last-execution`;
const open = (routes: Parameters<typeof analysesServer>[0], shown = 1) => render(<OngletPreuves space="finance" id={ID} shown={shown} fetcher={analysesServer(routes)} />);

it("montre la révision, l'état, l'instant et la provenance de la dernière exécution, avec le lien vers le centre d'exécutions", async () => {
  const { container } = open({ [LAST]: route("derniere-execution") });
  expect(screen.getByRole("status")).toHaveTextContent("Lecture de la dernière exécution…");
  expect(await screen.findByText("Réussie")).toBeInTheDocument();
  expect(screen.getByText("Révision exécutée").nextElementSibling).toHaveTextContent("r1");
  expect(screen.getByText("Instant").nextElementSibling).toHaveTextContent(/2026/);
  expect(screen.getByText("Identifiant d'exécution").nextElementSibling).toHaveTextContent("finance · DEV");
  // Provenance : preuve, empreinte SQL, certification et âge, par la carte du résultat de l'Explorateur.
  expect(screen.getByText("Preuve")).toBeInTheDocument();
  expect(container).toHaveTextContent("sha256:v1:3a8e4884");
  expect(container).toHaveTextContent(/certifi/i);
  expect(container).toHaveTextContent(/inconnu/);
  expect(screen.getByRole("link", { name: "Retrouver l'exécution dans le centre d'exécutions" })).toHaveAttribute("href", "#/espaces/finance/executions");
  expect(screen.queryByText(/lacune/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Cette exécution vient de la révision/)).not.toBeInTheDocument();
  await expectAccessible(container);
});

it("dit quand l'exécution vient d'une autre révision que celle affichée", async () => {
  open({ [LAST]: route("derniere-execution") }, 3);
  expect(await screen.findByText("Cette exécution vient de la révision 1 ; vous lisez la révision 3.")).toBeInTheDocument();
});

it("sans exécution de la personne, le dit sans rien inventer", async () => {
  const { container } = open({ [LAST]: route("derniere-execution-aucune") });
  expect(await screen.findByText("Aucune exécution de votre part depuis cette analyse.")).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  await expectAccessible(container);
});

it("une décision DENY ou REQUIRE_HUMAN s'affiche telle quelle, sans preuve ni résultat", async () => {
  const denied = open({ [LAST]: route("derniere-execution-refusee") });
  expect(await screen.findByRole("alert")).toHaveTextContent("Décision : DENY · Accès refusé. Aucun résultat n'a été produit.");
  expect(screen.getByText("Refusée")).toBeInTheDocument();
  expect(screen.queryByText("Raison")).not.toBeInTheDocument();
  expect(screen.queryByText("Provenance")).not.toBeInTheDocument();
  await expectAccessible(denied.container);
  denied.unmount();
  open({ [LAST]: { status: 200, body: changed(route("derniere-execution-refusee").body, "execution.error_code", "require_human") } });
  expect(await screen.findByRole("alert")).toHaveTextContent("Décision : REQUIRE_HUMAN · Validation humaine requise.");
});

it("un échec dit sa raison, un résultat partiel le dit aussi", async () => {
  const failed = changed(changed(changed(route("derniere-execution-refusee").body, "execution.state", "failed"), "execution.error_code", "connector_unavailable"), "execution.truncated", null);
  const first = open({ [LAST]: { status: 200, body: failed } });
  expect(await screen.findByText("Échouée")).toBeInTheDocument();
  expect(screen.getByText("Raison").nextElementSibling).toHaveTextContent("Connecteur ou source indisponible");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  first.unmount();
  open({ [LAST]: { status: 200, body: changed(changed(route("derniere-execution").body, "execution.truncated", true), "execution.result_contract.completeness", "truncated") } });
  expect(await screen.findByText(/Partiel : limite de la source/)).toBeInTheDocument();
});

it("un refus, le mode local ou une panne sont des erreurs, jamais « aucune exécution »", async () => {
  const refused = open({ [LAST]: route("refus-derniere-execution-introuvable") });
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.queryByText(/Aucune exécution de votre part/)).not.toBeInTheDocument();
  refused.unmount();
  const local = open({ [LAST]: route("refus-mode-local") });
  expect(await screen.findByText("Les analyses ne sont pas disponibles en mode local.")).toBeInTheDocument();
  local.unmount();
  open({});
  expect(await screen.findByRole("alert")).toHaveTextContent("Dernière exécution indisponible");
  expect(screen.queryByText(/Aucune exécution de votre part/)).not.toBeInTheDocument();
});
