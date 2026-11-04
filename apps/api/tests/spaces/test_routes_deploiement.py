"""Environnements des espaces et accords du droit de déployer, par les routes (plan 09, 9.2 ;
V1, V3 à V9).

Serveur réel sur une base migrée, profils de `monde`. Chaque espace porte `DEV`, `TEST` et
`PROD` dans cet ordre, et pour chacun `deploy`, vrai seulement avec un accord correspondant à
la session **et** le rôle créateur ou plus. Les accords se gèrent par les administrateurs de
l'espace et de la plateforme ; chaque refus a un code fermé et n'écrit rien.
"""

from __future__ import annotations

import itertools
import json
from datetime import timedelta
from typing import Any

import pytest
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from skifer_board.spaces import (
    DeployGrant,
    Environment,
    GroupPrincipal,
    Principal,
    Role,
    SpaceStore,
)
from skifer_board.state.schema import deploy_grants, space_environments
from sqlalchemy import Engine, create_engine, select
from state.conftest import migre as migre

from spaces.monde import (
    ADMIN_B,
    ADMIN_GROUPE,
    ADMIN_PERSONNE,
    CREATEUR_GROUPE,
    CREATEUR_PERSONNE,
    EMETTEUR,
    INVITEE,
    LECTEUR_GROUPE,
    LECTEUR_PERSONNE,
    NON_MEMBRE,
    PLATEFORME,
    PLATEFORME_LECTEUR,
    PLATEFORME_SEULE,
    A,
    B,
    Monde,
    Profil,
    instantane,
)
from spaces.monde import config_plateforme as config_plateforme
from spaces.monde import monde as monde
from spaces.test_routes_ecritures import (
    CORPS_ILLISIBLES,
    ORIGINES_REFUSEES,
    PRINCIPAUX_INVALIDES,
    SENTINELLE,
    envoyer,
    invalide,
    rembourre,
    sans,
    sans_trace,
    sous,
)

DEV, TEST, PROD = Environment.DEV, Environment.TEST, Environment.PROD
CODES = ("DEV", "TEST", "PROD")
INTROUVABLE = {"error": {"code": "space_not_found"}}
ACCORD_INTROUVABLE = {"error": {"code": "grant_not_found"}}
UUID_INCONNU = "5b0e4c1e-0000-4000-8000-000000000000"
ACCORD = {"environment": "PROD", "principal": {"kind": "group", "name": "finance-ops"}}
# Personne connue de Board, membre nulle part dans A (E5).
DORA = Profil("double", "dora", ("finance-createurs", "finance-lecteurs"))


def interdit(requis: str) -> dict[str, Any]:
    return {"error": {"code": "forbidden", "required": requis}}


def environnements(*deploie: str) -> list[dict[str, Any]]:
    """Les trois environnements dans l'ordre de promotion ; `deploy` pour ceux nommés."""
    return [{"code": code, "deploy": code in deploie} for code in CODES]


def personne(profil: Profil) -> dict[str, str]:
    return {"kind": "person", "issuer": EMETTEUR, "subject": profil.sujet}


def accorder(monde: Monde, espace: str, environnement: Environment, qui: Principal) -> DeployGrant:
    """Accord posé par le magasin, comme l'aurait fait la plateforme."""
    return monde.magasin.grant(espace, environnement, qui, PLATEFORME_SEULE.ref, monde.horloge())


def etat(moteur: Engine) -> dict[str, list[tuple[Any, ...]]]:
    """Tables des espaces, accords et environnements compris : un refus n'y écrit rien."""
    contenu = instantane(moteur)
    temoin = create_engine(moteur.url)
    try:
        with temoin.connect() as connexion:
            for table in (deploy_grants, space_environments):
                lignes = connexion.execute(select(table)).all()
                contenu[table.name] = sorted((tuple(ligne) for ligne in lignes), key=repr)
    finally:
        temoin.dispose()
    return contenu


def deploiements(monde: Monde, profil: Profil) -> dict[str, list[dict[str, Any]]]:
    """Environnements de chaque espace visible par `GET /api/spaces`, et la même chose par
    `GET /api/spaces/{id}`, qui doit dire pareil."""
    liste = monde.requete(profil, "GET", "/api/spaces")
    assert liste.status_code == 200
    vus = {e["id"]: e["environments"] for e in liste.json()["spaces"]}
    for espace_id, envs in vus.items():
        seul = monde.requete(profil, "GET", f"/api/spaces/{espace_id}")
        assert seul.status_code == 200
        assert seul.json()["environments"] == envs, (profil.nom, espace_id)
    return vus


def evenements(monde: Monde, espace: str = A) -> list[dict[str, Any]]:
    reponse = monde.requete(PLATEFORME_SEULE, "GET", f"/api/spaces/{espace}/events")
    assert reponse.status_code == 200
    resultat: list[dict[str, Any]] = reponse.json()["events"]
    return resultat


def accords(monde: Monde, espace: str = A, profil: Profil = PLATEFORME_SEULE) -> list[Any]:
    reponse = monde.requete(profil, "GET", f"/api/spaces/{espace}/deploy-grants")
    assert reponse.status_code == 200
    assert set(reponse.json()) == {"grants"}
    resultat: list[Any] = reponse.json()["grants"]
    return resultat


# --- Environnements des espaces et droit de déployer (V1, V3, V4, V7). ---------------------


@pytest.fixture
def accords_poses(monde: Monde) -> Monde:
    """Accords à tous les cas de V3 et V4, dans A et dans B."""
    accorder(monde, A, DEV, GroupPrincipal("finance-createurs"))  # créateur par groupe
    accorder(monde, A, TEST, CREATEUR_PERSONNE.ref)  # créateur par personne
    accorder(monde, A, PROD, GroupPrincipal("finance-lecteurs"))  # lecteurs : sans effet
    accorder(monde, A, PROD, LECTEUR_PERSONNE.ref)  # lecteur : sans effet
    accorder(monde, A, PROD, GroupPrincipal("finance-admins"))  # administrateurs par groupe
    accorder(monde, A, DEV, GroupPrincipal(PLATEFORME))  # plateforme : sans effet
    # Groupe voisin de `finance-createurs` : la casse compte (E3).
    accorder(monde, A, TEST, GroupPrincipal("Finance-Createurs"))
    # Groupe de l'administrateur de B : sans rôle dans A, sans effet dans A.
    accorder(monde, A, PROD, GroupPrincipal("rh-admins"))
    accorder(monde, B, TEST, GroupPrincipal("rh-admins"))
    # Un accord dans B ne vaut pas dans A.
    accorder(monde, B, PROD, CREATEUR_PERSONNE.ref)
    accorder(monde, B, PROD, GroupPrincipal("finance-createurs"))
    return monde


@pytest.mark.parametrize(
    "profil,attendu",
    [
        (LECTEUR_GROUPE, {A: environnements()}),
        (LECTEUR_PERSONNE, {A: environnements()}),
        (CREATEUR_GROUPE, {A: environnements("DEV")}),
        (CREATEUR_PERSONNE, {A: environnements("TEST")}),
        (ADMIN_GROUPE, {A: environnements("PROD")}),
        # Administrateur sans accord : pas de droit d'office (V4).
        (ADMIN_PERSONNE, {A: environnements()}),
        (NON_MEMBRE, {}),
        # La plateforme gère les accords, elle ne déploie pas, même avec un accord (V4).
        (PLATEFORME_SEULE, {A: environnements(), B: environnements()}),
        (PLATEFORME_LECTEUR, {A: environnements(), B: environnements()}),
        (ADMIN_B, {B: environnements("TEST")}),
    ],
    ids=lambda v: v.nom if isinstance(v, Profil) else "",
)
def test_droit_de_deployer_par_profil(
    accords_poses: Monde, profil: Profil, attendu: dict[str, list[dict[str, Any]]]
) -> None:
    assert deploiements(accords_poses, profil) == attendu


def test_environnements_sans_accord_dans_l_ordre(monde: Monde) -> None:
    """Toujours les trois, dans l'ordre de promotion, et personne ne déploie sans accord."""
    for profil in (LECTEUR_GROUPE, CREATEUR_GROUPE, ADMIN_GROUPE, PLATEFORME_SEULE, ADMIN_B):
        for envs in deploiements(monde, profil).values():
            assert envs == environnements()
            assert [e["code"] for e in envs] == ["DEV", "TEST", "PROD"]
            assert all(set(e) == {"code", "deploy"} for e in envs)


def test_espace_cree_porte_ses_trois_environnements(monde: Monde) -> None:
    corps = {"id": "nouveau", "name": "Nouveau", "first_admin": personne(INVITEE)}
    cree = monde.requete(PLATEFORME_SEULE, "POST", "/api/spaces", corps=corps)
    assert cree.status_code == 201
    assert cree.json()["environments"] == environnements()
    # Sa première administratrice ne déploie pas sans accord ; avec un accord, si.
    assert deploiements(monde, INVITEE)["nouveau"] == environnements()
    reponse = monde.requete(
        INVITEE,
        "POST",
        "/api/spaces/nouveau/deploy-grants",
        corps={"environment": "PROD", "principal": personne(INVITEE)},
    )
    assert reponse.status_code == 200
    assert deploiements(monde, INVITEE)["nouveau"] == environnements("PROD")


def test_lecteur_avec_accord_deploie_des_qu_il_devient_createur(monde: Monde) -> None:
    """L'accord reste sans effet sous le rôle créateur ; le rôle relevé suffit (V3)."""
    accorder(monde, A, PROD, GroupPrincipal("finance-lecteurs"))
    assert deploiements(monde, LECTEUR_GROUPE)[A] == environnements()
    liaison = {"principal": personne(LECTEUR_GROUPE), "role": "creator"}
    pose = monde.requete(ADMIN_GROUPE, "POST", f"/api/spaces/{A}/members", corps=liaison)
    assert pose.status_code == 200
    assert deploiements(monde, LECTEUR_GROUPE)[A] == environnements("PROD")
    # Rabaissée à lectrice : le droit tombe, l'accord reste.
    liaison["role"] = "reader"
    assert monde.requete(ADMIN_GROUPE, "POST", f"/api/spaces/{A}/members", corps=liaison).is_success
    assert deploiements(monde, LECTEUR_GROUPE)[A] == environnements()
    assert [g["environment"] for g in accords(monde)] == ["PROD"]


def test_revocation_effective_a_la_requete_suivante(monde: Monde) -> None:
    cree = monde.requete(
        ADMIN_GROUPE,
        "POST",
        f"/api/spaces/{A}/deploy-grants",
        corps={"environment": "DEV", "principal": {"kind": "group", "name": "finance-createurs"}},
    )
    assert cree.status_code == 200
    assert deploiements(monde, CREATEUR_GROUPE)[A] == environnements("DEV")
    retrait = monde.requete(
        ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/deploy-grants/{cree.json()['id']}"
    )
    assert retrait.status_code == 204
    assert retrait.content == b""
    assert deploiements(monde, CREATEUR_GROUPE)[A] == environnements()
    assert accords(monde) == []
    # Un second retrait du même accord : introuvable.
    encore = monde.requete(
        ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/deploy-grants/{cree.json()['id']}"
    )
    assert (encore.status_code, encore.json()) == (404, ACCORD_INTROUVABLE)


def test_retrait_d_une_liaison_ne_retire_pas_l_accord(monde: Monde) -> None:
    """Liaison et accord sont indépendants (V5) : la liaison retirée fait tomber `deploy`,
    l'accord reste et revaut dès que la liaison revient."""
    accorder(monde, A, DEV, GroupPrincipal("finance-createurs"))
    assert deploiements(monde, DORA)[A] == environnements("DEV")
    assert deploiements(monde, CREATEUR_GROUPE)[A] == environnements("DEV")
    [createurs] = [
        liaison.id
        for liaison in monde.magasin.bindings(A)
        if liaison.principal == GroupPrincipal("finance-createurs")
    ]
    retrait = monde.requete(ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/members/{createurs}")
    assert retrait.status_code == 204
    # Dora reste lectrice par un autre groupe : elle voit l'espace et n'y déploie plus.
    assert deploiements(monde, DORA)[A] == environnements()
    # Cora n'est plus membre : l'espace lui est introuvable.
    assert deploiements(monde, CREATEUR_GROUPE) == {}
    vu = monde.requete(CREATEUR_GROUPE, "GET", f"/api/spaces/{A}")
    assert (vu.status_code, vu.json()) == (404, INTROUVABLE)
    assert [(g["environment"], g["principal"]) for g in accords(monde)] == [
        ("DEV", {"kind": "group", "name": "finance-createurs"})
    ]
    assert not any(e["action"] == "deploy_revoked" for e in evenements(monde))
    liaison = {"principal": {"kind": "group", "name": "finance-createurs"}, "role": "creator"}
    assert monde.requete(ADMIN_GROUPE, "POST", f"/api/spaces/{A}/members", corps=liaison).is_success
    assert deploiements(monde, DORA)[A] == environnements("DEV")
    assert deploiements(monde, CREATEUR_GROUPE)[A] == environnements("DEV")


def test_groupe_perdu_a_la_session_suivante(monde: Monde) -> None:
    """Le droit suit les groupes de la session : une nouvelle session sans le groupe n'a
    plus le droit, l'ancienne le garde tant qu'elle vit."""
    accorder(monde, A, PROD, GroupPrincipal("finance-admins"))
    assert deploiements(monde, ADMIN_GROUPE)[A] == environnements("PROD")
    # Même personne, désormais administratrice par une liaison de personne seulement.
    monde.magasin.set_binding(
        A, ADMIN_GROUPE.ref, Role.ADMIN, PLATEFORME_SEULE.ref, monde.horloge()
    )
    sans_groupe = Profil("admin-sans-groupe", ADMIN_GROUPE.sujet)
    assert deploiements(monde, sans_groupe)[A] == environnements()


# --- Gestion des accords (V5, V9). ---------------------------------------------------------


@pytest.mark.parametrize(
    "profil",
    [ADMIN_GROUPE, ADMIN_PERSONNE, PLATEFORME_SEULE, PLATEFORME_LECTEUR],
    ids=lambda p: p.nom,
)
def test_accorder_lister_retirer(monde: Monde, profil: Profil) -> None:
    debut = monde.horloge()
    reponse = monde.requete(profil, "POST", f"/api/spaces/{A}/deploy-grants", corps=ACCORD)
    assert reponse.status_code == 200
    cree = reponse.json()
    auteur = {"name": f"Nom {profil.sujet}", "email": f"{profil.sujet}@example.invalid"}
    assert cree == {
        "id": cree["id"],
        "environment": "PROD",
        "principal": {"kind": "group", "name": "finance-ops"},
        "person": None,
        "created_at": debut.isoformat(),
        "created_by": {"issuer": EMETTEUR, "subject": profil.sujet},
        "created_by_person": auteur,
    }
    monde.horloge.instant = debut + timedelta(minutes=1)
    reponse = monde.requete(
        profil,
        "POST",
        f"/api/spaces/{A}/deploy-grants",
        corps={"environment": "TEST", "principal": personne(CREATEUR_PERSONNE)},
    )
    assert reponse.status_code == 200
    second = reponse.json()
    assert second["person"] == {"name": "Nom cyril", "email": "cyril@example.invalid"}
    assert second["created_at"] == (debut + timedelta(minutes=1)).isoformat()
    # Ordre de création ; la liste rend exactement ce que l'accord a rendu.
    assert accords(monde, A, profil) == [cree, second]
    assert {g.id for g in monde.magasin.grants(A)} == {cree["id"], second["id"]}
    assert deploiements(monde, CREATEUR_PERSONNE)[A] == environnements("TEST")
    retrait = monde.requete(profil, "DELETE", f"/api/spaces/{A}/deploy-grants/{cree['id']}")
    assert retrait.status_code == 204
    assert accords(monde, A, profil) == [second]
    # Rien n'a débordé sur B.
    assert monde.magasin.grants(B) == []


def test_accord_idempotent(monde: Monde) -> None:
    """Accorder un droit déjà accordé rend le même accord, sans second événement (V5)."""
    premier = monde.requete(ADMIN_GROUPE, "POST", f"/api/spaces/{A}/deploy-grants", corps=ACCORD)
    assert premier.status_code == 200
    avant = evenements(monde)
    monde.horloge.instant += timedelta(minutes=1)
    for profil in (ADMIN_GROUPE, ADMIN_PERSONNE, PLATEFORME_SEULE):
        encore = monde.requete(profil, "POST", f"/api/spaces/{A}/deploy-grants", corps=ACCORD)
        assert encore.status_code == 200
        # Même accord : même identifiant, même auteur, même instant.
        assert encore.json() == premier.json()
    assert evenements(monde) == avant
    assert len(accords(monde)) == 1
    # Autre environnement, autre principal, autre espace : d'autres accords.
    for corps, cible in (
        ({**ACCORD, "environment": "DEV"}, A),
        ({**ACCORD, "principal": {"kind": "group", "name": "Finance-Ops"}}, A),
        (ACCORD, B),
    ):
        autre = monde.requete(
            PLATEFORME_SEULE, "POST", f"/api/spaces/{cible}/deploy-grants", corps=corps
        )
        assert autre.status_code == 200
        assert autre.json()["id"] != premier.json()["id"]
    assert len(accords(monde)) == 3
    assert len(accords(monde, B)) == 1


def test_accord_a_une_personne_inconnue(monde: Monde) -> None:
    avant = etat(monde.moteur)
    for principal in (
        {"kind": "person", "issuer": EMETTEUR, "subject": "jamais-connecte"},
        # Sujet connu chez un autre émetteur : une autre personne (E3).
        {"kind": "person", "issuer": "https://autre.example.invalid", "subject": "cyril"},
        {"kind": "person", "issuer": EMETTEUR, "subject": "CYRIL"},
    ):
        for profil in (ADMIN_GROUPE, PLATEFORME_SEULE):
            reponse = monde.requete(
                profil,
                "POST",
                f"/api/spaces/{A}/deploy-grants",
                corps={"environment": "DEV", "principal": principal},
            )
            assert (reponse.status_code, reponse.json()) == (
                422,
                {"error": {"code": "unknown_person"}},
            )
    assert etat(monde.moteur) == avant


def test_accord_a_une_personne_connue_hors_de_l_espace(monde: Monde) -> None:
    """Une personne connue sans rôle dans A peut recevoir un accord : il reste sans effet."""
    reponse = monde.requete(
        ADMIN_GROUPE,
        "POST",
        f"/api/spaces/{A}/deploy-grants",
        corps={"environment": "DEV", "principal": personne(INVITEE)},
    )
    assert reponse.status_code == 200
    assert reponse.json()["person"] == {"name": "Nom ines", "email": "ines@example.invalid"}
    # Ines lit B : l'accord de A n'y vaut rien, et A lui reste introuvable.
    assert deploiements(monde, INVITEE) == {B: environnements()}


@pytest.mark.parametrize(
    "profil,statut,refus",
    [
        (LECTEUR_GROUPE, 403, interdit("admin")),
        (LECTEUR_PERSONNE, 403, interdit("admin")),
        (CREATEUR_GROUPE, 403, interdit("admin")),
        (CREATEUR_PERSONNE, 403, interdit("admin")),
        (NON_MEMBRE, 404, INTROUVABLE),
        (ADMIN_B, 404, INTROUVABLE),
    ],
    ids=lambda v: v.nom if isinstance(v, Profil) else str(v),
)
def test_gestion_refusee_sans_ecriture(
    monde: Monde, profil: Profil, statut: int, refus: dict[str, Any]
) -> None:
    """Ni lister, ni accorder (même à soi-même), ni retirer ; avec un corps invalide ou un
    identifiant hors format, le refus d'accès passe avant."""
    existant = accorder(monde, A, PROD, GroupPrincipal("finance-admins"))
    avant = etat(monde.moteur)
    pour_soi = {"environment": "PROD", "principal": personne(profil)}
    for methode, chemin, corps in (
        ("GET", f"/api/spaces/{A}/deploy-grants", None),
        ("POST", f"/api/spaces/{A}/deploy-grants", ACCORD),
        ("POST", f"/api/spaces/{A}/deploy-grants", pour_soi),
        ("POST", f"/api/spaces/{A}/deploy-grants", {"environment": "QA"}),
        ("POST", f"/api/spaces/{A}/deploy-grants", {SENTINELLE: 1}),
        ("DELETE", f"/api/spaces/{A}/deploy-grants/{existant.id}", None),
        ("DELETE", f"/api/spaces/{A}/deploy-grants/{UUID_INCONNU}", None),
        ("DELETE", f"/api/spaces/{A}/deploy-grants/inconnu", None),
    ):
        reponse = monde.requete(profil, methode, chemin, corps=corps)
        assert (reponse.status_code, reponse.json()) == (statut, refus), (methode, chemin, corps)
    assert etat(monde.moteur) == avant
    assert deploiements(monde, ADMIN_GROUPE)[A] == environnements("PROD")


def test_sans_session(monde: Monde) -> None:
    existant = accorder(monde, A, PROD, GroupPrincipal("finance-admins"))
    avant = etat(monde.moteur)
    for methode, chemin, corps in (
        ("GET", f"/api/spaces/{A}/deploy-grants", None),
        ("POST", f"/api/spaces/{A}/deploy-grants", ACCORD),
        ("DELETE", f"/api/spaces/{A}/deploy-grants/{existant.id}", None),
    ):
        reponse = monde.requete(None, methode, chemin, corps=corps)
        assert reponse.status_code == 401
        assert reponse.json()["error"]["code"] == "unauthenticated"
    assert etat(monde.moteur) == avant


def test_ecritures_hors_origine_refusees(monde: Monde) -> None:
    existant = accorder(monde, A, PROD, GroupPrincipal("finance-admins"))
    avant = etat(monde.moteur)
    for origine, (profil, methode, chemin, corps) in itertools.product(
        ORIGINES_REFUSEES,
        (
            (ADMIN_GROUPE, "POST", f"/api/spaces/{A}/deploy-grants", ACCORD),
            (PLATEFORME_SEULE, "POST", f"/api/spaces/{A}/deploy-grants", ACCORD),
            (ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/deploy-grants/{existant.id}", None),
            (PLATEFORME_SEULE, "DELETE", f"/api/spaces/{A}/deploy-grants/{existant.id}", None),
            (ADMIN_GROUPE, "POST", "/api/spaces/inconnu/deploy-grants", {"environment": "QA"}),
        ),
    ):
        reponse = monde.requete(profil, methode, chemin, corps=corps, origine=origine)
        assert (reponse.status_code, reponse.json()) == (
            403,
            {"error": {"code": "origin_refused"}},
        ), (origine, methode, chemin)
    assert etat(monde.moteur) == avant
    # La lecture, elle, n'exige pas d'origine.
    lecture = monde.requete(ADMIN_GROUPE, "GET", f"/api/spaces/{A}/deploy-grants", origine=None)
    assert lecture.status_code == 200


# --- Corps refusés (V9). -------------------------------------------------------------------

ENVIRONNEMENTS_INVALIDES: list[object] = [
    "QA",
    "LOCAL",
    "dev",
    "Dev",
    "prod",
    "PRODUCTION",
    " DEV",
    "PROD ",
    "DEV\x00",
    "",
    SENTINELLE,
    1,
    0,
    True,
    None,
    [],
    ["DEV"],
    {"code": "DEV"},
    1.5,
]


def cas_accord() -> list[tuple[str, bytes | dict[str, Any], str]]:
    cas: list[tuple[str, bytes | dict[str, Any], str]] = [
        (f"illisible-{i}", contenu, "body") for i, contenu in enumerate(CORPS_ILLISIBLES)
    ]
    cas += [
        ("vide", {}, "environment"),
        ("sans-environnement", sans(ACCORD, "environment"), "environment"),
        ("sans-principal", sans(ACCORD, "principal"), "principal"),
        # L'environnement est examiné avant le principal.
        ("tout-invalide", {"environment": "QA", "principal": {"kind": "robot"}}, "environment"),
        ("en-trop-espace", {**ACCORD, "space_id": "rh"}, "body"),
        ("en-trop-id", {**ACCORD, "id": UUID_INCONNU}, "body"),
        ("en-trop-role", {**ACCORD, "role": "admin"}, "body"),
        ("en-trop-auteur", {**ACCORD, "created_by": {"issuer": "i", "subject": "s"}}, "body"),
        ("en-trop-sentinelle", {**ACCORD, SENTINELLE: 1}, "body"),
        ("environnements", {"environments": ["DEV"], "principal": ACCORD["principal"]}, "body"),
    ]
    cas += [
        (f"environnement-{i}", {**ACCORD, "environment": v}, "environment")
        for i, v in enumerate(ENVIRONNEMENTS_INVALIDES)
    ]
    cas += [
        (f"principal-{i}", {**ACCORD, "principal": v}, sous("principal", champ))
        for i, (v, champ) in enumerate(PRINCIPAUX_INVALIDES)
    ]
    return cas


@pytest.mark.parametrize("profil", [ADMIN_GROUPE, PLATEFORME_SEULE], ids=lambda p: p.nom)
def test_corps_invalides(monde: Monde, profil: Profil) -> None:
    avant = etat(monde.moteur)
    ecarts = []
    for nom, envoi, champ in cas_accord():
        reponse = envoyer(monde, profil, "POST", f"/api/spaces/{A}/deploy-grants", envoi)
        if (reponse.status_code, reponse.json()) != (400, invalide(champ)):
            ecarts.append(f"{nom} : {reponse.status_code} {reponse.text}")
        sans_trace(reponse.text)
    assert ecarts == []
    assert etat(monde.moteur) == avant


def test_environnement_invalide_exemple_du_plan(monde: Monde) -> None:
    """`QA` est un environnement de skifer, pas de Board (V1)."""
    reponse = monde.requete(
        ADMIN_GROUPE,
        "POST",
        f"/api/spaces/{A}/deploy-grants",
        corps={"environment": "QA", "principal": {"kind": "group", "name": "finance-ops"}},
    )
    assert (reponse.status_code, reponse.json()) == (
        400,
        {"error": {"code": "invalid_request", "field": "environment"}},
    )


@pytest.mark.parametrize(
    "contenu",
    [
        b'{"environment": "DEV", "environment": "PROD", "principal": {"kind": "group", '
        b'"name": "g"}}',
        b'{"environment": "PROD", "principal": {"kind": "group", "name": "a", "name": "b"}}',
        b'{"environment": "PROD", "principal": {"kind": "group", "name": "g"}, "principal": {}}',
    ],
)
def test_cles_en_double_refusees(monde: Monde, contenu: bytes) -> None:
    avant = etat(monde.moteur)
    reponse = monde.requete(ADMIN_GROUPE, "POST", f"/api/spaces/{A}/deploy-grants", contenu=contenu)
    assert (reponse.status_code, reponse.json()) == (400, invalide("body"))
    assert etat(monde.moteur) == avant


TAILLE_MAX = 64 * 1024


def test_corps_a_la_taille_maximale(monde: Monde) -> None:
    avant = etat(monde.moteur)
    chemin = f"/api/spaces/{A}/deploy-grants"
    for taille in (TAILLE_MAX + 1, 10 * TAILLE_MAX):
        reponse = monde.requete(ADMIN_GROUPE, "POST", chemin, contenu=rembourre(ACCORD, taille))
        assert (reponse.status_code, reponse.json()) == (400, invalide("body")), taille
    assert etat(monde.moteur) == avant
    reponse = monde.requete(ADMIN_GROUPE, "POST", chemin, contenu=rembourre(ACCORD, TAILLE_MAX))
    assert reponse.status_code == 200


def test_corps_lu_comme_json_quel_que_soit_l_en_tete(monde: Monde) -> None:
    reponse = monde.client.post(
        f"/api/spaces/{A}/deploy-grants",
        content=json.dumps(ACCORD).encode(),
        headers={
            "Cookie": f"__Host-sb_session={monde.session(ADMIN_GROUPE)}",
            "Origin": "https://board.example.invalid",
            "Content-Type": "text/plain",
        },
    )
    assert reponse.status_code == 200


# --- Identifiant d'accord (V9). ------------------------------------------------------------

ACCORDS_HORS_FORMAT = [
    "inconnu",
    "a" * 36,
    "x" * 300,
    UUID_INCONNU.upper(),
    "{" + UUID_INCONNU + "}",
    UUID_INCONNU.replace("-", ""),
    UUID_INCONNU + "0",
    UUID_INCONNU[1:],
    UUID_INCONNU + "%0A",
    "%20" + UUID_INCONNU,
    UUID_INCONNU.replace("5b0e", "5g0e"),
    SENTINELLE,
]


def test_accord_hors_format_sans_toucher_la_base(
    monde: Monde, monkeypatch: pytest.MonkeyPatch
) -> None:
    appels: list[str] = []

    def espion(_magasin: SpaceStore, espace: str, accord: str, *_args: object) -> None:
        appels.append(accord)

    existant = accorder(monde, A, PROD, GroupPrincipal("finance-admins"))
    avant = etat(monde.moteur)
    monkeypatch.setattr(SpaceStore, "revoke", espion)
    for identifiant in [*ACCORDS_HORS_FORMAT, existant.id.upper()]:
        for profil in (ADMIN_GROUPE, PLATEFORME_SEULE):
            chemin = f"/api/spaces/{A}/deploy-grants/{identifiant}"
            reponse = monde.requete(profil, "DELETE", chemin)
            assert (reponse.status_code, reponse.json()) == (404, ACCORD_INTROUVABLE), identifiant
            sans_trace(reponse.text)
    assert appels == []
    # Le format valide, lui, va jusqu'au magasin.
    monde.requete(ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/deploy-grants/{UUID_INCONNU}")
    assert appels == [UUID_INCONNU]
    monkeypatch.undo()
    assert etat(monde.moteur) == avant


def test_accord_introuvable_au_bon_format(monde: Monde) -> None:
    """Accord inconnu, accord d'un autre espace, identifiant d'une liaison : même 404, et
    rien n'est retiré ni journalisé."""
    dans_b = accorder(monde, B, PROD, GroupPrincipal("rh-admins"))
    dans_a = accorder(monde, A, PROD, GroupPrincipal("finance-admins"))
    avant = etat(monde.moteur)
    for identifiant in (
        UUID_INCONNU,
        "00000000-0000-0000-0000-000000000000",
        dans_b.id,
        monde.liaisons["a-stagiaires"],
    ):
        for profil in (ADMIN_GROUPE, PLATEFORME_SEULE):
            chemin = f"/api/spaces/{A}/deploy-grants/{identifiant}"
            reponse = monde.requete(profil, "DELETE", chemin)
            assert (reponse.status_code, reponse.json()) == (404, ACCORD_INTROUVABLE)
    # À l'inverse, un identifiant d'accord ne désigne aucune liaison.
    reponse = monde.requete(ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/members/{dans_a.id}")
    assert (reponse.status_code, reponse.json()) == (404, {"error": {"code": "binding_not_found"}})
    assert etat(monde.moteur) == avant
    # L'accord de B se retire bien depuis B.
    reponse = monde.requete(ADMIN_B, "DELETE", f"/api/spaces/{B}/deploy-grants/{dans_b.id}")
    assert reponse.status_code == 204
    assert monde.magasin.grants(B) == []
    assert [g.id for g in monde.magasin.grants(A)] == [dans_a.id]


def test_accord_hors_format_apres_le_controle_du_role(monde: Monde) -> None:
    for identifiant in ("inconnu", UUID_INCONNU):
        chemin = f"/api/spaces/{A}/deploy-grants/{identifiant}"
        refus = monde.requete(CREATEUR_GROUPE, "DELETE", chemin)
        assert (refus.status_code, refus.json()) == (403, interdit("admin"))
        cache = monde.requete(NON_MEMBRE, "DELETE", chemin)
        assert (cache.status_code, cache.json()) == (404, INTROUVABLE)


# --- Journal (V6). -------------------------------------------------------------------------


def test_journal_des_accords(monde: Monde) -> None:
    debut = len(evenements(monde))
    instant = monde.horloge()
    cyril = personne(CREATEUR_PERSONNE)
    pose = monde.requete(
        ADMIN_GROUPE,
        "POST",
        f"/api/spaces/{A}/deploy-grants",
        corps={"environment": "TEST", "principal": cyril},
    )
    assert pose.status_code == 200
    groupe = monde.requete(PLATEFORME_SEULE, "POST", f"/api/spaces/{A}/deploy-grants", corps=ACCORD)
    assert groupe.status_code == 200
    # Accord déjà posé, retrait inconnu, refus : rien au journal.
    monde.requete(ADMIN_PERSONNE, "POST", f"/api/spaces/{A}/deploy-grants", corps=ACCORD)
    monde.requete(ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/deploy-grants/{UUID_INCONNU}")
    monde.requete(
        LECTEUR_GROUPE,
        "POST",
        f"/api/spaces/{A}/deploy-grants",
        corps={**ACCORD, "environment": "DEV"},
    )
    retire = monde.requete(
        ADMIN_PERSONNE, "DELETE", f"/api/spaces/{A}/deploy-grants/{pose.json()['id']}"
    )
    assert retire.status_code == 204

    journal = evenements(monde)
    assert len(journal) == debut + 3
    recents = journal[:3]
    for evenement in recents:
        assert evenement["at"] == instant.isoformat()
        del evenement["id"], evenement["at"]

    def acteur(profil: Profil) -> dict[str, Any]:
        return {
            "actor": {"issuer": EMETTEUR, "subject": profil.sujet},
            "actor_person": {
                "name": f"Nom {profil.sujet}",
                "email": f"{profil.sujet}@example.invalid",
            },
        }

    cyril_nomme = {"name": "Nom cyril", "email": "cyril@example.invalid"}
    assert recents == [
        {
            **acteur(ADMIN_PERSONNE),
            "action": "deploy_revoked",
            "detail": {"environment": "TEST", "principal": cyril},
            "principal_person": cyril_nomme,
        },
        {
            **acteur(PLATEFORME_SEULE),
            "action": "deploy_granted",
            "detail": {"environment": "PROD", "principal": ACCORD["principal"]},
            "principal_person": None,
        },
        {
            **acteur(ADMIN_GROUPE),
            "action": "deploy_granted",
            "detail": {"environment": "TEST", "principal": cyril},
            "principal_person": cyril_nomme,
        },
    ]
    # Le journal de B n'a rien reçu.
    assert {e["action"] for e in evenements(monde, B)} == {"space_created", "binding_added"}


def test_journal_reserve_aux_gestionnaires(monde: Monde) -> None:
    """Un créateur qui a le droit de déployer ne lit pas pour autant le journal."""
    accorder(monde, A, DEV, GroupPrincipal("finance-createurs"))
    reponse = monde.requete(CREATEUR_GROUPE, "GET", f"/api/spaces/{A}/events")
    assert (reponse.status_code, reponse.json()) == (403, interdit("admin"))
