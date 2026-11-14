"""Matrice pure de visibilité des révisions de contenus du plan 20."""

from __future__ import annotations

import pytest
from skifer_board.content.shared_access import latest_visible, revision_visible
from skifer_board.spaces.model import PersonRef, Role

OWNER = PersonRef("issuer", "owner")
OTHER = PersonRef("issuer", "other")


@pytest.mark.parametrize(
    "role,actor,approved,expected",
    [
        (None, OWNER, {1}, (False, False)),
        (Role.READER, OWNER, {1}, (False, False)),
        (Role.READER, OTHER, {1}, (False, False)),
        (Role.CREATOR, OWNER, set(), (True, True)),
        (Role.CREATOR, OTHER, set(), (False, False)),
        (Role.CREATOR, OTHER, {1}, (True, False)),
        (Role.CREATOR, OTHER, {2}, (False, True)),
        (Role.ADMIN, OTHER, set(), (True, True)),
    ],
)
def test_visibilite(
    role: Role | None, actor: PersonRef, approved: set[int], expected: tuple[bool, bool]
) -> None:
    assert tuple(revision_visible(role, actor, OWNER, n, approved) for n in (1, 2)) == expected
    selected = latest_visible([2, 1], role, actor, OWNER, approved)
    assert selected == (2 if expected[1] else 1 if expected[0] else None)


def test_approbation_hors_historique_ne_rend_pas_visible() -> None:
    assert latest_visible([1, 2], Role.CREATOR, OTHER, OWNER, {3}) is None
    assert latest_visible([], Role.ADMIN, OWNER, OWNER, {1}) is None


@pytest.mark.parametrize(
    "role,actor,expected",
    [
        (None, OWNER, False),
        (Role.READER, OWNER, False),
        (Role.CREATOR, OWNER, True),
        (Role.CREATOR, OTHER, False),
        (Role.ADMIN, OWNER, True),
        (Role.ADMIN, OTHER, False),
    ],
)
def test_reviser_ou_supprimer_exige_proprietaire(
    role: Role | None, actor: PersonRef, expected: bool
) -> None:
    from skifer_board.content.shared_access import can_change

    assert can_change(role, actor, OWNER) is expected
