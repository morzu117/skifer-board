"""Connexion à la base d'état : TLS vérifié quand il est demandé, rien sinon (plan 07, P11).

Aucune connexion n'est ouverte : on inspecte les arguments remis à `create_engine`.
"""

import ssl
from unittest.mock import Mock

import pytest
from skifer_board.state import DATABASE_URL, DatabaseConfig, config_from_env, connect, database
from sqlalchemy import Engine, create_engine

from .conftest import MOT_DE_PASSE

DISTANTE = f"postgresql+pg8000://board:{MOT_DE_PASSE}@db.example.invalid/etat?sslmode=verify-full"
LOCALE = f"postgresql+pg8000://board:{MOT_DE_PASSE}@localhost/etat"
SOCKET = f"postgresql+pg8000://board:{MOT_DE_PASSE}@/etat?unix_sock=/tmp/sbpg-x/.s.PGSQL.5432"


def lire(valeur: str) -> DatabaseConfig:
    config = config_from_env({DATABASE_URL: valeur})
    assert config is not None
    return config


def arguments(config: DatabaseConfig, monkeypatch: pytest.MonkeyPatch) -> dict[str, object]:
    creer = Mock(wraps=create_engine)
    monkeypatch.setattr(database, "create_engine", creer)
    moteur = connect(config)
    try:
        assert isinstance(moteur, Engine)
        creer.assert_called_once()
        assert creer.call_args.args == (config.url,)
        options = dict(creer.call_args.kwargs)
        # Les arguments de connexion vus par le pilote : sans `sslmode`, inconnu de pg8000.
        _, parametres = moteur.dialect.create_connect_args(moteur.url)
        assert "sslmode" not in parametres
        return options
    finally:
        moteur.dispose()


def test_tls_contexte_verifie(monkeypatch: pytest.MonkeyPatch) -> None:
    options = arguments(lire(DISTANTE), monkeypatch)
    connexion = options["connect_args"]
    assert isinstance(connexion, dict)
    assert set(connexion) == {"ssl_context"}
    contexte = connexion["ssl_context"]
    assert isinstance(contexte, ssl.SSLContext)
    assert contexte.verify_mode == ssl.CERT_REQUIRED
    assert contexte.check_hostname is True
    assert options["pool_pre_ping"] is True


def test_contexte_neuf_a_chaque_moteur(monkeypatch: pytest.MonkeyPatch) -> None:
    config = lire(DISTANTE)
    premier = arguments(config, monkeypatch)["connect_args"]
    second = arguments(config, monkeypatch)["connect_args"]
    assert isinstance(premier, dict) and isinstance(second, dict)
    assert premier["ssl_context"] is not second["ssl_context"]


@pytest.mark.parametrize("valeur", [LOCALE, SOCKET])
def test_sans_tls_aucun_contexte(valeur: str, monkeypatch: pytest.MonkeyPatch) -> None:
    config = lire(valeur)
    assert not config.tls
    options = arguments(config, monkeypatch)
    assert not options.get("connect_args")
    assert options["pool_pre_ping"] is True
