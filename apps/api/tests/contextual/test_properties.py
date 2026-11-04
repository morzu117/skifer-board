"""Propriétés 1 à 9 du plan 03, avec des oracles indépendants."""

from dataclasses import replace

import pyarrow as pa
import pyarrow.compute as pc
import pytest
from hypothesis import given
from hypothesis import strategies as st
from skifer_board.contextual import (
    Additivity,
    Aggregation,
    AvgComponents,
    Completeness,
    ContextualResult,
    Derived,
    MetricRule,
    Reason,
    ResultContract,
    Scope,
    Unavailable,
    aggregate,
    share_of_total,
)


@st.composite
def resultats(draw: st.DrawFn) -> ContextualResult:
    """Grain unique magasin/mois, montants signés et nuls, effectifs positifs."""
    taille = draw(st.integers(2, 24))
    montants = draw(
        st.lists(st.one_of(st.none(), st.integers(-10000, 10000)), min_size=taille, max_size=taille)
    )
    effectifs = draw(st.lists(st.integers(1, 100), min_size=taille, max_size=taille))
    sommes = draw(st.lists(st.integers(0, 10000), min_size=taille, max_size=taille))
    table = pa.table(
        {
            "magasin": [f"magasin-{i // 2}" for i in range(taille)],
            "mois": [f"2026-{i % 2 + 1:02}" for i in range(taille)],
            "montant": pa.array(montants, pa.float64()),
            "minimum": pa.array(montants, pa.float64()),
            "maximum": pa.array(montants, pa.float64()),
            "somme": sommes,
            "effectif": effectifs,
            "moyenne": [s / n for s, n in zip(sommes, effectifs, strict=True)],
            "distinct": effectifs,
        }
    )
    regles = (
        MetricRule("montant", Aggregation.SUM),
        MetricRule("minimum", Aggregation.MIN),
        MetricRule("maximum", Aggregation.MAX),
        MetricRule("moyenne", Aggregation.AVG, components=AvgComponents("somme", "effectif")),
        MetricRule("distinct", Aggregation.COUNT_DISTINCT),
    )
    return ContextualResult(
        table, ResultContract(("magasin", "mois"), regles, Completeness.COMPLETE, "preuve-test")
    )


def derive(valeur: Derived | Unavailable) -> Derived:
    """Un calcul permis doit fournir un résultat et conserver sa provenance."""
    assert isinstance(valeur, Derived), valeur
    assert valeur.source_evidence_id == "preuve-test"
    return valeur


@given(resultats(), st.sets(st.integers(0, 11)))
def test_01_somme_selection(resultat: ContextualResult, indices: set[int]) -> None:
    magasins = [f"magasin-{i}" for i in sorted(indices)]
    masque = pc.is_in(resultat.table["magasin"], value_set=pa.array(magasins, pa.string()))
    attendu = pc.sum(resultat.table.filter(masque)["montant"]).as_py()
    obtenu = derive(aggregate(resultat, "montant", selection={"magasin": magasins}))
    assert obtenu.table["montant"].to_pylist() == [attendu]
    assert obtenu.scope is Scope.SELECTION


@given(resultats())
def test_02_selection_sans_filtre_ou_complete(resultat: ContextualResult) -> None:
    attendu = pc.sum(resultat.table["montant"]).as_py()
    for selection in ({}, {"magasin": resultat.table["magasin"].to_pylist()}):
        assert derive(aggregate(resultat, "montant", selection=selection)).table[
            "montant"
        ].to_pylist() == [attendu]
    assert derive(aggregate(resultat, "montant")).table["montant"].to_pylist() == [attendu]
    vide = derive(aggregate(resultat, "montant", selection={"magasin": []}))
    assert vide.table["montant"].to_pylist() == [None]


@given(resultats())
def test_03_sous_totaux(resultat: ContextualResult) -> None:
    obtenu = derive(aggregate(resultat, "montant", group_by=["magasin"]))
    assert pc.sum(obtenu.table["montant"]).as_py() == pc.sum(resultat.table["montant"]).as_py()
    for ligne in obtenu.table.to_pylist():
        lignes = resultat.table.filter(pc.equal(resultat.table["magasin"], ligne["magasin"]))
        assert ligne["montant"] == pc.sum(lignes["montant"]).as_py()


@given(resultats(), st.sampled_from(["2026-01", "2026-02"]))
def test_04_extrema(resultat: ContextualResult, mois: str) -> None:
    lignes = resultat.table.filter(pc.equal(resultat.table["mois"], pa.scalar(mois)))
    for metrique, fonction in (("minimum", pc.min), ("maximum", pc.max)):
        obtenu = derive(aggregate(resultat, metrique, selection={"mois": [mois]}))
        assert obtenu.table[metrique].to_pylist() == [fonction(lignes[metrique]).as_py()]


@given(resultats())
def test_05_moyenne_ponderee(resultat: ContextualResult) -> None:
    obtenu = derive(aggregate(resultat, "moyenne", group_by=["magasin"]))
    for ligne in obtenu.table.to_pylist():
        lignes = [r for r in resultat.table.to_pylist() if r["magasin"] == ligne["magasin"]]
        attendu = sum(r["somme"] for r in lignes) / sum(r["effectif"] for r in lignes)
        assert ligne["moyenne"] == pytest.approx(attendu)


@given(resultats(), st.sampled_from(list(Additivity)))
def test_06_refus_distinct(resultat: ContextualResult, additivite: Additivity) -> None:
    regle = MetricRule(
        "distinct",
        Aggregation.COUNT_DISTINCT,
        additivite,
        frozenset({"mois"}) if additivite is Additivity.SEMI_ADDITIVE else frozenset(),
    )
    resultat = ContextualResult(resultat.table, replace(resultat.contract, metrics=(regle,)))
    obtenu = aggregate(resultat, "distinct", selection={})
    assert isinstance(obtenu, Unavailable)
    assert obtenu.reason is Reason.COUNT_DISTINCT_NOT_SUMMABLE
    assert obtenu.detail
    assert obtenu.engine_request.metric == "distinct"
    assert obtenu.engine_request.scope is Scope.SELECTION
    assert obtenu.engine_request.group_by == ()
    assert obtenu.engine_request.selection == ()


@given(resultats(), st.sampled_from([Completeness.TRUNCATED, Completeness.TOP_N]))
def test_07_total_incomplet(resultat: ContextualResult, completude: Completeness) -> None:
    resultat = ContextualResult(resultat.table, replace(resultat.contract, completeness=completude))
    assert derive(aggregate(resultat, "montant")).partial
    selection = derive(aggregate(resultat, "montant", selection={"mois": ["2026-01"]}))
    assert selection.scope is Scope.SELECTION
    for obtenu in (
        aggregate(resultat, "montant", scope=Scope.FILTERED_PERIMETER),
        share_of_total(
            resultat, "montant", group_by=["magasin"], denominator=Scope.FILTERED_PERIMETER
        ),
    ):
        assert isinstance(obtenu, Unavailable)
        assert obtenu.reason is Reason.INCOMPLETE_RESULT
        assert obtenu.engine_request.scope is Scope.FILTERED_PERIMETER


@given(resultats())
def test_08_partition_des_parts(resultat: ContextualResult) -> None:
    obtenu = derive(share_of_total(resultat, "montant", group_by=["magasin"]))
    total = pc.sum(resultat.table["montant"]).as_py()
    if total is None or total == 0:
        assert obtenu.table["share"].null_count == obtenu.table.num_rows
    else:
        assert pc.sum(obtenu.table["share"]).as_py() == pytest.approx(1.0)
        for ligne in obtenu.table.to_pylist():
            valeurs = [
                r["montant"]
                for r in resultat.table.to_pylist()
                if r["magasin"] == ligne["magasin"] and r["montant"] is not None
            ]
            attendu = sum(valeurs) / total if valeurs else None
            assert ligne["share"] == pytest.approx(attendu)


@given(resultats(), st.data())
def test_09_permutation(resultat: ContextualResult, donnees: st.DataObject) -> None:
    indices = donnees.draw(st.permutations(range(resultat.table.num_rows)))
    permute = ContextualResult(resultat.table.take(pa.array(indices)), resultat.contract)
    for metrique in ("montant", "minimum", "maximum", "moyenne", "distinct"):
        for groupes in ([], ["magasin"], ["magasin", "mois"]):
            for selection in (None, {"mois": ["2026-01"]}):
                avant = aggregate(resultat, metrique, group_by=groupes, selection=selection)
                apres = aggregate(permute, metrique, group_by=groupes, selection=selection)
                assert avant == apres
                assert share_of_total(
                    resultat, metrique, group_by=groupes, selection=selection
                ) == share_of_total(permute, metrique, group_by=groupes, selection=selection)
