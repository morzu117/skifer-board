"""Références au catalogue et règles des calculs contextuels, sur un catalogue écrit à la main
(plan 18.2, A6). Les mêmes règles passent par le serveur dans `test_routes_validation`."""

from __future__ import annotations

from typing import Any

import pytest
from skifer_board.content import ContentError
from skifer_board.content.errors import Violation
from skifer_board.content.references import (
    CATALOG_RULES,
    CONTEXTUAL_RULES,
    REFERENCE_RULES,
    contextual_violations,
    reference_violations,
    refusal,
)

from .monde import document, new_id


def metrique(nom: str, aggregation: str | None, additivite: str) -> dict[str, Any]:
    return {"name": nom, "aggregation": aggregation, "additivity": additivite}


CATALOGUE: dict[str, Any] = {
    "models": [
        {
            "name": "sales",
            "metrics": [
                metrique("revenue", "sum", "additive"),
                metrique("orders", "count", "additive"),
                metrique("balance", "sum", "semi_additive"),
                metrique("buyers", "count_distinct", "non_additive"),
                metrique("basket", "avg", "non_additive"),
                metrique("average_additive", "avg", "additive"),
                metrique("rate", None, "non_additive"),
            ],
            "dimensions": [{"name": "region"}, {"name": "channel"}],
        }
    ]
}


def analyse(metrique: str, operation: str, dimensions: list[str], **plus: Any) -> dict[str, Any]:
    calcul: dict[str, Any] = {"operation": operation, "metric": metrique, "group_by": []}
    calcul.update({"scope": None} if operation == "aggregate" else {"denominator": "loaded_result"})
    return document(
        new_id(),
        query={
            "connection": "finance",
            "model": "sales",
            "metrics": [metrique],
            "dimensions": dimensions,
            "filters": [],
        },
        contextual=[{**calcul, **plus}],
    )


@pytest.mark.parametrize(
    ("metrique_", "operation", "dimensions", "regle"),
    [
        ("buyers", "aggregate", ["region"], "count_distinct_not_summable"),
        ("balance", "aggregate", ["region"], "non_additive"),
        ("basket", "aggregate", ["region"], "non_additive"),
        # Une moyenne que le catalogue dirait additive : ses composantes manquent.
        ("average_additive", "aggregate", ["region"], "components_missing"),
        ("rate", "aggregate", ["region"], "unknown_aggregation"),
        ("rate", "share", ["region"], "unknown_aggregation"),
        ("basket", "share", ["region"], "share_undefined"),
        ("buyers", "share", ["region"], "share_undefined"),
        ("balance", "share", ["region"], "non_additive"),
    ],
)
def test_reagregation_refusee_avec_la_raison_de_la_route(
    metrique_: str, operation: str, dimensions: list[str], regle: str
) -> None:
    trouvees = contextual_violations(analyse(metrique_, operation, dimensions), CATALOGUE)
    assert trouvees == [Violation("/contextual/0/metric", regle)]
    assert regle in CONTEXTUAL_RULES


@pytest.mark.parametrize(
    ("metrique_", "operation", "dimensions", "garde"),
    [
        ("revenue", "aggregate", ["region"], []),
        ("revenue", "share", ["region"], []),
        ("orders", "share", ["region", "channel"], []),
        # Aucune dimension n'est retirée : la valeur du moteur est reprise telle quelle.
        ("buyers", "aggregate", ["region"], ["region"]),
        ("balance", "aggregate", [], []),
        ("average_additive", "aggregate", ["region"], ["region"]),
        ("balance", "aggregate", ["region", "channel"], ["channel", "region"]),
    ],
)
def test_reagregation_acceptee(
    metrique_: str, operation: str, dimensions: list[str], garde: list[str]
) -> None:
    valeur = analyse(metrique_, operation, dimensions, group_by=garde)
    assert contextual_violations(valeur, CATALOGUE) == []


def test_une_metrique_non_resolue_n_est_pas_jugee_ici() -> None:
    valeur = analyse("buyers", "aggregate", ["region"])
    valeur["contextual"][0]["metric"] = "ghost"
    assert contextual_violations(valeur, CATALOGUE) == []


def test_un_modele_inconnu_n_a_pas_de_calcul_a_juger() -> None:
    valeur = analyse("buyers", "aggregate", ["region"])
    valeur["query"]["model"] = "ghost"
    assert contextual_violations(valeur, CATALOGUE) == []


def test_chaque_calcul_est_juge_a_sa_position() -> None:
    valeur = analyse("buyers", "aggregate", ["region"])
    valeur["query"]["metrics"] = ["buyers", "revenue", "rate"]
    valeur["contextual"] = [
        {"operation": "aggregate", "metric": "revenue", "group_by": [], "scope": None},
        {"operation": "aggregate", "metric": "buyers", "group_by": [], "scope": None},
        {"operation": "aggregate", "metric": "rate", "group_by": [], "scope": None},
    ]
    assert contextual_violations(valeur, CATALOGUE) == [
        Violation("/contextual/1/metric", "count_distinct_not_summable"),
        Violation("/contextual/2/metric", "unknown_aggregation"),
    ]


def test_references_valides() -> None:
    assert reference_violations(analyse("revenue", "aggregate", []), CATALOGUE, {"finance"}) == []


def test_references_disparues() -> None:
    valeur = analyse("revenue", "aggregate", ["region"])
    valeur["query"]["metrics"] = ["revenue", "ghost"]
    valeur["query"]["dimensions"] = ["region", "ghost"]
    valeur["query"]["connection"] = "autre"
    assert reference_violations(valeur, CATALOGUE, {"finance"}) == [
        Violation("/query/connection", "unknown_connection"),
        Violation("/query/metrics/1", "unknown_metric"),
        Violation("/query/dimensions/1", "unknown_dimension"),
    ]


def test_modele_disparu_arrete_l_examen() -> None:
    valeur = analyse("revenue", "aggregate", [])
    valeur["query"]["model"] = "ghost"
    valeur["query"]["filters"] = [{"column": "ghost", "operator": "eq", "value": "x"}]
    assert reference_violations(valeur, CATALOGUE, {"finance"}) == [
        Violation("/query/model", "unknown_model")
    ]


def test_un_filtre_est_juge_par_le_code_de_la_soumission() -> None:
    catalogue: dict[str, Any] = {
        "models": [
            {
                "name": "sales",
                "metrics": [metrique("revenue", "sum", "additive")],
                "dimensions": [{"name": "region", "type": "string", "is_time": False}],
            }
        ]
    }
    valeur = analyse("revenue", "aggregate", [])
    valeur["query"]["filters"] = [
        {"column": "region", "operator": "eq", "value": "Nord"},
        {"column": "region", "operator": "eq", "value": 3},
        {"column": "ghost", "operator": "eq", "value": "x"},
    ]
    assert reference_violations(valeur, catalogue, {"finance"}) == [
        Violation("/query/filters/1", "filter_not_allowed"),
        Violation("/query/filters/2", "filter_not_allowed"),
    ]


def test_les_regles_sont_fermees() -> None:
    assert REFERENCE_RULES.isdisjoint(CONTEXTUAL_RULES)
    assert CATALOG_RULES == REFERENCE_RULES | CONTEXTUAL_RULES


def test_refus_trie_et_sans_doublon() -> None:
    erreur = refusal(
        [
            Violation("/b", "unknown_metric"),
            Violation("/a", "unknown_model"),
            Violation("/a", "unknown_model"),
        ]
    )
    assert isinstance(erreur, ContentError)
    assert (erreur.code, erreur.reason) == ("invalid_analysis", "unknown_model")
    assert erreur.violations == (
        Violation("/a", "unknown_model"),
        Violation("/b", "unknown_metric"),
    )
