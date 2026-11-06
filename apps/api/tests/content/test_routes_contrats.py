"""Exemples de contrat des routes des analyses, produits par le serveur réel (plan 18.2 et 18.3).

Chaque route et chaque refus a son exemple sous `contracts/analyses/routes/`. Les identifiants
d'analyse et les empreintes de commit, différents à chaque exécution, y sont remplacés par
`<uuid>` et `<commit>` ; tout le reste est comparé tel quel. Pour réécrire les exemples après un
changement voulu du contrat : `BOARD_REGENERER_CONTRATS=1 uv run pytest tests/content`.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx2 import Response
from skifer_board.catalog import CatalogService
from skifer_board.content.events import UsageEvents
from skifer_board.content.web import Consumer
from skifer_board.server import create_app
from spaces.monde import (
    ADMIN_GROUPE,
    CREATEUR_GROUPE,
    CREATEUR_PERSONNE,
    LECTEUR_GROUPE,
    PLATEFORME_SEULE,
    A,
)
from sqlalchemy.exc import OperationalError

from .monde import init, new_id, repository
from .serveur import CHEMIN, Banc, corps

CONTRATS = Path(__file__).resolve().parents[4] / "contracts/analyses/routes"
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
COMMIT = re.compile(r"[0-9a-f]{40}")


def normaliser(valeur: Any) -> Any:
    if isinstance(valeur, dict):
        return {cle: normaliser(item) for cle, item in valeur.items()}
    if isinstance(valeur, list):
        return [normaliser(item) for item in valeur]
    if isinstance(valeur, str):
        if UUID.fullmatch(valeur):
            return "<uuid>"
        if COMMIT.fullmatch(valeur):
            return "<commit>"
    return valeur


def contrat(reponse: Response, nom: str, statut: int | None = None) -> None:
    obtenu = {
        "status": reponse.status_code,
        "body": normaliser(reponse.json()) if reponse.content else None,
    }
    if statut is not None:
        assert reponse.status_code == statut, reponse.text
    chemin = CONTRATS / f"{nom}.json"
    if os.environ.get("BOARD_REGENERER_CONTRATS"):
        CONTRATS.mkdir(parents=True, exist_ok=True)
        chemin.write_text(json.dumps(obtenu, separators=(",", ":"), ensure_ascii=False))
    assert obtenu == json.loads(chemin.read_text(encoding="utf-8")), nom


def test_contrats_du_cycle_de_vie(banc: Banc) -> None:
    creee = banc.creer(CREATEUR_GROUPE, visibility="shared")
    contrat(creee, "creer", 201)
    ident = creee.json()["id"]
    contrat(banc.appel(LECTEUR_GROUPE, "GET", CHEMIN), "lister", 200)
    contrat(banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}"), "lire", 200)
    revisee = banc.reviser(ADMIN_GROUPE, ident, 1, visibility="shared", name="Révisée")
    contrat(revisee, "reviser", 201)
    contrat(
        banc.reviser(ADMIN_GROUPE, ident, 2, visibility="shared", name="Révisée"),
        "reviser-identique",
        200,
    )
    contrat(banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions"), "historique", 200)
    contrat(banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions/1"), "revision", 200)
    contrat(
        banc.appel(
            LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/diff", params={"base": "1", "other": "2"}
        ),
        "ecart",
        200,
    )
    contrat(banc.appel(CREATEUR_PERSONNE, "POST", f"{CHEMIN}/{ident}/duplicate"), "dupliquer", 201)
    contrat(
        banc.appel(
            CREATEUR_PERSONNE,
            "POST",
            f"{CHEMIN}/{ident}/duplicate",
            json={"name": "Copie nommée"},
        ),
        "dupliquer-nommee",
        201,
    )
    suppression = banc.appel(
        CREATEUR_GROUPE, "DELETE", f"{CHEMIN}/{ident}", params={"expected_revision": "2"}
    )
    contrat(suppression, "supprimer", 204)
    contrat(
        banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions"),
        "historique-supprimee",
        200,
    )
    contrat(
        banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions/1"),
        "revision-supprimee",
        200,
    )


def test_contrats_des_refus(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    invalide = corps()
    invalide["query"]["model"] = "ghost"
    invalide["query"]["metrics"] = ["revenue", "ghost"]
    contrat(
        banc.appel(CREATEUR_GROUPE, "POST", CHEMIN, json=invalide), "refus-analyse-invalide", 422
    )
    reservee = {**corps(), "owner": {"issuer": "x", "subject": "y"}}
    contrat(banc.appel(CREATEUR_GROUPE, "POST", CHEMIN, json=reservee), "refus-champ-reserve", 422)
    contrat(
        banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{new_id()}"), "refus-analyse-inconnue", 404
    )
    banc.reviser(ADMIN_GROUPE, ident, 1, visibility="shared", name="Deux")
    contrat(
        banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="shared", name="Trois"),
        "refus-revision-conflit",
        409,
    )
    contrat(banc.creer(LECTEUR_GROUPE), "refus-interdit", 403)
    contrat(banc.creer(PLATEFORME_SEULE), "refus-sans-role", 403)
    contrat(
        banc.reviser(CREATEUR_PERSONNE, ident, 2, visibility="shared", name="Quatre"),
        "refus-pas-proprietaire",
        403,
    )
    sans_attendue = banc.appel(
        CREATEUR_GROUPE, "POST", f"{CHEMIN}/{ident}/revisions", json=corps(visibility="shared")
    )
    contrat(sans_attendue, "refus-revision-attendue", 400)
    contrat(
        banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions/0"),
        "refus-numero-invalide",
        400,
    )
    contrat(
        banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/diff", params={"base": "1"}),
        "refus-ecart-invalide",
        400,
    )
    banc.consommateurs.append(Consumer("dashboard", new_id()))
    utilisee = banc.appel(
        CREATEUR_GROUPE, "DELETE", f"{CHEMIN}/{ident}", params={"expected_revision": "2"}
    )
    contrat(utilisee, "refus-analyse-utilisee", 409)
    banc.consommateurs.clear()


def test_contrats_des_etats_de_lecture(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    courante = banc.depot.read(A, ident).document
    banc.depot.write(
        A,
        ident,
        {**courante, "name": "Écrite hors index"},
        expected_revision=1,
        actor=CREATEUR_GROUPE.ref,
    )
    contrat(banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}"), "lire-index-perime", 200)
    contrat(banc.appel(LECTEUR_GROUPE, "GET", CHEMIN), "lister-index-perime", 200)
    # L'écart d'index l'emporte sur les deux autres états : chacun a donc sa propre analyse,
    # écrite par l'API, dont l'index est à jour.
    resolue = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    verifiee = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    banc.redefinir(["orders"], ["region"])
    contrat(banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{resolue}"), "lire-non-resolue", 200)
    (banc.dossier_modeles / "semantic_catalog.yaml").unlink()
    contrat(banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{verifiee}"), "lire-non-verifiee", 200)
    contrat(banc.creer(CREATEUR_GROUPE), "refus-moteur-indisponible", 503)


def test_contrat_depot_indisponible(banc_sans_depot: Banc) -> None:
    contrat(banc_sans_depot.creer(CREATEUR_GROUPE), "refus-depot-indisponible", 503)


def test_contrat_mode_local(service: CatalogService, tmp_path: Path) -> None:
    app = create_app(service, content_repository=repository(init(tmp_path / "contenus")))
    with TestClient(app, base_url="http://127.0.0.1", raise_server_exceptions=False) as client:
        contrat(client.get("/api/spaces/local/analyses"), "refus-mode-local", 409)


def test_contrats_des_revisions_masquees(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, name="Brouillon", visibility="personal")
    banc.reviser(CREATEUR_GROUPE, ident, 1, name="Publiée", visibility="shared")
    contrat(
        banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions"),
        "historique-revision-masquee",
        200,
    )
    contrat(
        banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions/1"),
        "refus-revision-masquee",
        404,
    )
    contrat(
        banc.appel(
            LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/diff", params={"base": "1", "other": "2"}
        ),
        "refus-ecart-revision-masquee",
        404,
    )
    contrat(
        banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions"),
        "historique-proprietaire",
        200,
    )


def masquer_execution(reponse: Response, nom: str, statut: int) -> None:
    """L'état d'une exécution acceptée dépend de la course avec son worker : il n'est pas figé."""
    corps_ = reponse.json()
    assert reponse.status_code == statut
    for champ in ("state", "started_at"):
        corps_[champ] = f"<{champ}>"
    obtenu = {"status": reponse.status_code, "body": normaliser(corps_)}
    chemin = CONTRATS / f"{nom}.json"
    if os.environ.get("BOARD_REGENERER_CONTRATS"):
        chemin.write_text(json.dumps(obtenu, separators=(",", ":"), ensure_ascii=False))
    assert obtenu == json.loads(chemin.read_text(encoding="utf-8")), nom


def test_contrats_de_la_reference_et_des_evenements(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    executions = f"/api/spaces/{A}/executions"
    requete = {
        "connection": "finance",
        "environment": "DEV",
        "model": "sales",
        "metrics": ["revenue"],
        "dimensions": [],
        "filters": [],
    }

    def soumettre(**changes: Any) -> Response:
        return banc.appel(LECTEUR_GROUPE, "POST", executions, json={**requete, **changes})

    masquer_execution(
        soumettre(analysis={"id": ident, "revision": 1}), "executer-avec-reference", 202
    )
    contrat(soumettre(analysis={"id": new_id(), "revision": 1}), "refus-reference-introuvable", 404)
    contrat(
        soumettre(analysis={"id": ident, "revision": 1}, model="autre"),
        "refus-reference-modele",
        422,
    )
    contrat(soumettre(analysis={"id": ident, "revision": 0}), "refus-reference-invalide", 400)
    ouverture = {"event_id": "9d1c6f1e-5e0b-4c58-8b43-0d3f6a1c7e55", "revision": 1}
    chemin = f"{CHEMIN}/{ident}/opened"
    contrat(banc.appel(LECTEUR_GROUPE, "POST", chemin, json=ouverture), "ouvrir", 202)
    contrat(banc.appel(LECTEUR_GROUPE, "POST", chemin, json={}), "refus-ouverture-invalide", 400)
    contrat(
        banc.appel(LECTEUR_GROUPE, "POST", chemin, json={**ouverture, "revision": 9}),
        "refus-ouverture-introuvable",
        404,
    )
    contrat(banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/usage"), "usage", 200)
    contrat(
        banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{new_id()}/usage"),
        "refus-usage-introuvable",
        404,
    )


def test_contrat_d_un_evenement_non_enregistre(banc: Banc, monkeypatch: pytest.MonkeyPatch) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")

    def panne(*_: Any, **__: Any) -> None:
        raise OperationalError("INSERT", {}, Exception("hors ligne"))

    monkeypatch.setattr(UsageEvents, "record", panne)
    contrat(
        banc.appel(
            LECTEUR_GROUPE,
            "POST",
            f"{CHEMIN}/{ident}/opened",
            json={"event_id": "9d1c6f1e-5e0b-4c58-8b43-0d3f6a1c7e55", "revision": 1},
        ),
        "ouvrir-non-enregistree",
        202,
    )


def test_contrat_d_une_reference_sans_depot(banc_sans_depot: Banc) -> None:
    reponse = banc_sans_depot.appel(
        LECTEUR_GROUPE,
        "POST",
        f"/api/spaces/{A}/executions",
        json={
            "connection": "finance",
            "environment": "DEV",
            "model": "sales",
            "metrics": ["revenue"],
            "dimensions": [],
            "filters": [],
            "analysis": {"id": new_id(), "revision": 1},
        },
    )
    contrat(reponse, "refus-reference-depot-indisponible", 503)
