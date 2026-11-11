"""Modèle pur de la télémétrie : mesure, issue normalisée, fenêtres (plan 11, T1 à T3, T7)."""

from __future__ import annotations

import dataclasses
import json
import math
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
from skifer_board.spaces.model import ENVIRONMENTS
from skifer_board.state.schema import telemetry
from skifer_board.telemetry import (
    METHODS,
    OUTCOMES,
    REFUSAL_CODES,
    RETENTION,
    InvalidMeasure,
    Kind,
    Measure,
    OperationSummary,
    Summary,
    Window,
    outcome,
)

from .conftest import MAINTENANT, atlas, http

CONTRATS = Path(__file__).resolve().parents[4] / "contracts"


def refus(champ: str, fabrique: Any = http, **champs: Any) -> None:
    with pytest.raises(InvalidMeasure) as erreur:
        fabrique(**champs)
    assert erreur.value.args == (champ,)
    assert isinstance(erreur.value, ValueError)


# --- Constantes ------------------------------------------------------------------------------


def test_retention_de_90_jours() -> None:
    assert RETENTION == timedelta(days=90)


def test_genres() -> None:
    assert [k.value for k in Kind] == ["http", "atlas", "execution"]
    assert Kind("http") is Kind.HTTP and Kind("atlas") is Kind.ATLAS
    assert Kind("execution") is Kind.EXECUTION
    with pytest.raises(ValueError):
        Kind("other")


def test_fenetres_et_leur_duree() -> None:
    assert [w.value for w in Window] == ["24h", "7d", "30d"]
    assert Window("24h").span == timedelta(hours=24)
    assert Window("7d").span == timedelta(days=7)
    assert Window("30d").span == timedelta(days=30)
    for inconnue in ("1h", "24H", "90d", "", "7j"):
        with pytest.raises(ValueError):
            Window(inconnue)


def test_methodes_et_issues() -> None:
    # `OTHER` range une méthode hors liste (plan 11, 11.2).
    assert METHODS == {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "OTHER"}
    assert OUTCOMES == REFUSAL_CODES | {
        "ok",
        "error",
        "other",
        "deny",
        "require_human",
        "execution_timed_out",
        "execution_failed",
        "execution_lost",
        "cancelled",
        "succeeded",
        "denied",
        "failed",
        "timed_out",
        "running",
        "queued",
        "unavailable",
    }
    assert not {"ok", "error", "other"} & REFUSAL_CODES
    # Les issues tiennent dans la colonne `outcome`.
    assert max(map(len, OUTCOMES)) <= telemetry.c.outcome.type.length  # type: ignore[attr-defined]


def codes_des_contrats() -> set[str]:
    """Codes de refus que l'API rend, relevés dans les exemples produits par le serveur réel."""
    trouves: set[str] = set()

    def parcourir(noeud: object) -> None:
        if isinstance(noeud, dict):
            corps = noeud.get("body")
            if isinstance(corps, dict) and isinstance(corps.get("error"), dict):
                trouves.add(corps["error"]["code"])
            for valeur in noeud.values():
                parcourir(valeur)
        elif isinstance(noeud, list):
            for valeur in noeud:
                parcourir(valeur)

    for chemin in CONTRATS.rglob("*.json"):
        parcourir(json.loads(chemin.read_text(encoding="utf-8")))
    return trouves


def test_codes_des_contrats_releves() -> None:
    # Garde du test suivant : le relevé trouve bien les refus des contrats.
    assert {"forbidden", "space_not_found", "catalog_unavailable", "local_mode"} <= (
        codes_des_contrats()
    )


# Codes de l'écart de versions du catalogue, longtemps oubliés de la liste.
ECARTS = {"version_not_found", "diff_not_supported", "diff_unavailable"}
# Codes rendus par le serveur lui-même (`server.py`), sans exemple de contrat.
DU_SERVEUR = {
    "route_not_found",
    "method_not_allowed",
    "http_error",
    "internal_error",
    "oauth_unavailable",
    "oauth_not_configured",
    "oauth_refused",
    "oauth_invalid_state",
    "oauth_reconnect",
    "oauth_invalid_response",
}


def test_codes_rendus_par_l_api_connus() -> None:
    # Retirer un code connu de la liste le rangerait sous `other` : ce filet l'attrape.
    assert codes_des_contrats() | DU_SERVEUR | ECARTS <= REFUSAL_CODES
    assert REFUSAL_CODES - codes_des_contrats() - DU_SERVEUR <= {"parameter_limit"}


def test_chaque_code_rendu_par_l_api_est_connu() -> None:
    assert codes_des_contrats() - REFUSAL_CODES == set()


def test_codes_des_dashboards_connus_et_illustres_par_un_exemple() -> None:
    """Les refus du plan 19.2 sont des issues de la liste fermée, et chacun a son exemple de
    contrat produit par le serveur (dossiers `routes` des analyses et des dashboards)."""
    nouveaux = {"dashboard_not_found", "invalid_dashboard", "personal_reference", "analysis_in_use"}
    assert nouveaux <= REFUSAL_CODES
    assert nouveaux <= codes_des_contrats()
    for code in nouveaux:
        assert outcome(422, code) == code


# --- Issue normalisée ------------------------------------------------------------------------


@pytest.mark.parametrize("statut", [100, 101, 200, 204, 301, 304, 399])
@pytest.mark.parametrize("code", [None, "forbidden", "inconnu", "ok", "error"])
def test_issue_ok_sous_400_quel_que_soit_le_code(statut: int, code: str | None) -> None:
    assert outcome(statut, code) == "ok"


@pytest.mark.parametrize("code", sorted(REFUSAL_CODES))
@pytest.mark.parametrize("statut", [400, 403, 404, 409, 499, 500, 503, 599, None])
def test_issue_code_connu(statut: int | None, code: str) -> None:
    assert outcome(statut, code) == code


@pytest.mark.parametrize("statut", [500, 502, 599, None])
@pytest.mark.parametrize("code", [None, "", "inconnu", "Forbidden", "ok", "other", "error"])
def test_issue_erreur_en_5xx_ou_sans_statut(statut: int | None, code: str | None) -> None:
    assert outcome(statut, code) == "error"


@pytest.mark.parametrize("statut", [400, 401, 404, 418, 499])
@pytest.mark.parametrize("code", [None, "", "inconnu", "FORBIDDEN", "forbidden ", "ok", "error"])
def test_issue_autre_en_4xx_sans_code_connu(statut: int, code: str | None) -> None:
    assert outcome(statut, code) == "other"


def test_chaque_issue_rendue_est_permise() -> None:
    for statut in (None, 100, 200, 399, 400, 499, 500, 599):
        for code in (None, "x", *REFUSAL_CODES):
            assert outcome(statut, code) in OUTCOMES


# --- Mesure : cas valides --------------------------------------------------------------------


def test_requete_et_lecture_valides() -> None:
    requete = http(space="ventes", environment="PROD", rows=0, size=0)
    assert (requete.kind, requete.method, requete.status) == (Kind.HTTP, "GET", 200)
    lecture = atlas(rows=12, size=2048)
    assert (lecture.method, lecture.status, lecture.space, lecture.environment) == (None,) * 4


@pytest.mark.parametrize("genre", ["atlas", "http", "execution", "", None, 1])
def test_genre_hors_enumeration_refuse(genre: object) -> None:
    # Une chaîne égale à un genre n'en est pas un : refusée sous `kind`, jamais sous `method`.
    refus("kind", atlas, kind=genre)
    refus("kind", http, kind=genre)


def test_mesure_figee() -> None:
    mesure = http()
    with pytest.raises(dataclasses.FrozenInstanceError):
        mesure.operation = "autre"  # type: ignore[misc]


# --- Instant ---------------------------------------------------------------------------------


def test_instant_avec_fuseau() -> None:
    http(at=datetime(2026, 1, 1, tzinfo=timezone(timedelta(hours=-11))))
    http(at=datetime(1970, 1, 1, tzinfo=UTC))
    refus("at", at=datetime(2026, 11, 3, 12))
    refus("at", atlas, at=datetime(2026, 11, 3, 12))


# --- Opération -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "operation",
    [
        "a",
        "x" * 200,
        "unmatched",
        "catalog.list",
        "/api/spaces/{space_id}/parameters/{name}/values/{environment}",
        "A-Z_a-z.0-9/{}",
    ],
)
def test_operation_permise(operation: str) -> None:
    assert http(operation=operation).operation == operation
    assert atlas(operation=operation).operation == operation


@pytest.mark.parametrize(
    "operation",
    [
        "",
        "x" * 201,
        "/api/spaces?id=ventes",
        "/api/spaces/ventes#x",
        "/api/spaces/une valeur",
        "/api/spaces/%2F",
        "/api/spaces/é",
        "a\n",
        "\nb",
        "a:b",
        "alice@example.invalid",
        "a\x00",
    ],
)
def test_operation_refusee(operation: str) -> None:
    refus("operation", operation=operation)
    refus("operation", atlas, operation=operation)


# --- Issue -----------------------------------------------------------------------------------


@pytest.mark.parametrize("issue", sorted(OUTCOMES))
def test_issue_permise(issue: str) -> None:
    assert http(outcome=issue).outcome == issue


@pytest.mark.parametrize("issue", ["", "OK", "inconnu", "forbidden ", "500"])
def test_issue_refusee(issue: str) -> None:
    refus("outcome", outcome=issue)
    refus("outcome", atlas, outcome=issue)


# --- Durée -----------------------------------------------------------------------------------


@pytest.mark.parametrize("duree", [0.0, -0.0, 0, 5e-324, 1.5, 1e300, 86_400_000])
def test_duree_permise(duree: float) -> None:
    assert http(duration_ms=duree).duration_ms == duree


@pytest.mark.parametrize(
    "duree", [-5e-324, -0.001, -1, math.inf, -math.inf, math.nan, float("nan")]
)
def test_duree_refusee(duree: float) -> None:
    refus("duration_ms", duration_ms=duree)
    refus("duration_ms", atlas, duration_ms=duree)


# --- Méthode et statut -----------------------------------------------------------------------


@pytest.mark.parametrize("methode", sorted(METHODS))
def test_methode_permise(methode: str) -> None:
    assert http(method=methode).method == methode


@pytest.mark.parametrize("methode", ["get", "", "TRACE", "CONNECT", "GET ", "PROPFIND"])
def test_methode_refusee(methode: str) -> None:
    refus("method", method=methode)


def test_requete_sans_methode_refusee() -> None:
    refus("method", method=None)
    # La méthode est vérifiée avant le statut.
    refus("method", method=None, status=None)


def test_lecture_avec_methode_refusee() -> None:
    refus("method", atlas, method="GET")
    refus("method", atlas, method="get")


@pytest.mark.parametrize("statut", [100, 101, 200, 399, 400, 499, 500, 599])
def test_statut_permis(statut: int) -> None:
    assert http(status=statut).status == statut


@pytest.mark.parametrize("statut", [99, 0, -1, 600, 999, 32767, True, False])
def test_statut_refuse(statut: int) -> None:
    refus("status", status=statut)


def test_requete_sans_statut_refusee() -> None:
    refus("status", status=None)


def test_lecture_avec_statut_refusee() -> None:
    refus("status", atlas, status=200)


@pytest.mark.parametrize("statut", [200.5, 200.0, "200", 404.0])
def test_statut_non_entier_refuse(statut: object) -> None:
    refus("status", status=statut)


# --- Espace et environnement -----------------------------------------------------------------


@pytest.mark.parametrize("espace", [None, "ab", "a1", "ventes", "a" * 40, "a-b", "0" * 2])
def test_espace_permis(espace: str | None) -> None:
    assert http(space=espace).space == espace
    assert atlas(space=espace).space == espace


@pytest.mark.parametrize(
    "espace", ["", "a", "a" * 41, "-ab", "ab-", "Ventes", "ven_tes", "ven tes", "vé", "a/b"]
)
def test_espace_refuse(espace: str) -> None:
    refus("space", space=espace)
    refus("space", atlas, space=espace)


@pytest.mark.parametrize("environnement", [None, *(e.value for e in ENVIRONMENTS)])
def test_environnement_permis(environnement: str | None) -> None:
    assert http(environment=environnement).environment == environnement


@pytest.mark.parametrize("environnement", ["", "dev", "Prod", "QA", "PRODUCTION", " DEV"])
def test_environnement_refuse(environnement: str) -> None:
    refus("environment", environment=environnement)
    refus("environment", atlas, environment=environnement)


# --- Lignes et taille ------------------------------------------------------------------------


@pytest.mark.parametrize("champ", ["rows", "size"])
@pytest.mark.parametrize("nombre", [None, 0, 1, 2**63 - 1])
def test_compte_permis(champ: str, nombre: int | None) -> None:
    assert getattr(atlas(**{champ: nombre}), champ) == nombre
    assert getattr(http(**{champ: nombre}), champ) == nombre


@pytest.mark.parametrize("champ", ["rows", "size"])
@pytest.mark.parametrize("nombre", [-1, -(2**63), True, False])
def test_compte_refuse(champ: str, nombre: int) -> None:
    refus(champ, **{champ: nombre})
    refus(champ, atlas, **{champ: nombre})


@pytest.mark.parametrize("champ", ["rows", "size"])
@pytest.mark.parametrize("nombre", [1.5, 0.0, 2.0, "3", math.inf, math.nan])
def test_compte_non_entier_refuse(champ: str, nombre: object) -> None:
    refus(champ, **{champ: nombre})
    refus(champ, atlas, **{champ: nombre})


# --- Ordre des vérifications ----------------------------------------------------------------


def test_premier_champ_fautif_nomme() -> None:
    # Chaque mesure cumule des fautes : le champ nommé est le premier dans l'ordre des contrôles.
    naif = datetime(2026, 1, 1)
    refus("at", at=naif, kind="http", operation="", outcome="?", duration_ms=-1)
    refus("kind", kind="http", operation="", outcome="?", duration_ms=-1, method="x")
    refus("operation", operation="", outcome="?", duration_ms=-1, method="x")
    refus("outcome", outcome="?", duration_ms=-1, method="x")
    refus("duration_ms", duration_ms=-1, method="x", status=0)
    refus("status", status=0, space="X")
    refus("space", space="X", environment="x")
    refus("environment", environment="x", rows=-1)
    refus("rows", rows=-1, size=-1)
    refus("rows", rows=1.5, size=1.5)


# --- Lignes JSON -----------------------------------------------------------------------------


def test_json_d_une_requete() -> None:
    decale = datetime(2026, 11, 3, 14, 30, tzinfo=timezone(timedelta(hours=2)))
    mesure = http(at=decale, space="ventes", environment="TEST", rows=3, size=512, status=404)
    assert mesure.to_json() == {
        "at": "2026-11-03T12:30:00+00:00",
        "kind": "http",
        "operation": "/api/spaces/{space_id}/members",
        "method": "GET",
        "status": 404,
        "outcome": "ok",
        "space": "ventes",
        "environment": "TEST",
        "duration_ms": 12.5,
        "rows": 3,
        "size": 512,
    }


@pytest.mark.parametrize(
    "decalage", [timedelta(hours=14), timedelta(hours=-3, minutes=-30), timedelta(0)]
)
def test_json_instant_en_utc(decalage: timedelta) -> None:
    # La ligne JSON dit l'instant comme la table : en UTC, quel que soit le fuseau reçu.
    instant = datetime(2026, 11, 3, 12, 0, 0, 250, tzinfo=UTC)
    mesure = http(at=instant.astimezone(timezone(decalage)))
    assert mesure.to_json()["at"] == "2026-11-03T12:00:00.000250+00:00"
    assert datetime.fromisoformat(mesure.to_json()["at"]) == instant
    # La mesure elle-même garde l'instant reçu.
    assert mesure.at.utcoffset() == decalage


def test_json_d_une_lecture() -> None:
    assert atlas().to_json() == {
        "at": MAINTENANT.isoformat(),
        "kind": "atlas",
        "operation": "catalog.list",
        "method": None,
        "status": None,
        "outcome": "ok",
        "space": None,
        "environment": None,
        "duration_ms": 3.0,
        "rows": None,
        "size": None,
    }


def test_json_les_champs_de_la_table_et_rien_de_plus() -> None:
    colonnes = {c.name for c in telemetry.columns} - {"id"}
    cles = set(http().to_json())
    # Seul l'espace change de nom : `space` dans la ligne JSON, `space_id` dans la table.
    assert cles == (colonnes - {"space_id"}) | {"space"}
    assert cles == {f.name for f in dataclasses.fields(Measure)}
    json.dumps(http().to_json(), allow_nan=False)


def test_json_d_un_resume() -> None:
    resume = OperationSummary(
        kind=Kind.ATLAS,
        operation="catalog.list",
        method=None,
        count=7,
        errors=2,
        refusals=0,
        duration_p50=1.5,
        duration_p95=9.25,
        duration_max=10.0,
        size_p50=None,
        size_max=None,
        rows_p50=4.5,
        rows_max=9,
    )
    assert resume.to_json() == {
        "kind": "atlas",
        "operation": "catalog.list",
        "method": None,
        "count": 7,
        "errors": 2,
        "refusals": 0,
        "duration_ms": {"p50": 1.5, "p95": 9.25, "max": 10.0},
        "size": {"p50": None, "max": None},
        "rows": {"p50": 4.5, "max": 9},
    }


def test_resume_vide() -> None:
    resume = Summary(Window.DAY, MAINTENANT - timedelta(days=1), MAINTENANT, None, None, ())
    assert resume.operations == () and resume.oldest is None
    with pytest.raises(dataclasses.FrozenInstanceError):
        resume.operations = ()  # type: ignore[misc]


def test_operations_execution_sont_fermees() -> None:
    for operation in ("semantic.execute", "contextual.compute"):
        assert (
            Measure(
                at=MAINTENANT, kind=Kind.EXECUTION, operation=operation, outcome="ok", duration_ms=1
            ).operation
            == operation
        )
    with pytest.raises(InvalidMeasure, match="operation"):
        Measure(
            at=MAINTENANT,
            kind=Kind.EXECUTION,
            operation="valeur-secrete",
            outcome="ok",
            duration_ms=1,
        )
