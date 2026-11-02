"""Contrat HTTP du catalogue Atlas, sans réseau ni serveur réel (plan 04, 4.2)."""

import json
import os
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock

import pytest
import uvicorn
from catalog.conftest import INSTANT
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from catalog.test_service import ORDRE
from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx2 import Response
from skifer_board import server
from skifer_board.catalog import AtlasStatus, CatalogConfig, CatalogService, DocumentKind

CONTRATS = Path(__file__).resolve().parents[3] / "contracts" / "catalogue"
# Exemples du plan 04 ; ceux du plan 05 (`versions-*`, `ecart-*`) sont rejoués par
# test_server_versions.py.
EXEMPLES = sorted(
    p for p in CONTRATS.glob("*.json") if not p.stem.startswith(("versions-", "ecart-"))
)
DETAIL_ABSENT = "Le clone de l'espace Atlas est introuvable à l'emplacement configuré."


@pytest.fixture
def client(service: CatalogService, tmp_path: Path) -> Iterator[TestClient]:
    """Vérifie l'absence de chemins privés sur chaque réponse, erreurs comprises."""
    with TestClient(server.create_app(service), raise_server_exceptions=False) as connexion:

        def verifier_chemins(reponse: Response) -> None:
            # Le hook reçoit la réponse httpx2 avant sa lecture automatique.
            reponse.read()
            for chemin in (tmp_path, service.config.repository, service.config.state_dir):
                assert str(chemin) not in reponse.text

        connexion.event_hooks["response"].append(verifier_chemins)
        yield connexion


@pytest.mark.parametrize(
    "parametres",
    [
        {},
        {"q": "RECETTES CONSOLIDEES"},
        {"domain": "finance"},
        {"owner": "claire.m"},
        {"status": "draft"},
        {"status": "invalid"},
        {"status": "needs_curation"},
        {"kind": "concept"},
        {"kind": "kpi"},
        {"domain": ""},
        {"owner": ""},
        {"q": ""},
        {
            "q": "Revenu",
            "domain": "finance",
            "owner": "claire.m",
            "status": "validated",
            "kind": "kpi",
        },
        {"domain": "finance", "owner": "marc.d", "status": "validated", "kind": "kpi"},
    ],
)
def test_liste_et_transmission_des_filtres(
    client: TestClient,
    service: CatalogService,
    monkeypatch: pytest.MonkeyPatch,
    parametres: dict[str, str],
) -> None:
    """Chaque filtre est transmis et le JSON est celui du service avec les mêmes arguments."""
    statut, nature = parametres.get("status"), parametres.get("kind")
    arguments = {
        "q": parametres.get("q"),
        "domain": parametres.get("domain") or None,
        "owner": parametres.get("owner") or None,
        "status": AtlasStatus(statut) if statut else None,
        "kind": DocumentKind(nature) if nature else None,
    }
    attendu = service.list(
        q=parametres.get("q"),
        domain=parametres.get("domain") or None,
        owner=parametres.get("owner") or None,
        status=AtlasStatus(statut) if statut else None,
        kind=DocumentKind(nature) if nature else None,
    )
    espion = Mock(wraps=service.list)
    monkeypatch.setattr(service, "list", espion)
    reponse = client.get("/api/catalog", params=parametres)
    assert reponse.status_code == 200
    assert reponse.json() == server.to_json(attendu)
    espion.assert_called_once_with(**arguments)
    assert datetime.fromisoformat(reponse.json()["provenance"]["read_at"]) == INSTANT
    if not parametres:
        assert tuple(entree["id"] for entree in reponse.json()["entries"]) == ORDRE


@pytest.mark.parametrize(
    ("parametre", "valeur", "detail"),
    [
        ("status", "publie", "Valeurs : validated, draft, needs_curation, invalid."),
        ("kind", "variant", "Valeurs : concept, kpi."),
    ],
)
def test_parametre_invalide_sans_appel_du_service(
    client: TestClient,
    service: CatalogService,
    monkeypatch: pytest.MonkeyPatch,
    parametre: str,
    valeur: str,
    detail: str,
) -> None:
    """Une valeur hors contrat est refusée avant toute lecture du catalogue."""
    espion = Mock(side_effect=AssertionError("Le service ne doit pas être appelé."))
    monkeypatch.setattr(service, "list", espion)
    reponse = client.get("/api/catalog", params={parametre: valeur})
    assert reponse.status_code == 400
    assert reponse.json() == {
        "error": {
            "code": "invalid_parameter",
            "parameter": parametre,
            "detail": detail,
        }
    }
    espion.assert_not_called()


@pytest.mark.parametrize("identifiant", ["revenu-net", "commande", "invalide"])
def test_fiche(client: TestClient, service: CatalogService, identifiant: str) -> None:
    """KPI, concept et diagnostics restent identiques à la fiche du service."""
    reponse = client.get(f"/api/catalog/{identifiant}")
    assert reponse.status_code == 200
    assert reponse.json() == server.to_json(service.get(identifiant))
    assert reponse.json()["document"]["entry"]["id"] == identifiant


@pytest.mark.parametrize("identifiant", ["inconnu", "revenu-net--nordis-fr"])
def test_fiche_absente(client: TestClient, identifiant: str) -> None:
    """Une déclinaison ne devient pas une fiche autonome."""
    reponse = client.get(f"/api/catalog/{identifiant}")
    assert reponse.status_code == 404
    assert reponse.json() == {"error": {"code": "document_not_found", "id": identifiant}}


@pytest.mark.parametrize("route", ["/api/catalog", "/api/catalog/revenu-net"])
def test_indisponible_sans_index(
    client: TestClient,
    espace: Path,
    tmp_path: Path,
    route: str,
) -> None:
    """Sans clone ni index, les deux routes refusent de servir un succès vide."""
    espace.rename(tmp_path / "clone-retire")
    reponse = client.get(route)
    assert reponse.status_code == 503
    assert reponse.json() == {
        "error": {
            "code": "catalog_unavailable",
            "problem": "repository_missing",
            "detail": DETAIL_ABSENT,
        }
    }


@pytest.mark.parametrize("route", ["/api/catalog", "/api/catalog/revenu-net"])
def test_ancien_apres_retrait_du_clone(
    client: TestClient,
    service: CatalogService,
    espace: Path,
    tmp_path: Path,
    route: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Le dernier contenu et sa date subsistent même si l'horloge avance après le retrait."""
    premiere = client.get(route)
    assert premiere.status_code == 200
    attendu = premiere.json()
    espace.rename(tmp_path / "clone-retire")
    monkeypatch.setattr(service, "_clock", lambda: INSTANT + timedelta(days=10))
    reponse = client.get(route)
    assert reponse.status_code == 200
    attendu["provenance"].update(
        freshness="stale",
        problem="repository_missing",
        detail=DETAIL_ABSENT,
    )
    assert reponse.json() == attendu
    assert datetime.fromisoformat(reponse.json()["provenance"]["read_at"]) == INSTANT


@pytest.mark.parametrize(
    ("methode", "route", "statut", "code"),
    [
        ("GET", route, 404, "route_not_found")
        for route in ("/inconnue", "/docs", "/redoc", "/openapi.json")
    ]
    + [("POST", "/api/catalog", 405, "method_not_allowed")],
)
def test_routes_et_methodes_fermees(
    client: TestClient,
    methode: str,
    route: str,
    statut: int,
    code: str,
) -> None:
    """Ni documentation exposée ni erreur HTML par défaut."""
    reponse = client.request(methode, route, headers={"Origin": "http://127.0.0.1:5173"})
    assert reponse.status_code == statut
    assert reponse.json() == {"error": {"code": code}}


@pytest.mark.parametrize(
    ("route", "methode"),
    [
        ("/api/catalog", "list"),
        ("/api/catalog/revenu-net", "get"),
    ],
)
def test_exception_interne_masquee(
    client: TestClient,
    service: CatalogService,
    monkeypatch: pytest.MonkeyPatch,
    route: str,
    methode: str,
    tmp_path: Path,
) -> None:
    """Le message privé et la trace de l'exception ne franchissent pas la frontière HTTP."""
    monkeypatch.setattr(service, methode, Mock(side_effect=RuntimeError(f"Secret : {tmp_path}")))
    reponse = client.get(route)
    assert reponse.status_code == 500
    assert reponse.json() == {"error": {"code": "internal_error"}}


def test_serialisation_recursive() -> None:
    """Dataclasses imbriquées, énumérations, tuples, listes et fuseau sont conservés en JSON."""

    @dataclass
    class Interieur:
        statut: AtlasStatus
        date: datetime
        valeurs: tuple[object, ...]

    @dataclass
    class Exterieur:
        contenu: Interieur
        liste: list[DocumentKind]

    instant = datetime(2026, 11, 1, 12, 30, tzinfo=timezone(timedelta(hours=2)))
    objet = Exterieur(
        Interieur(AtlasStatus.DRAFT, instant, (None, True, 3, "texte")), [DocumentKind.KPI]
    )
    resultat = server.to_json(objet)
    assert resultat == {
        "contenu": {
            "statut": "draft",
            "date": "2026-11-01T12:30:00+02:00",
            "valeurs": [None, True, 3, "texte"],
        },
        "liste": ["kpi"],
    }
    assert type(resultat["contenu"]["statut"]) is str
    assert type(resultat["liste"][0]) is str
    assert datetime.fromisoformat(resultat["contenu"]["date"]) == instant


def comparer_contrat(obtenu: object, attendu: object, chemin: str = "body") -> None:
    """Compare exactement clés, types, tailles et valeurs, sauf deux valeurs de provenance."""
    assert type(obtenu) is type(attendu), f"Type différent : {chemin}"
    if isinstance(attendu, dict):
        assert isinstance(obtenu, dict)
        assert obtenu.keys() == attendu.keys(), f"Clés différentes : {chemin}"
        for cle in attendu:
            comparer_contrat(obtenu[cle], attendu[cle], f"{chemin}.{cle}")
    elif isinstance(attendu, list):
        assert isinstance(obtenu, list)
        assert len(obtenu) == len(attendu), f"Longueur différente : {chemin}"
        for indice, (valeur, reference) in enumerate(zip(obtenu, attendu, strict=True)):
            comparer_contrat(valeur, reference, f"{chemin}[{indice}]")
    elif chemin not in ("body.provenance.commit", "body.provenance.read_at"):
        assert obtenu == attendu, f"Valeur différente : {chemin}"


@pytest.mark.parametrize("fichier", EXEMPLES, ids=lambda p: p.stem)
def test_contrats_versionnes(
    client: TestClient,
    espace: Path,
    tmp_path: Path,
    fichier: Path,
) -> None:
    """Chaque exemple est comparé à une réponse réelle, sans ignorer un champ additionnel."""
    routes = {
        "liste": "/api/catalog",
        "liste-ancienne": "/api/catalog",
        "fiche-revenu-net": "/api/catalog/revenu-net",
        "fiche-invalide": "/api/catalog/invalide",
        "fiche-commande": "/api/catalog/commande",
        "fiche-inconnue": "/api/catalog/inconnu",
        "parametre-invalide": "/api/catalog?status=publie",
        "indisponible": "/api/catalog",
    }
    assert {p.stem for p in EXEMPLES} == routes.keys()
    if fichier.stem == "liste-ancienne":
        assert client.get("/api/catalog").status_code == 200
    if fichier.stem in ("liste-ancienne", "indisponible"):
        espace.rename(tmp_path / "clone-retire")
    exemple = json.loads(fichier.read_text(encoding="utf-8"))
    reponse = client.get(routes[fichier.stem])
    assert reponse.status_code == exemple["status"]
    comparer_contrat(reponse.json(), exemple["body"])


def test_configuration_complete(tmp_path: Path) -> None:
    """Les deux chemins configurés deviennent ceux du service."""
    assert server.config_from_env(
        {
            server.REPOSITORY_VARIABLE: str(tmp_path / "clone"),
            server.STATE_VARIABLE: str(tmp_path / "etat"),
        }
    ) == CatalogConfig(tmp_path / "clone", tmp_path / "etat")


@pytest.mark.parametrize("variable", [server.REPOSITORY_VARIABLE, server.STATE_VARIABLE])
@pytest.mark.parametrize("valeur", [None, ""])
def test_configuration_manquante(variable: str, valeur: str | None) -> None:
    """Chaque variable absente ou vide est nommée dans l'erreur de démarrage."""
    environnement = {server.REPOSITORY_VARIABLE: "/clone", server.STATE_VARIABLE: "/etat"}
    if valeur is None:
        del environnement[variable]
    else:
        environnement[variable] = valeur
    with pytest.raises(SystemExit, match=variable):
        server.config_from_env(environnement)


@pytest.mark.parametrize("personnalise", [False, True])
def test_demarrage_sans_ouvrir_de_port(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    personnalise: bool,
) -> None:
    """Uvicorn reçoit l'application, l'hôte et le port configurés, sans jamais démarrer."""
    configuration = CatalogConfig(tmp_path / "clone", tmp_path / "etat")
    environnement = {
        server.REPOSITORY_VARIABLE: str(configuration.repository),
        server.STATE_VARIABLE: str(configuration.state_dir),
    }
    if personnalise:
        environnement.update(SKIFER_BOARD_HOST="localhost", SKIFER_BOARD_PORT="8123")
    monkeypatch.setattr(os, "environ", environnement)
    constructeur = Mock(wraps=CatalogService)
    creer = Mock(wraps=server.create_app)
    lancer = Mock()
    monkeypatch.setattr(server, "CatalogService", constructeur)
    monkeypatch.setattr(server, "create_app", creer)
    monkeypatch.setattr(uvicorn, "run", lancer)
    server.main()
    constructeur.assert_called_once_with(configuration)
    creer.assert_called_once()
    assert creer.call_args.args[0].config == configuration
    lancer.assert_called_once()
    assert isinstance(lancer.call_args.args[0], FastAPI)
    assert lancer.call_args.kwargs == {
        "host": "localhost" if personnalise else "127.0.0.1",
        "port": 8123 if personnalise else 8000,
    }


@pytest.mark.parametrize("ancien", [False, True], ids=["sans-index", "ancien"])
@pytest.mark.parametrize("route", ["/api/catalog", "/api/catalog/revenu-net"])
def test_clone_illisible_sans_chemin_prive(
    client: TestClient,
    espace: Path,
    tmp_path: Path,
    ancien: bool,
    route: str,
) -> None:
    """Un clone sans métadonnées git ne divulgue pas davantage les chemins du serveur."""
    if ancien:
        assert client.get(route).status_code == 200
    espace.rename(tmp_path / "clone-retire")
    espace.mkdir()
    reponse = client.get(route)
    assert reponse.status_code == (200 if ancien else 503)
    corps = reponse.json()
    probleme = corps["provenance"] if ancien else corps["error"]
    assert probleme["problem"] == "repository_unreadable"
    assert probleme["detail"]


@pytest.mark.parametrize("ancien", [False, True], ids=["sans-index", "ancien"])
@pytest.mark.parametrize("route", ["/api/catalog", "/api/catalog/revenu-net"])
def test_reference_git_cassee_sans_chemin_prive(
    client: TestClient,
    espace: Path,
    tmp_path: Path,
    ancien: bool,
    route: str,
) -> None:
    """Un pointeur git cassé ne doit pas exposer son chemin absolu via le diagnostic git."""
    if ancien:
        assert client.get(route).status_code == 200
    (espace / ".git").rename(tmp_path / "metadonnees-git")
    (espace / ".git").write_text(f"gitdir: {tmp_path / 'git-introuvable'}\n", encoding="utf-8")
    reponse = client.get(route)
    assert reponse.status_code == (200 if ancien else 503)
    corps = reponse.json()
    probleme = corps["provenance"] if ancien else corps["error"]
    assert probleme["problem"] == "repository_unreadable"
    assert probleme["detail"]
