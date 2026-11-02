"""Routes HTTP des versions et des écarts, et leurs exemples versionnés (plan 05, 5.2)."""

import json
import re
import shutil
from collections.abc import Callable, Iterator
from datetime import datetime
from pathlib import Path
from typing import Any
from unittest.mock import Mock

import pytest
from catalog.conftest import INSTANT, git
from catalog.conftest import espace as espace
from catalog.conftest import espace_versionne as espace_versionne
from catalog.conftest import service as service
from fastapi.testclient import TestClient
from httpx2 import Response
from skifer_board import server
from skifer_board.catalog import CatalogService, atlas
from skifer_board.catalog.atlas import RepoError

CONTRATS = Path(__file__).resolve().parents[3] / "contracts" / "catalogue"
DETAIL_ABSENT = "Le clone de l'espace Atlas est introuvable à l'emplacement configuré."
DETAIL_PARAMETRE = "Numéro de version taguée : entier strictement positif."
ADRESSE = "catalogue@example.invalid"

# Requêtes qui ont produit chaque exemple versionné du plan 05.
REQUETES = {
    "versions-revenu-net": "/api/spaces/local/catalog/revenu-net/versions",
    "versions-concept": "/api/spaces/local/catalog/commande/versions",
    "versions-indisponible": "/api/spaces/local/catalog/revenu-net/versions",
    "ecart-revenu-net": "/api/spaces/local/catalog/revenu-net/diff?base=4&other=5",
    "ecart-identique": "/api/spaces/local/catalog/revenu-net/diff?base=5&other=5",
    "ecart-version-inconnue": "/api/spaces/local/catalog/revenu-net/diff?base=4&other=9",
    "ecart-concept": "/api/spaces/local/catalog/commande/diff?base=1&other=2",
    "ecart-irresoluble": "/api/spaces/local/catalog/revenu-net/diff?base=3&other=5",
    "ecart-parametre-invalide": "/api/spaces/local/catalog/revenu-net/diff?base=v4&other=5",
}
# Seules valeurs qui dépendent de l'horloge du commit ou des hashs git.
VARIABLES = {"body.provenance.commit", "body.versions[].commit", "body.versions[].date"}


@pytest.fixture
def client(service: CatalogService, espace_versionne: Path, tmp_path: Path) -> Iterator[TestClient]:
    """Client sur l'espace versionné ; aucun chemin du serveur dans aucune réponse."""
    with TestClient(server.create_app(service), raise_server_exceptions=False) as connexion:

        def verifier_chemins(reponse: Response) -> None:
            reponse.read()
            for chemin in (tmp_path, service.config.repository, service.config.state_dir):
                assert str(chemin) not in reponse.text
            assert ADRESSE not in reponse.text

        connexion.event_hooks["response"].append(verifier_chemins)
        yield connexion


def erreur(code: str, **champs: str) -> dict[str, Any]:
    return {"error": {"code": code, **champs}}


# --- /versions -----------------------------------------------------------------------------


def test_versions(client: TestClient, service: CatalogService, espace_versionne: Path) -> None:
    """200 : le JSON est celui du service, dates avec fuseau, provenance fraîche."""
    reponse = client.get("/api/spaces/local/catalog/revenu-net/versions")
    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps == server.to_json(service.versions("revenu-net"))
    assert set(corps) == {"provenance", "id", "current_version", "versions"}
    assert corps["current_version"] == 5
    assert [v["version"] for v in corps["versions"]] == [3, 4, 5]
    for version in corps["versions"]:
        assert set(version) == {"version", "commit", "date", "author", "message"}
        assert datetime.fromisoformat(version["date"]).tzinfo is not None
    assert corps["provenance"]["commit"] == git(espace_versionne, "rev-parse", "HEAD")
    assert datetime.fromisoformat(corps["provenance"]["read_at"]) == INSTANT


@pytest.mark.parametrize("identifiant", ["inconnu", "revenu-net--nordis-fr"])
def test_versions_document_absent(client: TestClient, identifiant: str) -> None:
    reponse = client.get(f"/api/spaces/local/catalog/{identifiant}/versions")
    assert reponse.status_code == 404
    assert reponse.json() == erreur("document_not_found", id=identifiant)


def _rendre_illisible(depot: Path, tmp_path: Path, panne: str) -> str:
    """Abîme le clone ; rend le problème attendu."""
    if panne == "absent":
        shutil.rmtree(depot)
        return "repository_missing"
    if panne == "pas-un-depot":
        depot.rename(tmp_path / "clone-retire")
        depot.mkdir()
    else:
        (depot / ".git").rename(tmp_path / "metadonnees-git")
        (depot / ".git").write_text(f"gitdir: {tmp_path / 'introuvable'}\n", encoding="utf-8")
    return "repository_unreadable"


@pytest.mark.parametrize("route", ["/versions", "/diff?base=4&other=5"])
@pytest.mark.parametrize("panne", ["absent", "pas-un-depot", "git-pointeur"])
@pytest.mark.parametrize("ancien", [False, True], ids=["sans-index", "avec-index"])
def test_historique_indisponible(
    client: TestClient,
    espace_versionne: Path,
    tmp_path: Path,
    route: str,
    panne: str,
    ancien: bool,
) -> None:
    """503 à code fermé, même quand la fiche reste servie depuis l'ancien index (V2)."""
    if ancien:
        assert client.get(f"/api/spaces/local/catalog/revenu-net{route}").status_code == 200
    probleme = _rendre_illisible(espace_versionne, tmp_path, panne)
    reponse = client.get(f"/api/spaces/local/catalog/revenu-net{route}")
    assert reponse.status_code == 503
    corps = reponse.json()
    assert set(corps) == {"error"}
    assert set(corps["error"]) == {"code", "problem", "detail"}
    assert corps["error"]["code"] == "history_unavailable"
    assert corps["error"]["problem"] == probleme
    assert corps["error"]["detail"]
    if panne == "absent":
        assert corps["error"]["detail"] == DETAIL_ABSENT
    fiche = client.get("/api/spaces/local/catalog/revenu-net")
    assert fiche.status_code == (200 if ancien else 503)
    if ancien:
        assert fiche.json()["provenance"]["freshness"] == "stale"


# --- /diff ---------------------------------------------------------------------------------


def test_ecart(client: TestClient, service: CatalogService) -> None:
    """200 : rapport d'Atlas relayé, sans les alignements de nœuds."""
    reponse = client.get(
        "/api/spaces/local/catalog/revenu-net/diff", params={"base": "4", "other": "5"}
    )
    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps == server.to_json(service.diff("revenu-net", 4, 5))
    assert set(corps) == {"provenance", "id", "diff"}
    assert set(corps["diff"]) == {"identical", "base", "other", "differences", "by_severity"}
    assert [d["severity"] for d in corps["diff"]["differences"]] == ["info", "warn"]
    assert "pairs" not in reponse.text


INVALIDES = [
    ({}, "base"),
    ({"other": "5"}, "base"),
    ({"base": "4"}, "other"),
    ({"base": "", "other": "5"}, "base"),
    ({"base": "4", "other": ""}, "other"),
    ({"base": "v4", "other": "5"}, "base"),
    ({"base": "4", "other": "cinq"}, "other"),
    ({"base": "0", "other": "5"}, "base"),
    ({"base": "4", "other": "0"}, "other"),
    ({"base": "00", "other": "5"}, "base"),
    ({"base": "-1", "other": "5"}, "base"),
    ({"base": "4", "other": "-5"}, "other"),
    ({"base": "1.5", "other": "5"}, "base"),
    ({"base": "4", "other": "5.0"}, "other"),
    ({"base": "٣", "other": "5"}, "base"),
    ({"base": "4", "other": "٥"}, "other"),
    ({"base": "４", "other": "5"}, "base"),
    ({"base": "²", "other": "5"}, "base"),
    ({"base": "+4", "other": "5"}, "base"),
    ({"base": " 4", "other": "5"}, "base"),
    ({"base": "4 ", "other": "5"}, "base"),
    ({"base": "4e0", "other": "5"}, "base"),
    ({"base": "0x4", "other": "5"}, "base"),
    ({"base": "4_0", "other": "5"}, "base"),
    ({"base": "abc", "other": "xyz"}, "base"),
    ({"base": "", "other": ""}, "base"),
]


@pytest.mark.parametrize("identifiant", ["revenu-net", "inconnu"])
@pytest.mark.parametrize(("parametres", "parametre"), INVALIDES)
def test_parametre_invalide_sans_appel_du_service(
    client: TestClient,
    service: CatalogService,
    monkeypatch: pytest.MonkeyPatch,
    identifiant: str,
    parametres: dict[str, str],
    parametre: str,
) -> None:
    """400 avant toute lecture ; `base` est vérifié avant `other`."""
    espion = Mock(side_effect=AssertionError("Le service ne doit pas être appelé."))
    monkeypatch.setattr(service, "diff", espion)
    reponse = client.get(f"/api/spaces/local/catalog/{identifiant}/diff", params=parametres)
    assert reponse.status_code == 400
    assert reponse.json() == erreur(
        "invalid_parameter", parameter=parametre, detail=DETAIL_PARAMETRE
    )
    espion.assert_not_called()


@pytest.mark.parametrize(("base", "other"), [("4", "5"), ("5", "4"), ("12", "3"), ("05", "5")])
def test_versions_transmises_en_entiers(
    client: TestClient,
    service: CatalogService,
    monkeypatch: pytest.MonkeyPatch,
    base: str,
    other: str,
) -> None:
    """Les numéros écrits en chiffres ASCII sont transmis tels quels, dans l'ordre."""
    espion = Mock(wraps=service.diff)
    monkeypatch.setattr(service, "diff", espion)
    client.get("/api/spaces/local/catalog/revenu-net/diff", params={"base": base, "other": other})
    espion.assert_called_once_with("revenu-net", int(base), int(other))


@pytest.mark.parametrize(
    ("route", "statut", "attendu"),
    [
        (
            "/api/spaces/local/catalog/revenu-net/diff?base=4&other=9",
            404,
            erreur(
                "version_not_found",
                id="revenu-net",
                detail="Version 9 de « revenu-net » introuvable.",
            ),
        ),
        (
            "/api/spaces/local/catalog/commande/diff?base=1&other=2",
            400,
            erreur(
                "diff_not_supported",
                id="commande",
                detail="Un concept n'a pas de graphe : ses versions ne se comparent pas.",
            ),
        ),
        (
            "/api/spaces/local/catalog/revenu-net/diff?base=3&other=5",
            422,
            erreur(
                "diff_unavailable",
                id="revenu-net",
                detail="La version 3 de « revenu-net » n'est pas un document valide.",
            ),
        ),
        (
            "/api/spaces/local/catalog/inconnu/diff?base=4&other=5",
            404,
            erreur("document_not_found", id="inconnu"),
        ),
        (
            "/api/spaces/local/catalog/revenu-net--nordis-fr/diff?base=1&other=2",
            404,
            erreur("document_not_found", id="revenu-net--nordis-fr"),
        ),
    ],
)
def test_codes_fermes_de_l_ecart(
    client: TestClient, route: str, statut: int, attendu: dict[str, Any]
) -> None:
    reponse = client.get(route)
    assert reponse.status_code == statut
    assert reponse.json() == attendu


def test_echec_git_de_l_ecart(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Un autre échec d'Atlas est un historique indisponible, pas un refus d'écart."""
    monkeypatch.setattr(
        "skifer_board.catalog.service.read_diff",
        Mock(side_effect=RepoError("git_timeout", "git show n'a pas répondu en 30 s.")),
    )
    reponse = client.get("/api/spaces/local/catalog/revenu-net/diff?base=4&other=5")
    assert reponse.status_code == 503
    assert reponse.json() == erreur(
        "history_unavailable",
        problem="repository_unreadable",
        detail="git show n'a pas répondu en 30 s.",
    )


@pytest.mark.parametrize(
    ("route", "methode"),
    [
        ("/api/spaces/local/catalog/revenu-net/versions", "versions"),
        (REQUETES["ecart-revenu-net"], "diff"),
    ],
)
def test_exception_interne_masquee(
    client: TestClient,
    service: CatalogService,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    route: str,
    methode: str,
) -> None:
    """500 à code fermé : ni message privé ni trace."""
    monkeypatch.setattr(service, methode, Mock(side_effect=RuntimeError(f"Secret : {tmp_path}")))
    reponse = client.get(route)
    assert reponse.status_code == 500
    assert reponse.json() == erreur("internal_error")


def test_severite_inconnue_jamais_affichee(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Un rapport hors contrat n'est pas servi comme un écart."""
    rapport = {
        "identical": False,
        "base": {"version": 4, "fingerprint": "sha256:atlas1:a"},
        "other": {"version": 5, "fingerprint": "sha256:atlas1:b"},
        "differences": [
            {
                "kind": "modified",
                "node_type": "filter",
                "node_ref": None,
                "changes": [],
                "classification": "cosmetic",
                "severity": "blocker",
                "message": "?",
            }
        ],
        "summary": {"by_severity": {"info": 0, "warn": 0, "critical": 0}},
    }
    monkeypatch.setattr(atlas, "version_diff", lambda *_: rapport)
    reponse = client.get(REQUETES["ecart-revenu-net"])
    assert reponse.status_code == 500
    assert reponse.json() == erreur("internal_error")


# --- contrat versionné ------------------------------------------------------------------------


def comparer_contrat(obtenu: object, attendu: object, chemin: str = "body") -> None:
    """Mêmes clés, types JSON, longueurs et valeurs, sauf les valeurs de `VARIABLES`."""
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
    elif re.sub(r"\[\d+\]", "[]", chemin) not in VARIABLES:
        assert obtenu == attendu, f"Valeur différente : {chemin}"


def exemples() -> list[Path]:
    return sorted(p for p in CONTRATS.glob("*.json") if p.stem.startswith(("versions-", "ecart-")))


def test_aucun_exemple_orphelin() -> None:
    """Chaque exemple du plan 05 est rejoué, et chaque requête a son exemple."""
    assert {p.stem for p in exemples()} == REQUETES.keys()


@pytest.mark.parametrize("fichier", exemples(), ids=lambda p: p.stem)
def test_contrats_versionnes(
    client: TestClient,
    espace_versionne: Path,
    fichier: Path,
) -> None:
    """Chaque exemple est comparé à la réponse réelle, champ par champ."""
    exemple = json.loads(fichier.read_text(encoding="utf-8"))
    assert set(exemple) == {"status", "body"}
    tags = {
        int(nom.rsplit("/v", 1)[1]): git(espace_versionne, "rev-list", "-n", "1", nom)
        for nom in git(espace_versionne, "tag", "--list", "doc/revenu-net/*").split()
    }
    tete = git(espace_versionne, "rev-parse", "HEAD")
    if fichier.stem == "versions-indisponible":
        assert client.get(REQUETES[fichier.stem]).status_code == 200
        shutil.rmtree(espace_versionne)
    reponse = client.get(REQUETES[fichier.stem])
    assert reponse.status_code == exemple["status"]
    corps = reponse.json()
    comparer_contrat(corps, exemple["body"])
    # Les valeurs exclues de la comparaison restent celles du dépôt rejoué.
    if "provenance" in corps:
        assert corps["provenance"]["commit"] == tete
    for version in corps.get("versions", []):
        assert version["commit"] == tags[version["version"]]
        assert datetime.fromisoformat(version["date"]).tzinfo is not None


@pytest.mark.parametrize(
    ("fichier", "mutation"),
    [
        ("versions-revenu-net", lambda c: c.update(nouveau=1)),
        ("versions-revenu-net", lambda c: c.pop("current_version")),
        ("versions-revenu-net", lambda c: c["provenance"].update(problem="repository_missing")),
        ("versions-revenu-net", lambda c: c["provenance"].pop("detail")),
        ("versions-revenu-net", lambda c: c["provenance"].update(commit=None)),
        (
            "versions-revenu-net",
            lambda c: c["provenance"].update(read_at="2026-11-02T10:30:00+00:00"),
        ),
        ("versions-revenu-net", lambda c: c["versions"].pop()),
        ("versions-revenu-net", lambda c: c["versions"][0].update(author="Autre")),
        ("versions-revenu-net", lambda c: c["versions"][0].update(email=ADRESSE)),
        ("versions-revenu-net", lambda c: c["versions"][1].update(version=True)),
        ("versions-revenu-net", lambda c: c["versions"][1].update(date=None)),
        ("versions-revenu-net", lambda c: c.update(current_version=5.0)),
        ("ecart-revenu-net", lambda c: c["diff"]["base"].update(fingerprint="sha256:atlas1:0")),
        ("ecart-revenu-net", lambda c: c["diff"]["differences"][0].update(pairs=[])),
        ("ecart-revenu-net", lambda c: c["diff"]["differences"][1].update(severity="info")),
        ("ecart-revenu-net", lambda c: c["diff"]["differences"][0]["changes"].append({})),
        ("ecart-revenu-net", lambda c: c["diff"]["by_severity"].pop("critical")),
    ],
)
def test_comparaison_stricte(fichier: str, mutation: Callable[[dict[str, Any]], object]) -> None:
    """Une clé ajoutée ou retirée, un type, une longueur ou une valeur changés échouent."""
    attendu = json.loads((CONTRATS / f"{fichier}.json").read_text(encoding="utf-8"))["body"]
    obtenu = json.loads(json.dumps(attendu))
    mutation(obtenu)
    with pytest.raises(AssertionError):
        comparer_contrat(obtenu, attendu)
    with pytest.raises(AssertionError):
        comparer_contrat(attendu, obtenu)


def test_valeurs_variables_tolerees() -> None:
    """Commits et dates des versions peuvent changer d'un rejeu à l'autre, pas leur type."""
    attendu = json.loads((CONTRATS / "versions-revenu-net.json").read_text(encoding="utf-8"))
    obtenu = json.loads(json.dumps(attendu["body"]))
    obtenu["provenance"]["commit"] = "f" * 40
    for version in obtenu["versions"]:
        version.update(commit="e" * 40, date="2027-01-01T00:00:00+05:00")
    comparer_contrat(obtenu, attendu["body"])
