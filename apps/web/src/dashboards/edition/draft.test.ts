import { expect, it } from "vitest";
import { decodeDashboard } from "../document";
import { dashboardBody, sampleDraft } from "./testing";
import { draftOf } from "./draft";

it("rend les champs d'un brouillon dans l'ordre du décodeur, sans ce que le serveur pose", () => {
  const document = decodeDashboard(dashboardBody(sampleDraft()).dashboard);
  const draft = draftOf(document);
  expect(Object.keys(draft)).toEqual(Object.keys(sampleDraft()));
  expect(JSON.stringify(draft)).toBe(JSON.stringify(sampleDraft()));
  expect(draft).not.toHaveProperty("owner");
  expect(draft).not.toHaveProperty("id");
});

it("conserve les références de thème et de modèle", () => {
  const original = sampleDraft();
  const theme = { theme_id: "00000000-0000-4000-8000-000000000020", revision: 1 };
  const template = { template_id: "00000000-0000-4000-8000-000000000021", revision: 2 };
  const document = decodeDashboard(dashboardBody({ ...original, theme, template }).dashboard);
  expect(draftOf(document)).toMatchObject({ theme, template });
});
