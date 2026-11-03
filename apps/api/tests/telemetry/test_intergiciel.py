"""Mesure de chaque requête par l'intergiciel (plan 11, 11.2 ; T2, T3).

Deux étages : l'intergiciel seul, autour d'applications ASGI minimales qui fixent le statut,
les en-têtes et les morceaux du corps ; puis le serveur réel en mode local, où chaque requête
doit donner exactement une mesure, au gabarit de sa route.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import Mock

import pytest
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from fastapi.testclient import TestClient
from skifer_board.catalog import CatalogService
from skifer_board.server import create_app
from skifer_board.telemetry import Kind, Measure
from skifer_board.telemetry.asgi import ERROR_BODY_LIMIT, UNMATCHED, TelemetryMiddleware
from starlette.responses import PlainTextResponse
from starlette.routing import BaseRoute, Host, Mount, Route
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .conftest import Collecteur, Journal

INSTANT = datetime(2026, 11, 3, 9, 15, tzinfo=UTC)
VALEURS = "/api/spaces/{space_id}/parameters/{name}/values/{environment}"
DOCUMENT = "/api/spaces/{space_id}/catalog/{document_id}"


def _fin(_: Any) -> PlainTextResponse:
    """Point d'arrivée jamais appelé : seules les routes donnent les gabarits."""
    return PlainTextResponse("")


ROUTES: list[BaseRoute] = [
    Route(VALEURS, _fin, methods=["PUT", "DELETE"]),
    Route(DOCUMENT, _fin, methods=["GET"]),
    Route("/api/spaces", _fin, methods=["GET"]),
    Route("/api/spaces", _fin, methods=["POST"]),
]


def reponse(
    statut: int,
    *morceaux: bytes,
    type_contenu: bytes | None = b"application/json",
) -> ASGIApp:
    """Application qui répond `statut` avec ces morceaux de corps, sans rien lire."""

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        entetes = [] if type_contenu is None else [(b"content-type", type_contenu)]
        await send({"type": "http.response.start", "status": statut, "headers": entetes})
        derniers = list(morceaux) or [b""]
        for rang, morceau in enumerate(derniers):
            await send(
                {
                    "type": "http.response.body",
                    "body": morceau,
                    "more_body": rang < len(derniers) - 1,
                }
            )

    return app


def portee(chemin: str, methode: str = "GET", type_: str = "http") -> Scope:
    return {
        "type": type_,
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": methode,
        "scheme": "https",
        "server": ("board.example.invalid", 443),
        "client": ("203.0.113.77", 50000),
        "root_path": "",
        "path": chemin,
        "raw_path": chemin.encode(),
        "query_string": b"q=requete-sentinelle",
        "headers": [(b"host", b"board.example.invalid"), (b"cookie", b"jeton=sentinelle")],
    }


def appeler(
    app: ASGIApp,
    chemin: str = "/api/spaces/finance/catalog/doc-sentinelle",
    methode: str = "GET",
    routes: list[BaseRoute] | None = None,
    collecteur: Collecteur | None = None,
) -> tuple[list[Message], Collecteur]:
    collecte = Collecteur() if collecteur is None else collecteur
    mesure = TelemetryMiddleware(
        app, ROUTES if routes is None else routes, collecte, lambda: INSTANT
    )
    envoyes: list[Message] = []

    async def recevoir() -> Message:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def envoyer(message: Message) -> None:
        envoyes.append(message)

    asyncio.run(mesure(portee(chemin, methode), recevoir, envoyer))
    return envoyes, collecte


def seule(collecte: Collecteur) -> Measure:
    assert len(collecte.mesures) == 1
    return collecte.mesures[0]


# --- Intergiciel seul ------------------------------------------------------------------------


def test_une_mesure_au_gabarit_avec_ses_champs(journal: Journal) -> None:
    envoyes, collecte = appeler(reponse(200, b'{"a":', b"1}"))
    mesure = seule(collecte)
    assert mesure == Measure(
        at=INSTANT,
        kind=Kind.HTTP,
        operation=DOCUMENT,
        outcome="ok",
        duration_ms=mesure.duration_ms,
        method="GET",
        status=200,
        space="finance",
        environment=None,
        rows=None,
        size=7,
    )
    assert 0 <= mesure.duration_ms < 60_000
    # La réponse part inchangée, message par message.
    assert [m["type"] for m in envoyes] == [
        "http.response.start",
        "http.response.body",
        "http.response.body",
    ]
    assert b"".join(m["body"] for m in envoyes[1:]) == b'{"a":1}'
    # Une ligne JSON par mesure, rien de la requête.
    assert journal.mesures() == [mesure.to_json()]
    assert "sentinelle" not in "".join(journal.textes())
    assert "203.0.113.77" not in "".join(journal.textes())


def test_duree_jusqu_au_dernier_octet_envoye(monkeypatch: pytest.MonkeyPatch) -> None:
    """La durée court de la réception jusqu'au dernier morceau effectivement envoyé."""
    compteur = [100.0]
    # Le module `time` est celui de l'intergiciel : seule son horloge de durée est remplacée.
    monkeypatch.setattr(time, "perf_counter", lambda: compteur[0])

    async def lente(scope: Scope, receive: Receive, send: Send) -> None:
        compteur[0] += 0.1  # traitement
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"x", "more_body": False})

    mesure = TelemetryMiddleware(lente, ROUTES, Collecteur(), lambda: INSTANT)
    collecte = mesure.recorder
    assert isinstance(collecte, Collecteur)

    async def recevoir() -> Message:
        return {"type": "http.request"}

    async def envoyer(message: Message) -> None:
        if message["type"] == "http.response.body":
            compteur[0] += 0.2  # écriture lente du dernier octet

    asyncio.run(mesure(portee("/api/spaces"), recevoir, envoyer))
    assert seule(collecte).duration_ms == pytest.approx(300.0)


@pytest.mark.parametrize(
    ("chemin", "espace_attendu", "environnement"),
    [
        ("/api/spaces/finance/parameters/secret_x/values/DEV", "finance", "DEV"),
        ("/api/spaces/rh/parameters/secret_x/values/PROD", "rh", "PROD"),
        ("/api/spaces/finance/parameters/secret_x/values/TEST", "finance", "TEST"),
        # Hors de la liste fermée : ni l'environnement ni l'espace ne sont gardés.
        ("/api/spaces/finance/parameters/secret_x/values/dev", "finance", None),
        ("/api/spaces/finance/parameters/secret_x/values/PREPROD", "finance", None),
        ("/api/spaces/Finance/parameters/secret_x/values/DEV", None, "DEV"),
        ("/api/spaces/alice@example.invalid/parameters/x/values/DEV", None, "DEV"),
        ("/api/spaces/-finance/parameters/x/values/DEV", None, "DEV"),
        ("/api/spaces/f/parameters/x/values/DEV", None, "DEV"),
        (f"/api/spaces/{'a' * 41}/parameters/x/values/DEV", None, "DEV"),
        ("/api/spaces/fin%20ance/parameters/x/values/DEV", None, "DEV"),
    ],
)
def test_espace_et_environnement_seulement_bien_formes(
    chemin: str, espace_attendu: str | None, environnement: str | None
) -> None:
    _, collecte = appeler(reponse(204), chemin, "PUT")
    mesure = seule(collecte)
    assert mesure.operation == VALEURS
    assert (mesure.space, mesure.environment) == (espace_attendu, environnement)
    assert "secret_x" not in json.dumps(mesure.to_json())


def test_route_sans_espace_ni_environnement() -> None:
    _, collecte = appeler(reponse(200, b"[]"), "/api/spaces")
    mesure = seule(collecte)
    assert (mesure.operation, mesure.space, mesure.environment) == ("/api/spaces", None, None)


def test_methode_refusee_garde_le_gabarit() -> None:
    """Une route qui ne refuse que la méthode (405) donne son gabarit."""
    _, collecte = appeler(
        reponse(405, b'{"error":{"code":"method_not_allowed"}}'),
        "/api/spaces/finance/catalog/doc-sentinelle",
        "DELETE",
    )
    mesure = seule(collecte)
    assert (mesure.operation, mesure.method, mesure.status) == (DOCUMENT, "DELETE", 405)
    assert mesure.outcome == "method_not_allowed"
    assert mesure.space == "finance"


def test_correspondance_complete_preferee_a_la_partielle() -> None:
    """Deux routes au même chemin : la seconde prend le POST, son gabarit est rendu."""
    routes: list[BaseRoute] = [
        Route("/api/{partielle}", _fin, methods=["GET"]),
        Route("/api/spaces", _fin, methods=["POST"]),
    ]
    _, collecte = appeler(reponse(201), "/api/spaces", "POST", routes)
    assert seule(collecte).operation == "/api/spaces"
    # Sans route complète, la première partielle donne le gabarit.
    routes = [Route("/api/{premiere}", _fin, methods=["GET"]), Route("/api/{seconde}", _fin)]
    _, collecte = appeler(reponse(405), "/api/x", "PUT", routes)
    assert seule(collecte).operation == "/api/{premiere}"


@pytest.mark.parametrize(
    "chemin",
    ["/api/inconnue-sentinelle", "/", "/api/spaces/finance/catalog/a/b/c", "/favicon.ico"],
)
def test_aucune_route_unmatched_sans_chemin(chemin: str, journal: Journal) -> None:
    _, collecte = appeler(reponse(404, b'{"error":{"code":"route_not_found"}}'), chemin)
    mesure = seule(collecte)
    assert mesure.operation == UNMATCHED == "unmatched"
    assert (mesure.space, mesure.environment, mesure.outcome) == (None, None, "route_not_found")
    assert chemin not in json.dumps(mesure.to_json()) or chemin == "/"
    assert "sentinelle" not in "".join(journal.textes())


def test_route_sans_chemin_ignoree_et_montage_par_son_prefixe() -> None:
    """Une route d'hôte n'a pas de gabarit de chemin : elle ne donne pas l'opération."""

    hote = Host("board.example.invalid", app=reponse(200))
    _, collecte = appeler(reponse(200), "/api/spaces", "GET", [hote, *ROUTES])
    assert seule(collecte).operation == "/api/spaces"
    _, collecte = appeler(reponse(200), "/api/autre", "GET", [hote])
    assert seule(collecte).operation == UNMATCHED
    # Un montage donne son préfixe, jamais le reste du chemin.
    montage = Mount("/static", app=reponse(200))
    _, collecte = appeler(reponse(200), "/static/doc-sentinelle.css", "GET", [montage])
    assert seule(collecte).operation == "/static"


@pytest.mark.parametrize(
    ("methode", "attendue"),
    [
        ("GET", "GET"),
        ("POST", "POST"),
        ("PUT", "PUT"),
        ("PATCH", "PATCH"),
        ("DELETE", "DELETE"),
        ("HEAD", "HEAD"),
        ("OPTIONS", "OPTIONS"),
        ("PROPFIND", "OTHER"),
        ("get", "OTHER"),
        ("BREW", "OTHER"),
        ("X" * 50, "OTHER"),
    ],
)
def test_methode_hors_liste_rangee_sous_other(methode: str, attendue: str) -> None:
    _, collecte = appeler(reponse(405), "/api/spaces", methode)
    assert seule(collecte).method == attendue


# --- Issue lue dans le corps -----------------------------------------------------------------


def corps_erreur(code: object, **champs: object) -> bytes:
    return json.dumps({"error": {"code": code, **champs}}).encode()


@pytest.mark.parametrize(
    ("statut", "morceaux", "type_contenu", "issue"),
    [
        (403, [corps_erreur("forbidden", required="admin")], b"application/json", "forbidden"),
        (404, [corps_erreur("space_not_found")], b"application/json", "space_not_found"),
        # Morceaux successifs, en-tête avec jeu de caractères.
        (
            401,
            [b'{"error": {"co', b'de": "unauthenticated", "login_url": "/auth/login"}}'],
            b"application/json; charset=utf-8",
            "unauthenticated",
        ),
        (503, [corps_erreur("catalog_unavailable")], b"application/json", "catalog_unavailable"),
        # Code hors de la liste : `other` pour un refus, `error` pour une panne.
        (409, [corps_erreur("code-secret-de-alice")], b"application/json", "other"),
        (500, [corps_erreur("code-secret-de-alice")], b"application/json", "error"),
        (400, [corps_erreur("FORBIDDEN")], b"application/json", "other"),
        (400, [corps_erreur(403)], b"application/json", "other"),
        (400, [corps_erreur(["forbidden"])], b"application/json", "other"),
        (400, [corps_erreur(None)], b"application/json", "other"),
        # Corps non JSON, ou JSON d'une autre forme.
        (403, [b"forbidden"], b"application/json", "other"),
        (403, [b'{"error": {"code": "forbidden"'], b"application/json", "other"),
        (403, [b'["forbidden"]'], b"application/json", "other"),
        (403, [b'"forbidden"'], b"application/json", "other"),
        (403, [b'{"error": "forbidden"}'], b"application/json", "other"),
        (403, [b'{"code": "forbidden"}'], b"application/json", "other"),
        (403, [b"\xff\xfe\x00"], b"application/json", "other"),
        (403, [b""], b"application/json", "other"),
        (502, [b"<html>panne</html>"], b"application/json", "error"),
        # Corps JSON annoncé autrement : il n'est pas lu.
        (403, [corps_erreur("forbidden")], b"text/plain", "other"),
        (403, [corps_erreur("forbidden")], b"application/problem+json", "other"),
        (403, [corps_erreur("forbidden")], None, "other"),
        (500, [corps_erreur("internal_error")], b"text/html", "error"),
        # Un succès n'a pas de code de refus, quel que soit son corps.
        (200, [corps_erreur("forbidden")], b"application/json", "ok"),
        (302, [corps_erreur("forbidden")], b"application/json", "ok"),
    ],
)
def test_issue_lue_dans_le_corps(
    statut: int, morceaux: list[bytes], type_contenu: bytes | None, issue: str, journal: Journal
) -> None:
    _, collecte = appeler(reponse(statut, *morceaux, type_contenu=type_contenu))
    mesure = seule(collecte)
    assert (mesure.status, mesure.outcome) == (statut, issue)
    assert mesure.size == sum(map(len, morceaux))
    assert "secret" not in "".join(journal.textes())


def test_corps_de_refus_trop_long_en_plusieurs_morceaux() -> None:
    """Au-delà de `ERROR_BODY_LIMIT`, la lecture s'arrête : le code n'est plus lu."""
    corps = corps_erreur("forbidden", detail="x" * ERROR_BODY_LIMIT)
    morceaux = [corps[:ERROR_BODY_LIMIT], corps[ERROR_BODY_LIMIT:]]
    _, collecte = appeler(reponse(403, *morceaux))
    mesure = seule(collecte)
    assert (mesure.outcome, mesure.size) == ("other", len(corps))
    # Juste sous la limite, en plusieurs morceaux, le code est lu.
    corps = corps_erreur("forbidden", detail="x" * (ERROR_BODY_LIMIT - 100))
    assert len(corps) < ERROR_BODY_LIMIT
    _, collecte = appeler(reponse(403, corps[:10], corps[10:]))
    assert seule(collecte).outcome == "forbidden"


def test_corps_de_refus_trop_long_en_un_seul_morceau() -> None:
    corps = corps_erreur("forbidden", detail="x" * (4 * ERROR_BODY_LIMIT))
    _, collecte = appeler(reponse(403, corps))
    assert seule(collecte).outcome == "other"


def corps_de_taille(taille: int, code: str = "forbidden") -> bytes:
    """Corps de refus JSON valide d'exactement `taille` octets."""
    vide = corps_erreur(code, detail="")
    corps = corps_erreur(code, detail="x" * (taille - len(vide)))
    assert len(corps) == taille
    return corps


@pytest.mark.parametrize("decoupe", [None, 1, ERROR_BODY_LIMIT // 2, ERROR_BODY_LIMIT - 1])
def test_bornes_exactes_de_la_lecture_du_code(decoupe: int | None) -> None:
    """`ERROR_BODY_LIMIT` octets : le code est lu ; un octet de plus : il ne l'est plus. D'un
    seul morceau ou en deux."""
    for taille, statut, issue in (
        (ERROR_BODY_LIMIT, 403, "forbidden"),
        (ERROR_BODY_LIMIT + 1, 403, "other"),
        (ERROR_BODY_LIMIT, 503, "catalog_unavailable"),
        (ERROR_BODY_LIMIT + 1, 503, "error"),
    ):
        code = "forbidden" if statut == 403 else "catalog_unavailable"
        corps = corps_de_taille(taille, code)
        morceaux = [corps] if decoupe is None else [corps[:decoupe], corps[decoupe:]]
        _, collecte = appeler(reponse(statut, *morceaux))
        mesure = seule(collecte)
        assert (mesure.outcome, mesure.size) == (issue, taille), (taille, statut, decoupe)


def test_corps_vide_puis_trop_long_en_morceaux() -> None:
    """Des morceaux vides ne comptent pas ; un dernier morceau au-delà de la limite suffit."""
    corps = corps_de_taille(ERROR_BODY_LIMIT + 1)
    _, collecte = appeler(reponse(403, b"", corps[:-1], b"", corps[-1:]))
    assert seule(collecte).outcome == "other"
    _, collecte = appeler(reponse(403, b"", corps[:-1], b""))
    assert seule(collecte).outcome == "other"  # JSON tronqué, non lisible


class Tampon(bytearray):
    """Tampon du corps de refus, qui retient la plus grande taille atteinte."""

    tailles: list[int] = []

    def extend(self, morceau: Any) -> None:
        super().extend(morceau)
        Tampon.tailles.append(len(self))


def test_corps_tres_long_jamais_garde_en_entier(monkeypatch: pytest.MonkeyPatch) -> None:
    """Le tampon du corps de refus ne dépasse jamais `ERROR_BODY_LIMIT + 1` octets, même pour
    un corps de plusieurs mégaoctets d'un seul morceau ou en morceaux."""
    from skifer_board.telemetry import asgi

    Tampon.tailles = []
    monkeypatch.setattr(asgi, "bytearray", Tampon, raising=False)
    tres_long = corps_de_taille(4 * 1024 * 1024)
    for morceaux in ([tres_long], [tres_long[:100], tres_long[100:]], [tres_long[:7]] * 5000):
        _, collecte = appeler(reponse(403, *morceaux))
        assert seule(collecte).size == sum(map(len, morceaux))
    assert Tampon.tailles  # le tampon espion a bien servi
    assert max(Tampon.tailles) == ERROR_BODY_LIMIT + 1


def test_exception_de_l_application_mesuree_en_500_et_remontee(journal: Journal) -> None:
    async def panne(scope: Scope, receive: Receive, send: Send) -> None:
        raise RuntimeError("secret de la panne")

    with pytest.raises(RuntimeError, match="secret de la panne"):
        appeler(panne)
    (ligne,) = journal.mesures()
    assert (ligne["status"], ligne["outcome"], ligne["size"]) == (500, "error", 0)
    assert ligne["operation"] == DOCUMENT
    assert "secret" not in "".join(journal.textes())


def test_exception_apres_l_en_tete_garde_le_statut_envoye() -> None:
    async def panne(scope: Scope, receive: Receive, send: Send) -> None:
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"abc", "more_body": True})
        raise RuntimeError("coupure")

    collecte = Collecteur()
    with pytest.raises(RuntimeError, match="coupure"):
        appeler(panne, collecteur=collecte)
    mesure = seule(collecte)
    assert (mesure.status, mesure.size) == (200, 3)


def test_autres_messages_transmis_sans_compter_dans_la_taille() -> None:
    """Un message ni d'en-tête ni de corps (fin d'en-têtes de queue) passe tel quel."""
    queue = {
        "type": "http.response.trailers",
        "headers": [(b"x-total", b"9")],
        "more_trailers": False,
    }

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        await send({"type": "http.response.start", "status": 200, "headers": [], "trailers": True})
        await send({"type": "http.response.body", "body": b"abcd", "more_body": False})
        await send(queue)

    envoyes, collecte = appeler(app)
    assert envoyes[-1] == queue
    assert seule(collecte).size == 4


def test_gabarit_hors_format_perdu_et_compte(journal: Journal) -> None:
    """Un gabarit hors du format des opérations (`~`) : la mesure est perdue, la perte est
    journalisée, la réponse part inchangée."""
    routes: list[BaseRoute] = [Route("/auth/rappel~{x}", _fin, methods=["GET"])]
    envoyes, collecte = appeler(
        reponse(200, b"ok", type_contenu=b"text/plain"), "/auth/rappel~1", "GET", routes
    )
    assert collecte.mesures == []
    assert collecte.pertes == 1
    assert [m.get("body") for m in envoyes] == [None, b"ok"]
    assert envoyes[0]["status"] == 200
    assert journal.mesures() == []
    assert journal.avertissements() == [{"telemetry": "measures_dropped", "count": 1}]


@pytest.mark.parametrize("type_", ["websocket", "lifespan"])
def test_hors_http_rien_n_est_mesure(type_: str) -> None:
    appele = Mock()

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        appele(scope["type"])

    collecte = Collecteur()
    mesure = TelemetryMiddleware(app, ROUTES, collecte, lambda: INSTANT)

    async def recevoir() -> Message:
        return {"type": f"{type_}.connect"}

    async def envoyer(message: Message) -> None:
        del message

    asyncio.run(mesure(portee("/api/spaces", type_=type_), recevoir, envoyer))
    appele.assert_called_once_with(type_)
    assert collecte.mesures == [] and collecte.pertes == 0


# --- Serveur réel, mode local ----------------------------------------------------------------

LOCAL = "http://127.0.0.1:8000"


@pytest.fixture
def local(service: CatalogService, collecteur: Collecteur) -> Iterator[TestClient]:
    app = create_app(service, recorder=collecteur)
    with TestClient(app, base_url=LOCAL, raise_server_exceptions=False) as client:
        yield client


def test_une_mesure_par_requete_en_mode_local(
    local: TestClient, collecteur: Collecteur, journal: Journal
) -> None:
    avant = datetime.now(UTC)
    cat, origine = "/api/spaces/{space_id}/catalog", {"Origin": LOCAL}
    requetes: list[tuple[str, str, dict[str, str], str, int, str]] = [
        ("GET", "/api/me", {}, "/api/me", 200, "ok"),
        ("GET", "/api/spaces", {}, "/api/spaces", 200, "ok"),
        ("GET", "/api/spaces/local", {}, "/api/spaces/{space_id}", 200, "ok"),
        ("GET", "/api/spaces/local/catalog", {}, cat, 200, "ok"),
        ("GET", "/api/spaces/local/catalog/revenu-net", {}, DOCUMENT, 200, "ok"),
        ("GET", "/api/spaces/local/catalog/doc-absent", {}, DOCUMENT, 404, "document_not_found"),
        ("GET", "/api/spaces/autre/catalog", {}, cat, 404, "space_not_found"),
        ("GET", "/api/spaces/local/members", {}, cat[:-7] + "members", 409, "local_mode"),
        # Garde d'identité avant le routage (origine absente), puis méthode refusée.
        ("POST", "/api/spaces/local/catalog", {}, cat, 403, "origin_refused"),
        ("POST", "/api/spaces/local/catalog", origine, cat, 405, "method_not_allowed"),
        ("GET", "/api/inconnue/doc-absent", {}, UNMATCHED, 404, "route_not_found"),
        ("GET", "/api/spaces/local/catalog?status=valeur-x", {}, cat, 400, "invalid_parameter"),
    ]
    reponses = [local.request(m, chemin, headers=h) for m, chemin, h, *_ in requetes]
    apres = datetime.now(UTC)
    mesures = collecteur.http()
    assert len(mesures) == len(requetes)
    for mesure, reponse_, (methode, chemin, _, gabarit, statut, issue) in zip(
        mesures, reponses, requetes, strict=True
    ):
        assert reponse_.status_code == statut, (chemin, reponse_.text)
        assert (mesure.operation, mesure.method, mesure.status, mesure.outcome) == (
            gabarit,
            methode,
            statut,
            issue,
        )
        assert mesure.size == len(reponse_.content)
        assert avant <= mesure.at <= apres
        attendu = chemin.split("/")[3] if gabarit.startswith("/api/spaces/{space_id}") else None
        assert mesure.space == attendu
        assert mesure.environment is None and mesure.rows is None
    assert [ligne for ligne in journal.mesures() if ligne["kind"] == "http"] == [
        m.to_json() for m in mesures
    ]
    textes = "".join(journal.textes())
    for interdit in ("revenu-net", "doc-absent", "inconnue", "valeur-x", "testclient"):
        assert interdit not in textes


def test_methode_inconnue_sur_le_serveur(local: TestClient, collecteur: Collecteur) -> None:
    reponse_ = local.request("PROPFIND", "/api/spaces/local/catalog", headers={"Origin": LOCAL})
    assert reponse_.status_code == 405
    (mesure,) = collecteur.http()
    assert (mesure.method, mesure.operation) == ("OTHER", "/api/spaces/{space_id}/catalog")


def test_panne_d_une_route_mesuree_en_500(
    local: TestClient,
    service: CatalogService,
    collecteur: Collecteur,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(service, "list", Mock(side_effect=RuntimeError("secret")))
    reponse_ = local.get("/api/spaces/local/catalog")
    assert (reponse_.status_code, reponse_.json()) == (500, {"error": {"code": "internal_error"}})
    (mesure,) = collecteur.http()
    assert (mesure.status, mesure.outcome) == (500, "error")


def test_sans_enregistreur_le_journal_seul(service: CatalogService, journal: Journal) -> None:
    """Sans enregistreur fourni, `create_app` mesure quand même, vers le journal (T4)."""
    with TestClient(create_app(service), base_url=LOCAL) as client:
        assert client.get("/api/me").status_code == 200
        assert client.get("/api/spaces").status_code == 200
    assert [(ligne["operation"], ligne["status"]) for ligne in journal.mesures()] == [
        ("/api/me", 200),
        ("/api/spaces", 200),
    ]


class Espion(Collecteur):
    def __init__(self) -> None:
        super().__init__()
        self.cycle: list[str] = []

    def start(self) -> None:
        self.cycle.append("start")
        super().start()

    def stop(self) -> None:
        self.cycle.append("stop")
        super().stop()


def test_le_cycle_de_vie_demarre_et_arrete_l_enregistreur(
    service: CatalogService, journal: Journal
) -> None:
    espion = Espion()
    app = create_app(service, recorder=espion)
    assert espion.cycle == []
    with TestClient(app, base_url=LOCAL) as client:
        assert espion.cycle == ["start"]
        client.get("/api/me")
    assert espion.cycle == ["start", "stop"]
    # Le cycle de vie lui-même n'est pas une requête.
    assert [m.operation for m in espion.mesures] == ["/api/me"]


def test_l_arret_suit_meme_une_panne_au_demarrage(service: CatalogService) -> None:
    class Fragile(Espion):
        def start(self) -> None:
            super().start()
            raise RuntimeError("démarrage")

    fragile = Fragile()
    with (
        pytest.raises(RuntimeError, match="démarrage"),
        TestClient(create_app(service, recorder=fragile)),
    ):
        pass  # le démarrage échoue avant
    assert fragile.cycle == ["start"]


def test_lectures_d_atlas_et_requete_mesurees(
    espace: Path, tmp_path: Path, collecteur: Collecteur, journal: Journal
) -> None:
    """Le catalogue branché sur l'enregistreur : une lecture d'Atlas et une requête par appel."""
    from skifer_board.catalog import CatalogConfig

    service_mesure = CatalogService(
        CatalogConfig(espace, tmp_path / "etat"), lambda: INSTANT, measure=collecteur.submit
    )
    with TestClient(create_app(service_mesure, recorder=collecteur), base_url=LOCAL) as client:
        assert client.get("/api/spaces/local/catalog/revenu-net").status_code == 200
    genres = [(m.kind, m.operation) for m in collecteur.mesures]
    assert genres == [(Kind.ATLAS, "atlas.document"), (Kind.HTTP, DOCUMENT)]
    assert "revenu-net" not in json.dumps([m.to_json() for m in collecteur.mesures])
