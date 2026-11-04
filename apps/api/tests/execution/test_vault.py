"""Coffre : valeur opaque, isolation, rotation, droits et refus fermés (plan 12, 12.2)."""

from __future__ import annotations

import base64
import json
from dataclasses import replace
from pathlib import Path
from typing import cast

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
from skifer_board.execution import rotate as rotate_module
from skifer_board.execution.rotate import main as rotate_main
from skifer_board.execution.vault import (
    ACTIVE_VARIABLE,
    KEYS_VARIABLE,
    CredentialVault,
    VaultConfigError,
    VaultError,
    VaultKeys,
    keys_from_env,
)
from skifer_board.server import create_app
from skifer_board.spaces.model import Environment
from skifer_board.state import DatabaseConfig, connect
from skifer_board.state.schema import connection_credentials
from spaces.monde import (
    ADMIN_B,
    ADMIN_GROUPE,
    LECTEUR_GROUPE,
    ORIGINE,
    A,
    B,
    Monde,
    espaces_en_base,
)
from spaces.monde import config_plateforme as config_plateforme
from spaces.monde import monde as monde
from sqlalchemy import select, update
from state.conftest import migre as migre

PATH = f"/api/spaces/{A}/connections/finance/bindings/DEV/credential"
SENTINEL = "secret-sentinelle-123456"
CONTRACTS = Path(__file__).resolve().parents[4] / "contracts" / "executions"


def contrat(name: str) -> dict[str, object]:
    return cast(
        dict[str, object], json.loads((CONTRACTS / name).read_text(encoding="utf-8"))["body"]
    )


def creer(monde: Monde) -> None:
    response = monde.requete(
        ADMIN_GROUPE, "POST", f"/api/spaces/{A}/connections", corps={"name": "finance"}
    )
    assert response.status_code == 201


def lier(monde: Monde, *, endpoint: str = "warehouse-prod", identity: str = "service") -> int:
    response = monde.requete(
        ADMIN_GROUPE,
        "PUT",
        f"/api/spaces/{A}/connections/finance/bindings/DEV",
        corps={
            "connector": "databricks",
            "endpoint_key": endpoint,
            "identity_mode": identity,
        },
    )
    return response.status_code


def test_configuration_fermee_et_repr_sans_cle(capsys: pytest.CaptureFixture[str]) -> None:
    assert keys_from_env({}) is None
    first = base64.b64encode(b"a" * 32).decode()
    config = keys_from_env({KEYS_VARIABLE: json.dumps({"v1": first}), ACTIVE_VARIABLE: "v1"})
    assert config is not None and config.keys["v1"] == b"a" * 32
    assert first not in repr(config)
    assert "a" * 32 not in repr(config)
    second = base64.b64encode(b"b" * 32).decode()
    ring = keys_from_env(
        {KEYS_VARIABLE: json.dumps({"v1": first, "v2": second}), ACTIVE_VARIABLE: "v2"}
    )
    assert ring is not None and ring.active == "v2" and len(ring.keys) == 2
    assert rotate_main({}) == 2
    assert "Base d'état et clés" in capsys.readouterr().err
    assert rotate_main({KEYS_VARIABLE: "{}", ACTIVE_VARIABLE: "v1"}) == 2
    assert KEYS_VARIABLE in capsys.readouterr().err


@pytest.mark.parametrize(
    "keys,active",
    [
        (None, "v1"),
        ("{}", "v1"),
        ("[]", "v1"),
        ("{", "v1"),
        ('{"v1":"x","v1":"y"}', "v1"),
        (json.dumps({"bad id": base64.b64encode(b"a" * 32).decode()}), "bad id"),
        (json.dumps({"v1": 12}), "v1"),
        (json.dumps({"v1": "*"}), "v1"),
        (json.dumps({"v1": base64.b64encode(b"short").decode()}), "v1"),
        (json.dumps({"v1": base64.b64encode(b"a" * 32).decode()}), "v2"),
    ],
)
def test_configurations_invalides_sans_valeur_dans_erreur(keys: str | None, active: str) -> None:
    values = {ACTIVE_VARIABLE: active}
    if keys is not None:
        values[KEYS_VARIABLE] = keys
    with pytest.raises(VaultConfigError) as error:
        keys_from_env(values)
    assert keys is None or keys not in str(error.value)
    assert active not in str(error.value)


def test_configurations_partielles_refusees() -> None:
    with pytest.raises(VaultConfigError):
        keys_from_env({KEYS_VARIABLE: "{}"})


def test_commande_rotation_codes_fermes(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    class Engine:
        disposed = False

        def dispose(self) -> None:
            self.disposed = True

    engine = Engine()
    monkeypatch.setattr(rotate_module, "config_from_env", lambda _: object())
    monkeypatch.setattr(rotate_module, "connect", lambda _: engine)
    monkeypatch.setattr(
        rotate_module, "keys_from_env", lambda _: VaultKeys("v2", {"v2": b"2" * 32})
    )

    class Success:
        def __init__(self, _engine: object, _keys: object) -> None:
            pass

        def rotate(self) -> dict[str, int]:
            return {"rotated": 2, "remaining_non_active": 0}

    monkeypatch.setattr(rotate_module, "CredentialVault", Success)
    assert rotate_main({}) == 0
    assert "Identifiants réécrits : 2" in capsys.readouterr().out
    assert engine.disposed

    class Failure(Success):
        def rotate(self) -> dict[str, int]:
            raise VaultError()

    engine.disposed = False
    monkeypatch.setattr(rotate_module, "CredentialVault", Failure)
    assert rotate_main({}) == 1
    assert "Rotation impossible" in capsys.readouterr().err
    assert engine.disposed


def test_ecriture_lecture_rotation_et_suppression(monde: Monde) -> None:
    creer(monde)
    assert lier(monde) == 200
    response = monde.requete(ADMIN_GROUPE, "PUT", PATH, corps={"secret": SENTINEL})
    assert response.status_code == 204 and response.content == b""
    with monde.moteur.connect() as connection:
        row = connection.execute(select(connection_credentials)).one()
    assert row.key_id == "test"
    assert len(row.nonce) == 12 and SENTINEL.encode() not in row.ciphertext
    assert SENTINEL not in repr(row)
    assert SENTINEL not in repr(monde.magasin.events(A))
    listed = monde.requete(ADMIN_GROUPE, "GET", f"/api/spaces/{A}/connections")
    assert listed.json()["connections"][0]["bindings"][0]["credential_state"] == "configured"
    assert SENTINEL not in listed.text

    # Deux processus sur la même base, puis rotation vers une nouvelle clé active.
    second_engine = connect(DatabaseConfig(monde.moteur.url))
    old = CredentialVault(second_engine, VaultKeys("test", {"test": b"1" * 32}))
    actual = ConnectionStore(monde.moteur).list(A)[0][1][0]
    assert old.reveal_for_execution(actual) == SENTINEL
    new = CredentialVault(monde.moteur, VaultKeys("v2", {"test": b"1" * 32, "v2": b"2" * 32}))
    assert new.rotate() == {"rotated": 1, "remaining_non_active": 0}
    assert new.rotate() == {"rotated": 0, "remaining_non_active": 0}
    assert new.reveal_for_execution(actual) == SENTINEL
    assert old.status(actual) == "unavailable"
    assert (
        CredentialVault(second_engine, VaultKeys("v2", {"v2": b"2" * 32})).status(actual)
        == "configured"
    )

    # Remplacement par la route : la valeur précédente ne sort jamais.
    replaced = monde.requete(ADMIN_GROUPE, "PUT", PATH, corps={"secret": "new-sentinel"})
    assert replaced.status_code == 204 and SENTINEL not in replaced.text
    assert old.reveal_for_execution(actual) == "new-sentinel"
    deleted = monde.requete(ADMIN_GROUPE, "DELETE", PATH)
    assert deleted.status_code == 204
    missing = monde.requete(ADMIN_GROUPE, "DELETE", PATH)
    assert missing.status_code == 404 and missing.json() == contrat("identifiant-absent.json")
    with pytest.raises(VaultError):
        new.reveal_for_execution(replace(actual, environment=Environment.TEST))
    second_engine.dispose()


def test_refus_et_changement_de_liaison(monde: Monde) -> None:
    assert monde.requete(ADMIN_GROUPE, "PUT", PATH, corps={"secret": SENTINEL}).status_code == 404
    creer(monde)
    assert monde.requete(ADMIN_GROUPE, "PUT", PATH, corps={"secret": SENTINEL}).status_code == 404
    assert lier(monde) == 200
    for invalid in ("", 42):
        response = monde.requete(ADMIN_GROUPE, "PUT", PATH, corps={"secret": invalid})
        assert response.status_code == 400 and response.json()["error"]["code"] == "invalid_request"
        if invalid:
            assert str(invalid) not in response.text
    oversized = monde.requete(ADMIN_GROUPE, "PUT", PATH, corps={"secret": "x" * 16385})
    assert oversized.status_code == 400 and oversized.json()["error"]["code"] == "invalid_request"
    malformed = monde.requete(ADMIN_GROUPE, "PUT", PATH, contenu=b'{"secret":"\\ud800"}')
    assert malformed.status_code == 400 and malformed.json()["error"]["code"] == "invalid_request"
    assert monde.requete(ADMIN_GROUPE, "DELETE", PATH).status_code == 404
    for profile, code in (
        (LECTEUR_GROUPE, "forbidden"),
        (ADMIN_B, "space_not_found"),
    ):
        response = monde.requete(profile, "PUT", PATH, corps={"secret": SENTINEL})
        assert response.json()["error"]["code"] == code
        assert SENTINEL not in response.text
    assert monde.requete(ADMIN_GROUPE, "PUT", PATH, corps={"secret": SENTINEL}).status_code == 204
    assert lier(monde, endpoint="warehouse-other") == 200
    assert [event.action for event in monde.magasin.events(A)][:2] == [
        "connection_bound",
        "credential_removed",
    ]
    with monde.moteur.connect() as connection:
        assert connection.execute(select(connection_credentials)).all() == []
    assert monde.requete(ADMIN_GROUPE, "PUT", PATH, corps={"secret": SENTINEL}).status_code == 204
    assert (
        monde.requete(
            ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/connections/finance/bindings/DEV"
        ).status_code
        == 204
    )
    with monde.moteur.connect() as connection:
        assert connection.execute(select(connection_credentials)).all() == []


def test_clef_absente_ou_ciphertext_altere_desactive_liaison(monde: Monde) -> None:
    creer(monde)
    lier(monde)
    monde.requete(ADMIN_GROUPE, "PUT", PATH, corps={"secret": SENTINEL})
    actual = ConnectionStore(monde.moteur).list(A)[0][1][0]
    without_key = CredentialVault(monde.moteur, None)
    assert without_key.status(actual) == "unavailable"
    with pytest.raises(VaultError):
        without_key.put(
            A, "finance", Environment.DEV, "replacement", ADMIN_GROUPE.ref, monde.horloge()
        )
    with pytest.raises(VaultError):
        without_key.rotate()
    with monde.moteur.begin() as connection:
        connection.execute(update(connection_credentials).values(ciphertext=b"bad"))
    assert (
        CredentialVault(monde.moteur, VaultKeys("test", {"test": b"1" * 32})).status(actual)
        == "unavailable"
    )
    with pytest.raises(VaultError):
        CredentialVault(
            monde.moteur, VaultKeys("v2", {"test": b"1" * 32, "v2": b"2" * 32})
        ).rotate()
    with pytest.raises(VaultError):
        CredentialVault(monde.moteur, VaultKeys("test", {"test": b"1" * 32})).rotate()
    assert (
        monde.requete(ADMIN_GROUPE, "GET", f"/api/spaces/{A}/connections").json()["connections"][0][
            "bindings"
        ][0]["credential_state"]
        == "unavailable"
    )


def test_identifiant_reserve_au_mode_service(monde: Monde) -> None:
    creer(monde)
    lier(monde, identity="person")
    response = monde.requete(ADMIN_GROUPE, "PUT", PATH, corps={"secret": SENTINEL})
    assert response.status_code == 409
    assert response.json() == contrat("identifiant-interdit.json")
    with monde.moteur.connect() as connection:
        assert connection.execute(select(connection_credentials)).all() == []


def test_route_sans_cle_refuse_ecriture(monde: Monde, service: CatalogService) -> None:
    creer(monde)
    lier(monde)
    app = create_app(
        service,
        monde.runtime,
        espaces_en_base(monde.moteur, monde.horloge),
        connections=ConnectionStore(monde.moteur),
    )
    with TestClient(app, base_url=ORIGINE, raise_server_exceptions=False) as client:
        response = client.put(
            PATH,
            headers={
                "Origin": ORIGINE,
                "Cookie": f"__Host-sb_session={monde.session(ADMIN_GROUPE)}",
            },
            json={"secret": SENTINEL},
        )
    assert response.status_code == 503
    assert response.json() == contrat("coffre-indisponible.json")
    assert SENTINEL not in response.text


def test_route_locale_refuse_le_coffre(service: CatalogService) -> None:
    with TestClient(create_app(service), raise_server_exceptions=False) as client:
        put = client.put(PATH, json={"secret": SENTINEL}, headers={"Origin": "http://localhost"})
        delete = client.delete(PATH, headers={"Origin": "http://localhost"})
    assert put.status_code == 409 and put.json()["error"]["code"] == "local_mode"
    assert delete.status_code == 409 and delete.json()["error"]["code"] == "local_mode"
    assert SENTINEL not in put.text


def test_espaces_distincts_et_texte_chiffre_non_deplacable(monde: Monde) -> None:
    creer(monde)
    lier(monde)
    assert (
        monde.requete(
            ADMIN_B, "POST", f"/api/spaces/{B}/connections", corps={"name": "finance"}
        ).status_code
        == 201
    )
    assert (
        monde.requete(
            ADMIN_B,
            "PUT",
            f"/api/spaces/{B}/connections/finance/bindings/DEV",
            corps={
                "connector": "databricks",
                "endpoint_key": "warehouse-prod",
                "identity_mode": "service",
            },
        ).status_code
        == 200
    )
    assert monde.requete(ADMIN_GROUPE, "PUT", PATH, corps={"secret": SENTINEL}).status_code == 204
    path_b = f"/api/spaces/{B}/connections/finance/bindings/DEV/credential"
    assert monde.requete(ADMIN_B, "PUT", path_b, corps={"secret": "rh-secret"}).status_code == 204
    vault = CredentialVault(monde.moteur, VaultKeys("test", {"test": b"1" * 32}))
    registry = ConnectionStore(monde.moteur)
    binding_a = registry.list(A)[0][1][0]
    binding_b = registry.list(B)[0][1][0]
    assert vault.reveal_for_execution(binding_a) == SENTINEL
    assert vault.reveal_for_execution(binding_b) == "rh-secret"
    with monde.moteur.connect() as connection:
        row_a = connection.execute(
            select(connection_credentials).where(connection_credentials.c.space_id == A)
        ).one()
    with monde.moteur.begin() as connection:
        connection.execute(
            update(connection_credentials)
            .where(connection_credentials.c.space_id == B)
            .values(nonce=row_a.nonce, ciphertext=row_a.ciphertext)
        )
    assert vault.status(binding_b) == "unavailable"
    with pytest.raises(VaultError):
        vault.reveal_for_execution(binding_b)
