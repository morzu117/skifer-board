"""Fournisseur OIDC local, clés éphémères et horloge déterministe."""

import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from skifer_board.identity import Http, OidcConfig, ProviderError, ProviderKeys

INSTANT = datetime(2026, 1, 15, 12, tzinfo=UTC)
MAINTENANT = INSTANT.timestamp()
NONCE = "nonce-factice-confidentiel"
SECRET = "secret-factice-ne-jamais-journaliser"


@dataclass
class Horloge:
    instant: datetime = INSTANT

    def __call__(self) -> datetime:
        return self.instant


@dataclass
class Cles:
    rsa: rsa.RSAPrivateKey
    ec: ec.EllipticCurvePrivateKey

    def jwk(self, algorithme: str) -> dict[str, Any]:
        if algorithme == "RS256":
            resultat = jwt.algorithms.RSAAlgorithm.to_jwk(self.rsa.public_key(), as_dict=True)
        else:
            resultat = jwt.algorithms.ECAlgorithm.to_jwk(self.ec.public_key(), as_dict=True)
        return {**resultat, "kid": algorithme, "alg": algorithme, "use": "sig"}

    def signer(self, claims: dict[str, Any], algorithme: str = "RS256") -> str:
        cle = self.rsa if algorithme == "RS256" else self.ec
        if "iss" in claims and not isinstance(claims["iss"], str):
            # jwt.encode refuse ce type avant signature : signer le JSON avec son API JWS.
            return jwt.api_jws.encode(
                json.dumps(claims).encode(), cle, algorithm=algorithme, headers={"kid": algorithme}
            )
        return jwt.encode(claims, cle, algorithm=algorithme, headers={"kid": algorithme})


class Fournisseur(Http):
    def __init__(self, config: OidcConfig, cles: Cles) -> None:
        self.document: dict[str, Any] = {
            "issuer": config.issuer,
            "authorization_endpoint": "https://id.example.invalid/authorize",
            "token_endpoint": "https://id.example.invalid/token",
            "jwks_uri": "https://id.example.invalid/jwks",
        }
        self.jwks: dict[str, Any] = {"keys": [cles.jwk("RS256"), cles.jwk("ES256")]}
        self.appels: list[str] = []
        self.erreur: ProviderError | None = None
        self.reponse: Mapping[str, Any] | None = None
        self.erreur_echange: ProviderError | None = None
        self.formulaires: list[tuple[str, dict[str, str]]] = []

    def get_json(self, url: str) -> Mapping[str, Any]:
        self.appels.append(url)
        if url.endswith("/.well-known/openid-configuration"):
            return self.document
        assert url == self.document["jwks_uri"]
        if self.erreur is not None:
            raise self.erreur
        return self.jwks

    def post_form(self, url: str, form: Mapping[str, str]) -> Mapping[str, Any]:
        self.formulaires.append((url, dict(form)))
        if self.erreur_echange is not None:
            raise self.erreur_echange
        assert self.reponse is not None, "Échange de code non configuré"
        return self.reponse


@pytest.fixture(scope="session")
def cles() -> Cles:
    return Cles(
        rsa.generate_private_key(public_exponent=65537, key_size=2048),
        ec.generate_private_key(ec.SECP256R1()),
    )


@pytest.fixture
def config() -> OidcConfig:
    return OidcConfig(
        "https://id.example.invalid",
        "board-test",
        SECRET,
        "https://board.example.invalid/auth/callback",
        "https://board.example.invalid",
    )


@pytest.fixture
def horloge() -> Horloge:
    return Horloge()


@pytest.fixture
def fournisseur(config: OidcConfig, cles: Cles) -> Fournisseur:
    return Fournisseur(config, cles)


@pytest.fixture
def trousse(config: OidcConfig, fournisseur: Fournisseur, horloge: Horloge) -> ProviderKeys:
    return ProviderKeys(config, fournisseur, horloge)


@pytest.fixture
def claims(config: OidcConfig) -> dict[str, Any]:
    return {
        "iss": config.issuer,
        "aud": config.client_id,
        "exp": MAINTENANT + 60,
        "iat": MAINTENANT - 60,
        "nonce": NONCE,
        "sub": "sujet-confidentiel",
        "name": "Nom confidentiel",
        "email": "personne@example.invalid",
        "groups": ["groupe-confidentiel", "lecteurs"],
    }
