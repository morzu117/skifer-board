"""Index des analyses en base et migration 0013 (plan 18.2, A4)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from skifer_board.content.index import INDEXED, AnalysisIndex, IndexRow
from skifer_board.spaces.model import GroupPrincipal, PersonRef
from skifer_board.spaces.store import SpaceStore
from skifer_board.state import current_revision, upgrade
from skifer_board.state.schema import analysis_index, metadata
from spaces.test_migration import jusqu_a
from sqlalchemy import Engine, inspect, select
from sqlalchemy.exc import IntegrityError

from .monde import ACTOR, OTHER, new_id

INSTANT = datetime(2026, 11, 5, 12, tzinfo=UTC)


def ligne(space: str = "finance", ident: str | None = None, **changes: object) -> IndexRow:
    valeurs: dict[str, object] = {
        "space_id": space,
        "analysis_id": ident or new_id(),
        "name": "Chiffre d'affaires",
        "owner": ACTOR,
        "visibility": "shared",
        "revision": 1,
        "commit": "a" * 40,
        "committed_at": INSTANT,
        "model": "sales",
        "metrics": ("revenue", "orders"),
    }
    valeurs.update(changes)
    return IndexRow(**valeurs)  # type: ignore[arg-type]


@pytest.fixture
def index(migre: Engine) -> AnalysisIndex:
    return AnalysisIndex(migre, lambda: INSTANT + timedelta(minutes=1))


def test_migration_0013_depuis_une_base_existante(engine: Engine) -> None:
    jusqu_a(engine, "0012")
    SpaceStore(engine).create_space(
        "finance", "Finance", "atlas", GroupPrincipal("admins"), ACTOR, INSTANT
    )
    assert "analysis_index" not in inspect(engine).get_table_names()
    upgrade(engine)
    assert current_revision(engine) == "0015"
    assert SpaceStore(engine).get_space("finance") is not None
    with engine.connect() as connection:
        assert connection.execute(select(analysis_index)).all() == []
        assert compare_metadata(MigrationContext.configure(connection), metadata) == []
    inspecteur = inspect(engine)
    assert inspecteur.get_pk_constraint("analysis_index")["constrained_columns"] == [
        "space_id",
        "analysis_id",
    ]
    assert inspecteur.get_foreign_keys("analysis_index") == []
    assert [i["name"] for i in inspecteur.get_indexes("analysis_index")] == [
        "ix_analysis_index_visibility"
    ]


def test_ecrire_puis_relire_une_ligne(index: AnalysisIndex) -> None:
    attendue = ligne()
    assert index.get("finance", attendue.analysis_id) is None
    index.upsert(attendue)
    relue = index.get("finance", attendue.analysis_id)
    assert relue == attendue and relue.state == INDEXED
    assert relue.metrics == ("revenue", "orders") and relue.committed_at == INSTANT
    assert index.rows("finance") == [attendue]
    assert index.rows("rh") == []


def test_l_index_ne_porte_ni_requete_ni_filtre(migre: Engine) -> None:
    colonnes = {c.name for c in analysis_index.columns}
    assert colonnes.isdisjoint({"query", "filters", "contextual", "sql", "environment", "value"})


def test_une_revision_remplace_la_precedente(index: AnalysisIndex) -> None:
    premiere = ligne()
    index.upsert(premiere)
    deuxieme = ligne(
        ident=premiere.analysis_id, revision=2, commit="b" * 40, name="Renommée", owner=ACTOR
    )
    index.upsert(deuxieme)
    assert index.rows("finance") == [deuxieme]


def test_une_ecriture_en_retard_ne_ramene_pas_l_index_en_arriere(index: AnalysisIndex) -> None:
    recente = ligne(revision=3, commit="c" * 40)
    index.upsert(recente)
    index.upsert(ligne(ident=recente.analysis_id, revision=2, commit="b" * 40))
    assert index.get("finance", recente.analysis_id) == recente
    # Même numéro : la dernière écriture l'emporte (rejeu d'une réindexation).
    rejeu = ligne(ident=recente.analysis_id, revision=3, commit="d" * 40)
    index.upsert(rejeu)
    assert index.get("finance", recente.analysis_id) == rejeu


def test_retirer_une_ligne(index: AnalysisIndex) -> None:
    gardee, retiree = ligne(), ligne(revision=2)
    index.upsert(gardee)
    index.upsert(retiree)
    index.remove("finance", retiree.analysis_id, 2)
    assert index.rows("finance") == [gardee]
    index.remove("finance", retiree.analysis_id, 2)
    assert index.rows("finance") == [gardee]


def test_retirer_ne_touche_pas_une_ligne_plus_recente(index: AnalysisIndex) -> None:
    recente = ligne(revision=4)
    index.upsert(recente)
    index.remove("finance", recente.analysis_id, 3)
    assert index.get("finance", recente.analysis_id) == recente


def test_les_lignes_sont_par_espace_et_triees(index: AnalysisIndex) -> None:
    a, b = sorted([ligne(), ligne()], key=lambda item: item.analysis_id)
    index.upsert(b)
    index.upsert(a)
    index.upsert(ligne("rh", owner=OTHER))
    assert index.rows("finance") == [a, b]
    assert [item.space_id for item in index.rows("rh")] == ["rh"]
    # Même identifiant d'analyse, autre espace : une autre ligne.
    index.upsert(ligne("rh", a.analysis_id))
    assert index.get("rh", a.analysis_id) is not None and index.get("finance", a.analysis_id) == a


def test_remplacer_tout_l_index(index: AnalysisIndex) -> None:
    ancienne = ligne()
    index.upsert(ancienne)
    nouvelles = [ligne(), ligne("rh", owner=PersonRef("https://autre", "x"))]
    assert index.replace(nouvelles) == 2
    assert index.get("finance", ancienne.analysis_id) is None
    assert {(item.space_id, item.analysis_id) for item in index.rows("finance")} | {
        (item.space_id, item.analysis_id) for item in index.rows("rh")
    } == {(item.space_id, item.analysis_id) for item in nouvelles}
    assert index.replace([]) == 0
    assert index.rows("finance") == [] and index.rows("rh") == []


def test_remplacer_est_atomique(index: AnalysisIndex) -> None:
    gardee = ligne()
    index.upsert(gardee)
    doublon = ligne()
    with pytest.raises(IntegrityError):
        index.replace([doublon, doublon])
    # La reconstruction en échec n'a pas vidé l'index.
    assert index.rows("finance") == [gardee]


def test_l_instant_d_indexation_vient_de_l_horloge(index: AnalysisIndex, migre: Engine) -> None:
    index.upsert(ligne())
    with migre.connect() as connection:
        trouve = connection.execute(select(analysis_index.c.indexed_at)).scalar_one()
    assert trouve == INSTANT + timedelta(minutes=1)


def test_l_horloge_par_defaut_est_utc(migre: Engine) -> None:
    avant = datetime.now(UTC)
    base = AnalysisIndex(migre)
    base.replace([ligne()])
    with migre.connect() as connection:
        trouve = connection.execute(select(analysis_index.c.indexed_at)).scalar_one()
    assert avant <= trouve <= datetime.now(UTC)


def test_les_instants_sont_relus_en_utc_quel_que_soit_le_fuseau_de_la_base(
    moteur_hors_utc: Engine,
) -> None:
    base = AnalysisIndex(moteur_hors_utc, lambda: INSTANT)
    attendue = ligne()
    base.upsert(attendue)
    relue = base.get("finance", attendue.analysis_id)
    assert relue is not None and relue.committed_at.utcoffset() == timedelta(0)
    assert relue.committed_at.isoformat() == "2026-11-05T12:00:00+00:00"
    assert base.rows("finance")[0].committed_at.utcoffset() == timedelta(0)
