"""Empreintes et échéances des sessions, exemples et propriété (I4, T2)."""

import hashlib
import re
from datetime import timedelta

from hypothesis import given
from hypothesis import strategies as st
from skifer_board.identity.model import Identity
from skifer_board.identity.sessions import MemorySessionStore, fingerprint

from identity.conftest import INSTANT

PERSONNE = Identity("https://id.example.invalid", "sujet", None, None, ("lecteurs",))


def test_identifiants_opaques_et_suppression_idempotente() -> None:
    magasin = MemorySessionStore(timedelta(hours=8), timedelta(minutes=30))
    premier = magasin.create(PERSONNE, INSTANT)
    second = magasin.create(PERSONNE, INSTANT)
    assert premier != second
    for jeton in (premier, second):
        assert re.fullmatch(r"[A-Za-z0-9_-]{43,}", jeton)
        assert fingerprint(jeton) == hashlib.sha256(jeton.encode()).hexdigest()
        assert jeton not in magasin.fingerprints()
    assert magasin.fingerprints() == {fingerprint(premier), fingerprint(second)}
    assert magasin.get("inconnu", INSTANT) is None
    magasin.delete(premier)
    magasin.delete(premier)
    assert magasin.get(premier, INSTANT) is None
    assert len(magasin) == 1


def test_bornes_inactivite_et_prolongation() -> None:
    magasin = MemorySessionStore(timedelta(hours=8), timedelta(minutes=30))
    jeton = magasin.create(PERSONNE, INSTANT)
    avant = INSTANT + timedelta(minutes=30, microseconds=-1)
    session = magasin.get(jeton, avant)
    assert session is not None
    assert session.last_seen == avant
    assert session.created_at == INSTANT
    assert session.expires_at == INSTANT + timedelta(hours=8)
    assert session.identity == PERSONNE
    assert magasin.get(jeton, avant + timedelta(minutes=30)) is None
    assert len(magasin) == 0


def test_duree_absolue_malgre_activite_et_purge_a_la_creation() -> None:
    magasin = MemorySessionStore(timedelta(hours=1), timedelta(minutes=30))
    actif = magasin.create(PERSONNE, INSTANT)
    inactif = magasin.create(PERSONNE, INSTANT)
    assert magasin.get(actif, INSTANT + timedelta(minutes=20)) is not None
    nouveau = magasin.create(PERSONNE, INSTANT + timedelta(minutes=30))
    assert magasin.fingerprints() == {fingerprint(actif), fingerprint(nouveau)}
    assert fingerprint(inactif) not in magasin.fingerprints()
    assert magasin.get(actif, INSTANT + timedelta(minutes=40)) is not None
    assert magasin.get(actif, INSTANT + timedelta(hours=1, microseconds=-1)) is not None
    assert magasin.get(actif, INSTANT + timedelta(hours=1)) is None
    magasin.create(PERSONNE, INSTANT + timedelta(hours=2))
    assert len(magasin) == 1


@given(st.lists(st.integers(min_value=0, max_value=2000), min_size=1, max_size=60))
def test_propriete_validite_selon_les_deux_echeances(avances: list[int]) -> None:
    magasin = MemorySessionStore(timedelta(hours=8), timedelta(minutes=30))
    jeton = magasin.create(PERSONNE, INSTANT)
    temps = dernier = 0
    vivante = True
    for avance in avances:
        temps += avance
        vivante = vivante and temps < 28800 and temps - dernier < 1800
        session = magasin.get(jeton, INSTANT + timedelta(seconds=temps))
        assert (session is not None) == vivante
        assert len(magasin) == int(vivante)
        if vivante:
            dernier = temps
