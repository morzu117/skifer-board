import { afterEach, describe, expect, it, vi } from "vitest";

import accord from "../../../../contracts/espaces/accord.json";
import accordInconnu from "../../../../contracts/espaces/accord-inconnu.json";
import accords from "../../../../contracts/espaces/accords.json";
import creation from "../../../../contracts/espaces/creation.json";
import dernier from "../../../../contracts/espaces/dernier-administrateur.json";
import environnementInvalide from "../../../../contracts/espaces/environnement-invalide.json";
import existant from "../../../../contracts/espaces/espace-existant.json";
import interdit from "../../../../contracts/espaces/interdit.json";
import introuvable from "../../../../contracts/espaces/introuvable.json";
import journal from "../../../../contracts/espaces/journal.json";
import liaison from "../../../../contracts/espaces/liaison.json";
import liaisonInconnue from "../../../../contracts/espaces/liaison-inconnue.json";
import membres from "../../../../contracts/espaces/membres.json";
import modeLocal from "../../../../contracts/espaces/mode-local.json";
import inconnue from "../../../../contracts/espaces/personne-inconnue.json";
import personnes from "../../../../contracts/espaces/personnes.json";
import rechercheInvalide from "../../../../contracts/espaces/recherche-invalide.json";
import requeteInvalide from "../../../../contracts/espaces/requete-invalide.json";
import retrait from "../../../../contracts/espaces/retrait.json";
import retraitAccord from "../../../../contracts/espaces/retrait-accord.json";
import anonyme from "../../../../contracts/identite/non-authentifie.json";
import origine from "../../../../contracts/identite/origine-refusee.json";
import { onSessionLost } from "../identity/session";
import { createSpace, fetchEvents, fetchGrants, fetchMembers, grantDeploy, REFUSAL_LABELS, REFUSALS, removeMember, revokeDeploy, searchPeople, setMember, type AdminOutcome } from "./admin";
import type { Fetch } from "./api";
import { onSpaceLost } from "./lost";

type Exemple = { status: number; body: unknown };
const reponse = (exemple: Exemple) => (exemple.body === null ? new Response(null, { status: exemple.status }) : Response.json(exemple.body, { status: exemple.status }));
const servir = (exemple: Exemple) => vi.fn<Fetch>().mockResolvedValue(reponse(exemple));
const signal = () => new AbortController().signal;
const GROUPE = { kind: "group", name: "finance-admins" } as const;
const PERSONNE = { kind: "person", issuer: "https://id.example.invalid", subject: "00u5d6e7f8" } as const;

afterEach(() => { vi.unstubAllGlobals(); });

type Nom = "membres" | "journal" | "recherche" | "pose" | "retrait" | "creation" | "accords" | "accord" | "retraitAccord";
type Appel = (fetcher: Fetch) => Promise<AdminOutcome<unknown>>;
/** Chaque appel de l'administration, avec ce qu'il envoie au serveur. */
const APPELS: Readonly<Record<Nom, Appel>> = {
  membres: (fetcher: Fetch) => fetchMembers("finance", signal(), fetcher),
  journal: (fetcher: Fetch) => fetchEvents("finance", signal(), fetcher),
  recherche: (fetcher: Fetch) => searchPeople("dominique", signal(), fetcher),
  pose: (fetcher: Fetch) => setMember("finance", GROUPE, "reader", fetcher),
  retrait: (fetcher: Fetch) => removeMember("finance", "9c3f2a7d-0b14-4e6a-8d52-6a7b8c9d0e1f", fetcher),
  creation: (fetcher: Fetch) => createSpace({ id: "finance", name: "Finance", firstAdmin: GROUPE }, fetcher),
  // Droits de déployer (plan 09, 9.4) : mêmes refus, mêmes signalements que le reste de l'administration.
  accords: (fetcher: Fetch) => fetchGrants("finance", signal(), fetcher),
  accord: (fetcher: Fetch) => grantDeploy("finance", "PROD", GROUPE, fetcher),
  retraitAccord: (fetcher: Fetch) => revokeDeploy("finance", "3d8e1f2a-6b7c-4d9e-8f01-2a3b4c5d6e7f", fetcher),
};
const NOMS = Object.keys(APPELS) as Nom[];

/** Écoute session et espace perdus pendant `appel`. */
async function signalements<T>(appel: () => Promise<T>) {
  const session = vi.fn();
  const espace = vi.fn();
  const quitterSession = onSessionLost(session);
  const quitterEspace = onSpaceLost(espace);
  try {
    const issue = await appel();
    return { issue, session: session.mock.calls.length, espace: espace.mock.calls.length };
  } finally {
    quitterSession();
    quitterEspace();
  }
}

describe("Requêtes de l'administration d'un espace (plan 08, 8.4)", () => {
  it("lit les membres : adresse encodée, Accept JSON, signal transmis, sans corps", async () => {
    const fetcher = servir(membres);
    const abandon = signal();
    const issue = await fetchMembers("a/b c", abandon, fetcher);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/spaces/a%2Fb%20c/members", { method: "GET", headers: { Accept: "application/json" }, signal: abandon });
    expect(issue).toEqual({
      status: "ok",
      value: [
        {
          id: "5b0e4c1e-7a51-4f0e-9a8e-1f2d3c4b5a60",
          principal: { kind: "group", name: "finance-admins" },
          person: null,
          role: "admin",
          createdAt: new Date("2026-11-02T09:00:00Z"),
          createdBy: { issuer: "https://id.example.invalid", subject: "00u1a2b3c4" },
          createdByPerson: { name: "Camille Martin", email: "camille.martin@example.invalid" },
        },
        {
          id: "9c3f2a7d-0b14-4e6a-8d52-6a7b8c9d0e1f",
          principal: { kind: "person", issuer: "https://id.example.invalid", subject: "00u5d6e7f8" },
          person: { name: "Dominique Leroy", email: "dominique.leroy@example.invalid" },
          role: "reader",
          createdAt: new Date("2026-11-02T09:15:00Z"),
          createdBy: { issuer: "https://id.example.invalid", subject: "00u1a2b3c4" },
          createdByPerson: { name: "Camille Martin", email: "camille.martin@example.invalid" },
        },
      ],
    });
  });

  it("lit le journal de l'espace", async () => {
    const fetcher = servir(journal);
    const issue = await fetchEvents("finance", signal(), fetcher);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/spaces/finance/events");
    expect(issue.status).toBe("ok");
    if (issue.status !== "ok") return;
    expect(issue.value.map((evenement) => [evenement.id, evenement.action])).toEqual([[3, "binding_added"], [2, "binding_added"], [1, "space_created"]]);
    expect(issue.value[2]).toEqual({
      id: 1,
      at: new Date("2026-11-02T09:00:00Z"),
      actor: { issuer: "https://id.example.invalid", subject: "00u1a2b3c4" },
      actorPerson: { name: "Camille Martin", email: "camille.martin@example.invalid" },
      action: "space_created",
      detail: { name: "Finance" },
      principalPerson: null,
    });
    // Une personne visée par une liaison est nommée par le serveur, même retirée depuis.
    expect(issue.value[0]?.principalPerson).toEqual({ name: "Dominique Leroy", email: "dominique.leroy@example.invalid" });
  });

  it("cherche des personnes : recherche rognée et encodée dans `q`", async () => {
    const fetcher = servir(personnes);
    const issue = await searchPeople("  Dominique & Léo=1  ", signal(), fetcher);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/people?q=Dominique+%26+L%C3%A9o%3D1");
    expect(issue).toEqual({
      status: "ok",
      value: [{ issuer: "https://id.example.invalid", subject: "00u5d6e7f8", name: "Dominique Leroy", email: "dominique.leroy@example.invalid", lastLogin: new Date("2026-11-02T08:45:00Z") }],
    });
  });

  it("pose une liaison : POST JSON du principal et du rôle, sans signal", async () => {
    const fetcher = servir(liaison);
    const issue = await setMember("finance", PERSONNE, "reader", fetcher);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/spaces/finance/members", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ principal: PERSONNE, role: "reader" }),
    });
    expect(issue).toMatchObject({ status: "ok", value: { id: "9c3f2a7d-0b14-4e6a-8d52-6a7b8c9d0e1f", role: "reader", createdByPerson: { name: "Camille Martin" } } });
  });

  it("envoie le nom de groupe tel quel : ni rogné ni replié (E3)", async () => {
    const fetcher = servir(liaison);
    await setMember("finance", { kind: "group", name: "  Finance-Admins " }, "admin", fetcher);
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({ principal: { kind: "group", name: "  Finance-Admins " }, role: "admin" });
  });

  it("retire une liaison : DELETE à l'identifiant encodé, 204 sans corps", async () => {
    const fetcher = servir(retrait);
    expect(await removeMember("a/b", "x/y?z", fetcher)).toEqual({ status: "ok", value: null });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/spaces/a%2Fb/members/x%2Fy%3Fz", { method: "DELETE", headers: { Accept: "application/json" } });
  });

  it("crée un espace : POST /api/spaces avec `first_admin`, réponse 201 décodée", async () => {
    const fetcher = servir(creation);
    const issue = await createSpace({ id: "finance", name: "Finance", firstAdmin: PERSONNE }, fetcher);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/spaces", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ id: "finance", name: "Finance", first_admin: PERSONNE }),
    });
    expect(issue).toMatchObject({ status: "ok", value: { id: "finance", name: "Finance", role: null, implicit: false } });
  });

  it("utilise `fetch` par défaut", async () => {
    const espion = servir(membres);
    vi.stubGlobal("fetch", espion);
    await fetchMembers("finance", signal());
    await fetchEvents("finance", signal());
    await searchPeople("x", signal());
    await setMember("finance", GROUPE, "reader");
    await removeMember("finance", "b");
    await createSpace({ id: "f", name: "F", firstAdmin: GROUPE });
    await fetchGrants("finance", signal());
    await grantDeploy("finance", "DEV", GROUPE);
    await revokeDeploy("finance", "g");
    expect(espion).toHaveBeenCalledTimes(9);
  });
});

describe("Requêtes des droits de déployer (plan 09, 9.4)", () => {
  it("lit les accords : GET à l'adresse encodée, Accept JSON, signal transmis, sans corps ; exemple réel décodé", async () => {
    const fetcher = servir(accords);
    const abandon = signal();
    const issue = await fetchGrants("a/b c", abandon, fetcher);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/spaces/a%2Fb%20c/deploy-grants", { method: "GET", headers: { Accept: "application/json" }, signal: abandon });
    expect(issue.status).toBe("ok");
    if (issue.status !== "ok") return;
    expect(issue.value.map((grant) => [grant.id, grant.environment, grant.principal.kind])).toEqual([
      ["3d8e1f2a-6b7c-4d9e-8f01-2a3b4c5d6e7f", "TEST", "person"],
      ["7a4b9c0d-1e2f-4a3b-9c4d-5e6f7a8b9c0d", "DEV", "group"],
    ]);
    expect(issue.value[0]).toEqual({
      id: "3d8e1f2a-6b7c-4d9e-8f01-2a3b4c5d6e7f",
      environment: "TEST",
      principal: PERSONNE,
      person: { name: "Dominique Leroy", email: "dominique.leroy@example.invalid" },
      createdAt: new Date("2026-11-02T09:30:00Z"),
      createdBy: { issuer: "https://id.example.invalid", subject: "00u1a2b3c4" },
      createdByPerson: { name: "Camille Martin", email: "camille.martin@example.invalid" },
    });
  });

  it("accorde : POST JSON `{environment, principal}` exact, sans signal, réponse décodée", async () => {
    const fetcher = servir(accord);
    const issue = await grantDeploy("a/b", "TEST", PERSONNE, fetcher);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/spaces/a%2Fb/deploy-grants", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ environment: "TEST", principal: PERSONNE }),
    });
    expect(issue).toMatchObject({ status: "ok", value: { id: "3d8e1f2a-6b7c-4d9e-8f01-2a3b4c5d6e7f", environment: "TEST", createdByPerson: { name: "Camille Martin" } } });
  });

  it.each(["DEV", "TEST", "PROD"] as const)("accorde en %s, nom de groupe envoyé tel quel (ni rogné ni replié)", async (environnement) => {
    const fetcher = servir(accord);
    await grantDeploy("finance", environnement, { kind: "group", name: "  Finance-Admins " }, fetcher);
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({ environment: environnement, principal: { kind: "group", name: "  Finance-Admins " } });
  });

  it("retire : DELETE à l'identifiant encodé, 204 sans corps", async () => {
    const fetcher = servir(retraitAccord);
    expect(await revokeDeploy("a/b", "x/y?z#w", fetcher)).toEqual({ status: "ok", value: null });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/spaces/a%2Fb/deploy-grants/x%2Fy%3Fz%23w", { method: "DELETE", headers: { Accept: "application/json" } });
  });

  it("un accord rendu dans un environnement hors des trois n'est pas un succès", async () => {
    const issue = await grantDeploy("finance", "DEV", GROUPE, servir({ status: 200, body: { ...accord.body, environment: "QA" } }));
    expect(issue).toEqual({ status: "error", message: "Réponse du serveur hors contrat : accord.environment : DEV | TEST | PROD attendu." });
    const liste = await fetchGrants("finance", signal(), servir({ status: 200, body: { grants: [{ ...accord.body, principal: { kind: "robot" } }] } }));
    expect(liste).toEqual({ status: "error", message: "Réponse du serveur hors contrat : réponse.grants[0].principal.kind : group | person attendu." });
  });

  it("libellés : accord inconnu, environnement en cause, mode local neutre, valable pour les membres comme pour les droits de déployer", () => {
    expect(REFUSALS).toContain("grant_not_found");
    expect(REFUSAL_LABELS.grant_not_found).toBe("Ce droit de déployer n'existe plus : la liste a été relue.");
    expect(REFUSAL_LABELS.local_mode).toBe("En mode local, l'espace implicite ne se gère pas.");
  });

  it("une écriture d'accord sans signal n'est jamais traitée comme abandonnée", async () => {
    for (const ecrire of [APPELS.accord, APPELS.retraitAccord]) {
      expect(await ecrire(vi.fn<Fetch>().mockRejectedValue(new DOMException("abandon", "AbortError")))).toEqual({ status: "error", message: "Le serveur Board ne répond pas." });
    }
  });
});

describe("Refus du serveur rendus tels quels, avec leur raison", () => {
  it.each([
    ["interdit", interdit, { code: "forbidden", field: null }],
    ["dernier administrateur", dernier, { code: "last_admin", field: null }],
    ["espace existant", existant, { code: "space_exists", field: null }],
    ["personne inconnue", inconnue, { code: "unknown_person", field: null }],
    ["liaison inconnue", liaisonInconnue, { code: "binding_not_found", field: null }],
    ["mode local", modeLocal, { code: "local_mode", field: null }],
    ["accord inconnu", accordInconnu, { code: "grant_not_found", field: null }],
    ["environnement invalide", environnementInvalide, { code: "invalid_request", field: "environment" }],
    ["requête invalide", requeteInvalide, { code: "invalid_request", field: "first_admin.kind" }],
    // Le paramètre en cause est nommé `parameter`, pas `field` : aucun champ n'est inventé.
    ["recherche invalide", rechercheInvalide, { code: "invalid_parameter", field: null }],
    ["origine refusée", origine, { code: "origin_refused", field: null }],
  ] as [string, Exemple, object][])("%s", async (_cas, exemple, refus) => {
    for (const nom of NOMS) {
      const { issue, session, espace } = await signalements(() => APPELS[nom](servir(exemple)));
      expect(issue, nom).toEqual({ status: "refused", ...refus });
      expect(session + espace, nom).toBe(0);
    }
  });

  it("un espace introuvable pendant l'usage est signalé à la coque (accès retiré, E4)", async () => {
    for (const nom of NOMS) {
      const { issue, session, espace } = await signalements(() => APPELS[nom](servir(introuvable)));
      expect(issue, nom).toEqual({ status: "refused", code: "space_not_found", field: null });
      expect(espace, nom).toBe(1);
      expect(session, nom).toBe(0);
    }
  });

  it("un champ qui n'est pas un texte n'est pas repris", async () => {
    const issue = await APPELS.pose(servir({ status: 400, body: { error: { code: "invalid_request", field: 3 } } }));
    expect(issue).toEqual({ status: "refused", code: "invalid_request", field: null });
  });

  it("chaque code fermé a son libellé, et seulement eux", () => {
    expect(Object.keys(REFUSAL_LABELS).sort()).toEqual([...REFUSALS].sort());
    for (const code of REFUSALS) expect(REFUSAL_LABELS[code]).toMatch(/\.$/);
    expect(REFUSAL_LABELS.last_admin).toContain("dernière liaison administrateur");
  });

  it.each([
    ["code inconnu", { status: 409, body: { error: { code: "quota_exceeded" } } }, "Réponse inattendue du serveur (HTTP 409)."],
    ["code non textuel", { status: 400, body: { error: { code: 1 } } }, "Réponse inattendue du serveur (HTTP 400)."],
    ["erreur sans code", { status: 400, body: { error: { field: "id" } } }, "Réponse inattendue du serveur (HTTP 400)."],
    ["erreur nulle", { status: 400, body: { error: null } }, "Réponse inattendue du serveur (HTTP 400)."],
    ["erreur textuelle", { status: 400, body: { error: "last_admin" } }, "Réponse inattendue du serveur (HTTP 400)."],
    ["corps sans erreur", { status: 500, body: {} }, "Réponse inattendue du serveur (HTTP 500)."],
    ["corps nul", { status: 502, body: JSON.parse("null") as unknown }, "Réponse inattendue du serveur (HTTP 502)."],
    ["corps liste", { status: 403, body: [] }, "Réponse inattendue du serveur (HTTP 403)."],
  ] as [string, Exemple, string][])("un refus hors contrat (%s) est une erreur, jamais un refus inventé", async (_cas, exemple, message) => {
    for (const nom of NOMS) {
      const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json(exemple.body, { status: exemple.status }));
      expect(await APPELS[nom](fetcher), nom).toEqual({ status: "error", message });
    }
  });

  it.each([
    ["page HTML d'un mandataire", "<html>", 500],
    ["corps vide", "", 502],
    ["JSON tronqué", '{"error":', 409],
  ])("un refus sans corps JSON (%s) se dit par son statut, sans être un contrat rompu", async (_cas, texte, statut) => {
    for (const nom of NOMS) {
      const fetcher = vi.fn<Fetch>().mockResolvedValue(new Response(texte, { status: statut }));
      expect(await APPELS[nom](fetcher), nom).toEqual({ status: "error", message: `Réponse inattendue du serveur (HTTP ${String(statut)}).` });
    }
  });

  it("un refus sans corps JSON ne signale pas d'espace perdu", async () => {
    const perdu = vi.fn();
    const fin = onSpaceLost(perdu);
    await fetchMembers("finance", signal(), vi.fn<Fetch>().mockResolvedValue(new Response("Not Found", { status: 404 })));
    fin();
    expect(perdu).not.toHaveBeenCalled();
  });
});

describe("Pannes, session perdue et abandon", () => {
  it("401 : la session perdue est signalée, sans refus ni données", async () => {
    for (const nom of NOMS) {
      const { issue, session, espace } = await signalements(() => APPELS[nom](servir(anonyme)));
      expect(issue, nom).toEqual({ status: "error", message: "Session expirée : reconnectez-vous." });
      expect(session, nom).toBe(1);
      expect(espace, nom).toBe(0);
    }
  });

  it("serveur muet : une erreur, sans signalement", async () => {
    for (const nom of NOMS) {
      const { issue, session, espace } = await signalements(() => APPELS[nom](vi.fn<Fetch>().mockRejectedValue(new TypeError("réseau"))));
      expect(issue, nom).toEqual({ status: "error", message: "Le serveur Board ne répond pas." });
      expect(session + espace, nom).toBe(0);
    }
  });

  it.each([
    ["membres", (fetcher: Fetch) => APPELS.membres(fetcher), "réponse.members : champ attendu"],
    ["journal", (fetcher: Fetch) => APPELS.journal(fetcher), "réponse.events : champ attendu"],
    ["recherche", (fetcher: Fetch) => APPELS.recherche(fetcher), "réponse.people : champ attendu"],
    ["pose", (fetcher: Fetch) => APPELS.pose(fetcher), "liaison.id : champ attendu"],
    ["creation", (fetcher: Fetch) => APPELS.creation(fetcher), "espace.id : champ attendu"],
    ["accords", (fetcher: Fetch) => APPELS.accords(fetcher), "réponse.grants : champ attendu"],
    ["accord", (fetcher: Fetch) => APPELS.accord(fetcher), "accord.id : champ attendu"],
  ])("un succès hors contrat (%s) n'est pas un succès", async (_nom, appel, raison) => {
    expect(await appel(servir({ status: 200, body: {} }))).toEqual({ status: "error", message: `Réponse du serveur hors contrat : ${raison}.` });
  });

  it("un succès au corps illisible n'est pas un succès", async () => {
    const issue = await APPELS.membres(vi.fn<Fetch>().mockResolvedValue(new Response("pas du json", { status: 200 })));
    expect(issue).toEqual({ status: "error", message: "Réponse du serveur hors contrat : corps illisible." });
  });

  it("une lecture abandonnée rejette au lieu de rendre une erreur, avant ou après la réponse", async () => {
    for (const lire of [fetchMembers, fetchEvents, fetchGrants]) {
      const avant = new AbortController();
      avant.abort();
      const refus = new DOMException("abandon", "AbortError");
      await expect(lire("finance", avant.signal, vi.fn<Fetch>().mockRejectedValue(refus))).rejects.toBe(refus);
      const pendant = new AbortController();
      const corps = vi.fn<Fetch>().mockImplementation(() => {
        pendant.abort();
        return Promise.resolve(new Response("tronqué", { status: 200 }));
      });
      await expect(lire("finance", pendant.signal, corps)).rejects.toBeInstanceOf(SyntaxError);
    }
    const recherche = new AbortController();
    recherche.abort();
    await expect(searchPeople("x", recherche.signal, vi.fn<Fetch>().mockRejectedValue(new Error("abandon")))).rejects.toThrow("abandon");
  });

  it("une écriture sans signal n'est jamais traitée comme abandonnée", async () => {
    const issue = await setMember("finance", GROUPE, "reader", vi.fn<Fetch>().mockRejectedValue(new DOMException("abandon", "AbortError")));
    expect(issue).toEqual({ status: "error", message: "Le serveur Board ne répond pas." });
  });
});
