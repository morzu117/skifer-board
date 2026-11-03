"""Enregistreur de télémétrie (plan 11, 11.2 ; T4 à T6) : journal, file bornée, lots, pertes,
vidage à l'arrêt, purge horaire.

Le magasin est remplacé par un faux qui garde ses lots, ou tombe en panne sur commande ; les
horloges sont injectées. Un seul essai passe par une vraie base, pour le fil complet.
"""

from __future__ import annotations

import json
import logging
import sys
import threading
import time
from collections.abc import Sequence
from datetime import datetime, timedelta

import pytest
from skifer_board.telemetry import Measure, Recorder, TelemetryStore, configure_logging
from skifer_board.telemetry.recorder import BATCH, CAPACITY, LOGGER, PURGE_EVERY, WARN_EVERY
from sqlalchemy import Engine, create_engine

from .conftest import MAINTENANT, Journal, atlas, http, lignes

INJOIGNABLE = "postgresql+pg8000://x@/x?unix_sock=/tmp/sb-absent/.s.PGSQL.1"
RETENTION = timedelta(days=90)


class Horloge:
    def __init__(self, instant: datetime = MAINTENANT) -> None:
        self.instant = instant

    def __call__(self) -> datetime:
        return self.instant

    def avancer(self, **duree: float) -> None:
        self.instant += timedelta(**duree)


class Magasin(TelemetryStore):
    """Faux magasin : garde les lots et les purges ; tombe en panne sur commande."""

    def __init__(self) -> None:
        super().__init__(create_engine(INJOIGNABLE))
        self.lots: list[list[Measure]] = []
        self.purges: list[datetime] = []
        self.panne_ecriture = False
        self.panne_purge = False

    def record(self, measures: Sequence[Measure]) -> None:
        if self.panne_ecriture:
            raise RuntimeError("base indisponible : secret")
        self.lots.append(list(measures))

    def purge(self, before: datetime) -> int:
        self.purges.append(before)
        if self.panne_purge:
            raise RuntimeError("purge impossible : secret")
        return 0

    def ecrites(self) -> list[Measure]:
        return [mesure for lot in self.lots for mesure in lot]


def mesures(nombre: int) -> list[Measure]:
    return [http(duration_ms=float(rang)) for rang in range(nombre)]


def pertes(journal: Journal) -> list[int]:
    return [
        ligne["count"]
        for ligne in journal.avertissements()
        if ligne.get("telemetry") == "measures_dropped"
    ]


def test_constantes_du_plan() -> None:
    assert CAPACITY == 10_000
    assert WARN_EVERY == timedelta(minutes=1)
    assert PURGE_EVERY == timedelta(hours=1)
    assert BATCH > 0


# --- Journal ---------------------------------------------------------------------------------


def test_une_ligne_json_par_mesure(journal: Journal) -> None:
    enregistreur = Recorder(Magasin())
    premiere, seconde = http(), atlas(rows=3, size=10)
    enregistreur.submit(premiere)
    enregistreur.submit(seconde)
    assert journal.mesures() == [premiere.to_json(), seconde.to_json()]
    assert all(r.levelno == logging.INFO for r in journal.enregistrements)
    # La ligne est un JSON brut, sans préfixe, et garde les caractères non ASCII.
    texte = journal.textes()[0]
    assert texte.startswith("{") and json.loads(texte) == premiere.to_json()


def test_configure_logging_idempotent_vers_la_sortie_standard(
    capsys: pytest.CaptureFixture[str],
) -> None:
    logger = logging.getLogger(LOGGER)
    handlers, niveau, propage = list(logger.handlers), logger.level, logger.propagate
    logger.handlers = []
    logger.propagate = True
    logger.setLevel(logging.NOTSET)
    try:
        configure_logging()
        configure_logging()
        assert len(logger.handlers) == 1
        (sortie,) = logger.handlers
        assert isinstance(sortie, logging.StreamHandler)
        assert sortie.stream is sys.stdout
        assert logger.level == logging.INFO
        assert logger.propagate is False
        mesure = http()
        Recorder(None).submit(mesure)
        capture = capsys.readouterr()
        assert capture.out == json.dumps(mesure.to_json(), ensure_ascii=False) + "\n"
        assert capture.err == ""
        # Un gestionnaire déjà posé n'est pas doublé ; le niveau et la propagation sont remis.
        logger.setLevel(logging.ERROR)
        logger.propagate = True
        configure_logging()
        assert logger.handlers == [sortie]
        assert (logger.level, logger.propagate) == (logging.INFO, False)
    finally:
        logger.handlers = handlers
        logger.setLevel(niveau)
        logger.propagate = propage


# --- Mode local ------------------------------------------------------------------------------


def test_mode_local_ni_file_ni_fil(journal: Journal) -> None:
    enregistreur = Recorder(None, capacity=1)
    avant = set(threading.enumerate())
    enregistreur.start()
    assert set(threading.enumerate()) == avant
    for mesure in mesures(5):
        enregistreur.submit(mesure)
    # Rien n'est mis en file : la capacité 1 n'est jamais dépassée, aucune perte.
    assert enregistreur._queue.qsize() == 0
    enregistreur.flush()
    enregistreur.flush(block=True)
    enregistreur.stop()
    assert len(journal.mesures()) == 5
    assert journal.avertissements() == []


def test_mode_local_perte_comptee_et_avouee_a_l_arret(journal: Journal) -> None:
    horloge = Horloge()
    enregistreur = Recorder(None, horloge)
    enregistreur.lose(1)
    enregistreur.lose(2)
    horloge.avancer(seconds=1)
    enregistreur.stop()
    assert pertes(journal) == [1, 2]


# --- File et lots ----------------------------------------------------------------------------


def test_lots_de_taille_batch() -> None:
    magasin = Magasin()
    enregistreur = Recorder(magasin, batch=3)
    envoyees = mesures(7)
    for mesure in envoyees:
        enregistreur.submit(mesure)
    for _ in range(4):
        enregistreur.flush()
    assert [len(lot) for lot in magasin.lots] == [3, 3, 1]
    assert magasin.ecrites() == envoyees


def test_file_vide_sans_ecriture() -> None:
    magasin = Magasin()
    enregistreur = Recorder(magasin, wait=0.001)
    enregistreur.flush()
    enregistreur.flush(block=True)
    assert magasin.lots == []


def test_file_pleine_perte_comptee_sans_bloquer(journal: Journal) -> None:
    magasin = Magasin()
    horloge = Horloge()
    enregistreur = Recorder(magasin, horloge, capacity=2)
    debut = time.perf_counter()
    for mesure in mesures(5):
        enregistreur.submit(mesure)
    assert time.perf_counter() - debut < 1
    # La première perte est avouée tout de suite ; les suivantes attendent la minute.
    assert pertes(journal) == [1]
    # Toutes les mesures, perdues ou non, sont parties au journal.
    assert len(journal.mesures()) == 5
    enregistreur.flush()
    assert len(magasin.ecrites()) == 2
    horloge.avancer(seconds=59.999)
    enregistreur.flush()
    assert pertes(journal) == [1]
    horloge.avancer(seconds=0.001)
    enregistreur.flush()
    assert pertes(journal) == [1, 2]
    # Rien de plus à avouer.
    horloge.avancer(minutes=5)
    enregistreur.flush()
    enregistreur.stop()
    assert pertes(journal) == [1, 2]


def test_avertissement_au_plus_une_fois_par_minute(journal: Journal) -> None:
    horloge = Horloge()
    enregistreur = Recorder(Magasin(), horloge)
    enregistreur.lose(1)
    for _ in range(10):
        horloge.avancer(seconds=5)
        enregistreur.lose(1)
    assert pertes(journal) == [1]
    horloge.avancer(seconds=10)  # 60 s après le premier avertissement
    enregistreur.lose(1)
    assert pertes(journal) == [1, 11]
    horloge.avancer(seconds=30)
    enregistreur.lose(4)
    assert pertes(journal) == [1, 11]
    # À l'arrêt, le reste est avoué sans attendre la minute.
    enregistreur.stop()
    assert pertes(journal) == [1, 11, 4]
    assert all(r.levelno == logging.WARNING for r in journal.enregistrements)


def test_base_en_panne_lot_perdu_et_avoue(journal: Journal) -> None:
    magasin = Magasin()
    magasin.panne_ecriture = True
    horloge = Horloge()
    enregistreur = Recorder(magasin, horloge, batch=4)
    for mesure in mesures(6):
        enregistreur.submit(mesure)
    enregistreur.flush()
    assert pertes(journal) == [4]
    enregistreur.flush()
    assert pertes(journal) == [4]
    enregistreur.stop()
    assert pertes(journal) == [4, 2]
    assert "secret" not in "".join(journal.textes())
    # La base revenue, l'écriture reprend.
    magasin.panne_ecriture = False
    enregistreur.submit(http())
    enregistreur.flush()
    assert len(magasin.ecrites()) == 1


# --- Purge -----------------------------------------------------------------------------------


def test_purge_au_plus_une_fois_par_heure() -> None:
    magasin = Magasin()
    horloge = Horloge()
    enregistreur = Recorder(magasin, horloge)
    enregistreur.flush()
    assert magasin.purges == [MAINTENANT - RETENTION]
    horloge.avancer(minutes=59, seconds=59)
    enregistreur.flush()
    assert len(magasin.purges) == 1
    horloge.avancer(seconds=1)
    enregistreur.flush()
    assert magasin.purges == [MAINTENANT - RETENTION, horloge() - RETENTION]
    horloge.avancer(minutes=30)
    enregistreur.flush()
    assert len(magasin.purges) == 2


def test_purge_en_echec_journalisee_sans_arreter_l_ecriture(journal: Journal) -> None:
    magasin = Magasin()
    magasin.panne_purge = True
    horloge = Horloge()
    enregistreur = Recorder(magasin, horloge)
    enregistreur.submit(http())
    enregistreur.flush()
    assert len(magasin.ecrites()) == 1
    assert journal.avertissements() == [{"telemetry": "purge_failed"}]
    # Pas de nouvel essai avant l'heure.
    enregistreur.flush()
    assert len(magasin.purges) == 1
    horloge.avancer(hours=1)
    enregistreur.flush()
    assert len(magasin.purges) == 2
    assert journal.avertissements() == [{"telemetry": "purge_failed"}] * 2
    assert "secret" not in "".join(journal.textes())


# --- Fil d'écriture --------------------------------------------------------------------------


def test_fil_ecrit_puis_vide_la_file_a_l_arret() -> None:
    magasin = Magasin()
    enregistreur = Recorder(magasin, wait=0.01)
    enregistreur.start()
    fil = enregistreur._thread
    assert fil is not None and fil.is_alive() and fil.daemon and fil.name == "telemetry"
    enregistreur.start()
    assert enregistreur._thread is fil
    envoyees = mesures(50)
    for mesure in envoyees:
        enregistreur.submit(mesure)
    enregistreur.stop()
    assert not fil.is_alive()
    assert enregistreur._thread is None
    assert magasin.ecrites() == envoyees
    # Un second arrêt ne fait rien ; un redémarrage relance un fil.
    enregistreur.stop()
    enregistreur.start()
    assert enregistreur._thread is not None and enregistreur._thread is not fil
    enregistreur.submit(http())
    enregistreur.stop()
    assert len(magasin.ecrites()) == 51


def test_soumission_apres_arret_comptee_puis_reacceptee_au_redemarrage(
    journal: Journal,
) -> None:
    magasin = Magasin()
    horloge = Horloge()
    enregistreur = Recorder(magasin, horloge, wait=0.01)
    enregistreur.start()
    enregistreur.submit(http())
    enregistreur.stop()
    assert len(magasin.ecrites()) == 1
    # Après l'arrêt : journalisée, jamais mise en file, comptée et avouée.
    tardive = http(duration_ms=99.0)
    enregistreur.submit(tardive)
    assert enregistreur._queue.qsize() == 0
    assert journal.mesures()[-1] == tardive.to_json()
    assert pertes(journal) == [1]
    enregistreur.submit(http())
    assert pertes(journal) == [1]  # moins d'une minute après
    horloge.avancer(minutes=1)
    enregistreur.submit(http())
    assert pertes(journal) == [1, 2]
    assert enregistreur._queue.qsize() == 0
    # Un redémarrage réaccepte les mesures, et les écrit.
    enregistreur.start()
    reprise = http(duration_ms=7.0)
    enregistreur.submit(reprise)
    enregistreur.stop()
    assert magasin.ecrites()[-1] == reprise
    assert len(magasin.ecrites()) == 2
    assert pertes(journal) == [1, 2]


def test_avant_le_demarrage_la_file_accumule(journal: Journal) -> None:
    """Avant `start()`, et même après un `stop()` sans démarrage, la file garde les mesures ;
    le fil les écrit à son démarrage."""
    magasin = Magasin()
    enregistreur = Recorder(magasin, wait=0.01)
    enregistreur.stop()
    envoyees = mesures(4)
    for mesure in envoyees:
        enregistreur.submit(mesure)
    assert enregistreur._queue.qsize() == 4
    assert magasin.lots == []
    enregistreur.start()
    enregistreur.stop()
    assert magasin.ecrites() == envoyees
    assert pertes(journal) == []


def test_apres_arret_en_mode_local_rien_n_est_perdu(journal: Journal) -> None:
    """Sans base, rien n'est mis en file : après l'arrêt, la ligne JSON part, sans perte."""
    enregistreur = Recorder(None)
    enregistreur.start()
    enregistreur.stop()
    enregistreur.submit(http())
    assert len(journal.mesures()) == 1
    assert pertes(journal) == []


class Bloquant(Magasin):
    """Le premier lot attend qu'on le libère : l'arrêt est demandé pendant l'écriture."""

    def __init__(self) -> None:
        super().__init__()
        self.entre = threading.Event()
        self.libere = threading.Event()

    def record(self, measures: Sequence[Measure]) -> None:
        if not self.lots:
            self.entre.set()
            assert self.libere.wait(5)
        super().record(measures)


def test_arret_pendant_une_ecriture_vide_tout_le_reste() -> None:
    magasin = Bloquant()
    enregistreur = Recorder(magasin, batch=1, wait=5)
    envoyees = mesures(6)
    for mesure in envoyees:
        enregistreur.submit(mesure)
    enregistreur.start()
    assert magasin.entre.wait(5)
    arret = threading.Thread(target=enregistreur.stop)
    arret.start()
    debut = time.perf_counter()
    while not enregistreur._stop.is_set():
        assert time.perf_counter() - debut < 5
        time.sleep(0.001)
    magasin.libere.set()
    arret.join(5)
    assert not arret.is_alive()
    # Lot par lot, toutes les mesures sont écrites avant la fin du fil (T5).
    assert [len(lot) for lot in magasin.lots] == [1] * 6
    assert magasin.ecrites() == envoyees


def test_arret_sans_attendre_le_delai_de_la_file() -> None:
    """Le fil attend la file `wait` secondes au plus : l'arrêt ne dure pas plus."""
    enregistreur = Recorder(Magasin(), wait=0.05)
    enregistreur.start()
    debut = time.perf_counter()
    enregistreur.stop()
    assert time.perf_counter() - debut < 2


def test_arret_avec_base_en_panne_perte_avouee(journal: Journal) -> None:
    magasin = Magasin()
    magasin.panne_ecriture = True
    enregistreur = Recorder(magasin, wait=0.01, batch=2)
    for mesure in mesures(5):
        enregistreur.submit(mesure)
    enregistreur.start()
    enregistreur.stop()
    assert sum(pertes(journal)) == 5
    assert enregistreur._queue.qsize() == 0


def test_fil_reel_sur_la_base(migre: Engine, journal: Journal) -> None:
    """Le fil complet sur une vraie base : écriture, purge des mesures de plus de 90 jours."""
    magasin = TelemetryStore(migre)
    ancienne = http(at=MAINTENANT - timedelta(days=91))
    magasin.record([ancienne])
    enregistreur = Recorder(magasin, Horloge(), wait=0.01, batch=2)
    enregistreur.start()
    envoyees = [http(), atlas(rows=2, size=30), http(status=404, outcome="forbidden")]
    for mesure in envoyees:
        enregistreur.submit(mesure)
    enregistreur.stop()
    ecrites = lignes(migre)
    assert [(e["operation"], e["status"], e["outcome"]) for e in ecrites] == [
        (m.operation, m.status, m.outcome) for m in envoyees
    ]
    assert journal.avertissements() == []
