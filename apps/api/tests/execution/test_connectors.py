"""Points d'accès et essai de liaison, sans réseau ni SQL métier (plan 12, 12.3)."""

from __future__ import annotations

import json
import ssl
from email.message import Message
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import HTTPSHandler, ProxyHandler

import duckdb
import pytest
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from fastapi.testclient import TestClient
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from skifer_board.catalog import CatalogService
from skifer_board.execution import ConnectionStore
from skifer_board.execution.connectors import (
    ENDPOINTS_VARIABLE,
    MAX_RESPONSE,
    ConnectorError,
    CredentialRejected,
    DatabricksEndpoint,
    DatabricksExecution,
    DuckDbEndpoint,
    DuckDbExecution,
    EndpointConfigError,
    HttpResponse,
    InvalidUpstream,
    RedirectRefused,
    UrllibTransport,
    _NoRedirect,
    endpoints_from_env,
    probe_databricks,
    probe_duckdb,
)
from skifer_board.execution.vault import VaultKeys
from skifer_board.server import create_app
from spaces.monde import (
    ADMIN_GROUPE,
    LECTEUR_GROUPE,
    ORIGINE,
    A,
    Monde,
    espaces_en_base,
)
from spaces.monde import config_plateforme as config_plateforme
from spaces.monde import monde as monde
from state.conftest import migre as migre

PATH = f"/api/spaces/{A}/connections/source/bindings/DEV/test"
WAREHOUSE = "abc123"
HOST = "https://dbc-123.cloud.databricks.com"
SECRET = "token-sentinelle"


def _configuration(value: object) -> dict[str, str]:
    return {ENDPOINTS_VARIABLE: json.dumps(value)}


def test_configuration_des_points_d_acces(tmp_path: Path) -> None:
    path = tmp_path / "source.duckdb"
    config = endpoints_from_env(
        _configuration(
            {
                "local": {"connector": "duckdb", "path": str(path)},
                "warehouse-prod": {
                    "connector": "databricks",
                    "host": HOST,
                    "warehouse_id": WAREHOUSE,
                },
            }
        )
    )
    assert config == {
        "local": DuckDbEndpoint(path),
        "warehouse-prod": DatabricksEndpoint(HOST, WAREHOUSE),
    }
    assert endpoints_from_env({}) == {}


@pytest.mark.parametrize(
    "value",
    [
        [],
        {"bad key": {"connector": "duckdb", "path": "/tmp/a"}},
        {"local": {"connector": "duckdb", "path": "relative.duckdb"}},
        {"local": {"connector": "duckdb", "path": "/tmp/a", "extra": "x"}},
        {"local": {"connector": "unknown"}},
        {"prod": {"connector": "databricks", "host": HOST, "warehouse_id": "bad/id"}},
        {
            "prod": {
                "connector": "databricks",
                "host": "http://dbc-123.cloud.databricks.com",
                "warehouse_id": WAREHOUSE,
            }
        },
        {
            "prod": {
                "connector": "databricks",
                "host": "https://127.0.0.1",
                "warehouse_id": WAREHOUSE,
            }
        },
        {
            "prod": {
                "connector": "databricks",
                "host": "https://dbc-123.cloud.databricks.com.evil",
                "warehouse_id": WAREHOUSE,
            }
        },
        {
            "prod": {
                "connector": "databricks",
                "host": "https://user:pass@dbc-123.cloud.databricks.com",
                "warehouse_id": WAREHOUSE,
            }
        },
        {"prod": {"connector": "databricks", "host": HOST + "/path", "warehouse_id": WAREHOUSE}},
        {"prod": {"connector": "databricks", "host": HOST + "?x=1", "warehouse_id": WAREHOUSE}},
        {"prod": {"connector": "databricks", "host": HOST + "#x", "warehouse_id": WAREHOUSE}},
        {"prod": {"connector": "databricks", "host": HOST + ":444", "warehouse_id": WAREHOUSE}},
        {"prod": {"connector": "databricks", "host": "https://[::1", "warehouse_id": WAREHOUSE}},
    ],
)
def test_configuration_invalide_ne_reprend_pas_valeur(value: object) -> None:
    with pytest.raises(EndpointConfigError) as error:
        endpoints_from_env(_configuration(value))
    assert json.dumps(value) not in str(error.value)


def test_configuration_json_malforme_et_cle_double() -> None:
    for raw in ("{", '{"local":{},"local":{}}'):
        with pytest.raises(EndpointConfigError):
            endpoints_from_env({ENDPOINTS_VARIABLE: raw})


def test_essai_duckdb_lecture_seule(tmp_path: Path) -> None:
    path = tmp_path / "source.duckdb"
    connection = duckdb.connect(str(path))
    connection.close()
    assert probe_duckdb(DuckDbEndpoint(path)).state == "available"
    assert probe_duckdb(DuckDbEndpoint(path)).can_cancel is False
    with pytest.raises(ConnectorError):
        probe_duckdb(DuckDbEndpoint(tmp_path / "absent.duckdb"))
    invalid = tmp_path / "invalid.duckdb"
    invalid.write_text("not a duckdb file")
    with pytest.raises(ConnectorError):
        probe_duckdb(DuckDbEndpoint(invalid))


class FakeTransport:
    def __init__(self, response: HttpResponse) -> None:
        self.response = response
        self.calls: list[tuple[str, str]] = []
        self.posts: list[tuple[str, str, dict[str, object]]] = []

    def get(self, url: str, token: str) -> HttpResponse:
        self.calls.append((url, token))
        return self.response

    def post(self, url: str, token: str, body: dict[str, object]) -> HttpResponse:
        self.posts.append((url, token, body))
        return self.response


def _response(
    status: int = 200, body: object = None, content_type: str = "application/json"
) -> HttpResponse:
    if body is None:
        body = {"id": WAREHOUSE, "state": "RUNNING"}
    return HttpResponse(status, json.dumps(body).encode(), content_type)


def test_essai_databricks_lecture_de_metadonnees_seulement() -> None:
    transport = FakeTransport(_response())
    result = probe_databricks(DatabricksEndpoint(HOST, WAREHOUSE), SECRET, transport)
    assert (result.identity, result.credential_expires_at, result.can_cancel, result.state) == (
        "service",
        None,
        True,
        "RUNNING",
    )
    assert transport.calls == [(HOST + "/api/2.0/sql/warehouses/abc123", SECRET)]


STATEMENT = "12345678-1234-1234-1234-123456789abc"


def test_cycle_databricks_interne_sans_route_http() -> None:
    transport = FakeTransport(
        _response(body={"statement_id": STATEMENT, "status": {"state": "RUNNING"}})
    )
    connector = DatabricksExecution(DatabricksEndpoint(HOST, WAREHOUSE), SECRET, transport)
    assert SECRET not in repr(connector)
    assert connector.execute("SELECT 1").state == "RUNNING"
    url = HOST + "/api/2.0/sql/statements"
    assert transport.posts == [
        (
            url,
            SECRET,
            {
                "statement": "SELECT 1",
                "warehouse_id": WAREHOUSE,
                "wait_timeout": "0s",
                "on_wait_timeout": "CONTINUE",
                "disposition": "INLINE",
                "format": "JSON_ARRAY",
                "row_limit": 1000,
                "byte_limit": MAX_RESPONSE,
            },
        )
    ]
    assert connector.status(STATEMENT).state == "RUNNING"
    transport.response = HttpResponse(200, b"", "application/json")
    connector.cancel(STATEMENT)
    transport.response = _response(
        body={
            "statement_id": STATEMENT,
            "status": {"state": "SUCCEEDED"},
            "manifest": {"total_chunk_count": 1, "truncated": False},
            "result": {"data_array": [["1"]]},
        }
    )
    assert connector.result(STATEMENT)["data_array"] == [["1"]]
    assert transport.calls == [(url + "/" + STATEMENT, SECRET)] * 2
    assert transport.posts[-1] == (url + "/" + STATEMENT + "/cancel", SECRET, {})


def test_cycle_duckdb_interne_sur_source_declaree(tmp_path: Path) -> None:
    path = tmp_path / "source.duckdb"
    connection = duckdb.connect(str(path))
    connection.execute("CREATE TABLE t (n INTEGER)")
    connection.execute("INSERT INTO t VALUES (1)")
    connection.close()
    connector = DuckDbExecution(DuckDbEndpoint(path))
    with pytest.raises(InvalidUpstream):
        connector.status("unknown")
    run = connector.execute("SELECT n FROM t")
    assert connector.status(run.statement_id).state == "SUCCEEDED"
    assert connector.result(run.statement_id).column("n").to_pylist() == [1]
    with pytest.raises(ConnectorError):
        connector.cancel(run.statement_id)
    with pytest.raises(ConnectorError):
        connector.execute("SELECT n FROM t")


def test_cycle_duckdb_refuse_source_requete_et_resultat_non_bornes(tmp_path: Path) -> None:
    absent = DuckDbExecution(DuckDbEndpoint(tmp_path / "absent.duckdb"))
    with pytest.raises(ConnectorError):
        absent.execute("SELECT 1")
    path = tmp_path / "source.duckdb"
    duckdb.connect(str(path)).close()
    for sql in ("", "SELECT from"):
        with pytest.raises(ConnectorError):
            DuckDbExecution(DuckDbEndpoint(path)).execute(sql)
    many = DuckDbExecution(DuckDbEndpoint(path))
    run = many.execute("SELECT * FROM range(1001)")
    assert many.result(run.statement_id).num_rows == 1000 and many.truncated
    large = DuckDbExecution(DuckDbEndpoint(path))
    run = large.execute(f"SELECT repeat('x', {MAX_RESPONSE + 1}) AS data")
    assert large.result(run.statement_id).num_rows == 0 and large.truncated
    partial = DuckDbExecution(DuckDbEndpoint(path))
    run = partial.execute(f"SELECT repeat('x', {MAX_RESPONSE // 2}) AS data FROM range(3)")
    assert partial.result(run.statement_id).num_rows == 1 and partial.truncated
    external = tmp_path / "outside.txt"
    external.write_text("ne doit pas être lu")
    with pytest.raises(ConnectorError):
        DuckDbExecution(DuckDbEndpoint(path)).execute(f"SELECT * FROM read_text('{external}')")


@pytest.mark.parametrize(
    "status,error",
    [
        (302, RedirectRefused),
        (401, CredentialRejected),
        (403, CredentialRejected),
        (500, ConnectorError),
    ],
)
def test_cycle_databricks_refus_http(status: int, error: type[Exception]) -> None:
    connector = DatabricksExecution(
        DatabricksEndpoint(HOST, WAREHOUSE), SECRET, FakeTransport(_response(status))
    )
    with pytest.raises(error):
        connector.execute("SELECT 1")


@pytest.mark.parametrize(
    "response,error",
    [
        (HttpResponse(302, b"", ""), RedirectRefused),
        (HttpResponse(401, b"", ""), CredentialRejected),
        (HttpResponse(503, b"", ""), ConnectorError),
        (HttpResponse(200, b"{}", "application/json"), InvalidUpstream),
    ],
)
def test_cycle_databricks_annulation_est_seulement_un_accuse_de_reception(
    response: HttpResponse, error: type[Exception]
) -> None:
    connector = DatabricksExecution(
        DatabricksEndpoint(HOST, WAREHOUSE), SECRET, FakeTransport(response)
    )
    with pytest.raises(error):
        connector.cancel(STATEMENT)


@pytest.mark.parametrize(
    "response",
    [
        HttpResponse(200, b"{}", "text/html"),
        HttpResponse(200, b"x" * (MAX_RESPONSE + 1), "application/json"),
        HttpResponse(200, b"{", "application/json"),
        _response(body=[]),
        _response(body={"statement_id": "bad", "status": {"state": "RUNNING"}}),
    ],
)
def test_cycle_databricks_reponse_hors_contrat(response: HttpResponse) -> None:
    connector = DatabricksExecution(
        DatabricksEndpoint(HOST, WAREHOUSE), SECRET, FakeTransport(response)
    )
    with pytest.raises(InvalidUpstream):
        connector.execute("SELECT 1")


def test_cycle_databricks_identifiants_et_etats_invalides() -> None:
    transport = FakeTransport(
        _response(body={"statement_id": "bad", "status": {"state": "RUNNING"}})
    )
    connector = DatabricksExecution(DatabricksEndpoint(HOST, WAREHOUSE), SECRET, transport)
    with pytest.raises(InvalidUpstream):
        connector.execute("")
    with pytest.raises(InvalidUpstream):
        connector.status("bad/id")
    with pytest.raises(InvalidUpstream):
        connector.execute("SELECT 1")
    transport.response = _response(
        body={
            "statement_id": "87654321-1234-1234-1234-123456789abc",
            "status": {"state": "RUNNING"},
        }
    )
    with pytest.raises(InvalidUpstream):
        connector.status(STATEMENT)


@pytest.mark.parametrize(
    "body",
    [
        {"statement_id": STATEMENT, "status": {"state": "RUNNING"}},
        {"statement_id": STATEMENT, "status": {"state": "SUCCEEDED"}, "result": [], "manifest": {}},
        {
            "statement_id": STATEMENT,
            "status": {"state": "SUCCEEDED"},
            "result": {"data_array": []},
            "manifest": {"truncated": False, "total_chunk_count": 2},
        },
        {
            "statement_id": STATEMENT,
            "status": {"state": "SUCCEEDED"},
            "result": {"data_array": [], "next_chunk_index": 1},
            "manifest": {"truncated": False, "total_chunk_count": 1},
        },
        {
            "statement_id": STATEMENT,
            "status": {"state": "SUCCEEDED"},
            "result": {"data_array": [], "next_chunk_internal_link": "/internal"},
            "manifest": {"truncated": False, "total_chunk_count": 1},
        },
        {
            "statement_id": STATEMENT,
            "status": {"state": "SUCCEEDED"},
            "result": {"data_array": [1]},
            "manifest": {"truncated": False, "total_chunk_count": 1},
        },
    ],
)
def test_cycle_databricks_resultat_incomplet(body: object) -> None:
    connector = DatabricksExecution(
        DatabricksEndpoint(HOST, WAREHOUSE), SECRET, FakeTransport(_response(body=body))
    )
    with pytest.raises(InvalidUpstream):
        connector.result(STATEMENT)


def test_cycle_databricks_resultat_tronque_est_signale() -> None:
    body = {
        "statement_id": STATEMENT,
        "status": {"state": "SUCCEEDED"},
        "result": {"data_array": [["1"]]},
        "manifest": {"truncated": True, "total_chunk_count": 1},
    }
    connector = DatabricksExecution(
        DatabricksEndpoint(HOST, WAREHOUSE), SECRET, FakeTransport(_response(body=body))
    )
    assert connector.result(STATEMENT)["manifest"]["truncated"] is True


@pytest.mark.parametrize(
    "status,error",
    [
        (302, RedirectRefused),
        (401, CredentialRejected),
        (403, CredentialRejected),
        (404, ConnectorError),
        (500, ConnectorError),
    ],
)
def test_essai_databricks_refus_http(status: int, error: type[Exception]) -> None:
    with pytest.raises(error):
        probe_databricks(
            DatabricksEndpoint(HOST, WAREHOUSE), SECRET, FakeTransport(_response(status))
        )


@pytest.mark.parametrize(
    "body,content_type",
    [
        ({"id": "other", "state": "RUNNING"}, "application/json"),
        ({"id": WAREHOUSE, "state": []}, "application/json"),
        ({"id": WAREHOUSE, "state": "UNKNOWN"}, "application/json"),
        ([], "application/json"),
        ({"id": WAREHOUSE, "state": "RUNNING"}, "text/html"),
    ],
)
def test_essai_databricks_reponse_hors_contrat(body: object, content_type: str) -> None:
    with pytest.raises(InvalidUpstream):
        probe_databricks(
            DatabricksEndpoint(HOST, WAREHOUSE),
            SECRET,
            FakeTransport(_response(body=body, content_type=content_type)),
        )
    with pytest.raises(InvalidUpstream):
        probe_databricks(
            DatabricksEndpoint(HOST, WAREHOUSE),
            SECRET,
            FakeTransport(HttpResponse(200, b"x" * (MAX_RESPONSE + 1), "application/json")),
        )
    with pytest.raises(InvalidUpstream):
        probe_databricks(
            DatabricksEndpoint(HOST, WAREHOUSE),
            SECRET,
            FakeTransport(HttpResponse(200, b"{", "application/json")),
        )


def test_transport_refuse_redirection_et_erreurs_sans_valeur(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert _NoRedirect().redirect_request(None, None, 302, "", None, HOST) is None  # type: ignore[arg-type]

    class Opener:
        def __init__(self, result: object) -> None:
            self.result = result

        def open(self, request: object, timeout: int) -> object:
            assert timeout == 5
            if isinstance(self.result, Exception):
                raise self.result
            return self.result

    class Response:
        status = 200

        class Headers:
            def get_content_type(self) -> str:
                return "application/json"

        headers = Headers()

        def __enter__(self) -> Response:
            return self

        def __exit__(self, *args: object) -> None:
            pass

        def read(self, length: int) -> bytes:
            assert length == MAX_RESPONSE + 1
            return b"{}"

    monkeypatch.setattr(
        "skifer_board.execution.connectors.build_opener", lambda *args: Opener(Response())
    )
    assert UrllibTransport().get(HOST, SECRET) == HttpResponse(200, b"{}", "application/json")
    assert UrllibTransport().post(HOST, SECRET, {"test": True}) == HttpResponse(
        200, b"{}", "application/json"
    )
    monkeypatch.setattr(
        "skifer_board.execution.connectors.build_opener",
        lambda *args: Opener(HTTPError(HOST, 404, "secret", Message(), None)),
    )
    assert UrllibTransport().get(HOST, SECRET).status == 404
    monkeypatch.setattr(
        "skifer_board.execution.connectors.build_opener",
        lambda *args: Opener(HTTPError(HOST, 302, "secret", Message(), None)),
    )
    with pytest.raises(RedirectRefused):
        UrllibTransport().get(HOST, SECRET)
    monkeypatch.setattr(
        "skifer_board.execution.connectors.build_opener", lambda *args: Opener(URLError("secret"))
    )
    with pytest.raises(ConnectorError) as error:
        UrllibTransport().get(HOST, SECRET)
    assert SECRET not in str(error.value)

    class LargeResponse(Response):
        def read(self, length: int) -> bytes:
            return b"x" * length

    monkeypatch.setattr(
        "skifer_board.execution.connectors.build_opener", lambda *args: Opener(LargeResponse())
    )
    with pytest.raises(InvalidUpstream):
        UrllibTransport().get(HOST, SECRET)


def test_transport_verifie_tls_et_n_utilise_pas_de_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    def inspecter(*handlers: object) -> object:
        proxy = next(handler for handler in handlers if isinstance(handler, ProxyHandler))
        https = next(handler for handler in handlers if isinstance(handler, HTTPSHandler))
        assert proxy.proxies == {}  # type: ignore[attr-defined]
        context = https._context  # type: ignore[attr-defined]
        assert context.check_hostname is True
        assert context.verify_mode == ssl.CERT_REQUIRED
        assert any(isinstance(handler, _NoRedirect) for handler in handlers)

        class Opener:
            def open(self, request: object, timeout: int) -> object:
                raise URLError("expected")

        return Opener()

    monkeypatch.setattr("skifer_board.execution.connectors.build_opener", inspecter)
    with pytest.raises(ConnectorError):
        UrllibTransport().get(HOST, SECRET)


def creer_et_lier(
    monde: Monde,
    *,
    connector: str = "databricks",
    identity: str = "service",
    endpoint: str = "warehouse-prod",
) -> None:
    assert (
        monde.requete(
            ADMIN_GROUPE, "POST", f"/api/spaces/{A}/connections", corps={"name": "source"}
        ).status_code
        == 201
    )
    assert (
        monde.requete(
            ADMIN_GROUPE,
            "PUT",
            f"/api/spaces/{A}/connections/source/bindings/DEV",
            corps={
                "connector": connector,
                "endpoint_key": endpoint,
                "identity_mode": identity,
            },
        ).status_code
        == 200
    )


def test_route_essai_databricks_et_refus(monde: Monde, service: CatalogService) -> None:
    creer_et_lier(monde)
    credential = f"/api/spaces/{A}/connections/source/bindings/DEV/credential"
    assert (
        monde.requete(ADMIN_GROUPE, "PUT", credential, corps={"secret": SECRET}).status_code == 204
    )
    transport = FakeTransport(_response())
    app = create_app(
        service,
        monde.runtime,
        espaces_en_base(monde.moteur, monde.horloge),
        connections=ConnectionStore(monde.moteur),
        vault_keys=VaultKeys("test", {"test": b"1" * 32}),
        endpoints={"warehouse-prod": DatabricksEndpoint(HOST, WAREHOUSE)},
        connection_transport=transport,
    )
    headers = {"Origin": ORIGINE, "Cookie": f"__Host-sb_session={monde.session(ADMIN_GROUPE)}"}
    with TestClient(app, base_url=ORIGINE, raise_server_exceptions=False) as client:
        result = client.post(PATH, headers=headers)
        assert result.status_code == 200 and result.json() == {
            "identity": "service",
            "credential_expires_at": None,
            "can_cancel": True,
            "state": "RUNNING",
        }
        assert SECRET not in result.text
        assert client.post(PATH, headers=headers, json={"sql": "SELECT secret"}).status_code == 400
        reader = {"Origin": ORIGINE, "Cookie": f"__Host-sb_session={monde.session(LECTEUR_GROUPE)}"}
        assert client.post(PATH, headers=reader).status_code == 403
    assert transport.calls == [(HOST + "/api/2.0/sql/warehouses/abc123", SECRET)]


def test_route_essai_refuse_endpoint_absent_et_identite_personne(
    monde: Monde, service: CatalogService
) -> None:
    creer_et_lier(monde, identity="person")
    app = create_app(
        service,
        monde.runtime,
        espaces_en_base(monde.moteur, monde.horloge),
        connections=ConnectionStore(monde.moteur),
        endpoints={"warehouse-prod": DatabricksEndpoint(HOST, WAREHOUSE)},
        connection_transport=FakeTransport(_response()),
    )
    headers = {"Origin": ORIGINE, "Cookie": f"__Host-sb_session={monde.session(ADMIN_GROUPE)}"}
    with TestClient(app, base_url=ORIGINE, raise_server_exceptions=False) as client:
        response = client.post(PATH, headers=headers)
        assert (
            response.status_code == 409
            and response.json()["error"]["code"] == "identity_unavailable"
        )
    no_endpoint = create_app(
        service,
        monde.runtime,
        espaces_en_base(monde.moteur, monde.horloge),
        connections=ConnectionStore(monde.moteur),
    )
    with TestClient(no_endpoint, base_url=ORIGINE, raise_server_exceptions=False) as client:
        response = client.post(PATH, headers=headers)
        assert (
            response.status_code == 409
            and response.json()["error"]["code"] == "endpoint_not_configured"
        )
    wrong_type = create_app(
        service,
        monde.runtime,
        espaces_en_base(monde.moteur, monde.horloge),
        connections=ConnectionStore(monde.moteur),
        endpoints={"warehouse-prod": DuckDbEndpoint(Path("/tmp/not-a-warehouse"))},
    )
    with TestClient(wrong_type, base_url=ORIGINE, raise_server_exceptions=False) as client:
        assert client.post(PATH, headers=headers).json() == {
            "error": {"code": "endpoint_not_configured"}
        }


def test_route_essai_duckdb_et_liaisons_absentes(
    monde: Monde, service: CatalogService, tmp_path: Path
) -> None:
    path = tmp_path / "source.duckdb"
    duckdb.connect(str(path)).close()
    creer_et_lier(monde, connector="duckdb", endpoint="local")
    app = create_app(
        service,
        monde.runtime,
        espaces_en_base(monde.moteur, monde.horloge),
        connections=ConnectionStore(monde.moteur),
        endpoints={"local": DuckDbEndpoint(path)},
    )
    headers = {"Origin": ORIGINE, "Cookie": f"__Host-sb_session={monde.session(ADMIN_GROUPE)}"}
    with TestClient(app, base_url=ORIGINE, raise_server_exceptions=False) as client:
        assert client.post(PATH, headers=headers).json() == {
            "identity": "local",
            "credential_expires_at": None,
            "can_cancel": False,
            "state": "available",
        }
        assert client.post(PATH.replace("source", "absent"), headers=headers).json() == {
            "error": {"code": "connection_not_found"}
        }
        assert client.post(PATH.replace("DEV", "TEST"), headers=headers).json() == {
            "error": {"code": "connection_binding_not_found"}
        }


def test_mode_local_peut_essayer_duckdb_declare_sans_sql(
    service: CatalogService, tmp_path: Path
) -> None:
    path = tmp_path / "source.duckdb"
    duckdb.connect(str(path)).close()
    app = create_app(service, endpoints={"local": DuckDbEndpoint(path)})
    with TestClient(app) as client:
        route = "/api/local/connections/local/test"
        headers = {"Origin": "http://127.0.0.1:5173"}
        assert client.post(route, headers=headers).json() == {
            "identity": "local",
            "credential_expires_at": None,
            "can_cancel": False,
            "state": "available",
        }
        assert client.post(route, headers=headers, json={"sql": "SELECT 1"}).status_code == 400
        assert client.post("/api/local/connections/absent/test", headers=headers).json() == {
            "error": {"code": "endpoint_not_configured"}
        }
        assert (
            client.post("/api/local/connections/invalid_key/test", headers=headers).status_code
            == 400
        )


@pytest.mark.parametrize(
    "response,contract",
    [
        (_response(401), "identifiant-refuse"),
        (_response(503), "connexion-indisponible"),
        (_response(302), "redirection-refusee"),
        (HttpResponse(200, b"{", "application/json"), "reponse-source-invalide"),
    ],
)
def test_contrats_essai_produits_par_le_serveur(
    monde: Monde, service: CatalogService, response: HttpResponse, contract: str
) -> None:
    creer_et_lier(monde)
    credential = f"/api/spaces/{A}/connections/source/bindings/DEV/credential"
    assert (
        monde.requete(ADMIN_GROUPE, "PUT", credential, corps={"secret": SECRET}).status_code == 204
    )
    app = create_app(
        service,
        monde.runtime,
        espaces_en_base(monde.moteur, monde.horloge),
        connections=ConnectionStore(monde.moteur),
        vault_keys=VaultKeys("test", {"test": b"1" * 32}),
        endpoints={"warehouse-prod": DatabricksEndpoint(HOST, WAREHOUSE)},
        connection_transport=FakeTransport(response),
    )
    headers = {"Origin": ORIGINE, "Cookie": f"__Host-sb_session={monde.session(ADMIN_GROUPE)}"}
    with TestClient(app, base_url=ORIGINE, raise_server_exceptions=False) as client:
        result = client.post(PATH, headers=headers)
    expected = json.loads(Path(f"contracts/executions/{contract}.json").read_text())
    assert {"status": result.status_code, "body": result.json()} == expected
    assert SECRET not in result.text
