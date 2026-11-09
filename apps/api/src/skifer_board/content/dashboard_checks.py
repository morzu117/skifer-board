"""Contrôles d'un dashboard qui demandent les analyses épinglées et le catalogue (plan 19, B4, B7).

Module pur : il reçoit les analyses déjà lues (une par composant exécutable, ou `None`) et le
catalogue, et ne lit rien. Il sert deux fois.

- À la sauvegarde (`save_violations`, `personal_components`), pour l'auteur : chaque violation
  désigne un chemin du document et une règle d'un ensemble fermé (`CHECK_RULES`), jamais une
  valeur. Une analyse illisible pour l'auteur, supprimée ou inexistante donne une seule règle,
  `analysis_unavailable`, qui ne dit pas laquelle des trois.
- À la lecture (`tiles`), pour la personne qui lit : l'état de chaque composant exécutable,
  `ready` ou `unavailable` avec une raison fermée, sans rien du contenu de l'analyse. L'analyse
  d'un composant est celle que la personne peut lire ; sinon, elle n'existe pas pour elle.

Rien ici ne produit ni ne lit de SQL : les filtres sont jugés par le code de la soumission
d'exécution (`execution.query_validation`).
"""

from __future__ import annotations

from collections.abc import Collection, Iterator, Mapping
from dataclasses import dataclass
from typing import Any

from ..execution.query_validation import OPERATEURS, valider
from ..execution.semantic import SemanticRequest
from ..spaces.web import Invalid
from .dashboard import Component, Document, executables
from .errors import Violation
from .references import model_of, reference_violations

# Filtres d'une tuile : ceux de son analyse plus les filtres communs qui la ciblent.
MAX_TILE_FILTERS = 32

CHECK_RULES = frozenset(
    {
        "analysis_unavailable",
        "kpi_requires_value",
        "chart_incompatible",
        "dimension_not_exposed",
        "filter_type_mismatch",
        "operator_not_allowed",
        "filter_value_incompatible",
        "too_many_filters",
    }
)

READY = "ready"
UNAVAILABLE = "unavailable"
UNVERIFIED = "unverified"
ANALYSIS_UNAVAILABLE = "analysis_unavailable"
UNRESOLVED_REFERENCE = "unresolved_reference"
FILTER_INCOMPATIBLE = "filter_incompatible"
# Raisons d'indisponibilité d'une tuile, ensemble fermé.
REASONS = (ANALYSIS_UNAVAILABLE, UNRESOLVED_REFERENCE, FILTER_INCOMPATIBLE)

# Analyse lue pour un composant (identifiant du composant), ou `None` : invisible, supprimée,
# inexistante ou abîmée pour la session, sans distinction.
Pins = Mapping[str, Document | None]


def chart_compatible(chart: str, dimensions: int) -> bool:
    """Un type de graphique surchargé peut-il se montrer pour une analyse de cette forme ?

    La forme est le nombre de dimensions de la requête. Seul `value` est contraint : il montre un
    nombre unique, ce que seul une requête sans dimension garantit. `bars`, `line` et `grouped_bars`
    conviennent à toute forme.

    C'est plus strict que l'Explorateur : `Resultat.tsx` désactive `valeur` dès que le résultat a
    plus d'une ligne, donc l'autorise pour une requête avec dimensions qui rend une ligne. Un
    dashboard ne peut pas garantir une seule ligne (les données et les filtres changent), il ne
    peut donc s'appuyer que sur la forme de la requête. La règle est la même pour une surcharge
    `value` d'un visuel et pour un KPI ; un visuel sans surcharge garde la présentation de
    l'analyse, sans contrôle de plus."""
    return chart != "value" or dimensions == 0


def kpi_compatible(analysis: Document) -> bool:
    """Une révision d'analyse peut-elle se montrer en KPI ?

    Il faut que son graphique soit `value` et que sa requête n'ait aucune dimension : un KPI est un
    nombre unique, et seule une requête sans dimension le garantit. C'est la même règle statique
    que pour une surcharge `value` d'un visuel (`chart_compatible`)."""
    return analysis["presentation"]["chart"] == "value" and chart_compatible(
        "value", len(analysis["query"]["dimensions"])
    )


def _kind(model: dict[str, Any] | None, dimension: str) -> str | None:
    """Type de la dimension dans le modèle, ou `None` si le modèle ne l'expose pas."""
    if model is None:
        return None
    return next((item["type"] for item in model["dimensions"] if item["name"] == dimension), None)


def filter_problem(item: dict[str, Any], model: dict[str, Any] | None) -> str | None:
    """Règle qui empêche un filtre commun de s'appliquer à un modèle, ou `None`.

    Le modèle doit exposer la dimension, son type doit permettre l'opérateur du filtre (même
    table que la soumission), et la valeur par défaut comme les valeurs autorisées doivent être
    de ce type. Chaque valeur autorisée est jugée comme une égalité : elle ne demande pas que
    l'opérateur `in` soit permis pour le type."""
    kind = _kind(model, item["dimension"])
    if model is None or kind is None:
        return "dimension_not_exposed"
    if item["operator"] not in OPERATEURS[kind]:
        return "operator_not_allowed"
    probes = []
    if "default" in item:
        probes.append(
            {"column": item["dimension"], "operator": item["operator"], "value": item["default"]}
        )
    probes += [
        {"column": item["dimension"], "operator": "eq", "value": value}
        for value in item.get("allowed", [])
    ]
    try:
        valider(SemanticRequest(model["name"], (), (), tuple(probes)), {"models": [model]})
    except Invalid:
        return "filter_value_incompatible"
    return None


def _filter_checks(
    document: Document, pins: Pins, catalog: dict[str, Any]
) -> Iterator[tuple[int, int, str, str | None]]:
    """Jugement de chaque couple (filtre commun, cible) dont l'analyse est lisible : indice du
    filtre, rang de la cible, identifiant du composant et règle qui empêche le filtre de
    s'appliquer, ou `None`.

    Le filtre doit s'appliquer à la cible prise seule (voir `filter_problem`) ; et le type de sa
    dimension doit être celui de la première cible où il s'applique (`filter_type_mismatch`), faute
    de quoi une même valeur ne pourrait pas servir à toutes. C'est le même jugement à la
    sauvegarde et à la lecture : un modèle qui change après la sauvegarde ne rend pas un mélange
    de types acceptable."""
    for index, item in enumerate(document["filters"]):
        first: str | None = None
        for position, target in enumerate(item["targets"]):
            analysis = pins[target]
            if analysis is None:
                continue
            model = model_of(catalog, analysis["query"]["model"])
            problem = filter_problem(item, model)
            if problem is None:
                kind = _kind(model, item["dimension"])
                first = kind if first is None else first
                if kind != first:
                    problem = "filter_type_mismatch"
            yield index, position, target, problem


def save_violations(document: Document, pins: Pins, catalog: dict[str, Any]) -> list[Violation]:
    """Violations d'un dashboard que l'auteur veut sauvegarder, avec le chemin de chacune.

    Une analyse indisponible n'est signalée qu'une fois, sans autre contrôle sur ce composant :
    on ne devine rien du contenu d'une analyse qu'on ne peut pas lire. Un KPI exige une révision
    dont le graphique est `value` et la requête sans dimension (`kpi_compatible`). Un type
    surchargé doit convenir à la forme de l'analyse. Un
    filtre commun doit s'appliquer à chacune de ses cibles (voir `filter_problem`) avec le même
    type de dimension que la première cible, et aucune tuile ne dépasse `MAX_TILE_FILTERS`.
    """
    components = executables(document)
    violations: list[Violation] = []
    for component in components:
        analysis = pins[component.id]
        if analysis is None:
            violations.append(Violation(f"{component.path}/reference", ANALYSIS_UNAVAILABLE))
        elif component.type == "kpi" and not kpi_compatible(analysis):
            violations.append(Violation(f"{component.path}/reference", "kpi_requires_value"))
        elif component.chart is not None and not chart_compatible(
            component.chart, len(analysis["query"]["dimensions"])
        ):
            violations.append(
                Violation(f"{component.path}/presentation/chart", "chart_incompatible")
            )
    applied: dict[str, int] = {}
    for index, position, target, problem in _filter_checks(document, pins, catalog):
        applied[target] = applied.get(target, 0) + 1
        if problem is not None:
            violations.append(Violation(f"/filters/{index}/targets/{position}", problem))
    violations += [
        Violation(component.path, "too_many_filters")
        for component in components
        if (analysis := pins[component.id]) is not None
        and len(analysis["query"]["filters"]) + applied.get(component.id, 0) > MAX_TILE_FILTERS
    ]
    return violations


def personal_components(document: Document, pins: Pins) -> list[str]:
    """Composants d'un dashboard partagé dont l'analyse épinglée n'est pas partagée, dans l'ordre
    du document. À n'appeler que si aucune analyse n'est indisponible."""
    return [
        component.id
        for component in executables(document)
        if (analysis := pins[component.id]) is not None and analysis["visibility"] != "shared"
    ]


@dataclass(frozen=True)
class Tile:
    """État d'un composant exécutable pour la personne qui lit : `ready`, `unavailable` avec sa
    raison, ou `unverified` quand le catalogue ou la base ne permettent rien d'affirmer."""

    id: str
    state: str
    reason: str | None = None

    def json(self) -> dict[str, str]:
        found = {"id": self.id, "state": self.state}
        if self.reason is not None:
            found["reason"] = self.reason
        return found


def _tile(
    component: Component,
    analysis: Document | None,
    incompatible: Collection[str],
    catalog: dict[str, Any] | None,
    connections: Collection[str],
) -> Tile:
    if analysis is None:
        return Tile(component.id, UNAVAILABLE, ANALYSIS_UNAVAILABLE)
    if catalog is None:
        return Tile(component.id, UNVERIFIED)
    if reference_violations(analysis, catalog, connections):
        return Tile(component.id, UNAVAILABLE, UNRESOLVED_REFERENCE)
    if component.id in incompatible:
        return Tile(component.id, UNAVAILABLE, FILTER_INCOMPATIBLE)
    return Tile(component.id, READY)


def tiles(
    document: Document,
    pins: Pins,
    catalog: dict[str, Any] | None,
    connections: Collection[str],
) -> list[Tile]:
    """État de chaque composant exécutable, dans l'ordre du document.

    Par priorité : analyse indisponible (rien de son contenu n'est dit), référence non résolue
    (l'analyse est lisible mais son modèle, une métrique, une dimension ou la connexion a disparu),
    filtre commun devenu incompatible avec la tuile : seul, ou par le type de sa dimension, qui
    n'est plus celui des autres cibles (voir `_filter_checks`, le même jugement qu'à la
    sauvegarde). Sans catalogue lisible (`catalog` vaut `None`), une analyse lisible reste
    `unverified` : rien n'est affirmé."""
    incompatible = (
        set()
        if catalog is None
        else {
            target
            for _, _, target, problem in _filter_checks(document, pins, catalog)
            if problem is not None
        }
    )
    return [
        _tile(component, pins[component.id], incompatible, catalog, connections)
        for component in executables(document)
    ]
