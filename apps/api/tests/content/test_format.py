"""Format `board.analysis/v1` : schéma, corpus de fixtures et sentinelles (plan 18, A2)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest
import yaml
from jsonschema import Draft202012Validator
from skifer_board.content import RULES, ContentError, dumps, loads, schema, validate
from skifer_board.execution.model import NAME
from skifer_board.execution.runs_web import IDENTIFIER

from .monde import document, new_id

RACINE = Path(__file__).resolve().parents[4] / "contracts" / "analyses"
FIXTURES = RACINE / "fixtures"
VALIDES = sorted((FIXTURES / "valid").glob("*.yaml"))
INVALIDES = sorted((FIXTURES / "invalid").glob("*.yaml"))
SEMANTIQUES = {"invalid_filter", "metric_not_in_query", "group_by_not_in_query", "reserved_name"}


def brut() -> Draft202012Validator:
    return Draft202012Validator(json.loads((RACINE / "analysis.v1.json").read_text()))


def test_le_schema_est_un_draft_2020_12_valide_et_ferme() -> None:
    contenu = json.loads((RACINE / "analysis.v1.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(contenu)
    assert schema() == contenu
    assert contenu["$schema"] == "https://json-schema.org/draft/2020-12/schema"

    def objets(noeud: Any) -> list[dict[str, Any]]:
        if isinstance(noeud, dict):
            trouves = [noeud] if noeud.get("type") == "object" else []
            return trouves + [x for valeur in noeud.values() for x in objets(valeur)]
        if isinstance(noeud, list):
            return [x for valeur in noeud for x in objets(valeur)]
        return []

    trouves = objets(contenu)
    assert len(trouves) == 6
    assert all(objet["additionalProperties"] is False for objet in trouves)


def test_aucun_champ_du_schema_ne_porte_du_sql_une_table_une_donnee_ou_un_secret() -> None:
    def noms(noeud: Any) -> set[str]:
        if isinstance(noeud, dict):
            propres = set(noeud.get("properties", {}))
            return propres | {n for valeur in noeud.values() for n in noms(valeur)}
        if isinstance(noeud, list):
            return {n for valeur in noeud for n in noms(valeur)}
        return set()

    interdits = re.compile(r"sql|statement|table|from|rows|data|secret|token|password|select|limit")
    assert not [nom for nom in noms(schema()) if interdits.search(nom)]


def test_les_motifs_du_schema_suivent_ceux_de_la_soumission() -> None:
    definitions = schema()["$defs"]
    assert definitions["identifier"]["pattern"] == f"^{IDENTIFIER.pattern}$(?!\\n)"
    assert definitions["connection_name"]["pattern"] == f"^{NAME.pattern}$(?!\\n)"


def test_le_corpus_est_complet() -> None:
    assert len(VALIDES) == 3
    assert len(INVALIDES) >= 40
    assert all(p.with_suffix(".expected.json").exists() for p in INVALIDES)
    assert len(list((FIXTURES / "invalid").glob("*.expected.json"))) == len(INVALIDES)


@pytest.mark.parametrize("chemin", VALIDES, ids=lambda p: p.stem)
def test_une_fixture_valide_passe_le_schema_et_est_canonique(chemin: Path) -> None:
    donnees = yaml.safe_load(chemin.read_text(encoding="utf-8"))
    assert list(brut().iter_errors(donnees)) == []
    assert validate(donnees) == donnees
    assert dumps(loads(chemin.read_bytes())) == chemin.read_bytes()


def test_un_contenu_equivalent_donne_les_memes_octets() -> None:
    autre = (FIXTURES / "equivalent" / "minimal-reordered.yaml").read_bytes()
    assert dumps(loads(autre)) == (FIXTURES / "valid" / "minimal.yaml").read_bytes()


@pytest.mark.parametrize("chemin", INVALIDES, ids=lambda p: p.stem)
def test_une_fixture_invalide_est_refusee_avec_son_code(chemin: Path) -> None:
    attendu = json.loads(chemin.with_suffix(".expected.json").read_text(encoding="utf-8"))
    with pytest.raises(ContentError) as refus:
        loads(chemin.read_bytes())
    assert refus.value.code == attendu["code"] == "invalid_analysis"
    violations = [{"path": v.path, "rule": v.rule} for v in refus.value.violations]
    assert violations == attendu["violations"]
    assert {v["rule"] for v in violations} <= RULES
    assert all(v["path"] == "" or v["path"].startswith("/") for v in violations)
    donnees = yaml.safe_load(chemin.read_text(encoding="utf-8"))
    erreurs_du_schema = list(brut().iter_errors(donnees))
    if attendu["layer"] == "semantic":
        assert {v["rule"] for v in violations} <= SEMANTIQUES
        assert erreurs_du_schema == []
    else:
        assert attendu["layer"] == "structural"
        assert erreurs_du_schema != []


CHAMPS_INTERDITS = [
    "sql",
    "query_sql",
    "statement",
    "table",
    "tables",
    "from",
    "rows",
    "data",
    "secret",
    "token",
    "password",
    "environment",
    "selection",
    "limit",
    "order_by",
    "option",
]
OBJETS = [
    ("", lambda d: d),
    ("/query", lambda d: d["query"]),
    ("/owner", lambda d: d["owner"]),
    ("/presentation", lambda d: d["presentation"]),
    ("/query/filters/0", lambda d: d["query"]["filters"][0]),
    ("/contextual/0", lambda d: d["contextual"][0]),
]


@pytest.mark.parametrize("champ", CHAMPS_INTERDITS)
@pytest.mark.parametrize(("chemin", "objet"), OBJETS, ids=[o[0] or "racine" for o in OBJETS])
def test_sentinelle_aucun_champ_sql_ni_donnee_n_est_accepte(
    champ: str, chemin: str, objet: Any
) -> None:
    contenu = document(new_id())
    objet(contenu)[champ] = "SELECT * FROM ventes"
    with pytest.raises(ContentError) as refus:
        validate(contenu)
    assert [(v.path, v.rule) for v in refus.value.violations] == [
        (f"{chemin}/{champ}", "unknown_field")
    ]


@pytest.mark.parametrize(
    ("valeur", "chemin", "regle"),
    [
        ("x'; DROP TABLE ventes; --", "/query/filters/0", "invalid_filter"),
        ("1 OR 1=1=", "/query/filters/0", "invalid_filter"),
        ("a\\b", "/query/filters/0", "invalid_filter"),
        ("SELECT\n1", "/query/filters/0", "invalid_filter"),
        ("Île-de-France", "/query/filters/0", "invalid_filter"),
        ("e\u0301", "/query/filters/0", "invalid_filter"),
        ("x" * 1025, "/query/filters/0/value", "out_of_bounds"),
    ],
)
def test_sentinelle_un_texte_de_filtre_n_est_jamais_du_sql(
    valeur: str, chemin: str, regle: str
) -> None:
    contenu = document(new_id())
    contenu["query"]["filters"] = [{"column": "region", "operator": "eq", "value": valeur}]
    with pytest.raises(ContentError) as refus:
        validate(contenu)
    assert [(v.path, v.rule) for v in refus.value.violations] == [(chemin, regle)]


@pytest.mark.parametrize("ident", ["x\n", "5f1d7c52-3b0e-4d36-9a54-0c7a3e1b9d20\n"])
def test_une_fin_de_ligne_n_est_pas_une_fin_de_motif(ident: str) -> None:
    contenu = document("5f1d7c52-3b0e-4d36-9a54-0c7a3e1b9d20")
    contenu["id"] = ident
    contenu["query"]["model"] = ident
    contenu["name"] = "nom\n"
    contenu["owner"]["issuer"] = "x\n"
    contenu["query"]["connection"] = "finance\n"
    with pytest.raises(ContentError) as refus:
        validate(contenu)
    assert {(v.path, v.rule) for v in refus.value.violations} == {
        ("/id", "bad_format"),
        ("/name", "bad_format"),
        ("/owner/issuer", "bad_format"),
        ("/query/connection", "bad_format"),
        ("/query/model", "bad_format"),
    }
