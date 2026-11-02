"""Recherche de personnes connues (plan 08, E5, 8.2) et administration de la plateforme dans
`/api/me` (E6)."""

from __future__ import annotations

from dataclasses import replace
from typing import Any

import pytest
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from fastapi.testclient import TestClient
from identity.conftest import Cles, Fournisseur, Horloge
from identity.conftest import claims as claims
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from identity.test_web import connecter
from skifer_board.catalog import CatalogService
from skifer_board.identity import OidcConfig
from skifer_board.identity.model import Identity
from skifer_board.identity.web import build_runtime
from skifer_board.server import create_app
from skifer_board.spaces import PEOPLE_LIMIT, SpaceStore
from sqlalchemy import Engine
from state.conftest import migre as migre

from spaces.monde import (
    ADMIN_B,
    ADMIN_GROUPE,
    ADMIN_PERSONNE,
    CREATEUR_GROUPE,
    CREATEUR_PERSONNE,
    EMETTEUR,
    INVITEE,
    LECTEUR_GROUPE,
    LECTEUR_PERSONNE,
    NON_MEMBRE,
    ORIGINE,
    PLATEFORME,
    PLATEFORME_LECTEUR,
    PLATEFORME_SEULE,
    PROFILS,
    Monde,
    Profil,
    espaces_en_base,
)
from spaces.monde import config_plateforme as config_plateforme
from spaces.monde import monde as monde

PARAMETRE_Q = {"error": {"code": "invalid_parameter", "parameter": "q"}}
INTERDIT_ADMIN = {"error": {"code": "forbidden", "required": "admin"}}
CLES_PERSONNE = {"issuer", "subject", "name", "email", "last_login"}


@pytest.mark.parametrize(
    "profil",
    [LECTEUR_GROUPE, LECTEUR_PERSONNE, CREATEUR_GROUPE, CREATEUR_PERSONNE, NON_MEMBRE],
    ids=lambda p: p.nom,
)
def test_recherche_refusee_a_qui_n_administre_rien(monde: Monde, profil: Profil) -> None:
    # Le refus précède la validation du paramètre : rien n'est appris sans le droit.
    for params in ({"q": "Nom"}, {"q": "ines@example"}, None, {"q": ""}, {"q": "a" * 500}):
        reponse = monde.requete(profil, "GET", "/api/people", params=params)
        assert (reponse.status_code, reponse.json()) == (403, INTERDIT_ADMIN)


@pytest.mark.parametrize(
    "profil",
    [ADMIN_GROUPE, ADMIN_PERSONNE, ADMIN_B, PLATEFORME_SEULE, PLATEFORME_LECTEUR],
    ids=lambda p: p.nom,
)
def test_recherche_permise_aux_administrateurs(monde: Monde, profil: Profil) -> None:
    reponse = monde.requete(profil, "GET", "/api/people", params={"q": "ines@EXAMPLE"})
    assert reponse.status_code == 200
    assert reponse.json() == {
        "people": [
            {
                "issuer": EMETTEUR,
                "subject": "ines",
                "name": "Nom ines",
                "email": "ines@example.invalid",
                "last_login": monde.horloge().isoformat(),
            }
        ]
    }


Q_INVALIDES: list[dict[str, str] | None] = [
    None,
    {"q": ""},
    {"q": " "},
    {"q": "   "},
    {"q": "\t"},
    {"q": "\n"},
    {"q": "a" * 201},
    {"q": "é" * 201},
    {"q": " " * 201},
    # Rognée, la recherche dépasse encore 200 caractères.
    {"q": " " + "a" * 201 + " "},
    {"q": "a" + " " * 199 + "b"},
    # Hors du domaine de la base : U+0000.
    {"q": "\x00"},
    {"q": "a\x00b"},
    {"q": " \x00 "},
]


def test_parametre_q_invalide(monde: Monde) -> None:
    for params in Q_INVALIDES:
        for profil in (ADMIN_GROUPE, PLATEFORME_SEULE):
            reponse = monde.requete(profil, "GET", "/api/people", params=params)
            assert (reponse.status_code, reponse.json()) == (400, PARAMETRE_Q), params


def test_parametre_q_a_la_limite(monde: Monde) -> None:
    for q in (
        "a" * 200,
        "é" * 200,
        "n",
        # La longueur se mesure après rognage.
        "Nom" + " " * 198,
        "  " + "a" * 200 + "  ",
        "\t" + "é" * 200 + "\n",
        " " * 500 + "n" + " " * 500,
    ):
        reponse = monde.requete(ADMIN_GROUPE, "GET", "/api/people", params={"q": q})
        assert reponse.status_code == 200, q
        assert isinstance(reponse.json()["people"], list)


def test_parametre_q_rogne_avant_la_recherche(monde: Monde) -> None:
    """Les blancs autour de la recherche ne comptent pas : sans rognage, aucune adresse ne
    contiendrait `  ines@example.invalid  `."""
    for q in ("  ines@EXAMPLE.invalid  ", "\tNom ines\n", " ines@example.invalid"):
        reponse = monde.requete(ADMIN_GROUPE, "GET", "/api/people", params={"q": q})
        assert reponse.status_code == 200
        trouves = [(p["issuer"], p["subject"], p["email"]) for p in reponse.json()["people"]]
        assert trouves == [(EMETTEUR, INVITEE.sujet, "ines@example.invalid")], q
    # Les blancs intérieurs, eux, restent : « Nomines » ne trouve personne.
    reponse = monde.requete(ADMIN_GROUPE, "GET", "/api/people", params={"q": "Nomines"})
    assert reponse.json()["people"] == []


def test_vingt_resultats_au_plus_et_aucune_donnee_de_groupe(monde: Monde) -> None:
    for numero in range(30):
        monde.magasin.record_login(
            Identity(
                EMETTEUR,
                f"sujet-{numero:02d}",
                f"Personne {numero:02d}",
                f"personne{numero:02d}@example.invalid",
                (f"groupe-prive-{numero:02d}", "groupe-commun-secret"),
            ),
            monde.horloge(),
        )
    reponse = monde.requete(ADMIN_GROUPE, "GET", "/api/people", params={"q": "personne"})
    assert reponse.status_code == 200
    trouves = reponse.json()["people"]
    assert PEOPLE_LIMIT == 20
    assert len(trouves) == 20
    assert [p["name"] for p in trouves] == [f"Personne {n:02d}" for n in range(20)]
    for personne in trouves:
        assert set(personne) == CLES_PERSONNE
    assert "groupe" not in reponse.text
    # Toutes les personnes connues : aucun groupe d'aucun profil n'apparaît.
    tous = monde.requete(PLATEFORME_SEULE, "GET", "/api/people", params={"q": "Nom"})
    assert {p["subject"] for p in tous.json()["people"]} == {p.sujet for p in PROFILS}
    for profil in PROFILS:
        for groupe in profil.groupes:
            assert groupe not in tous.text
    assert "groups" not in tous.text


def test_recherche_sans_administration_de_la_plateforme_configuree(
    service: CatalogService,
    config: OidcConfig,
    fournisseur: Fournisseur,
    horloge: Horloge,
    migre: Engine,
) -> None:
    """Sans groupe d'administration configuré, le groupe `board-admins` ne donne rien."""
    runtime = build_runtime(config, fournisseur, horloge)
    app = create_app(service, runtime, espaces_en_base(migre, horloge, None))
    jeton = runtime.sessions.create(PLATEFORME_SEULE.identite, horloge())
    with TestClient(app, base_url=ORIGINE) as client:
        entetes = {"Cookie": f"__Host-sb_session={jeton}", "Origin": ORIGINE}
        reponse = client.get("/api/people", params={"q": "Nom"}, headers=entetes)
        assert (reponse.status_code, reponse.json()) == (403, INTERDIT_ADMIN)
        assert client.get("/api/me", headers=entetes).json()["platform_admin"] is False
        assert client.get("/api/spaces", headers=entetes).json() == {
            "spaces": [],
            "platform_admin": False,
        }
        creation = {
            "id": "nouveau",
            "name": "Nouveau",
            "first_admin": {"kind": "group", "name": PLATEFORME},
        }
        reponse = client.post("/api/spaces", json=creation, headers=entetes)
        assert (reponse.status_code, reponse.json()) == (
            403,
            {"error": {"code": "forbidden", "required": "platform_admin"}},
        )
    assert SpaceStore(migre).list_spaces() == []


# --- F. `/api/me` dit si la personne administre la plateforme (E6). -------------------------


@pytest.mark.parametrize(
    "profil,attendu",
    [
        (PLATEFORME_SEULE, True),
        (PLATEFORME_LECTEUR, True),
        (ADMIN_GROUPE, False),
        (ADMIN_PERSONNE, False),
        (LECTEUR_GROUPE, False),
        (NON_MEMBRE, False),
        (Profil("homonymes", "hugo", ("Board-Admins", "board-admins ", "board", "admins")), False),
    ],
    ids=lambda v: v.nom if isinstance(v, Profil) else str(v),
)
def test_me_administration_de_la_plateforme(monde: Monde, profil: Profil, attendu: bool) -> None:
    reponse = monde.requete(profil, "GET", "/api/me")
    assert reponse.status_code == 200
    corps = reponse.json()
    assert set(corps) == {"established", "identity", "expires_at", "platform_admin"}
    assert corps["platform_admin"] is attendu
    assert monde.requete(profil, "GET", "/api/spaces").json()["platform_admin"] is attendu


@pytest.mark.parametrize("groupe_configure", [PLATEFORME, None])
def test_me_apres_connexion_reelle(
    service: CatalogService,
    config: OidcConfig,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
    horloge: Horloge,
    migre: Engine,
    groupe_configure: str | None,
) -> None:
    configuree = replace(config, admin_group=groupe_configure)
    runtime = build_runtime(configuree, fournisseur, horloge)
    app = create_app(service, runtime, espaces_en_base(migre, horloge, groupe_configure))
    with TestClient(app, base_url=ORIGINE, follow_redirects=False) as client:
        connecter(client, fournisseur, cles, {**claims, "groups": [PLATEFORME, "lecteurs"]})
        corps = client.get("/api/me").json()
        assert corps["platform_admin"] is (groupe_configure is not None)
        assert corps["identity"]["groups"] == [PLATEFORME, "lecteurs"]
        client.cookies.clear()
        connecter(client, fournisseur, cles, {**claims, "sub": "autre", "groups": ["lecteurs"]})
        assert client.get("/api/me").json()["platform_admin"] is False
