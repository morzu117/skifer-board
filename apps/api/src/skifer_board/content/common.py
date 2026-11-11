"""Briques communes aux formats versionnés `board.analysis/v1` et `board.dashboard/v1`.

Lecture YAML sûre, écriture canonique, contrôle des types JSON, traduction des erreurs du schéma
en violations à chemin, coup d'œil sur l'en-tête et parcours des écarts. Rien ici ne connaît un
genre de contenu : chaque format fournit son schéma, son ordre de lecture et ses règles.
"""

from __future__ import annotations

import math
import re
from collections.abc import Mapping
from dataclasses import dataclass
from functools import cache
from typing import Any, Literal

import yaml
from jsonschema import Draft202012Validator

from .errors import Violation

# Plus grand en-tête canonique que le schéma admet : `api_version` et `id`, un nom de 120
# caractères, une description de 2 000 et deux textes de personne de 512. Un caractère s'écrit en
# 4 octets au plus en UTF-8 brut, ou en échappement `\uXXXX` de 6 octets s'il n'est pas imprimable
# (U+FFFE) : environ 19 Kio mesurés ; même à 10 octets par caractère, 31,6 Kio. Un en-tête réel
# fait moins d'un Kio.
HEADER_MAX = 32 * 1024
HEADER_KEYS = frozenset({"api_version", "id", "name", "description", "visibility", "owner"})

KEYWORD_RULES = {
    "type": "wrong_type",
    "enum": "value_not_allowed",
    "const": "value_not_allowed",
    "pattern": "bad_format",
    "minLength": "out_of_bounds",
    "maxLength": "out_of_bounds",
    "minItems": "out_of_bounds",
    "maxItems": "out_of_bounds",
    "minimum": "out_of_bounds",
    "maximum": "out_of_bounds",
    "uniqueItems": "duplicate_item",
    "not": "field_not_allowed",
}

SAFE_FIELD = re.compile(r"[A-Za-z0-9_]{1,64}")


def field(base: str, name: str) -> str:
    """Un nom de champ inconnu n'est cité que s'il est inoffensif : aucune injection de journal."""
    return f"{base}/{name if SAFE_FIELD.fullmatch(name) else '*'}"


def pointer(path: Any) -> str:
    return "".join(f"/{str(part).replace('~', '~0').replace('/', '~1')}" for part in path)


def plain(data: Any, max_depth: int) -> list[Violation]:
    """Types du JSON seulement, clés textuelles, nombres finis, imbrication bornée."""
    violations: list[Violation] = []
    pending: list[tuple[str, int, Any]] = [("", 0, data)]
    while pending:
        path, depth, value = pending.pop()
        if isinstance(value, dict | list) and depth > max_depth:
            violations.append(Violation(path, "out_of_bounds"))
        elif isinstance(value, dict):
            if any(type(key) is not str for key in value):
                violations.append(Violation(path, "unsupported_value"))
                continue
            pending.extend((field(path, key), depth + 1, item) for key, item in value.items())
        elif type(value) is list:
            pending.extend((f"{path}/{index}", depth + 1, item) for index, item in enumerate(value))
        elif type(value) not in (str, bool, int, float, type(None)) or (
            type(value) is float and not math.isfinite(value)
        ):
            violations.append(Violation(path, "unsupported_value"))
    return violations


def schema_violations(validator: Draft202012Validator, data: Any) -> list[Violation]:
    violations: list[Violation] = []
    for error in validator.iter_errors(data):
        base = pointer(error.absolute_path)
        if error.validator == "additionalProperties":
            known = error.schema.get("properties", {})
            violations.extend(
                Violation(field(base, name), "unknown_field")
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
                Violation(base, KEYWORD_RULES.get(error.validator, "schema_violation"))
            )
    return violations


class Loader(yaml.SafeLoader):  # type: ignore[misc]
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


class Dumper(yaml.SafeDumper):  # type: ignore[misc]
    def ignore_aliases(self, data: Any) -> bool:
        return True

    def increase_indent(self, flow: bool = False, indentless: bool = False) -> Any:
        return super().increase_indent(flow, False)


def _text(dumper: Any, data: str) -> Any:
    """Un texte sur plusieurs lignes en bloc littéral, quand le format YAML le permet."""
    return dumper.represent_scalar(
        "tag:yaml.org,2002:str", data, style="|" if "\n" in data else None
    )


Dumper.add_representer(str, _text)


def ordered(value: Any, rank: Mapping[str, int]) -> Any:
    """Clés dans l'ordre de lecture du format, à tous les niveaux."""
    if isinstance(value, dict):
        return {key: ordered(value[key], rank) for key in sorted(value, key=rank.__getitem__)}
    if isinstance(value, list):
        return [ordered(item, rank) for item in value]
    return value


@cache
def _marker(first: bytes) -> re.Pattern[bytes]:
    return re.compile(rb"^" + re.escape(first), re.MULTILINE)


def header(raw: bytes, first: bytes) -> tuple[str, str, str, str] | None:
    """Émetteur, sujet, visibilité et identifiant de l'en-tête canonique, ou `None` s'il est abîmé.

    `first` est la première clé qui suit l'en-tête dans l'ordre canonique, avec son deux-points
    (`query:`). Seuls les octets qui précèdent la première ligne qui commence en colonne 0 par
    cette clé sont analysés (au plus `HEADER_MAX`) : le travail ne dépend ni du contenu qui suit,
    ni de la taille du document.
    """
    found = _marker(first).search(raw[: HEADER_MAX + len(first)])
    if found is None:
        return None
    try:
        data = yaml.load(raw[: found.start()].decode("utf-8"), Loader=Loader)
    except (UnicodeDecodeError, yaml.YAMLError, RecursionError):
        return None
    if not isinstance(data, dict) or set(data) != HEADER_KEYS:
        return None
    owner = data["owner"]
    if not isinstance(owner, dict) or set(owner) != {"issuer", "subject"}:
        return None
    values = (owner["issuer"], owner["subject"], data["visibility"], data["id"])
    if not all(isinstance(item, str) for item in values) or values[2] not in {"personal", "shared"}:
        return None
    return values


@dataclass(frozen=True)
class Change:
    """Un écart entre deux révisions : chemin JSON, nature, ancienne et nouvelle valeur.

    Le diff des analyses compare position par position et ne remplit que ces quatre champs. Celui
    des dashboards compare des nœuds par identifiant : `node` donne leur type, `id` leur identifiant
    (`None` pour l'en-tête et les défauts), et la nature `moved` signale un déplacement.
    """

    path: str
    kind: Literal["added", "removed", "modified", "moved"]
    before: Any
    after: Any
    node: str | None = None
    id: str | None = None


def walk(path: str, old: Any, new: Any, changes: list[Change], rank: Mapping[str, int]) -> None:
    """Écarts entre deux valeurs JSON : clés dans l'ordre du format, listes par position."""
    if isinstance(old, dict) and isinstance(new, dict):
        for key in sorted(
            old.keys() | new.keys(), key=lambda name: (rank.get(name, len(rank)), name)
        ):
            child = f"{path}/{key}"
            if key not in new:
                changes.append(Change(child, "removed", old[key], None))
            elif key not in old:
                changes.append(Change(child, "added", None, new[key]))
            else:
                walk(child, old[key], new[key], changes, rank)
    elif isinstance(old, list) and isinstance(new, list):
        for index in range(max(len(old), len(new))):
            child = f"{path}/{index}"
            if index >= len(new):
                changes.append(Change(child, "removed", old[index], None))
            elif index >= len(old):
                changes.append(Change(child, "added", None, new[index]))
            else:
                walk(child, old[index], new[index], changes, rank)
    elif old != new or type(old) is not type(new):
        changes.append(Change(path, "modified", old, new))
