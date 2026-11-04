"""Contrats fermés des calculs contextuels."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pyarrow as pa
import pytest
from skifer_board.execution.contextual import _nombre, calculer, figer
from skifer_board.execution.semantic import SemanticRequest
from skifer_board.spaces.web import Invalid


def data() -> bytes:
    table = pa.table(
        {
            "region": ["Nord", "Sud"],
            "jour": [1, 1],
            "valeur": [10, 20],
            "distinct": [2, 3],
            "moyenne": [1.0, 2.0],
        }
    )
    sink = pa.BufferOutputStream()
    with pa.ipc.new_stream(sink, table.schema) as writer:
        writer.write_table(table)
    return sink.getvalue().to_pybytes()


def snapshot() -> dict[str, Any]:
    return {
        "dimensions": ["region", "jour"],
        "metrics": [
            {"name": "valeur", "aggregation": "sum", "additivity": "additive"},
            {"name": "distinct", "aggregation": "count_distinct", "additivity": "non_additive"},
            {"name": "moyenne", "aggregation": "avg", "additivity": "non_additive"},
        ],
    }


def body(**patch: Any) -> dict[str, Any]:
    return {
        "operation": "aggregate",
        "metric": "valeur",
        "group_by": [],
        "selection": None,
        "scope": None,
        "denominator": None,
        **patch,
    }


def test_aggregate_selection_sous_totaux_et_part() -> None:
    total = calculer(data(), snapshot(), False, "preuve", body(selection={"region": ["Nord"]}))
    assert total["rows"] == [{"valeur": 10}] and total["scope"] == "selection"
    subtotal = calculer(data(), snapshot(), False, "preuve", body(group_by=["jour"]))
    assert subtotal["rows"] == [{"jour": 1, "valeur": 30}]
    part = calculer(
        data(),
        snapshot(),
        False,
        "preuve",
        body(operation="share", group_by=["region"], denominator="loaded_result"),
    )
    assert [x["share"] for x in part["rows"]] == pytest.approx([1 / 3, 2 / 3])
    selected = calculer(
        data(),
        snapshot(),
        False,
        "preuve",
        body(
            operation="share",
            group_by=["region"],
            selection={"region": ["Nord"]},
            denominator="selection",
        ),
    )
    assert selected["rows"][0]["share"] == 1.0
    loaded = calculer(
        data(),
        snapshot(),
        False,
        "preuve",
        body(
            operation="share",
            group_by=["region"],
            selection={"region": ["Nord"]},
            denominator="loaded_result",
        ),
    )
    assert loaded["rows"][0]["share"] == pytest.approx(1 / 3)


@pytest.mark.parametrize(
    "metric,reason", [("distinct", "count_distinct_not_summable"), ("moyenne", "non_additive")]
)
def test_non_reagregeable(metric: str, reason: str) -> None:
    result = calculer(data(), snapshot(), False, "preuve", body(metric=metric))
    assert (result["status"], result["reason"]) == ("unavailable", reason)


def test_troncature_et_ancien_contrat() -> None:
    result = calculer(data(), snapshot(), True, "preuve", body(selection={"region": ["Nord"]}))
    assert result["partial"] and result["scope"] == "loaded_result"
    unavailable = calculer(data(), snapshot(), True, "preuve", body(scope="filtered_perimeter"))
    assert unavailable["reason"] == "incomplete_result"
    share = calculer(
        data(),
        snapshot(),
        True,
        "preuve",
        body(
            operation="share",
            group_by=["region"],
            selection={"region": ["Nord"]},
            denominator="filtered_perimeter",
        ),
    )
    assert share["reason"] == "incomplete_result"
    assert share["engine_request"] == {
        "metric": "valeur",
        "group_by": [],
        "selection": None,
        "scope": "filtered_perimeter",
    }
    assert calculer(data(), None, False, "preuve", body())["reason"] == "contract_unavailable"
    s = snapshot()
    s["metrics"][0]["aggregation"] = None
    assert calculer(data(), s, False, "preuve", body())["reason"] == "unknown_aggregation"


@pytest.mark.parametrize(
    "patch",
    [
        {"operation": "invalid"},
        {"metric": 1},
        {"group_by": "region"},
        {"group_by": ["region", "region"]},
        {"group_by": ["autre"]},
        {"selection": {}},
        {"selection": {"autre": ["x"]}},
        {"selection": {"region": []}},
        {"selection": {"region": [None]}},
        {"selection": {"jour": [True]}},
        {"selection": {"region": [42]}},
        {"scope": "selection"},
        {"operation": "share", "scope": "filtered_perimeter", "denominator": "loaded_result"},
        {"denominator": "selection"},
        {"operation": "share", "denominator": None},
        {"operation": "share", "denominator": "selection"},
        {"metric": "absente"},
        {"operation": "share", "metric": "share", "denominator": "loaded_result"},
        {"operation": "share", "group_by": ["share"], "denominator": "loaded_result"},
    ],
)
def test_invalid(patch: dict[str, Any]) -> None:
    with pytest.raises(Invalid):
        calculer(data(), snapshot(), False, "preuve", body(**patch))


def test_precision() -> None:
    assert _nombre(Decimal("1.230")) == {"type": "decimal", "value": "1.230"}
    assert _nombre(2**53 + 1) == {"type": "integer", "value": "9007199254740993"}
    assert _nombre(2**53) == 2**53


def test_figer_depuis_catalogue() -> None:
    catalog: dict[str, Any] = {
        "models": [
            {
                "name": "ventes",
                "metrics": [{"name": "chiffre", "aggregation": "sum", "additivity": "additive"}],
            }
        ]
    }
    request = SemanticRequest("ventes", ("chiffre",), ("region",))
    result = figer(request, catalog)
    catalog["models"][0]["metrics"][0]["aggregation"] = "avg"
    assert result["metrics"][0]["aggregation"] == "sum"


def flux(table: pa.Table) -> bytes:
    sink = pa.BufferOutputStream()
    with pa.ipc.new_stream(sink, table.schema) as writer:
        writer.write_table(table)
    return sink.getvalue().to_pybytes()


@pytest.mark.parametrize(
    "kind,items,selection",
    [
        (pa.bool_(), [True, False], [True]),
        (pa.float64(), [1.5, 2.0], [1.5]),
        (
            pa.date32(),
            [__import__("datetime").date(2026, 1, 1), __import__("datetime").date(2026, 1, 2)],
            ["2026-01-01"],
        ),
        (
            pa.timestamp("us"),
            [
                __import__("datetime").datetime(2026, 1, 1),
                __import__("datetime").datetime(2026, 1, 2),
            ],
            ["2026-01-01T00:00:00"],
        ),
        (pa.decimal128(10, 2), [Decimal("1.00"), Decimal("2.00")], ["1.00"]),
        (pa.large_string(), ["a", "b"], ["a"]),
    ],
)
def test_selection_types_arrow(kind: pa.DataType, items: list[Any], selection: list[Any]) -> None:
    table = pa.table({"cle": pa.array(items, type=kind), "valeur": [10, 20]})
    contract = {
        "dimensions": ["cle"],
        "metrics": [{"name": "valeur", "aggregation": "sum", "additivity": "additive"}],
    }
    output = calculer(flux(table), contract, False, "preuve", body(selection={"cle": selection}))
    assert output["rows"] == [{"valeur": 10}]


def test_erreur_selection_type_et_resultat_incoherent() -> None:
    table = pa.table({"cle": pa.array([b"a"], type=pa.binary()), "valeur": [10]})
    contract = {
        "dimensions": ["cle"],
        "metrics": [{"name": "valeur", "aggregation": "sum", "additivity": "additive"}],
    }
    with pytest.raises(Invalid):
        calculer(flux(table), contract, False, "preuve", body(selection={"cle": ["a"]}))
    assert (
        calculer(b"incorrect", snapshot(), False, "preuve", body())["reason"] == "result_unreadable"
    )
    with pytest.raises(Invalid):
        calculer(data(), snapshot(), False, "preuve", {})


def test_nombres_et_dates_exactes() -> None:
    from datetime import date, datetime

    assert _nombre(date(2026, 1, 1)) == "2026-01-01"
    assert _nombre(datetime(2026, 1, 1)) == "2026-01-01T00:00:00"
    table = pa.table(
        {
            "region": ["Nord", "Sud"],
            "valeur": pa.array([Decimal("1.20"), Decimal("2.30")], type=pa.decimal128(10, 2)),
        }
    )
    contract = {
        "dimensions": ["region"],
        "metrics": [{"name": "valeur", "aggregation": "sum", "additivity": "additive"}],
    }
    output = calculer(flux(table), contract, False, "preuve", body())
    assert output["rows"] == [{"valeur": {"type": "decimal", "value": "3.50"}}]


@pytest.mark.parametrize(
    "kind,items",
    [
        (pa.date32(), [__import__("datetime").date(2026, 1, 1)]),
        (pa.timestamp("us"), [__import__("datetime").datetime(2026, 1, 1)]),
        (pa.decimal128(10, 2), [Decimal("1.00")]),
    ],
)
def test_selection_temporelle_ou_decimale_mal_typee(kind: pa.DataType, items: list[Any]) -> None:
    table = pa.table({"cle": pa.array(items, type=kind), "valeur": [10]})
    contract = {
        "dimensions": ["cle"],
        "metrics": [{"name": "valeur", "aggregation": "sum", "additivity": "additive"}],
    }
    with pytest.raises(Invalid):
        calculer(flux(table), contract, False, "preuve", body(selection={"cle": [42]}))


def test_somme_entiere_sans_debordement_silencieux() -> None:
    table = pa.table(
        {"region": ["Nord", "Sud"], "valeur": pa.array([2**63 - 1, 1], type=pa.int64())}
    )
    contract = {
        "dimensions": ["region"],
        "metrics": [{"name": "valeur", "aggregation": "sum", "additivity": "additive"}],
    }
    result = calculer(flux(table), contract, False, "preuve", body())
    assert result["rows"] == [{"valeur": {"type": "integer", "value": "9223372036854775808"}}]


def test_somme_flottante_non_finie_indisponible() -> None:
    table = pa.table({"region": ["Nord", "Sud"], "valeur": [1e308, 1e308]})
    contract = {
        "dimensions": ["region"],
        "metrics": [{"name": "valeur", "aggregation": "sum", "additivity": "additive"}],
    }
    result = calculer(flux(table), contract, False, "preuve", body())
    assert result["reason"] == "numeric_overflow"


@pytest.mark.parametrize("aggregation,expected", [("min", 10), ("max", 20)])
def test_minimum_et_maximum(aggregation: str, expected: int) -> None:
    contract = snapshot()
    contract["metrics"][0]["aggregation"] = aggregation
    result = calculer(data(), contract, False, "preuve", body())
    assert result["rows"] == [{"valeur": expected}]


def test_somme_decimale_sans_debordement_silencieux() -> None:
    maximum = Decimal("9" * 38)
    contract = {
        "dimensions": ["region"],
        "metrics": [{"name": "valeur", "aggregation": "sum", "additivity": "additive"}],
    }
    table = pa.table(
        {
            "region": ["a", "b", "c", "d"],
            "valeur": pa.array([maximum] * 4, type=pa.decimal128(38, 0)),
        }
    )
    assert calculer(flux(table), contract, False, "preuve", body())["reason"] == "numeric_overflow"
    table = pa.table(
        {
            "region": ["a", "b"],
            "valeur": pa.array([maximum, maximum.copy_negate()], type=pa.decimal128(38, 0)),
        }
    )
    assert calculer(flux(table), contract, False, "preuve", body())["rows"] == [
        {"valeur": {"type": "decimal", "value": "0"}}
    ]


def test_somme_decimale_nulle() -> None:
    table = pa.table({"region": ["Nord"], "valeur": pa.array([None], type=pa.decimal128(10, 2))})
    contract = {
        "dimensions": ["region"],
        "metrics": [{"name": "valeur", "aggregation": "sum", "additivity": "additive"}],
    }
    assert calculer(flux(table), contract, False, "preuve", body())["rows"] == [{"valeur": None}]


def test_cle_binaire_indisponible() -> None:
    table = pa.table({"region": pa.array([b"a", b"b"], type=pa.binary()), "valeur": [1, 2]})
    contract = {
        "dimensions": ["region"],
        "metrics": [{"name": "valeur", "aggregation": "sum", "additivity": "additive"}],
    }
    result = calculer(flux(table), contract, False, "preuve", body(group_by=["region"]))
    assert result["reason"] == "unsupported_value"


@pytest.mark.parametrize(
    "cas", ["dimension_absente", "metrique_absente", "metrique_texte", "grain_double", "grain_vide"]
)
def test_resultat_stocke_invalide(cas: str) -> None:
    contract = {
        "dimensions": ["region"],
        "metrics": [{"name": "valeur", "aggregation": "sum", "additivity": "additive"}],
    }
    if cas == "dimension_absente":
        table = pa.table({"autre": ["a"], "valeur": [1]})
    elif cas == "metrique_absente":
        table = pa.table({"region": ["a"]})
    elif cas == "metrique_texte":
        table = pa.table({"region": ["a"], "valeur": ["non numerique"]})
    elif cas == "grain_double":
        table = pa.table({"region": ["a", "a"], "valeur": [1, 2]})
    else:
        contract["dimensions"] = []
        table = pa.table({"valeur": [1, 2]})
    request = body(selection={"region": ["a"]}) if cas == "dimension_absente" else body()
    result = calculer(flux(table), contract, False, "preuve", request)
    assert result["reason"] == (
        "grain_not_unique" if cas in {"grain_double", "grain_vide"} else "result_unreadable"
    )


def test_timestamp_ns_duckdb_non_serialisable() -> None:
    import duckdb

    with duckdb.connect() as connection:
        table = connection.sql(
            "SELECT TIMESTAMP_NS '2026-01-01 00:00:00.000000001' AS moment, 1 AS valeur"
        ).to_arrow_table()
    contract = {
        "dimensions": ["moment"],
        "metrics": [{"name": "valeur", "aggregation": "sum", "additivity": "additive"}],
    }
    assert (
        calculer(flux(table), contract, False, "preuve", body(group_by=["moment"]))["reason"]
        == "unsupported_value"
    )


def test_decimal_notation_positionnelle() -> None:
    assert _nombre(Decimal("1E-7")) == {"type": "decimal", "value": "0.0000001"}
    assert _nombre(Decimal("0E-7")) == {"type": "decimal", "value": "0.0000000"}
    table = pa.table(
        {
            "region": ["a", "b"],
            "valeur": pa.array([Decimal("1E-7"), Decimal("0E-7")], type=pa.decimal128(10, 7)),
        }
    )
    contract = {
        "dimensions": ["region"],
        "metrics": [{"name": "valeur", "aggregation": "sum", "additivity": "additive"}],
    }
    result = calculer(flux(table), contract, False, "preuve", body(group_by=["region"]))
    assert result["rows"] == [
        {"region": "a", "valeur": {"type": "decimal", "value": "0.0000001"}},
        {"region": "b", "valeur": {"type": "decimal", "value": "0.0000000"}},
    ]
    assert result["row_count"] == 2


def test_ajout_selection_sans_ligne() -> None:
    result = calculer(data(), snapshot(), False, "preuve", body(selection={"region": ["absente"]}))
    assert (result["status"], result["reason"]) == ("unavailable", "empty_selection")


def test_semi_additive_refuse_la_reagregation() -> None:
    contract = snapshot()
    contract["metrics"][0]["additivity"] = "semi_additive"
    result = calculer(data(), contract, False, "preuve", body())
    assert result["reason"] == "non_additive"


def test_moyenne_additive_sans_composantes_est_indisponible() -> None:
    contract = snapshot()
    contract["metrics"][2]["additivity"] = "additive"
    result = calculer(data(), contract, False, "preuve", body(metric="moyenne"))
    assert result["reason"] == "components_missing"


def test_selection_booleenne_sur_entier_refusee() -> None:
    with pytest.raises(Invalid):
        calculer(data(), snapshot(), False, "preuve", body(selection={"jour": [True]}))


@pytest.mark.parametrize("cas", ["valeurs", "cles", "texte", "groupes"])
def test_bornes_isolees(cas: str) -> None:
    dimensions = [f"d{i}" for i in range(33)] if cas in {"cles", "groupes"} else ["region"]
    texte = "x" * 1025 if cas == "texte" else "v0"
    fields: dict[str, Any] = {dimension: [texte] for dimension in dimensions}
    fields["valeur"] = [1]
    contract = {
        "dimensions": dimensions,
        "metrics": [{"name": "valeur", "aggregation": "sum", "additivity": "additive"}],
    }
    patch: dict[str, Any]
    if cas == "valeurs":
        patch = {"selection": {"region": [f"v{i}" for i in range(101)]}}
    elif cas == "cles":
        patch = {"selection": {dimension: [texte] for dimension in dimensions}}
    elif cas == "texte":
        patch = {"selection": {"region": [texte]}}
    else:
        patch = {"group_by": dimensions}
    with pytest.raises(Invalid):
        calculer(flux(pa.table(fields)), contract, False, "preuve", body(**patch))


@pytest.mark.parametrize("kind", ["min", "max"])
def test_min_max_selon_le_catalogue_skifer(tmp_path: Any, kind: str) -> None:
    import yaml
    from skifer_board.execution.results import arrow_preview
    from skifer_board.execution.semantic import describe_catalog

    from execution.test_semantic import (
        RecordingConnector,
        _binding,
        _database,
        _model,
        _reader,
        _run,
    )

    models = _model(tmp_path)
    path = models / "orders.yaml"
    document = yaml.safe_load(path.read_text())
    document["models"][0]["metrics"][0]["type"] = kind
    path.write_text(yaml.safe_dump(document))
    request = SemanticRequest("orders", ("revenue",), ("region",))
    catalog = describe_catalog(models)
    assert catalog["models"][0]["metrics"][0]["additivity"] == "non_additive"
    result = _run(
        request, _reader("alice", "A"), _binding(), RecordingConnector(_database(tmp_path)), models
    )
    output = calculer(
        arrow_preview(result.rows).data,
        figer(request, catalog),
        False,
        "preuve",
        {**body(), "metric": "revenue"},
    )
    assert output["reason"] == "non_additive"


def test_selection_date_invalide_refusee() -> None:
    from datetime import date

    table = pa.table({"cle": pa.array([date(2026, 1, 1)], type=pa.date32()), "valeur": [10]})
    contract = {
        "dimensions": ["cle"],
        "metrics": [{"name": "valeur", "aggregation": "sum", "additivity": "additive"}],
    }
    with pytest.raises(Invalid):
        calculer(flux(table), contract, False, "preuve", body(selection={"cle": ["date invalide"]}))
