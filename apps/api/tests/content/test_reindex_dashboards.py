"""Réindexation des deux genres depuis git : analyses et dashboards en une seule transaction,
dashboards abîmés ou supprimés, atomicité, codes de sortie (plan 19.2, B5)."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from pathlib import Path

import pytest
from skifer_board.content import ContentError, ContentRepository
from skifer_board.content import repository as repository_module
from skifer_board.content.index import (
    AnalysisIndex,
    DashboardIndex,
    DashboardRow,
    IndexRow,
    Reference,
)
from skifer_board.content.reindex import ATTEMPTS, Report, RepositoryMoving
from skifer_board.content.reindex import reindex as reindex_both
from skifer_board.content.repository import (
    ANALYSIS_KIND,
    DASHBOARD_KIND,
    Kind,
)
from sqlalchemy import Connection, Engine
from sqlalchemy.engine import URL
from sqlalchemy.exc import DBAPIError, OperationalError

from .monde import ACTOR, OTHER, commit, document, git, init, new_id, repository
from .monde_dashboard import column, dashboard, kpi, row, section, text, visual
from .test_index import INSTANT, ligne
from .test_index_dashboards import tableau
from .test_reindex import environ, lancer


@pytest.fixture
def racine(tmp_path: Path) -> Path:
    return init(tmp_path / "contenus")


@pytest.fixture
def depot(racine: Path) -> ContentRepository:
    return repository(racine, clock=lambda: INSTANT)


@pytest.fixture
def index(migre: Engine) -> AnalysisIndex:
    return AnalysisIndex(migre, lambda: INSTANT)


@pytest.fixture
def tableaux(migre: Engine) -> DashboardIndex:
    return DashboardIndex(migre, lambda: INSTANT)


def reindex(
    depot: ContentRepository,
    index: AnalysisIndex,
    tableaux: DashboardIndex,
    attempts: int = ATTEMPTS,
) -> Report:
    return reindex_both(depot, index, tableaux, attempts)


def ecrire(depot: ContentRepository, espace: str = "finance", **changes: object) -> str:
    """Une analyse dans le dépôt."""
    ident = new_id()
    depot.write(espace, ident, document(ident, **changes), expected_revision=None, actor=ACTOR)
    return ident


def ecrire_tableau(
    depot: ContentRepository,
    espace: str = "finance",
    *composants: dict[str, object],
    **changes: object,
) -> str:
    """Un dashboard dans le dépôt (un visuel quelconque si aucun composant n'est donné)."""
    ident = new_id()
    contenu = dashboard(
        ident,
        **{"layout": {"sections": [section(row(column(*(composants or (visual(),)))))]}, **changes},
    )
    depot.write(espace, ident, contenu, expected_revision=None, actor=ACTOR, kind=DASHBOARD_KIND)
    return ident


def chemin(espace: str, ident: str) -> str:
    return f"dashboards/{espace}/{ident}.yaml"


def ids(lignes: Iterable[DashboardRow]) -> list[str]:
    return [item.dashboard_id for item in lignes]


# -- reconstruction ---------------------------------------------------------------------------


def test_reconstruire_les_deux_genres_depuis_rien(
    depot: ContentRepository, index: AnalysisIndex, tableaux: DashboardIndex
) -> None:
    a = ecrire(depot, name="Alpha", visibility="shared")
    b = ecrire(depot, "rh")
    c1, c2, c3 = new_id(), new_id(), new_id()
    t = ecrire_tableau(
        depot,
        "finance",
        visual(c1, a, 1, chart="line"),
        kpi(c2, a, 1),
        text(),
        name="Pilotage",
        visibility="shared",
    )
    u = ecrire_tableau(depot, "rh", visual(c3, b, 1))
    courant = depot.read("finance", t, kind=DASHBOARD_KIND).document
    depot.write(
        "finance",
        t,
        {**courant, "name": "Pilotage 2"},
        expected_revision=1,
        actor=OTHER,
        kind=DASHBOARD_KIND,
    )
    rapport = reindex(depot, index, tableaux)
    assert rapport == Report(2, (), 2, ())
    assert (rapport.indexed, rapport.dashboards) == (2, 2)
    ligne_t = tableaux.get("finance", t)
    assert ligne_t is not None
    assert (ligne_t.name, ligne_t.revision, ligne_t.visibility, ligne_t.owner) == (
        "Pilotage 2",
        2,
        "shared",
        ACTOR,
    )
    assert ligne_t.commit == depot.read("finance", t, kind=DASHBOARD_KIND).revision.commit
    assert ligne_t.references == tuple(Reference(c, a, 1) for c in sorted([c1, c2]))
    ligne_u = tableaux.get("rh", u)
    assert ligne_u is not None and ligne_u.references == (Reference(c3, b, 1),)
    assert ids(tableaux.consumers("finance", a)) == [t]
    assert ids(tableaux.consumers("rh", b)) == [u]
    assert ids(tableaux.consumers("finance", b)) == []
    assert index.get("finance", a) is not None and index.get("rh", b) is not None


def test_un_depot_sans_dashboard_vide_leur_index(
    depot: ContentRepository, index: AnalysisIndex, tableaux: DashboardIndex
) -> None:
    ecrire(depot)
    tableaux.upsert(tableau(references=(Reference(new_id(), new_id(), 1),)))
    assert reindex(depot, index, tableaux) == Report(1, (), 0, ())
    assert tableaux.rows("finance") == []


def test_un_depot_sans_analyse_garde_ses_dashboards(
    depot: ContentRepository, index: AnalysisIndex, tableaux: DashboardIndex
) -> None:
    index.upsert(ligne())
    ident = ecrire_tableau(depot)
    assert reindex(depot, index, tableaux) == Report(0, (), 1, ())
    assert index.rows("finance") == []
    assert ids(tableaux.rows("finance")) == [ident]


def test_un_depot_vide_vide_les_deux_index(
    depot: ContentRepository, index: AnalysisIndex, tableaux: DashboardIndex
) -> None:
    index.upsert(ligne())
    tableaux.upsert(tableau())
    assert reindex(depot, index, tableaux) == Report(0, (), 0, ())
    assert index.rows("finance") == []
    assert tableaux.rows("finance") == []


def test_un_index_obsolete_et_pollue_est_remplace(
    depot: ContentRepository, index: AnalysisIndex, tableaux: DashboardIndex
) -> None:
    analyse = ecrire(depot)
    vivant = ecrire_tableau(depot, "finance", visual(None, analyse, 1), name="Vrai nom")
    fantome = tableau(references=(Reference(new_id(), analyse, 4),))
    perime = tableau(
        ident=vivant,
        name="Faux nom",
        revision=9,
        commit="f" * 40,
        references=(Reference(new_id(), new_id(), 3),),
    )
    autre_espace = tableau("rh")
    tableaux.upsert(fantome)
    tableaux.upsert(perime)
    tableaux.upsert(autre_espace)
    index.upsert(ligne(ident=analyse, name="Faux", revision=5))
    assert reindex(depot, index, tableaux) == Report(1, (), 1, ())
    assert tableaux.get("finance", fantome.dashboard_id) is None
    assert tableaux.get("rh", autre_espace.dashboard_id) is None
    relu = tableaux.get("finance", vivant)
    assert relu is not None and (relu.name, relu.revision) == ("Vrai nom", 1)
    assert [item.analysis_revision for item in relu.references] == [1]
    assert relu.references[0].analysis_id == analyse
    # Aucune référence ancienne ne survit : seule celle du dépôt reste.
    assert ids(tableaux.consumers("finance", analyse)) == [vivant]
    relue = index.get("finance", analyse)
    assert relue is not None and relue.name == "Chiffre d'affaires"


def test_reconstruire_deux_fois_donne_le_meme_resultat(
    depot: ContentRepository, index: AnalysisIndex, tableaux: DashboardIndex
) -> None:
    analyse = ecrire(depot)
    ecrire_tableau(depot, "finance", visual(None, analyse, 1))
    ecrire_tableau(depot, "rh")
    premier = reindex(depot, index, tableaux)
    avant = (
        index.rows("finance") + index.rows("rh"),
        [tableaux.get(e, i) for e in ("finance", "rh") for i in ids(tableaux.rows(e))],
    )
    assert reindex(depot, index, tableaux) == premier
    assert (
        index.rows("finance") + index.rows("rh"),
        [tableaux.get(e, i) for e in ("finance", "rh") for i in ids(tableaux.rows(e))],
    ) == avant


def test_un_dashboard_supprime_n_est_pas_indexe_et_sa_ligne_disparait(
    depot: ContentRepository, index: AnalysisIndex, tableaux: DashboardIndex
) -> None:
    analyse = ecrire(depot)
    vivant = ecrire_tableau(depot, "finance", visual(None, analyse, 1))
    supprime = ecrire_tableau(depot, "finance", visual(None, analyse, 1))
    depot.delete("finance", supprime, expected_revision=1, actor=ACTOR, kind=DASHBOARD_KIND)
    # Un index resté sur la ligne du dashboard supprimé (suppression non indexée).
    tableaux.upsert(tableau(ident=supprime, references=(Reference(new_id(), analyse, 1),)))
    assert reindex(depot, index, tableaux) == Report(1, (), 1, ())
    assert tableaux.get("finance", supprime) is None
    assert ids(tableaux.rows("finance")) == [vivant]
    assert ids(tableaux.consumers("finance", analyse)) == [vivant]


def test_une_analyse_supprimee_n_empeche_pas_d_indexer_son_consommateur(
    depot: ContentRepository, index: AnalysisIndex, tableaux: DashboardIndex
) -> None:
    analyse = ecrire(depot)
    ident = ecrire_tableau(depot, "finance", visual(None, analyse, 1))
    depot.delete("finance", analyse, expected_revision=1, actor=ACTOR)
    assert reindex(depot, index, tableaux) == Report(0, (), 1, ())
    # La référence reste dite : c'est la lecture du dashboard qui jugera qu'elle ne se résout plus.
    assert ids(tableaux.consumers("finance", analyse)) == [ident]


# -- contenus abîmés --------------------------------------------------------------------------


def abimer_par_histoire(racine: Path, espace: str, ident: str) -> None:
    commit(racine, {chemin(espace, ident): b"api_version: x\n"}, "intrus")


def abimer_par_blob(racine: Path, espace: str, ident: str) -> None:
    objet = git(racine, "rev-parse", f"HEAD:{chemin(espace, ident)}").strip()
    fichier = racine / "objects" / objet[:2] / objet[2:]
    fichier.chmod(0o600)
    fichier.unlink()


def abimer_par_contenu(racine: Path, espace: str, ident: str) -> None:
    """Un commit de Board (message conforme) dont le fichier n'est pas un dashboard valide."""
    message = repository_module._message(espace, ident, 2, "save", ACTOR, DASHBOARD_KIND)
    commit(racine, {chemin(espace, ident): b"api_version: x\n"}, message)


ABIMES: list[tuple[Callable[[Path, str, str], None], str]] = [
    (abimer_par_histoire, "history_inconsistent"),
    (abimer_par_blob, "blob_unreadable"),
    (abimer_par_contenu, "stored_invalid"),
]


@pytest.mark.parametrize(("abimer", "raison"), ABIMES)
def test_un_dashboard_abime_est_nomme_et_les_autres_sont_indexes(
    abimer: Callable[[Path, str, str], None],
    raison: str,
    depot: ContentRepository,
    index: AnalysisIndex,
    tableaux: DashboardIndex,
    racine: Path,
) -> None:
    analyse = ecrire(depot)
    sain, abime = ecrire_tableau(depot), ecrire_tableau(depot, "rh")
    tableaux.upsert(tableau("rh", abime, name="Ancien"))
    abimer(racine, "rh", abime)
    rapport = reindex(depot, index, tableaux)
    assert rapport == Report(1, (), 1, (("rh", abime, raison),))
    assert ids(tableaux.rows("finance")) == [sain]
    # Le dashboard abîmé n'est pas indexé : sa ligne ancienne disparaît aussi.
    assert tableaux.get("rh", abime) is None
    assert index.get("finance", analyse) is not None


def test_un_dashboard_de_l_histoire_incoherente_ne_touche_pas_les_analyses(
    depot: ContentRepository, index: AnalysisIndex, tableaux: DashboardIndex, racine: Path
) -> None:
    saine = ecrire(depot)
    abime = ecrire_tableau(depot)
    abimer_par_histoire(racine, "finance", abime)
    assert reindex(depot, index, tableaux) == Report(
        1, (), 0, (("finance", abime, "history_inconsistent"),)
    )
    assert [item.analysis_id for item in index.rows("finance")] == [saine]


def test_les_deux_genres_abimes_sont_rapportes_chacun_de_son_cote(
    depot: ContentRepository, index: AnalysisIndex, tableaux: DashboardIndex, racine: Path
) -> None:
    analyse_abimee = ecrire(depot)
    tableau_abime = ecrire_tableau(depot)
    sain = ecrire_tableau(depot)
    commit(
        racine,
        {f"analyses/finance/{analyse_abimee}.yaml": b"x: y\n"},
        "intrus",
    )
    abimer_par_histoire(racine, "finance", tableau_abime)
    rapport = reindex(depot, index, tableaux)
    assert rapport == Report(
        0,
        (("finance", analyse_abimee, "history_inconsistent"),),
        1,
        (("finance", tableau_abime, "history_inconsistent"),),
    )
    assert ids(tableaux.rows("finance")) == [sain]


def test_un_dashboard_disparu_entre_temps_est_ignore(
    depot: ContentRepository,
    index: AnalysisIndex,
    tableaux: DashboardIndex,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ecrire(depot)
    ecrire_tableau(depot)
    lire = ContentRepository.read

    def disparu(self: ContentRepository, *args: object, kind: Kind = ANALYSIS_KIND, **kw: object):  # type: ignore[no-untyped-def]
        if kind is DASHBOARD_KIND:
            raise ContentError("dashboard_not_found", "missing")
        return lire(self, *args, kind=kind, **kw)  # type: ignore[arg-type]

    monkeypatch.setattr(ContentRepository, "read", disparu)
    assert reindex(depot, index, tableaux) == Report(1, (), 0, ())


def test_le_code_d_un_autre_genre_n_est_pas_une_disparition(
    depot: ContentRepository,
    index: AnalysisIndex,
    tableaux: DashboardIndex,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Un dashboard qui répond `analysis_not_found` est une panne, pas un contenu disparu."""
    ecrire_tableau(depot)
    tableaux.upsert(tableau())

    def confus(*args: object, **kwargs: object) -> None:
        raise ContentError("analysis_not_found", "missing")

    monkeypatch.setattr(ContentRepository, "read", confus)
    with pytest.raises(ContentError):
        reindex(depot, index, tableaux)
    assert len(tableaux.rows("finance")) == 1


def test_un_echec_du_depot_sur_un_dashboard_ne_touche_aucun_index(
    depot: ContentRepository,
    index: AnalysisIndex,
    tableaux: DashboardIndex,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ecrire(depot)
    ecrire_tableau(depot)
    analyse_gardee, tableau_garde = ligne(), tableau()
    index.upsert(analyse_gardee)
    tableaux.upsert(tableau_garde)
    lire = ContentRepository.read

    def panne(self: ContentRepository, *args: object, kind: Kind = ANALYSIS_KIND, **kw: object):  # type: ignore[no-untyped-def]
        if kind is DASHBOARD_KIND:
            raise ContentError("content_unavailable", "git_failed")
        return lire(self, *args, kind=kind, **kw)  # type: ignore[arg-type]

    monkeypatch.setattr(ContentRepository, "read", panne)
    with pytest.raises(ContentError):
        reindex(depot, index, tableaux)
    assert index.rows("finance") == [analyse_gardee]
    assert tableaux.rows("finance") == [
        DashboardRow(
            tableau_garde.space_id,
            tableau_garde.dashboard_id,
            tableau_garde.name,
            tableau_garde.owner,
            tableau_garde.visibility,
            tableau_garde.revision,
            tableau_garde.commit,
            tableau_garde.committed_at,
        )
    ]


# -- atomicité --------------------------------------------------------------------------------


def etat(
    index: AnalysisIndex, tableaux: DashboardIndex
) -> tuple[list[IndexRow], list[DashboardRow | None]]:
    """Ce que les deux index contiennent, références des dashboards comprises."""
    return (
        index.rows("finance"),
        [tableaux.get("finance", ident) for ident in ids(tableaux.rows("finance"))],
    )


def test_un_echec_du_remplacement_des_dashboards_n_ecrit_rien_des_analyses(
    depot: ContentRepository,
    index: AnalysisIndex,
    tableaux: DashboardIndex,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ecrire(depot)
    ecrire_tableau(depot)
    index.upsert(ligne())
    tableaux.upsert(tableau(references=(Reference(new_id(), new_id(), 1),)))
    avant = etat(index, tableaux)

    def echec(self: DashboardIndex, connection: Connection, rows: Iterable[DashboardRow]) -> None:
        raise OperationalError("INSERT", {}, Exception("panne"))

    monkeypatch.setattr(DashboardIndex, "replace_in", echec)
    with pytest.raises(OperationalError):
        reindex(depot, index, tableaux)
    assert etat(index, tableaux) == avant


def test_une_ligne_de_dashboard_refusee_par_la_base_n_ecrit_rien_des_analyses(
    depot: ContentRepository,
    index: AnalysisIndex,
    tableaux: DashboardIndex,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Une ligne refusée à l'insertion, après le remplacement des analyses, annule tout."""
    ecrire(depot)
    ecrire_tableau(depot)
    index.upsert(ligne())
    tableaux.upsert(tableau())
    avant = etat(index, tableaux)
    original = DashboardRow.of.__func__  # type: ignore[attr-defined]

    def sans_nom(cls: type[DashboardRow], space_id: str, stored: object) -> DashboardRow:
        valide = original(cls, space_id, stored)
        return DashboardRow(
            valide.space_id,
            valide.dashboard_id,
            None,  # type: ignore[arg-type]
            valide.owner,
            valide.visibility,
            valide.revision,
            valide.commit,
            valide.committed_at,
            valide.references,
        )

    monkeypatch.setattr(DashboardRow, "of", classmethod(sans_nom))
    with pytest.raises(DBAPIError):
        reindex(depot, index, tableaux)
    assert etat(index, tableaux) == avant


def test_une_ligne_d_analyse_refusee_par_la_base_n_ecrit_rien_des_dashboards(
    depot: ContentRepository,
    index: AnalysisIndex,
    tableaux: DashboardIndex,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ecrire(depot)
    ecrire_tableau(depot)
    index.upsert(ligne())
    tableaux.upsert(tableau(references=(Reference(new_id(), new_id(), 1),)))
    avant = etat(index, tableaux)
    original = IndexRow.of.__func__  # type: ignore[attr-defined]

    def sans_nom(cls: type[IndexRow], space_id: str, stored: object) -> IndexRow:
        valide = original(cls, space_id, stored)
        return IndexRow(
            valide.space_id,
            valide.analysis_id,
            None,  # type: ignore[arg-type]
            valide.owner,
            valide.visibility,
            valide.revision,
            valide.commit,
            valide.committed_at,
            valide.model,
            valide.metrics,
        )

    monkeypatch.setattr(IndexRow, "of", classmethod(sans_nom))
    with pytest.raises(DBAPIError):
        reindex(depot, index, tableaux)
    assert etat(index, tableaux) == avant


def ecrire_pendant_le_remplacement(
    depot: ContentRepository,
    monkeypatch: pytest.MonkeyPatch,
    fois: int,
    ecriture: Callable[[ContentRepository, int], str],
) -> list[str]:
    """Une écriture arrive dans la transaction du remplacement, avant la relecture de la tête,
    pour chacun des `fois` premiers remplacements : les deux genres sont déjà remplacés dans la
    transaction à ce moment-là."""
    arrivees: list[str] = []
    remplacer = AnalysisIndex.replace

    def remplacer_avec_ecriture(
        self: AnalysisIndex,
        rows: Iterable[IndexRow],
        before_commit: Callable[[], None] | None = None,
        inside: Callable[[Connection], None] | None = None,
    ) -> int:
        def verifier() -> None:
            if len(arrivees) < fois:
                arrivees.append(ecriture(depot, len(arrivees)))
            assert before_commit is not None
            before_commit()

        return remplacer(self, rows, verifier, inside)

    monkeypatch.setattr(AnalysisIndex, "replace", remplacer_avec_ecriture)
    return arrivees


def arrivee_tableau(depot: ContentRepository, numero: int) -> str:
    return ecrire_tableau(depot, "finance", name=f"Arrivée {numero}")


def arrivee_analyse(depot: ContentRepository, numero: int) -> str:
    return ecrire(depot, name=f"Arrivée {numero}")


def test_un_dashboard_publie_pendant_le_remplacement_relance_la_reconstruction(
    depot: ContentRepository,
    index: AnalysisIndex,
    tableaux: DashboardIndex,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ecrire(depot)
    ecrire_tableau(depot)
    arrivees = ecrire_pendant_le_remplacement(depot, monkeypatch, 1, arrivee_tableau)
    assert reindex(depot, index, tableaux) == Report(1, (), 2, ())
    # Sans le second passage, le dashboard publié pendant le remplacement manquerait à l'index.
    assert tableaux.get("finance", arrivees[0]) is not None
    assert len(tableaux.rows("finance")) == 2


def test_une_analyse_publiee_pendant_le_remplacement_relance_aussi_les_dashboards(
    depot: ContentRepository,
    index: AnalysisIndex,
    tableaux: DashboardIndex,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ecrire_tableau(depot)
    arrivees = ecrire_pendant_le_remplacement(depot, monkeypatch, 1, arrivee_analyse)
    assert reindex(depot, index, tableaux) == Report(1, (), 1, ())
    assert index.get("finance", arrivees[0]) is not None
    assert len(tableaux.rows("finance")) == 1


def test_un_depot_qui_change_a_chaque_essai_laisse_les_deux_index_intacts(
    depot: ContentRepository,
    index: AnalysisIndex,
    tableaux: DashboardIndex,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ecrire(depot)
    ecrire_tableau(depot)
    index.upsert(ligne())
    tableaux.upsert(tableau(references=(Reference(new_id(), new_id(), 1),)))
    avant = etat(index, tableaux)
    arrivees = ecrire_pendant_le_remplacement(depot, monkeypatch, 99, arrivee_tableau)
    with pytest.raises(RepositoryMoving):
        reindex(depot, index, tableaux)
    assert len(arrivees) == ATTEMPTS
    # Chaque passe ratée est annulée : les deux index sont exactement ceux d'avant.
    assert etat(index, tableaux) == avant
    # Un dépôt calme se reconstruit en un seul essai.
    monkeypatch.undo()
    rapport = reindex(depot, index, tableaux, attempts=1)
    assert (rapport.indexed, rapport.dashboards) == (1, 1 + ATTEMPTS)


def test_une_tete_illisible_avant_le_commit_laisse_les_deux_index_intacts(
    depot: ContentRepository,
    index: AnalysisIndex,
    tableaux: DashboardIndex,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ecrire(depot)
    ecrire_tableau(depot)
    index.upsert(ligne())
    tableaux.upsert(tableau(references=(Reference(new_id(), new_id(), 1),)))
    avant = etat(index, tableaux)
    lire = ContentRepository.head
    appels: list[int] = []

    def tete_puis_panne(self: ContentRepository) -> str | None:
        appels.append(1)
        if len(appels) == 2:
            raise ContentError("content_unavailable", "git_failed")
        return lire(self)

    monkeypatch.setattr(ContentRepository, "head", tete_puis_panne)
    with pytest.raises(ContentError):
        reindex(depot, index, tableaux)
    assert len(appels) == 2
    assert etat(index, tableaux) == avant


# -- commande ---------------------------------------------------------------------------------


def test_commande_sur_un_depot_a_deux_genres(
    database_url: URL,
    migre: Engine,
    depot: ContentRepository,
    racine: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    analyse = ecrire(depot)
    ident = ecrire_tableau(depot, "finance", visual(None, analyse, 1))
    ecrire_tableau(depot, "rh")
    DashboardIndex(migre).upsert(tableau(references=(Reference(new_id(), new_id(), 1),)))
    code, sortie, erreur = lancer(environ(database_url, racine), capsys)
    assert (code, erreur) == (0, "")
    assert sortie == "1 analyse(s) indexée(s).\n2 dashboard(s) indexé(s).\n"
    assert ids(DashboardIndex(migre).consumers("finance", analyse)) == [ident]
    assert len(DashboardIndex(migre).rows("finance")) == 1


def test_commande_avec_un_dashboard_illisible(
    database_url: URL,
    migre: Engine,
    depot: ContentRepository,
    racine: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    sain, abime = ecrire_tableau(depot), ecrire_tableau(depot)
    abimer_par_histoire(racine, "finance", abime)
    code, sortie, erreur = lancer(environ(database_url, racine), capsys)
    assert code == 1
    assert sortie == "0 analyse(s) indexée(s).\n1 dashboard(s) indexé(s).\n"
    assert erreur == f"Illisible : dashboard finance/{abime} (history_inconsistent).\n"
    assert ids(DashboardIndex(migre).rows("finance")) == [sain]


def test_commande_avec_un_blob_de_dashboard_manquant(
    database_url: URL,
    migre: Engine,
    depot: ContentRepository,
    racine: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    sain, abime = ecrire_tableau(depot), ecrire_tableau(depot)
    abimer_par_blob(racine, "finance", abime)
    code, sortie, erreur = lancer(environ(database_url, racine), capsys)
    assert code == 1
    assert sortie == "0 analyse(s) indexée(s).\n1 dashboard(s) indexé(s).\n"
    assert erreur == f"Illisible : dashboard finance/{abime} (blob_unreadable).\n"
    assert ids(DashboardIndex(migre).rows("finance")) == [sain]


def test_commande_avec_les_deux_genres_illisibles_nomme_les_analyses_d_abord(
    database_url: URL,
    migre: Engine,
    depot: ContentRepository,
    racine: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    analyse = ecrire(depot)
    abime = ecrire_tableau(depot)
    commit(racine, {f"analyses/finance/{analyse}.yaml": b"x: y\n"}, "intrus")
    abimer_par_histoire(racine, "finance", abime)
    code, sortie, erreur = lancer(environ(database_url, racine), capsys)
    assert code == 1
    assert sortie == "0 analyse(s) indexée(s).\n0 dashboard(s) indexé(s).\n"
    assert erreur == (
        f"Illisible : finance/{analyse} (history_inconsistent).\n"
        f"Illisible : dashboard finance/{abime} (history_inconsistent).\n"
    )


def test_commande_sur_un_depot_qui_change_a_chaque_essai(
    database_url: URL,
    migre: Engine,
    depot: ContentRepository,
    racine: Path,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ecrire_tableau(depot)
    garde = tableau()
    DashboardIndex(migre).upsert(garde)
    ecrire_pendant_le_remplacement(depot, monkeypatch, 99, arrivee_tableau)
    code, sortie, erreur = lancer(environ(database_url, racine), capsys)
    assert (code, sortie) == (3, "")
    assert f"{ATTEMPTS} essais" in erreur and "relancer" in erreur
    assert ids(DashboardIndex(migre).rows("finance")) == [garde.dashboard_id]


def test_commande_avec_une_base_qui_echoue_a_ecrire_les_dashboards(
    database_url: URL,
    migre: Engine,
    depot: ContentRepository,
    racine: Path,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ecrire(depot)
    ecrire_tableau(depot)
    gardee = ligne()
    AnalysisIndex(migre).upsert(gardee)

    def echec(self: DashboardIndex, connection: Connection, rows: Iterable[DashboardRow]) -> None:
        raise OperationalError("INSERT", {}, Exception("postgresql://b:secret@h/etat"))

    monkeypatch.setattr(DashboardIndex, "replace_in", echec)
    code, sortie, erreur = lancer(environ(database_url, racine), capsys)
    assert (code, sortie) == (1, "")
    assert erreur.startswith("Réindexation impossible dans la base d'état")
    assert "secret" not in erreur
    assert AnalysisIndex(migre).rows("finance") == [gardee]
