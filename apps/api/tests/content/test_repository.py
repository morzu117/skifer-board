"""Dépôt de contenus : révisions, historique, suppression et diff sur dépôts jetables (18.1)."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from skifer_board.content import (
    ContentConfig,
    ContentConfigError,
    ContentError,
    ContentRepository,
    Revision,
    config_from_env,
    dumps,
    validate,
)
from skifer_board.content.analysis import Change
from skifer_board.spaces.model import PersonRef

from .monde import (
    ACTOR,
    OTHER,
    commit,
    document,
    fichier,
    git,
    init,
    new_id,
    propre,
    relative,
    repository,
)

INSTANT = datetime(2026, 11, 5, 12, 30, 15, 999_999, tzinfo=UTC)


def code(erreur: pytest.ExceptionInfo[ContentError]) -> tuple[str, str]:
    return (erreur.value.code, erreur.value.reason)


@pytest.fixture
def racine(tmp_path: Path) -> Path:
    return init(tmp_path / "contenus")


@pytest.fixture
def depot(racine: Path) -> ContentRepository:
    return repository(racine, clock=lambda: INSTANT)


def tete(racine: Path) -> str:
    return git(racine, "rev-parse", "HEAD").strip()


# -- configuration -------------------------------------------------------------------------


def test_configuration_absente_ou_vide() -> None:
    assert config_from_env({}) is None
    assert config_from_env({"SKIFER_BOARD_CONTENT_REPOSITORY": ""}) is None


def test_configuration_par_defaut_et_personnalisee(tmp_path: Path) -> None:
    variable = "SKIFER_BOARD_CONTENT_REPOSITORY"
    par_defaut = config_from_env({variable: str(tmp_path)})
    assert par_defaut == ContentConfig(tmp_path, "Skifer Board", "board@skifer.invalid")
    perso = config_from_env(
        {
            variable: str(tmp_path),
            "SKIFER_BOARD_CONTENT_AUTHOR_NAME": "Service Contenus",
            "SKIFER_BOARD_CONTENT_AUTHOR_EMAIL": "contenus@exemple.test",
        }
    )
    assert perso == ContentConfig(tmp_path, "Service Contenus", "contenus@exemple.test")


@pytest.mark.parametrize(
    "environ",
    [
        {"SKIFER_BOARD_CONTENT_REPOSITORY": "contenus"},
        {"SKIFER_BOARD_CONTENT_REPOSITORY": "/tmp", "SKIFER_BOARD_CONTENT_AUTHOR_NAME": "a<b>"},
        {"SKIFER_BOARD_CONTENT_REPOSITORY": "/tmp", "SKIFER_BOARD_CONTENT_AUTHOR_NAME": "a\nb"},
        {"SKIFER_BOARD_CONTENT_REPOSITORY": "/tmp", "SKIFER_BOARD_CONTENT_AUTHOR_NAME": "x" * 101},
        {
            "SKIFER_BOARD_CONTENT_REPOSITORY": "/tmp",
            "SKIFER_BOARD_CONTENT_AUTHOR_EMAIL": "sans-arobase",
        },
        {
            "SKIFER_BOARD_CONTENT_REPOSITORY": "/tmp",
            "SKIFER_BOARD_CONTENT_AUTHOR_EMAIL": "a b@c.test",
        },
        {
            "SKIFER_BOARD_CONTENT_REPOSITORY": "/tmp",
            "SKIFER_BOARD_CONTENT_AUTHOR_EMAIL": "<a@b.test>",
        },
    ],
)
def test_configuration_invalide(environ: dict[str, str]) -> None:
    with pytest.raises(ContentConfigError) as erreur:
        config_from_env(environ)
    assert "/tmp" not in str(erreur.value)


@pytest.mark.parametrize("delais", [{"timeout": 0}, {"lock_timeout": -1}])
def test_delais_invalides(tmp_path: Path, delais: dict[str, Any]) -> None:
    with pytest.raises(ContentConfigError):
        ContentConfig(tmp_path, **delais)


# -- cycle de vie --------------------------------------------------------------------------


def test_premiere_revision_dans_un_depot_sans_commit(
    racine: Path, depot: ContentRepository
) -> None:
    espace, ident = new_id(), new_id()
    sauvee = depot.write(espace, ident, document(ident), expected_revision=None, actor=ACTOR)
    revision = sauvee.revision
    assert revision == Revision(1, tete(racine), INSTANT.replace(microsecond=0), ACTOR, "save")
    assert sauvee.document == validate(document(ident))
    assert fichier(racine, espace, ident) == dumps(document(ident))
    propre(racine)
    assert git(racine, "rev-list", "--count", "HEAD").strip() == "1"
    assert git(racine, "log", "-1", "--format=%an|%ae|%cn|%ce|%cI").strip() == (
        "Skifer Board|board@skifer.invalid|Skifer Board|board@skifer.invalid|2026-11-05T12:30:15Z"
    )
    message = git(racine, "log", "-1", "--format=%B")
    assert message.startswith(f"analysis {espace}/{ident}: save r1\n\nBoard-Revision: 1\n")
    assert 'Board-Actor: {"issuer":"https://idp.example.test","subject":"user-0001"}' in message
    assert git(racine, "remote").strip() == ""


def test_les_revisions_s_enchainent_sans_toucher_au_reste(tmp_path: Path) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    depot = repository(racine)
    espace, ident = new_id(), new_id()
    depot.write(espace, ident, document(ident), expected_revision=None, actor=ACTOR)
    deux = document(ident, name="Deuxième")
    resultat = depot.write(espace, ident, deux, expected_revision=1, actor=OTHER)
    assert resultat.revision.number == 2
    assert resultat.revision.actor == OTHER
    assert git(racine, "rev-list", "--count", "HEAD").strip() == "3"
    assert git(racine, "ls-tree", "-r", "--name-only", "HEAD").split() == [
        "README.md",
        relative(espace, ident),
    ]
    assert git(racine, "show", "HEAD:README.md") == "contenus\n"
    propre(racine)
    courante = depot.read(espace, ident)
    assert courante.revision == resultat.revision
    assert courante.document["name"] == "Deuxième"
    assert depot.read(espace, ident, 1).document["name"] == "Chiffre d'affaires"
    historique = depot.history(espace, ident)
    assert [r.number for r in historique] == [1, 2]
    assert [r.actor for r in historique] == [ACTOR, OTHER]
    assert historique[1] == resultat.revision


def test_un_autre_depot_relit_les_memes_octets(racine: Path, depot: ContentRepository) -> None:
    espace, ident = new_id(), new_id()
    depot.write(espace, ident, document(ident), expected_revision=None, actor=ACTOR)
    autre = repository(racine)
    assert autre.read(espace, ident).document == validate(document(ident))
    brut = git(racine, "show", f"HEAD:{relative(espace, ident)}")
    assert brut.encode() == dumps(document(ident))


def test_deux_analyses_et_deux_espaces_sont_independants(
    racine: Path, depot: ContentRepository
) -> None:
    e1, e2, a1, a2 = new_id(), new_id(), new_id(), new_id()
    depot.write(e1, a1, document(a1), expected_revision=None, actor=ACTOR)
    depot.write(e2, a2, document(a2), expected_revision=None, actor=ACTOR)
    depot.write(e1, a1, document(a1, name="n"), expected_revision=1, actor=ACTOR)
    assert [r.number for r in depot.history(e1, a1)] == [1, 2]
    assert [r.number for r in depot.history(e2, a2)] == [1]
    with pytest.raises(ContentError) as erreur:
        depot.read(e2, a1)
    assert code(erreur) == ("analysis_not_found", "missing")


def test_un_texte_libre_unicode_fait_l_aller_retour_dans_git(depot: ContentRepository) -> None:
    espace, ident = new_id(), new_id()
    contenu = document(ident, name="Évolution — été 𝄞", description="Ligne 1\nLigne 2 : « ok »\n")
    depot.write(espace, ident, contenu, expected_revision=None, actor=ACTOR)
    assert depot.read(espace, ident).document == validate(contenu)


# -- conflits et absences ------------------------------------------------------------------


def test_une_revision_perimee_est_un_conflit_sans_ecriture(
    racine: Path, depot: ContentRepository
) -> None:
    espace, ident = new_id(), new_id()
    depot.write(espace, ident, document(ident), expected_revision=None, actor=ACTOR)
    depot.write(espace, ident, document(ident, name="b"), expected_revision=1, actor=ACTOR)
    avant = tete(racine)
    avant_octets = fichier(racine, espace, ident)
    for attendue in (1, 3):
        with pytest.raises(ContentError) as erreur:
            depot.write(
                espace, ident, document(ident, name="c"), expected_revision=attendue, actor=ACTOR
            )
        assert code(erreur) == ("revision_conflict", "stale")
    assert tete(racine) == avant
    assert fichier(racine, espace, ident) == avant_octets
    propre(racine)


def test_creer_deux_fois_est_un_conflit(depot: ContentRepository) -> None:
    espace, ident = new_id(), new_id()
    depot.write(espace, ident, document(ident), expected_revision=None, actor=ACTOR)
    with pytest.raises(ContentError) as erreur:
        depot.write(espace, ident, document(ident), expected_revision=None, actor=ACTOR)
    assert code(erreur) == ("revision_conflict", "exists")


def test_reviser_une_analyse_inconnue(racine: Path, depot: ContentRepository) -> None:
    espace, ident = new_id(), new_id()
    with pytest.raises(ContentError) as erreur:
        depot.write(espace, ident, document(ident), expected_revision=1, actor=ACTOR)
    assert code(erreur) == ("analysis_not_found", "missing")
    assert not (racine / "analyses").exists()


def test_lectures_d_une_analyse_inconnue_ou_d_un_depot_sans_commit(
    racine: Path, depot: ContentRepository
) -> None:
    espace, ident = new_id(), new_id()
    for lecture in (
        lambda: depot.read(espace, ident),
        lambda: depot.read(espace, ident, 1),
        lambda: depot.history(espace, ident),
        lambda: depot.diff(espace, ident, 1, 2),
    ):
        with pytest.raises(ContentError) as erreur:
            lecture()
        assert erreur.value.code == "analysis_not_found"
    commit(racine, {}, "vide")
    with pytest.raises(ContentError) as erreur:
        depot.history(espace, ident)
    assert code(erreur) == ("analysis_not_found", "missing")


def test_lire_une_revision_qui_n_existe_pas(depot: ContentRepository) -> None:
    espace, ident = new_id(), new_id()
    depot.write(espace, ident, document(ident), expected_revision=None, actor=ACTOR)
    with pytest.raises(ContentError) as erreur:
        depot.read(espace, ident, 2)
    assert code(erreur) == ("analysis_not_found", "missing_revision")


# -- suppression ---------------------------------------------------------------------------


def test_supprimer_garde_l_historique(racine: Path, depot: ContentRepository) -> None:
    espace, ident = new_id(), new_id()
    depot.write(espace, ident, document(ident), expected_revision=None, actor=ACTOR)
    depot.write(espace, ident, document(ident, name="b"), expected_revision=1, actor=ACTOR)
    supprimee = depot.delete(espace, ident, expected_revision=2, actor=OTHER)
    assert supprimee == Revision(2, tete(racine), INSTANT.replace(microsecond=0), OTHER, "delete")
    assert fichier(racine, espace, ident) is None
    propre(racine)
    assert git(racine, "rev-list", "--count", "HEAD").strip() == "3"
    assert (
        git(racine, "log", "-1", "--format=%s").strip() == f"analysis {espace}/{ident}: delete r2"
    )
    with pytest.raises(ContentError) as erreur:
        depot.read(espace, ident)
    assert code(erreur) == ("analysis_not_found", "missing")
    assert depot.read(espace, ident, 1).document["name"] == "Chiffre d'affaires"
    assert depot.read(espace, ident, 2).document["name"] == "b"
    with pytest.raises(ContentError):
        depot.read(espace, ident, 3)
    historique = depot.history(espace, ident)
    assert [(r.number, r.action) for r in historique] == [(1, "save"), (2, "save"), (2, "delete")]
    assert historique[-1] == supprimee
    assert depot.diff(espace, ident, 1, 2) == (
        Change("/name", "modified", "Chiffre d'affaires", "b"),
    )


def test_apres_suppression_plus_de_revision_ni_de_recreation(depot: ContentRepository) -> None:
    espace, ident = new_id(), new_id()
    depot.write(espace, ident, document(ident), expected_revision=None, actor=ACTOR)
    depot.delete(espace, ident, expected_revision=1, actor=ACTOR)
    with pytest.raises(ContentError) as erreur:
        depot.write(espace, ident, document(ident), expected_revision=1, actor=ACTOR)
    assert code(erreur) == ("analysis_not_found", "missing")
    with pytest.raises(ContentError) as erreur:
        depot.write(espace, ident, document(ident), expected_revision=None, actor=ACTOR)
    assert code(erreur) == ("revision_conflict", "exists")
    with pytest.raises(ContentError) as erreur:
        depot.delete(espace, ident, expected_revision=1, actor=ACTOR)
    assert code(erreur) == ("analysis_not_found", "missing")


def test_supprimer_exige_la_revision_courante(racine: Path, depot: ContentRepository) -> None:
    espace, ident = new_id(), new_id()
    with pytest.raises(ContentError) as erreur:
        depot.delete(espace, ident, expected_revision=1, actor=ACTOR)
    assert code(erreur) == ("analysis_not_found", "missing")
    depot.write(espace, ident, document(ident), expected_revision=None, actor=ACTOR)
    avant = tete(racine)
    with pytest.raises(ContentError) as erreur:
        depot.delete(espace, ident, expected_revision=2, actor=ACTOR)
    assert code(erreur) == ("revision_conflict", "stale")
    assert tete(racine) == avant
    assert fichier(racine, espace, ident) is not None


# -- diff ----------------------------------------------------------------------------------


def test_diff_entre_deux_revisions(depot: ContentRepository) -> None:
    espace, ident = new_id(), new_id()
    depot.write(espace, ident, document(ident), expected_revision=None, actor=ACTOR)
    deux = document(ident, visibility="shared")
    deux["query"]["metrics"] = ["revenue", "orders"]
    deux["contextual"] = []
    depot.write(espace, ident, deux, expected_revision=1, actor=ACTOR)
    assert depot.diff(espace, ident, 1, 2) == (
        Change("/visibility", "modified", "personal", "shared"),
        Change("/query/metrics/1", "added", None, "orders"),
        Change(
            "/contextual/0",
            "removed",
            {"operation": "aggregate", "metric": "revenue", "group_by": ["region"], "scope": None},
            None,
        ),
    )
    assert depot.diff(espace, ident, 2, 1)[0] == Change(
        "/visibility", "modified", "shared", "personal"
    )
    assert depot.diff(espace, ident, 2, 2) == ()
    with pytest.raises(ContentError) as erreur:
        depot.diff(espace, ident, 1, 3)
    assert erreur.value.code == "analysis_not_found"


# -- arguments invalides -------------------------------------------------------------------


def test_un_document_invalide_ne_touche_pas_au_depot(
    racine: Path, depot: ContentRepository
) -> None:
    espace, ident = new_id(), new_id()
    with pytest.raises(ContentError) as erreur:
        depot.write(
            espace, ident, document(ident, sql="SELECT 1"), expected_revision=None, actor=ACTOR
        )
    assert erreur.value.code == "invalid_analysis"
    assert [(v.path, v.rule) for v in erreur.value.violations] == [("/sql", "unknown_field")]
    assert not (racine / "analyses").exists()


def test_l_identifiant_du_document_doit_etre_celui_du_chemin(depot: ContentRepository) -> None:
    espace = new_id()
    with pytest.raises(ContentError) as erreur:
        depot.write(espace, new_id(), document(new_id()), expected_revision=None, actor=ACTOR)
    assert [(v.path, v.rule) for v in erreur.value.violations] == [("/id", "id_mismatch")]


@pytest.mark.parametrize("revision", [0, -1, True, "1", 1.0, 10**12])
def test_revision_attendue_invalide(depot: ContentRepository, revision: Any) -> None:
    espace, ident = new_id(), new_id()
    for appel in (
        lambda: depot.write(
            espace, ident, document(ident), expected_revision=revision, actor=ACTOR
        ),
        lambda: depot.delete(espace, ident, expected_revision=revision, actor=ACTOR),
        lambda: depot.read(espace, ident, revision),
        lambda: depot.diff(espace, ident, revision, 1),
        lambda: depot.diff(espace, ident, 1, revision),
    ):
        with pytest.raises(ContentError) as erreur:
            appel()
        assert [(v.path, v.rule) for v in erreur.value.violations] == [
            ("/revision", "bad_revision")
        ]


@pytest.mark.parametrize(
    "acteur",
    [
        ("", "s"),
        ("i", ""),
        ("i\nBoard-Revision: 99", "s"),
        ("i", "s\x00"),
        ("i", "s "),
        ("i", "x" * 513),
        ("i", "\ud800"),
    ],
)
def test_un_acteur_ne_peut_pas_forger_le_message(
    depot: ContentRepository, acteur: tuple[str, str]
) -> None:
    espace, ident = new_id(), new_id()
    personne = PersonRef(*acteur)
    for appel in (
        lambda: depot.write(espace, ident, document(ident), expected_revision=None, actor=personne),
        lambda: depot.delete(espace, ident, expected_revision=1, actor=personne),
    ):
        with pytest.raises(ContentError) as erreur:
            appel()
        assert [(v.path, v.rule) for v in erreur.value.violations] == [("/actor", "bad_actor")]


# -- horloge et identité -------------------------------------------------------------------


def test_identite_de_service_et_horloge_par_defaut(racine: Path) -> None:
    depot = repository(
        racine, config={"author_name": "Service é", "author_email": "s@exemple.test"}
    )
    espace, ident = new_id(), new_id()
    sauvee = depot.write(espace, ident, document(ident), expected_revision=None, actor=ACTOR)
    assert git(racine, "log", "-1", "--format=%an|%ae|%cn|%ce").strip() == (
        "Service é|s@exemple.test|Service é|s@exemple.test"
    )
    assert abs((datetime.now(UTC) - sauvee.revision.committed_at).total_seconds()) < 60
    assert depot.history(espace, ident)[0].committed_at == sauvee.revision.committed_at


def test_les_octets_sont_ceux_du_canon_meme_avec_des_attributs_git(racine: Path) -> None:
    commit(racine, {".gitattributes": b"* text=auto eol=crlf\n"}, "attributs")
    (racine / "info").mkdir(exist_ok=True)
    (racine / "info" / "attributes").write_text("* text eol=crlf\n")
    depot = repository(racine)
    espace, ident = new_id(), new_id()
    contenu = document(ident, description="a\nb")
    depot.write(espace, ident, contenu, expected_revision=None, actor=ACTOR)
    assert fichier(racine, espace, ident) == dumps(contenu)
    assert depot.read(espace, ident).document["description"] == "a\nb"
