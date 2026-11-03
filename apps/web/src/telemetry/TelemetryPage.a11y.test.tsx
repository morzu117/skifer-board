import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, vi } from "vitest";

import fenetreInvalide from "../../../../contracts/telemetrie/fenetre-invalide.json";
import interdit from "../../../../contracts/telemetrie/interdit.json";
import lecture7j from "../../../../contracts/telemetrie/lecture-7j.json";
import lecture from "../../../../contracts/telemetrie/lecture.json";
import modeLocal from "../../../../contracts/telemetrie/mode-local.json";
import vide from "../../../../contracts/telemetrie/vide.json";
import { THEMES } from "../charts/theme";
import type { Fetch } from "../spaces/api";
import { expectAccessible, renderThemed } from "../test/a11y";
import { TelemetryPage } from "./TelemetryPage";

type Exemple = { status: number; body: unknown };
const MAINTENANT = () => new Date("2026-11-03T12:00:00Z");
const jamais = () => new Promise<Response>(() => undefined);
const servir = (table: Readonly<Record<string, Exemple | "jamais" | "panne">>) =>
  vi.fn<Fetch>().mockImplementation((url) => {
    const exemple = table[url];
    if (exemple === undefined || exemple === "panne") return Promise.reject(new TypeError("réseau"));
    return exemple === "jamais" ? jamais() : Promise.resolve(Response.json(exemple.body, { status: exemple.status }));
  });
const rendre = (fetcher: Fetch, theme: (typeof THEMES)[number]) => renderThemed(<main><TelemetryPage fetcher={fetcher} now={MAINTENANT} /></main>, theme);
const bandeau = (container: HTMLElement) =>
  waitFor(() => {
    if (container.querySelector(".sb-banner") === null) throw new Error("attente du bandeau");
  });
const URL_24H = "/api/telemetry?window=24h";

describe.each(THEMES)("Accessibilité de « Télémétrie » · $label", (theme) => {
  it("aucune violation axe : lecture en cours", async () => {
    const { container } = rendre(servir({ [URL_24H]: "jamais" }), theme);
    await screen.findByRole("status");
    await expectAccessible(container);
  });

  it("aucune violation axe : tableau de 24 h", async () => {
    const { container } = rendre(servir({ [URL_24H]: lecture }), theme);
    await screen.findByRole("table");
    await expectAccessible(container);
  });

  it("aucune violation axe : tableau de 7 j choisi par la bascule", async () => {
    const { container } = rendre(servir({ [URL_24H]: lecture, "/api/telemetry?window=7d": lecture7j }), theme);
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: "7 j" }));
    await screen.findByRole("region", { name: "Opérations sur les 7 derniers jours" });
    await expectAccessible(container);
  });

  it("aucune violation axe : fenêtre vide", async () => {
    const { container } = rendre(servir({ [URL_24H]: vide }), theme);
    await screen.findByRole("region", { name: "Aucune mesure" });
    await expectAccessible(container);
  });

  it.each([
    ["refus « forbidden »", interdit],
    ["mode local", modeLocal],
    ["autre refus", fenetreInvalide],
    ["panne", "panne" as const],
  ])("aucune violation axe : %s", async (_, exemple) => {
    const { container } = rendre(servir({ [URL_24H]: exemple }), theme);
    await bandeau(container);
    await expectAccessible(container);
  });
});
