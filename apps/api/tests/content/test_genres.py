"""Dépôt à plusieurs genres : analyses et dashboards côte à côte sans se toucher (plan 19.1, B1)."""

from __future__ import annotations

import dataclasses
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from skifer_board.content import (
    ANALYSIS_KIND,
    DASHBOARD_KIND,
    KINDS,
    ContentError,
    ContentRepository,
    Kind,
    Revision,
)
from skifer_board.content import dashboard as dashboard_format
from skifer_board.content.analysis import Change
from skifer_board.content.analysis import dumps as dump_analysis
from skifer_board.content.repository import Glance

from .monde import ACTOR, OTHER, commit, document, git, init, new_id, repository
from .monde_dashboard import dashboard

INSTANT = datetime(2026, 11, 5, 12, 30, 15, 999_999, tzinfo=UTC)


def code(erreur: pytest.ExceptionInfo[ContentError]) -> tuple[str, str]:
    return (erreur.value.code, erreur.value.reason)


def chemin(genre: str, espace: str, ident: str) -> str:
    return f"{genre}/{espace}/{ident}.yaml"


def octets(racine: Path, genre: str, espace: str, ident: str) -> bytes | None:
    """Octets du fichier d'un genre dans git, ou `None` s'il n'y est pas."""
    try:
        return git(racine, "show", f"HEAD:{chemin(genre, espace, ident)}").encode()
    except AssertionError:
        return None


def intact(racine: Path) -> None:
    """Dépôt cohérent et sans fichier que Board n'a pas à écrire, quel que soit le genre."""
    git(racine, "fsck", "--strict", "--no-dangling")
    inconnus = {
        p.relative_to(racine).as_posix()
        for p in racine.rglob("*")
        if p.is_file()
        and p.relative_to(racine).parts[0] not in {"objects", "refs", "logs", "hooks"}
        and p.name not in {"HEAD", "config", "description", "exclude", "board-content.lock"}
        and p.name != "packed-refs"
    }
    assert not inconnus
    assert not list(racine.rglob("*.tmp"))
    assert not list(racine.rglob("board-index-*"))


@pytest.fixture
def racine(tmp_path: Path) -> Path:
    return init(tmp_path / "contenus")


@pytest.fixture
def depot(racine: Path) -> ContentRepository:
    return repository(racine, clock=lambda: INSTANT)


def ecrire_analyse(depot: ContentRepository, espace: str, ident: str, **changes: Any) -> None:
    depot.write(espace, ident, document(ident, **changes), expected_revision=None, actor=ACTOR)


def ecrire_dashboard(depot: ContentRepository, espace: str, ident: str, **changes: Any) -> None:
    depot.write(
        espace,
        ident,
        dashboard(ident, **changes),
        expected_revision=None,
        actor=ACTOR,
        kind=DASHBOARD_KIND,
    )


# -- les genres ---------------------------------------------------------------------------------


def test_les_genres_sont_fermes_et_distincts() -> None:
    assert KINDS == (ANALYSIS_KIND, DASHBOARD_KIND)
    assert [(k.name, k.directory, k.reflog) for k in KINDS] == [
        ("analysis", "analyses", "board:"),
        ("dashboard", "dashboards", "board: dashboard"),
    ]
    assert [(k.invalid, k.not_found) for k in KINDS] == [
        ("invalid_analysis", "analysis_not_found"),
        ("invalid_dashboard", "dashboard_not_found"),
    ]


def test_le_genre_par_defaut_est_l_analyse(racine: Path, depot: ContentRepository) -> None:
    espace, ident = new_id(), new_id()
    ecrire_analyse(depot, espace, ident)
    assert depot.read(espace, ident) == depot.read(espace, ident, kind=ANALYSIS_KIND)
    assert depot.contents() == depot.contents(kind=ANALYSIS_KIND) == ((espace, ident),)
    assert octets(racine, "analyses", espace, ident) == dump_analysis(document(ident))


# -- genres fermés ------------------------------------------------------------------------------


def genres_non_identiques() -> list[Any]:
    """Ce qu'un appelant pourrait passer à la place d'une des deux constantes."""
    return [
        # copie d'une constante, égale mais non identique
        dataclasses.replace(ANALYSIS_KIND),
        dataclasses.replace(DASHBOARD_KIND),
        # genre « dashboard » qui pointerait vers le répertoire des analyses
        dataclasses.replace(DASHBOARD_KIND, directory="analyses"),
        dataclasses.replace(ANALYSIS_KIND, directory="dashboards"),
        # genre forgé de toutes pièces
        Kind(**{**dataclasses.asdict(DASHBOARD_KIND), "name": "rapport", "directory": "rapports"}),
        "dashboard",
        "analysis",
        None,
        object(),
    ]


def appels(depot: ContentRepository, kind: Any) -> dict[str, Callable[[], Any]]:
    espace, ident = new_id(), new_id()
    contenu = dashboard(ident)
    return {
        "read": lambda: depot.read(espace, ident, kind=kind),
        "history": lambda: depot.history(espace, ident, kind=kind),
        "entries": lambda: depot.entries(espace, ident, kind=kind),
        "glance": lambda: depot.glance(espace, ident, kind=kind),
        "contents": lambda: depot.contents(kind=kind),
        "latest": lambda: depot.latest(espace, kind=kind),
        "diff": lambda: depot.diff(espace, ident, 1, 2, kind=kind),
        "write": lambda: depot.write(
            espace, ident, contenu, expected_revision=None, actor=ACTOR, kind=kind
        ),
        "delete": lambda: depot.delete(espace, ident, expected_revision=1, actor=ACTOR, kind=kind),
    }


@pytest.mark.parametrize(
    "methode",
    ["read", "history", "entries", "glance", "contents", "latest", "diff", "write", "delete"],
)
@pytest.mark.parametrize("genre", range(len(genres_non_identiques())))
def test_un_genre_qui_n_est_pas_l_une_des_deux_constantes_est_refuse_partout(
    racine: Path, depot: ContentRepository, methode: str, genre: int
) -> None:
    avant = git(racine, "count-objects", "-v")
    with pytest.raises(TypeError, match="ANALYSIS_KIND ou DASHBOARD_KIND"):
        appels(depot, genres_non_identiques()[genre])[methode]()
    # refusé avant toute lecture ou écriture : le dépôt n'a même pas de tête
    assert git(racine, "count-objects", "-v") == avant
    assert git(racine, "rev-parse", "--verify", "--quiet", "HEAD", check=False).strip() == ""


def test_un_genre_copie_et_altere_ne_peut_pas_lire_le_repertoire_de_l_autre(
    depot: ContentRepository,
) -> None:
    espace, ident = new_id(), new_id()
    ecrire_analyse(depot, espace, ident)
    detourne = dataclasses.replace(DASHBOARD_KIND, directory="analyses")
    with pytest.raises(TypeError):
        depot.contents(kind=detourne)
    assert depot.contents(kind=DASHBOARD_KIND) == ()


# -- écriture d'un dashboard ----------------------------------------------------------------------


def test_un_dashboard_a_son_repertoire_son_format_et_ses_messages(
    racine: Path, depot: ContentRepository
) -> None:
    espace, ident = new_id(), new_id()
    contenu = dashboard(ident)
    sauvee = depot.write(
        espace, ident, contenu, expected_revision=None, actor=ACTOR, kind=DASHBOARD_KIND
    )
    assert sauvee.revision == Revision(
        1,
        git(racine, "rev-parse", "HEAD").strip(),
        INSTANT.replace(microsecond=0),
        ACTOR,
        "save",
    )
    assert sauvee.document == dashboard_format.validate(contenu)
    assert octets(racine, "dashboards", espace, ident) == dashboard_format.dumps(contenu)
    assert octets(racine, "analyses", espace, ident) is None
    message = git(racine, "log", "-1", "--format=%B")
    assert message.startswith(f"dashboard {espace}/{ident}: save r1\n\nBoard-Revision: 1\n")
    assert 'Board-Actor: {"issuer":"https://idp.example.test","subject":"user-0001"}' in message
    intact(racine)
    assert not (racine / "analyses").exists()


def test_un_dashboard_se_revise_se_relit_et_se_supprime(
    racine: Path, depot: ContentRepository
) -> None:
    espace, ident = new_id(), new_id()
    contenu = dashboard(ident)
    depot.write(espace, ident, contenu, expected_revision=None, actor=ACTOR, kind=DASHBOARD_KIND)
    deux = {**contenu, "name": "Deuxième"}
    resultat = depot.write(
        espace, ident, deux, expected_revision=1, actor=OTHER, kind=DASHBOARD_KIND
    )
    assert resultat.revision.number == 2
    assert depot.read(espace, ident, kind=DASHBOARD_KIND).revision == resultat.revision
    assert depot.read(espace, ident, 1, kind=DASHBOARD_KIND).document["name"] == "Pilotage"
    historique = depot.history(espace, ident, kind=DASHBOARD_KIND)
    assert [(r.number, r.actor) for r in historique] == [(1, ACTOR), (2, OTHER)]
    entrees = depot.entries(espace, ident, kind=DASHBOARD_KIND)
    assert [e.revision.number for e in entrees] == [1, 2]
    assert [e.document["name"] if e.document else None for e in entrees] == [
        "Pilotage",
        "Deuxième",
    ]
    supprimee = depot.delete(espace, ident, expected_revision=2, actor=OTHER, kind=DASHBOARD_KIND)
    assert supprimee.action == "delete"
    assert octets(racine, "dashboards", espace, ident) is None
    assert (
        git(racine, "log", "-1", "--format=%s").strip() == f"dashboard {espace}/{ident}: delete r2"
    )
    with pytest.raises(ContentError) as erreur:
        depot.read(espace, ident, kind=DASHBOARD_KIND)
    assert code(erreur) == ("dashboard_not_found", "missing")
    assert depot.read(espace, ident, 2, kind=DASHBOARD_KIND).document["name"] == "Deuxième"
    assert [(r.number, r.action) for r in depot.history(espace, ident, kind=DASHBOARD_KIND)] == [
        (1, "save"),
        (2, "save"),
        (2, "delete"),
    ]
    assert depot.contents(kind=DASHBOARD_KIND) == ()
    intact(racine)


def test_les_garanties_d_ecriture_valent_pour_un_dashboard(
    racine: Path, depot: ContentRepository
) -> None:
    espace, ident = new_id(), new_id()
    contenu = dashboard(ident)
    autre = {**contenu, "name": "b"}
    depot.write(espace, ident, contenu, expected_revision=None, actor=ACTOR, kind=DASHBOARD_KIND)
    avant = git(racine, "rev-parse", "HEAD").strip()
    with pytest.raises(ContentError) as erreur:
        depot.write(
            espace, ident, contenu, expected_revision=None, actor=ACTOR, kind=DASHBOARD_KIND
        )
    assert code(erreur) == ("revision_conflict", "exists")
    with pytest.raises(ContentError) as erreur:
        depot.write(espace, ident, autre, expected_revision=2, actor=ACTOR, kind=DASHBOARD_KIND)
    assert code(erreur) == ("revision_conflict", "stale")
    inchangee = depot.write(
        espace, ident, contenu, expected_revision=1, actor=OTHER, kind=DASHBOARD_KIND
    )
    assert inchangee.unchanged
    with pytest.raises(ContentError) as erreur:
        depot.delete(espace, ident, expected_revision=2, actor=ACTOR, kind=DASHBOARD_KIND)
    assert code(erreur) == ("revision_conflict", "stale")
    assert git(racine, "rev-parse", "HEAD").strip() == avant
    depot.delete(espace, ident, expected_revision=1, actor=ACTOR, kind=DASHBOARD_KIND)
    with pytest.raises(ContentError) as erreur:
        depot.write(
            espace, ident, contenu, expected_revision=None, actor=ACTOR, kind=DASHBOARD_KIND
        )
    assert code(erreur) == ("revision_conflict", "exists")
    with pytest.raises(ContentError) as erreur:
        depot.delete(espace, ident, expected_revision=1, actor=ACTOR, kind=DASHBOARD_KIND)
    assert code(erreur) == ("dashboard_not_found", "missing")


# -- codes de refus propres à chaque genre ----------------------------------------


def refus(
    depot: ContentRepository, kind: Any, espace: str, ident: str, contenu: Any
) -> tuple[str, str, tuple[tuple[str, str], ...]]:
    with pytest.raises(ContentError) as erreur:
        depot.write(espace, ident, contenu, expected_revision=None, actor=ACTOR, kind=kind)
    violations = tuple((v.path, v.rule) for v in erreur.value.violations)
    return (erreur.value.code, erreur.value.reason, violations)


def test_chaque_genre_refuse_avec_son_code(racine: Path, depot: ContentRepository) -> None:
    espace, ident = new_id(), new_id()
    # le document d'un genre écrit sous l'autre est refusé avec le code du genre demandé
    assert refus(depot, DASHBOARD_KIND, espace, ident, document(ident))[0] == "invalid_dashboard"
    assert refus(depot, ANALYSIS_KIND, espace, ident, dashboard(ident))[0] == "invalid_analysis"
    # identifiant du document différent de celui du chemin
    autre = new_id()
    assert refus(depot, DASHBOARD_KIND, espace, ident, dashboard(autre)) == (
        "invalid_dashboard",
        "id_mismatch",
        (("/id", "id_mismatch"),),
    )
    # identifiants de chemin invalides
    assert refus(depot, DASHBOARD_KIND, "Finance", ident, dashboard(ident)) == (
        "invalid_dashboard",
        "bad_identifier",
        (("/space_id", "bad_identifier"),),
    )
    with pytest.raises(ContentError) as erreur:
        depot.read(espace, "pas-un-uuid", kind=DASHBOARD_KIND)
    assert code(erreur) == ("invalid_dashboard", "bad_identifier")
    # acteur, révision attendue et numéro de révision invalides
    with pytest.raises(ContentError) as erreur:
        depot.write(
            espace,
            ident,
            dashboard(ident),
            expected_revision=None,
            actor=type(ACTOR)("", "x"),
            kind=DASHBOARD_KIND,
        )
    assert code(erreur) == ("invalid_dashboard", "bad_actor")
    with pytest.raises(ContentError) as erreur:
        depot.write(
            espace, ident, dashboard(ident), expected_revision=0, actor=ACTOR, kind=DASHBOARD_KIND
        )
    assert code(erreur) == ("invalid_dashboard", "bad_revision")
    with pytest.raises(ContentError) as erreur:
        depot.diff(espace, ident, 0, 1, kind=DASHBOARD_KIND)
    assert code(erreur) == ("invalid_dashboard", "bad_revision")
    # aucun refus n'a écrit quoi que ce soit
    assert git(racine, "rev-parse", "--verify", "--quiet", "HEAD", check=False).strip() == ""


def test_une_violation_de_dashboard_porte_son_chemin(depot: ContentRepository) -> None:
    espace, ident = new_id(), new_id()
    invalide = dashboard(ident, filters=[{"id": new_id()}])
    code_, _, violations = refus(depot, DASHBOARD_KIND, espace, ident, invalide)
    assert code_ == "invalid_dashboard"
    assert violations
    assert all(chemin_.startswith("/filters") for chemin_, _ in violations)


def test_un_dashboard_trop_gros_est_refuse_sans_ecriture(
    racine: Path, depot: ContentRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    from skifer_board.content import repository as module

    monkeypatch.setattr(module, "MAX_DOCUMENT_BYTES", 10)
    espace, ident = new_id(), new_id()
    assert refus(depot, DASHBOARD_KIND, espace, ident, dashboard(ident)) == (
        "invalid_dashboard",
        "out_of_bounds",
        (("", "out_of_bounds"),),
    )
    assert git(racine, "rev-parse", "--verify", "--quiet", "HEAD", check=False).strip() == ""


# -- isolation entre les genres ------------------------------------------------------------------


def test_un_meme_identifiant_dans_les_deux_genres_reste_deux_contenus(
    racine: Path, depot: ContentRepository
) -> None:
    espace, ident = new_id(), new_id()
    contenu = dashboard(ident)
    ecrire_analyse(depot, espace, ident)
    depot.write(espace, ident, contenu, expected_revision=None, actor=ACTOR, kind=DASHBOARD_KIND)
    assert octets(racine, "analyses", espace, ident) == dump_analysis(document(ident))
    assert octets(racine, "dashboards", espace, ident) == dashboard_format.dumps(contenu)
    assert depot.read(espace, ident).document["api_version"] == "board.analysis/v1"
    assert (
        depot.read(espace, ident, kind=DASHBOARD_KIND).document["api_version"]
        == "board.dashboard/v1"
    )
    assert depot.contents(kind=ANALYSIS_KIND) == depot.analyses() == ((espace, ident),)
    assert depot.contents(kind=DASHBOARD_KIND) == depot.dashboards() == ((espace, ident),)
    intact(racine)


def test_ecrire_un_genre_ne_touche_ni_l_historique_ni_les_revisions_de_l_autre(
    racine: Path, depot: ContentRepository
) -> None:
    espace, ident = new_id(), new_id()
    ecrire_analyse(depot, espace, ident)
    ecrire_dashboard(depot, espace, ident)
    # le numéro de révision de chaque genre est indépendant
    depot.write(
        espace,
        ident,
        dashboard(ident, name="D2"),
        expected_revision=1,
        actor=ACTOR,
        kind=DASHBOARD_KIND,
    )
    depot.write(
        espace,
        ident,
        dashboard(ident, name="D3"),
        expected_revision=2,
        actor=ACTOR,
        kind=DASHBOARD_KIND,
    )
    assert [r.number for r in depot.history(espace, ident)] == [1]
    assert [r.number for r in depot.history(espace, ident, kind=DASHBOARD_KIND)] == [1, 2, 3]
    avant_analyse = octets(racine, "analyses", espace, ident)
    depot.write(espace, ident, document(ident, name="A2"), expected_revision=1, actor=OTHER)
    assert [r.number for r in depot.history(espace, ident)] == [1, 2]
    assert [r.number for r in depot.history(espace, ident, kind=DASHBOARD_KIND)] == [1, 2, 3]
    assert octets(racine, "analyses", espace, ident) != avant_analyse
    assert depot.read(espace, ident, kind=DASHBOARD_KIND).document["name"] == "D3"
    # une écriture ne change que le fichier de son genre
    avant_dashboard = octets(racine, "dashboards", espace, ident)
    depot.write(espace, ident, document(ident, name="A3"), expected_revision=2, actor=OTHER)
    assert octets(racine, "dashboards", espace, ident) == avant_dashboard
    touches = git(racine, "show", "--name-only", "--format=", "HEAD").split()
    assert touches == [chemin("analyses", espace, ident)]


def test_supprimer_un_genre_laisse_l_autre_lisible(racine: Path, depot: ContentRepository) -> None:
    espace, ident = new_id(), new_id()
    ecrire_analyse(depot, espace, ident)
    ecrire_dashboard(depot, espace, ident)
    depot.delete(espace, ident, expected_revision=1, actor=ACTOR, kind=DASHBOARD_KIND)
    assert depot.read(espace, ident).document["name"] == "Chiffre d'affaires"
    assert depot.contents() == ((espace, ident),)
    assert depot.contents(kind=DASHBOARD_KIND) == ()
    depot.delete(espace, ident, expected_revision=1, actor=ACTOR)
    with pytest.raises(ContentError) as erreur:
        depot.read(espace, ident)
    assert code(erreur) == ("analysis_not_found", "missing")
    # l'histoire du dashboard supprimé est toujours la sienne
    assert [(r.number, r.action) for r in depot.history(espace, ident, kind=DASHBOARD_KIND)] == [
        (1, "save"),
        (1, "delete"),
    ]
    intact(racine)


def test_un_genre_ne_lit_jamais_le_repertoire_de_l_autre(
    racine: Path, depot: ContentRepository
) -> None:
    espace, seule_analyse, seul_dashboard = new_id(), new_id(), new_id()
    ecrire_analyse(depot, espace, seule_analyse)
    ecrire_dashboard(depot, espace, seul_dashboard)
    lectures: list[Any] = [
        lambda i, k: depot.read(espace, i, kind=k),
        lambda i, k: depot.history(espace, i, kind=k),
        lambda i, k: depot.entries(espace, i, kind=k),
    ]
    for lecture in lectures:
        with pytest.raises(ContentError) as erreur:
            lecture(seule_analyse, DASHBOARD_KIND)
        assert code(erreur) == ("dashboard_not_found", "missing")
        with pytest.raises(ContentError) as erreur:
            lecture(seul_dashboard, ANALYSIS_KIND)
        assert code(erreur) == ("analysis_not_found", "missing")
    assert depot.glance(espace, seule_analyse, kind=DASHBOARD_KIND) == Glance(None, None, False)
    assert depot.glance(espace, seul_dashboard) == Glance(None, None, False)
    assert depot.glance(espace, seule_analyse).owner == ACTOR
    assert depot.glance(espace, seul_dashboard, kind=DASHBOARD_KIND).owner == ACTOR
    assert set(depot.latest(espace)) == {seule_analyse}
    assert set(depot.latest(espace, kind=DASHBOARD_KIND)) == {seul_dashboard}
    assert depot.contents() == ((espace, seule_analyse),)
    assert depot.contents(kind=DASHBOARD_KIND) == ((espace, seul_dashboard),)


def test_un_fichier_pose_dans_le_mauvais_repertoire_n_est_lu_par_aucun_genre(
    racine: Path, depot: ContentRepository
) -> None:
    espace, ident = new_id(), new_id()
    commit(
        racine,
        {chemin("analyses", espace, ident): dashboard_format.dumps(dashboard(ident))},
        "étranger",
    )
    with pytest.raises(ContentError) as erreur:
        depot.read(espace, ident, kind=DASHBOARD_KIND)
    assert code(erreur) == ("dashboard_not_found", "missing")
    # pas de commit de Board : l'histoire de l'analyse est incohérente, jamais servie
    with pytest.raises(ContentError) as erreur:
        depot.read(espace, ident)
    assert code(erreur) == ("content_unavailable", "history_inconsistent")
    assert depot.contents(kind=DASHBOARD_KIND) == ()


def test_un_commit_de_l_autre_genre_n_est_pas_une_revision(
    racine: Path, depot: ContentRepository
) -> None:
    espace, ident = new_id(), new_id()
    ecrire_analyse(depot, espace, ident)
    brut = git(racine, "show", f"HEAD:{chemin('analyses', espace, ident)}").encode()
    # un outil étranger copie le fichier d'analyse sous dashboards/ avec le message de Board
    message = git(racine, "log", "-1", "--format=%B")
    commit(racine, {chemin("dashboards", espace, ident): brut}, message)
    with pytest.raises(ContentError) as erreur:
        depot.history(espace, ident, kind=DASHBOARD_KIND)
    assert code(erreur) == ("content_unavailable", "history_inconsistent")
    assert [r.number for r in depot.history(espace, ident)] == [1]


def test_les_chemins_qui_ne_sont_pas_ceux_de_board_sont_ignores(
    racine: Path, depot: ContentRepository
) -> None:
    espace, ident = new_id(), new_id()
    ecrire_dashboard(depot, espace, ident)
    commit(
        racine,
        {
            f"dashboards/{espace}/pas-un-uuid.yaml": b"x",
            f"dashboards/{espace}/{ident.upper()}.yaml": b"x",
            f"dashboards/{espace}/{ident}.yml": b"x",
            f"dashboards/Majuscule/{ident}.yaml": b"x",
            f"analyses/{espace}/{new_id()}.yaml": b"x",
        },
        "étranger",
    )
    assert depot.contents(kind=DASHBOARD_KIND) == ((espace, ident),)
    assert len(depot.contents(kind=ANALYSIS_KIND)) == 1
    assert set(depot.latest(espace, kind=DASHBOARD_KIND)) == {ident}


# -- lectures propres au genre ------------------------------------------------------------


def test_le_coup_d_oeil_d_un_dashboard_lit_son_en_tete(depot: ContentRepository) -> None:
    espace, perso, partage, supprime = new_id(), new_id(), new_id(), new_id()
    ecrire_dashboard(depot, espace, perso)
    ecrire_dashboard(depot, espace, partage, visibility="shared")
    ecrire_dashboard(depot, espace, supprime, visibility="shared")
    depot.delete(espace, supprime, expected_revision=1, actor=OTHER, kind=DASHBOARD_KIND)
    assert depot.glance(espace, perso, kind=DASHBOARD_KIND) == Glance(ACTOR, "personal", False)
    assert depot.glance(espace, partage, kind=DASHBOARD_KIND) == Glance(ACTOR, "shared", False)
    assert depot.glance(espace, supprime, kind=DASHBOARD_KIND) == Glance(ACTOR, "shared", True)
    assert depot.glance(espace, new_id(), kind=DASHBOARD_KIND) == Glance(None, None, False)


def test_un_dashboard_abime_se_rend_par_son_createur(
    racine: Path, depot: ContentRepository
) -> None:
    espace, ident = new_id(), new_id()
    ecrire_dashboard(depot, espace, ident)
    commit(racine, {chemin("dashboards", espace, ident): b"ceci n'est pas un dashboard\n"}, "x")
    assert depot.glance(espace, ident, kind=DASHBOARD_KIND) == Glance(ACTOR, None, False)
    with pytest.raises(ContentError) as erreur:
        depot.read(espace, ident, kind=DASHBOARD_KIND)
    assert code(erreur) == ("content_unavailable", "history_inconsistent")


def test_les_entrees_d_un_dashboard_masquent_ce_que_l_appelant_refuse(
    depot: ContentRepository,
) -> None:
    espace, ident = new_id(), new_id()
    ecrire_dashboard(depot, espace, ident, visibility="shared")
    depot.write(
        espace,
        ident,
        dashboard(ident, name="privé"),
        expected_revision=1,
        actor=ACTOR,
        kind=DASHBOARD_KIND,
    )
    vus: list[tuple[Any, Any, bool]] = []

    def allow(owner: Any, visibility: Any, deleted: bool) -> bool:
        vus.append((owner, visibility, deleted))
        return len(vus) == 1

    entrees = depot.entries(espace, ident, allow=allow, kind=DASHBOARD_KIND)
    assert [e.hidden for e in entrees] == [False, True]
    assert entrees[1].document is None
    assert vus == [(ACTOR, "shared", False), (ACTOR, "personal", False)]
    with pytest.raises(ContentError) as erreur:
        depot.entries(espace, new_id(), kind=DASHBOARD_KIND)
    assert code(erreur) == ("dashboard_not_found", "missing")


def test_la_tete_est_resolue_une_fois_pour_les_deux_genres(
    racine: Path, depot: ContentRepository
) -> None:
    espace, ident = new_id(), new_id()
    ecrire_dashboard(depot, espace, ident)
    tete = depot.head()
    depot.write(
        espace,
        ident,
        dashboard(ident, name="plus tard"),
        expected_revision=1,
        actor=ACTOR,
        kind=DASHBOARD_KIND,
    )
    assert depot.read(espace, ident, at=tete, kind=DASHBOARD_KIND).document["name"] == "Pilotage"
    assert depot.read(espace, ident, kind=DASHBOARD_KIND).document["name"] == "plus tard"
    assert [r.number for r in depot.history(espace, ident, at=tete, kind=DASHBOARD_KIND)] == [1]
    assert depot.glance(espace, ident, at=tete, kind=DASHBOARD_KIND).owner == ACTOR
    assert set(depot.latest(espace, at=tete, kind=DASHBOARD_KIND)) == {ident}
    assert depot.latest(espace, at=tete) == {}


def test_le_diff_d_un_dashboard_est_celui_du_format_des_dashboards(
    depot: ContentRepository,
) -> None:
    espace, ident = new_id(), new_id()
    contenu = dashboard(ident)
    depot.write(espace, ident, contenu, expected_revision=None, actor=ACTOR, kind=DASHBOARD_KIND)
    depot.write(
        espace,
        ident,
        {**contenu, "name": "Autre"},
        expected_revision=1,
        actor=ACTOR,
        kind=DASHBOARD_KIND,
    )
    assert depot.diff(espace, ident, 1, 2, kind=DASHBOARD_KIND) == (
        Change("/name", "modified", "Pilotage", "Autre", "dashboard"),
    )
    with pytest.raises(ContentError) as erreur:
        depot.diff(espace, ident, 1, 3, kind=DASHBOARD_KIND)
    assert code(erreur) == ("dashboard_not_found", "missing_revision")
