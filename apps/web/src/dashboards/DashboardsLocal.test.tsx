import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import espace from "../../../../contracts/espaces/espace.json";
import { decodeSpace } from "../spaces/model";
import type { DashboardDraft } from "./document";
import { DashboardsPage } from "./DashboardsPage";

const draft = { name: "Local" } as DashboardDraft;
vi.mock("./NouveauDashboard", () => ({ NouveauDashboard: ({ onLocal }: { onLocal: (draft: DashboardDraft) => void }) => <button onClick={() => { onLocal(draft); }}>Ouvrir brouillon</button> }));
vi.mock("./edition/Editeur", () => ({ Editeur: ({ onCreated, onLeaveLocal }: { onCreated: (id: string) => void; onLeaveLocal: () => void }) => <><button onClick={() => { onCreated("saved"); }}>Créé</button><button onClick={onLeaveLocal}>Quitter</button></> }));
it("ouvre, quitte et navigue après création du brouillon", () => {
  const onLocalChange = vi.fn();
  const view = render(<DashboardsPage space={decodeSpace(espace.body, "espace")} fetcher={vi.fn().mockResolvedValue(Response.json({ dashboards: [], unreadable: 0 }))} identity="cora" environment="DEV" onLocalChange={onLocalChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Nouveau dashboard" })); fireEvent.click(screen.getByRole("button", { name: "Ouvrir brouillon" }));
  expect(onLocalChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "Quitter" })); expect(onLocalChange).toHaveBeenLastCalledWith(false); fireEvent.click(screen.getByRole("button", { name: "Nouveau dashboard" })); fireEvent.click(screen.getByRole("button", { name: "Ouvrir brouillon" }));
  fireEvent.click(screen.getByRole("button", { name: "Créé" })); expect(window.location.hash).toBe("#/espaces/finance/dashboards/saved"); expect(onLocalChange).toHaveBeenLastCalledWith(false); view.unmount(); expect(onLocalChange).toHaveBeenLastCalledWith(false); window.location.hash = "";
});
