import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { handleDomId, nodeDomId, filterDomId, treeDomId, useEditor } from "./EditorContext";

it("refuse de servir un panneau hors d'un éditeur", () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  expect(() => renderHook(() => useEditor())).toThrow("useEditor : hors d'un éditeur");
  vi.restoreAllMocks();
});

it("nomme les éléments du DOM d'après l'identifiant du nœud", () => {
  expect([nodeDomId("a"), handleDomId("a"), filterDomId("a"), treeDomId("a")]).toEqual(["sb-node-a", "sb-handle-a", "sb-filter-a", "sb-tree-a"]);
});
