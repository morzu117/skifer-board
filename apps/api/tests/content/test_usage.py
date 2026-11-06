"""Référence d'analyse dans l'exécution et événements d'usage durables (plan 18.3, A8)."""

from __future__ import annotations

import base64
from collections.abc import Callable
from datetime import timedelta
from pathlib import Path
from typing import Any
from unittest.mock import Mock
from uuid import uuid4

import pytest
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from fastapi.testclient import TestClient
from skifer_board.catalog import CatalogService
from skifer_board.content import ContentRepository
from skifer_board.content.events import (
    KEY_VARIABLE,
    UsageConfigError,
    UsageEvents,
    UsageKey,
    key_from_env,
    opened_id,
    saved_id,
)
from skifer_board.server import create_app, usage_key_runtime
from skifer_board.spaces.model import GroupPrincipal, PersonRef
from skifer_board.spaces.store import SpaceStore
from skifer_board.state import current_revision, upgrade
from skifer_board.state.schema import analysis_events, metadata
from spaces.monde import (
    ADMIN_B,
    ADMIN_GROUPE,
    CREATEUR_GROUPE,
    CREATEUR_PERSONNE,
    LECTEUR_GROUPE,
    LECTEUR_PERSONNE,
    NON_MEMBRE,
    A,
    Profil,
)
from spaces.test_migration import jusqu_a
from sqlalchemy import Engine, inspect, select
from sqlalchemy.exc import OperationalError

from .monde import ACTOR, document, new_id
from .serveur import CHEMIN, CLE_D_USAGE, Banc, corps, ouvrir
from .test_index import INSTANT

EXECUTIONS = f"/api/spaces/{A}/executions"
INCONNUE = {"error": {"code": "analysis_not_found"}}
SENTINELLE = "valeur_sentinelle_d_evenement"


def soumettre(banc: Banc, profil: Profil | None, reference: Any = None, **champs: Any) -> Any:
    envoi: dict[str, Any] = {
        "connection": "finance",
        "environment": "DEV",
        "model": "sales",
        "metrics": ["revenue"],
        "dimensions": [],
        "filters": [],
        **champs,
    }
    if reference is not None:
        envoi["analysis"] = reference
    return banc.appel(profil, "POST", EXECUTIONS, json=envoi)


def evenements(banc: Banc, *sortes: str) -> list[dict[str, Any]]:
    """Événements en base, de ces sortes (toutes si aucune)."""
    with banc.monde.moteur.connect() as connexion:
        lignes = connexion.execute(select(analysis_events)).mappings().all()
    return [dict(ligne) for ligne in lignes if not sortes or ligne["kind"] in sortes]


def ouvrir_analyse(
    banc: Banc, profil: Profil | None, ident: str, revision: int, evenement: str | None = None
) -> Any:
    return banc.appel(
        profil,
        "POST",
        f"{CHEMIN}/{ident}/opened",
        json={"event_id": evenement or str(uuid4()), "revision": revision},
    )


def usage(banc: Banc, profil: Profil | None, ident: str) -> Any:
    return banc.appel(profil, "GET", f"{CHEMIN}/{ident}/usage")


def panne(*_: Any, **__: Any) -> None:
    raise OperationalError("INSERT secret_dsn", {}, Exception("postgresql://u:motdepasse@h/db"))


def enregistrer_a(banc: Banc, instant: Any, sorte: Any, ident: str) -> None:
    """Consigne un événement daté de cet instant, comme si l'horloge du serveur l'avait dit."""
    UsageEvents(banc.monde.moteur, lambda: instant).record(str(uuid4()), sorte, A, ident, 1)


def partagee(banc: Banc, **changes: Any) -> str:
    return banc.creer_ok(CREATEUR_GROUPE, visibility="shared", **changes)


def reference(ident: str, revision: int = 1) -> dict[str, Any]:
    return {"id": ident, "revision": revision}


# -- migration 0014 -------------------------------------------------------------------------


def test_migration_0014_depuis_0013(engine: Engine) -> None:
    jusqu_a(engine, "0013")
    SpaceStore(engine).create_space(
        "finance", "Finance", "atlas", GroupPrincipal("admins"), ACTOR, INSTANT
    )
    assert "analysis_events" not in inspect(engine).get_table_names()
    upgrade(engine)
    assert current_revision(engine) == "0015"
    assert SpaceStore(engine).get_space("finance") is not None
    with engine.connect() as connection:
        assert connection.execute(select(analysis_events)).all() == []
        assert compare_metadata(MigrationContext.configure(connection), metadata) == []
    inspecteur = inspect(engine)
    assert inspecteur.get_pk_constraint("analysis_events")["constrained_columns"] == ["event_id"]
    assert inspecteur.get_foreign_keys("analysis_events") == []
    assert [i["name"] for i in inspecteur.get_indexes("analysis_events")] == [
        "ix_analysis_events_analysis"
    ]
    # L'index des analyses de 0013 est intact.
    assert "analysis_index" in inspecteur.get_table_names()


# -- référence dans la soumission -----------------------------------------------------------


def test_une_reference_valide_est_acceptee_et_consignee(banc: Banc) -> None:
    ident = partagee(banc)
    avec = soumettre(banc, LECTEUR_GROUPE, reference(ident))
    sans = soumettre(banc, LECTEUR_GROUPE)
    assert avec.status_code == sans.status_code == 202, avec.text
    # La référence ne change pas la réponse : mêmes champs, même contrat que sans elle.
    assert set(avec.json()) == set(sans.json())
    assert avec.json()["connection"] == sans.json()["connection"] == "finance"
    (evenement,) = evenements(banc, "executed")
    assert evenement["event_id"] == avec.json()["id"]
    assert (evenement["kind"], evenement["space_id"], evenement["analysis_id"]) == (
        "executed",
        A,
        ident,
    )
    assert evenement["revision"] == 1


def test_sans_reference_rien_n_est_consigne(banc: Banc) -> None:
    assert soumettre(banc, LECTEUR_GROUPE).status_code == 202
    assert evenements(banc, "executed") == []


def test_une_requete_differente_de_celle_de_l_analyse_reste_permise(banc: Banc) -> None:
    ident = partagee(banc)
    reponse = soumettre(
        banc,
        LECTEUR_GROUPE,
        reference(ident),
        metrics=["orders"],
        dimensions=["channel"],
        filters=[{"column": "region", "operator": "eq", "value": "Sud"}],
    )
    assert reponse.status_code == 202, reponse.text
    assert len(evenements(banc, "executed")) == 1


def test_une_revision_numerotee_visible_est_acceptee(banc: Banc) -> None:
    ident = partagee(banc)
    banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="shared", name="Deux")
    for numero in (1, 2):
        assert soumettre(banc, LECTEUR_GROUPE, reference(ident, numero)).status_code == 202
    assert sorted(item["revision"] for item in evenements(banc, "executed")) == [1, 2]


def refus_inconnu(reponse: Any) -> None:
    assert reponse.status_code == 404 and reponse.json() == INCONNUE


def test_tout_ce_qui_n_est_pas_visible_repond_comme_une_analyse_inexistante(banc: Banc) -> None:
    personnelle = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    masquee = banc.creer_ok(CREATEUR_GROUPE, name="Brouillon", visibility="personal")
    banc.reviser(CREATEUR_GROUPE, masquee, 1, visibility="shared", name="Publiée")
    supprimee = partagee(banc)
    assert (
        banc.appel(
            CREATEUR_GROUPE, "DELETE", f"{CHEMIN}/{supprimee}", params={"expected_revision": "1"}
        ).status_code
        == 204
    )
    retiree = partagee(banc)
    banc.reviser(CREATEUR_GROUPE, retiree, 1, visibility="personal", name="Retirée du partage")
    ailleurs = new_id()
    banc.depot.write(
        "autre-espace",
        ailleurs,
        document(ailleurs, visibility="shared"),
        expected_revision=None,
        actor=ACTOR,
    )
    cas = [
        ("inexistante", new_id(), 1),
        ("révision inexistante", partagee(banc), 99),
        ("personnelle d'une autre personne", personnelle, 1),
        ("révision masquée", masquee, 1),
        ("autre espace", ailleurs, 1),
        ("supprimée", supprimee, 1),
        ("partagée puis rendue personnelle", retiree, 1),
    ]
    for profil in (LECTEUR_GROUPE, ADMIN_GROUPE, CREATEUR_PERSONNE):
        for nom, ident, numero in cas:
            reponse = soumettre(banc, profil, reference(ident, numero))
            refus_inconnu(reponse)
            assert reponse.text == soumettre(banc, profil, reference(new_id())).text, nom
    assert evenements(banc, "executed") == []
    # Aucune exécution n'a été créée par ces refus.
    liste = banc.appel(LECTEUR_GROUPE, "GET", EXECUTIONS).json()
    assert liste == {"executions": []}


def test_le_proprietaire_peut_referencer_sa_revision_personnelle(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    assert soumettre(banc, CREATEUR_GROUPE, reference(ident)).status_code == 202
    banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="shared", name="Partagée")
    # La première révision était personnelle : elle reste à son propriétaire.
    assert soumettre(banc, CREATEUR_GROUPE, reference(ident, 1)).status_code == 202
    refus_inconnu(soumettre(banc, LECTEUR_GROUPE, reference(ident, 1)))
    assert soumettre(banc, LECTEUR_GROUPE, reference(ident, 2)).status_code == 202


def test_une_analyse_supprimee_ne_se_reference_pas_meme_par_son_proprietaire(banc: Banc) -> None:
    ident = partagee(banc)
    banc.appel(CREATEUR_GROUPE, "DELETE", f"{CHEMIN}/{ident}", params={"expected_revision": "1"})
    refus_inconnu(soumettre(banc, CREATEUR_GROUPE, reference(ident)))
    assert evenements(banc, "executed") == []


def test_un_autre_modele_est_refuse_apres_le_controle_de_visibilite(banc: Banc) -> None:
    ident = partagee(banc)
    reponse = soumettre(banc, LECTEUR_GROUPE, reference(ident), model="autre")
    assert reponse.status_code == 422
    assert reponse.json() == {"error": {"code": "analysis_model_mismatch"}}
    # Une analyse qu'on ne voit pas ne dit rien de son modèle.
    secrete = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    refus_inconnu(soumettre(banc, LECTEUR_GROUPE, reference(secrete), model="autre"))
    assert evenements(banc, "executed") == []


@pytest.mark.parametrize(
    ("reference_", "champ"),
    [
        ("texte", "analysis"),
        ([], "analysis"),
        ({}, "analysis.id"),
        ({"id": new_id()}, "analysis.revision"),
        ({"id": new_id(), "revision": 1, "autre": 1}, "analysis"),
        ({"id": "pas-un-uuid", "revision": 1}, "analysis.id"),
        ({"id": 3, "revision": 1}, "analysis.id"),
        ({"id": new_id(), "revision": 0}, "analysis.revision"),
        ({"id": new_id(), "revision": True}, "analysis.revision"),
        ({"id": new_id(), "revision": "1"}, "analysis.revision"),
        ({"id": new_id(), "revision": 1_000_000_000}, "analysis.revision"),
        (None, "analysis"),
    ],
)
def test_une_reference_mal_formee_est_refusee(banc: Banc, reference_: Any, champ: str) -> None:
    envoi = {
        "connection": "finance",
        "environment": "DEV",
        "model": "sales",
        "metrics": ["revenue"],
        "dimensions": [],
        "filters": [],
        "analysis": reference_,
    }
    reponse = banc.appel(LECTEUR_GROUPE, "POST", EXECUTIONS, json=envoi)
    assert reponse.status_code == 400
    assert reponse.json() == {"error": {"code": "invalid_request", "field": champ}}
    assert evenements(banc, "executed") == []


def test_la_reference_ne_contourne_ni_les_droits_ni_la_validation(banc: Banc) -> None:
    ident = partagee(banc)
    assert soumettre(banc, NON_MEMBRE, reference(ident)).status_code == 404
    assert soumettre(banc, None, reference(ident)).status_code == 401
    invalide = soumettre(banc, LECTEUR_GROUPE, reference(ident), metrics=[])
    assert invalide.status_code == 400
    inconnu = soumettre(banc, LECTEUR_GROUPE, reference(ident), connection="absente")
    assert inconnu.status_code != 202
    assert evenements(banc, "executed") == []


def test_sans_depot_une_reference_est_indisponible(banc_sans_depot: Banc) -> None:
    reponse = soumettre(banc_sans_depot, LECTEUR_GROUPE, reference(new_id()))
    assert reponse.status_code == 503
    assert reponse.json() == {"error": {"code": "content_unavailable"}}
    # Sans référence, rien ne change.
    assert soumettre(banc_sans_depot, LECTEUR_GROUPE).status_code == 202


def test_la_requete_enregistree_ne_porte_pas_la_reference(banc: Banc) -> None:
    ident = partagee(banc)
    avec = soumettre(banc, LECTEUR_GROUPE, reference(ident)).json()
    sans = soumettre(banc, LECTEUR_GROUPE).json()
    lues = {
        item["id"]: item
        for item in banc.appel(LECTEUR_GROUPE, "GET", EXECUTIONS).json()["executions"]
    }
    assert set(lues[avec["id"]]) == set(lues[sans["id"]])


# -- événements consignés par les sauvegardes -----------------------------------------------


def test_une_sauvegarde_consigne_un_evenement_derive_du_commit(banc: Banc) -> None:
    creation = banc.creer(CREATEUR_GROUPE, visibility="shared")
    ident = creation.json()["id"]
    (premier,) = evenements(banc)
    assert premier["event_id"] == saved_id(creation.json()["commit"], "save")
    assert (premier["kind"], premier["analysis_id"], premier["revision"]) == ("saved", ident, 1)
    revisee = banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="shared", name="Deux")
    copie = banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN}/{ident}/duplicate").json()
    trouves = {(item["analysis_id"], item["revision"]): item for item in evenements(banc)}
    assert set(trouves) == {(ident, 1), (ident, 2), (copie["id"], 1)}
    assert trouves[(ident, 2)]["event_id"] == saved_id(revisee.json()["commit"], "save")
    assert {item["kind"] for item in trouves.values()} == {"saved"}


def test_une_revision_identique_ou_refusee_ne_consigne_rien(banc: Banc) -> None:
    ident = partagee(banc)
    avant = evenements(banc)
    identique = banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="shared")
    assert identique.status_code == 200
    assert banc.reviser(LECTEUR_GROUPE, ident, 1, visibility="shared").status_code == 403
    assert banc.reviser(CREATEUR_GROUPE, ident, 9, visibility="shared").status_code == 409
    assert (
        banc.appel(
            CREATEUR_GROUPE, "DELETE", f"{CHEMIN}/{ident}", params={"expected_revision": "1"}
        ).status_code
        == 204
    )
    assert evenements(banc) == avant


def test_rejouer_un_evenement_ne_cree_pas_de_doublon(banc: Banc) -> None:
    ident = partagee(banc)
    ouverte = str(uuid4())
    assert ouvrir_analyse(banc, LECTEUR_GROUPE, ident, 1, ouverte).json() == {"recorded": True}
    assert ouvrir_analyse(banc, LECTEUR_GROUPE, ident, 1, ouverte).json() == {"recorded": True}
    execution = soumettre(banc, LECTEUR_GROUPE, reference(ident)).json()["id"]
    sauvee = banc.depot.read(A, ident).revision.commit
    magasin = UsageEvents(banc.monde.moteur, banc.monde.horloge)
    for _ in range(3):
        magasin.record(execution, "executed", A, ident, 1)
        magasin.record(saved_id(sauvee, "save"), "saved", A, ident, 1)
    sortes = sorted(item["kind"] for item in evenements(banc))
    assert sortes == ["executed", "opened", "saved"]


# -- ouverture ------------------------------------------------------------------------------


def test_l_ouverture_consigne_un_evenement_idempotent(banc: Banc) -> None:
    ident = partagee(banc)
    identifiant = str(uuid4())
    reponse = ouvrir_analyse(banc, LECTEUR_GROUPE, ident, 1, identifiant)
    assert reponse.status_code == 202 and reponse.json() == {"recorded": True}
    ouvertes = [item for item in evenements(banc) if item["kind"] == "opened"]
    assert len(ouvertes) == 1
    assert ouvertes[0]["event_id"] == opened_id(
        CLE_D_USAGE, A, ident, PersonRef.of(LECTEUR_GROUPE.identite), identifiant
    )
    assert (ouvertes[0]["analysis_id"], ouvertes[0]["revision"]) == (ident, 1)
    ouvrir_analyse(banc, LECTEUR_GROUPE, ident, 1, identifiant)
    assert len([item for item in evenements(banc) if item["kind"] == "opened"]) == 1
    ouvrir_analyse(banc, LECTEUR_GROUPE, ident, 1)
    assert len([item for item in evenements(banc) if item["kind"] == "opened"]) == 2


def test_un_identifiant_client_ne_masque_pas_l_evenement_d_une_autre_analyse(banc: Banc) -> None:
    premiere, seconde = partagee(banc), partagee(banc)
    identifiant = str(uuid4())
    ouvrir_analyse(banc, LECTEUR_GROUPE, premiere, 1, identifiant)
    ouvrir_analyse(banc, LECTEUR_GROUPE, seconde, 1, identifiant)
    # Ni un identifiant dérivé d'une sauvegarde ou d'une exécution ne peut être pris pour un
    # identifiant d'ouverture.
    ouvrir_analyse(banc, LECTEUR_GROUPE, seconde, 1, saved_id("a" * 40, "save"))
    assert len([item for item in evenements(banc) if item["kind"] == "opened"]) == 3


def test_lire_n_ecrit_aucun_evenement(banc: Banc) -> None:
    ident = partagee(banc)
    avant = evenements(banc)
    for suite in ("", "/revisions", "/revisions/1", "/usage"):
        assert banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}{suite}").status_code == 200
    assert banc.appel(LECTEUR_GROUPE, "GET", CHEMIN).status_code == 200
    assert evenements(banc) == avant


def test_l_ouverture_suit_les_droits_de_lecture(banc: Banc) -> None:
    personnelle = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    masquee = banc.creer_ok(CREATEUR_GROUPE, name="Brouillon", visibility="personal")
    banc.reviser(CREATEUR_GROUPE, masquee, 1, visibility="shared", name="Publiée")
    supprimee = partagee(banc)
    banc.appel(
        CREATEUR_GROUPE, "DELETE", f"{CHEMIN}/{supprimee}", params={"expected_revision": "1"}
    )
    retiree = partagee(banc)
    banc.reviser(CREATEUR_GROUPE, retiree, 1, visibility="personal", name="Retirée du partage")
    for profil in (LECTEUR_GROUPE, ADMIN_GROUPE):
        refus_inconnu(ouvrir_analyse(banc, profil, personnelle, 1))
        refus_inconnu(ouvrir_analyse(banc, profil, retiree, 1))
        refus_inconnu(ouvrir_analyse(banc, profil, masquee, 1))
        refus_inconnu(ouvrir_analyse(banc, profil, new_id(), 1))
        refus_inconnu(ouvrir_analyse(banc, profil, masquee, 9))
    refus_inconnu(ouvrir_analyse(banc, CREATEUR_GROUPE, supprimee, 1))
    refus_inconnu(ouvrir_analyse(banc, CREATEUR_GROUPE, "pas-un-uuid", 1))
    assert ouvrir_analyse(banc, ADMIN_B, masquee, 2).status_code == 404
    assert ouvrir_analyse(banc, NON_MEMBRE, masquee, 2).status_code == 404
    assert banc.appel(None, "POST", f"{CHEMIN}/{masquee}/opened", json={}).status_code == 401
    assert [item for item in evenements(banc) if item["kind"] == "opened"] == []
    # Le propriétaire ouvre sa révision personnelle ; un lecteur ouvre la révision partagée.
    assert ouvrir_analyse(banc, CREATEUR_GROUPE, masquee, 1).status_code == 202
    assert ouvrir_analyse(banc, LECTEUR_GROUPE, masquee, 2).status_code == 202
    assert ouvrir_analyse(banc, LECTEUR_PERSONNE, masquee, 2).status_code == 202


@pytest.mark.parametrize(
    ("envoi", "champ"),
    [
        ({}, "event_id"),
        ({"event_id": str(uuid4())}, "revision"),
        ({"revision": 1}, "event_id"),
        ({"event_id": "x", "revision": 1}, "event_id"),
        ({"event_id": 3, "revision": 1}, "event_id"),
        ({"event_id": str(uuid4()).upper(), "revision": 1}, "event_id"),
        ({"event_id": str(uuid4()), "revision": 0}, "revision"),
        ({"event_id": str(uuid4()), "revision": "1"}, "revision"),
        ({"event_id": str(uuid4()), "revision": True}, "revision"),
        ({"event_id": str(uuid4()), "revision": 1_000_000_000}, "revision"),
        ({"event_id": str(uuid4()), "revision": 1, "personne": "x"}, "body"),
        ([], "body"),
    ],
)
def test_une_ouverture_mal_formee_est_refusee(banc: Banc, envoi: Any, champ: str) -> None:
    ident = partagee(banc)
    reponse = banc.appel(LECTEUR_GROUPE, "POST", f"{CHEMIN}/{ident}/opened", json=envoi)
    assert reponse.status_code == 400
    assert reponse.json() == {"error": {"code": "invalid_request", "field": champ}}
    assert [item for item in evenements(banc) if item["kind"] == "opened"] == []


# -- lecture de l'usage ---------------------------------------------------------------------


def test_l_usage_compte_par_sorte_sans_personne(banc: Banc) -> None:
    ident = partagee(banc)
    vide = usage(banc, LECTEUR_GROUPE, new_id())
    assert vide.status_code == 404
    ouvrir_analyse(banc, LECTEUR_GROUPE, ident, 1)
    ouvrir_analyse(banc, LECTEUR_PERSONNE, ident, 1)
    soumettre(banc, LECTEUR_GROUPE, reference(ident))
    ancien = banc.monde.horloge() - timedelta(days=40)
    UsageEvents(banc.monde.moteur, lambda: ancien).record(str(uuid4()), "opened", A, ident, 1)
    reponse = usage(banc, LECTEUR_GROUPE, ident)
    assert reponse.status_code == 200
    instant = banc.monde.horloge().isoformat()
    ancien_texte = ancien.isoformat()
    assert reponse.json() == {
        "id": ident,
        "usage": {
            "saved": {"total": 1, "last_30_days": 1, "last_at": instant},
            "opened": {"total": 3, "last_30_days": 2, "last_at": instant},
            "executed": {"total": 1, "last_30_days": 1, "last_at": instant},
        },
    }
    assert ancien_texte not in reponse.text
    # Rien ne désigne une personne : ni sujet, ni émetteur, ni nom.
    for profil in (LECTEUR_GROUPE, LECTEUR_PERSONNE, CREATEUR_GROUPE):
        assert profil.sujet not in reponse.text


def test_l_usage_d_une_analyse_sans_evenement(banc: Banc) -> None:
    ident = partagee(banc)
    with banc.monde.moteur.begin() as connexion:
        connexion.execute(analysis_events.delete())
    zero = {"total": 0, "last_30_days": 0, "last_at": None}
    assert usage(banc, LECTEUR_GROUPE, ident).json()["usage"] == {
        "saved": zero,
        "opened": zero,
        "executed": zero,
    }


def test_l_usage_suit_les_droits_de_lecture_de_l_analyse_courante(banc: Banc) -> None:
    personnelle = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    retiree = partagee(banc)
    banc.reviser(CREATEUR_GROUPE, retiree, 1, visibility="personal", name="Retirée")
    supprimee = partagee(banc)
    banc.appel(
        CREATEUR_GROUPE, "DELETE", f"{CHEMIN}/{supprimee}", params={"expected_revision": "1"}
    )
    for profil in (LECTEUR_GROUPE, ADMIN_GROUPE, CREATEUR_PERSONNE):
        for ident in (personnelle, retiree, new_id(), supprimee):
            refus_inconnu(usage(banc, profil, ident))
    refus_inconnu(usage(banc, CREATEUR_GROUPE, supprimee))
    refus_inconnu(usage(banc, CREATEUR_GROUPE, "pas-un-uuid"))
    assert usage(banc, CREATEUR_GROUPE, personnelle).status_code == 200
    assert usage(banc, CREATEUR_GROUPE, retiree).status_code == 200
    assert usage(banc, NON_MEMBRE, personnelle).status_code == 404
    assert usage(banc, None, personnelle).status_code == 401


# -- panne de la base -----------------------------------------------------------------------


def test_une_panne_de_la_base_ne_fait_jamais_echouer_l_action(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    ident = partagee(banc)
    avant = evenements(banc)
    monkeypatch.setattr(UsageEvents, "record", panne)
    creation = banc.creer(CREATEUR_GROUPE, visibility="shared")
    assert creation.status_code == 201 and "motdepasse" not in creation.text
    revisee = banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="shared", name="Deux")
    assert revisee.status_code == 201
    copie = banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN}/{ident}/duplicate")
    assert copie.status_code == 201
    execution = soumettre(banc, LECTEUR_GROUPE, reference(ident))
    assert execution.status_code == 202 and "motdepasse" not in execution.text
    ouverte = ouvrir_analyse(banc, LECTEUR_GROUPE, ident, 1)
    assert ouverte.status_code == 202 and ouverte.json() == {"recorded": False}
    # Un refus reste un refus : la panne ne le transforme pas en succès.
    refus_inconnu(soumettre(banc, LECTEUR_GROUPE, reference(new_id())))
    refus_inconnu(ouvrir_analyse(banc, LECTEUR_GROUPE, new_id(), 1))
    assert evenements(banc) == avant


def test_une_panne_de_lecture_de_l_usage_n_est_pas_un_succes(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    ident = partagee(banc)
    monkeypatch.setattr(UsageEvents, "usage", panne)
    reponse = usage(banc, LECTEUR_GROUPE, ident)
    assert reponse.status_code == 500 and "motdepasse" not in reponse.text


# -- mode local -----------------------------------------------------------------------------


def test_le_mode_local_refuse_les_nouvelles_routes(service: CatalogService, tmp_path: Path) -> None:
    from .monde import init, repository

    depot: ContentRepository = repository(init(tmp_path / "contenus"))
    app = create_app(service, content_repository=depot)
    with TestClient(app, base_url="http://127.0.0.1", raise_server_exceptions=False) as client:
        entetes = {"Origin": "http://127.0.0.1"}
        base = "/api/spaces/local/analyses"
        ident = new_id()
        appels: list[Callable[[], Any]] = [
            lambda: client.post(
                f"{base}/{ident}/opened",
                json={"event_id": str(uuid4()), "revision": 1},
                headers=entetes,
            ),
            lambda: client.get(f"{base}/{ident}/usage"),
            lambda: client.post(
                "/api/spaces/local/executions",
                json={**corps(), "analysis": reference(ident)},
                headers=entetes,
            ),
        ]
        for appel in appels:
            reponse = appel()
            assert reponse.status_code == 409
            assert reponse.json()["error"]["code"] == "local_mode"


# -- confidentialité ------------------------------------------------------------------------


def test_aucune_colonne_ne_peut_porter_une_personne_ou_une_valeur() -> None:
    assert [c.name for c in analysis_events.columns] == [
        "event_id",
        "kind",
        "space_id",
        "analysis_id",
        "revision",
        "occurred_at",
    ]
    genres = {c.name: type(c.type).__name__ for c in analysis_events.columns}
    # Que des identifiants courts, un entier et un instant : pas de texte libre ni de JSON.
    assert set(genres.values()) <= {"String", "Integer", "DateTime"}
    assert all(c.type.length <= 40 for c in analysis_events.columns if hasattr(c.type, "length"))
    interdits = ("actor", "owner", "person", "subject", "issuer", "email", "name", "value")
    assert not [c.name for c in analysis_events.columns if any(m in c.name for m in interdits)]


def test_les_evenements_ne_gardent_ni_personne_ni_valeur_ni_nom(banc: Banc) -> None:
    requete = {
        **corps()["query"],
        "filters": [{"column": "region", "operator": "eq", "value": SENTINELLE}],
    }
    ident = banc.creer_ok(
        CREATEUR_GROUPE, visibility="shared", name="Nom sentinelle d'analyse", query=requete
    )
    banc.reviser(
        CREATEUR_GROUPE, ident, 1, visibility="shared", name="Autre nom sentinelle", query=requete
    )
    banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN}/{ident}/duplicate")
    ouvrir_analyse(banc, LECTEUR_GROUPE, ident, 2)
    soumettre(
        banc,
        LECTEUR_GROUPE,
        reference(ident, 2),
        filters=[{"column": "region", "operator": "eq", "value": SENTINELLE}],
    )
    lignes = evenements(banc)
    assert {item["kind"] for item in lignes} == {"saved", "opened", "executed"}
    texte = repr(lignes).lower()
    for interdit in (
        SENTINELLE,
        "sentinelle",
        "cora",
        "lea",
        "ada",
        "finance-createurs",
        "https://",
        "example",
    ):
        assert interdit.lower() not in texte, interdit
    for ligne in lignes:
        assert set(ligne) == {
            "event_id",
            "kind",
            "space_id",
            "analysis_id",
            "revision",
            "occurred_at",
        }


# -- identifiant d'ouverture : pseudonymisation par la clé du serveur ---------------------------


def test_la_meme_personne_qui_rejoue_une_ouverture_ne_cree_pas_de_doublon(banc: Banc) -> None:
    ident = partagee(banc)
    identifiant = str(uuid4())
    for _ in range(3):
        assert ouvrir_analyse(banc, LECTEUR_GROUPE, ident, 1, identifiant).json() == {
            "recorded": True
        }
    assert len(evenements(banc, "opened")) == 1


def test_le_meme_identifiant_envoye_par_deux_personnes_donne_deux_lignes(banc: Banc) -> None:
    ident = partagee(banc)
    identifiant = str(uuid4())
    for profil in (LECTEUR_GROUPE, LECTEUR_PERSONNE, ADMIN_GROUPE):
        ouvrir_analyse(banc, profil, ident, 1, identifiant)
        ouvrir_analyse(banc, profil, ident, 1, identifiant)
    lignes = evenements(banc, "opened")
    assert len(lignes) == 3
    assert len({ligne["event_id"] for ligne in lignes}) == 3
    # Un lecteur ne peut donc pas masquer l'ouverture d'un autre en rejouant son identifiant.
    reponse = usage(banc, LECTEUR_GROUPE, ident)
    assert reponse.json()["usage"]["opened"]["total"] == 3


def test_l_identifiant_d_ouverture_depend_de_chaque_composante_et_de_la_cle() -> None:
    cle, autre = UsageKey(b"a" * 32), UsageKey(b"b" * 32)
    personne = PersonRef("https://idp.example.test", "user-1")
    client, analyse = str(uuid4()), str(uuid4())
    base = opened_id(cle, A, analyse, personne, client)
    assert base == opened_id(cle, A, analyse, personne, client)
    variantes = [
        opened_id(autre, A, analyse, personne, client),
        opened_id(cle, "autre-espace", analyse, personne, client),
        opened_id(cle, A, str(uuid4()), personne, client),
        opened_id(cle, A, analyse, PersonRef(personne.issuer, "user-2"), client),
        opened_id(cle, A, analyse, PersonRef("https://autre.example.test", "user-1"), client),
        opened_id(cle, A, analyse, personne, str(uuid4())),
        saved_id("a" * 40, "save"),
    ]
    assert len({base, *variantes}) == len(variantes) + 1
    # Rien de la personne ni de l'identifiant client n'apparaît dans l'identifiant dérivé.
    assert "user-1" not in base and client not in base


def test_les_ouvertures_sans_cle_du_serveur_sont_indisponibles(
    monde: Any, service: CatalogService, tmp_path: Path
) -> None:
    for banc in ouvrir(monde, service, tmp_path, usage_key=None):
        ident = partagee(banc)
        reponse = ouvrir_analyse(banc, LECTEUR_GROUPE, ident, 1)
        assert reponse.status_code == 503
        assert reponse.json() == {"error": {"code": "content_unavailable"}}
        assert evenements(banc, "opened") == []
        # Le reste des événements n'en dépend pas.
        assert soumettre(banc, LECTEUR_GROUPE, reference(ident)).status_code == 202
        assert len(evenements(banc, "executed")) == 1


def test_la_cle_se_lit_de_l_environnement_sans_jamais_etre_reprise() -> None:
    cle = base64.b64encode(b"k" * 32).decode()
    assert key_from_env({}) is None
    lue = key_from_env({KEY_VARIABLE: cle})
    assert lue is not None and lue.value == b"k" * 32
    assert cle not in repr(lue) and "kkkk" not in repr(lue)
    for invalide in ("", "pas du base64 !", base64.b64encode(b"court").decode(), cle + "A"):
        with pytest.raises(UsageConfigError) as erreur:
            key_from_env({KEY_VARIABLE: invalide})
        assert invalide not in str(erreur.value) or invalide == ""


def test_le_demarrage_exige_la_cle_quand_les_ouvertures_se_consignent() -> None:
    cle = base64.b64encode(b"k" * 32).decode()
    moteur = Mock()
    assert usage_key_runtime({KEY_VARIABLE: cle}, True, moteur) == UsageKey(b"k" * 32)
    # Sans dépôt de contenus ou sans base, rien ne se consigne : la clé n'est pas exigée.
    assert usage_key_runtime({}, False, moteur) is None
    assert usage_key_runtime({}, True, None) is None
    with pytest.raises(SystemExit, match=KEY_VARIABLE):
        usage_key_runtime({}, True, moteur)
    with pytest.raises(SystemExit, match=KEY_VARIABLE):
        usage_key_runtime({KEY_VARIABLE: "invalide"}, False, None)


# -- fenêtre de 30 jours -------------------------------------------------------------------------


def test_la_fenetre_de_trente_jours_est_fermee_aux_deux_bouts(banc: Banc) -> None:
    ident = partagee(banc)
    maintenant = banc.monde.horloge()
    micro = timedelta(microseconds=1)
    instants = {
        "trop_ancien": maintenant - timedelta(days=30) - micro,
        "borne_basse": maintenant - timedelta(days=30),
        "milieu": maintenant - timedelta(days=3),
        "borne_haute": maintenant,
        "futur": maintenant + micro,
    }
    for instant in instants.values():
        enregistrer_a(banc, instant, "executed", ident)
    trouve = usage(banc, LECTEUR_GROUPE, ident).json()["usage"]["executed"]
    # Quatre instants au plus 30 jours avant `now` moins le futur : trois dans la fenêtre.
    assert trouve["last_30_days"] == 3
    # `total` et `last_at` disent tout ce qui est consigné, instant futur compris.
    assert trouve["total"] == 5
    assert trouve["last_at"] == (maintenant + micro).isoformat()


def test_un_instant_futur_n_est_jamais_recent(banc: Banc) -> None:
    ident = partagee(banc)
    futur = banc.monde.horloge() + timedelta(days=2)
    enregistrer_a(banc, futur, "opened", ident)
    trouve = usage(banc, LECTEUR_GROUPE, ident).json()["usage"]["opened"]
    assert (trouve["total"], trouve["last_30_days"]) == (1, 0)
    assert trouve["last_at"] == futur.isoformat()
