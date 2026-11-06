"""Erreurs à code fermé du dépôt de contenus (plan 18, A1 à A3 ; plan 19, B1 et B2).

Un message ne cite jamais un chemin du serveur, une sortie de git, une valeur de filtre ni
une personne : le code dit quoi, `reason` dit pourquoi en une étiquette fermée, et les
violations d'un contenu invalide désignent un champ, jamais sa valeur.
"""

from __future__ import annotations

from dataclasses import dataclass

CONTENT_UNAVAILABLE = "content_unavailable"
REVISION_CONFLICT = "revision_conflict"
INVALID_ANALYSIS = "invalid_analysis"
ANALYSIS_NOT_FOUND = "analysis_not_found"

INVALID_DASHBOARD = "invalid_dashboard"
DASHBOARD_NOT_FOUND = "dashboard_not_found"

# Codes du plan 18 (analyses) ; ceux du plan 19 viennent à côté, dans `DASHBOARD_CODES`.
CODES = frozenset({CONTENT_UNAVAILABLE, REVISION_CONFLICT, INVALID_ANALYSIS, ANALYSIS_NOT_FOUND})
DASHBOARD_CODES = frozenset({INVALID_DASHBOARD, DASHBOARD_NOT_FOUND})


@dataclass(frozen=True)
class Violation:
    """Un champ refusé : pointeur JSON et règle fermée."""

    path: str
    rule: str


class ContentError(Exception):
    """Refus à code fermé ; rien n'est écrit dans le dépôt lorsqu'il est levé avant le commit."""

    def __init__(self, code: str, reason: str, violations: tuple[Violation, ...] = ()) -> None:
        self.code = code
        self.reason = reason
        self.violations = violations
        super().__init__(code)
