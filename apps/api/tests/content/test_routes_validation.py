"""Validation à la sauvegarde et à la réouverture d'une analyse (plan 18.2, A6).

La requête est validée comme une soumission d'exécution (E3). Un calcul contextuel ne porte que
sur une métrique de la requête, avec une opération, un périmètre et un dénominateur fermés ; une
réagrégation que la route 17.3 refuserait l'est ici, avec la même raison. À la réouverture, un
champ disparu du catalogue donne `unresolved_reference` : rien n'est exécuté ni approximé.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
import yaml
from skifer_board.content.index import IndexRow
from spaces.monde import ADMIN_GROUPE, ADMIN_PERSONNE, CREATEUR_GROUPE, LECTEUR_GROUPE, A

from .monde import fichier
from .serveur import CHEMIN, Banc, corps, modeles

Mutation = Callable[[dict[str, Any]], None]


def agreger(metrique: str, *, par: list[str] | None = None, **plus: Any) -> Mutation:
    def faire(valeur: dict[str, Any]) -> None:
        valeur["query"]["metrics"] = [metrique]
        valeur["contextual"] = [
            {"operation": "aggregate", "metric": metrique, "group_by": par or [], "scope": None}
        ]
        valeur["query"].update(plus)

    return faire


def part(metrique: str, *, dimensions: list[str] | None = None) -> Mutation:
    def faire(valeur: dict[str, Any]) -> None:
        valeur["query"]["metrics"] = [metrique]
        valeur["query"]["dimensions"] = ["region"] if dimensions is None else dimensions
        valeur["contextual"] = [
            {
                "operation": "share",
                "metric": metrique,
                "group_by": [],
                "denominator": "loaded_result",
            }
        ]

    return faire


def poser(chemin: list[str], valeur: Any) -> Mutation:
    def faire(document: dict[str, Any]) -> None:
        cible = document
        for cle in chemin[:-1]:
            cible = cible[cle]
        cible[chemin[-1]] = valeur

    return faire


def retirer(chemin: list[str]) -> Mutation:
    def faire(document: dict[str, Any]) -> None:
        cible = document
        for cle in chemin[:-1]:
            cible = cible[cle]
        del cible[chemin[-1]]

    return faire


def ensemble(*mutations: Mutation) -> Mutation:
    def faire(document: dict[str, Any]) -> None:
        for mutation in mutations:
            mutation(document)

    return faire


# (mutation du corps valide, code attendu, chemin, règle)
REFUS = {
    "modele inconnu": (poser(["query", "model"], "ghost"), "/query/model", "unknown_model"),
    "metrique inconnue": (
        poser(["query", "metrics"], ["revenue", "ghost"]),
        "/query/metrics/1",
        "unknown_metric",
    ),
    "dimension inconnue": (
        ensemble(poser(["query", "dimensions"], ["ghost"]), poser(["contextual"], [])),
        "/query/dimensions/0",
        "unknown_dimension",
    ),
    "connexion inconnue": (
        poser(["query", "connection"], "ghost"),
        "/query/connection",
        "unknown_connection",
    ),
    "filtre sur une colonne inconnue": (
        poser(["query", "filters"], [{"column": "ghost", "operator": "eq", "value": "x"}]),
        "/query/filters/0",
        "filter_not_allowed",
    ),
    "filtre de type incompatible": (
        poser(["query", "filters"], [{"column": "year", "operator": "eq", "value": "texte"}]),
        "/query/filters/0",
        "filter_not_allowed",
    ),
    "filtre mal forme": (
        poser(["query", "filters"], [{"column": "region", "operator": "between", "value": ["a"]}]),
        "/query/filters/0/value",
        "out_of_bounds",
    ),
    "calcul sur une metrique hors requete": (
        poser(
            ["contextual"],
            [{"operation": "aggregate", "metric": "orders", "group_by": [], "scope": None}],
        ),
        "/contextual/0/metric",
        "metric_not_in_query",
    ),
    "regroupement hors requete": (
        poser(
            ["contextual"],
            [{"operation": "aggregate", "metric": "revenue", "group_by": ["year"], "scope": None}],
        ),
        "/contextual/0/group_by/0",
        "group_by_not_in_query",
    ),
    "operation inconnue": (
        poser(
            ["contextual"],
            [{"operation": "median", "metric": "revenue", "group_by": [], "scope": None}],
        ),
        "/contextual/0/operation",
        "value_not_allowed",
    ),
    "perimetre inconnu": (
        poser(
            ["contextual"],
            [{"operation": "aggregate", "metric": "revenue", "group_by": [], "scope": "all"}],
        ),
        "/contextual/0/scope",
        "value_not_allowed",
    ),
    "denominateur inconnu": (
        poser(
            ["contextual"],
            [
                {
                    "operation": "share",
                    "metric": "revenue",
                    "group_by": [],
                    "denominator": "everything",
                }
            ],
        ),
        "/contextual/0/denominator",
        "value_not_allowed",
    ),
    "part sans denominateur": (
        poser(["contextual"], [{"operation": "share", "metric": "revenue", "group_by": []}]),
        "/contextual/0/denominator",
        "missing_field",
    ),
    "somme d'un compte distinct": (
        agreger("buyers"),
        "/contextual/0/metric",
        "count_distinct_not_summable",
    ),
    "somme d'une metrique semi-additive": (
        agreger("balance"),
        "/contextual/0/metric",
        "non_additive",
    ),
    "somme d'un minimum": (agreger("lowest"), "/contextual/0/metric", "non_additive"),
    "somme d'une moyenne": (agreger("basket"), "/contextual/0/metric", "non_additive"),
    "reagregation sans agregation declaree": (
        agreger("rate"),
        "/contextual/0/metric",
        "unknown_aggregation",
    ),
    "part d'une moyenne": (part("basket"), "/contextual/0/metric", "share_undefined"),
    "part d'un compte distinct": (part("buyers"), "/contextual/0/metric", "share_undefined"),
    "part d'une metrique semi-additive": (
        part("balance"),
        "/contextual/0/metric",
        "non_additive",
    ),
    "nom reserve": (
        poser(
            ["contextual"],
            [
                {
                    "operation": "share",
                    "metric": "revenue",
                    "group_by": [],
                    "denominator": "loaded_result",
                },
            ],
        ),
        None,
        None,
    ),
    "SQL dans la requete": (poser(["query", "sql"], "SELECT 1"), "/query/sql", "unknown_field"),
    "SQL dans l'analyse": (poser(["sql"], "SELECT 1"), "/sql", "unknown_field"),
    "environnement dans la requete": (
        poser(["query", "environment"], "PROD"),
        "/query/environment",
        "unknown_field",
    ),
    "SQL dans un filtre": (
        poser(
            ["query", "filters"],
            [{"column": "region", "operator": "eq", "value": "x", "sql": "1=1"}],
        ),
        "/query/filters/0/sql",
        "unknown_field",
    ),
    "nom absent": (retirer(["name"]), "/name", "missing_field"),
    "nom trop long": (poser(["name"], "n" * 121), "/name", "out_of_bounds"),
    "metriques absentes": (poser(["query", "metrics"], []), "/query/metrics", "out_of_bounds"),
    "type erroné": (poser(["query", "metrics"], "revenue"), "/query/metrics", "wrong_type"),
    "visibilite inconnue": (poser(["visibility"], "public"), "/visibility", "value_not_allowed"),
    "graphique inconnu": (
        poser(["presentation", "chart"], "pie"),
        "/presentation/chart",
        "value_not_allowed",
    ),
    "identifiant porté par le corps": (
        poser(["id"], "11111111-1111-4111-8111-111111111111"),
        "/id",
        "field_not_allowed",
    ),
    "propriétaire porté par le corps": (
        poser(["owner"], {"issuer": "x", "subject": "y"}),
        "/owner",
        "field_not_allowed",
    ),
    "version portée par le corps": (
        poser(["api_version"], "board.analysis/v1"),
        "/api_version",
        "field_not_allowed",
    ),
}
# Cas sans refus propre : accepté tel quel (une part sans dimension à retirer).
REFUS.pop("nom reserve")


def refuser(banc: Banc, mutation: Mutation, chemin: str, regle: str) -> dict[str, Any]:
    valeur = corps()
    mutation(valeur)
    reponse = banc.appel(CREATEUR_GROUPE, "POST", CHEMIN, json=valeur)
    assert reponse.status_code == 422, reponse.text
    erreur = reponse.json()["error"]
    assert erreur["code"] == "invalid_analysis"
    assert {"path": chemin, "rule": regle} in erreur["violations"], erreur
    # Rien n'a été écrit, ni dans git, ni dans l'index.
    assert banc.depot.analyses() == ()
    assert banc.index.rows(A) == []
    result: dict[str, Any] = reponse.json()
    return result


@pytest.mark.parametrize("cas", list(REFUS), ids=list(REFUS))
def test_une_analyse_invalide_est_refusee_avec_sa_raison(banc: Banc, cas: str) -> None:
    mutation, chemin, regle = REFUS[cas]
    assert chemin is not None and regle is not None
    refuser(banc, mutation, chemin, regle)


def test_le_refus_ne_cite_jamais_une_valeur(banc: Banc) -> None:
    secret = "valeur_confidentielle_42"
    mutation = poser(["query", "filters"], [{"column": "ghost", "operator": "eq", "value": secret}])
    texte = str(refuser(banc, mutation, "/query/filters/0", "filter_not_allowed"))
    assert secret not in texte


def test_plusieurs_refus_sont_rendus_tries(banc: Banc) -> None:
    valeur = corps()
    valeur["query"]["model"] = "ghost"
    valeur["query"]["connection"] = "ghost"
    erreur = banc.appel(CREATEUR_GROUPE, "POST", CHEMIN, json=valeur).json()["error"]
    assert erreur["violations"] == [
        {"path": "/query/connection", "rule": "unknown_connection"},
        {"path": "/query/model", "rule": "unknown_model"},
    ]
    assert erreur["reason"] == "unknown_connection"


# Réagrégations acceptées : la valeur du moteur est reprise telle quelle, ou le calcul est exact.
ACCEPTEES = {
    "somme d'une metrique additive": agreger("revenue"),
    "compte regroupé": agreger("orders", par=["region"], dimensions=["region", "channel"]),
    "compte distinct inchangé": agreger("buyers", par=["region"]),
    "metrique non additive sans dimension retirée": agreger("lowest", par=["region"]),
    "part d'une somme": part("revenue"),
    "part sans dimension": part("revenue", dimensions=[]),
    "part d'un compte": part("orders"),
}


@pytest.mark.parametrize("cas", list(ACCEPTEES), ids=list(ACCEPTEES))
def test_une_reagregation_exacte_est_acceptee(banc: Banc, cas: str) -> None:
    valeur = corps()
    valeur["query"]["dimensions"] = ["region"]
    ACCEPTEES[cas](valeur)
    reponse = banc.appel(CREATEUR_GROUPE, "POST", CHEMIN, json=valeur)
    assert reponse.status_code == 201, reponse.text


def test_une_analyse_sans_calcul_est_acceptee(banc: Banc) -> None:
    valeur = corps(contextual=[])
    assert banc.appel(CREATEUR_GROUPE, "POST", CHEMIN, json=valeur).status_code == 201


def test_les_valeurs_de_filtre_sont_normalisees_comme_une_soumission(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE)
    stocke = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}").json()["analysis"]
    assert stocke["query"]["filters"] == [
        {"column": "region", "operator": "in", "value": ["Nord", "Sud"]}
    ]


def test_la_revision_est_validee_comme_la_creation(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE)
    reponse = banc.reviser(CREATEUR_GROUPE, ident, 1, query={**corps()["query"], "model": "ghost"})
    assert reponse.status_code == 422
    assert reponse.json()["error"]["violations"] == [
        {"path": "/query/model", "rule": "unknown_model"}
    ]
    for champ in ("id", "owner", "api_version"):
        envoi = {**corps(), "expected_revision": 1, champ: "x"}
        refus = banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN}/{ident}/revisions", json=envoi)
        assert refus.status_code == 422
        assert refus.json()["error"]["violations"] == [
            {"path": f"/{champ}", "rule": "field_not_allowed"}
        ]
    historique = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions").json()
    assert len(historique["revisions"]) == 1


def test_la_revision_ne_change_pas_le_proprietaire(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    reponse = banc.reviser(ADMIN_GROUPE, ident, 1, visibility="shared", name="Renommée")
    assert reponse.status_code == 201
    document = reponse.json()["analysis"]
    assert document["owner"]["subject"] == CREATEUR_GROUPE.sujet
    assert reponse.json()["revised_by"]["subject"] == ADMIN_GROUPE.sujet
    assert reponse.json()["permissions"] == {
        "owner": False,
        "revise": True,
        "delete": True,
        "duplicate": True,
    }


def test_aucun_sql_ni_environnement_n_est_stocke(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE)
    brut = fichier(banc.racine, A, ident)
    assert brut is not None
    texte = brut.decode().lower()
    for interdit in ("select ", "from ", "environment", "sql"):
        assert interdit not in texte
    stocke = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}").json()["analysis"]
    assert "environment" not in stocke["query"]


def test_un_champ_disparu_rend_l_analyse_non_resolue(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    assert banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}").json()["state"] == "ready"
    banc.redefinir(["orders"], ["channel", "region"])
    lue = banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}")
    assert lue.status_code == 200
    assert lue.json()["state"] == "unresolved_reference"
    assert lue.json()["unresolved"] == [{"path": "/query/metrics/0", "rule": "unknown_metric"}]
    # Le contenu est servi tel qu'enregistré : rien n'est approximé ni remplacé.
    assert lue.json()["analysis"]["query"]["metrics"] == ["revenue"]
    banc.redefinir(["revenue"], ["channel"])
    lue = banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}").json()
    assert lue["unresolved"] == [
        {"path": "/query/dimensions/0", "rule": "unknown_dimension"},
        {"path": "/query/filters/0", "rule": "filter_not_allowed"},
    ]
    numerotee = banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions/1").json()
    assert numerotee["state"] == "unresolved_reference"


def test_un_modele_disparu_ou_une_connexion_disparue(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE)
    catalogue = yaml.safe_load((banc.dossier_modeles / "semantic_catalog.yaml").read_text())
    catalogue["models"][0]["key"] = "autre"
    (banc.dossier_modeles / "semantic_catalog.yaml").write_text(yaml.safe_dump(catalogue))
    (banc.dossier_modeles / "autre.yaml").write_text(
        (banc.dossier_modeles / "sales.yaml").read_text().replace("name: sales", "name: autre")
    )
    catalogue["models"][0]["file"] = "autre.yaml"
    (banc.dossier_modeles / "semantic_catalog.yaml").write_text(yaml.safe_dump(catalogue))
    lue = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}").json()
    assert lue["state"] == "unresolved_reference"
    assert {"path": "/query/model", "rule": "unknown_model"} in lue["unresolved"]


def test_un_catalogue_illisible_laisse_l_analyse_non_verifiee(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    (banc.dossier_modeles / "semantic_catalog.yaml").unlink()
    lue = banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}")
    assert lue.status_code == 200
    assert lue.json()["state"] == "unverified" and lue.json()["unresolved"] == []
    # Aucune sauvegarde sans catalogue : rien n'est validé, rien n'est écrit.
    for reponse in (
        banc.creer(CREATEUR_GROUPE),
        banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="shared", name="Autre"),
        banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN}/{ident}/duplicate"),
    ):
        assert reponse.status_code == 503
        assert reponse.json() == {"error": {"code": "engine_unavailable"}}
    assert len(banc.depot.analyses()) == 1
    modeles(banc.dossier_modeles.parent)
    assert banc.appel(ADMIN_PERSONNE, "GET", f"{CHEMIN}/{ident}").json()["state"] == "ready"


def test_l_etat_suit_une_priorite_fixe(banc: Banc) -> None:
    """`index_stale`, puis `unverified`, puis `unresolved_reference`, puis `ready`."""
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    assert (
        banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="shared", name="Deux").status_code == 201
    )

    def etat(suite: str = "") -> str:
        lue = banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}{suite}")
        assert lue.status_code == 200
        etat: str = lue.json()["state"]
        return etat

    # Références disparues et index à jour : non résolue.
    banc.redefinir(["orders"], ["channel", "region"])
    assert etat() == "unresolved_reference"
    # Index en écart ET références disparues : l'écart d'abord, il demande une réindexation.
    banc.index.remove(A, ident, 2)
    assert etat() == "index_stale"
    # L'écart ne concerne que la révision courante.
    assert etat("/revisions/1") == "unresolved_reference"
    # Index en écart ET catalogue illisible : l'écart d'abord.
    (banc.dossier_modeles / "semantic_catalog.yaml").unlink()
    assert etat() == "index_stale"
    # Index à jour ET catalogue illisible : non vérifiée, sans références à citer.
    banc.index.upsert(IndexRow.of(A, banc.depot.read(A, ident)))
    assert etat() == "unverified"
    modeles(banc.dossier_modeles.parent)
    assert etat() == "ready"
