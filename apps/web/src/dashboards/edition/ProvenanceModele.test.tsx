import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ProvenanceModele } from "./ProvenanceModele";

const mock = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../page-templates/client", () => ({ fetchPageTemplateRevision: mock.read }));
const props = { space: "finance", identity: "session", id: "reference-modele", revision: 3, fetcher: vi.fn() };
it("montre l'identifiant tant que la révision est lue, puis son nom", async () => {
  mock.read.mockResolvedValue({ status: "ok", value: { pageTemplate: { name: "Exemple" } } });
  render(<ProvenanceModele {...props} />);
  expect(screen.getByText("reference-modele")).toHaveClass("sb-mono");
  expect(await screen.findByText("Issu du modèle Exemple · r3")).toBeInTheDocument();
  expect(mock.read).toHaveBeenCalledWith("finance", "reference-modele", 3, expect.any(AbortSignal), props.fetcher);
});
it.each([{ status: "refused", code: "forbidden" }, { status: "error", message: "panne" }])("conserve la référence si la lecture échoue : $status", async (result) => {
  mock.read.mockResolvedValue(result); render(<ProvenanceModele {...props} />);
  expect(await screen.findByText("reference-modele")).toHaveClass("sb-mono");
  expect(screen.getByText(/Issu du modèle/)).toHaveTextContent("Issu du modèle reference-modele · r3");
});
