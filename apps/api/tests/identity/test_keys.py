"""Découverte, rotation bornée et transport HTTP intégralement simulé."""

import io
import urllib.error
import urllib.request
from datetime import timedelta
from email.message import Message
from typing import Any
from urllib.parse import parse_qs

import pytest
from skifer_board.identity import (
    OidcConfig,
    ProviderError,
    ProviderKeys,
    ProviderMetadata,
    Refusal,
    RefusalCode,
    UrllibHttp,
    discover,
)

from .conftest import NONCE, SECRET, Cles, Fournisseur, Horloge
from .test_verify import verifier


def test_rotation_et_cache(
    cles: Cles,
    claims: dict[str, Any],
    config: OidcConfig,
    fournisseur: Fournisseur,
    trousse: ProviderKeys,
    horloge: Horloge,
) -> None:
    assert trousse.key_for("RS256") is not None
    assert trousse.key_for("RS256") is not None
    assert len(fournisseur.appels) == 2
    horloge.instant += timedelta(minutes=1)
    fournisseur.jwks = {"keys": [{**cles.jwk("RS256"), "kid": "rotation"}]}
    claims["exp"] = horloge.instant.timestamp() + 300
    token = jwt_rotation(cles, claims, "rotation")
    assert not isinstance(verifier(token, config, trousse, horloge), Refusal)
    assert len(fournisseur.appels) == 3
    token = jwt_rotation(cles, claims, "inconnu")
    assert verifier(token, config, trousse, horloge) == Refusal(RefusalCode.UNKNOWN_KEY, "kid")
    assert len(fournisseur.appels) == 3
    horloge.instant += timedelta(seconds=59)
    assert trousse.key_for("encore-inconnu") is None
    assert len(fournisseur.appels) == 3
    horloge.instant += timedelta(seconds=1)
    assert trousse.key_for("inconnu") is None
    assert len(fournisseur.appels) == 4
    assert fournisseur.appels.count(config.issuer + "/.well-known/openid-configuration") == 1


def jwt_rotation(cles: Cles, claims: dict[str, Any], kid: str) -> str:
    import jwt

    return jwt.encode(claims, cles.rsa, algorithm="RS256", headers={"kid": kid})


def test_cles_ignorees(cles: Cles, fournisseur: Fournisseur, trousse: ProviderKeys) -> None:
    sans_kid = cles.jwk("RS256")
    del sans_kid["kid"]
    fournisseur.jwks = {
        "keys": [
            sans_kid,
            {**cles.jwk("RS256"), "kid": 42},
            {**cles.jwk("RS256"), "kid": "chiffrement", "use": "enc"},
            {"kid": "illisible", "kty": "RSA", "alg": "inconnu"},
            "non-objet",
            cles.jwk("ES256"),
        ]
    }
    assert trousse.key_for("ES256") is not None
    for kid in ("RS256", "chiffrement", "illisible", "42"):
        assert trousse.key_for(kid) is None
    assert len(fournisseur.appels) == 2


@pytest.mark.parametrize("document", [{}, {"keys": None}, {"keys": "invalide"}])
def test_jwks_sans_liste(
    document: dict[str, Any],
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
    config: OidcConfig,
    trousse: ProviderKeys,
    horloge: Horloge,
) -> None:
    fournisseur.jwks = document
    assert verifier(cles.signer(claims), config, trousse, horloge) == Refusal(
        RefusalCode.PROVIDER_UNAVAILABLE, "jwks"
    )


def test_jwks_injoignable(
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
    config: OidcConfig,
    trousse: ProviderKeys,
    horloge: Horloge,
) -> None:
    token = cles.signer(claims)
    fournisseur.erreur = ProviderError(f"Erreur interne confidentielle {token} {SECRET} {NONCE}")
    resultat = verifier(token, config, trousse, horloge)
    assert resultat == Refusal(RefusalCode.PROVIDER_UNAVAILABLE, "jwks")
    for sensible in (token, SECRET, NONCE):
        assert sensible not in repr(resultat)


@pytest.mark.parametrize("fin_session", [False, True])
def test_decouverte_et_cache(
    fin_session: bool, config: OidcConfig, fournisseur: Fournisseur, trousse: ProviderKeys
) -> None:
    fin = "https://id.example.invalid/logout" if fin_session else None
    if fin is not None:
        fournisseur.document["end_session_endpoint"] = fin
    attendu = ProviderMetadata(
        config.issuer,
        "https://id.example.invalid/authorize",
        "https://id.example.invalid/token",
        "https://id.example.invalid/jwks",
        fin,
    )
    assert trousse.metadata() == attendu
    assert trousse.metadata() == attendu
    assert len(fournisseur.appels) == 1


def test_decouverte_sans_double_barre(config: OidcConfig, fournisseur: Fournisseur) -> None:
    from dataclasses import replace

    config = replace(config, issuer=config.issuer + "/")
    fournisseur.document["issuer"] = config.issuer
    assert discover(config, fournisseur).issuer == config.issuer
    assert fournisseur.appels == ["https://id.example.invalid/.well-known/openid-configuration"]


def test_emetteur_decouvert_different(config: OidcConfig, fournisseur: Fournisseur) -> None:
    fournisseur.document["issuer"] = config.issuer + "/"
    with pytest.raises(ProviderError, match="l'émetteur annoncé diffère"):
        discover(config, fournisseur)


@pytest.mark.parametrize(
    "point", ["authorization_endpoint", "token_endpoint", "jwks_uri", "end_session_endpoint"]
)
@pytest.mark.parametrize("valeur", [42, "http://distant.example.invalid/point"])
def test_point_invalide(
    point: str, valeur: object, config: OidcConfig, fournisseur: Fournisseur
) -> None:
    fournisseur.document[point] = valeur
    with pytest.raises(ProviderError, match=point):
        discover(config, fournisseur)


@pytest.mark.parametrize("point", ["authorization_endpoint", "token_endpoint", "jwks_uri"])
def test_point_absent(point: str, config: OidcConfig, fournisseur: Fournisseur) -> None:
    del fournisseur.document[point]
    with pytest.raises(ProviderError, match=f"`{point}` absent"):
        discover(config, fournisseur)


@pytest.mark.parametrize("methode", ["GET", "POST"])
def test_transport_requete(methode: str, monkeypatch: pytest.MonkeyPatch) -> None:
    appels: list[urllib.request.Request] = []

    def ouvrir(request: urllib.request.Request, *, timeout: float) -> io.BytesIO:
        appels.append(request)
        assert timeout == 10.0
        assert request.full_url == "https://id.example.invalid/token"
        assert request.get_method() == methode
        assert request.get_header("Accept") == "application/json"
        if methode == "POST":
            assert request.get_header("Content-type") == "application/x-www-form-urlencoded"
            assert isinstance(request.data, bytes)
            assert parse_qs(request.data.decode()) == {
                "client_secret": [SECRET],
                "code": ["a +&é="],
            }
            assert request.data == b"client_secret=" + SECRET.encode() + b"&code=a+%2B%26%C3%A9%3D"
        else:
            assert request.data is None
        return io.BytesIO(b'{"ok": true}')

    monkeypatch.setattr(urllib.request, "urlopen", ouvrir)
    http = UrllibHttp()
    resultat = (
        http.get_json("https://id.example.invalid/token")
        if methode == "GET"
        else http.post_form(
            "https://id.example.invalid/token", {"client_secret": SECRET, "code": "a +&é="}
        )
    )
    assert resultat == {"ok": True}
    assert len(appels) == 1


@pytest.mark.parametrize(
    ("cas", "message"),
    [
        ("non-json", "Réponse non JSON"),
        ("liste", "objet JSON attendu"),
        ("http-json", None),
        ("http-texte", "HTTP 503"),
        ("url", "injoignable"),
        ("timeout", "injoignable"),
    ],
)
def test_transport_reponses_et_erreurs(
    cas: str, message: str | None, monkeypatch: pytest.MonkeyPatch
) -> None:
    sensible = f"{SECRET} {NONCE} jeton-confidentiel"

    def ouvrir(request: urllib.request.Request, *, timeout: float) -> io.BytesIO:
        assert timeout == 10.0
        if cas.startswith("http"):
            corps = b'{"error": "invalid_grant"}' if cas == "http-json" else sensible.encode()
            raise urllib.error.HTTPError(
                request.full_url, 503, sensible, Message(), io.BytesIO(corps)
            )
        if cas == "url":
            raise urllib.error.URLError(sensible)
        if cas == "timeout":
            raise TimeoutError(sensible)
        return io.BytesIO(b"[]" if cas == "liste" else sensible.encode())

    monkeypatch.setattr(urllib.request, "urlopen", ouvrir)
    if message is None:
        assert UrllibHttp().post_form("https://id.example.invalid/token", {}) == {
            "error": "invalid_grant"
        }
    else:
        with pytest.raises(ProviderError, match=message) as erreur:
            UrllibHttp().get_json("https://id.example.invalid/jwks")
        for valeur in (SECRET, NONCE, "jeton-confidentiel"):
            assert valeur not in str(erreur.value)
            assert valeur not in repr(erreur.value)


@pytest.mark.parametrize(
    "entree", [{"kid": "illisible", "kty": "inconnu"}, {"kid": "illisible", "kty": "RSA"}]
)
def test_jwk_malformee_ignoree(
    entree: dict[str, str], cles: Cles, fournisseur: Fournisseur, trousse: ProviderKeys
) -> None:
    fournisseur.jwks = {"keys": [entree, cles.jwk("RS256")]}
    assert trousse.key_for("RS256") is not None
    assert trousse.key_for("illisible") is None
