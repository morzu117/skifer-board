"""Garde « déployeur de l'environnement » (plan 09, V7, V8), montée sur une route de test.

Les routes de déploiement n'arrivent qu'au lot 09 : la garde rendue par `install_spaces` est
posée ici sur une route d'essai, dans une application de test qui partage la base et les
sessions du serveur de `monde`. Ordre des refus : session, espace (404 identique pour un
inconnu et un non-membre, avant tout examen de l'environnement), environnement (400), droit
(403). Le droit est recalculé à chaque requête.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import pytest
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from skifer_board.identity.web import install_identity
from skifer_board.spaces import Access, Environment, GroupPrincipal, Guards, Spaces, install_spaces
from state.conftest import migre as migre

from spaces.monde import (
    ADMIN_B,
    ADMIN_GROUPE,
    ADMIN_PERSONNE,
    COOKIE,
    CREATEUR_GROUPE,
    CREATEUR_PERSONNE,
    LECTEUR_GROUPE,
    LECTEUR_PERSONNE,
    NON_MEMBRE,
    ORIGINE,
    PLATEFORME,
    PLATEFORME_LECTEUR,
    PLATEFORME_SEULE,
    A,
    B,
    Monde,
    Profil,
    espaces_en_base,
)
from spaces.monde import config_plateforme as config_plateforme
from spaces.monde import monde as monde

CHEMIN = "/api/spaces/{space_id}/environments/{environment}/essai"
INTROUVABLE = {"error": {"code": "space_not_found"}}
ENVIRONNEMENT_INVALIDE = {"error": {"code": "invalid_request", "field": "environment"}}
CODES_INVALIDES = ["QA", "LOCAL", "dev", "Prod", "PRODUCTION", "PROD%20", "%20DEV", "x" * 300]


def sans_droit(environnement: str) -> dict[str, Any]:
    return {"error": {"code": "forbidden", "required": "deploy", "environment": environnement}}


class Essai:
    """Application de test : la garde sur une écriture et sur une lecture, et le compte des
    passages dans la route, qui ne doit jamais s'exécuter après un refus."""

    def __init__(self, espaces: Spaces, runtime: Any) -> None:
        self.app = FastAPI()
        install_identity(self.app, runtime)
        self.guards = install_spaces(self.app, espaces)
        self.passages: list[tuple[str, str]] = []

        deployeur = Depends(self.guards.deployer)

        @self.app.post(CHEMIN)
        def ecrire(environment: str, found: Access = deployeur) -> Any:
            self.passages.append((found.space.id, environment))
            return {"space": found.space.id, "environment": environment}

        @self.app.get(CHEMIN, dependencies=[Depends(self.guards.deployer)])
        def lire(space_id: str, environment: str) -> Any:
            self.passages.append((space_id, environment))
            return {"space": space_id, "environment": environment}


@pytest.fixture
def essai(monde: Monde) -> Iterator[tuple[Essai, TestClient]]:
    application = Essai(espaces_en_base(monde.moteur, monde.horloge), monde.runtime)
    with TestClient(application.app, base_url=ORIGINE, raise_server_exceptions=False) as client:
        yield application, client


def appeler(
    monde: Monde,
    client: TestClient,
    profil: Profil | None,
    espace_id: str,
    environnement: str,
    methode: str = "POST",
) -> tuple[int, Any]:
    entetes = {"Origin": ORIGINE}
    if profil is not None:
        entetes["Cookie"] = f"{COOKIE}={monde.session(profil)}"
    chemin = f"/api/spaces/{espace_id}/environments/{environnement}/essai"
    reponse = client.request(methode, chemin, headers=entetes)
    return reponse.status_code, reponse.json()


def accorder(monde: Monde, espace: str, environnement: Environment, qui: Any) -> str:
    accord = monde.magasin.grant(espace, environnement, qui, PLATEFORME_SEULE.ref, monde.horloge())
    return accord.id


def test_gardes_rendues(monde: Monde) -> None:
    guards = install_spaces(FastAPI(), espaces_en_base(monde.moteur, monde.horloge))
    assert isinstance(guards, Guards)
    assert callable(guards.reader) and callable(guards.deployer)


@pytest.fixture
def accords_poses(monde: Monde) -> Monde:
    accorder(monde, A, Environment.DEV, GroupPrincipal("finance-createurs"))
    accorder(monde, A, Environment.TEST, CREATEUR_PERSONNE.ref)
    accorder(monde, A, Environment.PROD, GroupPrincipal("finance-lecteurs"))
    accorder(monde, A, Environment.PROD, LECTEUR_PERSONNE.ref)
    accorder(monde, A, Environment.PROD, GroupPrincipal("finance-admins"))
    accorder(monde, A, Environment.DEV, GroupPrincipal(PLATEFORME))
    accorder(monde, A, Environment.TEST, GroupPrincipal(PLATEFORME))
    accorder(monde, A, Environment.PROD, GroupPrincipal(PLATEFORME))
    accorder(monde, B, Environment.PROD, GroupPrincipal("finance-createurs"))
    return monde


# Environnements où chaque profil peut déployer dans A, avec les accords ci-dessus.
DROITS = [
    (LECTEUR_GROUPE, set()),
    (LECTEUR_PERSONNE, set()),
    (CREATEUR_GROUPE, {"DEV"}),
    (CREATEUR_PERSONNE, {"TEST"}),
    (ADMIN_GROUPE, {"PROD"}),
    (ADMIN_PERSONNE, set()),
    (PLATEFORME_SEULE, set()),
    (PLATEFORME_LECTEUR, set()),
]


@pytest.mark.parametrize(
    "profil,permis", DROITS, ids=lambda v: v.nom if isinstance(v, Profil) else ""
)
@pytest.mark.parametrize("methode", ["POST", "GET"])
def test_garde_par_profil(
    accords_poses: Monde,
    essai: tuple[Essai, TestClient],
    profil: Profil,
    permis: set[str],
    methode: str,
) -> None:
    application, client = essai
    for code in ("DEV", "TEST", "PROD"):
        obtenu = appeler(accords_poses, client, profil, A, code, methode)
        if code in permis:
            assert obtenu == (200, {"space": A, "environment": code})
        else:
            assert obtenu == (403, sans_droit(code)), (profil.nom, code)
    assert application.passages == [(A, code) for code in ("DEV", "TEST", "PROD") if code in permis]


@pytest.mark.parametrize(
    "profil", [NON_MEMBRE, ADMIN_B, CREATEUR_GROUPE, PLATEFORME_SEULE], ids=lambda p: p.nom
)
def test_espace_introuvable_avant_l_environnement(
    accords_poses: Monde, essai: tuple[Essai, TestClient], profil: Profil
) -> None:
    """Un non-membre, un espace inconnu ou hors format : 404, quel que soit l'environnement,
    valide ou non. Rien ne distingue l'un de l'autre."""
    application, client = essai
    designations = ["inconnu", "Finance", "a" * 41, "fin_ance"]
    if profil in (NON_MEMBRE, ADMIN_B):
        designations.append(A)
    if profil is CREATEUR_GROUPE:
        # Membre de A seulement : B lui est introuvable, malgré l'accord de B à son groupe.
        designations.append(B)
    for designation in designations:
        for code in ("DEV", "PROD", *CODES_INVALIDES):
            assert appeler(accords_poses, client, profil, designation, code) == (404, INTROUVABLE)
    assert application.passages == []


@pytest.mark.parametrize(
    "profil", [CREATEUR_GROUPE, LECTEUR_GROUPE, PLATEFORME_SEULE], ids=lambda p: p.nom
)
def test_environnement_hors_des_trois(
    accords_poses: Monde, essai: tuple[Essai, TestClient], profil: Profil
) -> None:
    application, client = essai
    for code in CODES_INVALIDES:
        for methode in ("POST", "GET"):
            obtenu = appeler(accords_poses, client, profil, A, code, methode)
            assert obtenu == (400, ENVIRONNEMENT_INVALIDE), code
    assert application.passages == []


def test_designations_encodees_valent_les_codes(
    accords_poses: Monde, essai: tuple[Essai, TestClient]
) -> None:
    """`%44EV` est décodé en `DEV` avant la décision, comme l'identifiant d'espace."""
    _, client = essai
    assert appeler(accords_poses, client, CREATEUR_GROUPE, A, "%44EV") == (
        200,
        {"space": A, "environment": "DEV"},
    )
    assert appeler(accords_poses, client, CREATEUR_GROUPE, "%66inance", "PROD") == (
        403,
        sans_droit("PROD"),
    )


def test_sans_session(accords_poses: Monde, essai: tuple[Essai, TestClient]) -> None:
    application, client = essai
    for code in ("DEV", "QA"):
        statut, corps = appeler(accords_poses, client, None, A, code)
        assert statut == 401
        assert corps["error"]["code"] == "unauthenticated"
    assert application.passages == []


def test_ecriture_hors_origine(accords_poses: Monde, essai: tuple[Essai, TestClient]) -> None:
    application, client = essai
    reponse = client.post(
        f"/api/spaces/{A}/environments/DEV/essai",
        headers={
            "Cookie": f"{COOKIE}={accords_poses.session(CREATEUR_GROUPE)}",
            "Origin": "https://autre.example.invalid",
        },
    )
    assert (reponse.status_code, reponse.json()) == (403, {"error": {"code": "origin_refused"}})
    assert application.passages == []


def test_refus_des_la_requete_apres_revocation(
    monde: Monde, essai: tuple[Essai, TestClient]
) -> None:
    _, client = essai
    accord = accorder(monde, A, Environment.PROD, GroupPrincipal("finance-createurs"))
    assert appeler(monde, client, CREATEUR_GROUPE, A, "PROD")[0] == 200
    retrait = monde.requete(ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/deploy-grants/{accord}")
    assert retrait.status_code == 204
    # Même session, requête suivante : refusée.
    assert appeler(monde, client, CREATEUR_GROUPE, A, "PROD") == (403, sans_droit("PROD"))


def test_refus_des_la_requete_apres_retrait_du_role(
    monde: Monde, essai: tuple[Essai, TestClient]
) -> None:
    """La liaison retirée fait tomber le droit même si l'accord reste (V3, V5)."""
    _, client = essai
    accorder(monde, A, Environment.TEST, CREATEUR_PERSONNE.ref)
    assert appeler(monde, client, CREATEUR_PERSONNE, A, "TEST")[0] == 200
    retrait = monde.requete(
        ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/members/{monde.liaisons['a-cyril']}"
    )
    assert retrait.status_code == 204
    assert appeler(monde, client, CREATEUR_PERSONNE, A, "TEST") == (404, INTROUVABLE)
    # Rabaissé à lecteur plutôt que retiré : membre, mais sans droit.
    lecteur = {
        "principal": {"kind": "person", "issuer": CREATEUR_PERSONNE.ref.issuer, "subject": "cyril"},
        "role": "reader",
    }
    assert monde.requete(ADMIN_GROUPE, "POST", f"/api/spaces/{A}/members", corps=lecteur).is_success
    assert appeler(monde, client, CREATEUR_PERSONNE, A, "TEST") == (403, sans_droit("TEST"))
    assert len(monde.magasin.grants(A)) == 1


def test_droit_accorde_vaut_a_la_requete_suivante(
    monde: Monde, essai: tuple[Essai, TestClient]
) -> None:
    _, client = essai
    assert appeler(monde, client, ADMIN_PERSONNE, A, "PROD") == (403, sans_droit("PROD"))
    # L'administrateur s'accorde lui-même le droit : il le peut, et le journal le montre (V4).
    pose = monde.requete(
        ADMIN_PERSONNE,
        "POST",
        f"/api/spaces/{A}/deploy-grants",
        corps={
            "environment": "PROD",
            "principal": {"kind": "person", "issuer": ADMIN_PERSONNE.ref.issuer, "subject": "axel"},
        },
    )
    assert pose.status_code == 200
    assert appeler(monde, client, ADMIN_PERSONNE, A, "PROD")[0] == 200
    assert appeler(monde, client, ADMIN_PERSONNE, A, "DEV") == (403, sans_droit("DEV"))
    [dernier, *_] = monde.requete(ADMIN_GROUPE, "GET", f"/api/spaces/{A}/events").json()["events"]
    assert dernier["action"] == "deploy_granted"
    assert dernier["actor"]["subject"] == "axel"


# --- Mode local (V8). ----------------------------------------------------------------------


@pytest.fixture
def local() -> Iterator[tuple[Essai, TestClient]]:
    instant = datetime(2026, 11, 2, 8, tzinfo=UTC)
    application = Essai(Spaces.local("skifer-atlas", lambda: instant), None)
    with TestClient(
        application.app,
        base_url="http://127.0.0.1:8000",
        headers={"Origin": "http://127.0.0.1:5173"},
        raise_server_exceptions=False,
    ) as client:
        yield application, client


def test_mode_local_deploie_dans_les_trois(local: tuple[Essai, TestClient]) -> None:
    application, client = local
    for methode in ("POST", "GET"):
        for code in ("DEV", "TEST", "PROD"):
            reponse = client.request(methode, f"/api/spaces/local/environments/{code}/essai")
            assert (reponse.status_code, reponse.json()) == (
                200,
                {"space": "local", "environment": code},
            )
    assert len(application.passages) == 6


def test_mode_local_refus(local: tuple[Essai, TestClient]) -> None:
    application, client = local
    for code in CODES_INVALIDES:
        reponse = client.post(f"/api/spaces/local/environments/{code}/essai")
        assert (reponse.status_code, reponse.json()) == (400, ENVIRONNEMENT_INVALIDE), code
    for designation in ("autre", "Local", "finance"):
        for code in ("DEV", "QA"):
            reponse = client.post(f"/api/spaces/{designation}/environments/{code}/essai")
            assert (reponse.status_code, reponse.json()) == (404, INTROUVABLE)
    # Hors de la boucle locale, l'écriture est refusée avant la garde.
    reponse = client.post(
        "/api/spaces/local/environments/DEV/essai", headers={"Origin": "https://autre.example"}
    )
    assert (reponse.status_code, reponse.json()) == (403, {"error": {"code": "origin_refused"}})
    assert application.passages == []
