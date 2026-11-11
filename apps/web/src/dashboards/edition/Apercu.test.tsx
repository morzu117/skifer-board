import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { SKIFER_CLAIR } from "../../charts/theme";
import type { Editor } from "./EditorContext";
import { N, sampleDraft } from "./testing";

const mock = vi.hoisted(() => ({ editor: {} as Editor }));
vi.mock("./EditorContext", () => ({ useEditor: () => mock.editor }));
vi.mock("./Tuile", () => ({ Tuile: ({ onCancel, onRetry, onRestart }: { onCancel: () => void; onRetry: () => void; onRestart: () => void }) => <div role="group" aria-label="Actions de tuile"><button onClick={onCancel}>Annuler</button><button onClick={onRetry}>Réessayer</button><button onClick={onRestart}>Relancer</button></div> }));
import { Apercu } from "./Apercu";

it("transmet les actions des tuiles et gère une largeur indisponible avant mesure", async () => {
  const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(0);
  const cancelTile = vi.fn(); const retryTile = vi.fn(); const restartTile = vi.fn();
  mock.editor = { document: sampleDraft(), states: new Map(), analyses: {}, catalog: null, theme: SKIFER_CLAIR, cancelTile, retryTile, restartTile } as unknown as Editor;
  const view = render(<Apercu onClose={vi.fn()} />);
  const first = within(screen.getAllByRole("group", { name: "Actions de tuile" })[0] as HTMLElement);
  await userEvent.click(first.getByRole("button", { name: "Annuler" }));
  await userEvent.click(first.getByRole("button", { name: "Réessayer" }));
  await userEvent.click(first.getByRole("button", { name: "Relancer" }));
  expect(cancelTile).toHaveBeenCalledWith(N.visual);
  expect(retryTile).toHaveBeenCalledWith(N.visual);
  expect(restartTile).toHaveBeenCalledWith(N.visual);
  expect(view.container.querySelector(".sb-preview__viewport")).toHaveStyle({ zoom: "1" });
  view.unmount();
  width.mockRestore();
});

it("respecte la largeur proportionnelle et réduit le zoom à la largeur disponible", () => {
  const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
  mock.editor = { document: sampleDraft(), states: new Map(), analyses: {}, catalog: null, theme: SKIFER_CLAIR, cancelTile: vi.fn(), retryTile: vi.fn(), restartTile: vi.fn() } as unknown as Editor;
  const view = render(<Apercu onClose={vi.fn()} />);
  expect(view.container.querySelector(`[data-column="${N.c1}"]`)).toHaveStyle({ gridColumn: "span 4" });
  expect(view.container.querySelector(".sb-preview__viewport")).toHaveStyle({ zoom: "0.5" });
  view.unmount(); width.mockRestore();
});
