"""Exemples de contrat des routes des dashboards, produits par le serveur réel (plan 19.2).

Chaque route et chaque refus a son exemple sous `contracts/dashboards/routes/` ; l'exemple de la
route des consommateurs d'une analyse est sous `contracts/analyses/routes/`. Les identifiants
et les empreintes de commit, différents à chaque exécution, y sont remplacés par `<uuid>` et
`<commit>` ; tout le reste est comparé tel quel. Pour réécrire les exemples après un changement
voulu du contrat : `BOARD_REGENERER_CONTRATS=1 uv run pytest apps/api/tests/content`.

Le dossier des dashboards ne contient que ce que ce fichier produit : un exemple qu'aucun test ne
produit plus fait échouer le dernier test, comme un exemple qui manque.
"""

from __future__ import annotations

import copy
import json
import os
import re
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from httpx2 import Response
from skifer_board.catalog import CatalogService
from skifer_board.content.repository import DASHBOARD_KIND
from skifer_board.server import create_app
from spaces.monde import (
    ADMIN_GROUPE,
    CREATEUR_GROUPE,
    CREATEUR_PERSONNE,
    LECTEUR_GROUPE,
    A,
)

from .aides_dashboards import sans_catalogue
from .monde import init, new_id, repository
from .monde_dashboard import common_filter, text, visual
from .serveur import CHEMIN, CHEMIN_TABLEAUX, Banc, corps, corps_tableau

RACINE = Path(__file__).resolve().parents[4] / "contracts"
DASHBOARDS = RACINE / "dashboards/routes"
ANALYSES = RACINE / "analyses/routes"
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
COMMIT = re.compile(r"[0-9a-f]{40}")

# Les exemples du dossier des dashboards, tous produits par ce fichier.
NOMS = frozenset(
    {
        "creer",
        "lire",
        "lister",
        "reviser",
        "reviser-identique",
        "historique",
        "revision",
        "ecart",
        "dupliquer",
        "dupliquer-nomme",
        "supprimer",
        "historique-supprime",
        "lire-tuiles",
        "lire-index-perime",
        "lire-non-verifie",
        "lister-index-perime",
        "refus-dashboard-inconnu",
        "refus-dashboard-invalide-analyse",
        "refus-dashboard-invalide-filtre",
        "refus-reference-personnelle",
        "refus-revision-conflit",
        "refus-interdit",
        "refus-pas-proprietaire",
        "refus-champ-reserve",
        "refus-moteur-indisponible",
        "refus-depot-indisponible",
        "refus-mode-local",
    }
)
# Les exemples de la route des consommateurs, dans le dossier des analyses.
CONSOMMATEURS = frozenset({"consommateurs", "consommateurs-aucun"})
PRODUITS: set[tuple[Path, str]] = set()

C1 = "cccccccc-0000-4000-8000-000000000001"
C2 = "cccccccc-0000-4000-8000-000000000002"
C3 = "cccccccc-0000-4000-8000-000000000003"
C4 = "cccccccc-0000-4000-8000-000000000004"
TEXTE = "cccccccc-0000-4000-8000-000000000009"


def normaliser(valeur: Any) -> Any:
    if isinstance(valeur, dict):
        return {cle: normaliser(item) for cle, item in valeur.items()}
    if isinstance(valeur, list):
        return [normaliser(item) for item in valeur]
    if isinstance(valeur, str):
        if UUID.fullmatch(valeur):
            return "<uuid>"
        if COMMIT.fullmatch(valeur):
            return "<commit>"
    return valeur


def exemple(dossier: Path, reponse: Response, nom: str, statut: int) -> None:
    """Compare la réponse à l'exemple `nom` du dossier ; `BOARD_REGENERER_CONTRATS` le réécrit."""
    assert nom in (NOMS if dossier == DASHBOARDS else CONSOMMATEURS), nom
    assert reponse.status_code == statut, reponse.text
    obtenu = {
        "status": reponse.status_code,
        "body": normaliser(reponse.json()) if reponse.content else None,
    }
    PRODUITS.add((dossier, nom))
    fichier = dossier / f"{nom}.json"
    if os.environ.get("BOARD_REGENERER_CONTRATS"):
        dossier.mkdir(parents=True, exist_ok=True)
        fichier.write_text(json.dumps(obtenu, separators=(",", ":"), ensure_ascii=False))
    assert obtenu == json.loads(fichier.read_text(encoding="utf-8")), nom


def contrat(reponse: Response, nom: str, statut: int) -> None:
    exemple(DASHBOARDS, reponse, nom, statut)


def requete(**changes: Any) -> dict[str, Any]:
    return {**corps()["query"], **changes}


def test_contrats_du_cycle_de_vie(banc: Banc) -> None:
    analyse = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    premiere = corps_tableau(
        visual(ident=C1, analysis_id=analyse),
        text(ident=TEXTE),
        visibility="shared",
        name="Pilotage",
    )
    creee = banc.appel(CREATEUR_GROUPE, "POST", CHEMIN_TABLEAUX, json=premiere)
    contrat(creee, "creer", 201)
    ident = creee.json()["id"]
    contrat(banc.appel(LECTEUR_GROUPE, "GET", CHEMIN_TABLEAUX), "lister", 200)
    contrat(banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{ident}"), "lire", 200)
    # Même mise en page, un graphique surchargé et un autre nom : l'écart ne porte que là-dessus.
    seconde = copy.deepcopy(premiere)
    seconde["name"] = "Révisé"
    seconde["layout"]["sections"][0]["rows"][0]["columns"][0]["children"][0]["presentation"] = {
        "chart": "line"
    }

    def reviser(numero: int) -> Response:
        return banc.appel(
            ADMIN_GROUPE,
            "POST",
            f"{CHEMIN_TABLEAUX}/{ident}/revisions",
            json={**seconde, "expected_revision": numero},
        )

    contrat(reviser(1), "reviser", 201)
    contrat(reviser(2), "reviser-identique", 200)
    racine = f"{CHEMIN_TABLEAUX}/{ident}"
    contrat(banc.appel(LECTEUR_GROUPE, "GET", f"{racine}/revisions"), "historique", 200)
    contrat(banc.appel(LECTEUR_GROUPE, "GET", f"{racine}/revisions/1"), "revision", 200)
    ecart = banc.appel(LECTEUR_GROUPE, "GET", f"{racine}/diff", params={"base": "1", "other": "2"})
    contrat(ecart, "ecart", 200)
    contrat(banc.appel(CREATEUR_PERSONNE, "POST", f"{racine}/duplicate"), "dupliquer", 201)
    nommee = banc.appel(CREATEUR_PERSONNE, "POST", f"{racine}/duplicate", json={"name": "Copie"})
    contrat(nommee, "dupliquer-nomme", 201)
    suppression = banc.appel(CREATEUR_GROUPE, "DELETE", racine, params={"expected_revision": "2"})
    contrat(suppression, "supprimer", 204)
    historique = banc.appel(CREATEUR_GROUPE, "GET", f"{racine}/revisions")
    contrat(historique, "historique-supprime", 200)


def test_contrats_des_etats_de_lecture(banc: Banc) -> None:
    """Un dashboard périmé (écrit hors index), puis un dashboard dont les tuiles ont chacune un état
    différent, enfin le même sans catalogue."""
    simple = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    perime = banc.creer_tableau_ok(
        CREATEUR_GROUPE, visual(ident=C1, analysis_id=simple), visibility="shared", name="B périmé"
    )
    courant = banc.depot.read(A, perime, kind=DASHBOARD_KIND).document
    banc.depot.write(
        A,
        perime,
        {**courant, "name": "B écrit hors index"},
        expected_revision=1,
        actor=CREATEUR_GROUPE.ref,
        kind=DASHBOARD_KIND,
    )
    contrat(
        banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{perime}"), "lire-index-perime", 200
    )
    # L'écart d'index l'emporte sur les autres états : les tuiles ont leur propre dashboard.
    prete = banc.creer_ok(
        CREATEUR_GROUPE,
        visibility="shared",
        query=requete(metrics=["orders"], filters=[]),
        contextual=[],
    )
    cachee = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    tuiles = banc.creer_tableau_ok(
        CREATEUR_GROUPE,
        visual(ident=C1, analysis_id=prete),
        visual(ident=C2, analysis_id=cachee),
        visual(ident=C3, analysis_id=simple),
        visual(ident=C4, analysis_id=prete),
        filters=[common_filter([C4], dimension="channel")],
        visibility="shared",
        name="A tuiles",
    )
    contrat(banc.appel(LECTEUR_GROUPE, "GET", CHEMIN_TABLEAUX), "lister-index-perime", 200)
    banc.reviser(CREATEUR_GROUPE, cachee, 1, visibility="personal")
    banc.redefinir(["orders"], ["region"])
    contrat(banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{tuiles}"), "lire-tuiles", 200)
    sans_catalogue(banc)
    contrat(
        banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{tuiles}"), "lire-non-verifie", 200
    )
    sans_moteur = banc.creer_tableau(CREATEUR_GROUPE, text())
    contrat(sans_moteur, "refus-moteur-indisponible", 503)


def test_contrats_des_refus(banc: Banc) -> None:
    analyse = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    personnelle = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    ident = banc.creer_tableau_ok(
        CREATEUR_GROUPE, visual(ident=C1, analysis_id=analyse), visibility="shared"
    )
    contrat(
        banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{new_id()}"),
        "refus-dashboard-inconnu",
        404,
    )
    inconnue = banc.creer_tableau(CREATEUR_GROUPE, visual(ident=C1, analysis_id=new_id()))
    contrat(inconnue, "refus-dashboard-invalide-analyse", 422)
    filtre = banc.creer_tableau(
        CREATEUR_GROUPE,
        visual(ident=C1, analysis_id=analyse),
        filters=[common_filter([C1], dimension="fantome")],
    )
    contrat(filtre, "refus-dashboard-invalide-filtre", 422)
    partage = banc.creer_tableau(
        CREATEUR_GROUPE, visual(ident=C1, analysis_id=personnelle), visibility="shared"
    )
    contrat(partage, "refus-reference-personnelle", 422)
    banc.reviser_tableau(
        ADMIN_GROUPE,
        ident,
        1,
        visual(ident=C1, analysis_id=analyse),
        visibility="shared",
        name="Deux",
    )
    conflit = banc.reviser_tableau(
        CREATEUR_GROUPE, ident, 1, visual(ident=C1, analysis_id=analyse), visibility="shared"
    )
    contrat(conflit, "refus-revision-conflit", 409)
    contrat(banc.creer_tableau(LECTEUR_GROUPE, text()), "refus-interdit", 403)
    autre = banc.reviser_tableau(
        CREATEUR_PERSONNE,
        ident,
        2,
        visual(ident=C1, analysis_id=analyse),
        visibility="shared",
        name="Trois",
    )
    contrat(autre, "refus-pas-proprietaire", 403)
    reserve = {**corps_tableau(text()), "owner": {"issuer": "x", "subject": "y"}}
    contrat(
        banc.appel(CREATEUR_GROUPE, "POST", CHEMIN_TABLEAUX, json=reserve),
        "refus-champ-reserve",
        422,
    )


def test_contrat_depot_indisponible(banc_sans_depot: Banc) -> None:
    contrat(banc_sans_depot.creer_tableau(CREATEUR_GROUPE, text()), "refus-depot-indisponible", 503)


def test_contrat_mode_local(service: CatalogService, tmp_path: Path) -> None:
    app = create_app(service, content_repository=repository(init(tmp_path / "contenus")))
    with TestClient(app, base_url="http://127.0.0.1", raise_server_exceptions=False) as client:
        contrat(client.get("/api/spaces/local/dashboards"), "refus-mode-local", 409)


def test_contrats_des_consommateurs_d_une_analyse(banc: Banc) -> None:
    """Un dashboard partagé est nommé ; celui, personnel, d'une autre personne n'est que compté."""
    analyse = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    seule = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    banc.creer_tableau_ok(
        CREATEUR_GROUPE, visual(ident=C1, analysis_id=analyse), visibility="shared"
    )
    banc.creer_tableau_ok(
        CREATEUR_PERSONNE, visual(ident=C1, analysis_id=analyse), visibility="personal"
    )
    chemin = f"{CHEMIN}/{analyse}/consumers"
    exemple(ANALYSES, banc.appel(LECTEUR_GROUPE, "GET", chemin), "consommateurs", 200)
    aucun = banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{seule}/consumers")
    exemple(ANALYSES, aucun, "consommateurs-aucun", 200)


def test_zz_le_dossier_ne_contient_que_les_exemples_produits() -> None:
    """Aucun exemple orphelin, aucun exemple manquant, aucun exemple non produit par un test."""
    presents = {fichier.stem for fichier in DASHBOARDS.glob("*") if fichier.is_file()}
    assert presents == NOMS, (sorted(presents - NOMS), sorted(NOMS - presents))
    assert {fichier.suffix for fichier in DASHBOARDS.glob("*")} == {".json"}
    assert {nom for dossier, nom in PRODUITS if dossier == DASHBOARDS} == NOMS
    assert {nom for dossier, nom in PRODUITS if dossier == ANALYSES} == CONSOMMATEURS
    assert all((ANALYSES / f"{nom}.json").is_file() for nom in CONSOMMATEURS)
