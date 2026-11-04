"""PKCE, réponses Databricks et coffre personnel (plan 15.1), sans réseau."""

from __future__ import annotations

import base64
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from email.message import Message
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request

import pytest
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from skifer_board.execution import oauth
from skifer_board.execution.connectors import MAX_RESPONSE, HttpResponse
from skifer_board.execution.oauth import (
    OAuthConfig,
    OAuthConfigError,
    OAuthError,
    OAuthFormTransport,
    Tokens,
    authorization,
    exchange,
    response_object,
    validate_client_id,
    warehouses,
)
from skifer_board.execution.oauth_store import OAuthStore, _aad
from skifer_board.execution.vault import VaultError, VaultKeys
from skifer_board.spaces.model import PersonRef
from skifer_board.state.schema import databricks_oauth as table
from spaces.monde import ADMIN_GROUPE, A, B, Monde
from spaces.monde import config_plateforme as config_plateforme
from spaces.monde import monde as monde
from sqlalchemy import select
from state.conftest import migre as migre

HOST = "https://adb-123.2.azuredatabricks.net"
CONFIG = OAuthConfig("board-client", "https://board.example.invalid")
KEYS = VaultKeys("key", {"key": b"1" * 32})
PERSON = ADMIN_GROUPE.ref
OTHER = PersonRef("https://id.example.invalid", "other")


def response(
    value: object, status: int = 200, content_type: str = "application/json"
) -> HttpResponse:
    return HttpResponse(status, json.dumps(value).encode(), content_type)


class Forms:
    def __init__(self, result: HttpResponse | None = None) -> None:
        self.calls: list[tuple[str, dict[str, str]]] = []
        self.result = result or response(
            {
                "access_token": "access-sentinel",
                "refresh_token": "refresh-sentinel",
                "token_type": "Bearer",
                "expires_in": 3600,
            }
        )

    def post(self, url: str, fields: dict[str, str]) -> HttpResponse:
        self.calls.append((url, fields))
        return self.result


class Http:
    def __init__(self, result: HttpResponse) -> None:
        self.result = result
        self.calls: list[tuple[str, str]] = []

    def get(self, url: str, token: str) -> HttpResponse:
        self.calls.append((url, token))
        return self.result

    def post(self, url: str, token: str, body: dict[str, object]) -> HttpResponse:
        raise AssertionError("Aucun statement")


def test_configuration_et_pkce() -> None:
    assert validate_client_id(None) is None
    assert validate_client_id("client._-1") == "client._-1"
    for value in ("", "bad secret", "x" * 256):
        with pytest.raises(OAuthConfigError, match=oauth.CLIENT_VARIABLE):
            validate_client_id(value)
    url = authorization(CONFIG, HOST, "state", "verifier")
    params = parse_qs(urlsplit(url).query)
    assert url.startswith(HOST + "/oidc/v1/authorize?")
    assert params["redirect_uri"] == [CONFIG.callback]
    assert params["client_id"] == ["board-client"]
    assert params["scope"] == ["sql offline_access"]
    assert params["code_challenge_method"] == ["S256"]
    assert params["code_challenge"] == [
        base64.urlsafe_b64encode(hashlib.sha256(b"verifier").digest()).rstrip(b"=").decode()
    ]
    assert "verifier" not in url


@pytest.mark.parametrize(
    "value,code",
    [
        (HttpResponse(200, b"{", "application/json"), "oauth_invalid_response"),
        (HttpResponse(200, b"\xff", "application/json"), "oauth_invalid_response"),
        (response([]), "oauth_invalid_response"),
        (response({}, content_type="text/html"), "oauth_invalid_response"),
        (
            HttpResponse(200, b"x" * (MAX_RESPONSE + 1), "application/json"),
            "oauth_invalid_response",
        ),
        (response({}, 400), "oauth_refused"),
        (response({}, 401), "oauth_refused"),
        (response({}, 403), "oauth_refused"),
        (response({}, 302), "oauth_unavailable"),
        (response({}, 503), "oauth_unavailable"),
    ],
)
def test_reponses_refusees(value: HttpResponse, code: str) -> None:
    with pytest.raises(OAuthError) as error:
        response_object(value)
    assert error.value.code == code


def test_echange_et_refresh(monde: Monde) -> None:
    transport = Forms()
    now = monde.horloge()
    tokens = exchange(
        CONFIG,
        HOST,
        {"grant_type": "authorization_code", "code": "code-sentinel", "code_verifier": "verifier"},
        now,
        transport,
    )
    assert tokens == Tokens("access-sentinel", "refresh-sentinel", now + timedelta(hours=1))
    assert "sentinel" not in repr(tokens)
    assert transport.calls[0][0] == HOST + "/oidc/v1/token"
    assert transport.calls[0][1]["client_id"] == CONFIG.client_id
    assert transport.calls[0][1]["scope"] == "sql offline_access"
    transport.result = response(
        {"access_token": "new-access", "token_type": "bearer", "expires_in": 3600}
    )
    renewed = exchange(
        CONFIG,
        HOST,
        {"grant_type": "refresh_token", "refresh_token": tokens.refresh},
        now,
        transport,
        tokens.refresh,
    )
    assert renewed.refresh == tokens.refresh
    assert renewed.payload()["access"] == "new-access"


@pytest.mark.parametrize(
    "change",
    [
        {"access_token": None},
        {"access_token": ""},
        {"access_token": "x" * 16385},
        {"refresh_token": None},
        {"refresh_token": ""},
        {"refresh_token": "x" * 16385},
        {"expires_in": True},
        {"expires_in": 0},
        {"expires_in": 86401},
        {"token_type": "other"},
    ],
)
def test_jetons_hors_contrat(change: dict[str, object], monde: Monde) -> None:
    value = {
        "access_token": "access",
        "refresh_token": "refresh",
        "expires_in": 3600,
        "token_type": "Bearer",
        **change,
    }
    with pytest.raises(OAuthError, match="oauth_invalid_response"):
        exchange(CONFIG, HOST, {}, monde.horloge(), Forms(response(value)))


def test_liste_warehouses() -> None:
    transport = Http(
        response(
            {
                "warehouses": [
                    {"id": "b", "name": "Zulu", "state": "STOPPED"},
                    {"id": "a", "name": "Alpha", "state": "RUNNING"},
                ]
            }
        )
    )
    assert [x["id"] for x in warehouses(HOST, "access", transport)] == ["a", "b"]
    assert transport.calls == [(HOST + "/api/2.0/sql/warehouses", "access")]
    assert warehouses(HOST, "access", Http(response({"warehouses": []}))) == []


@pytest.mark.parametrize(
    "items",
    [
        None,
        {},
        [None],
        [{"id": "a", "name": "Alpha", "state": "RUNNING"}] * 2,
        [{"id": "bad/id", "name": "A", "state": "RUNNING"}],
        [{"id": "a", "name": 3, "state": "RUNNING"}],
        [{"id": "a", "name": " ", "state": "RUNNING"}],
        [{"id": "a", "name": "A", "state": 3}],
        [{"id": "a", "name": "A", "state": "INVALID"}],
        [None] * 5001,
    ],
)
def test_warehouses_hors_contrat(items: object) -> None:
    with pytest.raises(OAuthError, match="oauth_invalid_response"):
        warehouses(HOST, "secret", Http(response({"warehouses": items})))


def test_transport_formulaire_tls_et_erreurs(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[Request] = []

    class Result:
        status = 200
        headers = Message()
        headers["Content-Type"] = "application/json"

        def __enter__(self) -> Result:
            return self

        def __exit__(self, *args: object) -> None:
            pass

        def read(self, limit: int) -> bytes:
            assert limit == MAX_RESPONSE + 1
            return b"{}"

    class Opener:
        error: Exception | None = None

        def open(self, request: Request, timeout: int) -> Result:
            assert timeout == 5
            calls.append(request)
            if self.error is not None:
                raise self.error
            return Result()

    opener = Opener()
    monkeypatch.setattr(oauth, "build_opener", lambda *args: opener)
    transport = OAuthFormTransport()
    assert transport.post(HOST + "/oidc/v1/token", {"code": "a&b"}).body == b"{}"
    assert calls[0].data == b"code=a%26b"
    assert calls[0].get_header("Content-type") == "application/x-www-form-urlencoded"
    for error in (
        HTTPError(HOST, 302, "", Message(), None),
        HTTPError(HOST, 400, "", Message(), None),
    ):
        opener.error = error
        assert transport.post(HOST, {}).status == error.code
    for network_error in (URLError("secret"), OSError("secret"), ValueError("secret")):
        opener.error = network_error
        with pytest.raises(OAuthError, match="^oauth_unavailable$"):
            transport.post(HOST, {})


def test_coffre_pkce_isolation_expiration_et_rejeu(monde: Monde) -> None:
    store = OAuthStore(monde.moteur, KEYS, CONFIG.client_id)
    now = monde.horloge()
    state, verifier = store.start(A, PERSON, HOST, "binding-secret", now)
    with monde.moteur.connect() as conn:
        raw = str(conn.execute(select(table)).all())
    assert not any(s in raw for s in (state, verifier, "binding-secret"))
    with pytest.raises(OAuthError):
        store.finish(state, OTHER, "binding-secret", now)
    with pytest.raises(OAuthError):
        OAuthStore(monde.moteur, KEYS, "other-client").finish(state, PERSON, "binding-secret", now)
    assert store.finish(state, PERSON, "binding-secret", now) == (A, HOST, verifier)
    with pytest.raises(OAuthError):
        store.finish(state, PERSON, "binding-secret", now)
    state, _ = store.start(A, PERSON, HOST, "binding-secret", now)
    with pytest.raises(OAuthError):
        store.finish(state, PERSON, "wrong-browser", now)
    with pytest.raises(OAuthError):
        store.finish(state, PERSON, "binding-secret", now)
    state, _ = store.start(A, PERSON, HOST, "binding-secret", now)
    with pytest.raises(OAuthError):
        store.finish(state, PERSON, "binding-secret", now + timedelta(minutes=10))
    state, _ = store.start(A, PERSON, HOST, "binding-secret", now)

    def consume(_: int) -> bool:
        try:
            store.finish(state, PERSON, "binding-secret", now)
            return True
        except OAuthError:
            return False

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(consume, range(2))) == [False, True]


def test_coffre_tokens_refresh_isolation_et_deconnexion(monde: Monde) -> None:
    store = OAuthStore(monde.moteur, KEYS, CONFIG.client_id)
    now = monde.horloge()
    tokens = Tokens("access-sentinel", "refresh-sentinel", now + timedelta(hours=1))
    store.save(A, PERSON, HOST, tokens, now)
    assert store.list(A, PERSON, now) == [
        {"host": HOST, "expires_at": tokens.expires_at.isoformat()}
    ]
    assert store.list(B, PERSON, now) == []
    assert store.list(A, OTHER, now) == []
    assert OAuthStore(monde.moteur, KEYS, "other-client").list(A, PERSON, now) == []
    assert store.list(A, PERSON, now + timedelta(days=8)) == []
    assert store.access(A, PERSON, HOST, now, lambda _: pytest.fail("pas de refresh")) == tokens
    with pytest.raises(OAuthError, match="oauth_reconnect"):
        store.access(B, PERSON, HOST, now, lambda _: tokens)
    refreshed: list[str] = []
    newer = Tokens("new-access", "new-refresh", now + timedelta(hours=2))

    def renew(token: str) -> Tokens:
        refreshed.append(token)
        return newer

    def get(_: int) -> Tokens:
        return store.access(A, PERSON, HOST, now + timedelta(hours=1), renew)

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(get, range(2))) == [newer, newer]
    assert refreshed == ["refresh-sentinel"]
    store.disconnect(A, OTHER, HOST)
    assert len(store.list(A, PERSON, now)) == 1
    store.disconnect(A, PERSON, HOST)
    assert store.list(A, PERSON, now) == []
    with pytest.raises(OAuthError):
        store.access(A, PERSON, HOST, now, renew)
    # L'écriture purge aussi les anciens états/jetons.
    store.save(A, PERSON, HOST, tokens, now)
    store.start(A, PERSON, HOST, "binding", now + timedelta(days=8))
    assert store.list(A, PERSON, now + timedelta(days=8)) == []


def test_coffre_ferme_sans_cle_et_chiffrement_lie_au_contexte(monde: Monde) -> None:
    now = monde.horloge()
    with pytest.raises(VaultError):
        OAuthStore(monde.moteur, None, "client").start(A, PERSON, HOST, "binding", now)
    store = OAuthStore(monde.moteur, KEYS, "client")
    state, _ = store.start(A, PERSON, HOST, "binding", now)
    with pytest.raises(VaultError):
        OAuthStore(monde.moteur, None, "client").finish(state, PERSON, "binding", now)
    with monde.moteur.begin() as conn:
        row = conn.execute(select(table)).mappings().one()
        conn.execute(table.update().values(key_id="missing"))
    with pytest.raises(VaultError):
        store.finish(state, PERSON, "binding", now)
    with monde.moteur.begin() as conn:
        conn.execute(table.update().values(key_id="key", ciphertext=b"broken"))
    with pytest.raises(VaultError):
        store.finish(state, PERSON, "binding", now)
    payloads: list[object] = [
        [],
        {"invalid": "payload"},
        {"binding": 3},
        {"binding": "x", "verifier": "x", "extra": "x"},
    ]
    for payload in payloads:
        changed = dict(row)
        changed["ciphertext"] = AESGCM(KEYS.keys["key"]).encrypt(
            row["nonce"], json.dumps(payload).encode(), _aad(row)
        )
        with pytest.raises(VaultError):
            store._decrypt(changed)
    for expiry in ("invalid", "2026-01-01T00:00:00"):
        changed = {**row, "purpose": "credential"}
        changed["ciphertext"] = AESGCM(KEYS.keys["key"]).encrypt(
            row["nonce"],
            json.dumps({"access": "a", "refresh": "r", "expires_at": expiry}).encode(),
            _aad(changed),
        )
        with pytest.raises(VaultError):
            store._decrypt(changed)


def test_rotation_inclut_les_jetons_et_demandes_personnelles(monde: Monde) -> None:
    from skifer_board.execution.vault import CredentialVault

    now = monde.horloge()
    store = OAuthStore(monde.moteur, KEYS, CONFIG.client_id)
    state, verifier = store.start(A, PERSON, HOST, "binding", now)
    store.save(A, PERSON, HOST, Tokens("access", "refresh", now + timedelta(hours=1)), now)
    keys = VaultKeys("new", {**KEYS.keys, "new": b"2" * 32})
    assert CredentialVault(monde.moteur, keys).rotate() == {"rotated": 2, "remaining_non_active": 0}
    assert OAuthStore(monde.moteur, keys, CONFIG.client_id).rotate() == {
        "rotated": 0,
        "remaining_non_active": 0,
    }
    with pytest.raises(VaultError):
        OAuthStore(monde.moteur, None, CONFIG.client_id).rotate()
    with pytest.raises(VaultError):
        store.list(A, PERSON, now)
    current = OAuthStore(monde.moteur, VaultKeys("new", {"new": b"2" * 32}), CONFIG.client_id)
    assert current.finish(state, PERSON, "binding", now) == (A, HOST, verifier)
    assert len(current.list(A, PERSON, now)) == 1
