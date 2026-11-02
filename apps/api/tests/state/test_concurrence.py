"""Concurrence entre processus sur la même base (plan 07, P6, P7, sous-tâche 7.2).

Chaque fil a son propre moteur, donc sa propre connexion, comme le ferait un processus
serveur distinct. Les horloges sont injectées : aucun test ne dépend du temps réel.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from functools import partial

import pytest
from identity.conftest import INSTANT
from skifer_board.identity import (
    LoginRequests,
    MemoryLoginRequests,
    MemorySessionStore,
    PendingLogin,
    SessionStore,
)
from skifer_board.identity.model import Identity
from skifer_board.identity.sessions import Session, fingerprint
from skifer_board.state import PgLoginRequests, PgSessionStore, sessions
from sqlalchemy import Engine, create_engine, select
from sqlalchemy.engine import URL

FILS = 12
TOURS = 8
PERSONNE = Identity("https://id.example.invalid", "sujet", "Nom", None, ("lecteurs",))
ABSOLUE = timedelta(hours=1)
INACTIVITE = timedelta(minutes=30)


@pytest.fixture
def moteurs(database_url: URL, migre: Engine) -> Iterator[list[Engine]]:
    """Un moteur par fil, sur la même base migrée : autant de « processus » que de fils."""
    crees = [create_engine(database_url) for _ in range(FILS)]
    try:
        yield crees
    finally:
        for moteur in crees:
            moteur.dispose()


def en_meme_temps[T](taches: list[Callable[[], T]]) -> list[T]:
    """Lance les tâches ensemble, derrière une barrière, et rend leurs résultats dans l'ordre."""
    barriere = threading.Barrier(len(taches), timeout=10)

    def lancer(tache: Callable[[], T]) -> T:
        barriere.wait()
        return tache()

    with ThreadPoolExecutor(max_workers=len(taches)) as executeur:
        return list(executeur.map(lancer, taches))


@pytest.fixture(params=["memoire", "base"])
def demandes_par_fil(request: pytest.FixtureRequest) -> list[LoginRequests]:
    if request.param == "memoire":
        commun = MemoryLoginRequests()
        return [commun] * FILS
    moteurs_: list[Engine] = request.getfixturevalue("moteurs")
    return [PgLoginRequests(moteur) for moteur in moteurs_]


@pytest.fixture(params=["memoire", "base"])
def sessions_par_fil(request: pytest.FixtureRequest) -> list[SessionStore]:
    if request.param == "memoire":
        commun = MemorySessionStore(ABSOLUE, INACTIVITE)
        return [commun] * FILS
    moteurs_: list[Engine] = request.getfixturevalue("moteurs")
    return [PgSessionStore(moteur, ABSOLUE, INACTIVITE) for moteur in moteurs_]


def test_un_seul_retour_recoit_la_demande(demandes_par_fil: list[LoginRequests]) -> None:
    for tour in range(TOURS):
        state = f"state-{tour}"
        rangee = PendingLogin(f"n{tour}", f"v{tour}", fingerprint(f"l{tour}"), INSTANT)
        demandes_par_fil[tour % FILS].put(state, rangee)
        resultats = en_meme_temps([partial(magasin.take, state) for magasin in demandes_par_fil])
        recues = [r for r in resultats if r is not None]
        assert recues == [rangee], tour
        assert all(magasin.count() == 0 for magasin in demandes_par_fil)


def lire(magasin: SessionStore, jeton: str, instant: datetime) -> Callable[[], Session | None]:
    return lambda: magasin.get(jeton, instant)


DECALAGES = [
    timedelta(seconds=-1),
    timedelta(microseconds=-1),
    timedelta(0),
    timedelta(microseconds=1),
    timedelta(seconds=1),
    timedelta(minutes=5),
]


def test_expiration_absolue_croisee_avec_des_lectures(
    sessions_par_fil: list[SessionStore],
) -> None:
    echeance = INSTANT + ABSOLUE
    for tour in range(TOURS):
        jeton = sessions_par_fil[0].create(PERSONNE, INSTANT)
        # Activité récente : seule l'échéance absolue est en jeu.
        for minutes in (20, 40, 50):
            assert sessions_par_fil[1].get(jeton, INSTANT + timedelta(minutes=minutes))
        instants = [echeance + DECALAGES[(i + tour) % len(DECALAGES)] for i in range(FILS)]
        resultats = en_meme_temps(
            [
                lire(magasin, jeton, instant)
                for magasin, instant in zip(sessions_par_fil, instants, strict=True)
            ]
        )
        for instant, resultat in zip(instants, resultats, strict=True):
            if instant >= echeance:
                # Aucune lecture à l'échéance ou après ne rend la session.
                assert resultat is None, (tour, instant)
            elif resultat is not None:
                assert resultat.last_seen == instant
                assert resultat.expires_at == echeance
        # Une lecture tardive l'a refusée : elle ne revient plus, même lue plus tôt ensuite.
        for magasin in sessions_par_fil:
            assert magasin.get(jeton, echeance - timedelta(seconds=1)) is None
            assert magasin.get(jeton, INSTANT) is None


def test_expiration_par_inactivite_croisee_avec_des_lectures(
    sessions_par_fil: list[SessionStore],
) -> None:
    for tour in range(TOURS):
        jeton = sessions_par_fil[0].create(PERSONNE, INSTANT)
        echeance = INSTANT + INACTIVITE
        instants = [echeance + DECALAGES[(i + tour) % len(DECALAGES)] for i in range(FILS)]
        resultats = en_meme_temps(
            [
                lire(magasin, jeton, instant)
                for magasin, instant in zip(sessions_par_fil, instants, strict=True)
            ]
        )
        precoces = [
            r for i, r in zip(instants, resultats, strict=True) if i < echeance and r is not None
        ]
        for instant, resultat in zip(instants, resultats, strict=True):
            if instant >= echeance and resultat is not None:
                # Une lecture tardive ne réussit que si une lecture antérieure à l'échéance
                # a d'abord prolongé l'activité : jamais de résurrection.
                assert precoces, (tour, instant)
                assert any(instant < p.last_seen + INACTIVITE for p in precoces)
        if not precoces:
            for magasin in sessions_par_fil:
                assert magasin.get(jeton, INSTANT) is None


def test_lectures_toutes_a_l_echeance_ou_apres(sessions_par_fil: list[SessionStore]) -> None:
    for tour in range(TOURS):
        jeton = sessions_par_fil[0].create(PERSONNE, INSTANT)
        echeance = INSTANT + INACTIVITE
        instants = [echeance + DECALAGES[2 + (i + tour) % 4] for i in range(FILS)]
        resultats = en_meme_temps(
            [
                lire(magasin, jeton, instant)
                for magasin, instant in zip(sessions_par_fil, instants, strict=True)
            ]
        )
        assert resultats == [None] * FILS, tour
        for magasin in sessions_par_fil:
            assert magasin.get(jeton, INSTANT) is None


def test_aucune_session_expiree_ne_reste_en_base(moteurs: list[Engine]) -> None:
    magasins = [PgSessionStore(moteur, ABSOLUE, INACTIVITE) for moteur in moteurs]
    jetons = [magasins[0].create(PERSONNE, INSTANT) for _ in range(FILS)]
    echeance = INSTANT + ABSOLUE
    resultats = en_meme_temps(
        [lire(magasin, jeton, echeance) for magasin, jeton in zip(magasins, jetons, strict=True)]
    )
    assert resultats == [None] * FILS
    with moteurs[0].connect() as connexion:
        assert connexion.execute(select(sessions.c.fingerprint)).all() == []
