"""Format `board.dashboard/v1` : validation, sérialisation canonique et diff (plan 19, B2 à B9).

Le JSON Schema de `contracts/dashboards/dashboard.v1.json` est la source de vérité. Il est validé
ici avec `jsonschema` ; les règles qu'il n'exprime pas (identifiants uniques, somme des largeurs,
profondeur, cibles des filtres, bornes globales, valeurs des filtres) sont appliquées ensuite,
avec des violations à chemin d'un ensemble fermé (`RULES`). Les valeurs de filtres passent par le
code de la soumission d'exécution (`execution.query_validation.filtre`), comme pour une analyse.
Rien ici ne produit ni ne lit de SQL, et rien ne consulte une analyse ni le catalogue : les
références, la visibilité et les dimensions sont contrôlées par les routes (19.2).
"""

from __future__ import annotations

import copy
import json
from collections.abc import Iterator
from dataclasses import dataclass, field, replace
from functools import cache
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator

from ..execution.query_validation import filtre
from ..spaces.web import Invalid
from .analysis import RULES as ANALYSIS_RULES
from .common import (
    Change,
    Dumper,
    Loader,
    header,
    ordered,
    plain,
    schema_violations,
    walk,
)
from .errors import CONTENT_UNAVAILABLE, INVALID_DASHBOARD, ContentError, Violation

API_VERSION = "board.dashboard/v1"
SCHEMA_PATH = Path(__file__).resolve().parents[5] / "contracts" / "dashboards" / "dashboard.v1.json"

Document = dict[str, Any]

# Imbrication JSON admise avant toute analyse : trois niveaux de rangées en comptent environ 30 ;
# au-delà, on ne regarde plus (la règle `too_deep` voit les conteneurs du quatrième niveau).
MAX_DEPTH = 48
# Niveaux de rangées : la section porte le premier, un conteneur de colonne le deuxième, un
# conteneur de ce conteneur le troisième. Un conteneur du troisième niveau est refusé.
LEVELS = 3
GRID = 12
MAX_EXECUTABLE = 40
MAX_COMPONENTS = 64
# Sections, rangées, colonnes, conteneurs et composants ensemble : large pour une mise en page
# réelle (environ 300 au plafond des composants), assez bas pour borner le travail des éditeurs.
MAX_NODES = 600
MAX_TEXT = 5000
EXECUTABLE = frozenset({"analysis", "kpi"})

RULES = ANALYSIS_RULES | frozenset(
    {
        "duplicate_id",
        "row_overflow",
        "too_deep",
        "container_not_alone",
        "filter_without_target",
        "unknown_target",
        "target_not_executable",
        "default_not_allowed",
    }
)

# Ordre de lecture des clés du texte canonique : identité d'abord, puis défauts, filtres et
# mise en page. Un même nom a le même rang partout ; chaque objet du format est lisible de haut
# en bas dans cet ordre (`id`, `type`, puis le reste).
_ORDER = (
    "api_version",
    "id",
    "name",
    "description",
    "visibility",
    "owner",
    "issuer",
    "subject",
    "defaults",
    "filters",
    "layout",
    "sections",
    "type",
    "chart",
    "title",
    "legend",
    "number_format",
    "threshold",
    "tooltip",
    "value",
    "label",
    "dimension",
    "operator",
    "default",
    "allowed",
    "targets",
    "rows",
    "columns",
    "span",
    "children",
    "reference",
    "analysis_id",
    "revision",
    "presentation",
    "blocks",
    "level",
    "ordered",
    "content",
    "items",
    "text",
    "emphasis",
    "strong",
)
_RANK = {key: position for position, key in enumerate(_ORDER)}


@cache
def schema() -> dict[str, Any]:
    """Schéma lu dans `contracts/dashboards/` ; Board se lance depuis son arbre source."""
    try:
        loaded: dict[str, Any] = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise ContentError(CONTENT_UNAVAILABLE, "schema_unavailable") from None
    return loaded


@cache
def _validator() -> Draft202012Validator:
    return Draft202012Validator(schema())


def _refuse(*violations: Violation) -> ContentError:
    """Refus à violations triées ; la raison est celle de la première, donc déterministe."""
    found = tuple(sorted(set(violations), key=lambda item: (item.path, item.rule)))
    return ContentError(INVALID_DASHBOARD, found[0].rule, found)


def _schema_violations(data: Any) -> list[Violation]:
    return schema_violations(_validator(), data)


@dataclass
class _Scan:
    """Ce que le parcours de la mise en page apprend : identifiants, types, comptes, violations."""

    violations: list[Violation] = field(default_factory=list)
    kinds: dict[str, str] = field(default_factory=dict)
    nodes: int = 0
    components: int = 0
    executable: int = 0

    def claim(self, ident: str, kind: str, path: str) -> None:
        """Un identifiant sert une seule fois dans tout le document."""
        if ident in self.kinds:
            self.violations.append(Violation(path, "duplicate_id"))
        else:
            self.kinds[ident] = kind

    def node(self, path: str) -> None:
        self.nodes += 1
        if self.nodes == MAX_NODES + 1:
            self.violations.append(Violation(path, "out_of_bounds"))


def _text_length(component: dict[str, Any]) -> int:
    total = 0
    for block in component["blocks"]:
        for segments in block["items"] if block["type"] == "list" else [block["content"]]:
            total += sum(len(segment["text"]) for segment in segments)
    return total


def _integer(scan: _Scan, value: Any, path: str) -> None:
    """Le schéma admet `2.0` pour un entier ; le format veut un entier, sans équivoque."""
    if type(value) is not int:
        scan.violations.append(Violation(path, "wrong_type"))


def _component(scan: _Scan, component: dict[str, Any], path: str) -> None:
    kind = component["type"]
    scan.claim(component["id"], kind, f"{path}/id")
    scan.node(path)
    scan.components += 1
    if scan.components == MAX_COMPONENTS + 1:
        scan.violations.append(Violation(path, "out_of_bounds"))
    if kind in EXECUTABLE:
        scan.executable += 1
        if scan.executable == MAX_EXECUTABLE + 1:
            scan.violations.append(Violation(path, "out_of_bounds"))
        _integer(scan, component["reference"]["revision"], f"{path}/reference/revision")
    elif kind == "text":
        if _text_length(component) > MAX_TEXT:
            scan.violations.append(Violation(f"{path}/blocks", "out_of_bounds"))
        for index, block in enumerate(component["blocks"]):
            if block["type"] == "heading":
                _integer(scan, block["level"], f"{path}/blocks/{index}/level")


def _children(scan: _Scan, children: list[dict[str, Any]], base: str, level: int) -> None:
    if len(children) > 1 and any(child["type"] == "container" for child in children):
        scan.violations.append(Violation(base, "container_not_alone"))
    for index, child in enumerate(children):
        path = f"{base}/{index}"
        if child["type"] != "container":
            _component(scan, child, path)
            continue
        scan.claim(child["id"], "container", f"{path}/id")
        scan.node(path)
        if level >= LEVELS:
            scan.violations.append(Violation(path, "too_deep"))
        else:
            _rows(scan, child["rows"], f"{path}/rows", level + 1)


def _rows(scan: _Scan, rows: list[dict[str, Any]], base: str, level: int) -> None:
    for index, row in enumerate(rows):
        path = f"{base}/{index}"
        scan.claim(row["id"], "row", f"{path}/id")
        scan.node(path)
        total = 0
        for position, column in enumerate(row["columns"]):
            where = f"{path}/columns/{position}"
            scan.claim(column["id"], "column", f"{where}/id")
            scan.node(where)
            _integer(scan, column["span"], f"{where}/span")
            total += column["span"]
            _children(scan, column["children"], f"{where}/children", level)
        if total > GRID:
            scan.violations.append(Violation(path, "row_overflow"))


def _kind(value: Any) -> str:
    """Famille d'une valeur de filtre : les nombres se comparent entre eux, le reste par type."""
    return "number" if type(value) in (int, float) else type(value).__name__


def _filter(scan: _Scan, item: dict[str, Any], path: str) -> dict[str, Any]:
    """Un filtre commun : identifiant, cibles, valeur par défaut et valeurs autorisées."""
    scan.claim(item["id"], "filter", f"{path}/id")
    normalized = dict(item)
    if not item["targets"]:
        scan.violations.append(Violation(f"{path}/targets", "filter_without_target"))
    for index, target in enumerate(item["targets"]):
        known = scan.kinds.get(target)
        where = f"{path}/targets/{index}"
        if known is None:
            scan.violations.append(Violation(where, "unknown_target"))
        elif known not in EXECUTABLE:
            scan.violations.append(Violation(where, "target_not_executable"))
    default = allowed = None
    if "default" in item:
        try:
            default = filtre(item["dimension"], item["operator"], item["default"])["value"]
        except Invalid:
            scan.violations.append(Violation(f"{path}/default", "invalid_filter"))
        else:
            normalized["default"] = default
            if item["operator"] == "between" and (
                _kind(default[0]) != _kind(default[1])
                or (_kind(default[0]) == "number" and default[0] > default[1])
            ):
                scan.violations.append(Violation(f"{path}/default", "invalid_filter"))
    if "allowed" in item:
        try:
            allowed = filtre(item["dimension"], "in", item["allowed"])["value"]
        except Invalid:
            scan.violations.append(Violation(f"{path}/allowed", "invalid_filter"))
        else:
            normalized["allowed"] = allowed
    if default is not None and allowed is not None:
        wanted = default if isinstance(default, list) else [default]
        permitted = {(type(value), value) for value in allowed}
        if any((type(value), value) not in permitted for value in wanted):
            scan.violations.append(Violation(f"{path}/default", "default_not_allowed"))
    return normalized


def _semantic(document: Document) -> tuple[Document, list[Violation]]:
    """Règles inter-champs, avec les valeurs de filtres sous leur forme canonique."""
    scan = _Scan()
    for index, section in enumerate(document["layout"]["sections"]):
        path = f"/layout/sections/{index}"
        scan.claim(section["id"], "section", f"{path}/id")
        scan.node(path)
        _rows(scan, section["rows"], f"{path}/rows", 1)
    # Les filtres se jugent après la mise en page : leurs cibles y sont déjà connues.
    filters = [
        _filter(scan, item, f"/filters/{index}") for index, item in enumerate(document["filters"])
    ]
    return {**document, "filters": filters}, scan.violations


def validate(data: Any) -> Document:
    """Document validé et normalisé (valeurs de filtres canoniques), ou refus avec violations."""
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

    Même garantie que `analysis.brief` : seul l'en-tête est analysé. L'ordre canonique (`_ORDER`)
    place `api_version`, `id`, `name`, `description`, `visibility` et `owner` avant `defaults`,
    donc les octets jusqu'à la première ligne qui commence en colonne 0 par `defaults:`. Le travail
    ne dépend ni de la mise en page, ni de la taille du document. En-tête plus long que
    `HEADER_MAX`, absence de ligne `defaults:`, clés autres que celles de l'en-tête ou formes
    inattendues : document abîmé (`unreadable_document`). Ni schéma, ni règles.
    """
    found = header(raw, b"defaults:")
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


# -- composants exécutables ---------------------------------------------------------------------


@dataclass(frozen=True)
class Component:
    """Un composant exécutable (visuel ou KPI) : où il est, quelle révision d'analyse il épingle,
    et le type de graphique qu'il surcharge (`None` pour un KPI ou sans surcharge)."""

    id: str
    type: str
    path: str
    analysis_id: str
    revision: int
    chart: str | None


def _components(children: list[dict[str, Any]], base: str) -> Iterator[Component]:
    for index, child in enumerate(children):
        path = f"{base}/{index}"
        if child["type"] == "container":
            for position, row in enumerate(child["rows"]):
                yield from _row_components(row, f"{path}/rows/{position}")
        elif child["type"] in EXECUTABLE:
            reference = child["reference"]
            yield Component(
                child["id"],
                child["type"],
                path,
                reference["analysis_id"],
                reference["revision"],
                child["presentation"].get("chart"),
            )


def _row_components(row: dict[str, Any], path: str) -> Iterator[Component]:
    for position, column in enumerate(row["columns"]):
        yield from _components(column["children"], f"{path}/columns/{position}/children")


def executables(document: Document) -> tuple[Component, ...]:
    """Composants exécutables d'un document validé, dans l'ordre du document."""
    found: list[Component] = []
    for index, section in enumerate(document["layout"]["sections"]):
        for position, row in enumerate(section["rows"]):
            found.extend(_row_components(row, f"/layout/sections/{index}/rows/{position}"))
    return tuple(found)


# -- diff structurel ----------------------------------------------------------------------------

_HEADER_FIELDS = ("name", "description", "visibility", "owner")
_CHILD_KEYS = frozenset({"id", "sections", "rows", "columns", "children"})
# Parents des nœuds de premier niveau : sections sous la mise en page, filtres sous leur liste.
LAYOUT = "layout"
FILTERS = "filters"


@dataclass(frozen=True)
class _Node:
    kind: str
    path: str
    parent: str
    index: int
    own: dict[str, Any]


def _put(
    found: dict[str, _Node], item: dict[str, Any], kind: str, path: str, parent: str, index: int
) -> None:
    own = {key: value for key, value in item.items() if key not in _CHILD_KEYS}
    found[item["id"]] = _Node(kind, path, parent, index, own)


def _flatten_rows(
    found: dict[str, _Node], rows: list[dict[str, Any]], base: str, owner: str
) -> None:
    for index, row in enumerate(rows):
        path = f"{base}/{index}"
        _put(found, row, "row", path, owner, index)
        for position, column in enumerate(row["columns"]):
            where = f"{path}/columns/{position}"
            _put(found, column, "column", where, row["id"], position)
            for rank, child in enumerate(column["children"]):
                at = f"{where}/children/{rank}"
                _put(found, child, child["type"], at, column["id"], rank)
                if child["type"] == "container":
                    _flatten_rows(found, child["rows"], f"{at}/rows", child["id"])


def _flatten(document: Document) -> dict[str, _Node]:
    """Chaque nœud à identifiant, dans l'ordre du document : mise en page d'abord, puis filtres."""
    found: dict[str, _Node] = {}
    for index, section in enumerate(document["layout"]["sections"]):
        path = f"/layout/sections/{index}"
        _put(found, section, "section", path, LAYOUT, index)
        _flatten_rows(found, section["rows"], f"{path}/rows", section["id"])
    for index, item in enumerate(document["filters"]):
        _put(found, item, "filter", f"/filters/{index}", FILTERS, index)
    return found


def _stable(positions: list[int]) -> set[int]:
    """Indices d'une plus longue suite croissante : ce qui n'a pas bougé entre frères."""
    runs: list[list[int]] = []
    for index, position in enumerate(positions):
        best: list[int] = []
        for run in runs:
            if positions[run[-1]] < position and len(run) > len(best):
                best = run
        runs.append([*best, index])
    longest: list[int] = []
    for run in runs:
        if len(run) > len(longest):
            longest = run
    return set(longest)


def _moved(before: dict[str, _Node], after: dict[str, _Node]) -> set[str]:
    """Nœuds présents des deux côtés qui ont changé de parent ou d'ordre parmi leurs frères.

    Insérer ou retirer un frère décale les index sans rien déplacer : seuls les nœuds hors de la
    plus longue suite de frères restés dans le même ordre sont dits déplacés.
    """
    moved: set[str] = set()
    siblings: dict[str, list[str]] = {}
    for ident, node in after.items():
        old = before.get(ident)
        if old is None or old.kind != node.kind:
            continue
        if old.parent != node.parent:
            moved.add(ident)
        else:
            siblings.setdefault(node.parent, []).append(ident)
    for idents in siblings.values():
        kept = _stable([before[ident].index for ident in idents])
        moved.update(ident for position, ident in enumerate(idents) if position not in kept)
    return moved


def _same(old: Any, new: Any) -> bool:
    """Égalité qui distingue `true`, `1` et `1.0`, comme les octets canoniques."""
    return json.dumps(old, sort_keys=True) == json.dumps(new, sort_keys=True)


def _head(document: Document) -> dict[str, Any]:
    return {key: document[key] for key in _HEADER_FIELDS}


def _place(node: _Node) -> dict[str, Any]:
    return {"parent": node.parent, "index": node.index}


def diff(before: Document, after: Document) -> tuple[Change, ...]:
    """Écarts structurels entre deux documents validés, nœud par nœud.

    Les nœuds ont un identifiant stable d'une révision à l'autre : ils se comparent par
    identifiant, non par position, si bien qu'insérer une section ne décale rien dans le rapport.
    L'en-tête (`name`, `description`, `visibility`, `owner`) et les défauts se comparent champ par
    champ, comme les analyses (`node` vaut `dashboard` ou `defaults`, `id` est `None`). Pour les
    autres nœuds, `node` donne le type (`section`, `row`, `column`, `container`, `filter`,
    `analysis`, `kpi`, `text`, `separator`) et `id` l'identifiant :

    - `added` : le nœud n'existe que dans `after`, `after` porte ses champs propres (sans ses
      enfants, qui ont leurs propres entrées) et `path` est son chemin dans `after` ;
    - `removed` : le nœud n'existe que dans `before`, `before` porte ses champs propres et `path`
      est son chemin dans `before` ;
    - `modified` : `before` et `after` ne portent que les champs propres qui diffèrent (un champ
      absent d'un côté est absent du dictionnaire) ; `path` est le chemin dans `after` ;
    - `moved` : le nœud a changé de parent ou d'ordre parmi ses frères ; `before` et `after` valent
      `{"parent": <identifiant du parent, ou "layout", ou "filters">, "index": <rang>}` ; `path`
      est le chemin dans `after`. Un nœud déplacé et modifié donne les deux entrées.

    Un identifiant qui change de nature (une rangée devenue composant) est un retrait et un ajout.
    Ordre du rapport : en-tête, défauts, puis les nœuds de `after` dans l'ordre du document, puis
    les retraits dans l'ordre de `before`.
    """
    changes: list[Change] = []
    for label, old_part, new_part, base in (
        ("dashboard", _head(before), _head(after), ""),
        ("defaults", before["defaults"], after["defaults"], "/defaults"),
    ):
        found: list[Change] = []
        walk(base, old_part, new_part, found, _RANK)
        changes.extend(replace(item, node=label) for item in found)
    previous, current = _flatten(before), _flatten(after)
    moved = _moved(previous, current)
    for ident, node in current.items():
        old = previous.get(ident)
        if old is None or old.kind != node.kind:
            changes.append(Change(node.path, "added", None, node.own, node.kind, ident))
            continue
        if ident in moved:
            changes.append(Change(node.path, "moved", _place(old), _place(node), node.kind, ident))
        keys = sorted(old.own.keys() | node.own.keys(), key=lambda name: (_RANK[name], name))
        differing = [
            key
            for key in keys
            if not (key in old.own and key in node.own and _same(old.own[key], node.own[key]))
        ]
        if differing:
            changes.append(
                Change(
                    node.path,
                    "modified",
                    {key: old.own[key] for key in differing if key in old.own},
                    {key: node.own[key] for key in differing if key in node.own},
                    node.kind,
                    ident,
                )
            )
    for ident, old in previous.items():
        kept = current.get(ident)
        if kept is None or kept.kind != old.kind:
            changes.append(Change(old.path, "removed", old.own, None, old.kind, ident))
    return tuple(changes)
