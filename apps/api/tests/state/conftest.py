"""Adresses de base d'état portant un mot de passe, et base migrée (plan 07, 7.1).

Le cluster de test accepte toute connexion locale (`trust`) : un mot de passe ajouté à
l'adresse est ignoré par le serveur, mais traverse tout le code de Board. On vérifie ainsi
qu'il n'apparaît dans aucun message, sans configurer d'authentification.
"""

from collections.abc import Iterator

import pytest
from skifer_board.state import DATABASE_URL, upgrade
from sqlalchemy import Engine
from sqlalchemy.engine import URL

MOT_DE_PASSE = "Mdp-Tres-Confidentiel-42"
SOCKET_ABSENT = "/tmp/sb-inexistant-7c1/.s.PGSQL.5432"


def adresse(url: URL, mot_de_passe: str | None = MOT_DE_PASSE) -> str:
    """Adresse complète, mot de passe en clair, telle qu'un exploitant la fournirait."""
    return url.set(password=mot_de_passe).render_as_string(hide_password=False)


def environnement(url: URL, mot_de_passe: str | None = MOT_DE_PASSE) -> dict[str, str]:
    return {DATABASE_URL: adresse(url, mot_de_passe)}


def injoignable() -> str:
    return f"postgresql+pg8000://board:{MOT_DE_PASSE}@/etat?unix_sock={SOCKET_ABSENT}"


@pytest.fixture
def migre(engine: Engine) -> Iterator[Engine]:
    """Base vierge amenée à la dernière révision."""
    upgrade(engine)
    yield engine
