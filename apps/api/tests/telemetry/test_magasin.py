"""Magasin de télémétrie sur la base d'état jetable (plan 11, T4, T6, T7).

Les centiles attendus sont recalculés ici selon la définition de `percentile_cont` : position
`p × (n − 1)` dans les valeurs triées, interpolation linéaire entre les deux voisines.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta, timezone

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from skifer_board.state.schema import telemetry
from skifer_board.telemetry import Kind, Measure, OperationSummary, TelemetryStore, Window
from sqlalchemy import Engine, create_engine, delete, func, select, text
from sqlalchemy.exc import DBAPIError

from .conftest import MAINTENANT, atlas, avant, http, lignes

MICRO = timedelta(microseconds=1)


def centile(valeurs: Sequence[float], p: float) -> float:
    """`percentile_cont(p)` de référence."""
    triees = sorted(valeurs)
    position = p * (len(triees) - 1)
    bas = math.floor(position)
    haut = math.ceil(position)
    return triees[bas] + (triees[haut] - triees[bas]) * (position - bas)


def seule(magasin: TelemetryStore, fenetre: Window = Window.DAY) -> OperationSummary:
    resume = magasin.summary(fenetre, MAINTENANT)
    assert len(resume.operations) == 1
    return resume.operations[0]


def cle(operation: OperationSummary) -> tuple[str, str, str | None]:
    return operation.kind.value, operation.operation, operation.method


def test_execution_success_refusal_cancel_and_failure_are_counted_separately(
    magasin: TelemetryStore,
) -> None:
    magasin.record(
        [
            Measure(
                MAINTENANT,
                Kind.EXECUTION,
                "semantic.execute",
                outcome,
                10.0,
                space="finance",
                environment="DEV",
            )
            for outcome in ("ok", "deny", "cancelled", "invalid_upstream")
        ]
    )
    operation = seule(magasin)
    assert operation.kind is Kind.EXECUTION
    assert (operation.count, operation.errors, operation.refusals) == (4, 1, 1)


# --- Enregistrement --------------------------------------------------------------------------


def test_lot_vide_ne_fait_rien(migre: Engine) -> None:
    magasin = TelemetryStore(migre)
    magasin.record([])
    magasin.record(())
    assert lignes(migre) == []


INJOIGNABLE = "postgresql+pg8000://x@/x?unix_sock=/tmp/sb-absent/.s.PGSQL.1"
NAIF = datetime(2026, 11, 3, 12)


def test_lot_vide_sans_toucher_la_base() -> None:
    # Un moteur injoignable : une liste vide n'ouvre aucune connexion.
    TelemetryStore(create_engine(INJOIGNABLE)).record([])


def test_instant_sans_fuseau_refuse_avant_toute_connexion() -> None:
    # Moteur injoignable : le refus vient avant toute connexion.
    magasin = TelemetryStore(create_engine(INJOIGNABLE))
    with pytest.raises(ValueError) as purge:
        magasin.purge(NAIF)
    assert type(purge.value) is ValueError and purge.value.args == ("before",)
    for fenetre in Window:
        with pytest.raises(ValueError) as resume:
            magasin.summary(fenetre, NAIF)
        assert type(resume.value) is ValueError and resume.value.args == ("now",)


def test_instant_sans_fuseau_ne_purge_ni_ne_lit_rien(
    magasin: TelemetryStore, migre: Engine
) -> None:
    magasin.record([http(at=avant(days=100)), http()])
    with pytest.raises(ValueError, match="before"):
        magasin.purge(NAIF)
    assert len(lignes(migre)) == 2
    with pytest.raises(ValueError, match="now"):
        magasin.summary(Window.DAY, NAIF)
    # Le même instant, avec son fuseau, est accepté.
    assert magasin.purge(NAIF.replace(tzinfo=UTC) - timedelta(days=90)) == 1


def test_chaque_champ_relu(magasin: TelemetryStore, migre: Engine) -> None:
    decale = datetime(2026, 11, 3, 14, 30, 0, 123456, tzinfo=timezone(timedelta(hours=2)))
    magasin.record(
        [
            http(
                at=decale,
                operation="/api/spaces/{space_id}/parameters",
                method="DELETE",
                status=409,
                outcome="values_incompatible",
                space="ventes",
                environment="PROD",
                duration_ms=0.125,
                rows=0,
                size=2**63 - 1,
            ),
            atlas(duration_ms=0.0),
        ]
    )
    premiere, seconde = lignes(migre)
    identifiants = premiere.pop("id"), seconde.pop("id")
    assert all(isinstance(i, int) for i in identifiants)
    assert identifiants[0] < identifiants[1]
    assert premiere == {
        "at": datetime(2026, 11, 3, 12, 30, 0, 123456, tzinfo=UTC),
        "kind": "http",
        "operation": "/api/spaces/{space_id}/parameters",
        "method": "DELETE",
        "status": 409,
        "outcome": "values_incompatible",
        "space_id": "ventes",
        "environment": "PROD",
        "duration_ms": 0.125,
        "rows": 0,
        "size": 2**63 - 1,
    }
    assert seconde == {
        "at": MAINTENANT,
        "kind": "atlas",
        "operation": "catalog.list",
        "method": None,
        "status": None,
        "outcome": "ok",
        "space_id": None,
        "environment": None,
        "duration_ms": 0.0,
        "rows": None,
        "size": None,
    }


def test_identifiants_croissants_et_lots_successifs(magasin: TelemetryStore, migre: Engine) -> None:
    magasin.record([http(duration_ms=float(i)) for i in range(3)])
    magasin.record([http(duration_ms=float(i)) for i in range(3, 5)])
    relues = lignes(migre)
    assert [ligne["duration_ms"] for ligne in relues] == [0.0, 1.0, 2.0, 3.0, 4.0]
    identifiants = [ligne["id"] for ligne in relues]
    assert identifiants == sorted(set(identifiants))


def test_un_lot_en_une_transaction(magasin: TelemetryStore, migre: Engine) -> None:
    # Une mesure contournant sa validation déborde la colonne : rien du lot n'est gardé.
    fautive = http()
    object.__setattr__(fautive, "operation", "x" * 201)
    with pytest.raises(DBAPIError, match="22001"):
        magasin.record([http(), atlas(), fautive])
    assert lignes(migre) == []
    magasin.record([http()])
    assert len(lignes(migre)) == 1


def test_mesure_d_un_espace_sans_espace_en_base(magasin: TelemetryStore, migre: Engine) -> None:
    # Aucune clé étrangère : la mesure d'un espace inconnu, ou retiré, s'enregistre.
    magasin.record([http(space="fantome", environment="DEV"), atlas(space="autre")])
    assert [ligne["space_id"] for ligne in lignes(migre)] == ["fantome", "autre"]
    assert [o.count for o in magasin.summary(Window.DAY, MAINTENANT).operations] == [1, 1]


# --- Purge -----------------------------------------------------------------------------------


def test_purge_a_la_borne_exacte(magasin: TelemetryStore, migre: Engine) -> None:
    borne = avant(days=90)
    magasin.record(
        [
            http(at=borne - timedelta(days=1)),
            http(at=borne - MICRO),
            http(at=borne),
            http(at=borne + MICRO),
            http(at=MAINTENANT),
        ]
    )
    assert magasin.purge(borne) == 2
    assert [ligne["at"] for ligne in lignes(migre)] == [borne, borne + MICRO, MAINTENANT]
    # Rejouée, elle ne retire plus rien.
    assert magasin.purge(borne) == 0
    assert len(lignes(migre)) == 3


def test_purge_d_une_table_vide(magasin: TelemetryStore) -> None:
    assert magasin.purge(MAINTENANT) == 0


def test_purge_avec_un_instant_dans_un_autre_fuseau(magasin: TelemetryStore, migre: Engine) -> None:
    magasin.record([http(at=datetime(2026, 11, 3, 10, tzinfo=UTC))])
    # 11 h 59 à UTC+2 : 9 h 59 UTC, la mesure de 10 h UTC reste.
    assert magasin.purge(datetime(2026, 11, 3, 11, 59, tzinfo=timezone(timedelta(hours=2)))) == 0
    assert magasin.purge(datetime(2026, 11, 3, 12, 1, tzinfo=timezone(timedelta(hours=2)))) == 1
    assert lignes(migre) == []


def test_purge_de_tout_genre(magasin: TelemetryStore, migre: Engine) -> None:
    magasin.record([http(at=avant(days=100)), atlas(at=avant(days=100)), atlas()])
    assert magasin.purge(avant(days=90)) == 2
    assert [ligne["kind"] for ligne in lignes(migre)] == ["atlas"]


# --- Résumé : fenêtre ------------------------------------------------------------------------


def test_fenetre_vide(magasin: TelemetryStore) -> None:
    for fenetre in Window:
        resume = magasin.summary(fenetre, MAINTENANT)
        assert resume.window is fenetre
        assert (resume.start, resume.end) == (MAINTENANT - fenetre.span, MAINTENANT)
        assert (resume.oldest, resume.newest, resume.operations) == (None, None, ())


def test_fenetre_vide_mais_table_non_vide(magasin: TelemetryStore) -> None:
    magasin.record([http(at=avant(days=2)), http(at=MAINTENANT + MICRO)])
    resume = magasin.summary(Window.DAY, MAINTENANT)
    assert (resume.oldest, resume.newest, resume.operations) == (None, None, ())


@pytest.mark.parametrize("fenetre", list(Window))
def test_bornes_incluses_aux_deux_extremites(magasin: TelemetryStore, fenetre: Window) -> None:
    debut = MAINTENANT - fenetre.span
    magasin.record(
        [
            http(at=debut - MICRO, duration_ms=1000.0),
            http(at=debut, duration_ms=1.0),
            http(at=debut + MICRO, duration_ms=2.0),
            http(at=MAINTENANT - MICRO, duration_ms=3.0),
            http(at=MAINTENANT, duration_ms=4.0),
            http(at=MAINTENANT + MICRO, duration_ms=2000.0),
        ]
    )
    resume = magasin.summary(fenetre, MAINTENANT)
    assert (resume.start, resume.end) == (debut, MAINTENANT)
    assert (resume.oldest, resume.newest) == (debut, MAINTENANT)
    (operation,) = resume.operations
    assert operation.count == 4
    assert operation.duration_max == 4.0


def test_fenetre_glissante(magasin: TelemetryStore) -> None:
    magasin.record(
        [
            http(at=avant(hours=1), duration_ms=1.0),
            http(at=avant(days=3), duration_ms=2.0),
            http(at=avant(days=20), duration_ms=3.0),
            http(at=avant(days=40), duration_ms=4.0),
        ]
    )
    comptes = {f: magasin.summary(f, MAINTENANT).operations[0].count for f in Window}
    assert comptes == {Window.DAY: 1, Window.WEEK: 2, Window.MONTH: 3}
    # La même base, vue depuis un « maintenant » plus ancien : la fenêtre glisse.
    plus_tot = magasin.summary(Window.WEEK, avant(days=19))
    assert plus_tot.operations[0].count == 1
    assert plus_tot.oldest == plus_tot.newest == avant(days=20)


def test_maintenant_dans_un_autre_fuseau(magasin: TelemetryStore) -> None:
    magasin.record([http(at=avant(hours=23)), http(at=avant(hours=25))])
    ailleurs = MAINTENANT.astimezone(timezone(timedelta(hours=-5)))
    resume = magasin.summary(Window.DAY, ailleurs)
    assert resume.operations[0].count == 1
    assert resume.oldest == avant(hours=23)
    assert resume.oldest is not None and resume.oldest.tzinfo is UTC


@pytest.mark.parametrize("fuseau", ["Pacific/Kiritimati", "America/St_Johns", "Asia/Kolkata"])
def test_instants_relus_en_utc_quel_que_soit_le_fuseau_de_la_session(
    migre: Engine, fuseau: str
) -> None:
    TelemetryStore(migre).record(
        [http(at=avant(hours=5, microseconds=7)), atlas(at=avant(minutes=1))]
    )
    with migre.begin() as connexion:
        base = connexion.execute(text("SELECT current_database()")).scalar_one()
        connexion.execute(text(f"ALTER DATABASE \"{base}\" SET timezone TO '{fuseau}'"))
    moteur = create_engine(migre.url)
    try:
        with moteur.connect() as connexion:
            assert connexion.execute(text("SHOW timezone")).scalar_one() == fuseau
        resume = TelemetryStore(moteur).summary(Window.DAY, MAINTENANT)
    finally:
        moteur.dispose()
    assert resume.oldest == avant(hours=5, microseconds=7)
    assert resume.newest == avant(minutes=1)
    for instant in (resume.oldest, resume.newest):
        assert instant is not None and instant.tzinfo is UTC


# --- Résumé : distributions ------------------------------------------------------------------


def test_centiles_interpoles(magasin: TelemetryStore) -> None:
    durees = [100.0, 10.0, 40.0, 30.0, 20.0]
    magasin.record([http(duration_ms=d) for d in durees])
    operation = seule(magasin)
    assert operation.count == 5
    assert operation.duration_p50 == 30.0
    # Position 0,95 × 4 = 3,8 : 40 + 0,8 × (100 − 40).
    assert operation.duration_p95 == pytest.approx(88.0, rel=1e-12)
    assert operation.duration_max == 100.0


def test_mediane_d_un_nombre_pair_interpolee(magasin: TelemetryStore) -> None:
    # `percentile_disc` rendrait 2 ; `percentile_cont` rend 2,5.
    magasin.record([http(duration_ms=d) for d in (4.0, 1.0, 3.0, 2.0)])
    operation = seule(magasin)
    assert operation.duration_p50 == 2.5
    assert operation.duration_p95 == pytest.approx(3.85, rel=1e-12)
    assert operation.duration_max == 4.0


def test_cent_valeurs(magasin: TelemetryStore) -> None:
    magasin.record([http(duration_ms=float(i)) for i in range(1, 101)])
    operation = seule(magasin)
    assert operation.duration_p50 == 50.5
    assert operation.duration_p95 == pytest.approx(95.05, rel=1e-12)
    assert operation.duration_max == 100.0


def test_une_seule_mesure(magasin: TelemetryStore) -> None:
    magasin.record([atlas(duration_ms=7.25, rows=3, size=10)])
    operation = seule(magasin)
    assert (operation.duration_p50, operation.duration_p95, operation.duration_max) == (
        7.25,
        7.25,
        7.25,
    )
    assert (operation.rows_p50, operation.rows_max, operation.size_p50, operation.size_max) == (
        3.0,
        3,
        10.0,
        10,
    )


@settings(
    max_examples=25, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    durees=st.lists(
        st.floats(min_value=0, max_value=1e9, allow_nan=False, allow_infinity=False),
        min_size=1,
        max_size=60,
    )
)
def test_centiles_conformes_a_la_reference(migre: Engine, durees: list[float]) -> None:
    with migre.begin() as connexion:
        connexion.execute(delete(telemetry))
    magasin = TelemetryStore(migre)
    magasin.record([atlas(duration_ms=d) for d in durees])
    operation = seule(magasin)
    assert operation.count == len(durees)
    assert operation.duration_p50 == pytest.approx(centile(durees, 0.5), rel=1e-9, abs=1e-9)
    assert operation.duration_p95 == pytest.approx(centile(durees, 0.95), rel=1e-9, abs=1e-9)
    assert operation.duration_max == max(durees)
    assert operation.duration_p50 <= operation.duration_p95 <= operation.duration_max


def test_tailles_et_lignes_avec_des_nulls(magasin: TelemetryStore) -> None:
    magasin.record(
        [
            atlas(size=None, rows=None),
            atlas(size=10, rows=None),
            atlas(size=None, rows=5),
            atlas(size=30, rows=1),
            atlas(size=20, rows=None),
            atlas(size=None, rows=2),
            atlas(size=40, rows=None),
        ]
    )
    operation = seule(magasin)
    assert operation.count == 7
    # Tailles 10, 20, 30, 40 ; lignes 1, 2, 5 : les nulls ne comptent pas.
    assert (operation.size_p50, operation.size_max) == (25.0, 40)
    assert (operation.rows_p50, operation.rows_max) == (2.0, 5)
    assert isinstance(operation.size_max, int) and isinstance(operation.rows_max, int)


def test_tailles_et_lignes_toutes_nulles(magasin: TelemetryStore) -> None:
    magasin.record([http(), http(status=500, outcome="error")])
    operation = seule(magasin)
    assert (operation.size_p50, operation.size_max, operation.rows_p50, operation.rows_max) == (
        None,
        None,
        None,
        None,
    )


def test_grandes_tailles_exactes_au_maximum(magasin: TelemetryStore) -> None:
    magasin.record([atlas(size=2**63 - 1), atlas(size=2**53 + 1)])
    operation = seule(magasin)
    assert operation.size_max == 2**63 - 1


def test_tailles_nulles_ne_sont_pas_zero(magasin: TelemetryStore) -> None:
    magasin.record([atlas(size=0, rows=0), atlas(), atlas()])
    operation = seule(magasin)
    assert (operation.size_p50, operation.size_max) == (0.0, 0)
    assert (operation.rows_p50, operation.rows_max) == (0.0, 0)


# --- Résumé : erreurs et refus ---------------------------------------------------------------


def test_erreurs_et_refus_d_une_route(magasin: TelemetryStore) -> None:
    magasin.record(
        [
            http(status=100),
            http(status=200),
            http(status=302),
            http(status=399),
            http(status=400, outcome="invalid_request"),
            http(status=404, outcome="space_not_found"),
            http(status=499, outcome="other"),
            http(status=500, outcome="error"),
            http(status=503, outcome="catalog_unavailable"),
            http(status=599, outcome="error"),
            # L'issue ne décide pas : c'est le statut d'une requête qui compte.
            http(status=200, outcome="error"),
            http(status=500, outcome="ok"),
            http(status=403, outcome="ok"),
        ]
    )
    operation = seule(magasin)
    assert (operation.count, operation.errors, operation.refusals) == (13, 4, 4)


def test_erreurs_d_une_lecture_d_atlas(magasin: TelemetryStore) -> None:
    magasin.record(
        [
            atlas(outcome="ok"),
            atlas(outcome="ok"),
            atlas(outcome="error"),
            atlas(outcome="catalog_unavailable"),
            atlas(outcome="other"),
            atlas(outcome="document_not_found"),
        ]
    )
    operation = seule(magasin)
    # Sans statut : toute issue autre que `ok` est une erreur, jamais un refus.
    assert (operation.count, operation.errors, operation.refusals) == (6, 4, 0)


def test_aucune_erreur_ni_refus(magasin: TelemetryStore) -> None:
    magasin.record([http(), atlas()])
    for operation in magasin.summary(Window.DAY, MAINTENANT).operations:
        assert (operation.errors, operation.refusals) == (0, 0)


# --- Résumé : regroupement et ordre ----------------------------------------------------------


def test_regroupement_par_genre_operation_et_methode(magasin: TelemetryStore) -> None:
    magasin.record(
        [
            http(operation="x", method="GET", duration_ms=1.0),
            http(operation="x", method="GET", duration_ms=3.0),
            http(operation="x", method="POST", duration_ms=5.0),
            http(operation="y", method="GET", duration_ms=7.0),
            atlas(operation="x", duration_ms=9.0),
            atlas(operation="x", duration_ms=11.0),
            # L'espace et l'environnement ne séparent pas les groupes.
            http(operation="x", method="GET", space="a1", environment="PROD", duration_ms=2.0),
        ]
    )
    resume = magasin.summary(Window.DAY, MAINTENANT)
    comptes = {cle(o): (o.count, o.duration_max) for o in resume.operations}
    assert comptes == {
        ("http", "x", "GET"): (3, 3.0),
        ("http", "x", "POST"): (1, 5.0),
        ("http", "y", "GET"): (1, 7.0),
        ("atlas", "x", None): (2, 11.0),
    }
    assert resume.oldest == resume.newest == MAINTENANT


def test_les_plus_lentes_d_abord(magasin: TelemetryStore) -> None:
    magasin.record(
        [
            http(operation="rapide", duration_ms=1.0),
            # Maximum élevé mais p95 bas : c'est le p95 qui classe.
            *[http(operation="pic", duration_ms=2.0) for _ in range(40)],
            http(operation="pic", duration_ms=10_000.0),
            http(operation="lente", duration_ms=500.0),
            atlas(operation="moyenne", duration_ms=50.0),
        ]
    )
    resume = magasin.summary(Window.DAY, MAINTENANT)
    assert [o.operation for o in resume.operations] == ["lente", "moyenne", "pic", "rapide"]
    assert [o.duration_max for o in resume.operations] == [500.0, 50.0, 10_000.0, 1.0]
    p95 = [o.duration_p95 for o in resume.operations]
    assert p95 == sorted(p95, reverse=True)


def test_ordre_a_p95_egal(magasin: TelemetryStore) -> None:
    egales = [
        http(operation="b", method="POST"),
        http(operation="b", method="GET"),
        http(operation="b", method="DELETE"),
        http(operation="a", method="PUT"),
        http(operation="B", method="GET"),
        http(operation="_", method="GET"),
        atlas(operation="z", duration_ms=12.5),
        atlas(operation="b", duration_ms=12.5),
        atlas(operation="Z", duration_ms=12.5),
    ]
    magasin.record([*egales, http(operation="lente", duration_ms=99.0)])
    resume = magasin.summary(Window.DAY, MAINTENANT)
    # Genre, puis opération et méthode dans l'ordre des points de code, sans la collation.
    assert [cle(o) for o in resume.operations] == [
        ("http", "lente", "GET"),
        ("atlas", "Z", None),
        ("atlas", "b", None),
        ("atlas", "z", None),
        ("http", "B", "GET"),
        ("http", "_", "GET"),
        ("http", "a", "PUT"),
        ("http", "b", "DELETE"),
        ("http", "b", "GET"),
        ("http", "b", "POST"),
    ]


def test_ordre_stable_d_une_lecture_a_l_autre(magasin: TelemetryStore) -> None:
    magasin.record([http(operation=f"op{i % 7}", duration_ms=float(i % 3)) for i in range(50)])
    premier = magasin.summary(Window.DAY, MAINTENANT).operations
    magasin.record([http(at=avant(days=2), operation="ancienne")])
    assert magasin.summary(Window.DAY, MAINTENANT).operations == premier


def test_le_resume_ne_modifie_rien(magasin: TelemetryStore, migre: Engine) -> None:
    magasin.record([http(), atlas(), http(at=avant(days=40))])
    avant_lecture = lignes(migre)
    for fenetre in Window:
        magasin.summary(fenetre, MAINTENANT)
    assert lignes(migre) == avant_lecture
    with migre.connect() as connexion:
        assert connexion.execute(select(func.count()).select_from(telemetry)).scalar_one() == 3
