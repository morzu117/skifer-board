import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, vi } from "vitest";

import existant from "../../../../contracts/espaces/espace-existant.json";
import liste from "../../../../contracts/espaces/liste.json";
import administration from "../../../../contracts/espaces/liste-administration.json";
import locale from "../../../../contracts/espaces/liste-locale.json";
import { THEMES } from "../charts/theme";
import { expectAccessible, renderThemed } from "../test/a11y";
import type { Fetch } from "./api";
import { CreateSpacePage } from "./CreateSpacePage";
import { decodeSpaceList } from "./model";

const ok = (body: unknown) => ({ status: "ok", value: decodeSpaceList(body) }) as const;
const rendre = (listed: Parameters<typeof CreateSpacePage>[0]["listed"], fetcher: Fetch, theme: (typeof THEMES)[number]) =>
  renderThemed(<main><CreateSpacePage listed={listed} fetcher={fetcher} onCreated={vi.fn()} /></main>, theme);

describe.each(THEMES)("Accessibilité de la création d'un espace · $label", (theme) => {
  it.each([
    ["lecture des droits", { status: "loading" } as const],
    ["droits illisibles", { status: "error", message: "Le serveur Board ne répond pas." } as const],
    ["mode local", ok(locale.body)],
    ["sans administration", ok(liste.body)],
    ["formulaire", ok(administration.body)],
  ])("aucune violation axe : %s", async (_etat, listed) => {
    const { container } = rendre(listed, vi.fn<Fetch>(), theme);
    await expectAccessible(container);
  });

  it("aucune violation axe : problèmes de saisie signalés", async () => {
    const { container } = rendre(ok(administration.body), vi.fn<Fetch>(), theme);
    await userEvent.click(screen.getByRole("button", { name: "Créer l'espace" }));
    await screen.findByText("Le nom est obligatoire.");
    await expectAccessible(container);
  });

  it("aucune violation axe : refus du serveur et personne choisie", async () => {
    const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(url.startsWith("/api/people")
      ? Response.json({ people: [{ issuer: "https://id.example.invalid", subject: "s", name: "Dominique", email: "d@example.invalid", last_login: "2026-11-02T08:45:00Z" }] })
      : Response.json(existant.body, { status: existant.status })));
    const { container } = rendre(ok(administration.body), fetcher, theme);
    const formulaire = screen.getByRole("form", { name: "Créer un espace" });
    await userEvent.type(within(formulaire).getByRole("textbox", { name: /^Identifiant/ }), "finance");
    await userEvent.type(within(formulaire).getByRole("textbox", { name: /^Nom affiché/ }), "Finance");
    await userEvent.click(within(formulaire).getByRole("radio", { name: "Personne connue" }));
    await userEvent.type(within(formulaire).getByRole("searchbox"), "dom{Enter}");
    await userEvent.click(await within(formulaire).findByRole("button", { name: /Dominique/ }));
    await userEvent.click(within(formulaire).getByRole("button", { name: "Créer l'espace" }));
    await within(formulaire).findByRole("alert");
    await expectAccessible(container);
  });
});
