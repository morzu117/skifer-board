"""Points d'accès déclarés par l'exploitant et essai sans SQL métier (plan 12, 12.3)."""

from __future__ import annotations

import json
import re
import ssl
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, ProxyHandler, Request, build_opener
from uuid import uuid4

from .model import ENDPOINT_KEY, Connector

ENDPOINTS_VARIABLE = "SKIFER_BOARD_CONNECTION_ENDPOINTS"
WAREHOUSE_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
STATES = frozenset({"STARTING", "RUNNING", "STOPPING", "STOPPED", "DELETING", "DELETED"})
MAX_RESPONSE = 1024 * 1024


class EndpointConfigError(ValueError):
    """Configuration invalide ; aucune valeur n'est recopiée dans le message."""


class ConnectorError(Exception):
    code = "connector_unavailable"


class EndpointNotConfigured(ConnectorError):
    code = "endpoint_not_configured"


class IdentityUnavailable(ConnectorError):
    code = "identity_unavailable"


class CredentialRejected(ConnectorError):
    code = "credential_rejected"


class RedirectRefused(ConnectorError):
    code = "redirect_refused"


class InvalidUpstream(ConnectorError):
    code = "invalid_upstream"


@dataclass(frozen=True)
class DuckDbEndpoint:
    path: Path
    connector: Connector = Connector.DUCKDB


@dataclass(frozen=True)
class DatabricksEndpoint:
    host: str
    warehouse_id: str
    connector: Connector = Connector.DATABRICKS


Endpoint = DuckDbEndpoint | DatabricksEndpoint


def _host(value: str) -> str:
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname or ""
        port = parsed.port
    except ValueError:
        raise EndpointConfigError(f"{ENDPOINTS_VARIABLE} : hôte invalide.") from None
    # N'admet que les domaines de workspace Databricks ; aucune IP, URL locale ou libre.
    allowed = (
        hostname.endswith(".cloud.databricks.com")
        or hostname.endswith(".azuredatabricks.net")
        or hostname.endswith(".gcp.databricks.com")
    )
    if (
        parsed.scheme != "https"
        or not allowed
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise EndpointConfigError(f"{ENDPOINTS_VARIABLE} : hôte HTTPS Databricks attendu.")
    return f"https://{hostname}"


def endpoints_from_env(environ: Mapping[str, str]) -> dict[str, Endpoint]:
    raw = environ.get(ENDPOINTS_VARIABLE)
    if raw is None:
        return {}

    def unique_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in pairs:
            if key in result:
                raise EndpointConfigError(f"{ENDPOINTS_VARIABLE} : clé en double.")
            result[key] = value
        return result

    try:
        parsed = json.loads(raw, object_pairs_hook=unique_pairs)
        if not isinstance(parsed, dict):
            raise ValueError
        endpoints: dict[str, Endpoint] = {}
        for key, value in parsed.items():
            if ENDPOINT_KEY.fullmatch(key) is None or not isinstance(value, dict):
                raise ValueError
            if value.get("connector") == "duckdb" and set(value) == {"connector", "path"}:
                path = value["path"]
                if not isinstance(path, str) or not Path(path).is_absolute():
                    raise ValueError
                endpoints[key] = DuckDbEndpoint(Path(path))
            elif value.get("connector") == "databricks" and set(value) == {
                "connector",
                "host",
                "warehouse_id",
            }:
                host = value["host"]
                warehouse_id = value["warehouse_id"]
                if (
                    not isinstance(host, str)
                    or not isinstance(warehouse_id, str)
                    or WAREHOUSE_ID.fullmatch(warehouse_id) is None
                ):
                    raise ValueError
                endpoints[key] = DatabricksEndpoint(_host(host), warehouse_id)
            else:
                raise ValueError
    except (ValueError, TypeError):
        raise EndpointConfigError(f"{ENDPOINTS_VARIABLE} : configuration invalide.") from None
    return endpoints


@dataclass(frozen=True)
class Probe:
    identity: str
    credential_expires_at: None
    can_cancel: bool
    state: str


@dataclass(frozen=True)
class HttpResponse:
    status: int
    body: bytes
    content_type: str


class HttpTransport(Protocol):
    def get(self, url: str, token: str) -> HttpResponse: ...

    def post(self, url: str, token: str, body: dict[str, object]) -> HttpResponse: ...


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(
        self, request: Request, fp: object, code: int, msg: str, headers: object, newurl: str
    ) -> Request | None:
        return None


class UrllibTransport:
    """Transport strict : TLS vérifié, aucun proxy, aucune redirection, taille bornée."""

    def get(self, url: str, token: str) -> HttpResponse:
        return self._request("GET", url, token, None)

    def post(self, url: str, token: str, body: dict[str, object]) -> HttpResponse:
        return self._request("POST", url, token, body)

    def _request(
        self, method: str, url: str, token: str, body: dict[str, object] | None
    ) -> HttpResponse:
        opener = build_opener(
            ProxyHandler({}), HTTPSHandler(context=ssl.create_default_context()), _NoRedirect()
        )
        request = Request(
            url,
            data=None if body is None else json.dumps(body).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            method=method,
        )
        try:
            with opener.open(request, timeout=5) as response:
                payload = response.read(MAX_RESPONSE + 1)
                result = HttpResponse(response.status, payload, response.headers.get_content_type())
        except HTTPError as error:
            if 300 <= error.code < 400:
                raise RedirectRefused() from None
            result = HttpResponse(error.code, b"", "")
        except (URLError, OSError, ValueError):
            raise ConnectorError() from None
        if len(result.body) > MAX_RESPONSE:
            raise InvalidUpstream() from None
        return result


def probe_duckdb(endpoint: DuckDbEndpoint) -> Probe:
    import duckdb

    if not endpoint.path.is_file():
        raise ConnectorError()
    try:
        connection = duckdb.connect(
            str(endpoint.path), read_only=True, config={"enable_external_access": "false"}
        )
        connection.close()
    except duckdb.Error:
        raise ConnectorError() from None
    return Probe("local", None, False, "available")


def probe_databricks(endpoint: DatabricksEndpoint, token: str, transport: HttpTransport) -> Probe:
    response = transport.get(
        f"{endpoint.host}/api/2.0/sql/warehouses/{endpoint.warehouse_id}", token
    )
    if 300 <= response.status < 400:
        raise RedirectRefused()
    if response.status in (401, 403):
        raise CredentialRejected()
    if response.status != 200:
        raise ConnectorError()
    if response.content_type != "application/json" or len(response.body) > MAX_RESPONSE:
        raise InvalidUpstream()
    try:
        data = json.loads(response.body)
    except (ValueError, UnicodeError):
        raise InvalidUpstream() from None
    if not isinstance(data, dict) or data.get("id") != endpoint.warehouse_id:
        raise InvalidUpstream()
    state = data.get("state")
    if not isinstance(state, str) or state not in STATES:
        raise InvalidUpstream()
    return Probe("service", None, True, state)


@dataclass(frozen=True)
class RunStatus:
    state: str
    statement_id: str


class ExecutionConnector(Protocol):
    """Port interne ; seul l'adaptateur skifer pourra lui fournir du SQL."""

    def execute(self, sql: str) -> RunStatus: ...

    def status(self, statement_id: str) -> RunStatus: ...

    def cancel(self, statement_id: str) -> None: ...

    def result(self, statement_id: str) -> Any: ...


STATEMENT_ID = re.compile(r"[0-9a-f-]{36}")
RUN_STATES = frozenset({"PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED", "CLOSED"})


def _statement(response: HttpResponse) -> dict[str, Any]:
    if 300 <= response.status < 400:
        raise RedirectRefused()
    if response.status in (401, 403):
        raise CredentialRejected()
    if response.status != 200:
        raise ConnectorError()
    if response.content_type != "application/json" or len(response.body) > MAX_RESPONSE:
        raise InvalidUpstream()
    try:
        data = json.loads(response.body)
    except (UnicodeError, ValueError):
        raise InvalidUpstream() from None
    if not isinstance(data, dict):
        raise InvalidUpstream()
    return data


class DatabricksExecution:
    """Cycle Statement Execution, réponse bornée et identifiants de source opaques."""

    def __init__(self, endpoint: DatabricksEndpoint, token: str, transport: HttpTransport) -> None:
        self.endpoint = endpoint
        self._token = token
        self.transport = transport

    def __repr__(self) -> str:
        return "DatabricksExecution(<redacted>)"

    def _url(self, statement_id: str | None = None) -> str:
        base = f"{self.endpoint.host}/api/2.0/sql/statements"
        if statement_id is None:
            return base
        if STATEMENT_ID.fullmatch(statement_id) is None:
            raise InvalidUpstream()
        return f"{base}/{statement_id}"

    def _status(self, data: dict[str, Any]) -> RunStatus:
        statement_id = data.get("statement_id")
        status = data.get("status")
        state = status.get("state") if isinstance(status, dict) else None
        if (
            not isinstance(statement_id, str)
            or STATEMENT_ID.fullmatch(statement_id) is None
            or not isinstance(state, str)
            or state not in RUN_STATES
        ):
            raise InvalidUpstream()
        return RunStatus(state, statement_id)

    def execute(self, sql: str) -> RunStatus:
        if not sql or len(sql.encode("utf-8")) > MAX_RESPONSE:
            raise InvalidUpstream()
        data = _statement(
            self.transport.post(
                self._url(),
                self._token,
                {
                    "statement": sql,
                    "warehouse_id": self.endpoint.warehouse_id,
                    "wait_timeout": "0s",
                    "on_wait_timeout": "CONTINUE",
                    "disposition": "INLINE",
                    "format": "JSON_ARRAY",
                    "row_limit": 1000,
                    "byte_limit": MAX_RESPONSE,
                },
            )
        )
        return self._status(data)

    def status(self, statement_id: str) -> RunStatus:
        data = _statement(self.transport.get(self._url(statement_id), self._token))
        status = self._status(data)
        if status.statement_id != statement_id:
            raise InvalidUpstream()
        return status

    def cancel(self, statement_id: str) -> None:
        response = self.transport.post(self._url(statement_id) + "/cancel", self._token, {})
        if 300 <= response.status < 400:
            raise RedirectRefused()
        if response.status in (401, 403):
            raise CredentialRejected()
        if response.status != 200:
            raise ConnectorError()
        if response.body:
            raise InvalidUpstream()

    def result(self, statement_id: str) -> dict[str, Any]:
        data = _statement(self.transport.get(self._url(statement_id), self._token))
        status = self._status(data)
        if status.statement_id != statement_id or status.state != "SUCCEEDED":
            raise InvalidUpstream()
        result = data.get("result")
        manifest = data.get("manifest")
        if not isinstance(result, dict) or not isinstance(manifest, dict):
            raise InvalidUpstream()
        if manifest.get("truncated") is not False or manifest.get("total_chunk_count") != 1:
            raise InvalidUpstream()
        if (
            result.get("next_chunk_index") is not None
            or result.get("next_chunk_internal_link") is not None
        ):
            raise InvalidUpstream()
        rows = result.get("data_array")
        if (
            not isinstance(rows, list)
            or len(rows) > 1000
            or not all(isinstance(row, list) for row in rows)
        ):
            raise InvalidUpstream()
        return {"manifest": manifest, "data_array": rows}


class DuckDbExecution:
    """Exécution locale synchrone, à usage unique, sur fichier déclaré en lecture seule."""

    def __init__(self, endpoint: DuckDbEndpoint) -> None:
        self.endpoint = endpoint
        self._statement_id: str | None = None
        self._table: Any = None

    def execute(self, sql: str) -> RunStatus:
        import duckdb

        if self._statement_id is not None or not sql or len(sql.encode("utf-8")) > MAX_RESPONSE:
            raise ConnectorError()
        if not self.endpoint.path.is_file():
            raise ConnectorError()
        try:
            with duckdb.connect(
                str(self.endpoint.path), read_only=True, config={"enable_external_access": "false"}
            ) as connection:
                table = connection.sql(sql).to_arrow_table()
        except duckdb.Error:
            raise ConnectorError() from None
        if table.num_rows > 1000 or table.nbytes > MAX_RESPONSE:
            raise ConnectorError()
        self._table = table
        self._statement_id = str(uuid4())
        return RunStatus("SUCCEEDED", self._statement_id)

    def _check(self, statement_id: str) -> None:
        if statement_id != self._statement_id or self._table is None:
            raise InvalidUpstream()

    def status(self, statement_id: str) -> RunStatus:
        self._check(statement_id)
        return RunStatus("SUCCEEDED", statement_id)

    def cancel(self, statement_id: str) -> None:
        self._check(statement_id)
        raise ConnectorError()

    def result(self, statement_id: str) -> Any:
        self._check(statement_id)
        return self._table
