"""Découverte du fournisseur et clés de signature (plan 06, I3 et I10).

L'accès HTTP passe par l'interface `Http`, injectée : les tests n'ouvrent aucune connexion.
"""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Protocol

from jwt import PyJWK, PyJWTError

from .config import ConfigError, OidcConfig, check_url

TIMEOUT_SECONDS = 10.0
# Relecture du JWKS sur `kid` inconnu : au plus une fois par minute, pour qu'un jeton
# forgé avec un `kid` au hasard ne fasse pas interroger le fournisseur à chaque requête.
JWKS_REFRESH_INTERVAL = timedelta(minutes=1)


class ProviderError(Exception):
    """Fournisseur injoignable, ou réponse hors contrat. Le message ne cite aucun secret."""


class Http(Protocol):
    def get_json(self, url: str) -> Mapping[str, Any]: ...

    def post_form(self, url: str, form: Mapping[str, str]) -> Mapping[str, Any]: ...


def _json_object(body: bytes, url: str) -> Mapping[str, Any]:
    try:
        value = json.loads(body)
    except ValueError as error:
        raise ProviderError(f"Réponse non JSON de {url}.") from error
    if not isinstance(value, dict):
        raise ProviderError(f"Réponse de {url} : objet JSON attendu.")
    return value


class UrllibHttp:
    """Accès HTTP du serveur au fournisseur, par la bibliothèque standard. Une erreur HTTP
    dont le corps est un objet JSON est rendue telle quelle : c'est la forme des refus du
    point de jeton (`{"error": …}`, RFC 6749 §5.2)."""

    def _send(self, request: urllib.request.Request) -> Mapping[str, Any]:
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                return _json_object(response.read(), request.full_url)
        except urllib.error.HTTPError as error:
            try:
                return _json_object(error.read(), request.full_url)
            except ProviderError:
                raise ProviderError(f"{request.full_url} : HTTP {error.code}.") from error
        except (urllib.error.URLError, TimeoutError) as error:
            raise ProviderError(f"{request.full_url} injoignable.") from error

    def get_json(self, url: str) -> Mapping[str, Any]:
        return self._send(urllib.request.Request(url, headers={"Accept": "application/json"}))

    def post_form(self, url: str, form: Mapping[str, str]) -> Mapping[str, Any]:
        data = urllib.parse.urlencode(form).encode()
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        }
        return self._send(urllib.request.Request(url, data=data, headers=headers, method="POST"))


@dataclass(frozen=True)
class ProviderMetadata:
    issuer: str
    authorization_endpoint: str
    token_endpoint: str
    jwks_uri: str
    end_session_endpoint: str | None


def _endpoint(document: Mapping[str, Any], name: str) -> str:
    value = document.get(name)
    if not isinstance(value, str):
        raise ProviderError(f"Découverte : `{name}` absent.")
    try:
        return check_url(name, value)
    except ConfigError as error:
        raise ProviderError(f"Découverte : {error}") from error


def discover(config: OidcConfig, http: Http) -> ProviderMetadata:
    url = f"{config.issuer.rstrip('/')}/.well-known/openid-configuration"
    document = http.get_json(url)
    # L'émetteur annoncé doit être exactement celui configuré (OpenID Connect Discovery, §4.3).
    if document.get("issuer") != config.issuer:
        raise ProviderError("Découverte : l'émetteur annoncé diffère de l'émetteur configuré.")
    end_session = document.get("end_session_endpoint")
    return ProviderMetadata(
        issuer=config.issuer,
        authorization_endpoint=_endpoint(document, "authorization_endpoint"),
        token_endpoint=_endpoint(document, "token_endpoint"),
        jwks_uri=_endpoint(document, "jwks_uri"),
        end_session_endpoint=(
            _endpoint(document, "end_session_endpoint") if end_session is not None else None
        ),
    )


def _signing_keys(document: Mapping[str, Any]) -> dict[str, PyJWK]:
    """Clés de signature du JWKS, par `kid`. Une clé sans `kid` ou illisible est ignorée."""
    entries = document.get("keys")
    if not isinstance(entries, list):
        raise ProviderError("JWKS : liste `keys` absente.")
    keys: dict[str, PyJWK] = {}
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("kid"), str):
            continue
        if entry.get("use", "sig") != "sig":
            continue
        try:
            keys[entry["kid"]] = PyJWK.from_dict(entry)
        except (PyJWTError, ValueError):
            continue
    return keys


class ProviderKeys:
    """Métadonnées et clés du fournisseur, lues à la première demande puis gardées."""

    def __init__(self, config: OidcConfig, http: Http, clock: Callable[[], datetime]) -> None:
        self._config, self._http, self._clock = config, http, clock
        self._lock = threading.Lock()
        self._metadata: ProviderMetadata | None = None
        self._keys: dict[str, PyJWK] = {}
        self._fetched_at: datetime | None = None

    def metadata(self) -> ProviderMetadata:
        with self._lock:
            if self._metadata is None:
                self._metadata = discover(self._config, self._http)
            return self._metadata

    def key_for(self, kid: str) -> PyJWK | None:
        """Clé du `kid`, avec une relecture du JWKS s'il est inconnu (rotation, I3)."""
        metadata = self.metadata()
        with self._lock:
            if kid in self._keys:
                return self._keys[kid]
            now = self._clock()
            if self._fetched_at is not None and now - self._fetched_at < JWKS_REFRESH_INTERVAL:
                return None
            self._keys = _signing_keys(self._http.get_json(metadata.jwks_uri))
            self._fetched_at = now
            return self._keys.get(kid)
