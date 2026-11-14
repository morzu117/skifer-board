"""Règle pure de visibilité des révisions des contenus partagés (plan 20, C4 et C7).

Cette règle n'effectue aucune lecture et ne donne accès à aucune donnée. L'appelant doit
fournir le propriétaire et les approbations établis pour la tête du dépôt concernée.
"""

from __future__ import annotations

from collections.abc import Collection, Iterable

from ..spaces.model import PersonRef, Role


def revision_visible(
    role: Role | None,
    actor: PersonRef,
    owner: PersonRef,
    revision: int,
    approved: Collection[int],
) -> bool:
    """Un créateur voit ses révisions, un admin toutes, les autres les seules approuvées."""
    if role is None or not role.allows(Role.CREATOR):
        return False
    return actor == owner or role.allows(Role.ADMIN) or revision in approved


def latest_visible(
    revisions: Iterable[int],
    role: Role | None,
    actor: PersonRef,
    owner: PersonRef,
    approved: Collection[int],
) -> int | None:
    """Dernière révision visible, ou aucune sans révéler l'existence des autres."""
    return max(
        (
            revision
            for revision in revisions
            if revision_visible(role, actor, owner, revision, approved)
        ),
        default=None,
    )


def can_change(role: Role | None, actor: PersonRef, owner: PersonRef) -> bool:
    """La création n'accorde la révision ou la suppression qu'au propriétaire."""
    return role is not None and role.allows(Role.CREATOR) and actor == owner
