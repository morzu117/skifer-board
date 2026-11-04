"""Adresse de la base d'état : lecture, refus, TLS et secret jamais recopié (plan 07, P1, P10,
P11)."""

import pytest
from skifer_board.identity import ConfigError
from skifer_board.state import DATABASE_URL, DatabaseConfig, config_from_env

from .conftest import MOT_DE_PASSE

SOCKET = "/tmp/sbpg-x/.s.PGSQL.5432"
AVEC_HOTE = (
    f"postgresql+pg8000://board:{MOT_DE_PASSE}@db.example.invalid:5433/etat?sslmode=verify-full"
)
BOUCLE = f"postgresql+pg8000://board:{MOT_DE_PASSE}@localhost/etat"
AVEC_SOCKET = f"postgresql+pg8000://board:{MOT_DE_PASSE}@/etat?unix_sock={SOCKET}"


def lire(valeur: str) -> DatabaseConfig:
    config = config_from_env({DATABASE_URL: valeur})
    assert config is not None
    return config


@pytest.mark.parametrize(
    "environ", [{}, {DATABASE_URL: ""}, {"VARIABLE_SANS_RAPPORT": "postgresql+pg8000://h/b"}]
)
def test_sans_base(environ: dict[str, str]) -> None:
    assert config_from_env(environ) is None


def test_adresse_avec_hote() -> None:
    config = lire(AVEC_HOTE)
    assert config.url.drivername == "postgresql+pg8000"
    assert config.url.host == "db.example.invalid"
    assert config.url.port == 5433
    assert config.url.database == "etat"
    assert config.url.username == "board"
    # Le mot de passe est gardé pour la connexion, seulement là.
    assert config.url.password == MOT_DE_PASSE
    assert config.describe() == "« etat » sur db.example.invalid"
    assert config.tls


def test_adresse_avec_socket() -> None:
    config = lire(AVEC_SOCKET)
    assert config.url.host is None
    assert config.url.query["unix_sock"] == SOCKET
    assert config.describe() == f"« etat » sur {SOCKET}"
    assert not config.tls


def test_adresse_sans_hote_ni_socket() -> None:
    config = lire("postgresql+pg8000:///etat")
    assert config.describe() == "« etat » sur socket local"
    assert not config.tls


@pytest.mark.parametrize("valeur", [AVEC_HOTE, AVEC_SOCKET, f"{BOUCLE}?application_name=board"])
def test_mot_de_passe_jamais_recopie(valeur: str) -> None:
    config = lire(valeur)
    for texte in (repr(config), str(config), config.describe(), f"{config}"):
        assert MOT_DE_PASSE not in texte
        assert valeur not in texte


def refus(valeur: str) -> str:
    with pytest.raises(ConfigError) as erreur:
        config_from_env({DATABASE_URL: valeur})
    message = str(erreur.value)
    assert DATABASE_URL in message
    assert MOT_DE_PASSE not in message
    assert valeur not in message
    # Aucune exception d'origine chaînée : elle recopierait l'adresse dans la trace.
    assert erreur.value.__cause__ is None
    assert erreur.value.__context__ is None or erreur.value.__suppress_context__
    return message


@pytest.mark.parametrize(
    ("valeur", "cause"),
    [
        ("pas une adresse", "illisible"),
        (f"://board:{MOT_DE_PASSE}@hote/etat", "illisible"),
        (f"postgresql://board:{MOT_DE_PASSE}@hote/etat", "postgresql+pg8000"),
        (f"postgresql+psycopg://board:{MOT_DE_PASSE}@hote/etat", "postgresql+pg8000"),
        (f"postgresql+psycopg2://board:{MOT_DE_PASSE}@hote/etat", "postgresql+pg8000"),
        ("sqlite:///etat.db", "postgresql+pg8000"),
        (f"mysql+pymysql://board:{MOT_DE_PASSE}@hote/etat", "postgresql+pg8000"),
        (f"postgresql+pg8000://board:{MOT_DE_PASSE}@hote", "nom de base"),
        (f"postgresql+pg8000://board:{MOT_DE_PASSE}@hote/", "nom de base"),
        (f"postgresql+pg8000://board:{MOT_DE_PASSE}@/?unix_sock={SOCKET}", "nom de base"),
    ],
)
def test_adresse_refusee(valeur: str, cause: str) -> None:
    assert cause in refus(valeur)


@pytest.mark.parametrize(
    "valeur",
    [
        "postgresql+pg8000://board@hote:abc/etat",
        "postgresql+pg8000://board:x@[::1/etat",
        # Mot de passe « pre@fix:Mdp-… » non encodé : la fin serait lue comme un port.
        f"postgresql+pg8000://board:pre@fix:{MOT_DE_PASSE}@hote/etat",
    ],
)
def test_port_illisible_refuse_sans_secret(valeur: str) -> None:
    assert "illisible" in refus(valeur)


@pytest.mark.parametrize(
    "valeur",
    [
        # Mot de passe « mot@<secret> » non encodé : sa fin serait lue comme l'hôte.
        f"postgresql+pg8000://board:mot@{MOT_DE_PASSE}@hote/etat?sslmode=verify-full",
        f"postgresql+pg8000://board:mot@{MOT_DE_PASSE}@localhost/etat",
        f"postgresql+pg8000://board:mot@{MOT_DE_PASSE}@/etat?unix_sock={SOCKET}",
    ],
)
def test_arobase_non_encode_refuse_sans_fragment(valeur: str) -> None:
    message = refus(valeur)
    assert "%40" in message
    assert "hote" not in message and "localhost" not in message


def test_arobase_encode_accepte() -> None:
    config = lire(f"postgresql+pg8000://board:mot%40{MOT_DE_PASSE}@localhost/etat")
    assert config.url.password == f"mot@{MOT_DE_PASSE}"
    assert config.url.host == "localhost"
    assert MOT_DE_PASSE not in config.describe() + repr(config)


def test_arobase_puis_barre_refuse_sans_fragment() -> None:
    valeur = "postgresql+pg8000://board:FragA@FragB/FragC@hote.example/etat?sslmode=verify-full"
    with pytest.raises(ConfigError, match="%40") as erreur:
        config_from_env({DATABASE_URL: valeur})
    for fragment in ("FragA", "FragB", "FragC"):
        assert fragment not in str(erreur.value)


# --- TLS vérifié hors de la boucle locale (P11) et options admises.


@pytest.mark.parametrize(
    "valeur",
    [
        f"postgresql+pg8000://board:{MOT_DE_PASSE}@db.example.invalid/etat",
        f"postgresql+pg8000://board:{MOT_DE_PASSE}@10.0.0.5:5432/etat",
        f"postgresql+pg8000://board:{MOT_DE_PASSE}@[2001:db8::1]/etat",
        f"postgresql+pg8000://board:{MOT_DE_PASSE}@db.example.invalid/etat?application_name=b",
        # Un socket ne dispense pas un hôte distant de TLS.
        f"postgresql+pg8000://board:{MOT_DE_PASSE}@db.example.invalid/etat?unix_sock={SOCKET}",
    ],
)
def test_hote_distant_sans_tls_refuse(valeur: str) -> None:
    assert "sslmode=verify-full" in refus(valeur)


@pytest.mark.parametrize(
    "mode", ["require", "disable", "prefer", "allow", "verify-ca", "VERIFY-FULL"]
)
@pytest.mark.parametrize("hote", ["db.example.invalid", "localhost"])
def test_seul_verify_full_admis(mode: str, hote: str) -> None:
    message = refus(f"postgresql+pg8000://board:{MOT_DE_PASSE}@{hote}/etat?sslmode={mode}")
    assert "verify-full" in message


@pytest.mark.parametrize(
    "valeur",
    [
        AVEC_HOTE,
        f"{BOUCLE}?sslmode=verify-full",
        f"postgresql+pg8000://board:{MOT_DE_PASSE}@/etat?unix_sock={SOCKET}&sslmode=verify-full",
    ],
)
def test_verify_full_active_tls(valeur: str) -> None:
    config = lire(valeur)
    assert config.tls
    # Option de libpq, inconnue de pg8000 : retirée de l'adresse gardée.
    assert "sslmode" not in config.url.query
    assert "sslmode" not in config.url.render_as_string(hide_password=False)


@pytest.mark.parametrize("hote", ["localhost", "127.0.0.1", "[::1]"])
def test_boucle_locale_sans_tls(hote: str) -> None:
    config = lire(f"postgresql+pg8000://board:{MOT_DE_PASSE}@{hote}:5433/etat")
    assert not config.tls
    assert config.url.host in {"localhost", "127.0.0.1", "::1"}


def test_application_name_admis() -> None:
    config = lire(f"{AVEC_SOCKET}&application_name=skifer-board")
    assert config.url.query["application_name"] == "skifer-board"
    assert not config.tls


@pytest.mark.parametrize(
    ("options", "noms"),
    [
        ("connect_timeout=5", ["connect_timeout"]),
        (f"password={MOT_DE_PASSE}", ["password"]),
        (
            f"options=-c%20x%3D{MOT_DE_PASSE}&target_session_attrs=any",
            ["options", "target_session_attrs"],
        ),
        (f"sslrootcert=/etc/{MOT_DE_PASSE}.pem&sslmode=verify-full", ["sslrootcert"]),
    ],
)
def test_options_inconnues_refusees(options: str, noms: list[str]) -> None:
    message = refus(f"{BOUCLE}?{options}")
    for nom in noms:
        assert nom in message
    # Seules les options refusées sont nommées, jamais leurs valeurs.
    assert "sslmode" not in message
    assert "/etc/" not in message and "-c" not in message


@pytest.mark.parametrize(
    "options",
    [
        f"unix_sock={SOCKET}&unix_sock=/tmp/autre",
        "application_name=a&application_name=b",
        "sslmode=verify-full&sslmode=verify-full",
    ],
)
def test_option_repetee_refusee(options: str) -> None:
    assert "répétée" in refus(f"postgresql+pg8000://board:{MOT_DE_PASSE}@/etat?{options}")
