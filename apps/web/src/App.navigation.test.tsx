import { act, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import liste from "../../../contracts/espaces/liste.json";
import etabli from "../../../contracts/identite/me-etabli.json";
import type { Fetch } from "./identity/api";
import type { AppShell as Coque } from "./shell/AppShell";

import { App } from "./App";

// La coque est remplacée par un témoin qui garde ses propriétés : on appelle `onNavigate` comme
// le ferait une entrée de la navigation, sans dépendre de ce que la barre latérale affiche.
const vues: ComponentProps<typeof Coque>[] = [];
vi.mock("./shell/AppShell", () => ({
  AppShell: (props: ComponentProps<typeof Coque>) => {
    vues.push(props);
    return <main>{props.children}</main>;
  },
}));

afterEach(() => {
  vues.length = 0;
  window.history.replaceState(null, "", "/");
});

describe("Navigation de la coque hors d'un espace confirmé (plan 08, 8.4)", () => {
  it("une entrée appelée sans espace confirmé ne mène nulle part", async () => {
    window.history.replaceState(null, "", "/#/");
    const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(Response.json(url === "/api/me" ? etabli.body : liste.body)));
    render(<App fetcher={fetcher} leave={vi.fn()} />);
    await screen.findByRole("list", { name: "Espaces" });
    const derniere = vues.at(-1);
    expect(derniere?.available.size).toBe(0);
    act(() => {
      derniere?.onNavigate("espace");
      derniere?.onNavigate("catalogue");
    });
    expect(window.location.hash).toBe("#/");
  });
});
