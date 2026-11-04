"""Contrat I2 : identité exacte ou refus fermé, sans fuite de valeurs."""

import json
from dataclasses import replace
from typing import Any

import jwt
import pytest
from hypothesis import given
from hypothesis import strategies as st
from jwt.utils import base64url_decode, base64url_encode
from skifer_board.identity import (
    Identity,
    OidcConfig,
    ProviderKeys,
    Refusal,
    RefusalCode,
    verify_id_token,
)

from .conftest import MAINTENANT, NONCE, SECRET, Cles, Fournisseur, Horloge


def verifier(
    token: str, config: OidcConfig, trousse: ProviderKeys, horloge: Horloge
) -> Identity | Refusal:
    return verify_id_token(token, nonce=NONCE, config=config, keys=trousse, clock=horloge)


def refus(resultat: Identity | Refusal, code: RefusalCode, detail: str, token: str) -> None:
    assert resultat == Refusal(code, detail)
    for sensible in (
        token,
        SECRET,
        NONCE,
        "sujet-confidentiel",
        "Nom confidentiel",
        "personne@example.invalid",
        "groupe-confidentiel",
        "valeur-confidentielle",
    ):
        assert sensible not in repr(resultat)
        assert sensible not in str(resultat)


@pytest.mark.parametrize("algorithme", ["RS256", "ES256"])
def test_identite_exacte(
    algorithme: str,
    cles: Cles,
    claims: dict[str, Any],
    config: OidcConfig,
    trousse: ProviderKeys,
    horloge: Horloge,
) -> None:
    assert verifier(cles.signer(claims, algorithme), config, trousse, horloge) == Identity(
        config.issuer,
        "sujet-confidentiel",
        "Nom confidentiel",
        "personne@example.invalid",
        ("groupe-confidentiel", "lecteurs"),
    )


@pytest.mark.parametrize(
    ("claim", "valeur", "code"),
    [
        ("iss", 42, RefusalCode.INVALID_CLAIM),
        ("iss", "valeur-confidentielle", RefusalCode.WRONG_ISSUER),
        ("iss", "https://id.example.invalid/", RefusalCode.WRONG_ISSUER),
        ("aud", "", RefusalCode.WRONG_AUDIENCE),
        ("aud", [], RefusalCode.INVALID_CLAIM),
        ("aud", ["board-test", 42], RefusalCode.INVALID_CLAIM),
        ("aud", 42, RefusalCode.INVALID_CLAIM),
        ("aud", "valeur-confidentielle", RefusalCode.WRONG_AUDIENCE),
        ("aud", ["valeur-confidentielle"], RefusalCode.WRONG_AUDIENCE),
        ("azp", "valeur-confidentielle", RefusalCode.WRONG_AUTHORIZED_PARTY),
        ("azp", 42, RefusalCode.INVALID_CLAIM),
        ("exp", True, RefusalCode.INVALID_CLAIM),
        ("exp", "valeur-confidentielle", RefusalCode.INVALID_CLAIM),
        ("exp", MAINTENANT, RefusalCode.EXPIRED),
        ("exp", MAINTENANT - 1, RefusalCode.EXPIRED),
        ("iat", False, RefusalCode.INVALID_CLAIM),
        ("iat", "valeur-confidentielle", RefusalCode.INVALID_CLAIM),
        ("nbf", MAINTENANT + 1, RefusalCode.NOT_YET_VALID),
        ("nbf", True, RefusalCode.INVALID_CLAIM),
        ("nbf", "valeur-confidentielle", RefusalCode.INVALID_CLAIM),
        ("nonce", 42, RefusalCode.INVALID_CLAIM),
        ("nonce", "valeur-confidentielle", RefusalCode.NONCE_MISMATCH),
        ("sub", "", RefusalCode.INVALID_CLAIM),
        ("sub", 42, RefusalCode.INVALID_CLAIM),
        ("name", 42, RefusalCode.INVALID_CLAIM),
        ("email", [], RefusalCode.INVALID_CLAIM),
        ("groups", "valeur-confidentielle", RefusalCode.INVALID_CLAIM),
        ("groups", ["lecteurs", 42], RefusalCode.INVALID_CLAIM),
    ],
)
def test_claim_refuse(
    claim: str,
    valeur: object,
    code: RefusalCode,
    claims: dict[str, Any],
    cles: Cles,
    config: OidcConfig,
    trousse: ProviderKeys,
    horloge: Horloge,
) -> None:
    claims[claim] = valeur
    token = cles.signer(claims)
    refus(verifier(token, config, trousse, horloge), code, claim, token)


@pytest.mark.parametrize("claim", ["iss", "aud", "exp", "iat", "nonce", "sub"])
def test_claim_obligatoire_absent(
    claim: str,
    claims: dict[str, Any],
    cles: Cles,
    config: OidcConfig,
    trousse: ProviderKeys,
    horloge: Horloge,
) -> None:
    del claims[claim]
    token = cles.signer(claims)
    refus(verifier(token, config, trousse, horloge), RefusalCode.MISSING_CLAIM, claim, token)


@pytest.mark.parametrize("azp", [None, "valeur-confidentielle", 42, "board-test"])
def test_audiences_multiples(
    azp: object,
    claims: dict[str, Any],
    cles: Cles,
    config: OidcConfig,
    trousse: ProviderKeys,
    horloge: Horloge,
) -> None:
    claims["aud"] = [config.client_id, "autre-client"]
    if azp is not None:
        claims["azp"] = azp
    token = cles.signer(claims)
    resultat = verifier(token, config, trousse, horloge)
    if azp == config.client_id:
        assert isinstance(resultat, Identity)
    else:
        code = (
            RefusalCode.MISSING_CLAIM
            if azp is None
            else RefusalCode.INVALID_CLAIM
            if isinstance(azp, int)
            else RefusalCode.WRONG_AUTHORIZED_PARTY
        )
        refus(resultat, code, "azp", token)


@pytest.mark.parametrize("nbf", [MAINTENANT - 1, MAINTENANT, MAINTENANT - 0.5])
def test_dates_valides_et_audience_unique(
    nbf: float,
    claims: dict[str, Any],
    cles: Cles,
    config: OidcConfig,
    trousse: ProviderKeys,
    horloge: Horloge,
) -> None:
    claims.update(exp=MAINTENANT + 1, iat=MAINTENANT - 0.5, nbf=nbf, azp=config.client_id)
    assert isinstance(verifier(cles.signer(claims), config, trousse, horloge), Identity)


def test_groupes_renommes_et_options_absentes(
    claims: dict[str, Any], cles: Cles, config: OidcConfig, trousse: ProviderKeys, horloge: Horloge
) -> None:
    config = replace(config, groups_claim="equipes")
    claims["equipes"] = claims.pop("groups")
    del claims["name"], claims["email"]
    assert verifier(cles.signer(claims), config, trousse, horloge) == Identity(
        config.issuer, "sujet-confidentiel", None, None, ("groupe-confidentiel", "lecteurs")
    )
    del claims["equipes"]
    assert verifier(cles.signer(claims), config, trousse, horloge) == Identity(
        config.issuer, "sujet-confidentiel", None, None, ()
    )
    claims["equipes"] = 42
    token = cles.signer(claims)
    refus(verifier(token, config, trousse, horloge), RefusalCode.INVALID_CLAIM, "equipes", token)


def entete(token: str, valeurs: dict[str, object]) -> str:
    morceaux = token.split(".")
    morceaux[0] = base64url_encode(json.dumps(valeurs).encode()).decode()
    return ".".join(morceaux)


@pytest.mark.parametrize(
    ("header", "code", "detail"),
    [
        ({"alg": "none"}, RefusalCode.UNSUPPORTED_ALGORITHM, "alg"),
        ({"alg": "HS256"}, RefusalCode.UNSUPPORTED_ALGORITHM, "alg"),
        ({"alg": "PS256"}, RefusalCode.UNSUPPORTED_ALGORITHM, "alg"),
        ({}, RefusalCode.UNSUPPORTED_ALGORITHM, "alg"),
        ({"alg": "RS256"}, RefusalCode.UNKNOWN_KEY, "kid"),
        ({"alg": "RS256", "kid": 42}, RefusalCode.UNKNOWN_KEY, "kid"),
        ({"alg": "RS256", "kid": "inconnu"}, RefusalCode.UNKNOWN_KEY, "kid"),
        ({"alg": "ES256", "kid": "RS256"}, RefusalCode.UNSUPPORTED_ALGORITHM, "alg"),
        ({"alg": "RS256", "kid": "ES256"}, RefusalCode.UNSUPPORTED_ALGORITHM, "alg"),
    ],
)
def test_entetes_refuses(
    header: dict[str, object],
    code: RefusalCode,
    detail: str,
    claims: dict[str, Any],
    cles: Cles,
    config: OidcConfig,
    trousse: ProviderKeys,
    horloge: Horloge,
) -> None:
    token = entete(cles.signer(claims), header)
    refus(verifier(token, config, trousse, horloge), code, detail, token)


def test_entete_illisible(config: OidcConfig, trousse: ProviderKeys, horloge: Horloge) -> None:
    token = "jeton-confidentiel-illisible"
    refus(verifier(token, config, trousse, horloge), RefusalCode.MALFORMED_TOKEN, "header", token)


def test_charge_illisible_signee(
    cles: Cles, config: OidcConfig, trousse: ProviderKeys, horloge: Horloge
) -> None:
    token = jwt.api_jws.encode(
        b"pas du JSON confidentiel", cles.rsa, algorithm="RS256", headers={"kid": "RS256"}
    )
    refus(verifier(token, config, trousse, horloge), RefusalCode.MALFORMED_TOKEN, "payload", token)


def test_algorithme_declare_par_jwks(
    claims: dict[str, Any],
    cles: Cles,
    config: OidcConfig,
    fournisseur: Fournisseur,
    trousse: ProviderKeys,
    horloge: Horloge,
) -> None:
    fournisseur.jwks = {"keys": [{**cles.jwk("RS256"), "alg": "RS384"}]}
    token = cles.signer(claims)
    refus(
        verifier(token, config, trousse, horloge), RefusalCode.UNSUPPORTED_ALGORITHM, "alg", token
    )


def test_propriete_signature_alteree(
    cles: Cles, claims: dict[str, Any], config: OidcConfig, trousse: ProviderKeys, horloge: Horloge
) -> None:
    """Chaque octet choisi et chaque masque non nul invalident la signature."""
    token = cles.signer(claims)

    @given(index=st.integers(0, 255), masque=st.integers(1, 255))
    def propriete(index: int, masque: int) -> None:
        morceaux = token.split(".")
        signature = bytearray(base64url_decode(morceaux[2].encode()))
        signature[index] ^= masque
        morceaux[2] = base64url_encode(bytes(signature)).decode()
        altere = ".".join(morceaux)
        refus(
            verifier(altere, config, trousse, horloge),
            RefusalCode.INVALID_SIGNATURE,
            "signature",
            altere,
        )

    propriete()


@pytest.mark.parametrize("alg", [[], {}])
def test_algorithme_non_textuel(
    alg: object,
    claims: dict[str, Any],
    cles: Cles,
    config: OidcConfig,
    trousse: ProviderKeys,
    horloge: Horloge,
) -> None:
    token = entete(cles.signer(claims), {"alg": alg, "kid": "RS256"})
    refus(
        verifier(token, config, trousse, horloge), RefusalCode.UNSUPPORTED_ALGORITHM, "alg", token
    )


def test_expiration_non_finie(
    claims: dict[str, Any], cles: Cles, config: OidcConfig, trousse: ProviderKeys, horloge: Horloge
) -> None:
    claims["exp"] = float("nan")
    token = cles.signer(claims)
    refus(verifier(token, config, trousse, horloge), RefusalCode.INVALID_CLAIM, "exp", token)
