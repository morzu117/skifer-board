"""Réindexation depuis git : base vierge ou existante, analyses abîmées, codes de sortie
(plan 18.2, A4)."""

from __future__ import annotations

import os
import sys
import tomllib
from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from pathlib import Path

import pytest
from skifer_board.content import ContentError, ContentRepository
from skifer_board.content.index import AnalysisIndex, IndexRow
from skifer_board.content.reindex import ATTEMPTS, Report, RepositoryMoving, main, reindex
from skifer_board.state import DATABASE_URL
from sqlalchemy import Engine
from sqlalchemy.engine import URL
from sqlalchemy.exc import OperationalError
from state.conftest import MOT_DE_PASSE, environnement, injoignable

from .monde import ACTOR, OTHER, commit, document, init, new_id, relative, repository
from .test_index import INSTANT, ligne

REPERTOIRE = "SKIFER_BOARD_CONTENT_REPOSITORY"


@pytest.fixture
def racine(tmp_path: Path) -> Path:
    return init(tmp_path / "contenus")


@pytest.fixture
def depot(racine: Path) -> ContentRepository:
    return repository(racine, clock=lambda: INSTANT)


@pytest.fixture
def index(migre: Engine) -> AnalysisIndex:
    return AnalysisIndex(migre, lambda: INSTANT)


def ecrire(depot: ContentRepository, espace: str = "finance", **changes: object) -> str:
    ident = new_id()
    depot.write(espace, ident, document(ident, **changes), expected_revision=None, actor=ACTOR)
    return ident


def test_reconstruire_sur_une_base_vierge(depot: ContentRepository, index: AnalysisIndex) -> None:
    a = ecrire(depot, name="Alpha", visibility="shared")
    b = ecrire(depot, "rh", name="Beta")
    courante = depot.read("finance", a).document
    depot.write("finance", a, {**courante, "name": "Alpha 2"}, expected_revision=1, actor=OTHER)
    rapport = reindex(depot, index)
    assert rapport == Report(2, ())
    ligne_a = index.get("finance", a)
    assert ligne_a is not None
    assert (ligne_a.name, ligne_a.revision, ligne_a.visibility) == ("Alpha 2", 2, "shared")
    assert ligne_a.commit == depot.read("finance", a).revision.commit
    assert (ligne_a.model, ligne_a.metrics) == ("sales", ("revenue",))
    assert ligne_a.owner == ACTOR
    ligne_b = index.get("rh", b)
    assert ligne_b is not None and ligne_b.revision == 1


def test_reconstruire_sur_un_index_existant_remplace_tout(
    depot: ContentRepository, index: AnalysisIndex
) -> None:
    vivante = ecrire(depot)
    supprimee = ecrire(depot)
    depot.delete("finance", supprimee, expected_revision=1, actor=ACTOR)
    fantome = ligne()
    perimee = ligne(ident=vivante, name="Faux nom", revision=7, commit="f" * 40)
    index.upsert(fantome)
    index.upsert(perimee)
    index.upsert(ligne(ident=supprimee))
    assert reindex(depot, index) == Report(1, ())
    assert index.get("finance", fantome.analysis_id) is None
    assert index.get("finance", supprimee) is None
    relue = index.get("finance", vivante)
    assert relue is not None and (relue.name, relue.revision) == (
        "Chiffre d'affaires",
        1,
    )


def test_reconstruire_deux_fois_donne_le_meme_index(
    depot: ContentRepository, index: AnalysisIndex
) -> None:
    ecrire(depot)
    ecrire(depot, "rh")
    reindex(depot, index)
    premier = index.rows("finance") + index.rows("rh")
    reindex(depot, index)
    assert index.rows("finance") + index.rows("rh") == premier


def test_un_depot_vide_vide_l_index(depot: ContentRepository, index: AnalysisIndex) -> None:
    index.upsert(ligne())
    assert reindex(depot, index) == Report(0, ())
    assert index.rows("finance") == []


def test_une_analyse_abimee_est_nommee_et_les_autres_sont_indexees(
    depot: ContentRepository, index: AnalysisIndex, racine: Path
) -> None:
    saine, abimee = ecrire(depot), ecrire(depot)
    commit(racine, {relative("finance", abimee): b"api_version: x\n"}, "intrus")
    rapport = reindex(depot, index)
    assert rapport == Report(1, (("finance", abimee, "history_inconsistent"),))
    assert [item.analysis_id for item in index.rows("finance")] == [saine]


def test_un_echec_du_depot_arrete_la_reconstruction_sans_toucher_l_index(
    depot: ContentRepository, index: AnalysisIndex, monkeypatch: pytest.MonkeyPatch
) -> None:
    ecrire(depot)
    gardee = ligne()
    index.upsert(gardee)

    def indisponible(*args: object, **kwargs: object) -> None:
        raise ContentError("content_unavailable", "git_failed")

    monkeypatch.setattr(ContentRepository, "read", indisponible)
    with pytest.raises(ContentError):
        reindex(depot, index)
    assert index.rows("finance") == [gardee]


def test_une_analyse_disparue_entre_temps_est_ignoree(
    depot: ContentRepository, index: AnalysisIndex, monkeypatch: pytest.MonkeyPatch
) -> None:
    ecrire(depot)

    def disparue(*args: object, **kwargs: object) -> None:
        raise ContentError("analysis_not_found", "missing")

    monkeypatch.setattr(ContentRepository, "read", disparue)
    assert reindex(depot, index) == Report(0, ())


def ecrire_pendant_le_remplacement(
    depot: ContentRepository, monkeypatch: pytest.MonkeyPatch, fois: int
) -> list[str]:
    """Une écriture arrive dans la transaction du remplacement, avant la relecture de la tête,
    pour chacun des `fois` premiers remplacements."""
    arrivees: list[str] = []
    remplacer = AnalysisIndex.replace

    def remplacer_avec_ecriture(
        self: AnalysisIndex,
        rows: Iterable[IndexRow],
        before_commit: Callable[[], None] | None = None,
    ) -> int:
        def verifier() -> None:
            if len(arrivees) < fois:
                arrivees.append(ecrire(depot, name=f"Arrivée {len(arrivees)}"))
            assert before_commit is not None
            before_commit()

        return remplacer(self, rows, verifier)

    monkeypatch.setattr(AnalysisIndex, "replace", remplacer_avec_ecriture)
    return arrivees


def test_une_ecriture_pendant_le_remplacement_relance_la_reconstruction(
    depot: ContentRepository, index: AnalysisIndex, monkeypatch: pytest.MonkeyPatch
) -> None:
    ecrire(depot)
    arrivees = ecrire_pendant_le_remplacement(depot, monkeypatch, 1)
    assert reindex(depot, index) == Report(2, ())
    # Sans le second passage, l'écriture publiée pendant le remplacement manquerait à l'index.
    assert index.get("finance", arrivees[0]) is not None
    assert len(index.rows("finance")) == 2


def test_un_depot_qui_change_a_chaque_essai_laisse_l_index_intact(
    depot: ContentRepository, index: AnalysisIndex, monkeypatch: pytest.MonkeyPatch
) -> None:
    ecrire(depot)
    gardee = ligne()
    index.upsert(gardee)
    arrivees = ecrire_pendant_le_remplacement(depot, monkeypatch, 99)
    with pytest.raises(RepositoryMoving):
        reindex(depot, index)
    assert len(arrivees) == ATTEMPTS
    # Chaque passe ratée est annulée : l'index est exactement celui d'avant.
    assert index.rows("finance") == [gardee]
    # Un seul essai suffit à un dépôt calme.
    monkeypatch.undo()
    assert reindex(depot, index, attempts=1).indexed == 1 + ATTEMPTS


def test_une_tete_illisible_avant_le_commit_laisse_l_index_intact(
    depot: ContentRepository, index: AnalysisIndex, monkeypatch: pytest.MonkeyPatch
) -> None:
    ecrire(depot)
    gardee = ligne()
    index.upsert(gardee)
    lire = ContentRepository.head
    appels: list[int] = []

    def tete_puis_panne(self: ContentRepository) -> str | None:
        appels.append(1)
        if len(appels) == 2:
            raise ContentError("content_unavailable", "git_failed")
        return lire(self)

    monkeypatch.setattr(ContentRepository, "head", tete_puis_panne)
    with pytest.raises(ContentError):
        reindex(depot, index)
    assert len(appels) == 2
    assert index.rows("finance") == [gardee]


def test_le_remplacement_annule_garde_l_ancien_index(index: AnalysisIndex) -> None:
    gardee = ligne()
    index.upsert(gardee)

    def refuse() -> None:
        raise RuntimeError

    with pytest.raises(RuntimeError):
        index.replace([ligne(name="Autre")], refuse)
    assert index.rows("finance") == [gardee]


# -- commande ---------------------------------------------------------------------------------


def lancer(
    environ: dict[str, str], capsys: pytest.CaptureFixture[str], argv: list[str] | None = None
) -> tuple[int, str, str]:
    code = main([] if argv is None else argv, environ, lambda: datetime(2026, 11, 5, tzinfo=UTC))
    sortie = capsys.readouterr()
    assert MOT_DE_PASSE not in sortie.out + sortie.err
    return code, sortie.out, sortie.err


def environ(url: URL, racine: Path) -> dict[str, str]:
    return {**environnement(url), REPERTOIRE: str(racine)}


def test_la_commande_est_declaree_dans_le_paquet() -> None:
    projet = tomllib.loads((Path(__file__).parents[2] / "pyproject.toml").read_text())
    assert projet["project"]["scripts"]["skifer-board-reindex"] == (
        "skifer_board.content.reindex:main"
    )


def test_commande_sur_une_base_vierge_migree(
    database_url: URL,
    migre: Engine,
    depot: ContentRepository,
    racine: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    ident = ecrire(depot)
    code, sortie, erreur = lancer(environ(database_url, racine), capsys)
    assert (code, erreur) == (0, "")
    assert sortie == "1 analyse(s) indexée(s).\n"
    assert AnalysisIndex(migre).get("finance", ident) is not None


def test_commande_sur_un_index_existant(
    database_url: URL,
    migre: Engine,
    depot: ContentRepository,
    racine: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    ident = ecrire(depot)
    AnalysisIndex(migre).upsert(ligne())
    environnement_ = environ(database_url, racine)
    assert lancer(environnement_, capsys)[0] == 0
    assert lancer(environnement_, capsys)[0] == 0
    assert [item.analysis_id for item in AnalysisIndex(migre).rows("finance")] == [ident]


def test_commande_avec_une_analyse_illisible(
    database_url: URL,
    migre: Engine,
    depot: ContentRepository,
    racine: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    saine, abimee = ecrire(depot), ecrire(depot)
    commit(racine, {relative("finance", abimee): b"x: y\n"}, "intrus")
    code, sortie, erreur = lancer(environ(database_url, racine), capsys)
    assert code == 1
    assert sortie == "1 analyse(s) indexée(s).\n"
    assert erreur == f"Illisible : finance/{abimee} (history_inconsistent).\n"
    assert [item.analysis_id for item in AnalysisIndex(migre).rows("finance")] == [saine]


def test_commande_sans_depot_disponible(
    database_url: URL, migre: Engine, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    AnalysisIndex(migre).upsert(ligne())
    code, sortie, erreur = lancer(environ(database_url, tmp_path / "absent"), capsys)
    assert (code, sortie) == (1, "")
    assert erreur.startswith("Dépôt de contenus indisponible (")
    assert str(tmp_path) not in erreur
    assert len(AnalysisIndex(migre).rows("finance")) == 1


def test_commande_sur_une_base_sans_schema(
    database_url: URL, engine: Engine, racine: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, sortie, erreur = lancer(environ(database_url, racine), capsys)
    assert (code, sortie) == (1, "")
    assert erreur != ""


def test_commande_sur_une_base_injoignable(
    racine: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, sortie, erreur = lancer({DATABASE_URL: injoignable(), REPERTOIRE: str(racine)}, capsys)
    assert (code, sortie) == (1, "")
    assert erreur != ""


def test_commande_avec_une_base_qui_echoue_a_l_ecriture(
    database_url: URL,
    migre: Engine,
    racine: Path,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def echec(*args: object) -> None:
        raise OperationalError("INSERT", {}, Exception(f"postgresql://b:{MOT_DE_PASSE}@h/etat"))

    monkeypatch.setattr(AnalysisIndex, "replace", echec)
    code, sortie, erreur = lancer(environ(database_url, racine), capsys)
    assert (code, sortie) == (1, "")
    assert erreur.startswith("Réindexation impossible dans la base d'état")


def test_commande_sans_configuration(
    database_url: URL, racine: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, sortie, erreur = lancer({REPERTOIRE: str(racine)}, capsys)
    assert (code, sortie) == (2, "") and DATABASE_URL in erreur
    code, sortie, erreur = lancer(environnement(database_url), capsys)
    assert (code, sortie) == (2, "") and REPERTOIRE in erreur


def test_commande_avec_une_configuration_malformee(
    database_url: URL, racine: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, _, erreur = lancer({DATABASE_URL: "pas une adresse", REPERTOIRE: str(racine)}, capsys)
    assert code == 2 and DATABASE_URL in erreur
    code, _, erreur = lancer({**environnement(database_url), REPERTOIRE: "relatif/depot"}, capsys)
    assert code == 2 and REPERTOIRE in erreur


@pytest.mark.parametrize("argv", [["--force"], ["x", "y"], [""]])
def test_commande_avec_des_arguments(
    argv: list[str], database_url: URL, racine: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, sortie, erreur = lancer(environ(database_url, racine), capsys, argv)
    assert (code, sortie, erreur) == (2, "", "Usage : skifer-board-reindex\n")


def test_commande_lit_le_processus(
    database_url: URL,
    migre: Engine,
    depot: ContentRepository,
    racine: Path,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ecrire(depot)
    monkeypatch.setattr(os, "environ", environ(database_url, racine))
    monkeypatch.setattr(sys, "argv", ["skifer-board-reindex"])
    assert main() == 0
    assert "1 analyse(s)" in capsys.readouterr().out
    monkeypatch.setattr(sys, "argv", ["skifer-board-reindex", "--x"])
    assert main() == 2
    assert "Usage" in capsys.readouterr().err


def test_commande_sur_un_depot_qui_change_a_chaque_essai(
    database_url: URL,
    migre: Engine,
    depot: ContentRepository,
    racine: Path,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ecrire(depot)
    ecrire_pendant_le_remplacement(depot, monkeypatch, 99)
    code, sortie, erreur = lancer(environ(database_url, racine), capsys)
    assert (code, sortie) == (3, "")
    assert f"{ATTEMPTS} essais" in erreur and "relancer" in erreur
