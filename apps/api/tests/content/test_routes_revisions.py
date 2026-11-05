"""Visibilité révision par révision (plan 18.2, A5) : lecture d'une révision, écart et historique.

Une révision qui a été personnelle n'est servie qu'à son propriétaire, administrateur de l'espace
compris, même si l'analyse a été partagée depuis ; l'inverse aussi : une analyse devenue
personnelle disparaît pour tout autre. Pour un non-propriétaire, une révision masquée répond comme
une révision inexistante, et l'historique n'en donne aucune métadonnée.
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx2 import Response
from skifer_board.spaces.model import PersonRef
from spaces.monde import (
    ADMIN_GROUPE,
    ADMIN_PERSONNE,
    CREATEUR_GROUPE,
    CREATEUR_PERSONNE,
    LECTEUR_GROUPE,
    LECTEUR_PERSONNE,
    PLATEFORME_LECTEUR,
    A,
    Profil,
)

from .monde import repository
from .serveur import CHEMIN, Banc

SECRET = "Brouillon avant publication"
PUBLIC = "Version publiee"
AUTRES = [
    ADMIN_GROUPE,
    ADMIN_PERSONNE,
    LECTEUR_GROUPE,
    LECTEUR_PERSONNE,
    CREATEUR_PERSONNE,
    PLATEFORME_LECTEUR,
]
PROPRIETAIRE = PersonRef.of(CREATEUR_GROUPE.identite)
MASQUEE = {"revision": 1, "available": False}


def personnelle_puis_partagee(banc: Banc) -> str:
    """Révision 1 personnelle (secrète), puis 2 et 3 partagées."""
    ident = banc.creer_ok(CREATEUR_GROUPE, name=SECRET, visibility="personal")
    assert (
        banc.reviser(CREATEUR_GROUPE, ident, 1, name=PUBLIC, visibility="shared").status_code == 201
    )
    suite = banc.reviser(CREATEUR_GROUPE, ident, 2, name=f"{PUBLIC} bis", visibility="shared")
    assert suite.status_code == 201
    return ident


def partagee_puis_personnelle(banc: Banc) -> str:
    """Révision 1 partagée, puis 2 personnelle : l'analyse est retirée du partage."""
    ident = banc.creer_ok(CREATEUR_GROUPE, name=PUBLIC, visibility="shared")
    retiree = banc.reviser(CREATEUR_GROUPE, ident, 1, name=SECRET, visibility="personal")
    assert retiree.status_code == 201
    return ident


def lire(banc: Banc, profil: Profil, ident: str, suite: str, **params: str) -> Response:
    return banc.appel(profil, "GET", f"{CHEMIN}/{ident}{suite}", params=params)


def ecart(banc: Banc, profil: Profil, ident: str, base: int, autre: int) -> Response:
    return lire(banc, profil, ident, "/diff", base=str(base), other=str(autre))


def identique_a_inexistante(reponse: Response, inexistante: Response) -> None:
    assert reponse.status_code == inexistante.status_code == 404
    assert reponse.json() == inexistante.json() == {"error": {"code": "analysis_not_found"}}
    assert reponse.headers.get("content-type") == inexistante.headers.get("content-type")


def test_le_proprietaire_voit_toutes_ses_revisions(banc: Banc) -> None:
    ident = personnelle_puis_partagee(banc)
    historique = lire(banc, CREATEUR_GROUPE, ident, "/revisions").json()
    assert [item["revision"] for item in historique["revisions"]] == [1, 2, 3]
    assert all(item["available"] is True for item in historique["revisions"])
    assert [item["actor"]["subject"] for item in historique["revisions"]] == ["cora"] * 3
    un = lire(banc, CREATEUR_GROUPE, ident, "/revisions/1")
    assert un.status_code == 200 and un.json()["analysis"]["name"] == SECRET
    assert un.json()["permissions"]["owner"] is True
    changes = ecart(banc, CREATEUR_GROUPE, ident, 1, 2)
    assert changes.status_code == 200
    assert {"path": "/name", "kind": "modified", "before": SECRET, "after": PUBLIC} in (
        changes.json()["changes"]
    )


@pytest.mark.parametrize("profil", AUTRES, ids=lambda profil: profil.nom)
def test_une_revision_qui_a_ete_personnelle_n_est_servie_qu_a_son_proprietaire(
    banc: Banc, profil: Profil
) -> None:
    ident = personnelle_puis_partagee(banc)
    inexistante = lire(banc, profil, ident, "/revisions/9")
    # L'analyse partagée se lit, ses révisions partagées aussi.
    assert lire(banc, profil, ident, "").json()["analysis"]["name"] == f"{PUBLIC} bis"
    deux = lire(banc, profil, ident, "/revisions/2")
    assert deux.status_code == 200 and deux.json()["analysis"]["name"] == PUBLIC
    # La révision 1 : mêmes statut, corps et en-tête qu'une révision qui n'existe pas.
    identique_a_inexistante(lire(banc, profil, ident, "/revisions/1"), inexistante)
    # L'écart : aucun des deux côtés ne peut être une révision masquée.
    ailleurs = ecart(banc, profil, ident, 2, 9)
    for base, autre in ((1, 2), (2, 1), (1, 1), (1, 3), (3, 1)):
        identique_a_inexistante(ecart(banc, profil, ident, base, autre), ailleurs)
    visible = ecart(banc, profil, ident, 2, 3)
    assert visible.status_code == 200 and visible.json()["changes"][0]["before"] == PUBLIC
    assert ecart(banc, profil, ident, 3, 3).json()["changes"] == []


@pytest.mark.parametrize("profil", AUTRES, ids=lambda profil: profil.nom)
def test_l_historique_ne_donne_aucune_metadonnee_d_une_revision_masquee(
    banc: Banc, profil: Profil
) -> None:
    ident = personnelle_puis_partagee(banc)
    reponse = lire(banc, profil, ident, "/revisions")
    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["current_revision"] == 3 and corps["deleted"] is False
    premiere, *suite = corps["revisions"]
    # Le numéro seul : ni empreinte, ni date, ni auteur, ni action.
    assert premiere == MASQUEE
    assert [(item["revision"], item["available"]) for item in suite] == [(2, True), (3, True)]
    assert all({"commit", "committed_at", "actor", "action"} <= set(item) for item in suite)
    assert SECRET not in reponse.text


def test_une_analyse_devenue_personnelle_disparait_pour_les_autres(banc: Banc) -> None:
    ident = partagee_puis_personnelle(banc)
    for profil in AUTRES:
        inconnue = banc.appel(profil, "GET", f"{CHEMIN}/00000000-0000-4000-8000-000000000000")
        for suite in ("", "/revisions", "/revisions/1", "/revisions/2"):
            identique_a_inexistante(lire(banc, profil, ident, suite), inconnue)
        for base, autre in ((1, 1), (1, 2), (2, 2)):
            reponse = ecart(banc, profil, ident, base, autre)
            assert reponse.status_code == 404 and SECRET not in reponse.text
            assert PUBLIC not in reponse.text
    historique = lire(banc, CREATEUR_GROUPE, ident, "/revisions").json()
    assert [item["available"] for item in historique["revisions"]] == [True, True]
    assert lire(banc, CREATEUR_GROUPE, ident, "/revisions/1").json()["analysis"]["name"] == PUBLIC
    assert ecart(banc, CREATEUR_GROUPE, ident, 1, 2).status_code == 200


def test_une_analyse_supprimee_reste_celle_de_son_proprietaire(banc: Banc) -> None:
    ident = personnelle_puis_partagee(banc)
    supprimee = banc.appel(
        CREATEUR_GROUPE, "DELETE", f"{CHEMIN}/{ident}", params={"expected_revision": "3"}
    )
    assert supprimee.status_code == 204
    for profil in AUTRES:
        for suite in ("/revisions", "/revisions/1", "/revisions/2"):
            assert lire(banc, profil, ident, suite).status_code == 404
    historique = lire(banc, CREATEUR_GROUPE, ident, "/revisions").json()
    assert historique["deleted"] is True and historique["current_revision"] is None
    assert [(item["revision"], item["action"]) for item in historique["revisions"]] == [
        (1, "save"),
        (2, "save"),
        (3, "save"),
        (3, "delete"),
    ]
    assert all(item["available"] is True for item in historique["revisions"])
    assert lire(banc, CREATEUR_GROUPE, ident, "/revisions/1").json()["analysis"]["name"] == SECRET


def test_la_revision_jugee_est_celle_qui_est_servie(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Une seule lecture, d'une même tête : un changement survenu entre-temps ne substitue rien."""
    ident = personnelle_puis_partagee(banc)
    lectures = {"entries": 0}
    entries = banc.depot.entries
    ailleurs = repository(banc.racine)

    def interdite(*_: Any, **__: Any) -> Any:
        raise AssertionError("relecture après le contrôle de visibilité")

    def instantane(space_id: str, analysis_id: str) -> Any:
        lectures["entries"] += 1
        lu = entries(space_id, analysis_id)
        # L'analyse est retirée du partage juste après la lecture de l'instantané, par un autre
        # accès au dépôt (les méthodes de celui du serveur sont interdites ici).
        if lectures["entries"] == 1:
            courante = ailleurs.read(A, ident)
            retiree = {**courante.document, "visibility": "personal"}
            numero = courante.revision.number
            ailleurs.write(A, ident, retiree, expected_revision=numero, actor=PROPRIETAIRE)
        return lu

    monkeypatch.setattr(banc.depot, "read", interdite)
    monkeypatch.setattr(banc.depot, "history", interdite)
    monkeypatch.setattr(banc.depot, "diff", interdite)
    monkeypatch.setattr(banc.depot, "entries", instantane)
    # La requête en cours est servie de l'instantané qu'elle a jugé, pas d'une relecture.
    assert lire(banc, LECTEUR_GROUPE, ident, "/revisions/2").json()["analysis"]["name"] == PUBLIC
    # La suivante voit le retrait du partage.
    assert ecart(banc, LECTEUR_GROUPE, ident, 2, 3).status_code == 404
    assert lectures["entries"] == 2
