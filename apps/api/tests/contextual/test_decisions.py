"""Table de référence T3 : attentes explicites, sans recalcul des règles métier."""

from importlib import import_module
from itertools import product
from pathlib import Path
from typing import Any

import pyarrow as pa
import pytest
from skifer_board.contextual import (
    Additivity,
    Aggregation,
    AvgComponents,
    Completeness,
    ContextualResult,
    Derived,
    EngineRequest,
    MetricRule,
    Reason,
    ResultContract,
    Scope,
    Unavailable,
    aggregate,
    share_of_total,
)

REFERENCE: dict[str, Any] = import_module("yaml").safe_load(
    Path(__file__).with_name("decisions.yaml").read_text()
)
DECISIONS: list[dict[str, Any]] = REFERENCE["decisions"]


def identifiant(ligne: dict[str, Any]) -> str:
    """Identifiant lisible de chaque combinaison, y compris les composantes."""
    return "-".join(
        str(ligne[cle])
        for cle in (
            "aggregation",
            "additivite",
            "operation",
            "portee",
            "groupes",
            "completude",
            "composantes",
        )
    )


@pytest.mark.parametrize("ligne", DECISIONS, ids=identifiant)
def test_decision_de_reference(ligne: dict[str, Any]) -> None:
    donnees = dict(REFERENCE["donnees"])
    if ligne["aggregation"] == "avg":
        donnees["m"] = donnees["moyenne"]
    regle = MetricRule(
        "m",
        Aggregation(ligne["aggregation"]),
        Additivity(ligne["additivite"]),
        frozenset([ligne["dimension_non_additive"]])
        if ligne["dimension_non_additive"]
        else frozenset(),
        AvgComponents("somme", "effectif") if ligne["composantes"] else None,
    )
    resultat = ContextualResult(
        pa.table(donnees),
        ResultContract(
            ("region", "mois"), (regle,), Completeness(ligne["completude"]), "preuve-reference"
        ),
    )
    portee = Scope(ligne["portee"])
    selection: dict[str, list[str]] | None = {} if portee is Scope.SELECTION else None
    groupes = ligne["groupes"]
    assert ligne["regroupement"] == bool(groupes)
    if ligne["operation"] == "aggregate":
        obtenu = aggregate(resultat, "m", group_by=groupes, selection=selection, scope=portee)
        colonne = "m"
    else:
        obtenu = share_of_total(
            resultat, "m", group_by=groupes, selection=selection, denominator=portee
        )
        colonne = "share"
    attendu = ligne["attendu"]
    if "raison" in attendu:
        assert isinstance(obtenu, Unavailable), obtenu
        assert obtenu.reason is Reason(attendu["raison"])
        assert obtenu.detail
        assert obtenu.engine_request == EngineRequest(
            "m", tuple(attendu["groupes_moteur"]), (), Scope(attendu["portee_moteur"])
        )
    else:
        assert isinstance(obtenu, Derived), obtenu
        assert obtenu.table[colonne].to_pylist() == pytest.approx(attendu["valeurs"])
        assert obtenu.partial is attendu["partiel"]
        assert obtenu.group_by == tuple(groupes)
        assert obtenu.source_evidence_id == "preuve-reference"
        if colonne == "share":
            assert obtenu.denominator_scope is portee
            assert obtenu.scope is (
                Scope.SELECTION if selection is not None else Scope.LOADED_RESULT
            )
        else:
            assert obtenu.scope is portee


def test_matrice_exhaustive_sans_doublon() -> None:
    """Chaque combinaison valide du contrat possède sa ligne de référence."""
    axes = set(
        product(
            [
                (a.value, c)
                for a in Aggregation
                for c in ([False, True] if a is Aggregation.AVG else [False])
            ],
            [a.value for a in Additivity],
            ["aggregate", "share_of_total"],
            [s.value for s in Scope],
            [(), ("mois",), ("region",), ("region", "mois")],
            [c.value for c in Completeness],
        )
    )
    presentes = {
        (
            (ligne["aggregation"], ligne["composantes"]),
            ligne["additivite"],
            ligne["operation"],
            ligne["portee"],
            tuple(ligne["groupes"]),
            ligne["completude"],
        )
        for ligne in DECISIONS
    }
    assert len(DECISIONS) == len(presentes)
    assert presentes == axes
