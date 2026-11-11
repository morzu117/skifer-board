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
