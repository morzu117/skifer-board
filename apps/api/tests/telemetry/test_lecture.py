"""Lecture de la télémétrie, `GET /api/telemetry` (plan 11, 11.3 ; T7).

Serveur réel en OIDC sur une base migrée : les personnes se connectent par le vrai parcours,
les mesures de référence sont posées par le magasin, l'horloge de l'enregistreur est réglée sur
`MAINTENANT`. Pour les exemples de contrat, le cycle de vie du serveur n'est pas lancé : le fil
d'écriture ne tourne pas, si bien que les requêtes du scénario lui-même (connexion, lectures)
restent dans la file et n'entrent pas dans les résumés comparés.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
from catalog.conftest import espace as espace
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
from skifer_board.identity import OidcConfig
from skifer_board.identity.web import build_runtime
from skifer_board.server import create_app
from skifer_board.spaces import SpaceStore
from skifer_board.state import DatabaseConfig, connect
from skifer_board.telemetry import (
    TELEMETRY_PATH,
    Measure,
    Recorder,
    Summary,
    TelemetryStore,
    Window,
)
from spaces.monde import ORIGINE, PLATEFORME, espaces_en_base, peupler
from spaces.monde import config_plateforme as config_plateforme
from sqlalchemy import Engine

from .conftest import MAINTENANT, Journal, atlas, avant, http, lignes

CONTRATS = Path(__file__).resolve().parents[4] / "contracts" / "telemetrie"
ATTENDUS = {"lecture", "lecture-7j", "vide", "interdit", "mode-local", "fenetre-invalide"}
MEMBRES = "/api/spaces/{space_id}/members"
INTERDIT = {"error": {"code": "forbidden", "required": "platform_admin"}}
FENETRE = {"error": {"code": "invalid_request", "field": "window"}}
MODE_LOCAL = {"error": {"code": "local_mode"}}
NON_CONNECTE = {"error": {"code": "unauthenticated", "login_url": "/auth/login"}}


def mesures_des_exemples() -> list[Measure]:
    """Les mesures de référence des exemples de `contracts/telemetrie/`."""
    resultat = [
        http(
            at=avant(hours=5, minutes=i),
            operation=MEMBRES,
            space="finance",
            duration_ms=duree,
            status=statut,
            outcome=issue,
            size=taille,
        )
        for i, (duree, statut, issue, taille) in enumerate(
            [
                (8.0, 200, "ok", 412),
                (11.0, 200, "ok", 418),
                (14.0, 200, "ok", 430),
                (21.0, 403, "forbidden", 52),
                (95.0, 500, "error", 35),
            ]
        )
    ]
    resultat += [
        atlas(
            at=avant(hours=2, minutes=i),
            operation="atlas.list",
            duration_ms=duree,
            rows=documents,
            size=1_572_864,
        )
        for i, (duree, documents) in enumerate([(31.0, 48), (35.0, 48), (52.0, 12)])
    ]
    resultat += [
        atlas(
            at=avant(minutes=4),
            operation="atlas.document",
            outcome="catalog_unavailable",
            duration_ms=2.0,
        ),
        http(
            at=avant(minutes=20),
            operation="/api/me",
            duration_ms=1.5,
            status=401,
            outcome="unauthenticated",
            size=64,
        ),
        http(at=avant(minutes=21), operation="/api/me", duration_ms=2.5, size=64),
        http(
            at=avant(days=3),
            operation="/api/spaces",
            method="POST",
            duration_ms=40.0,
            status=201,
            size=300,
        ),
    ]
    return resultat


@dataclass
class Serveur:
    app: FastAPI
    moteur: Engine
    magasin: TelemetryStore
    fournisseur: Fournisseur
    cles: Cles
    claims: dict[str, Any]
    horloge: Horloge

    def navigateur(self, sujet: str, groupes: list[str], *, cycle: bool = False) -> TestClient:
        """Une personne connectée par le vrai parcours, dans son propre navigateur. Sans
        `cycle`, le cycle de vie du serveur n'est pas lancé : rien n'est écrit en base."""
        client = TestClient(self.app, base_url=ORIGINE, follow_redirects=False)
        if cycle:
            client.__enter__()
        connecter(
            client,
            self.fournisseur,
            self.cles,
            {**self.claims, "sub": sujet, "groups": groupes, "email": f"{sujet}@example.invalid"},
        )
        return client


@pytest.fixture
def serveur(
    service: CatalogService,
    config_plateforme: OidcConfig,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
    horloge: Horloge,
    migre: Engine,
) -> Iterator[Serveur]:
    moteur = connect(DatabaseConfig(migre.url))
    espaces = SpaceStore(moteur)
    runtime = build_runtime(config_plateforme, fournisseur, horloge, on_login=espaces.record_login)
    magasin = TelemetryStore(moteur)
    enregistreur = Recorder(magasin, lambda: MAINTENANT, wait=0.01)
    app = create_app(service, runtime, espaces_en_base(moteur, horloge), enregistreur)
    peupler(espaces, horloge)
    try:
        yield Serveur(app, moteur, magasin, fournisseur, cles, claims, horloge)
    finally:
        moteur.dispose()


def lire(client: TestClient, requete: str = "?window=24h") -> Response:
    return client.get(TELEMETRY_PATH + requete)


def contrat(reponse: Response) -> dict[str, Any]:
    return {"status": reponse.status_code, "body": reponse.json()}


# --- Contrats --------------------------------------------------------------------------------


@pytest.fixture
def exemples(serveur: Serveur, service: CatalogService) -> dict[str, Response]:
    admin = serveur.navigateur("00u-plateforme", [PLATEFORME])
    personne = serveur.navigateur("00u-personne", ["finance-lecteurs"])
    obtenues = {"vide": lire(admin)}
    serveur.magasin.record(mesures_des_exemples())
    obtenues["lecture"] = lire(admin)
    obtenues["lecture-7j"] = lire(admin, "?window=7d")
    obtenues["interdit"] = lire(personne)
    obtenues["fenetre-invalide"] = lire(admin, "?window=1h")
    local = TestClient(create_app(service), base_url="http://127.0.0.1:8000")
    obtenues["mode-local"] = lire(local)
    return obtenues


def test_ensemble_des_exemples() -> None:
    assert {p.stem for p in CONTRATS.glob("*.json")} == ATTENDUS
    assert {p.name for p in CONTRATS.iterdir()} == {f"{nom}.json" for nom in ATTENDUS}


def test_exemples_produits_par_le_serveur_reel(exemples: dict[str, Response]) -> None:
    assert exemples.keys() == ATTENDUS
    for nom, reponse in exemples.items():
        attendu = json.loads((CONTRATS / f"{nom}.json").read_text(encoding="utf-8"))
        assert contrat(reponse) == attendu, nom


# --- Droits ----------------------------------------------------------------------------------


def test_administration_de_la_plateforme_seule(serveur: Serveur) -> None:
    serveur.magasin.record(mesures_des_exemples())
    admin = serveur.navigateur("00u-admin", [PLATEFORME, "autres"])
    assert lire(admin).status_code == 200
    for sujet, groupes in (
        ("00u-admin-espace", ["finance-admins"]),
        ("00u-lecteur", ["finance-lecteurs"]),
        ("00u-sans-groupe", []),
        ("00u-casse", [PLATEFORME.upper()]),
        ("00u-blanc", [f" {PLATEFORME}"]),
        ("00u-prefixe", [PLATEFORME[:-1]]),
    ):
        client = serveur.navigateur(sujet, groupes)
        for requete in ("?window=24h", "?window=1h", "", "?window=24h&window=7d"):
            # Le droit d'abord : une fenêtre invalide n'apprend rien à qui n'a pas le droit.
            reponse = lire(client, requete)
            assert (reponse.status_code, reponse.json()) == (403, INTERDIT), (sujet, requete)


def test_sans_session_la_garde_refuse(serveur: Serveur) -> None:
    anonyme = TestClient(serveur.app, base_url=ORIGINE)
    for requete in ("?window=24h", "?window=x", ""):
        reponse = lire(anonyme, requete)
        assert (reponse.status_code, reponse.json()) == (401, NON_CONNECTE)
    anonyme.cookies.set("__Host-sb_session", "jeton-inconnu", domain="board.example.invalid")
    assert lire(anonyme).status_code == 401


@pytest.mark.parametrize("requete", ["?window=24h", "?window=1h", ""])
def test_mode_local_sans_base(service: CatalogService, requete: str) -> None:
    with TestClient(create_app(service), base_url="http://127.0.0.1:8000") as local:
        reponse = lire(local, requete)
    assert (reponse.status_code, reponse.json()) == (409, MODE_LOCAL)


def test_mode_local_avec_base(service: CatalogService, migre: Engine) -> None:
    enregistreur = Recorder(TelemetryStore(migre), lambda: MAINTENANT)
    with TestClient(
        create_app(service, recorder=enregistreur), base_url="http://127.0.0.1:8000"
    ) as local:
        reponse = lire(local)
    assert reponse.status_code != 403
    assert reponse.json() == MODE_LOCAL


# --- Fenêtres --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "requete",
    [
        "",
        "?window=",
        "?window",
        "?window=24h&window=24h",
        "?window=24h&window=7d",
        "?window=24H",
        "?window=1d",
        "?window=7j",
        "?window=90d",
        "?window=%2024h",
        "?window=24h%20",
        "?Window=24h",
        "?fenetre=24h",
        "?window=DAY",
    ],
)
def test_fenetre_absente_vide_repetee_ou_inconnue(serveur: Serveur, requete: str) -> None:
    admin = serveur.navigateur("00u-admin", [PLATEFORME])
    reponse = lire(admin, requete)
    assert (reponse.status_code, reponse.json()) == (400, FENETRE)


@pytest.mark.parametrize("fenetre", list(Window))
def test_chaque_fenetre_et_ses_bornes(serveur: Serveur, fenetre: Window) -> None:
    """Une mesure au tout début de la fenêtre et une à sa fin y sont ; une microseconde avant
    le début ou après la fin, elles n'y sont plus."""
    micro = timedelta(microseconds=1)
    debut = MAINTENANT - fenetre.span
    serveur.magasin.record(
        [
            http(at=debut - micro, operation="/borne/avant-le-debut"),
            http(at=debut, operation="/borne/debut"),
            http(at=MAINTENANT, operation="/borne/fin"),
            http(at=MAINTENANT + micro, operation="/borne/apres-la-fin"),
        ]
    )
    admin = serveur.navigateur("00u-admin", [PLATEFORME])
    reponse = lire(admin, f"?window={fenetre.value}")
    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["window"] == fenetre.value
    assert (corps["start"], corps["end"]) == (debut.isoformat(), MAINTENANT.isoformat())
    assert (corps["oldest"], corps["newest"]) == (debut.isoformat(), MAINTENANT.isoformat())
    assert sorted(o["operation"] for o in corps["operations"]) == ["/borne/debut", "/borne/fin"]
    assert all(o["count"] == 1 for o in corps["operations"])


def test_fenetres_imbriquees(serveur: Serveur) -> None:
    serveur.magasin.record(
        [
            http(at=avant(hours=1), operation="/une-heure"),
            http(at=avant(days=2), operation="/deux-jours"),
            http(at=avant(days=10), operation="/dix-jours"),
            http(at=avant(days=40), operation="/quarante-jours"),
        ]
    )
    admin = serveur.navigateur("00u-admin", [PLATEFORME])
    vues = {
        fenetre: {o["operation"] for o in lire(admin, f"?window={fenetre}").json()["operations"]}
        for fenetre in ("24h", "7d", "30d")
    }
    assert vues == {
        "24h": {"/une-heure"},
        "7d": {"/une-heure", "/deux-jours"},
        "30d": {"/une-heure", "/deux-jours", "/dix-jours"},
    }


def test_autres_parametres_ignores(serveur: Serveur) -> None:
    admin = serveur.navigateur("00u-admin", [PLATEFORME])
    reponse = lire(admin, "?window=7d&space=finance&q=x")
    assert (reponse.status_code, reponse.json()["window"]) == (200, "7d")


# --- Mesure de la lecture et T3 --------------------------------------------------------------


def test_la_lecture_est_mesuree_et_ne_rend_rien_de_t3(serveur: Serveur, journal: Journal) -> None:
    """Cycle de vie lancé : la lecture et ses refus sont mesurés sous `/api/telemetry` ; la
    réponse ne porte ni personne, ni espace, ni environnement, ni valeur."""
    serveur.magasin.record(
        mesures_des_exemples()
        + [
            http(
                operation="/api/spaces/{space_id}/parameters/{name}/values/{environment}",
                method="PUT",
                space="finance",
                environment="PROD",
                at=avant(minutes=1),
            )
        ]
    )
    admin = serveur.navigateur("00u-sujet-secret", [PLATEFORME, "groupe-secret"], cycle=True)
    try:
        personne = serveur.navigateur("00u-autre-secret", ["finance-admins"])
        reponses = [
            lire(admin),
            lire(admin, "?window=secret"),
            lire(personne, "?window=secret"),
            lire(admin, "?window=30d"),
        ]
    finally:
        admin.__exit__(None, None, None)
    for reponse in reponses:
        texte = reponse.text.lower()
        for interdit in ("secret", "finance", "prod", "example.invalid", PLATEFORME, "00u"):
            assert interdit not in texte, (interdit, reponse.text)
    assert [r.status_code for r in reponses] == [200, 400, 403, 200]
    lectures = [
        (e["method"], e["status"], e["outcome"], e["space_id"], e["environment"])
        for e in lignes(serveur.moteur)
        if e["operation"] == TELEMETRY_PATH
    ]
    assert lectures == [
        ("GET", 200, "ok", None, None),
        ("GET", 400, "invalid_request", None, None),
        ("GET", 403, "forbidden", None, None),
        ("GET", 200, "ok", None, None),
    ]
    # Les mesures du scénario portent l'instant de l'enregistreur.
    assert {e["at"] for e in lignes(serveur.moteur) if e["operation"] == TELEMETRY_PATH} == {
        MAINTENANT
    }


# --- Résumé en JSON --------------------------------------------------------------------------


def test_instants_rendus_en_utc_quel_que_soit_le_fuseau(migre: Engine) -> None:
    magasin = TelemetryStore(migre)
    magasin.record([http(at=avant(hours=3)), http(at=avant(minutes=1))])
    ailleurs = timezone(timedelta(hours=5, minutes=45))
    resume = magasin.summary(Window.DAY, MAINTENANT.astimezone(ailleurs))
    corps = resume.to_json()
    assert corps["start"] == "2026-11-02T12:00:00+00:00"
    assert corps["end"] == "2026-11-03T12:00:00+00:00"
    assert corps["oldest"] == "2026-11-03T09:00:00+00:00"
    assert corps["newest"] == "2026-11-03T11:59:00+00:00"
    direct = Summary(
        Window.WEEK,
        datetime(2026, 1, 1, 5, 45, tzinfo=ailleurs),
        datetime(2026, 1, 8, 5, 45, tzinfo=ailleurs),
        datetime(2026, 1, 2, tzinfo=timezone(timedelta(hours=-8))),
        None,
        (),
    ).to_json()
    assert direct == {
        "window": "7d",
        "start": "2026-01-01T00:00:00+00:00",
        "end": "2026-01-08T00:00:00+00:00",
        "oldest": "2026-01-02T08:00:00+00:00",
        "newest": None,
        "operations": [],
    }
    assert datetime.fromisoformat(direct["start"]).tzinfo == UTC
