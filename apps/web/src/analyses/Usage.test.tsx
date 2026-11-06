import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { expectAccessible } from "../test/a11y";
import { OngletUsage } from "./Usage";
import { analysesServer, changed, ID, ROOT, route } from "./testing";

const USAGE = `GET ${ROOT}/${ID}/usage`;
const open = (routes: Parameters<typeof analysesServer>[0]) => render(<OngletUsage space="finance" id={ID} fetcher={analysesServer(routes)} />);

it("montre le total, les 30 derniers jours et le dernier instant de chaque sorte, sans personne", async () => {
  const body = changed(route("usage").body, "usage.executed", { total: 0, last_30_days: 0, last_at: null });
  const { container } = open({ [USAGE]: { status: 200, body } });
  expect(screen.getByRole("status")).toHaveTextContent("Lecture de l'usage…");
  const table = await screen.findByRole("table", { name: "Usage de l'analyse" });
  expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Sorte", "Total", "30 derniers jours", "Dernier événement"]);
  const rows = within(table).getAllByRole("row").slice(1).map((row) => [...row.querySelectorAll("th, td")].map((cell) => cell.textContent));
  expect(rows[0]).toEqual(["Sauvegardes", "1", "1", expect.stringMatching(/2026/)]);
  expect(rows[1]).toEqual(["Ouvertures", "1", "1", expect.stringMatching(/2026/)]);
  expect(rows[2]).toEqual(["Exécutions", "0", "0", "Aucun"]);
  expect(screen.getByText(/ni qui, ni avec quelles valeurs/)).toBeInTheDocument();
  expect(container).not.toHaveTextContent("cora");
  await expectAccessible(container);
});

it("un refus, le mode local ou une panne ne montrent aucun compte", async () => {
  const refused = open({ [USAGE]: route("refus-usage-introuvable") });
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  refused.unmount();
  const local = open({ [USAGE]: route("refus-mode-local") });
  expect(await screen.findByText("Les analyses ne sont pas disponibles en mode local.")).toBeInTheDocument();
  local.unmount();
  open({});
  expect(await screen.findByRole("alert")).toHaveTextContent("Usage indisponible");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
