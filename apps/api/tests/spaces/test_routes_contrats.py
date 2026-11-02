"""Chaque exemple de `contracts/espaces/` est produit par le serveur réel (plan 08, 8.2 ;
plan 09, 9.2).

Base migrée, fournisseur OIDC simulé, horloge réglée sur les instants des exemples : les
réponses sont comparées exactement, sauf les identifiants de liaison, tirés au hasard (ils
doivent être des UUID), et l'instant et le dépôt de l'espace local, propres au poste. Les
refus sont comparés à l'identique.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from catalog.conftest import espace as espace
from catalog.conftest import service as service
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
from sqlalchemy import Engine
from state.conftest import migre as migre

from spaces.monde import ORIGINE, PLATEFORME, espaces_en_base

CONTRATS = Path(__file__).resolve().parents[4] / "contracts" / "espaces"
ATTENDUS = {
    "accord",
    "accord-inconnu",
    "accords",
    "creation",
    "dernier-administrateur",
    "environnement-invalide",
    "espace",
    "espace-existant",
    "interdit",
    "introuvable",
    "journal",
    "journal-accords",
    "liaison",
    "liaison-inconnue",
    "liste",
    "liste-administration",
    "liste-locale",
    "membres",
    "mode-local",
    "personne-inconnue",
    "personnes",
    "recherche-invalide",
    "requete-invalide",
    "retrait",
    "retrait-accord",
}
PLATEFORME_SUJET = "00u1a2b3c4"
DOMINIQUE = "00u5d6e7f8"
JOUR = datetime(2026, 11, 2, tzinfo=UTC)


def a(heure: int, minute: int = 0) -> datetime:
    return JOUR + timedelta(hours=heure, minutes=minute)


def structure(valeur: object) -> object:
    if isinstance(valeur, dict):
        return {cle: structure(contenu) for cle, contenu in valeur.items()}
    if isinstance(valeur, list):
        return [structure(contenu) for contenu in valeur]
    return type(valeur)


def est_uuid(texte: str) -> bool:
    try:
        return str(uuid.UUID(texte)) == texte
    except ValueError:
        return False


def comparer(obtenu: object, attendu: object, chemin: str = "body") -> None:
    """Égalité exacte, sauf les identifiants de liaison, qui doivent être des UUID."""
    assert type(obtenu) is type(attendu), chemin
    if isinstance(attendu, dict):
        assert isinstance(obtenu, dict)
        assert obtenu.keys() == attendu.keys(), chemin
        for cle in attendu:
            comparer(obtenu[cle], attendu[cle], f"{chemin}.{cle}")
    elif isinstance(attendu, list):
        assert isinstance(obtenu, list)
        assert len(obtenu) == len(attendu), chemin
        for indice, (valeur, reference) in enumerate(zip(obtenu, attendu, strict=True)):
            comparer(valeur, reference, f"{chemin}[{indice}]")
    elif chemin.endswith(".id") and isinstance(attendu, str) and est_uuid(attendu):
        assert isinstance(obtenu, str)
        assert str(uuid.UUID(obtenu)) == obtenu, chemin
    else:
        assert obtenu == attendu, chemin


class Scenario:
    """Personnes connectées par le fournisseur simulé, chacune dans son navigateur."""

    def __init__(
        self,
        app: Any,
        fournisseur: Fournisseur,
        cles: Cles,
        claims: dict[str, Any],
        horloge: Horloge,
    ) -> None:
        self.app, self.fournisseur, self.cles = app, fournisseur, cles
        self.claims, self.horloge = claims, horloge
        self.navigateurs: dict[str, TestClient] = {}

    def connecter(
        self, nom: str, sujet: str, groupes: list[str], affiche: str, adresse: str
    ) -> None:
        client = TestClient(self.app, base_url=ORIGINE, follow_redirects=False)
        client.__enter__()
        instant = self.horloge().timestamp()
        connecter(
            client,
            self.fournisseur,
            self.cles,
            {
                **self.claims,
                "sub": sujet,
                "groups": groupes,
                "name": affiche,
                "email": adresse,
                "iat": instant - 60,
                "exp": instant + 60,
            },
        )
        self.navigateurs[nom] = client

    def appel(self, nom: str, methode: str, chemin: str, corps: object = None) -> Response:
        return self.navigateurs[nom].request(
            methode, chemin, json=corps, headers={"Origin": ORIGINE}
        )

    def fermer(self) -> None:
        for client in self.navigateurs.values():
            client.__exit__(None, None, None)


@pytest.fixture
def reponses(
    service: CatalogService,
    config: OidcConfig,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
    horloge: Horloge,
    migre: Engine,
) -> Iterator[dict[str, Response]]:
    configuree = replace(config, admin_group=PLATEFORME, session_idle=timedelta(hours=8))
    runtime = build_runtime(
        configuree, fournisseur, horloge, on_login=SpaceStore(migre).record_login
    )
    app = create_app(service, runtime, espaces_en_base(migre, horloge))
    scenario = Scenario(app, fournisseur, cles, claims, horloge)
    obtenues: dict[str, Response] = {}
    try:
        horloge.instant = a(8, 40)
        scenario.connecter(
            "plateforme",
            PLATEFORME_SUJET,
            [PLATEFORME],
            # Personne de l'exemple d'identité (`contracts/identite/me-etabli.json`) : les
            # exemples des liaisons et du journal la nomment comme auteur (plan 08, 8.4).
            "Camille Martin",
            "camille.martin@example.invalid",
        )
        horloge.instant = a(8, 45)
        scenario.connecter(
            "dominique", DOMINIQUE, [], "Dominique Leroy", "dominique.leroy@example.invalid"
        )
        horloge.instant = a(8, 50)
        scenario.connecter("admin", "00u9admin", ["finance-admins"], "Alix", "alix@ex.invalid")
        scenario.connecter(
            "membre", "00u9membre", ["finance-createurs", "rh-lecteurs"], "Max", "max@ex.invalid"
        )

        horloge.instant = a(9)
        finance = {
            "id": "finance",
            "name": "Finance",
            "first_admin": {"kind": "group", "name": "finance-admins"},
        }
        obtenues["creation"] = scenario.appel("plateforme", "POST", "/api/spaces", finance)
        obtenues["liste-administration"] = scenario.appel("plateforme", "GET", "/api/spaces")
        obtenues["espace"] = scenario.appel("admin", "GET", "/api/spaces/finance")
        obtenues["espace-existant"] = scenario.appel("plateforme", "POST", "/api/spaces", finance)
        obtenues["requete-invalide"] = scenario.appel(
            "plateforme",
            "POST",
            "/api/spaces",
            {**finance, "id": "autre", "first_admin": {"kind": "robot"}},
        )

        horloge.instant = a(9, 15)
        dominique = {"kind": "person", "issuer": claims["iss"], "subject": DOMINIQUE}
        obtenues["liaison"] = scenario.appel(
            "plateforme",
            "POST",
            "/api/spaces/finance/members",
            {"principal": dominique, "role": "reader"},
        )
        obtenues["membres"] = scenario.appel("admin", "GET", "/api/spaces/finance/members")
        obtenues["journal"] = scenario.appel("admin", "GET", "/api/spaces/finance/events")
        obtenues["interdit"] = scenario.appel("dominique", "GET", "/api/spaces/finance/members")
        obtenues["personnes"] = scenario.appel("admin", "GET", "/api/people?q=dominique")
        obtenues["recherche-invalide"] = scenario.appel("admin", "GET", "/api/people")
        obtenues["personne-inconnue"] = scenario.appel(
            "admin",
            "POST",
            "/api/spaces/finance/members",
            {"principal": {**dominique, "subject": "jamais-connecte"}, "role": "reader"},
        )
        obtenues["liaison-inconnue"] = scenario.appel(
            "admin", "DELETE", "/api/spaces/finance/members/5b0e4c1e-0000-4000-8000-000000000000"
        )
        [administrateurs] = [
            m["id"]
            for m in obtenues["membres"].json()["members"]
            if m["principal"] == {"kind": "group", "name": "finance-admins"}
        ]
        obtenues["dernier-administrateur"] = scenario.appel(
            "admin", "DELETE", f"/api/spaces/finance/members/{administrateurs}"
        )

        # Accords du droit de déployer (plan 09, 9.2). Dominique n'est que lectrice : son
        # accord reste sans effet (V3), et survit au retrait de sa liaison (V5).
        horloge.instant = a(9, 30)
        obtenues["accord"] = scenario.appel(
            "plateforme",
            "POST",
            "/api/spaces/finance/deploy-grants",
            {"environment": "TEST", "principal": dominique},
        )
        horloge.instant = a(9, 45)
        createurs = {"kind": "group", "name": "finance-createurs"}
        pose = scenario.appel(
            "plateforme",
            "POST",
            "/api/spaces/finance/deploy-grants",
            {"environment": "DEV", "principal": createurs},
        )
        assert pose.status_code == 200
        # Un administrateur s'accorde lui-même un droit, puis le retire : le journal le dit (V4).
        horloge.instant = a(9, 50)
        pose = scenario.appel(
            "admin",
            "POST",
            "/api/spaces/finance/deploy-grants",
            {"environment": "PROD", "principal": {"kind": "group", "name": "finance-admins"}},
        )
        assert pose.status_code == 200
        horloge.instant = a(9, 55)
        obtenues["retrait-accord"] = scenario.appel(
            "admin", "DELETE", f"/api/spaces/finance/deploy-grants/{pose.json()['id']}"
        )
        obtenues["accords"] = scenario.appel("admin", "GET", "/api/spaces/finance/deploy-grants")
        obtenues["journal-accords"] = scenario.appel("admin", "GET", "/api/spaces/finance/events")
        obtenues["accord-inconnu"] = scenario.appel(
            "admin",
            "DELETE",
            "/api/spaces/finance/deploy-grants/5b0e4c1e-0000-4000-8000-000000000000",
        )
        obtenues["environnement-invalide"] = scenario.appel(
            "admin",
            "POST",
            "/api/spaces/finance/deploy-grants",
            {"environment": "QA", "principal": createurs},
        )

        horloge.instant = a(10)
        rh = {
            "id": "rh",
            "name": "Ressources humaines",
            "first_admin": {"kind": "group", "name": "rh-admins"},
        }
        assert scenario.appel("plateforme", "POST", "/api/spaces", rh).status_code == 201
        for espace_id, groupe, role in (
            ("finance", "finance-createurs", "creator"),
            ("rh", "rh-lecteurs", "reader"),
        ):
            pose = scenario.appel(
                "plateforme",
                "POST",
                f"/api/spaces/{espace_id}/members",
                {"principal": {"kind": "group", "name": groupe}, "role": role},
            )
            assert pose.status_code == 200
        obtenues["introuvable"] = scenario.appel("dominique", "GET", "/api/spaces/rh")
        obtenues["liste"] = scenario.appel("membre", "GET", "/api/spaces")
        obtenues["retrait"] = scenario.appel(
            "admin", "DELETE", f"/api/spaces/finance/members/{obtenues['liaison'].json()['id']}"
        )

        with TestClient(
            create_app(service),
            base_url="http://127.0.0.1:8000",
            headers={"Origin": "http://127.0.0.1:5173"},
        ) as local:
            obtenues["liste-locale"] = local.get("/api/spaces")
            obtenues["mode-local"] = local.post(
                "/api/spaces/local/members",
                json={"principal": {"kind": "group", "name": "g"}, "role": "reader"},
            )
        yield obtenues
    finally:
        scenario.fermer()


def test_ensemble_des_exemples() -> None:
    assert {p.stem for p in CONTRATS.glob("*.json")} == ATTENDUS
    assert {p.name for p in CONTRATS.iterdir()} == {f"{nom}.json" for nom in ATTENDUS}


def test_exemples_produits_par_le_serveur(
    reponses: dict[str, Response], subtests: pytest.Subtests
) -> None:
    """Un seul scénario, rejoué une fois ; chaque exemple est un sous-test."""
    assert reponses.keys() == ATTENDUS
    for nom in sorted(ATTENDUS):
        with subtests.test(msg=nom):
            verifier_exemple(nom, reponses[nom])


def verifier_exemple(nom: str, reponse: Response) -> None:
    attendu = json.loads((CONTRATS / f"{nom}.json").read_text(encoding="utf-8"))
    assert set(attendu) == {"status", "body"}
    assert reponse.status_code == attendu["status"]
    if attendu["body"] is None:
        assert reponse.status_code == 204
        assert reponse.content == b""
        return
    obtenu = reponse.json()
    assert structure(obtenu) == structure(attendu["body"])
    if attendu["status"] >= 400:
        assert obtenu == attendu["body"]
    elif nom == "liste-locale":
        [local] = obtenu["spaces"]
        assert {**local, "created_at": "", "atlas": ""} == {
            **attendu["body"]["spaces"][0],
            "created_at": "",
            "atlas": "",
        }
    else:
        comparer(obtenu, attendu["body"])
