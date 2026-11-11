"""Une tête, un en-tête d'abord : les lectures d'analyses épinglées d'un dashboard (plan 19.2).

- Une révision d'analyse privée n'est jamais chargée ni validée pour qui ne peut pas la voir : sa
  visibilité se juge sur son en-tête, sur son commit, avant son corps (`read(allow=...)`).
- Une requête résout la tête du dépôt une seule fois et la transmet à toutes ses lectures, le
  dashboard source comme les analyses épinglées : une publication qui arrive entre deux lectures
  n'est jamais vue.
- `delete(expected_head=...)` refuse, sous le verrou, une suppression jugée sur une autre tête.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

import pytest
from skifer_board.content import ContentError, ContentRepository
from skifer_board.content.dashboard_web import Pinned
from skifer_board.content.repository import DASHBOARD_KIND
from spaces.monde import CREATEUR_GROUPE, CREATEUR_PERSONNE, LECTEUR_GROUPE, A

from .monde import ACTOR, OTHER, document, init, new_id, repository
from .monde_dashboard import visual, with_components
from .serveur import CHEMIN_TABLEAUX, Banc
from .test_revisions_et_tete import (
    PUBLIC,
    SECRET,
    ancienne_abimee_puis_partagee,
    espionner_contenus,
)

CHEMIN_COMPOSANT = "/layout/sections/0/rows/0/columns/0/children/0/reference"


def analyse_privee_puis_partagee(banc: Banc) -> str:
    """Révision 1 personnelle (brouillon secret), révision 2 partagée."""
    ident = banc.creer_ok(CREATEUR_GROUPE, name=SECRET, visibility="personal")
    revisee = banc.reviser(CREATEUR_GROUPE, ident, 1, name=PUBLIC, visibility="shared")
    assert revisee.status_code == 201, revisee.text
    return ident


# -- repository.read(allow) ---------------------------------------------------------------------


def test_read_juge_l_en_tete_avant_de_charger_le_corps(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    depot = repository(init(tmp_path / "depot"))
    ident = new_id()
    depot.write(
        A,
        ident,
        document(ident, name=SECRET, visibility="personal"),
        expected_revision=None,
        actor=ACTOR,
    )
    depot.write(
        A,
        ident,
        document(ident, name=PUBLIC, visibility="shared"),
        expected_revision=1,
        actor=ACTOR,
    )
    lus = espionner_contenus(monkeypatch)
    vus: list[tuple[Any, Any, bool]] = []

    def refuser_le_personnel(owner: Any, visibility: Any, deleted: bool) -> bool:
        vus.append((owner, visibility, deleted))
        return bool(visibility == "shared")

    with pytest.raises(ContentError) as erreur:
        depot.read(A, ident, 1, allow=refuser_le_personnel)
    assert (erreur.value.code, erreur.value.reason) == ("analysis_not_found", "missing_revision")
    assert vus == [(ACTOR, "personal", False)]
    # Ni chargé, ni validé : aucun octet du brouillon n'a atteint le lecteur de documents.
    assert lus == []
    # La révision partagée passe, et c'est la seule dont le corps est lu.
    assert depot.read(A, ident, 2, allow=refuser_le_personnel).document["name"] == PUBLIC
    assert len(lus) == 1 and PUBLIC.encode() in lus[0]
    # Sans `allow`, rien ne change : tout est lu.
    assert depot.read(A, ident, 1).document["name"] == SECRET


def test_read_signale_la_suppression_et_l_en_tete_illisible_a_allow(tmp_path: Path) -> None:
    depot = repository(init(tmp_path / "depot"))
    ident = new_id()
    depot.write(A, ident, document(ident), expected_revision=None, actor=ACTOR)
    depot.delete(A, ident, expected_revision=1, actor=ACTOR)
    vus: list[tuple[Any, Any, bool]] = []

    def noter(owner: Any, visibility: Any, deleted: bool) -> bool:
        vus.append((owner, visibility, deleted))
        return True

    assert depot.read(A, ident, 1, allow=noter).revision.number == 1
    assert vus == [(ACTOR, "personal", True)]


def test_read_courante_est_jugee_comme_une_revision_numerotee(tmp_path: Path) -> None:
    depot = repository(init(tmp_path / "depot"))
    ident = new_id()
    depot.write(A, ident, document(ident), expected_revision=None, actor=ACTOR)
    with pytest.raises(ContentError) as erreur:
        depot.read(A, ident, allow=lambda *_: False)
    assert erreur.value.reason == "missing_revision"
    assert depot.read(A, ident, allow=lambda *_: True).revision.number == 1


# -- repository.delete(expected_head) -----------------------------------------------------------


def test_delete_exige_la_tete_attendue_sous_le_verrou(tmp_path: Path) -> None:
    depot = repository(init(tmp_path / "depot"))
    ident, autre = new_id(), new_id()
    depot.write(A, ident, document(ident), expected_revision=None, actor=ACTOR)
    juge = depot.head()
    depot.write(A, autre, document(autre), expected_revision=None, actor=OTHER)
    with pytest.raises(ContentError) as erreur:
        depot.delete(A, ident, expected_revision=1, actor=ACTOR, expected_head=juge)
    assert (erreur.value.code, erreur.value.reason) == ("revision_conflict", "head_changed")
    assert depot.read(A, ident).revision.number == 1
    removed = depot.delete(A, ident, expected_revision=1, actor=ACTOR, expected_head=depot.head())
    assert removed.action == "delete"
    with pytest.raises(ContentError):
        depot.read(A, ident)


# -- une révision privée n'est ni chargée ni validée --------------------------------------------


def test_une_epingle_privee_d_un_autre_n_est_pas_chargee_a_la_sauvegarde(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    ident = analyse_privee_puis_partagee(banc)
    lus = espionner_contenus(monkeypatch)
    reponse = banc.creer_tableau(CREATEUR_PERSONNE, visual(analysis_id=ident, revision=1))
    assert reponse.status_code == 422, reponse.text
    erreur = reponse.json()["error"]
    assert erreur["code"] == "invalid_dashboard"
    assert [item["rule"] for item in erreur["violations"]] == ["analysis_unavailable"]
    assert SECRET not in reponse.text
    # La seule révision lue est la courante (2), jamais le brouillon privé de la révision 1.
    assert not any(SECRET.encode() in brut for brut in lus)
    # Témoin : son propriétaire l'épingle, et le brouillon est alors bien chargé.
    bonne = banc.creer_tableau(CREATEUR_GROUPE, visual(analysis_id=ident, revision=1))
    assert bonne.status_code == 201, bonne.text
    assert any(SECRET.encode() in brut for brut in lus)


def test_une_epingle_privee_d_un_autre_n_est_pas_chargee_a_la_lecture(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    ident = analyse_privee_puis_partagee(banc)
    tableau = new_id()
    proprietaire = {"issuer": CREATEUR_GROUPE.ref.issuer, "subject": CREATEUR_GROUPE.ref.subject}
    composant = visual(analysis_id=ident, revision=1)
    banc.depot.write(
        A,
        tableau,
        with_components(composant, dashboard_id=tableau, visibility="shared", owner=proprietaire),
        expected_revision=None,
        actor=CREATEUR_GROUPE.ref,
        kind=DASHBOARD_KIND,
    )
    lus = espionner_contenus(monkeypatch)
    reponse = banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{tableau}")
    assert reponse.status_code == 200, reponse.text
    assert reponse.json()["components"] == [
        {"id": composant["id"], "state": "unavailable", "reason": "analysis_unavailable"}
    ]
    assert SECRET not in reponse.text
    assert not any(SECRET.encode() in brut for brut in lus)


# -- une seule tête par requête -----------------------------------------------------------------


def piege_apres_la_tete(
    banc: Banc, monkeypatch: pytest.MonkeyPatch, evenement: Any
) -> Counter[str]:
    """Quand la requête a résolu sa tête, `evenement()` publie dans git : toute lecture qui
    résoudrait une autre tête verrait cette publication."""
    faits: Counter[str] = Counter()
    original = ContentRepository.head

    def espion(self: ContentRepository) -> str | None:
        tete = original(self)
        faits["tetes"] += 1
        if faits["tetes"] == 1:
            evenement()
        return tete

    monkeypatch.setattr(ContentRepository, "head", espion)
    return faits


def supprimer_l_analyse(banc: Banc, analyse: str) -> Any:
    def evenement() -> None:
        banc.depot.delete(A, analyse, expected_revision=1, actor=CREATEUR_GROUPE.ref)

    return evenement


def tableau_epinglant(banc: Banc, analyse: str) -> tuple[str, dict[str, Any]]:
    composant = visual(analysis_id=analyse)
    identifiant = banc.creer_tableau_ok(CREATEUR_GROUPE, composant, visibility="shared")
    return identifiant, composant


@pytest.mark.parametrize("action", ["lecture", "revision", "reviser", "dupliquer", "creer"])
def test_une_publication_concurrente_n_est_jamais_vue_par_la_requete(
    banc: Banc, monkeypatch: pytest.MonkeyPatch, action: str
) -> None:
    """L'analyse est supprimée dans git après que la requête a résolu sa tête : le dashboard
    source, la validation et l'état de la réponse la voient encore, tous sur la même tête."""
    analyse = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    tableau, composant = tableau_epinglant(banc, analyse)
    faits = piege_apres_la_tete(banc, monkeypatch, supprimer_l_analyse(banc, analyse))
    if action == "lecture":
        reponse = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{tableau}")
        attendu = 200
    elif action == "revision":
        reponse = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{tableau}/revisions/1")
        attendu = 200
    elif action == "reviser":
        reponse = banc.reviser_tableau(
            CREATEUR_GROUPE, tableau, 1, composant, visibility="shared", name="Renommé"
        )
        attendu = 201
    elif action == "dupliquer":
        reponse = banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN_TABLEAUX}/{tableau}/duplicate")
        attendu = 201
    else:
        reponse = banc.creer_tableau(CREATEUR_GROUPE, visual(analysis_id=analyse))
        attendu = 201
    assert reponse.status_code == attendu, reponse.text
    assert faits["tetes"] == 1
    assert [item["state"] for item in reponse.json()["components"]] == ["ready"]
    assert reponse.json()["state"] in {"ready", "index_stale"}
    # Témoin : la requête suivante, sur la tête d'après, voit la suppression.
    suivante = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{tableau}")
    assert suivante.json()["components"][0]["reason"] == "analysis_unavailable"


def test_une_analyse_publiee_apres_la_tete_n_est_pas_vue_a_la_sauvegarde(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """La même garantie dans l'autre sens : une analyse qui paraît pendant la requête n'existe pas
    pour elle."""
    analyse = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    tableau, composant = tableau_epinglant(banc, analyse)
    nouvelle = new_id()

    def evenement() -> None:
        banc.depot.write(
            A,
            nouvelle,
            document(
                nouvelle,
                visibility="shared",
                owner={
                    "issuer": CREATEUR_GROUPE.ref.issuer,
                    "subject": CREATEUR_GROUPE.ref.subject,
                },
            ),
            expected_revision=None,
            actor=CREATEUR_GROUPE.ref,
        )

    faits = piege_apres_la_tete(banc, monkeypatch, evenement)
    reponse = banc.reviser_tableau(
        CREATEUR_GROUPE, tableau, 1, composant, visual(analysis_id=nouvelle), visibility="shared"
    )
    assert reponse.status_code == 422, reponse.text
    assert [item["rule"] for item in reponse.json()["error"]["violations"]] == [
        "analysis_unavailable"
    ]
    assert faits["tetes"] == 1


def test_un_depot_vide_n_a_aucune_analyse_epinglable(tmp_path: Path) -> None:
    """Sans tête (dépôt sans commit), aucune analyse n'existe : le contrôle ne relit pas de tête."""
    vide = repository(init(tmp_path / "vide"))
    assert vide.head() is None
    lues = Pinned(vide, A, CREATEUR_GROUPE.ref, None).of(
        with_components(visual(analysis_id=new_id()))
    )
    assert list(lues.values()) == [None]


def test_une_revision_epinglee_dont_l_en_tete_est_illisible_est_indisponible(banc: Banc) -> None:
    """Révision 1 saine, 2 abîmée hors de Board, 3 partagée : épingler la 2 ne dit rien d'elle, pas
    même à la personne qui a créé l'analyse, et rien n'est chargé qui permette de la juger."""
    ident = ancienne_abimee_puis_partagee(banc)
    reponse = banc.creer_tableau(CREATEUR_GROUPE, visual(analysis_id=ident, revision=2))
    assert reponse.status_code == 422, reponse.text
    assert [item["rule"] for item in reponse.json()["error"]["violations"]] == [
        "analysis_unavailable"
    ]
    # La révision 3, partagée, reste épinglable.
    assert (
        banc.creer_tableau(CREATEUR_GROUPE, visual(analysis_id=ident, revision=3)).status_code
        == 201
    )
