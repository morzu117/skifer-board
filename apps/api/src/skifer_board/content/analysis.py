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
import math
import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any, Literal

import yaml
from jsonschema import Draft202012Validator

from ..execution.query_validation import filtre
from ..spaces.web import Invalid
from .errors import CONTENT_UNAVAILABLE, INVALID_ANALYSIS, ContentError, Violation

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

_KEYWORD_RULES = {
    "type": "wrong_type",
    "enum": "value_not_allowed",
    "const": "value_not_allowed",
    "pattern": "bad_format",
    "minLength": "out_of_bounds",
    "maxLength": "out_of_bounds",
    "minItems": "out_of_bounds",
    "maxItems": "out_of_bounds",
    "uniqueItems": "duplicate_item",
    "not": "field_not_allowed",
}

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
_SAFE_FIELD = re.compile(r"[A-Za-z0-9_]{1,64}")


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


def _field(base: str, name: str) -> str:
    """Un nom de champ inconnu n'est cité que s'il est inoffensif : aucune injection de journal."""
    return f"{base}/{name if _SAFE_FIELD.fullmatch(name) else '*'}"


def _pointer(path: Any) -> str:
    return "".join(f"/{str(part).replace('~', '~0').replace('/', '~1')}" for part in path)


def _plain(data: Any) -> list[Violation]:
    """Types du JSON seulement, clés textuelles, nombres finis, imbrication bornée."""
    violations: list[Violation] = []
    pending: list[tuple[str, int, Any]] = [("", 0, data)]
    while pending:
        path, depth, value = pending.pop()
        if isinstance(value, dict | list) and depth > MAX_DEPTH:
            violations.append(Violation(path, "out_of_bounds"))
        elif isinstance(value, dict):
            if any(type(key) is not str for key in value):
                violations.append(Violation(path, "unsupported_value"))
                continue
            pending.extend((_field(path, key), depth + 1, item) for key, item in value.items())
        elif type(value) is list:
            pending.extend((f"{path}/{index}", depth + 1, item) for index, item in enumerate(value))
        elif type(value) not in (str, bool, int, float, type(None)) or (
            type(value) is float and not math.isfinite(value)
        ):
            violations.append(Violation(path, "unsupported_value"))
    return violations


def _schema_violations(data: Any) -> list[Violation]:
    violations: list[Violation] = []
    for error in _validator().iter_errors(data):
        base = _pointer(error.absolute_path)
        if error.validator == "additionalProperties":
            known = error.schema.get("properties", {})
            violations.extend(
                Violation(_field(base, name), "unknown_field")
                for name in error.instance
                if name not in known
            )
        elif error.validator == "required":
            violations.extend(
                Violation(f"{base}/{name}", "missing_field")
                for name in error.validator_value
                if name not in error.instance
            )
        else:
            violations.append(
                Violation(base, _KEYWORD_RULES.get(error.validator, "schema_violation"))
            )
    return violations


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
    violations = _plain(data)
    if not violations:
        violations = _schema_violations(data)
    if violations:
        raise _refuse(*violations)
    document, violations = _semantic(copy.deepcopy(data))
    if violations:
        raise _refuse(*violations)
    return document


class _Loader(yaml.SafeLoader):  # type: ignore[misc]
    """YAML sans alias ni clé en double : un texte, un seul sens."""

    def compose_node(self, parent: Any, index: Any) -> Any:
        if self.check_event(yaml.AliasEvent):
            raise yaml.constructor.ConstructorError(
                None, None, "alias refusé", self.peek_event().start_mark
            )
        return super().compose_node(parent, index)

    def construct_mapping(self, node: Any, deep: bool = False) -> Any:
        mapping = super().construct_mapping(node, deep)
        if len(mapping) != len(node.value):
            raise yaml.constructor.ConstructorError(None, None, "clé en double", node.start_mark)
        return mapping


class _Dumper(yaml.SafeDumper):  # type: ignore[misc]
    def ignore_aliases(self, data: Any) -> bool:
        return True

    def increase_indent(self, flow: bool = False, indentless: bool = False) -> Any:
        return super().increase_indent(flow, False)


def _text(dumper: Any, data: str) -> Any:
    """Un texte sur plusieurs lignes en bloc littéral, quand le format YAML le permet."""
    return dumper.represent_scalar(
        "tag:yaml.org,2002:str", data, style="|" if "\n" in data else None
    )


_Dumper.add_representer(str, _text)


def loads(raw: bytes) -> Document:
    """Texte YAML (UTF-8) en document validé."""
    try:
        data = yaml.load(raw.decode("utf-8"), Loader=_Loader)
    except (UnicodeDecodeError, yaml.YAMLError, RecursionError):
        raise _refuse(Violation("", "unreadable_document")) from None
    return validate(data)


# Plus grand en-tête canonique que le schéma admet : `api_version` et `id`, un nom de 120
# caractères, une description de 2 000 et deux textes de personne de 512. Un caractère s'écrit en
# 4 octets au plus en UTF-8 brut, ou en échappement `\uXXXX` de 6 octets s'il n'est pas imprimable
# (U+FFFE) : environ 19 Kio mesurés ; même à 10 octets par caractère, 31,6 Kio. Un en-tête réel
# fait moins d'un Kio.
HEADER_MAX = 32 * 1024
_HEADER_KEYS = {"api_version", "id", "name", "description", "visibility", "owner"}
_QUERY_LINE = re.compile(rb"^query:", re.MULTILINE)


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
    found = _QUERY_LINE.search(raw[: HEADER_MAX + len(b"query:")])
    if found is None:
        raise _refuse(Violation("", "unreadable_document"))
    try:
        data = yaml.load(raw[: found.start()].decode("utf-8"), Loader=_Loader)
    except (UnicodeDecodeError, yaml.YAMLError, RecursionError):
        raise _refuse(Violation("", "unreadable_document")) from None
    if not isinstance(data, dict) or set(data) != _HEADER_KEYS:
        raise _refuse(Violation("", "unreadable_document"))
    owner = data["owner"]
    if not isinstance(owner, dict) or set(owner) != {"issuer", "subject"}:
        raise _refuse(Violation("", "unreadable_document"))
    values = (owner["issuer"], owner["subject"], data["visibility"], data["id"])
    if not all(isinstance(item, str) for item in values) or values[2] not in {"personal", "shared"}:
        raise _refuse(Violation("", "unreadable_document"))
    return values


def _ordered(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _ordered(value[key]) for key in sorted(value, key=_RANK.__getitem__)}
    if isinstance(value, list):
        return [_ordered(item) for item in value]
    return value


def dumps(document: Document) -> bytes:
    """Octets canoniques : même contenu validé, mêmes octets, clés dans l'ordre de lecture."""
    valid = validate(document)
    text: str = yaml.dump(
        _ordered(valid),
        Dumper=_Dumper,
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


@dataclass(frozen=True)
class Change:
    """Un écart entre deux révisions : chemin JSON, nature, ancienne et nouvelle valeur."""

    path: str
    kind: Literal["added", "removed", "modified"]
    before: Any
    after: Any


def diff(before: Document, after: Document) -> tuple[Change, ...]:
    """Écarts entre deux documents validés. Les listes se comparent position par position."""
    changes: list[Change] = []
    _walk("", before, after, changes)
    return tuple(changes)


def _walk(path: str, old: Any, new: Any, changes: list[Change]) -> None:
    if isinstance(old, dict) and isinstance(new, dict):
        for key in sorted(
            old.keys() | new.keys(), key=lambda name: (_RANK.get(name, len(_RANK)), name)
        ):
            child = f"{path}/{key}"
            if key not in new:
                changes.append(Change(child, "removed", old[key], None))
            elif key not in old:
                changes.append(Change(child, "added", None, new[key]))
            else:
                _walk(child, old[key], new[key], changes)
    elif isinstance(old, list) and isinstance(new, list):
        for index in range(max(len(old), len(new))):
            child = f"{path}/{index}"
            if index >= len(new):
                changes.append(Change(child, "removed", old[index], None))
            elif index >= len(old):
                changes.append(Change(child, "added", None, new[index]))
            else:
                _walk(child, old[index], new[index], changes)
    elif old != new or type(old) is not type(new):
        changes.append(Change(path, "modified", old, new))
