"""Validation, sérialisation canonique et diff structurel des analyses (plan 18, A2 et A3)."""

from __future__ import annotations

import copy
import datetime
import re
from pathlib import Path
from typing import Any

import pytest
import yaml
from hypothesis import given
from hypothesis import strategies as st
from skifer_board.content import (
    CODES,
    ContentError,
    Violation,
    diff,
    dumps,
    loads,
    validate,
)
from skifer_board.content import analysis as analysis_module
from skifer_board.content.analysis import Change

from .monde import document, new_id


def refus(valeur: Any) -> list[tuple[str, str]]:
    with pytest.raises(ContentError) as erreur:
        validate(valeur)
    assert erreur.value.code == "invalid_analysis"
    return [(v.path, v.rule) for v in erreur.value.violations]


def test_les_codes_sont_fermes() -> None:
    assert CODES == {
        "content_unavailable",
        "revision_conflict",
        "invalid_analysis",
        "analysis_not_found",
    }


def test_la_validation_normalise_sans_toucher_l_entree() -> None:
    entree = document(new_id())
    copie = copy.deepcopy(entree)
    sortie = validate(entree)
    assert entree == copie
    assert sortie["query"]["filters"][0]["value"] == ["Nord", "Sud"]
    sortie["owner"]["subject"] = "autre"
    assert entree["owner"]["subject"] == copie["owner"]["subject"]


@pytest.mark.parametrize(
    "valeur",
    [
        (1, 2),
        {1, 2},
        datetime.date(2026, 1, 1),
        b"octets",
        float("nan"),
        float("inf"),
        object(),
    ],
)
def test_seuls_les_types_json_sont_admis(valeur: Any) -> None:
    contenu = document(new_id())
    contenu["description"] = valeur
    assert refus(contenu) == [("/description", "unsupported_value")]


def test_les_cles_non_textuelles_sont_refusees() -> None:
    contenu = document(new_id())
    contenu["owner"] = {1: "x"}
    assert refus(contenu) == [("/owner", "unsupported_value")]


def test_un_champ_inconnu_n_est_cite_que_s_il_est_inoffensif() -> None:
    contenu = document(new_id())
    contenu["query"]["a b;\n"] = 1
    contenu["query"]["x" * 65] = 1
    contenu["query"]["/etc"] = 1
    contenu["query"]["bon_nom"] = 1
    assert refus(contenu) == [
        ("/query/*", "unknown_field"),
        ("/query/bon_nom", "unknown_field"),
    ]


def test_une_imbrication_extreme_est_refusee_sans_recursion() -> None:
    profond: Any = []
    for _ in range(50_000):
        profond = [profond]
    assert refus(profond) == [("/0" * 9, "out_of_bounds")]
    contenu = document(new_id())
    contenu["query"]["metrics"] = profond
    assert refus(contenu) == [("/query/metrics" + "/0" * 7, "out_of_bounds")]
    contenu["query"]["metrics"] = ["revenue"]
    contenu["unknown"] = {"a": {"b": {"c": {"d": {"e": {"f": {"g": {"h": {"i": {"j": 1}}}}}}}}}}
    assert refus(contenu) == [("/unknown/a/b/c/d/e/f/g/h", "out_of_bounds")]


def test_les_violations_sont_triees_et_sans_doublon() -> None:
    contenu = document(new_id(), sql="x", visibility="public")
    del contenu["name"]
    assert refus(contenu) == [
        ("/name", "missing_field"),
        ("/sql", "unknown_field"),
        ("/visibility", "value_not_allowed"),
    ]


@pytest.mark.parametrize(
    ("changement", "attendu"),
    [
        (lambda d: d["contextual"].append(d["contextual"][0]) or d, []),
        (
            lambda d: d["contextual"][0].update(metric="margin") or d,
            [("/contextual/0/metric", "metric_not_in_query")],
        ),
        (
            lambda d: d["contextual"][0].update(group_by=["channel"]) or d,
            [("/contextual/0/group_by/0", "group_by_not_in_query")],
        ),
    ],
)
def test_les_references_des_calculs_contextuels(changement: Any, attendu: list[Any]) -> None:
    contenu = changement(document(new_id()))
    if attendu:
        assert refus(contenu) == attendu
    else:
        assert len(validate(contenu)["contextual"]) == 2


def test_le_nom_share_est_reserve_aux_parts() -> None:
    contenu = document(new_id())
    contenu["query"]["metrics"] = ["share"]
    contenu["query"]["dimensions"] = ["share"]
    contenu["contextual"] = [
        {"operation": "aggregate", "metric": "share", "group_by": ["share"], "scope": None},
        {
            "operation": "share",
            "metric": "share",
            "group_by": ["share"],
            "denominator": "loaded_result",
        },
    ]
    assert refus(contenu) == [
        ("/contextual/1/group_by/0", "reserved_name"),
        ("/contextual/1/metric", "reserved_name"),
    ]


def test_un_filtre_refuse_par_la_soumission_est_refuse_ici() -> None:
    contenu = document(new_id())
    contenu["query"]["filters"] = [
        {"column": "region", "operator": "in", "value": ["a", "a"]},
        {"column": "region", "operator": "eq", "value": "ok"},
        {"column": "region", "operator": "in", "value": [1, "a"]},
    ]
    assert refus(contenu) == [
        ("/query/filters/0", "invalid_filter"),
        ("/query/filters/2", "invalid_filter"),
    ]


# -- YAML ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "brut",
    [
        b"\xff\xfe",
        b"a: [",
        b"a: 1\na: 2\n",
        b"a: 1\n<<: {a: 2}\n",
        b"a: 1\n---\nb: 2\n",
        b"a: !!python/object:os.system x\n",
        b"base: &x [1]\ncopie: *x\n",
        b"[" * 3000 + b"]" * 3000,
    ],
)
def test_un_texte_illisible_est_refuse(brut: bytes) -> None:
    with pytest.raises(ContentError) as erreur:
        loads(brut)
    assert erreur.value.violations == (Violation("", "unreadable_document"),)


@pytest.mark.parametrize(
    ("brut", "regle"),
    [
        (b"", "wrong_type"),
        (b"- a\n", "wrong_type"),
        (b"2026-01-01\n", "unsupported_value"),
    ],
)
def test_une_racine_qui_n_est_pas_un_objet_est_refusee(brut: bytes, regle: str) -> None:
    with pytest.raises(ContentError) as erreur:
        loads(brut)
    assert [(v.path, v.rule) for v in erreur.value.violations] == [("", regle)]


def test_une_date_yaml_n_est_pas_un_texte() -> None:
    brut = dumps(document(new_id())).replace(b"description: Suivi.", b"description: 2026-01-01")
    with pytest.raises(ContentError) as erreur:
        loads(brut)
    assert [(v.path, v.rule) for v in erreur.value.violations] == [
        ("/description", "unsupported_value")
    ]


def test_la_serialisation_est_canonique_et_stable() -> None:
    identifiant = new_id()
    a = document(identifiant)
    b = dict(reversed(list(copy.deepcopy(a).items())))
    b["query"] = dict(reversed(list(b["query"].items())))
    b["query"]["filters"][0]["value"] = ["Sud", "Nord"]
    octets = dumps(a)
    assert dumps(b) == octets == dumps(loads(octets))
    texte = octets.decode("utf-8")
    assert texte.startswith(f"api_version: board.analysis/v1\nid: {identifiant}\nname:")
    assert texte.endswith("presentation:\n  chart: bars\n")
    assert re.search(r"\n    scope: null\n", texte)
    assert yaml.safe_load(octets) == validate(a)


def test_un_contenu_different_donne_d_autres_octets() -> None:
    a = document(new_id())
    b = copy.deepcopy(a)
    b["name"] = "Autre"
    assert dumps(a) != dumps(b)


def test_dumps_refuse_un_document_invalide() -> None:
    contenu = document(new_id(), sql="SELECT 1")
    with pytest.raises(ContentError) as erreur:
        dumps(contenu)
    assert erreur.value.code == "invalid_analysis"


def test_un_texte_non_representable_est_refuse(monkeypatch: pytest.MonkeyPatch) -> None:
    reel = analysis_module.loads

    def altere(brut: bytes) -> Any:
        valeur = reel(brut)
        valeur["name"] = "autre"
        return valeur

    monkeypatch.setattr(analysis_module, "loads", altere)
    with pytest.raises(ContentError) as erreur:
        dumps(document(new_id()))
    assert erreur.value.violations == (Violation("", "not_representable"),)


@pytest.mark.parametrize(
    "texte",
    [
        "a\nb",
        "a\n",
        "\na",
        "a\n\n\nb\n\n",
        "  a\n  b",
        "a \nb",
        "tab\tici\nlà",
        "null",
        "true",
        "123",
        "1e3",
        "2026-01-01",
        "~",
        "yes",
        "- a",
        "a: b",
        "# a",
        "'",
        '"',
        "!x",
        "&x",
        "*x",
        "é́",
        "﻿",
        "￾",
        "𝄞",
    ],
)
def test_les_textes_libres_font_l_aller_retour(texte: str) -> None:
    contenu = document(new_id(), description=texte, name=texte.replace("\n", " ") or "x")
    if not re.fullmatch(r"[^\x00-\x1f\x7f-\x9f  ]+", contenu["name"]):
        contenu["name"] = "nom"
    assert loads(dumps(contenu)) == validate(contenu)


@pytest.mark.parametrize("texte", ["\x85", " ", " ", "a\x85b", "\x00", "\r\n", "\x1b"])
def test_les_sauts_de_ligne_exotiques_et_controles_sont_refuses(texte: str) -> None:
    assert refus(document(new_id(), description=texte)) == [("/description", "bad_format")]


@given(st.text(alphabet=st.characters(blacklist_categories=["Cs"])))
def test_propriete_aller_retour_du_texte_libre(texte: str) -> None:
    contenu = document(new_id(), description=texte, name="nom")
    try:
        valide = validate(contenu)
    except ContentError:
        return
    assert loads(dumps(valide)) == valide


# -- diff ----------------------------------------------------------------------------------


def changer(avant: dict[str, Any], **modif: Any) -> dict[str, Any]:
    apres = copy.deepcopy(avant)
    apres.update(modif)
    return apres


def test_un_document_identique_n_a_aucun_ecart() -> None:
    contenu = validate(document(new_id()))
    assert diff(contenu, copy.deepcopy(contenu)) == ()


def test_le_diff_nomme_les_champs_modifies_avec_leur_chemin() -> None:
    avant = validate(document(new_id()))
    apres = copy.deepcopy(avant)
    apres["name"] = "Autre"
    apres["visibility"] = "shared"
    apres["query"]["connection"] = "autre"
    apres["query"]["filters"][0]["value"] = ["Est", "Nord"]
    apres["presentation"]["chart"] = "line"
    assert diff(avant, apres) == (
        Change("/name", "modified", avant["name"], "Autre"),
        Change("/visibility", "modified", "personal", "shared"),
        Change("/query/connection", "modified", "finance", "autre"),
        Change("/query/filters/0/value/0", "modified", "Nord", "Est"),
        Change("/query/filters/0/value/1", "modified", "Sud", "Nord"),
        Change("/presentation/chart", "modified", "bars", "line"),
    )


def test_le_diff_nomme_les_elements_ajoutes_et_retires() -> None:
    avant = validate(document(new_id()))
    apres = copy.deepcopy(avant)
    apres["query"]["metrics"].append("orders")
    apres["query"]["dimensions"] = []
    apres["query"]["filters"] = []
    apres["contextual"].append(
        {"operation": "share", "metric": "revenue", "group_by": [], "denominator": "loaded_result"}
    )
    assert diff(avant, apres) == (
        Change("/query/metrics/1", "added", None, "orders"),
        Change("/query/dimensions/0", "removed", "region", None),
        Change("/query/filters/0", "removed", avant["query"]["filters"][0], None),
        Change("/contextual/1", "added", None, apres["contextual"][1]),
    )


def test_le_diff_suit_le_changement_d_operation() -> None:
    avant = validate(document(new_id()))
    apres = copy.deepcopy(avant)
    apres["contextual"][0] = {
        "operation": "share",
        "metric": "revenue",
        "group_by": ["region"],
        "denominator": "filtered_perimeter",
    }
    assert diff(avant, apres) == (
        Change("/contextual/0/operation", "modified", "aggregate", "share"),
        Change("/contextual/0/scope", "removed", None, None),
        Change("/contextual/0/denominator", "added", None, "filtered_perimeter"),
    )


def test_le_diff_distingue_un_scalaire_d_une_liste_et_un_booleen_d_un_entier() -> None:
    avant = {"v": 1, "w": True, "x": "a", "y": [1]}
    apres = {"v": True, "w": 1, "x": ["a"], "y": {"k": 1}}
    assert diff(avant, apres) == (
        Change("/v", "modified", 1, True),
        Change("/w", "modified", True, 1),
        Change("/x", "modified", "a", ["a"]),
        Change("/y", "modified", [1], {"k": 1}),
    )


def test_le_diff_de_cles_inconnues_est_deterministe() -> None:
    assert diff({"b": 1, "a": 1}, {"a": 2, "c": 3}) == (
        Change("/a", "modified", 1, 2),
        Change("/b", "removed", 1, None),
        Change("/c", "added", None, 3),
    )


# -- schéma --------------------------------------------------------------------------------


@pytest.mark.parametrize("contenu", [None, "{pas du json"])
def test_un_schema_absent_ou_illisible_rend_le_contenu_indisponible(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, contenu: str | None
) -> None:
    chemin = tmp_path / "analysis.v1.json"
    if contenu is not None:
        chemin.write_text(contenu)
    monkeypatch.setattr(analysis_module, "SCHEMA_PATH", chemin)
    analysis_module.schema.cache_clear()
    analysis_module._validator.cache_clear()
    try:
        with pytest.raises(ContentError) as erreur:
            validate(document(new_id()))
        assert (erreur.value.code, erreur.value.reason) == (
            "content_unavailable",
            "schema_unavailable",
        )
        assert erreur.value.violations == ()
        assert str(tmp_path) not in repr(erreur.value)
    finally:
        monkeypatch.undo()
        analysis_module.schema.cache_clear()
        analysis_module._validator.cache_clear()
    assert validate(document(new_id()))["api_version"] == "board.analysis/v1"
