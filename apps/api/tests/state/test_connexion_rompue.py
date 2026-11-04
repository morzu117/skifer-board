"""Connexion rompue par une erreur du pilote : jetée, jamais rendue au pool (plan 07, 8.2).

Un texte que le pilote ne sait pas encoder (un demi-code UTF-16 isolé) fait échouer l'envoi
d'une requête à mi-message : rendue au pool, la connexion désynchronisée ferait échouer toutes
les requêtes suivantes. Une erreur venue de la base, elle, laisse la connexion saine : elle
est gardée. Les moteurs sont ceux de `connect`, avec un pool réduit pour savoir quelle
connexion est resservie.
"""

from collections.abc import Callable, Iterator
from typing import Any

import pytest
from skifer_board.state import config_from_env, connect, database
from sqlalchemy import Connection, Engine, create_engine, literal, select, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.pool import QueuePool

from .conftest import environnement

Fabrique = Callable[[int], Engine]


@pytest.fixture
def moteur_de(migre: Engine, monkeypatch: pytest.MonkeyPatch) -> Iterator[Fabrique]:
    """Moteurs de production (`connect`) sur la base de test, pool de `taille` connexions sans
    débordement."""
    moteurs: list[Engine] = []

    def fabriquer(taille: int) -> Engine:
        def creer(url: URL, **options: Any) -> Engine:
            return create_engine(url, **options, pool_size=taille, max_overflow=0, pool_timeout=5)

        with monkeypatch.context() as patch:
            patch.setattr(database, "create_engine", creer)
            config = config_from_env(environnement(migre.url))
            assert config is not None
            moteur = connect(config)
        moteurs.append(moteur)
        return moteur

    yield fabriquer
    for moteur in moteurs:
        moteur.dispose()


def pid(connexion: Connection) -> int:
    valeur = connexion.execute(text("select pg_backend_pid()")).scalar_one()
    assert isinstance(valeur, int)
    return valeur


def pid_servi(moteur: Engine) -> int:
    with moteur.connect() as connexion:
        return pid(connexion)


def pool(moteur: Engine) -> QueuePool:
    assert isinstance(moteur.pool, QueuePool)
    return moteur.pool


DEMI_CODES = [
    lambda c: c.execute(select(literal("a\ud800"))),
    lambda c: c.execute(select(literal("\udfff"))),
    lambda c: c.execute(text("select :v"), {"v": "x\udc00y"}),
    lambda c: c.execute(text("select cast(:v as text) = 'a'"), {"v": "\ud83d"}),
]


@pytest.mark.parametrize(
    "envoi", DEMI_CODES, ids=["literal-haut", "literal-bas", "parametre", "comparaison"]
)
def test_erreur_du_pilote_jette_la_connexion(
    moteur_de: Fabrique, envoi: Callable[[Connection], object]
) -> None:
    moteur = moteur_de(1)
    avant = pid_servi(moteur)
    with pytest.raises(UnicodeEncodeError), moteur.connect() as connexion:
        assert pid(connexion) == avant
        envoi(connexion)
    # La connexion fautive n'est pas rendue : la suivante est neuve, et répond.
    assert pool(moteur).checkedout() == 0
    with moteur.connect() as connexion:
        apres = pid(connexion)
        assert connexion.execute(select(literal("a"))).scalar_one() == "a"
        assert connexion.execute(text("select 1")).scalar_one() == 1
    assert apres != avant
    # Et elle reste servie ensuite : une seule connexion jetée, pas une à chaque requête.
    for _ in range(5):
        with moteur.connect() as connexion:
            assert pid(connexion) == apres
            assert connexion.execute(select(literal("é😀"))).scalar_one() == "é😀"


def test_erreur_du_pilote_dans_une_transaction(moteur_de: Fabrique) -> None:
    """Dans une transaction ouverte par `begin` (le chemin des magasins) : rien n'est écrit,
    la connexion est jetée, la suivante écrit normalement."""
    moteur = moteur_de(1)
    with moteur.begin() as connexion:
        connexion.execute(text("create table essai (valeur text)"))
    avant = pid_servi(moteur)
    with pytest.raises(UnicodeEncodeError), moteur.begin() as connexion:
        connexion.execute(text("insert into essai values ('premier')"))
        connexion.execute(text("insert into essai values (:v)"), {"v": "a\ud800"})
    with moteur.begin() as connexion:
        assert pid(connexion) != avant
        assert connexion.execute(text("select count(*) from essai")).scalar_one() == 0
        connexion.execute(text("insert into essai values ('second')"))
    with moteur.connect() as connexion:
        lignes = connexion.execute(text("select valeur from essai")).scalars().all()
    assert lignes == ["second"]


ERREURS_DE_LA_BASE: list[tuple[str, str, dict[str, object], type[DBAPIError]]] = [
    ("division", "select 1/0", {}, DBAPIError),
    ("nul", "select cast(:v as text)", {"v": "a\x00b"}, DBAPIError),
    ("syntaxe", "selec 1", {}, DBAPIError),
    ("contrainte", "insert into tempo values (1)", {}, IntegrityError),
    ("table-absente", "select * from absente", {}, DBAPIError),
]


@pytest.mark.parametrize(
    "requete,parametres,erreur",
    [cas[1:] for cas in ERREURS_DE_LA_BASE],
    ids=[cas[0] for cas in ERREURS_DE_LA_BASE],
)
def test_erreur_de_la_base_garde_la_connexion(
    moteur_de: Fabrique, requete: str, parametres: dict[str, object], erreur: type[DBAPIError]
) -> None:
    """Une erreur venue de la base laisse le protocole intact : la même connexion est
    resservie, sa table temporaire comprise."""
    moteur = moteur_de(1)
    with moteur.connect() as connexion:
        avant = pid(connexion)
        connexion.execute(text("create temporary table tempo (id int primary key)"))
        connexion.execute(text("insert into tempo values (1)"))
        connexion.commit()
    with pytest.raises(erreur) as leve, moteur.connect() as connexion:
        connexion.execute(text(requete), parametres)
    assert leve.value.connection_invalidated is False
    with moteur.connect() as connexion:
        assert pid(connexion) == avant
        # Une table temporaire ne survit qu'à sa propre session : c'est bien la même.
        assert connexion.execute(text("select count(*) from tempo")).scalar_one() == 1


def test_seule_la_connexion_fautive_est_jetee(moteur_de: Fabrique) -> None:
    """Le pool n'est pas invalidé en entier : l'autre connexion reste servie."""
    moteur = moteur_de(2)
    with moteur.connect() as premiere, moteur.connect() as seconde:
        fautive, saine = pid(premiere), pid(seconde)
        with pytest.raises(UnicodeEncodeError):
            premiere.execute(select(literal("a\ud800")))
    assert fautive != saine
    with moteur.connect() as premiere, moteur.connect() as seconde:
        servis = {pid(premiere), pid(seconde)}
        assert premiere.execute(text("select 1")).scalar_one() == 1
        assert seconde.execute(text("select 1")).scalar_one() == 1
    assert saine in servis
    assert fautive not in servis
    assert len(servis) == 2
