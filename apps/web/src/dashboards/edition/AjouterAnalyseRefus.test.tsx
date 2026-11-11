import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ID, route } from "../../analyses/testing";
import type { Editor } from "./EditorContext";
import { AjouterAnalyse } from "./AjouterAnalyse";
import { ANALYSES, analysisBody, editorServer, N, ROOT, sampleDraft, type AnalysisSpec } from "./testing";
import { buildTree } from "./tree";

const mock = vi.hoisted(() => ({ editor: {} as Editor }));
vi.mock("./EditorContext", () => ({ useEditor: () => mock.editor }));

beforeEach(() => { mock.editor = { document: sampleDraft(), tree: buildTree(sampleDraft()), selected: N.c1, run: vi.fn().mockReturnValue(false), say: vi.fn() } as unknown as Editor; });

it.each([N.c1, N.s1])("garde le dialogue ouvert si la commande d'insertion est refusée : %s", async (selected) => {
  mock.editor = { ...mock.editor, selected };
  const server = editorServer();
  const close = vi.fn();
  render(<AjouterAnalyse space="finance" fetcher={server.fetcher} onClose={close} />);
  await userEvent.click(await screen.findByRole("button", { name: /Total · Partagée/ }));
  await userEvent.click(await screen.findByRole("button", { name: /^Ajouter$/ }));
  expect(mock.editor.run).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
});

it("signale les analyses illisibles et une révision d'analyse supprimée", async () => {
  const listed = route("lister", [[ID, N.bars]]).body as { analyses: Record<string, unknown>[] };
  const body = analysisBody(N.bars, ANALYSES[N.bars] as AnalysisSpec);
  const server = editorServer({ overrides: {
    [`GET ${ROOT}/analyses`]: Response.json({ ...listed, unreadable: 1 }),
    [`GET ${ROOT}/analyses/${N.bars}/revisions/1`]: Response.json({ ...body, current_revision: null }),
  } });
  render(<AjouterAnalyse space="finance" fetcher={server.fetcher} onClose={vi.fn()} />);
  expect(await screen.findByText(/Certaines analyses n'ont pas pu être lues/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Chiffre d'affaires/ }));
  expect(await within(screen.getByRole("region", { name: "Aperçu de l'analyse" })).findByText(/révision courante : supprimée/)).toBeInTheDocument();
});
