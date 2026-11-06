"""Routes des analyses sur un vrai serveur : cycle de vie, liste, historique, écart (plan 18.2)."""

from __future__ import annotations

import re
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient
from skifer_board.catalog import CatalogService
from skifer_board.content import ContentRepository
from skifer_board.content.index import AnalysisIndex
from skifer_board.content.web import Consumer
from skifer_board.execution import ConnectionStore
from skifer_board.execution.semantic import describe_catalog
from skifer_board.server import create_app
from spaces.monde import (
    ADMIN_GROUPE,
    CREATEUR_GROUPE,
    CREATEUR_PERSONNE,
    LECTEUR_GROUPE,
    A,
)
from sqlalchemy.exc import OperationalError

from .monde import commit, new_id, relative
from .serveur import CHEMIN, Banc, corps

INCONNUE = "11111111-1111-4111-8111-111111111111"
SHA = re.compile(r"[0-9a-f]{40}")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
SECRET = "valeur_confidentielle_42"


def lire(banc: Banc, ident: str, profil: Any = CREATEUR_GROUPE) -> dict[str, Any]:
    reponse = banc.appel(profil, "GET", f"{CHEMIN}/{ident}")
    assert reponse.status_code == 200, reponse.text
    result: dict[str, Any] = reponse.json()
    return result


def lister(banc: Banc, profil: Any = CREATEUR_GROUPE) -> dict[str, Any]:
    reponse = banc.appel(profil, "GET", CHEMIN)
    assert reponse.status_code == 200, reponse.text
    result: dict[str, Any] = reponse.json()
    return result


def test_creation_rend_la_revision_la_provenance_et_les_droits(banc: Banc) -> None:
    reponse = banc.creer(CREATEUR_GROUPE, visibility="shared")
    assert reponse.status_code == 201
    vue = reponse.json()
    assert UUID.fullmatch(vue["id"]) and vue["analysis"]["id"] == vue["id"]
    assert vue["space_id"] == A and vue["revision"] == 1 and vue["current_revision"] == 1
    assert SHA.fullmatch(vue["commit"]) and vue["committed_at"].endswith("+00:00")
    assert vue["revised_by"] == {"issuer": CREATEUR_GROUPE.ref.issuer, "subject": "cora"}
    assert vue["state"] == "ready" and vue["unresolved"] == []
    assert vue["permissions"] == {"owner": True, "revise": True, "delete": True, "duplicate": True}
    # Le contenu relu dans git est celui qui a été rendu ; l'index suit.
    assert banc.depot.read(A, vue["id"]).document == vue["analysis"]
    ligne = banc.index.get(A, vue["id"])
    assert ligne is not None and (ligne.revision, ligne.commit) == (1, vue["commit"])
    assert (ligne.model, ligne.metrics, ligne.visibility) == ("sales", ("revenue",), "shared")


def test_les_identifiants_sont_generes_par_le_serveur(banc: Banc) -> None:
    identifiants = {banc.creer_ok(CREATEUR_GROUPE) for _ in range(3)}
    assert len(identifiants) == 3 and all(UUID.fullmatch(item) for item in identifiants)


@pytest.mark.parametrize("envoi", [b"", b"{", b"[]", b'"x"', b"null"], ids=repr)
def test_un_corps_qui_n_est_pas_un_objet_est_refuse(banc: Banc, envoi: bytes) -> None:
    reponse = banc.appel(CREATEUR_GROUPE, "POST", CHEMIN, content=envoi)
    assert reponse.status_code == 400
    assert reponse.json() == {"error": {"code": "invalid_request", "field": "body"}}
    assert banc.depot.analyses() == ()


def test_la_liste_est_triee_et_porte_l_etat_de_l_index(banc: Banc) -> None:
    banc.creer_ok(CREATEUR_GROUPE, name="banane", visibility="shared")
    banc.creer_ok(CREATEUR_GROUPE, name="Abricot", visibility="personal")
    banc.creer_ok(CREATEUR_PERSONNE, name="cerise", visibility="shared")
    banc.creer_ok(CREATEUR_PERSONNE, name="date secrète", visibility="personal")
    vue = lister(banc)
    assert [item["name"] for item in vue["analyses"]] == ["Abricot", "banane", "cerise"]
    assert vue["unreadable"] == 0
    premier = vue["analyses"][0]
    assert set(premier) == {
        "id",
        "name",
        "visibility",
        "owner",
        "is_owner",
        "revision",
        "commit",
        "committed_at",
        "model",
        "metrics",
        "state",
    }
    assert premier["state"] == "indexed" and premier["is_owner"] is True
    assert (premier["model"], premier["metrics"], premier["revision"]) == ("sales", ["revenue"], 1)
    assert [item["is_owner"] for item in vue["analyses"]] == [True, True, False]
    autre = lister(banc, LECTEUR_GROUPE)
    assert [item["name"] for item in autre["analyses"]] == ["banane", "cerise"]


def test_la_liste_vide(banc: Banc) -> None:
    assert lister(banc) == {"analyses": [], "unreadable": 0}


def test_un_ecart_avec_git_est_signale_et_git_fait_foi(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, name="Avant", visibility="shared")
    courante = banc.depot.read(A, ident).document
    # Une révision publiée dans git sans que l'index l'ait su (base indisponible, crash).
    avance = {**courante, "name": "Après"}
    banc.depot.write(A, ident, avance, expected_revision=1, actor=CREATEUR_GROUPE.ref)
    ligne = lister(banc, LECTEUR_GROUPE)["analyses"][0]
    assert (ligne["name"], ligne["revision"], ligne["state"]) == ("Après", 2, "index_stale")
    lue = lire(banc, ident, LECTEUR_GROUPE)
    assert lue["state"] == "index_stale" and lue["analysis"]["name"] == "Après"
    # Le contenu d'une révision plus ancienne n'est pas comparé à l'index.
    ancienne = banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions/1").json()
    assert ancienne["state"] == "ready" and ancienne["current_revision"] == 2


def test_une_analyse_absente_de_l_index_se_lit_mais_n_est_pas_listee(banc: Banc) -> None:
    ident = new_id()
    document = {"api_version": "board.analysis/v1", "id": ident, **corps(visibility="shared")}
    document["owner"] = {"issuer": CREATEUR_GROUPE.ref.issuer, "subject": "cora"}
    banc.depot.write(A, ident, document, expected_revision=None, actor=CREATEUR_GROUPE.ref)
    assert lister(banc)["analyses"] == []
    assert lire(banc, ident)["state"] == "index_stale"


def test_une_ligne_dont_l_analyse_a_disparu_de_git_est_ignoree(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    banc.depot.delete(A, ident, expected_revision=1, actor=CREATEUR_GROUPE.ref)
    assert lister(banc) == {"analyses": [], "unreadable": 0}


def test_une_analyse_illisible_n_est_comptee_que_pour_son_proprietaire(banc: Banc) -> None:
    partagee = banc.creer_ok(CREATEUR_GROUPE, visibility="shared", name="Partagée")
    personnelle = banc.creer_ok(CREATEUR_GROUPE, visibility="personal", name="Perso")
    banc.creer_ok(CREATEUR_GROUPE, visibility="shared", name="Intacte")
    for ident in (partagee, personnelle):
        commit(banc.racine, {relative(A, ident): b"api_version: x\n"}, "intrus")
    vue = lister(banc)
    assert [item["name"] for item in vue["analyses"]] == ["Intacte"]
    assert vue["unreadable"] == 2
    # Un lecteur ne voit pas qu'une analyse d'un autre est abîmée, partagée ou non : la ligne
    # d'index peut être périmée, seul son propriétaire (qui ne change jamais) fait foi.
    assert lister(banc, LECTEUR_GROUPE)["unreadable"] == 0
    reponse = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{partagee}")
    assert reponse.status_code == 503
    assert reponse.json() == {"error": {"code": "content_unavailable"}}


def test_une_analyse_inconnue_ou_mal_nommee_n_existe_pas(banc: Banc) -> None:
    attendu = {"error": {"code": "analysis_not_found"}}
    for ident in (INCONNUE, INCONNUE.upper(), "abc", "not-a-uuid", "a" * 200, f"{INCONNUE}%00"):
        for chemin in (
            f"{CHEMIN}/{ident}",
            f"{CHEMIN}/{ident}/revisions",
            f"{CHEMIN}/{ident}/revisions/1",
        ):
            reponse = banc.appel(CREATEUR_GROUPE, "GET", chemin)
            assert reponse.status_code == 404 and reponse.json() == attendu, chemin
        diff = banc.appel(
            CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/diff", params={"base": "1", "other": "2"}
        )
        assert diff.status_code == 404 and diff.json() == attendu
        assert banc.reviser(CREATEUR_GROUPE, ident, 1).status_code == 404
        assert banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN}/{ident}/duplicate").status_code == 404
        suppression = banc.appel(
            CREATEUR_GROUPE, "DELETE", f"{CHEMIN}/{ident}", params={"expected_revision": "1"}
        )
        assert suppression.status_code == 404


def test_historique_et_revisions_numerotees(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, name="Un", visibility="shared")
    deux = banc.reviser(ADMIN_GROUPE, ident, 1, name="Deux", visibility="shared")
    assert deux.status_code == 201 and deux.json()["revision"] == 2
    historique = banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions").json()
    assert historique["current_revision"] == 2 and historique["deleted"] is False
    assert [(item["revision"], item["action"]) for item in historique["revisions"]] == [
        (1, "save"),
        (2, "save"),
    ]
    assert [item["actor"]["subject"] for item in historique["revisions"]] == ["cora", "ada"]
    assert all(SHA.fullmatch(item["commit"]) for item in historique["revisions"])
    un = banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions/1").json()
    assert un["analysis"]["name"] == "Un" and un["current_revision"] == 2
    assert un["revision"] == 1 and un["permissions"]["revise"] is False
    assert lire(banc, ident)["analysis"]["name"] == "Deux"


@pytest.mark.parametrize("numero", ["0", "-1", "abc", "1.5", "1e3", "٣", "1234567890", " 1", "01 "])
def test_un_numero_de_revision_invalide_est_refuse(banc: Banc, numero: str) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE)
    reponse = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions/{numero}")
    assert reponse.status_code == 400
    assert reponse.json()["error"]["code"] == "invalid_parameter"
    assert reponse.json()["error"]["parameter"] == "revision"


def test_une_revision_inexistante_n_existe_pas(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE)
    reponse = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions/2")
    assert reponse.status_code == 404
    assert reponse.json() == {"error": {"code": "analysis_not_found"}}


def test_ecart_structurel_entre_deux_revisions(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, name="Un", visibility="shared")
    modifiee = banc.reviser(
        CREATEUR_GROUPE,
        ident,
        1,
        name="Deux",
        visibility="shared",
        presentation={"chart": "line"},
    )
    assert modifiee.status_code == 201
    reponse = banc.appel(
        LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/diff", params={"base": "1", "other": "2"}
    )
    assert reponse.status_code == 200
    assert reponse.json() == {
        "id": ident,
        "base": 1,
        "other": 2,
        "changes": [
            {"path": "/name", "kind": "modified", "before": "Un", "after": "Deux"},
            {
                "path": "/presentation/chart",
                "kind": "modified",
                "before": "bars",
                "after": "line",
            },
        ],
    }
    identique = banc.appel(
        LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/diff", params={"base": "2", "other": "2"}
    )
    assert identique.json()["changes"] == []


@pytest.mark.parametrize(
    "params",
    [{}, {"base": "1"}, {"other": "1"}, {"base": "0", "other": "1"}, {"base": "x", "other": "1"}],
)
def test_ecart_sans_numeros_valides(banc: Banc, params: dict[str, str]) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE)
    reponse = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/diff", params=params)
    assert reponse.status_code == 400
    assert reponse.json()["error"]["code"] == "invalid_parameter"


def test_ecart_avec_une_revision_absente(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE)
    reponse = banc.appel(
        CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/diff", params={"base": "1", "other": "5"}
    )
    assert reponse.status_code == 404


@pytest.mark.parametrize("attendu", [None, 0, -1, "1", True, 1.0, 1_000_000_000, [1]], ids=repr)
def test_la_revision_attendue_est_obligatoire_et_precise(banc: Banc, attendu: Any) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE)
    envoi = {**corps(), "expected_revision": attendu}
    if attendu is None:
        del envoi["expected_revision"]
    reponse = banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN}/{ident}/revisions", json=envoi)
    assert reponse.status_code == 400
    assert reponse.json() == {"error": {"code": "invalid_request", "field": "expected_revision"}}
    assert len(banc.depot.history(A, ident)) == 1


@pytest.mark.parametrize("envoi", [[], "x", 3, None])
def test_reviser_refuse_un_corps_qui_n_est_pas_un_objet(banc: Banc, envoi: Any) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE)
    reponse = banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN}/{ident}/revisions", json=envoi)
    assert reponse.status_code == 400
    assert reponse.json() == {"error": {"code": "invalid_request", "field": "body"}}


def test_revision_obsolete_est_un_conflit(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    assert (
        banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="shared", name="Deux").status_code == 201
    )
    obsolete = banc.reviser(ADMIN_GROUPE, ident, 1, visibility="shared", name="Trois")
    assert obsolete.status_code == 409
    assert obsolete.json() == {"error": {"code": "revision_conflict", "reason": "stale"}}
    avance = banc.reviser(ADMIN_GROUPE, ident, 9, visibility="shared", name="Trois")
    assert avance.status_code == 409
    assert lire(banc, ident)["analysis"]["name"] == "Deux"
    assert len(banc.depot.history(A, ident)) == 2


def test_deux_sauvegardes_simultanees_une_seule_l_emporte(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    depart = threading.Barrier(2)

    def sauver(nom: str) -> int:
        depart.wait()
        return banc.reviser(ADMIN_GROUPE, ident, 1, visibility="shared", name=nom).status_code

    with ThreadPoolExecutor(2) as pool:
        statuts = sorted(pool.map(sauver, ["Alpha", "Beta"]))
    assert statuts == [201, 409]
    assert len(banc.depot.history(A, ident)) == 2


def test_un_conflit_decouvert_a_l_ecriture_est_le_meme_conflit(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Quelqu'un publie entre le contrôle de la révision attendue et l'écriture."""
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    reel = describe_catalog
    fait: list[bool] = []

    def concurrent(dossier: Path) -> dict[str, Any]:
        if not fait:
            fait.append(True)
            courante = banc.depot.read(A, ident).document
            banc.depot.write(
                A,
                ident,
                {**courante, "name": "Doublé"},
                expected_revision=1,
                actor=ADMIN_GROUPE.ref,
            )
        return reel(dossier)

    monkeypatch.setattr("skifer_board.server.describe_catalog", concurrent)
    reponse = banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="shared", name="Perdu")
    assert reponse.status_code == 409
    assert reponse.json() == {"error": {"code": "revision_conflict", "reason": "stale"}}
    assert banc.depot.read(A, ident).document["name"] == "Doublé"


def test_dupliquer_rend_une_copie_personnelle_a_soi(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, name="Modèle", visibility="shared")
    reponse = banc.appel(CREATEUR_PERSONNE, "POST", f"{CHEMIN}/{ident}/duplicate")
    assert reponse.status_code == 201
    copie = reponse.json()
    assert copie["id"] != ident and UUID.fullmatch(copie["id"])
    assert copie["analysis"]["name"] == "Copie de Modèle"
    assert copie["analysis"]["visibility"] == "personal"
    assert copie["analysis"]["owner"]["subject"] == CREATEUR_PERSONNE.sujet
    assert copie["revision"] == 1 and copie["permissions"]["owner"] is True
    source = lire(banc, ident)["analysis"]
    for champ in ("description", "query", "contextual", "presentation"):
        assert copie["analysis"][champ] == source[champ]
    assert len(banc.depot.history(A, ident)) == 1
    # La copie est personnelle : le propriétaire de la source ne la voit pas.
    assert banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{copie['id']}").status_code == 404


def test_dupliquer_sous_un_nom_choisi(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, name="Modèle")
    reponse = banc.appel(
        CREATEUR_GROUPE, "POST", f"{CHEMIN}/{ident}/duplicate", json={"name": "Mon nom"}
    )
    assert reponse.status_code == 201 and reponse.json()["analysis"]["name"] == "Mon nom"
    invalide = banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN}/{ident}/duplicate", json={"name": ""})
    assert invalide.status_code == 422
    assert {"path": "/name", "rule": "out_of_bounds"} in invalide.json()["error"]["violations"]


def test_le_nom_d_une_copie_reste_dans_les_limites(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, name="n" * 120)
    reponse = banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN}/{ident}/duplicate")
    assert reponse.status_code == 201
    assert reponse.json()["analysis"]["name"] == ("Copie de " + "n" * 120)[:120]


@pytest.mark.parametrize("envoi", [{"sql": "x"}, {"name": "a", "owner": {}}, [], "x", 3])
def test_dupliquer_refuse_un_corps_inattendu(banc: Banc, envoi: Any) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE)
    reponse = banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN}/{ident}/duplicate", json=envoi)
    assert reponse.status_code == 400
    assert reponse.json() == {"error": {"code": "invalid_request", "field": "body"}}
    assert len(banc.depot.analyses()) == 1


def test_dupliquer_une_analyse_dont_un_champ_a_disparu_est_refuse(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    banc.redefinir(["orders"], ["region", "channel"])
    copie = banc.appel(CREATEUR_PERSONNE, "POST", f"{CHEMIN}/{ident}/duplicate")
    assert copie.status_code == 422
    assert copie.json()["error"]["violations"] == [
        {"path": "/query/metrics/0", "rule": "unknown_metric"}
    ]
    assert len(banc.depot.analyses()) == 1


def test_une_revision_identique_n_enregistre_rien(banc: Banc) -> None:
    """Git, par fichier, taît un commit au contenu identique : pas de numéro fantôme."""
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    reponse = banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="shared")
    assert reponse.status_code == 200
    assert reponse.json()["revision"] == 1 and reponse.json()["current_revision"] == 1
    assert len(banc.depot.history(A, ident)) == 1
    # La révision attendue reste la 1, et la suivante est bien la 2.
    suivante = banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="shared", name="Autre")
    assert suivante.status_code == 201 and suivante.json()["revision"] == 2


def test_suppression_garde_l_historique(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared", name="À supprimer")
    reponse = banc.appel(
        CREATEUR_GROUPE, "DELETE", f"{CHEMIN}/{ident}", params={"expected_revision": "1"}
    )
    assert reponse.status_code == 204 and reponse.content == b""
    assert banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}").status_code == 404
    assert lister(banc) == {"analyses": [], "unreadable": 0}
    assert banc.index.get(A, ident) is None
    historique = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions").json()
    assert historique["deleted"] is True and historique["current_revision"] is None
    assert [item["action"] for item in historique["revisions"]] == ["save", "delete"]
    ancienne = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions/1")
    assert ancienne.status_code == 200
    assert ancienne.json()["analysis"]["name"] == "À supprimer"
    assert ancienne.json()["current_revision"] is None
    assert ancienne.json()["permissions"] == {
        "owner": True,
        "revise": False,
        "delete": False,
        "duplicate": False,
    }
    assert ancienne.json()["state"] == "ready"
    # Ni autrui, ni le propriétaire ne révisent, dupliquent ou suppriment ce qui n'existe plus.
    assert banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="shared").status_code == 404
    assert banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN}/{ident}/duplicate").status_code == 404
    seconde = banc.appel(
        CREATEUR_GROUPE, "DELETE", f"{CHEMIN}/{ident}", params={"expected_revision": "1"}
    )
    assert seconde.status_code == 404


def test_une_analyse_supprimee_n_est_plus_visible_que_de_son_proprietaire(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared", name=SECRET)
    supprime = banc.appel(
        CREATEUR_GROUPE, "DELETE", f"{CHEMIN}/{ident}", params={"expected_revision": "1"}
    )
    assert supprime.status_code == 204
    for profil in (ADMIN_GROUPE, LECTEUR_GROUPE, CREATEUR_PERSONNE):
        for chemin in (f"{CHEMIN}/{ident}/revisions", f"{CHEMIN}/{ident}/revisions/1"):
            reponse = banc.appel(profil, "GET", chemin)
            assert reponse.status_code == 404 and SECRET not in reponse.text
        diff = banc.appel(
            profil, "GET", f"{CHEMIN}/{ident}/diff", params={"base": "1", "other": "1"}
        )
        assert diff.status_code == 404 and SECRET not in diff.text


@pytest.mark.parametrize("attendu", [None, "0", "x", "1.0", "-1", "1234567890", ""])
def test_la_suppression_exige_la_revision_attendue(banc: Banc, attendu: str | None) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE)
    params = {} if attendu is None else {"expected_revision": attendu}
    reponse = banc.appel(CREATEUR_GROUPE, "DELETE", f"{CHEMIN}/{ident}", params=params)
    assert reponse.status_code == 400
    assert reponse.json() == {"error": {"code": "invalid_request", "field": "expected_revision"}}
    assert banc.depot.read(A, ident).revision.number == 1


def test_suppression_sur_une_revision_obsolete(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE)
    assert banc.reviser(CREATEUR_GROUPE, ident, 1, name="Deux").status_code == 201
    reponse = banc.appel(
        CREATEUR_GROUPE, "DELETE", f"{CHEMIN}/{ident}", params={"expected_revision": "1"}
    )
    assert reponse.status_code == 409
    assert reponse.json() == {"error": {"code": "revision_conflict", "reason": "stale"}}
    assert lire(banc, ident)["revision"] == 2


def test_un_consommateur_empeche_la_suppression(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared", name=SECRET)
    banc.consommateurs.append(Consumer("dashboard", "tb-1"))
    reponse = banc.appel(
        CREATEUR_GROUPE, "DELETE", f"{CHEMIN}/{ident}", params={"expected_revision": "1"}
    )
    assert reponse.status_code == 409
    assert reponse.json() == {
        "error": {
            "code": "analysis_in_use",
            "consumers": [{"kind": "dashboard", "id": "tb-1"}],
        }
    }
    assert SECRET not in reponse.text
    assert lire(banc, ident)["revision"] == 1 and banc.index.get(A, ident) is not None
    # Le consommateur parti, la suppression passe.
    banc.consommateurs.clear()
    assert (
        banc.appel(
            CREATEUR_GROUPE, "DELETE", f"{CHEMIN}/{ident}", params={"expected_revision": "1"}
        ).status_code
        == 204
    )


def test_le_controle_des_consommateurs_suit_le_droit_de_supprimer(banc: Banc) -> None:
    """Qui ne peut pas supprimer n'apprend pas qui consomme l'analyse."""
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    banc.consommateurs.append(Consumer("dashboard", "tb-1"))
    reponse = banc.appel(
        LECTEUR_GROUPE, "DELETE", f"{CHEMIN}/{ident}", params={"expected_revision": "1"}
    )
    assert reponse.status_code == 403 and "tb-1" not in reponse.text
    personnelle = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    reponse = banc.appel(
        ADMIN_GROUPE, "DELETE", f"{CHEMIN}/{personnelle}", params={"expected_revision": "1"}
    )
    assert reponse.status_code == 404 and "tb-1" not in reponse.text


def panne(*_: Any, **__: Any) -> None:
    raise OperationalError("INSERT secret_dsn", {}, Exception("postgresql://user:motdepasse@h/db"))


def test_une_base_en_panne_ne_defait_pas_ce_qui_est_dans_git(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(AnalysisIndex, "upsert", panne)
    reponse = banc.creer(CREATEUR_GROUPE, visibility="shared")
    assert reponse.status_code == 201 and "motdepasse" not in reponse.text
    ident = reponse.json()["id"]
    assert reponse.json()["state"] == "index_stale"
    revisee = banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="shared", name="Deux")
    assert revisee.status_code == 201 and revisee.json()["state"] == "index_stale"
    copie = banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN}/{ident}/duplicate")
    assert copie.status_code == 201
    assert lister(banc) == {"analyses": [], "unreadable": 0}
    monkeypatch.setattr(AnalysisIndex, "remove", panne)
    supprime = banc.appel(
        CREATEUR_GROUPE, "DELETE", f"{CHEMIN}/{ident}", params={"expected_revision": "2"}
    )
    assert supprime.status_code == 204
    assert banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}").status_code == 404


def test_une_base_qui_ne_repond_plus_apres_la_publication_rend_un_etat_degrade(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Lectures et écritures de la base en panne ensemble : la réponse vient de git, l'analyse
    est `unverified`, jamais une erreur pour une révision déjà publiée."""
    existante = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    for methode in ("upsert", "get", "remove", "rows"):
        monkeypatch.setattr(AnalysisIndex, methode, panne)
    creation = banc.creer(CREATEUR_GROUPE, name="Nouvelle", visibility="shared")
    assert creation.status_code == 201 and "motdepasse" not in creation.text
    assert creation.json()["state"] == "unverified" and creation.json()["revision"] == 1
    assert creation.json()["analysis"]["name"] == "Nouvelle" and creation.json()["unresolved"] == []
    revisee = banc.reviser(CREATEUR_GROUPE, existante, 1, visibility="shared", name="Deux")
    assert revisee.status_code == 201 and revisee.json()["state"] == "unverified"
    assert revisee.json()["revision"] == 2 and revisee.json()["current_revision"] == 2
    identique = banc.reviser(CREATEUR_GROUPE, existante, 2, visibility="shared", name="Deux")
    assert identique.status_code == 200 and identique.json()["state"] == "unverified"
    copie = banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN}/{existante}/duplicate")
    assert copie.status_code == 201 and copie.json()["state"] == "unverified"
    supprime = banc.appel(
        CREATEUR_GROUPE, "DELETE", f"{CHEMIN}/{existante}", params={"expected_revision": "2"}
    )
    assert supprime.status_code == 204
    # Ce qui est dans git y est, malgré la panne : l'historique, lui, se lit sans la base.
    assert len(banc.depot.history(A, existante)) == 3
    assert len(banc.depot.analyses()) == 2  # la nouvelle et la copie ; la supprimée n'y est plus


def test_une_base_qui_ne_repond_plus_pour_les_connexions_laisse_l_analyse_non_verifiee(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="shared", name="Deux")
    monkeypatch.setattr(ConnectionStore, "list", panne)
    ancienne = banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions/1")
    assert ancienne.status_code == 200 and ancienne.json()["state"] == "unverified"
    assert ancienne.json()["analysis"]["name"] != "Deux"


def test_deux_ecritures_dans_le_desordre_ne_ramenent_pas_l_index_en_arriere(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    assert (
        banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="shared", name="Deux").status_code == 201
    )
    ancienne = banc.index.get(A, ident)
    assert ancienne is not None and ancienne.revision == 2
    from skifer_board.content.index import IndexRow

    banc.index.upsert(IndexRow.of(A, banc.depot.read(A, ident, 1)))
    ligne = banc.index.get(A, ident)
    assert ligne is not None and ligne.revision == 2


def test_sans_depot_configure_les_routes_disent_content_unavailable(banc_sans_depot: Banc) -> None:
    banc = banc_sans_depot
    attendu = {"error": {"code": "content_unavailable"}}
    for methode, chemin, options in (
        ("GET", CHEMIN, {}),
        ("POST", CHEMIN, {"json": corps()}),
        ("GET", f"{CHEMIN}/{INCONNUE}", {}),
        ("GET", f"{CHEMIN}/{INCONNUE}/revisions", {}),
        ("GET", f"{CHEMIN}/{INCONNUE}/revisions/1", {}),
        ("GET", f"{CHEMIN}/{INCONNUE}/diff", {"params": {"base": "1", "other": "2"}}),
        ("POST", f"{CHEMIN}/{INCONNUE}/revisions", {"json": {**corps(), "expected_revision": 1}}),
        ("POST", f"{CHEMIN}/{INCONNUE}/duplicate", {}),
        ("DELETE", f"{CHEMIN}/{INCONNUE}", {"params": {"expected_revision": "1"}}),
    ):
        reponse = banc.appel(CREATEUR_GROUPE, methode, chemin, **options)
        assert reponse.status_code == 503 and reponse.json() == attendu, (methode, chemin)
    # Le droit se juge d'abord : un lecteur n'apprend pas l'état du dépôt par une écriture.
    assert banc.creer(LECTEUR_GROUPE).status_code == 403


def test_un_depot_disparu_est_indisponible_sans_dire_pourquoi(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    import shutil

    shutil.rmtree(banc.racine)
    for methode, chemin in (("GET", CHEMIN), ("GET", f"{CHEMIN}/{ident}")):
        reponse = banc.appel(CREATEUR_GROUPE, methode, chemin)
        assert reponse.status_code == 503
        assert reponse.json() == {"error": {"code": "content_unavailable"}}
        assert str(banc.racine) not in reponse.text


def test_le_mode_local_refuse_comme_les_executions(service: CatalogService, tmp_path: Path) -> None:
    from .monde import init, repository

    depot: ContentRepository = repository(init(tmp_path / "contenus"))
    app = create_app(service, content_repository=depot)
    with TestClient(app, base_url="http://127.0.0.1", raise_server_exceptions=False) as client:
        entetes = {"Origin": "http://127.0.0.1"}
        base = "/api/spaces/local/analyses"
        appels: list[Callable[[], Any]] = [
            lambda: client.get(base),
            lambda: client.post(base, json=corps(), headers=entetes),
            lambda: client.get(f"{base}/{INCONNUE}"),
            lambda: client.get(f"{base}/{INCONNUE}/revisions"),
            lambda: client.get(f"{base}/{INCONNUE}/revisions/1"),
            lambda: client.get(f"{base}/{INCONNUE}/diff?base=1&other=2"),
            lambda: client.post(
                f"{base}/{INCONNUE}/revisions",
                json={**corps(), "expected_revision": 1},
                headers=entetes,
            ),
            lambda: client.post(f"{base}/{INCONNUE}/duplicate", headers=entetes),
            lambda: client.delete(f"{base}/{INCONNUE}?expected_revision=1", headers=entetes),
        ]
        for appel in appels:
            reponse = appel()
            assert reponse.status_code == 409
            assert reponse.json()["error"]["code"] == "local_mode"
    assert depot.analyses() == ()


def typer_active(banc: Banc, genre: str) -> None:
    """Le catalogue change le type de la dimension `active` (booléen ou numérique)."""
    fichier = banc.dossier_modeles / "sales.yaml"
    modele = yaml.safe_load(fichier.read_text())
    for dimension in modele["models"][0]["dimensions"]:
        if dimension["name"] == "active":
            dimension["type"] = genre
    fichier.write_text(yaml.safe_dump(modele))


@pytest.mark.parametrize(
    ("avant", "apres", "avant_genre", "apres_genre"),
    [
        (True, 1, "boolean", "number"),
        (1, 1.0, "number", "number"),
        (0, False, "number", "boolean"),
    ],
)
def test_changer_le_type_d_un_filtre_est_une_revision_pas_un_contenu_identique(
    banc: Banc, avant: Any, apres: Any, avant_genre: str, apres_genre: str
) -> None:
    """`true`, `1` et `1.0` sont égaux pour Python : la route ne répond pas « inchangé »."""

    def filtres(valeur: Any) -> dict[str, Any]:
        return {"filters": [{"column": "active", "operator": "eq", "value": valeur}]}

    def requete(valeur: Any) -> dict[str, Any]:
        return {**corps()["query"], **filtres(valeur), "dimensions": ["region", "active"]}

    typer_active(banc, avant_genre)
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared", query=requete(avant))
    typer_active(banc, apres_genre)
    reponse = banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="shared", query=requete(apres))
    assert reponse.status_code == 201, reponse.text
    assert reponse.json()["revision"] == 2
    filtre = reponse.json()["analysis"]["query"]["filters"][0]["value"]
    assert filtre == apres and type(filtre) is type(apres)
    assert reponse.json()["state"] == "ready"
    # Le contenu relu dans git est celui qui a été envoyé.
    relu = banc.depot.read(A, ident).document["query"]["filters"][0]["value"]
    assert type(relu) is type(apres)
    # Rejouer le même contenu reste « inchangé ».
    encore = banc.reviser(CREATEUR_GROUPE, ident, 2, visibility="shared", query=requete(apres))
    assert encore.status_code == 200 and encore.json()["revision"] == 2
