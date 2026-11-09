"""Commande `skifer-board-reindex` : reconstruit les index des analyses et des dashboards depuis
git (plans 18, A4, et 19, B5).

Git fait foi. La commande relit chaque analyse et chaque dashboard existants dans le dépôt de
contenus (histoire contrôlée comprise) et remplace tous les index (analyses, dashboards et
références des dashboards) en une seule transaction : sur une base vierge comme sur une base
existante, le résultat est le même, une ligne ancienne ou fausse disparaît, et les deux genres
changent ensemble ou pas du tout. Un contenu dont l'histoire ou le contenu est abîmé n'est pas
indexé et est nommé ; tout autre échec de lecture (dépôt indisponible, git absent) arrête la
commande avant de toucher les index.
Une écriture publiée pendant la reconstruction peut y être écrasée par la version qu'on vient
de lire : la commande relit la tête du dépôt dans la transaction du remplacement, avant son
commit. Si elle a bougé ou ne se lit plus, la transaction est annulée (l'index n'est jamais
modifié par une passe ratée) et, si elle a bougé, la commande recommence (`ATTEMPTS` essais au
plus). Si le dépôt change à chaque essai, elle s'arrête sans rien prétendre.
Code de sortie : 0 index reconstruit, 1 dépôt ou base indisponible, schéma pas à jour ou
analyse illisible, 2 usage ou configuration absente ou malformée, 3 dépôt modifié pendant chacun
des essais (relancer la commande quand les écritures se calment).
"""

from __future__ import annotations

import os
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.exc import SQLAlchemyError

from ..identity.config import ConfigError
from ..state.config import DATABASE_URL, config_from_env
from ..state.database import SchemaError, check_schema, connect
from .errors import ContentError
from .index import AnalysisIndex, DashboardIndex, DashboardRow, IndexRow
from .repository import (
    ANALYSIS_KIND,
    DAMAGED_REASONS,
    DASHBOARD_KIND,
    REPOSITORY_VARIABLE,
    ContentConfigError,
    ContentRepository,
    Kind,
    StoredRevision,
)
from .repository import config_from_env as content_from_env

USAGE = "Usage : skifer-board-reindex"
ATTEMPTS = 3
# Raisons qui disent qu'un contenu est abîmé, pas que le dépôt est indisponible.
DAMAGED = DAMAGED_REASONS


@dataclass(frozen=True)
class Report:
    """Ce que la reconstruction a indexé et nommé : (espace, identifiant, raison) pour chaque
    contenu abîmé, analyses d'abord, dashboards ensuite."""

    indexed: int
    unreadable: tuple[tuple[str, str, str], ...]
    dashboards: int = 0
    dashboards_unreadable: tuple[tuple[str, str, str], ...] = ()


class RepositoryMoving(Exception):
    """Le dépôt a changé pendant chacun des essais : l'index n'a pas pu être garanti à jour."""


def reindex(
    repository: ContentRepository,
    index: AnalysisIndex,
    dashboards: DashboardIndex,
    attempts: int = ATTEMPTS,
) -> Report:
    """Remplace les index par ce que git contient ; lève `ContentError` si le dépôt est en défaut
    et `RepositoryMoving` si la tête a bougé pendant chacun des `attempts` essais.

    La tête est relue dans la transaction du remplacement, avant son commit : si elle a bougé
    ou si elle est illisible, la transaction est annulée et les index gardent leur contenu
    d'avant. Une passe ratée ne modifie donc jamais un index."""
    for _ in range(attempts):
        before = repository.head()

        def unchanged(before: str | None = before) -> None:
            if repository.head() != before:
                raise RepositoryMoving

        try:
            return _sweep(repository, index, dashboards, unchanged)
        except RepositoryMoving:
            continue
    raise RepositoryMoving


def _gather[R](
    repository: ContentRepository,
    kind: Kind,
    make: Callable[[str, StoredRevision], R],
) -> tuple[list[R], list[tuple[str, str, str]]]:
    """Lignes des contenus d'un genre, et ceux qui sont abîmés (nommés, pas indexés)."""
    rows: list[R] = []
    unreadable: list[tuple[str, str, str]] = []
    for space_id, content_id in repository.contents(kind=kind):
        try:
            rows.append(make(space_id, repository.read(space_id, content_id, kind=kind)))
        except ContentError as error:
            if error.code == kind.not_found:
                continue
            if error.reason not in DAMAGED:
                raise
            unreadable.append((space_id, content_id, error.reason))
    return rows, unreadable


def _sweep(
    repository: ContentRepository,
    index: AnalysisIndex,
    dashboards: DashboardIndex,
    before_commit: Callable[[], None],
) -> Report:
    rows, unreadable = _gather(repository, ANALYSIS_KIND, IndexRow.of)
    boards, damaged = _gather(repository, DASHBOARD_KIND, DashboardRow.of)
    index.replace(rows, before_commit, lambda connection: dashboards.replace_in(connection, boards))
    return Report(len(rows), tuple(unreadable), len(boards), tuple(damaged))


def _utc_now() -> datetime:
    return datetime.now(UTC)


def main(
    argv: Sequence[str] | None = None,
    environ: Mapping[str, str] | None = None,
    clock: Callable[[], datetime] = _utc_now,
) -> int:
    if (sys.argv[1:] if argv is None else list(argv)) != []:
        print(USAGE, file=sys.stderr)
        return 2
    variables = os.environ if environ is None else environ
    try:
        database = config_from_env(variables)
        content = content_from_env(variables)
    except (ConfigError, ContentConfigError) as error:
        print(error, file=sys.stderr)
        return 2
    if database is None:
        print(f"{DATABASE_URL} n'est pas définie.", file=sys.stderr)
        return 2
    if content is None:
        print(f"{REPOSITORY_VARIABLE} n'est pas définie.", file=sys.stderr)
        return 2
    engine = connect(database)
    try:
        check_schema(engine, database)
        report = reindex(
            ContentRepository(content, clock=clock),
            AnalysisIndex(engine, clock),
            DashboardIndex(engine, clock),
        )
    except SchemaError as error:
        print(error, file=sys.stderr)
        return 1
    except ContentError as error:
        print(f"Dépôt de contenus indisponible ({error.reason}).", file=sys.stderr)
        return 1
    except RepositoryMoving:
        print(
            f"Le dépôt de contenus a changé pendant chacun des {ATTEMPTS} essais : "
            "l'index n'est pas garanti à jour, relancer la commande.",
            file=sys.stderr,
        )
        return 3
    except SQLAlchemyError:
        # Le détail du pilote n'est pas recopié : il peut reprendre l'adresse de connexion.
        print(
            f"Réindexation impossible dans la base d'état {database.describe()}.", file=sys.stderr
        )
        return 1
    finally:
        engine.dispose()
    print(f"{report.indexed} analyse(s) indexée(s).")
    print(f"{report.dashboards} dashboard(s) indexé(s).")
    for space_id, analysis_id, reason in report.unreadable:
        print(f"Illisible : {space_id}/{analysis_id} ({reason}).", file=sys.stderr)
    for space_id, dashboard_id, reason in report.dashboards_unreadable:
        print(f"Illisible : dashboard {space_id}/{dashboard_id} ({reason}).", file=sys.stderr)
    return 1 if report.unreadable or report.dashboards_unreadable else 0
