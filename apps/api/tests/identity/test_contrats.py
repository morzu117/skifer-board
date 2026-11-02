"""Chaque exemple versionné conserve exactement les clés et types du serveur réel."""

import json
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from fastapi.testclient import TestClient
from skifer_board.catalog import CatalogService
from skifer_board.identity.flow import LoginRefusal
from skifer_board.identity.web import IdentityRuntime
from skifer_board.server import create_app

from identity.conftest import Cles, Fournisseur
from identity.test_web import ORIGINE, connecter
from identity.test_web import runtime as runtime

CONTRATS = Path(__file__).resolve().parents[4] / "contracts" / "identite"


def structure(valeur: object) -> object:
    if isinstance(valeur, dict):
        return {cle: structure(contenu) for cle, contenu in valeur.items()}
    if isinstance(valeur, list):
        return [structure(contenu) for contenu in valeur]
    return type(valeur)


@pytest.mark.parametrize("fichier", sorted(CONTRATS.glob("*.json")), ids=lambda p: p.stem)
def test_contrat_contre_serveur(
    fichier: Path,
    service: CatalogService,
    runtime: IdentityRuntime,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
) -> None:
    attendu = json.loads(fichier.read_text())
    assert {p.stem for p in CONTRATS.glob("*.json")} == {
        "deconnexion",
        "me-etabli",
        "me-local",
        "non-authentifie",
        "origine-refusee",
        "refus-connexion",
    }
    local = fichier.stem == "me-local"
    with TestClient(
        create_app(service, None if local else runtime), base_url=ORIGINE, follow_redirects=False
    ) as client:
        if fichier.stem == "refus-connexion":
            assert set(attendu) == {"login_error"}
            assert len(attendu["login_error"]) == len(LoginRefusal)
            assert set(attendu["login_error"]) == {refus.value for refus in LoginRefusal}
            # Chaque code est aussi exercé par un vrai callback dans test_web.
            retour = client.get("/auth/callback")
            assert retour.status_code == 303
            obtenu = parse_qs(urlsplit(retour.headers["location"]).query)
            assert set(obtenu) == set(attendu)
            return
        if fichier.stem == "me-etabli":
            connecter(client, fournisseur, cles, claims)
        if fichier.stem in ("me-etabli", "me-local", "non-authentifie"):
            reponse = client.get("/api/me")
            statut = 401 if fichier.stem == "non-authentifie" else 200
        else:
            reponse = client.post(
                "/auth/logout", headers={"Origin": ORIGINE} if fichier.stem == "deconnexion" else {}
            )
            statut = 200 if fichier.stem == "deconnexion" else 403
        assert set(attendu) == {"status", "body"}
        assert reponse.status_code == statut == attendu["status"]
        assert structure(reponse.json()) == structure(attendu["body"])
        if fichier.stem != "me-etabli":
            assert reponse.json() == attendu["body"]
