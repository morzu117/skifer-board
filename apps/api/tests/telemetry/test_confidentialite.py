"""Aucune donnée de T3 dans la télémétrie, sur toutes les routes (plan 11, 11.2 ; T2, T3).

Serveur réel en mode OIDC, sessions, espaces et mesures en base. Une personne se connecte par
le parcours complet ; toutes les routes de `app.router.routes` sont appelées avec des valeurs
reconnaissables (sujet, courriel, groupe, nom, identifiants, valeurs de paramètres, requête,
corps, en-têtes, adresse). On cherche ensuite ces valeurs dans la table `telemetry` et dans les
lignes JSON du journal : aucune ne doit y être, et chaque requête y laisse une seule mesure, au
gabarit de sa route.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import pytest
from catalog.conftest import INSTANT
from catalog.conftest import espace as espace
from catalog.conftest import espace_versionne as espace_versionne
from catalog.conftest import service as service
from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx2 import Response
from identity.conftest import Cles, Fournisseur, Horloge
from identity.conftest import claims as claims
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from identity.test_web import connecter
from skifer_board.catalog import CatalogService
from skifer_board.execution import ConnectionStore
from skifer_board.execution.vault import VaultKeys
from skifer_board.identity import OidcConfig
from skifer_board.identity.web import build_runtime
from skifer_board.server import create_app
from skifer_board.spaces import Environment, GroupPrincipal, SpaceStore
from skifer_board.state import DatabaseConfig, PgLoginRequests, PgSessionStore, connect
from skifer_board.telemetry import Recorder, TelemetryStore
from spaces.monde import (
    EMETTEUR,
    ORIGINE,
    PLATEFORME,
    PLATEFORME_SEULE,
    A,
    espaces_en_base,
    peupler,
)
from spaces.monde import config_plateforme as config_plateforme
from sqlalchemy import Engine
from starlette.routing import Route

from .conftest import Journal, lignes

SESSION = "__Host-sb_session"
CHAMPS = {
    "at",
    "kind",
    "operation",
    "method",
    "status",
    "outcome",
    "space",
    "environment",
    "duration_ms",
    "rows",
    "size",
}
# Une requête d'un navigateur : chaque en-tête porte une valeur reconnaissable.
ENTETES = {
    "Origin": ORIGINE,
    "User-Agent": "agent-sentinelle/1.0",
    "X-Forwarded-For": "203.0.113.77",
    "X-Requete": "entete-sentinelle",
    "Accept-Language": "fr-sentinelle",
}
DECLARATION: dict[str, Any] = {
    "type": "identifier",
    "constraints": {},
    "required": True,
    "default": None,
    "description": "Description sentinelle du paramètre",
}


@dataclass
class Serveur:
    app: FastAPI
    moteur: Engine
    magasin: SpaceStore
    horloge: Horloge


@pytest.fixture
def serveur(
    espace_versionne: Any,
    service: CatalogService,
    config_plateforme: OidcConfig,
    fournisseur: Fournisseur,
    horloge: Horloge,
    migre: Engine,
    journal: Journal,
) -> Iterator[Serveur]:
    """Assemblage de `main()` en OIDC : sessions, demandes de connexion, espaces et mesures en
    base ; lectures d'Atlas branchées sur le même enregistreur."""
    moteur = connect(DatabaseConfig(migre.url))
    magasin = SpaceStore(moteur)
    runtime = build_runtime(
        config_plateforme,
        fournisseur,
        horloge,
        PgSessionStore(moteur, config_plateforme.session_absolute, config_plateforme.session_idle),
        PgLoginRequests(moteur),
        magasin.record_login,
    )
    enregistreur = Recorder(TelemetryStore(moteur), horloge, wait=0.01)
    catalogue = CatalogService(service.config, lambda: INSTANT, measure=enregistreur.submit)
    app = create_app(
        catalogue,
        runtime,
        espaces_en_base(moteur, horloge),
        enregistreur,
        ConnectionStore(moteur),
        VaultKeys("test", {"test": b"1" * 32}),
    )
    peupler(magasin, horloge)
    magasin.grant(
        A, Environment.DEV, GroupPrincipal("finance-admins"), PLATEFORME_SEULE.ref, horloge()
    )
    try:
        yield Serveur(app, moteur, magasin, horloge)
    finally:
        moteur.dispose()


class Parcours:
    """Envoie les requêtes et retient, pour chacune, le gabarit et la méthode attendus."""

    def __init__(self, client: TestClient) -> None:
        self.client = client
        self.attendues: list[tuple[str, str, int]] = []
        self.reponses: list[Response] = []

    def __call__(
        self,
        methode: str,
        chemin: str,
        gabarit: str,
        statut: int,
        corps: object = None,
        params: dict[str, str] | None = None,
        entetes: dict[str, str] | None = None,
    ) -> Response:
        reponse = self.client.request(
            methode,
            chemin,
            json=corps,
            params=params,
            headers=ENTETES if entetes is None else entetes,
        )
        assert reponse.status_code == statut, (methode, chemin, reponse.text)
        self.attendues.append((gabarit, methode, statut))
        self.reponses.append(reponse)
        return reponse


def test_aucune_donnee_personnelle_ni_valeur_sur_toutes_les_routes(
    serveur: Serveur,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
    journal: Journal,
) -> None:
    app = serveur.app
    identite = {
        **claims,
        "sub": "sujet-sentinelle",
        "name": "Nom Sentinelle",
        "email": "courriel-sentinelle@example.invalid",
        "groups": [PLATEFORME, "finance-admins", "groupe-sentinelle"],
    }
    s = "/api/spaces/{space_id}"
    secrets: set[str] = set()
    with TestClient(
        app, base_url=ORIGINE, follow_redirects=False, raise_server_exceptions=False
    ) as client:
        parcours = Parcours(client)
        # Sans session : la garde refuse avant le routage, le gabarit est gardé.
        parcours("GET", f"/api/spaces/{A}/members", s + "/members", 401)
        client.cookies.set(SESSION, "jeton-sentinelle-invalide", domain="board.example.invalid")
        parcours("GET", f"/api/spaces/{A}/parameters", s + "/parameters", 401)
        client.cookies.clear()
        # Connexion complète : `/auth/login` puis `/auth/callback`, mesurées aussi.
        retour, jeton = connecter(client, fournisseur, cles, identite)
        parcours.attendues += [("/auth/login", "GET", 303), ("/auth/callback", "GET", 303)]
        session = client.cookies[SESSION]
        secrets |= {session, jeton, "code-secret", "acces-secret", "renouvellement-secret"}

        moi = parcours("GET", "/api/me", "/api/me", 200)
        assert moi.json()["identity"]["email"] == "courriel-sentinelle@example.invalid"
        parcours("GET", "/api/spaces", "/api/spaces", 200)
        nouveau = {
            "id": "nouvel-espace",
            "name": "Nom espace sentinelle",
            "first_admin": {"kind": "group", "name": "groupe-premier-sentinelle"},
        }
        parcours("POST", "/api/spaces", "/api/spaces", 201, nouveau)
        parcours("POST", "/api/spaces", "/api/spaces", 409, nouveau)
        parcours("GET", f"/api/spaces/{A}", s, 200)
        parcours("GET", "/api/spaces/espace-inexistant", s, 404)

        membres = parcours("GET", f"/api/spaces/{A}/members", s + "/members", 200)
        liaisons = [m["id"] for m in membres.json()["members"]]
        secrets |= set(liaisons)
        membre = {"principal": {"kind": "group", "name": "groupe-membre-sentinelle"}}
        lie = parcours(
            "POST", f"/api/spaces/{A}/members", s + "/members", 200, {**membre, "role": "reader"}
        )
        secrets.add(lie.json()["id"])
        personne = {
            "principal": {"kind": "person", "issuer": EMETTEUR, "subject": "inconnu-sentinelle"},
            "role": "reader",
        }
        parcours("POST", f"/api/spaces/{A}/members", s + "/members", 422, personne)
        parcours("POST", f"/api/spaces/{A}/members", s + "/members", 400, {"x": "sentinelle"})
        parcours(
            "DELETE",
            f"/api/spaces/{A}/members/{lie.json()['id']}",
            s + "/members/{binding_id}",
            204,
        )
        parcours(
            "DELETE",
            f"/api/spaces/{A}/members/liaison-sentinelle",
            s + "/members/{binding_id}",
            404,
        )

        g = s + "/deploy-grants"
        parcours("GET", f"/api/spaces/{A}/deploy-grants", g, 200)
        accord = {
            "environment": "TEST",
            "principal": {"kind": "group", "name": "groupe-accord-sentinelle"},
        }
        accorde = parcours("POST", f"/api/spaces/{A}/deploy-grants", g, 200, accord)
        secrets.add(accorde.json()["id"])
        parcours(
            "DELETE",
            f"/api/spaces/{A}/deploy-grants/{accorde.json()['id']}",
            g + "/{grant_id}",
            204,
        )
        parcours(
            "DELETE", f"/api/spaces/{A}/deploy-grants/accord-sentinelle", g + "/{grant_id}", 404
        )

        p = s + "/parameters"
        v = p + "/{name}/values/{environment}"
        parcours("GET", f"/api/spaces/{A}/parameters", p, 200)
        parcours(
            "POST",
            f"/api/spaces/{A}/parameters",
            p,
            201,
            {"name": "param_sentinelle", **DECLARATION},
        )
        parcours(
            "POST",
            f"/api/spaces/{A}/parameters",
            p,
            409,
            {"name": "param_sentinelle", **DECLARATION},
        )
        parcours(
            "PUT",
            f"/api/spaces/{A}/parameters/param_sentinelle",
            p + "/{name}",
            200,
            {**DECLARATION, "description": "Autre description sentinelle"},
        )
        parcours(
            "PUT",
            f"/api/spaces/{A}/parameters/param_absent_sentinelle",
            p + "/{name}",
            404,
            DECLARATION,
        )
        valeur = {"value": "valeur_sentinelle"}
        parcours("PUT", f"/api/spaces/{A}/parameters/param_sentinelle/values/DEV", v, 200, valeur)
        parcours("PUT", f"/api/spaces/{A}/parameters/param_sentinelle/values/PROD", v, 403, valeur)
        parcours(
            "PUT",
            f"/api/spaces/{A}/parameters/param_sentinelle/values/DEV",
            v,
            400,
            {"value": "valeur sentinelle invalide !"},
        )
        parcours(
            "PUT",
            f"/api/spaces/{A}/parameters/param_sentinelle/values/env-sentinelle",
            v,
            400,
            valeur,
        )
        configuration = parcours("GET", f"/api/spaces/{A}/parameters", p, 200)
        assert "valeur_sentinelle" in configuration.text
        parcours("DELETE", f"/api/spaces/{A}/parameters/param_sentinelle/values/DEV", v, 204)
        parcours("DELETE", f"/api/spaces/{A}/parameters/param_sentinelle", p + "/{name}", 204)
        parcours("DELETE", f"/api/spaces/{A}/parameters/param_sentinelle", p + "/{name}", 404)

        x = s + "/connections"
        xb = x + "/{name}/bindings/{environment}"
        xc = xb + "/credential"
        xt = xb + "/test"
        parcours("GET", f"/api/spaces/{A}/connections", x, 200)
        parcours("POST", f"/api/spaces/{A}/connections", x, 201, {"name": "connexion_sentinelle"})
        parcours(
            "PUT",
            f"/api/spaces/{A}/connections/connexion_sentinelle/bindings/DEV",
            xb,
            200,
            {
                "connector": "databricks",
                "endpoint_key": "wh-sentinelle",
                "identity_mode": "service",
            },
        )
        parcours(
            "PUT",
            f"/api/spaces/{A}/connections/connexion_sentinelle/bindings/DEV/credential",
            xc,
            204,
            {"secret": "identifiant-sentinelle"},
        )
        secrets.add("identifiant-sentinelle")
        parcours(
            "POST",
            f"/api/spaces/{A}/connections/connexion_sentinelle/bindings/DEV/test",
            xt,
            409,
        )
        parcours(
            "DELETE",
            f"/api/spaces/{A}/connections/connexion_sentinelle/bindings/DEV/credential",
            xc,
            204,
        )
        parcours(
            "DELETE", f"/api/spaces/{A}/connections/connexion_sentinelle/bindings/DEV", xb, 204
        )
        parcours("DELETE", f"/api/spaces/{A}/connections/connexion_sentinelle", x + "/{name}", 204)

        ex = s + "/executions"
        parcours(
            "POST",
            f"/api/spaces/{A}/executions",
            ex,
            503,
            {
                "connection": "connexion_sentinelle",
                "environment": "DEV",
                "model": "modele_sentinelle",
                "metrics": ["metrique_sentinelle"],
                "dimensions": [],
                "filters": [],
            },
        )
        parcours("GET", f"/api/spaces/{A}/executions", ex, 200)
        execution = f"/api/spaces/{A}/executions/execution-sentinelle"
        parcours("GET", execution, ex + "/{execution_id}", 404)
        parcours("GET", execution + "/result", ex + "/{execution_id}/result", 404)
        parcours("POST", execution + "/cancel", ex + "/{execution_id}/cancel", 404)

        journal_espace = parcours("GET", f"/api/spaces/{A}/events", s + "/events", 200)
        assert "sentinelle" in journal_espace.text
        trouvees = parcours("GET", "/api/people", "/api/people", 200, params={"q": "sentinelle"})
        assert "courriel-sentinelle@example.invalid" in trouvees.text
        parcours("GET", "/api/people", "/api/people", 400, params={"q": ""})

        c = s + "/catalog"
        filtres = {
            "q": "requete-sentinelle",
            "domain": "domaine-sentinelle",
            "owner": "proprio-sentinelle",
        }
        parcours("GET", f"/api/spaces/{A}/catalog", c, 200, params=filtres)
        parcours("GET", f"/api/spaces/{A}/catalog", c, 400, params={"status": "statut-sentinelle"})
        parcours("GET", f"/api/spaces/{A}/catalog/revenu-net", c + "/{document_id}", 200)
        absent = parcours(
            "GET", f"/api/spaces/{A}/catalog/document-sentinelle", c + "/{document_id}", 404
        )
        assert "document-sentinelle" in absent.text
        parcours(
            "GET",
            f"/api/spaces/{A}/catalog/revenu-net/versions",
            c + "/{document_id}/versions",
            200,
        )
        parcours(
            "GET",
            f"/api/spaces/{A}/catalog/document-sentinelle/versions",
            c + "/{document_id}/versions",
            404,
        )
        d = c + "/{document_id}/diff"
        parcours(
            "GET",
            f"/api/spaces/{A}/catalog/revenu-net/diff",
            d,
            200,
            params={"base": "4", "other": "5"},
        )
        parcours(
            "GET",
            f"/api/spaces/{A}/catalog/revenu-net/diff",
            d,
            404,
            params={"base": "4", "other": "99"},
        )
        parcours(
            "GET",
            f"/api/spaces/{A}/catalog/revenu-net/diff",
            d,
            400,
            params={"base": "base-sentinelle"},
        )

        # Lecture de la télémétrie (plan 11, 11.3) : ni personne ni valeur dans sa réponse.
        t = "/api/telemetry"
        lue = parcours("GET", t, t, 200, params={"window": "24h"})
        assert "sentinelle" not in lue.text.lower()
        parcours("GET", t, t, 400, params={"window": "fenetre-sentinelle"})
        # Sans route : `unmatched`, jamais le chemin.
        parcours("GET", "/api/chemin-sentinelle/x", "unmatched", 404)
        parcours("GET", "/page-sentinelle", "unmatched", 404)
        # Origine étrangère : refus de la garde, gabarit gardé.
        etrangere = {**ENTETES, "Origin": "https://origine-sentinelle.example.invalid"}
        parcours("POST", "/api/spaces", "/api/spaces", 403, nouveau, entetes=etrangere)
        parcours("POST", "/auth/logout", "/auth/logout", 200)
        parcours("GET", "/api/me", "/api/me", 401)

    # Toutes les routes ont été appelées, chacune avec sa méthode.
    routes = {
        (methode, route.path)
        for route in app.router.routes
        if isinstance(route, Route)
        for methode in route.methods or ()
    }
    assert {(m, g) for g, m, _ in parcours.attendues if g != "unmatched"} == routes

    # Le serveur arrêté, la file est vidée : une mesure HTTP par requête, dans l'ordre.
    table = lignes(serveur.moteur)
    http = [ligne for ligne in table if ligne["kind"] == "http"]
    assert [(e["operation"], e["method"], e["status"]) for e in http] == parcours.attendues
    lignes_json = journal.mesures()
    assert len(lignes_json) == len(table)
    assert all(set(ligne) == CHAMPS for ligne in lignes_json)
    for ligne, rangee in zip(lignes_json, table, strict=True):
        assert (ligne["kind"], ligne["operation"], ligne["status"], ligne["space"]) == (
            rangee["kind"],
            rangee["operation"],
            rangee["status"],
            rangee["space_id"],
        )
    # Espace seulement sur une route qui en porte un ; environnement seulement sur les valeurs.
    for e in table:
        if e["kind"] == "atlas":
            assert e["operation"] in {
                "atlas.list",
                "atlas.document",
                "atlas.versions",
                "atlas.diff",
            }
            assert (e["space_id"], e["environment"], e["method"], e["status"]) == (None,) * 4
            continue
        porte = "{space_id}" in e["operation"]
        assert (e["space_id"] is not None) == porte
        assert e["space_id"] in {None, A, "espace-inexistant"}
        if e["operation"] not in (v, xb, xc, xt):
            assert e["environment"] is None
    # Environnement seulement s'il est dans la liste fermée (`env-sentinelle` : aucun).
    assert [e["environment"] for e in table if e["operation"] == v] == [
        "DEV",
        "PROD",
        "DEV",
        None,
        "DEV",
    ]
    assert [e["environment"] for e in table if e["operation"] == xb] == ["DEV", "DEV"]
    assert [e["environment"] for e in table if e["operation"] == xc] == ["DEV", "DEV"]
    assert [e["environment"] for e in table if e["operation"] == xt] == ["DEV"]

    # Rien de T3, ni dans la table ni dans le journal.
    textes = [repr(sorted(e.items())) for e in table] + journal.textes()
    interdits = secrets | {
        "sentinelle",
        "nouvel-espace",
        "finance-admins",
        PLATEFORME,
        EMETTEUR,
        "example.invalid",
        "revenu-net",
        "203.0.113.77",
        "testclient",
        "Mozilla",
        "valeur_sentinelle",
    }
    for texte in textes:
        for interdit in interdits:
            assert interdit.lower() not in texte.lower(), (interdit, texte)
    # Les valeurs cherchées ont bien traversé le serveur : la recherche n'est pas vide de sens.
    assert any("sentinelle" in r.text for r in parcours.reponses)
    assert retour.status_code == 303


def test_garde_d_identite_garde_le_gabarit_et_l_environnement(
    serveur: Serveur, journal: Journal
) -> None:
    """Refus de la garde (401 sans session, 403 d'origine) : gabarit, espace et environnement
    sont mesurés, le nom du paramètre jamais."""
    v = "/api/spaces/{space_id}/parameters/{name}/values/{environment}"
    with TestClient(serveur.app, base_url=ORIGINE, raise_server_exceptions=False) as client:
        chemin = f"/api/spaces/{A}/parameters/param_secret/values/PROD"
        assert (
            client.put(chemin, json={"value": "x"}, headers={"Origin": ORIGINE}).status_code == 401
        )
        assert client.put(chemin, json={"value": "x"}).status_code == 403
    attendu = [
        (v, "PUT", 401, "unauthenticated", A, "PROD"),
        (v, "PUT", 403, "origin_refused", A, "PROD"),
    ]
    obtenu = [
        (e["operation"], e["method"], e["status"], e["outcome"], e["space_id"], e["environment"])
        for e in lignes(serveur.moteur)
    ]
    assert obtenu == attendu
    assert "param_secret" not in "".join(journal.textes())
