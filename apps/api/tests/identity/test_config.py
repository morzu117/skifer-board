"""Démarrage fail-closed et configuration sans exposition du secret client."""

from datetime import timedelta

import pytest
from skifer_board.identity import ConfigError, config_from_env
from skifer_board.identity.config import (
    CLIENT_ID,
    CLIENT_SECRET,
    GROUPS_CLAIM,
    ISSUER,
    PUBLIC_ORIGIN,
    REDIRECT_URI,
    REQUIRED,
    SESSION_HOURS,
    SESSION_IDLE_MINUTES,
)

from .conftest import SECRET


@pytest.fixture
def environnement() -> dict[str, str]:
    return {
        ISSUER: "https://id.example.invalid",
        CLIENT_ID: "board-test",
        CLIENT_SECRET: SECRET,
        PUBLIC_ORIGIN: "https://board.example.invalid",
        REDIRECT_URI: "https://board.example.invalid/auth/callback",
    }


def test_sans_configuration() -> None:
    assert config_from_env({}) is None
    assert config_from_env({"VARIABLE_SANS_RAPPORT": "oui"}) is None


@pytest.mark.parametrize("variable", REQUIRED)
def test_variable_obligatoire_absente(variable: str, environnement: dict[str, str]) -> None:
    del environnement[variable]
    with pytest.raises(ConfigError, match=variable) as erreur:
        config_from_env(environnement)
    assert SECRET not in str(erreur.value)


@pytest.mark.parametrize("variable", [GROUPS_CLAIM, SESSION_HOURS, SESSION_IDLE_MINUTES])
def test_option_seule_ne_replie_pas_en_local(variable: str) -> None:
    with pytest.raises(ConfigError) as erreur:
        config_from_env({variable: "1"})
    for requise in REQUIRED:
        assert requise in str(erreur.value)


@pytest.mark.parametrize("variable", [ISSUER, PUBLIC_ORIGIN, REDIRECT_URI])
@pytest.mark.parametrize(
    "adresse",
    [
        "http://distant.example.invalid",
        "relative",
        "ftp://id.invalid",
        "https:///sans-hote",
        "https://identifiant@id.invalid",
        "https://:mot-de-passe@id.invalid",
        "https://id.invalid/#fragment",
    ],
)
def test_adresse_refusee(variable: str, adresse: str, environnement: dict[str, str]) -> None:
    environnement[variable] = adresse
    with pytest.raises(ConfigError, match=variable) as erreur:
        config_from_env(environnement)
    assert SECRET not in str(erreur.value)
    assert adresse not in str(erreur.value)


@pytest.mark.parametrize("hote", ["localhost", "127.0.0.1", "[::1]"])
def test_http_local_admis(hote: str, environnement: dict[str, str]) -> None:
    environnement.update(
        {
            ISSUER: f"http://{hote}:9000/oidc",
            PUBLIC_ORIGIN: f"http://{hote}:8000",
            REDIRECT_URI: f"http://{hote}:8000/auth/callback",
        }
    )
    config = config_from_env(environnement)
    assert config is not None
    assert config.issuer == environnement[ISSUER]
    assert config.public_origin == environnement[PUBLIC_ORIGIN]


@pytest.mark.parametrize("suffixe", ["/chemin", "?requete=1"])
def test_origine_seule(suffixe: str, environnement: dict[str, str]) -> None:
    environnement[PUBLIC_ORIGIN] += suffixe
    with pytest.raises(ConfigError, match=PUBLIC_ORIGIN):
        config_from_env(environnement)


@pytest.mark.parametrize(
    "retour",
    [
        "https://autre.invalid/auth",
        "https://board.example.invalid.evil/auth",
        "https://board.example.invalid:444/auth",
    ],
)
def test_retour_hors_origine(retour: str, environnement: dict[str, str]) -> None:
    environnement[REDIRECT_URI] = retour
    with pytest.raises(ConfigError, match=REDIRECT_URI):
        config_from_env(environnement)


def test_defauts_et_secret_cache(environnement: dict[str, str]) -> None:
    environnement[PUBLIC_ORIGIN] += "/"
    config = config_from_env(environnement)
    assert config is not None
    assert config.public_origin == "https://board.example.invalid"
    assert config.session_absolute == timedelta(hours=8)
    assert config.session_idle == timedelta(minutes=30)
    assert config.groups_claim == "groups"
    assert SECRET not in repr(config)
    assert SECRET not in str(config)


def test_options_configurees(environnement: dict[str, str]) -> None:
    environnement.update({SESSION_HOURS: "12", SESSION_IDLE_MINUTES: "45", GROUPS_CLAIM: "equipes"})
    config = config_from_env(environnement)
    assert config is not None
    assert config.session_absolute == timedelta(hours=12)
    assert config.session_idle == timedelta(minutes=45)
    assert config.groups_claim == "equipes"


@pytest.mark.parametrize("variable", [SESSION_HOURS, SESSION_IDLE_MINUTES])
@pytest.mark.parametrize("valeur", ["1.5", "texte", "0", "-1", "１２", "١", " 2", "+2"])
def test_duree_invalide(variable: str, valeur: str, environnement: dict[str, str]) -> None:
    environnement[variable] = valeur
    with pytest.raises(ConfigError, match=variable) as erreur:
        config_from_env(environnement)
    assert SECRET not in str(erreur.value)
