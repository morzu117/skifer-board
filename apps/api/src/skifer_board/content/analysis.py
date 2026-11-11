"""Format `board.analysis/v1` : validation, sérialisation canonique et diff (plan 18, A2 et A3).

Le JSON Schema de `contracts/analyses/analysis.v1.json` est la source de vérité. Il est
validé ici avec `jsonschema` ; les règles qu'il n'exprime pas (références entre champs,
valeurs de filtres) sont appliquées ensuite, avec le code de la soumission d'exécution
(`execution.query_validation.filtre`), pour qu'une analyse sauvegardée soit exactement une
requête que l'Explorateur aurait acceptée. Rien ici ne produit ni ne lit de SQL.
"""

from __future__ import annotations

import copy
import json
from functools import cache
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator

from ..execution.query_validation import filtre
from ..spaces.web import Invalid
from .common import (
    HEADER_MAX,
    Change,
    Dumper,
    Loader,
    header,
    ordered,
    plain,
    schema_violations,
    walk,
)
from .errors import CONTENT_UNAVAILABLE, INVALID_ANALYSIS, ContentError, Violation

__all__ = [
    "API_VERSION",
    "HEADER_MAX",
    "MAX_DEPTH",
    "RULES",
    "SCHEMA_PATH",
    "Change",
    "Document",
    "brief",
    "diff",
    "dumps",
    "loads",
    "schema",
    "validate",
]

API_VERSION = "board.analysis/v1"
SCHEMA_PATH = Path(__file__).resolve().parents[5] / "contracts" / "analyses" / "analysis.v1.json"

Document = dict[str, Any]
# Le format n'imbrique jamais au-delà de quatre niveaux : au-delà, on ne regarde plus.
MAX_DEPTH = 8

# Règles fermées des violations : mots-clés du schéma, puis règles du serveur, puis lecture du
# texte YAML et arguments de l'adaptateur.
RULES = frozenset(
    {
        "wrong_type",
        "value_not_allowed",
        "bad_format",
        "out_of_bounds",
        "duplicate_item",
        "unknown_field",
        "missing_field",
        "field_not_allowed",
        "schema_violation",
        "invalid_filter",
        "metric_not_in_query",
        "group_by_not_in_query",
        "reserved_name",
        "unsupported_value",
        "unreadable_document",
        "not_representable",
        "id_mismatch",
        "bad_identifier",
        "bad_revision",
        "bad_actor",
    }
)

# Ordre de lecture des clés du texte canonique : identité d'abord, puis la requête.
_ORDER = (
    "api_version",
    "id",
    "name",
    "description",
    "visibility",
    "owner",
    "issuer",
    "subject",
    "query",
    "connection",
    "model",
    "metrics",
    "dimensions",
    "filters",
    "column",
    "operator",
    "value",
    "contextual",
    "operation",
    "metric",
    "group_by",
    "scope",
    "denominator",
    "presentation",
    "chart",
)
_RANK = {key: position for position, key in enumerate(_ORDER)}


@cache
def schema() -> dict[str, Any]:
    """Schéma lu dans `contracts/analyses/` ; Board se lance depuis son arbre source."""
    try:
        loaded: dict[str, Any] = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise ContentError(CONTENT_UNAVAILABLE, "schema_unavailable") from None
    return loaded


@cache
def _validator() -> Draft202012Validator:
    return Draft202012Validator(schema())


def _refuse(*violations: Violation) -> ContentError:
    return ContentError(
        INVALID_ANALYSIS, violations[0].rule, tuple(sorted(set(violations), key=_key))
    )


def _key(violation: Violation) -> tuple[str, str]:
    return (violation.path, violation.rule)


def _schema_violations(data: Any) -> list[Violation]:
    return schema_violations(_validator(), data)


def _semantic(document: Document) -> tuple[Document, list[Violation]]:
    """Règles inter-champs, avec les filtres sous leur forme canonique de la soumission."""
    violations: list[Violation] = []
    query = document["query"]
    filters: list[dict[str, Any]] = []
    for index, item in enumerate(query["filters"]):
        try:
            filters.append(filtre(item["column"], item["operator"], item["value"]))
        except Invalid:
            violations.append(Violation(f"/query/filters/{index}", "invalid_filter"))
    metrics, dimensions = set(query["metrics"]), set(query["dimensions"])
    for index, operation in enumerate(document["contextual"]):
        base = f"/contextual/{index}"
        share = operation["operation"] == "share"
        if operation["metric"] not in metrics:
            violations.append(Violation(f"{base}/metric", "metric_not_in_query"))
        if share and operation["metric"] == "share":
            violations.append(Violation(f"{base}/metric", "reserved_name"))
        for position, name in enumerate(operation["group_by"]):
            if name not in dimensions:
                violations.append(Violation(f"{base}/group_by/{position}", "group_by_not_in_query"))
            if share and name == "share":
                violations.append(Violation(f"{base}/group_by/{position}", "reserved_name"))
    normalized = {**document, "query": {**query, "filters": filters}}
    return normalized, violations


def validate(data: Any) -> Document:
    """Document validé et normalisé (listes de valeurs triées), ou refus avec ses violations."""
    violations = plain(data, MAX_DEPTH)
    if not violations:
        violations = _schema_violations(data)
    if violations:
        raise _refuse(*violations)
    document, violations = _semantic(copy.deepcopy(data))
    if violations:
        raise _refuse(*violations)
    return document


def loads(raw: bytes) -> Document:
    """Texte YAML (UTF-8) en document validé."""
    try:
        data = yaml.load(raw.decode("utf-8"), Loader=Loader)
    except (UnicodeDecodeError, yaml.YAMLError, RecursionError):
        raise _refuse(Violation("", "unreadable_document")) from None
    return validate(data)


def brief(raw: bytes) -> tuple[str, str, str, str]:
    """Émetteur, sujet, visibilité et identifiant d'un texte YAML canonique, sans en lire la suite.

    C'est tout ce qu'il faut pour savoir qui peut voir une analyse, et seul l'en-tête est analysé :
    l'ordre canonique (`_ORDER`) place `api_version`, `id`, `name`, `description`, `visibility` et
    `owner` avant `query`, donc les octets jusqu'à la première ligne qui commence en colonne 0 par
    `query:`. Un texte multiligne de `description` est écrit en bloc indenté ou entre guillemets
    avec ses retours à la ligne échappés : aucune de ses lignes ne commence en colonne 0. Le
    travail ne dépend donc pas de la requête privée, ni de la taille du document. En-tête plus long
    que `HEADER_MAX`, absence de ligne `query:`, clés autres que celles de l'en-tête ou formes
    inattendues : document abîmé (`unreadable_document`), y compris un document valide mais non
    canonique, écrit hors de Board. Ni schéma, ni règles, ni références.
    """
    found = header(raw, b"query:")
    if found is None:
        raise _refuse(Violation("", "unreadable_document"))
    return found


def dumps(document: Document) -> bytes:
    """Octets canoniques : même contenu validé, mêmes octets, clés dans l'ordre de lecture."""
    valid = validate(document)
    text: str = yaml.dump(
        ordered(valid, _RANK),
        Dumper=Dumper,
        sort_keys=False,
        allow_unicode=True,
        default_flow_style=False,
        width=1_000_000,
        indent=2,
    )
    raw = text.encode("utf-8")
    if loads(raw) != valid:
        raise _refuse(Violation("", "not_representable"))
    return raw


def diff(before: Document, after: Document) -> tuple[Change, ...]:
    """Écarts entre deux documents validés. Les listes se comparent position par position."""
    changes: list[Change] = []
    walk("", before, after, changes, _RANK)
    return tuple(changes)
