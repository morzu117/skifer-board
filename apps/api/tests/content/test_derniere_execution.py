"""Preuves de la fiche : dernière exécution de la session qui référençait l'analyse (plan 18.3b).

Une exécution acceptée avec une référence valide garde deux identifiants (analyse, révision) ; la
route ne rend que les exécutions de la session qui la lit, jamais celles d'une autre personne,
et seulement si cette session peut lire l'analyse courante.
"""

from __future__ import annotations

import time
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from fastapi.testclient import TestClient
from skifer_board.catalog import CatalogService
from skifer_board.content import ContentRepository
from skifer_board.execution.runs import ExecutionState, ExecutionStore
from skifer_board.server import create_app
from skifer_board.spaces.model import GroupPrincipal, PersonRef
from skifer_board.spaces.store import SpaceStore
from skifer_board.state import current_revision, upgrade
from skifer_board.state.schema import executions, metadata
from spaces.monde import (
    ADMIN_GROUPE,
    CREATEUR_GROUPE,
    CREATEUR_PERSONNE,
    LECTEUR_GROUPE,
    LECTEUR_PERSONNE,
    NON_MEMBRE,
    PLATEFORME_SEULE,
    A,
    Profil,
)
from spaces.test_migration import jusqu_a
from sqlalchemy import Engine, inspect, select, text
from sqlalchemy.exc import DBAPIError

from .monde import ACTOR, commit, document, init, new_id, relative, repository
from .serveur import CHEMIN, Banc
from .test_index import INSTANT
from .test_usage import EXECUTIONS, INCONNUE, partagee, reference, refus_inconnu, soumettre

TERMINAUX = {"succeeded", "denied", "failed", "timed_out", "cancelled"}


def derniere(banc: Banc, profil: Profil | None, ident: str) -> Any:
    return banc.appel(profil, "GET", f"{CHEMIN}/{ident}/last-execution")


def attendre(banc: Banc, profil: Profil, execution: str) -> dict[str, Any]:
    """Résumé de l'exécution une fois terminée (la lecture elle-même ne la fait pas avancer)."""
    for _ in range(300):
        lue = banc.appel(profil, "GET", f"{EXECUTIONS}/{execution}")
        assert lue.status_code == 200, lue.text
        if lue.json()["state"] in TERMINAUX:
            corps: dict[str, Any] = lue.json()
            return corps
        time.sleep(0.02)
    pytest.fail("l'exécution ne se termine pas")


def executer(banc: Banc, profil: Profil, ident: str | None, revision: int = 1) -> dict[str, Any]:
    """Soumet, attend la fin, puis avance l'horloge : deux exécutions ne partagent pas d'instant."""
    envoi = soumettre(banc, profil, None if ident is None else reference(ident, revision))
    assert envoi.status_code == 202, envoi.text
    fin = attendre(banc, profil, envoi.json()["id"])
    banc.monde.horloge.instant += timedelta(seconds=1)
    return fin


# -- migration 0015 -------------------------------------------------------------------------


def test_migration_0015_depuis_0014(engine: Engine) -> None:
    jusqu_a(engine, "0014")
    SpaceStore(engine).create_space(
        "finance", "Finance", "atlas", GroupPrincipal("admins"), ACTOR, INSTANT
    )
    avant = {colonne["name"] for colonne in inspect(engine).get_columns("executions")}
    assert not {"analysis_id", "analysis_revision"} & avant
    ancienne = new_id()
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO executions (id, space_id, environment, issuer, subject,"
                " connection_name, request_hash, connector, endpoint_key, identity_mode,"
                " binding_set_at, state, created_at, deadline_at, lease_until, owner_id,"
                " cancel_requested) VALUES (:id, 'finance', 'DEV', 'i', 's', 'finance', 'h',"
                " 'duckdb', 'ventes', 'service', :at, 'succeeded', :at, :at, :at, :owner, false)"
            ),
            {"id": ancienne, "at": INSTANT, "owner": new_id()},
        )
    upgrade(engine)
    assert current_revision(engine) == "0015"
    assert SpaceStore(engine).get_space("finance") is not None
    inspecteur = inspect(engine)
    colonnes = {colonne["name"]: colonne for colonne in inspecteur.get_columns("executions")}
    for nom in ("analysis_id", "analysis_revision"):
        assert colonnes[nom]["nullable"] is True
    assert [i["column_names"] for i in inspecteur.get_indexes("executions")].count(
        ["space_id", "analysis_id", "issuer", "subject", "created_at"]
    ) == 1
    with engine.connect() as connection:
        # Une exécution d'avant la migration reste, sans référence.
        (reste,) = connection.execute(select(executions)).mappings().all()
        assert reste["id"] == ancienne and reste["state"] == "succeeded"
        assert (reste["analysis_id"], reste["analysis_revision"]) == (None, None)
        assert compare_metadata(MigrationContext.configure(connection), metadata) == []


def test_les_deux_colonnes_sont_posees_ensemble_ou_pas_du_tout(engine: Engine) -> None:
    upgrade(engine)
    SpaceStore(engine).create_space(
        "finance", "Finance", "atlas", GroupPrincipal("admins"), ACTOR, INSTANT
    )
    base = {
        "id": new_id(),
        "space_id": "finance",
        "environment": "DEV",
        "issuer": "i",
        "subject": "s",
        "connection_name": "finance",
        "request_hash": "h",
        "connector": "duckdb",
        "endpoint_key": "ventes",
        "identity_mode": "service",
        "binding_set_at": INSTANT,
        "state": "queued",
        "created_at": INSTANT,
        "deadline_at": INSTANT,
        "lease_until": INSTANT,
        "owner_id": new_id(),
        "cancel_requested": False,
    }
    for partiel in ({"analysis_id": new_id()}, {"analysis_revision": 1}):
        with (
            pytest.raises(DBAPIError, match="ck_executions_analysis"),
            engine.begin() as connection,
        ):
            connection.execute(executions.insert().values(**{**base, "id": new_id()}, **partiel))
    with engine.begin() as connection:
        connection.execute(executions.insert().values(**base))
        connection.execute(
            executions.insert().values(
                **{**base, "id": new_id()}, analysis_id=new_id(), analysis_revision=3
            )
        )


# -- ce qu'une exécution garde de la référence ----------------------------------------------


def lignes(banc: Banc) -> list[dict[str, Any]]:
    with banc.monde.moteur.connect() as connexion:
        return [dict(ligne) for ligne in connexion.execute(select(executions)).mappings().all()]


def test_une_reference_valide_ne_laisse_que_deux_identifiants(banc: Banc) -> None:
    ident = partagee(banc)
    fin = executer(banc, LECTEUR_GROUPE, ident)
    (ligne,) = lignes(banc)
    assert ligne["id"] == fin["id"]
    assert (ligne["analysis_id"], ligne["analysis_revision"]) == (ident, 1)
    # Ni le nom, ni la description, ni la requête de l'analyse : seulement ces deux valeurs.
    assert {nom for nom in ligne if nom.startswith("analysis")} == {
        "analysis_id",
        "analysis_revision",
    }


def test_sans_reference_rien_ne_change(banc: Banc) -> None:
    executer(banc, LECTEUR_GROUPE, None)
    (ligne,) = lignes(banc)
    assert (ligne["analysis_id"], ligne["analysis_revision"]) == (None, None)


def test_la_reference_reste_hors_de_l_empreinte_de_la_requete(banc: Banc) -> None:
    ident = partagee(banc)
    executer(banc, LECTEUR_GROUPE, None)
    executer(banc, LECTEUR_GROUPE, ident)
    banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="shared", name="Deux")
    executer(banc, LECTEUR_GROUPE, ident, 2)
    empreintes = {ligne["request_hash"] for ligne in lignes(banc)}
    assert len(lignes(banc)) == 3 and len(empreintes) == 1


def test_les_resumes_des_executions_ne_disent_rien_de_l_analyse(banc: Banc) -> None:
    ident = partagee(banc)
    fin = executer(banc, LECTEUR_GROUPE, ident)
    liste = banc.appel(LECTEUR_GROUPE, "GET", EXECUTIONS).json()["executions"]
    assert all("analysis" not in cle for item in [fin, *liste] for cle in item)
    assert ident not in banc.appel(LECTEUR_GROUPE, "GET", EXECUTIONS).text


# -- la route -------------------------------------------------------------------------------


def test_sans_execution_la_reponse_est_explicite(banc: Banc) -> None:
    ident = partagee(banc)
    for profil in (LECTEUR_GROUPE, LECTEUR_PERSONNE, CREATEUR_GROUPE, ADMIN_GROUPE):
        reponse = derniere(banc, profil, ident)
        assert reponse.status_code == 200, profil.nom
        assert reponse.json() == {"id": ident, "revision": None, "execution": None}


def test_la_derniere_execution_porte_sa_revision_et_ses_preuves(banc: Banc) -> None:
    ident = partagee(banc)
    fin = executer(banc, LECTEUR_GROUPE, ident)
    assert fin["state"] == "succeeded"
    reponse = derniere(banc, LECTEUR_GROUPE, ident)
    assert reponse.status_code == 200
    corps = reponse.json()
    assert set(corps) == {"id", "revision", "execution"}
    assert (corps["id"], corps["revision"]) == (ident, 1)
    execution = corps["execution"]
    # Le résumé est celui de la route d'une exécution, preuve comprise : rien d'inventé.
    assert execution == fin
    assert execution["state"] == "succeeded" and execution["error_code"] is None
    assert execution["evidence"]["evidence_id"] and execution["evidence"]["sql_hash"]
    assert execution["result_contract"]["completeness"] == "complete"
    assert all("analysis" not in cle for cle in execution)


def test_apres_une_revision_la_plus_recente_gagne_toutes_revisions_confondues(
    banc: Banc,
) -> None:
    ident = partagee(banc)
    premiere = executer(banc, LECTEUR_GROUPE, ident, 1)
    vue = derniere(banc, LECTEUR_GROUPE, ident).json()
    assert (vue["revision"], vue["execution"]["id"]) == (1, premiere["id"])
    assert (
        banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="shared", name="Deux").status_code == 201
    )
    # La révision existe mais n'a pas été exécutée : la dernière exécution reste celle de la 1.
    assert derniere(banc, LECTEUR_GROUPE, ident).json()["revision"] == 1
    deuxieme = executer(banc, LECTEUR_GROUPE, ident, 2)
    vue = derniere(banc, LECTEUR_GROUPE, ident).json()
    assert (vue["revision"], vue["execution"]["id"]) == (2, deuxieme["id"])
    # La plus récente gagne, pas la révision la plus haute.
    troisieme = executer(banc, LECTEUR_GROUPE, ident, 1)
    vue = derniere(banc, LECTEUR_GROUPE, ident).json()
    assert (vue["revision"], vue["execution"]["id"]) == (1, troisieme["id"])


def test_une_execution_sans_reference_est_absente_du_resultat(banc: Banc) -> None:
    ident = partagee(banc)
    executer(banc, LECTEUR_GROUPE, None)
    assert derniere(banc, LECTEUR_GROUPE, ident).json()["execution"] is None
    avec = executer(banc, LECTEUR_GROUPE, ident)
    executer(banc, LECTEUR_GROUPE, None)
    assert derniere(banc, LECTEUR_GROUPE, ident).json()["execution"]["id"] == avec["id"]


def test_une_reference_a_une_autre_analyse_n_est_pas_comptee(banc: Banc) -> None:
    une, autre = partagee(banc), partagee(banc)
    fin = executer(banc, LECTEUR_GROUPE, autre)
    assert derniere(banc, LECTEUR_GROUPE, une).json()["execution"] is None
    assert derniere(banc, LECTEUR_GROUPE, autre).json()["execution"]["id"] == fin["id"]


def test_deux_lecteurs_de_la_meme_analyse_ne_voient_que_leurs_executions(banc: Banc) -> None:
    ident = partagee(banc)
    lea = executer(banc, LECTEUR_GROUPE, ident)
    luc = executer(banc, LECTEUR_PERSONNE, ident)
    # `luc` a exécuté après `lea` : il est le dernier, mais seulement pour lui-même.
    vue_lea = derniere(banc, LECTEUR_GROUPE, ident)
    vue_luc = derniere(banc, LECTEUR_PERSONNE, ident)
    assert vue_lea.json()["execution"]["id"] == lea["id"]
    assert vue_luc.json()["execution"]["id"] == luc["id"]
    assert luc["id"] not in vue_lea.text and lea["id"] not in vue_luc.text
    # Qui n'a rien exécuté ne voit rien, même en gérant l'espace ou en ayant créé l'analyse.
    for profil in (CREATEUR_GROUPE, ADMIN_GROUPE, CREATEUR_PERSONNE):
        autre = derniere(banc, profil, ident)
        assert autre.json() == {"id": ident, "revision": None, "execution": None}, profil.nom
    # Ni un compte, ni un instant, ni un état ne trahit l'autre : quoi que fasse `luc`, la
    # réponse de `lea` ne change pas.
    for _ in range(2):
        executer(banc, LECTEUR_PERSONNE, ident)
    seconde = derniere(banc, LECTEUR_GROUPE, ident)
    assert seconde.json() == vue_lea.json()


def test_une_execution_refusee_se_lit_comme_un_refus(banc_sans_tenant: Banc) -> None:
    banc = banc_sans_tenant
    ident = partagee(banc)
    fin = executer(banc, LECTEUR_PERSONNE, ident)
    assert fin["state"] == "denied" and fin["error_code"] in {"deny", "require_human"}
    vue = derniere(banc, LECTEUR_PERSONNE, ident)
    assert vue.status_code == 200
    execution = vue.json()["execution"]
    assert execution == fin
    assert execution["state"] == "denied" and execution["evidence"] is None
    assert execution["rows"] is None and "result_contract" not in execution
    # Une exécution refusée ne devient pas un succès parce qu'une autre personne a réussi.
    reussie = executer(banc, LECTEUR_GROUPE, ident)
    assert reussie["state"] == "succeeded"
    assert derniere(banc, LECTEUR_PERSONNE, ident).json()["execution"]["state"] == "denied"
    assert derniere(banc, LECTEUR_GROUPE, ident).json()["execution"]["state"] == "succeeded"


# -- droits ---------------------------------------------------------------------------------


def signature(reponse: Any) -> tuple[int, bytes, dict[str, str]]:
    return reponse.status_code, reponse.content, dict(reponse.headers)


def test_tout_ce_qui_est_invisible_repond_comme_une_analyse_inexistante(banc: Banc) -> None:
    personnelle = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    retiree = partagee(banc)
    supprimee = partagee(banc)
    # Des exécutions existent déjà pour ces deux-là : elles ne rendent pas l'analyse lisible.
    executer(banc, LECTEUR_GROUPE, retiree)
    executer(banc, LECTEUR_GROUPE, supprimee)
    banc.reviser(CREATEUR_GROUPE, retiree, 1, visibility="personal", name="Retirée du partage")
    banc.appel(
        CREATEUR_GROUPE, "DELETE", f"{CHEMIN}/{supprimee}", params={"expected_revision": "1"}
    )
    abimee = partagee(banc)
    executer(banc, LECTEUR_GROUPE, abimee)
    commit(banc.racine, {relative(A, abimee): b"api_version: x\n"}, "intrus")
    ailleurs = new_id()
    banc.depot.write(
        "autre-espace",
        ailleurs,
        document(ailleurs, visibility="shared"),
        expected_revision=None,
        actor=ACTOR,
    )
    for profil in (LECTEUR_GROUPE, ADMIN_GROUPE, CREATEUR_PERSONNE, LECTEUR_PERSONNE):
        inexistante = derniere(banc, profil, new_id())
        refus_inconnu(inexistante)
        for nom, ident in (
            ("personnelle d'une autre personne", personnelle),
            ("partagée puis rendue personnelle", retiree),
            ("supprimée", supprimee),
            ("autre espace", ailleurs),
            ("abîmée", abimee),
            ("pas un identifiant", "pas-un-uuid"),
        ):
            refuse = derniere(banc, profil, ident)
            assert refuse.status_code == 404, (profil.nom, nom)
            comparee = derniere(banc, profil, new_id() if nom != "pas un identifiant" else "x")
            assert signature(refuse)[:2] == signature(comparee)[:2], (profil.nom, nom)
            assert refuse.headers == comparee.headers, (profil.nom, nom)
    # Le propriétaire de ce qui est personnel le lit ; supprimée, il ne le lit plus non plus.
    assert derniere(banc, CREATEUR_GROUPE, personnelle).status_code == 200
    assert derniere(banc, CREATEUR_GROUPE, retiree).status_code == 200
    refus_inconnu(derniere(banc, CREATEUR_GROUPE, supprimee))
    # L'exécution faite quand l'analyse était partagée n'est pas rendue une fois retirée.
    assert derniere(banc, LECTEUR_GROUPE, retiree).json() == INCONNUE


def test_matrice_des_droits(banc: Banc) -> None:
    ident = partagee(banc)
    executer(banc, LECTEUR_GROUPE, ident)
    attendu: list[tuple[Profil | None, int]] = [
        (LECTEUR_GROUPE, 200),
        (LECTEUR_PERSONNE, 200),
        (CREATEUR_GROUPE, 200),
        (CREATEUR_PERSONNE, 200),
        (ADMIN_GROUPE, 200),
        (NON_MEMBRE, 404),
        (PLATEFORME_SEULE, 403),
        (None, 401),
    ]
    for profil, statut in attendu:
        reponse = derniere(banc, profil, ident)
        assert reponse.status_code == statut, getattr(profil, "nom", "anonyme")
    # Les erreurs sont celles des autres routes de l'analyse, au mot près.
    for profil in (NON_MEMBRE, PLATEFORME_SEULE, None):
        lue = banc.appel(profil, "GET", f"{CHEMIN}/{ident}/usage")
        assert derniere(banc, profil, ident).json() == lue.json()


def test_la_route_n_accepte_que_la_lecture(banc: Banc) -> None:
    ident = partagee(banc)
    for methode in ("POST", "PUT", "DELETE", "PATCH"):
        reponse = banc.appel(LECTEUR_GROUPE, methode, f"{CHEMIN}/{ident}/last-execution")
        assert reponse.status_code in {403, 404, 405}, methode
    assert lignes(banc) == []


def test_le_droit_est_verifie_avant_toute_lecture_d_execution(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    lues: list[tuple[Any, ...]] = []
    reel = ExecutionStore.last_for_analysis

    def espion(self: ExecutionStore, *args: Any) -> Any:
        lues.append(args)
        return reel(self, *args)

    monkeypatch.setattr(ExecutionStore, "last_for_analysis", espion)
    personnelle = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    refus_inconnu(derniere(banc, LECTEUR_GROUPE, personnelle))
    refus_inconnu(derniere(banc, LECTEUR_GROUPE, new_id()))
    assert lues == []
    assert derniere(banc, CREATEUR_GROUPE, personnelle).status_code == 200
    assert lues == [(A, personnelle, CREATEUR_GROUPE.ref)]


def test_seules_les_executions_de_la_session_sont_lues(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    lues: list[PersonRef] = []
    ident = partagee(banc)
    executer(banc, LECTEUR_GROUPE, ident)
    reel = ExecutionStore.last_for_analysis

    def espion(self: ExecutionStore, espace: str, analyse: str, lecteur: PersonRef) -> Any:
        lues.append(lecteur)
        return reel(self, espace, analyse, lecteur)

    monkeypatch.setattr(ExecutionStore, "last_for_analysis", espion)
    derniere(banc, LECTEUR_PERSONNE, ident)
    assert lues == [LECTEUR_PERSONNE.ref]


def test_le_magasin_ne_rend_que_les_executions_de_la_personne(engine: Engine) -> None:
    upgrade(engine)
    SpaceStore(engine).create_space(
        "finance", "Finance", "atlas", GroupPrincipal("admins"), ACTOR, INSTANT
    )
    analyse = new_id()
    moi, autre = PersonRef("i", "moi"), PersonRef("i", "autre")
    magasin = ExecutionStore(engine)
    assert magasin.last_for_analysis("finance", analyse, moi) is None
    base = {
        "environment": "DEV",
        "connection_name": "finance",
        "request_hash": "h",
        "connector": "duckdb",
        "endpoint_key": "ventes",
        "identity_mode": "service",
        "binding_set_at": INSTANT,
        "state": ExecutionState.QUEUED.value,
        "deadline_at": INSTANT,
        "lease_until": INSTANT,
        "owner_id": new_id(),
        "cancel_requested": False,
    }

    def poser(personne: PersonRef, espace: str, instant: Any, ident: str, revision: int) -> str:
        cle = new_id()
        with engine.begin() as connexion:
            connexion.execute(
                executions.insert().values(
                    **base,
                    id=cle,
                    space_id=espace,
                    issuer=personne.issuer,
                    subject=personne.subject,
                    created_at=instant,
                    analysis_id=ident,
                    analysis_revision=revision,
                )
            )
        return cle

    SpaceStore(engine).create_space(
        "autre", "Autre", "atlas", GroupPrincipal("admins"), ACTOR, INSTANT
    )
    ancienne = poser(moi, "finance", INSTANT, analyse, 1)
    poser(autre, "finance", INSTANT + timedelta(minutes=5), analyse, 1)
    poser(moi, "autre", INSTANT + timedelta(minutes=6), analyse, 1)
    # Même sujet, autre émetteur : une autre personne.
    poser(PersonRef("j", "moi"), "finance", INSTANT + timedelta(minutes=9), analyse, 1)
    poser(moi, "finance", INSTANT + timedelta(minutes=7), new_id(), 1)
    trouvee = magasin.last_for_analysis("finance", analyse, moi)
    assert trouvee is not None and trouvee.id == ancienne
    assert (trouvee.analysis_id, trouvee.analysis_revision) == (analyse, 1)
    recente = poser(moi, "finance", INSTANT + timedelta(minutes=1), analyse, 4)
    trouvee = magasin.last_for_analysis("finance", analyse, moi)
    assert trouvee is not None and (trouvee.id, trouvee.analysis_revision) == (recente, 4)
    # À instant égal, l'identifiant départage : le résultat ne dépend pas de l'ordre de lecture.
    egales = sorted(poser(moi, "finance", INSTANT + timedelta(minutes=2), analyse, 2) for _ in "ab")
    trouvee = magasin.last_for_analysis("finance", analyse, moi)
    assert trouvee is not None and trouvee.id == egales[-1]
    with engine.connect() as connexion:
        assert connexion.execute(text("SELECT count(*) FROM executions")).scalar_one() == 8


def test_le_mode_local_refuse_la_route(service: CatalogService, tmp_path: Path) -> None:
    depot: ContentRepository = repository(init(tmp_path / "contenus"))
    app = create_app(service, content_repository=depot)
    with TestClient(app, base_url="http://127.0.0.1", raise_server_exceptions=False) as client:
        reponse = client.get(f"/api/spaces/local/analyses/{new_id()}/last-execution")
        assert reponse.status_code == 409
        assert reponse.json()["error"]["code"] == "local_mode"


def test_sans_depot_la_route_dit_le_contenu_indisponible(banc_sans_depot: Banc) -> None:
    reponse = derniere(banc_sans_depot, LECTEUR_GROUPE, new_id())
    assert reponse.status_code == 503
    assert reponse.json() == {"error": {"code": "content_unavailable"}}


def test_une_analyse_publiee_apres_coup_ne_donne_pas_les_executions_de_son_proprietaire(
    banc: Banc,
) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="personal", name="Brouillon")
    executer(banc, CREATEUR_GROUPE, ident, 1)
    refus_inconnu(derniere(banc, LECTEUR_GROUPE, ident))
    banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="shared", name="Publiée")
    # Publiée : lisible par tous ; la dernière exécution de chacun est la sienne.
    assert derniere(banc, LECTEUR_GROUPE, ident).json()["execution"] is None
    assert derniere(banc, CREATEUR_GROUPE, ident).json()["revision"] == 1
