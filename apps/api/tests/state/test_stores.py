"""Contrat commun des magasins de sessions et de demandes de connexion, en mémoire et en base
(plan 07, P6 à P8, sous-tâche 7.2 ; plan 06, I4).

Chaque cas de comportement tourne sur les deux réalisations : ce que la mémoire garantit dans
un processus, la base doit le garantir à l'identique. Les cas propres à la base vérifient ce
qui est réellement écrit dans les tables.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from identity.conftest import INSTANT
from skifer_board.identity import (
    LOGIN_LIFETIME,
    LoginRequests,
    MemoryLoginRequests,
    MemorySessionStore,
    PendingLogin,
    SessionStore,
)
from skifer_board.identity.model import Identity
from skifer_board.identity.sessions import Session, fingerprint
from skifer_board.state import PgLoginRequests, PgSessionStore, login_requests, sessions
from sqlalchemy import Engine, create_engine, select, text
from sqlalchemy.engine import URL

ABSOLUE = timedelta(hours=8)
INACTIVITE = timedelta(minutes=30)
EMETTEUR = "https://id.example.invalid"
PERSONNE = Identity(EMETTEUR, "sujet", None, None, ("lecteurs",))
EMPREINTE = re.compile(r"[0-9a-f]{64}")

IDENTITES = [
    pytest.param(Identity(EMETTEUR, "sujet", None, None, ()), id="sans-nom-ni-groupe"),
    pytest.param(Identity(EMETTEUR, "sujet", "Nom", None, ("lecteurs",)), id="sans-courriel"),
    pytest.param(
        Identity(EMETTEUR, "sujet", None, "personne@example.invalid", ("a", "b")), id="sans-nom"
    ),
    pytest.param(
        Identity(
            EMETTEUR,
            "sujet-éàü-日本",
            "Zoé Ñúñez — Ŝkifer 🎿",
            "zoé.ñúñez@exemple.invalid",
            ("équipe-α", "lecteurs", "日本語"),
        ),
        id="non-ascii",
    ),
    pytest.param(
        Identity(
            EMETTEUR,
            "sujet",
            'O\'Brien "guillemets" \\ anti-oblique',
            "a@b.invalid",
            ("a,b", "{accolades}", '"guillemets"', "NULL", "", " espaces ", "anti\\", "a b"),
        ),
        id="groupes-speciaux",
    ),
    pytest.param(
        Identity(EMETTEUR, "sujet", "Nom", "n@example.invalid", tuple(f"g{i}" for i in range(50))),
        id="cinquante-groupes",
    ),
]


def utc(instant: datetime) -> bool:
    return instant.tzinfo is not None and instant.utcoffset() == timedelta(0)


def empreintes_en_base(moteur: Engine) -> frozenset[str]:
    with moteur.connect() as connexion:
        return frozenset(connexion.execute(select(sessions.c.fingerprint)).scalars())


@dataclass
class Sessions:
    """Un magasin de sessions et le moyen de lire, sans le prolonger, ce qu'il garde."""

    magasin: SessionStore
    empreintes: Callable[[], frozenset[str]]


FabriqueSessions = Callable[[timedelta, timedelta], Sessions]


@pytest.fixture(params=["memoire", "base"])
def fabrique_sessions(request: pytest.FixtureRequest) -> FabriqueSessions:
    if request.param == "memoire":

        def en_memoire(absolue: timedelta, inactivite: timedelta) -> Sessions:
            magasin = MemorySessionStore(absolue, inactivite)
            return Sessions(magasin, magasin.fingerprints)

        return en_memoire
    moteur: Engine = request.getfixturevalue("migre")

    def en_base(absolue: timedelta, inactivite: timedelta) -> Sessions:
        return Sessions(
            PgSessionStore(moteur, absolue, inactivite), lambda: empreintes_en_base(moteur)
        )

    return en_base


@pytest.fixture
def magasin(fabrique_sessions: FabriqueSessions) -> Sessions:
    return fabrique_sessions(ABSOLUE, INACTIVITE)


@pytest.fixture(params=["memoire", "base"])
def demandes(request: pytest.FixtureRequest) -> LoginRequests:
    if request.param == "memoire":
        return MemoryLoginRequests()
    return PgLoginRequests(request.getfixturevalue("migre"))


def demande(instant: datetime = INSTANT, marque: str = "") -> PendingLogin:
    return PendingLogin(
        f"nonce-{marque}", f"verificateur-{marque}", fingerprint(f"lien-{marque}"), instant
    )


# --- Sessions : contrat commun ------------------------------------------------------------


@pytest.mark.parametrize("identite", IDENTITES)
def test_creation_puis_lecture_identite_identique(magasin: Sessions, identite: Identity) -> None:
    jeton = magasin.magasin.create(identite, INSTANT)
    assert re.fullmatch(r"[A-Za-z0-9_-]{43,}", jeton)
    assert magasin.empreintes() == {fingerprint(jeton)}
    assert jeton not in magasin.empreintes()
    lue = magasin.magasin.get(jeton, INSTANT + timedelta(minutes=1))
    assert lue == Session(identite, INSTANT, INSTANT + timedelta(minutes=1), INSTANT + ABSOLUE)
    assert lue.identity.groups == identite.groups
    assert isinstance(lue.identity.groups, tuple)
    for instant in (lue.created_at, lue.last_seen, lue.expires_at):
        assert instant.tzinfo is not None


@pytest.mark.parametrize(
    "realisation",
    ["memoire", "base"],
)
@pytest.mark.parametrize("groupe", ["null", "Null", "nUlL"])
def test_groupe_nomme_null_relu_a_l_identique(
    request: pytest.FixtureRequest, realisation: str, groupe: str
) -> None:
    magasin: SessionStore = (
        MemorySessionStore(ABSOLUE, INACTIVITE)
        if realisation == "memoire"
        else PgSessionStore(request.getfixturevalue("migre"), ABSOLUE, INACTIVITE)
    )
    identite = Identity(EMETTEUR, "sujet", None, None, (groupe, "lecteurs"))
    lue = magasin.get(magasin.create(identite, INSTANT), INSTANT)
    assert lue is not None
    assert lue.identity.groups == (groupe, "lecteurs")


def test_identifiants_distincts_et_independants(magasin: Sessions) -> None:
    autre = Identity(EMETTEUR, "autre", "Autre", None, ())
    premier = magasin.magasin.create(PERSONNE, INSTANT)
    second = magasin.magasin.create(autre, INSTANT)
    assert premier != second
    assert magasin.empreintes() == {fingerprint(premier), fingerprint(second)}
    lu_premier = magasin.magasin.get(premier, INSTANT)
    lu_second = magasin.magasin.get(second, INSTANT)
    assert lu_premier is not None and lu_premier.identity == PERSONNE
    assert lu_second is not None and lu_second.identity == autre


def test_prolongation_de_l_activite(magasin: Sessions) -> None:
    jeton = magasin.magasin.create(PERSONNE, INSTANT)
    instant = INSTANT
    # Chaque lecture repousse l'inactivité : 29 minutes d'écart, quinze fois, dépassent
    # largement 30 minutes cumulées sans jamais atteindre l'échéance absolue.
    for _ in range(15):
        instant += timedelta(minutes=29)
        lue = magasin.magasin.get(jeton, instant)
        assert lue is not None
        assert lue.last_seen == instant
        assert lue.created_at == INSTANT
        assert lue.expires_at == INSTANT + ABSOLUE
    assert magasin.magasin.get(jeton, instant + INACTIVITE) is None


@pytest.mark.parametrize(
    ("decalage", "valide"),
    [
        (timedelta(seconds=-1), True),
        (timedelta(microseconds=-1), True),
        (timedelta(0), False),
        (timedelta(microseconds=1), False),
        (timedelta(seconds=1), False),
    ],
)
def test_expiration_absolue_a_la_seconde_pres(
    fabrique_sessions: FabriqueSessions, decalage: timedelta, valide: bool
) -> None:
    magasin = fabrique_sessions(timedelta(hours=1), INACTIVITE)
    jeton = magasin.magasin.create(PERSONNE, INSTANT)
    # Lectures régulières : seule l'échéance absolue peut faire expirer la session.
    for minutes in (20, 40):
        assert magasin.magasin.get(jeton, INSTANT + timedelta(minutes=minutes)) is not None
    echeance = INSTANT + timedelta(hours=1)
    lue = magasin.magasin.get(jeton, echeance + decalage)
    assert (lue is not None) == valide
    if lue is not None:
        assert lue.expires_at == echeance
        assert lue.last_seen == echeance + decalage
    else:
        # Refusée une fois, la session ne revient pas, même lue avec un instant antérieur.
        assert fingerprint(jeton) not in magasin.empreintes()
        assert magasin.magasin.get(jeton, INSTANT + timedelta(minutes=50)) is None
        assert magasin.magasin.get(jeton, INSTANT) is None


@pytest.mark.parametrize(
    ("decalage", "valide"),
    [
        (timedelta(seconds=-1), True),
        (timedelta(microseconds=-1), True),
        (timedelta(0), False),
        (timedelta(microseconds=1), False),
        (timedelta(seconds=1), False),
    ],
)
def test_expiration_par_inactivite_a_la_seconde_pres(
    magasin: Sessions, decalage: timedelta, valide: bool
) -> None:
    jeton = magasin.magasin.create(PERSONNE, INSTANT)
    derniere = INSTANT + timedelta(minutes=10, seconds=7, microseconds=123456)
    assert magasin.magasin.get(jeton, derniere) is not None
    lue = magasin.magasin.get(jeton, derniere + INACTIVITE + decalage)
    assert (lue is not None) == valide
    if lue is None:
        assert fingerprint(jeton) not in magasin.empreintes()
        assert magasin.magasin.get(jeton, derniere + timedelta(minutes=1)) is None
        assert magasin.magasin.get(jeton, derniere) is None
    else:
        assert lue.last_seen == derniere + INACTIVITE + decalage


def test_inactivite_depuis_la_creation(magasin: Sessions) -> None:
    jeton = magasin.magasin.create(PERSONNE, INSTANT)
    assert magasin.magasin.get(jeton, INSTANT + INACTIVITE) is None
    assert magasin.magasin.get(jeton, INSTANT) is None


def test_suppression(magasin: Sessions) -> None:
    jeton = magasin.magasin.create(PERSONNE, INSTANT)
    autre = magasin.magasin.create(PERSONNE, INSTANT)
    magasin.magasin.delete(jeton)
    assert magasin.magasin.get(jeton, INSTANT) is None
    # Idempotente, et sans effet sur une autre session ni pour un jeton inconnu.
    magasin.magasin.delete(jeton)
    magasin.magasin.delete("inconnu")
    assert magasin.empreintes() == {fingerprint(autre)}
    assert magasin.magasin.get(autre, INSTANT) is not None


@pytest.mark.parametrize("jeton", ["inconnu", "", "x" * 500, "é🎿", "' OR 1=1 --"])
def test_jeton_inconnu(magasin: Sessions, jeton: str) -> None:
    existant = magasin.magasin.create(PERSONNE, INSTANT)
    assert magasin.magasin.get(jeton, INSTANT) is None
    # Le jeton présenté est une empreinte connue en clair : elle ne vaut pas l'identifiant.
    assert magasin.magasin.get(fingerprint(existant), INSTANT) is None
    assert magasin.empreintes() == {fingerprint(existant)}


def test_purge_des_sessions_expirees_a_la_creation(fabrique_sessions: FabriqueSessions) -> None:
    magasin = fabrique_sessions(timedelta(hours=1), INACTIVITE)
    actif = magasin.magasin.create(PERSONNE, INSTANT)
    inactif = magasin.magasin.create(PERSONNE, INSTANT)
    limite = magasin.magasin.create(PERSONNE, INSTANT + timedelta(microseconds=1))
    assert magasin.magasin.get(actif, INSTANT + timedelta(minutes=20)) is not None
    # À +30 min : `inactif` atteint exactement son inactivité, `limite` pas encore.
    nouveau = magasin.magasin.create(PERSONNE, INSTANT + INACTIVITE)
    assert magasin.empreintes() == {fingerprint(actif), fingerprint(limite), fingerprint(nouveau)}
    assert magasin.magasin.get(actif, INSTANT + timedelta(minutes=40)) is not None
    # À l'échéance absolue exacte d'`actif`, une création le purge aussi.
    dernier = magasin.magasin.create(PERSONNE, INSTANT + timedelta(hours=1))
    assert magasin.empreintes() == {fingerprint(dernier)}
    assert fingerprint(inactif) not in magasin.empreintes()


def test_lecture_n_expire_que_la_session_lue(magasin: Sessions) -> None:
    lue = magasin.magasin.create(PERSONNE, INSTANT)
    voisine = magasin.magasin.create(PERSONNE, INSTANT)
    assert magasin.magasin.get(lue, INSTANT + INACTIVITE) is None
    # La voisine, expirée elle aussi, n'est purgée qu'à la prochaine création.
    assert magasin.empreintes() == {fingerprint(voisine)}


@settings(suppress_health_check=[HealthCheck.function_scoped_fixture], max_examples=25)
@given(st.lists(st.integers(min_value=0, max_value=2000), min_size=1, max_size=30))
def test_propriete_validite_selon_les_deux_echeances(magasin: Sessions, avances: list[int]) -> None:
    jeton = magasin.magasin.create(PERSONNE, INSTANT)
    temps = dernier = 0
    vivante = True
    for avance in avances:
        temps += avance
        vivante = vivante and temps < 28800 and temps - dernier < 1800
        session = magasin.magasin.get(jeton, INSTANT + timedelta(seconds=temps))
        assert (session is not None) == vivante
        assert (fingerprint(jeton) in magasin.empreintes()) == vivante
        if vivante:
            dernier = temps


# --- Demandes de connexion : contrat commun -----------------------------------------------


def test_demande_rangee_puis_consommee(demandes: LoginRequests) -> None:
    rangee = demande(INSTANT + timedelta(microseconds=654321), "a")
    demandes.put("state-a", rangee)
    assert demandes.count() == 1
    rendue = demandes.take("state-a")
    assert rendue == rangee
    assert rendue is not None and rendue.created_at.tzinfo is not None
    assert demandes.count() == 0
    # Usage unique : un second retour du même `state` ne trouve plus rien.
    assert demandes.take("state-a") is None


def test_state_inconnu(demandes: LoginRequests) -> None:
    demandes.put("state-a", demande(marque="a"))
    for state in ("inconnu", "", "STATE-A", "state-a ", fingerprint("state-a")):
        assert demandes.take(state) is None
    assert demandes.count() == 1
    assert demandes.take("state-a") == demande(marque="a")


def test_demandes_independantes(demandes: LoginRequests) -> None:
    for marque in "abc":
        demandes.put(f"state-{marque}", demande(marque=marque))
    assert demandes.take("state-b") == demande(marque="b")
    assert demandes.count() == 2
    assert demandes.take("state-a") == demande(marque="a")
    assert demandes.take("state-c") == demande(marque="c")
    assert demandes.count() == 0


def test_purge_a_l_ouverture_aux_bornes(demandes: LoginRequests) -> None:
    demandes.put("ancienne", demande(INSTANT, "ancienne"))
    demandes.put("recente", demande(INSTANT + timedelta(minutes=5), "recente"))
    # Une microseconde avant ses 10 minutes, l'ancienne demande reste.
    juste_avant = INSTANT + LOGIN_LIFETIME - timedelta(microseconds=1)
    demandes.put("juste-avant", demande(juste_avant, "juste-avant"))
    assert demandes.count() == 3
    # À 10 minutes exactement, elle est purgée ; les récentes restent intactes.
    demandes.put("a-l-echeance", demande(INSTANT + LOGIN_LIFETIME, "a-l-echeance"))
    assert demandes.count() == 3
    assert demandes.take("ancienne") is None
    assert demandes.take("recente") == demande(INSTANT + timedelta(minutes=5), "recente")
    assert demandes.take("juste-avant") == demande(juste_avant, "juste-avant")
    assert demandes.take("a-l-echeance") == demande(INSTANT + LOGIN_LIFETIME, "a-l-echeance")


def test_purge_de_toutes_les_demandes_perimees(demandes: LoginRequests) -> None:
    for minute in range(5):
        demandes.put(f"s{minute}", demande(INSTANT + timedelta(minutes=minute), str(minute)))
    demandes.put("tard", demande(INSTANT + timedelta(hours=1), "tard"))
    assert demandes.count() == 1
    assert demandes.take("tard") == demande(INSTANT + timedelta(hours=1), "tard")


def test_take_ne_purge_pas(demandes: LoginRequests) -> None:
    # Le retour ne juge pas l'âge : c'est le parcours qui refuse une demande trop ancienne.
    demandes.put("vieille", demande(INSTANT, "vieille"))
    assert demandes.take("vieille") == demande(INSTANT, "vieille")


# --- Base : ce qui est réellement écrit (Pg seulement) -----------------------------------


def lignes(moteur: Engine) -> list[dict[str, object]]:
    with moteur.connect() as connexion:
        resultat = connexion.execute(select(sessions)).mappings().all()
        return [dict(ligne) for ligne in resultat]


def test_table_sessions_ne_garde_que_l_empreinte(migre: Engine) -> None:
    magasin = PgSessionStore(migre, ABSOLUE, INACTIVITE)
    identite = Identity(EMETTEUR, "sujet", "Nom", "n@example.invalid", ("lecteurs",))
    jeton = magasin.create(identite, INSTANT)
    [ligne] = lignes(migre)
    assert ligne == {
        "fingerprint": hashlib.sha256(jeton.encode()).hexdigest(),
        "issuer": EMETTEUR,
        "subject": "sujet",
        "name": "Nom",
        "email": "n@example.invalid",
        "groups": ["lecteurs"],
        "created_at": INSTANT,
        "last_seen": INSTANT,
        "expires_at": INSTANT + ABSOLUE,
    }
    assert EMPREINTE.fullmatch(str(ligne["fingerprint"]))
    for valeur in ligne.values():
        assert jeton not in str(valeur)
    # La lecture prolonge l'activité en base aussi.
    magasin.get(jeton, INSTANT + timedelta(minutes=3))
    [ligne] = lignes(migre)
    assert ligne["last_seen"] == INSTANT + timedelta(minutes=3)


def test_table_demandes_ne_garde_que_des_empreintes(migre: Engine) -> None:
    magasin = PgLoginRequests(migre)
    lien = "lien-navigateur-en-clair"
    magasin.put("state-en-clair", PendingLogin("nonce-n", "verif-v", fingerprint(lien), INSTANT))
    with migre.connect() as connexion:
        [ligne] = connexion.execute(select(login_requests)).mappings().all()
    assert dict(ligne) == {
        "state_fingerprint": fingerprint("state-en-clair"),
        "nonce": "nonce-n",
        "verifier": "verif-v",
        "binding_fingerprint": fingerprint(lien),
        "created_at": INSTANT,
    }
    for valeur in ligne.values():
        assert "state-en-clair" not in str(valeur)
        assert lien not in str(valeur)


def verificateurs(moteur: Engine) -> list[str]:
    with moteur.connect() as connexion:
        return list(connexion.execute(select(login_requests.c.verifier)).scalars())


def test_verificateur_efface_a_la_consommation_et_a_la_purge(migre: Engine) -> None:
    magasin = PgLoginRequests(migre)
    magasin.put("consommee", PendingLogin("n1", "verif-consommee", fingerprint("l1"), INSTANT))
    magasin.put("perimee", PendingLogin("n2", "verif-perimee", fingerprint("l2"), INSTANT))
    assert sorted(verificateurs(migre)) == ["verif-consommee", "verif-perimee"]
    assert magasin.take("consommee") is not None
    assert verificateurs(migre) == ["verif-perimee"]
    magasin.put(
        "neuve", PendingLogin("n3", "verif-neuve", fingerprint("l3"), INSTANT + LOGIN_LIFETIME)
    )
    assert verificateurs(migre) == ["verif-neuve"]


@pytest.fixture
def moteur_hors_utc(database_url: URL, migre: Engine) -> Iterator[Engine]:
    """Base dont le fuseau par défaut n'est pas UTC : les instants relus doivent l'être."""
    with migre.connect() as connexion:
        connexion.execute(
            text(f"ALTER DATABASE \"{database_url.database}\" SET timezone TO 'Pacific/Chatham'")
        )
        connexion.commit()
    moteur = create_engine(database_url)
    try:
        with moteur.connect() as connexion:
            assert connexion.execute(text("SHOW timezone")).scalar_one() == "Pacific/Chatham"
        yield moteur
    finally:
        moteur.dispose()


@pytest.mark.parametrize(
    "realisation",
    ["memoire", "base"],
)
def test_instants_relus_en_utc_quel_que_soit_le_fuseau_de_la_base(
    request: pytest.FixtureRequest, realisation: str
) -> None:
    sessions_: SessionStore
    demandes_: LoginRequests
    if realisation == "memoire":
        sessions_ = MemorySessionStore(ABSOLUE, INACTIVITE)
        demandes_ = MemoryLoginRequests()
    else:
        moteur: Engine = request.getfixturevalue("moteur_hors_utc")
        sessions_ = PgSessionStore(moteur, ABSOLUE, INACTIVITE)
        demandes_ = PgLoginRequests(moteur)
    demandes_.put("s", demande(INSTANT, "s"))
    rendue = demandes_.take("s")
    assert rendue == demande(INSTANT, "s")
    jeton = sessions_.create(PERSONNE, INSTANT)
    lue = sessions_.get(jeton, INSTANT + timedelta(seconds=1))
    assert lue is not None
    assert lue.created_at == INSTANT
    assert utc(rendue.created_at), rendue.created_at
    for instant in (lue.created_at, lue.last_seen, lue.expires_at):
        assert utc(instant), instant
        assert instant.isoformat().endswith("+00:00")
