"""Écritures des espaces : corps validés, refus à codes fermés, contrôle d'origine (plan 08,
E1, E3, E8, E10, E12 ; plan 06, I8).

Chaque corps refusé donne `400 invalid_request` avec le champ exact, et rien n'est écrit en
base. Aucun refus ne renvoie la valeur reçue ni une trace.
"""

from __future__ import annotations

import itertools
import json
from typing import Any

import pytest
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from identity.conftest import SECRET
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from skifer_board.identity.model import Identity
from skifer_board.spaces import GroupPrincipal, PersonRef, Role, SpaceStore
from sqlalchemy.exc import DBAPIError
from state.conftest import migre as migre

from spaces.monde import (
    ADMIN_B,
    ADMIN_GROUPE,
    ADMIN_PERSONNE,
    EMETTEUR,
    INVITEE,
    LECTEUR_GROUPE,
    NON_MEMBRE,
    ORIGINE,
    PLATEFORME_SEULE,
    A,
    B,
    Monde,
    Profil,
    instantane,
)
from spaces.monde import config_plateforme as config_plateforme
from spaces.monde import monde as monde

SENTINELLE = "VALEUR-SENSIBLE-7f3a"
CREATION = {
    "id": "nouveau",
    "name": "Nouveau",
    "first_admin": {"kind": "group", "name": "nouveau-admins"},
}
LIAISON = {"principal": {"kind": "group", "name": "finance-invites"}, "role": "reader"}


def invalide(champ: str) -> dict[str, Any]:
    return {"error": {"code": "invalid_request", "field": champ}}


def sans(corps: dict[str, Any], cle: str) -> dict[str, Any]:
    return {k: v for k, v in corps.items() if k != cle}


# Corps illisibles ou qui ne sont pas un objet : le champ en cause est le corps entier.
CORPS_ILLISIBLES: list[bytes] = [
    b"",
    b" ",
    b"{",
    b'{"id": "nouveau"',
    b"{'id': 'nouveau'}",
    b"\xff\xfe",
    b'{"name": "\xe9"}',
    b"[]",
    b'"texte"',
    b"1",
    b"null",
    b"true",
    b'[{"id": "nouveau"}]',
    f'"{SENTINELLE}"'.encode(),
]

# Principal invalide, sous `first_admin` ou `principal` : (valeur, champ relatif). Un champ
# relatif vide désigne l'objet lui-même : une clé inconnue n'est jamais renvoyée, le refus
# nomme l'objet qui la contient.
PRINCIPAUX_INVALIDES: list[tuple[object, str]] = [
    (None, "kind"),
    ("groupe", "kind"),
    (SENTINELLE, "kind"),
    ([], "kind"),
    ({}, "kind"),
    ({"name": "x"}, "kind"),
    ({"kind": "robot", "name": "x"}, "kind"),
    ({"kind": "GROUP", "name": "x"}, "kind"),
    ({"kind": "Person", "issuer": "i", "subject": "s"}, "kind"),
    ({"kind": 1, "name": "x"}, "kind"),
    ({"kind": None, "name": "x"}, "kind"),
    ({"kind": ["group"], "name": "x"}, "kind"),
    ({"kind": "group"}, "name"),
    ({"kind": "group", "name": ""}, "name"),
    ({"kind": "group", "name": 1}, "name"),
    ({"kind": "group", "name": None}, "name"),
    ({"kind": "group", "name": ["x"]}, "name"),
    ({"kind": "group", "name": "g" * 257}, "name"),
    ({"kind": "group", "name": SENTINELLE * 40}, "name"),
    ({"kind": "group", "name": "a\x00b"}, "name"),
    ({"kind": "group", "name": "\x00"}, "name"),
    ({"kind": "group", "name": "a\ud800"}, "name"),
    ({"kind": "group", "name": "\udfff"}, "name"),
    ({"kind": "group", "name": "\ude00\ud83d"}, "name"),
    ({"kind": "group", "name": "x", "issuer": "i"}, ""),
    ({"kind": "group", "name": "x", "role": "admin"}, ""),
    ({"kind": "group", "name": "x", SENTINELLE: "i"}, ""),
    ({"kind": "group", "name": "x", "": "i"}, ""),
    ({"kind": "person", "subject": "s"}, "issuer"),
    ({"kind": "person", "issuer": "i"}, "subject"),
    ({"kind": "person", "issuer": "", "subject": "s"}, "issuer"),
    ({"kind": "person", "issuer": "i", "subject": ""}, "subject"),
    ({"kind": "person", "issuer": 1, "subject": "s"}, "issuer"),
    ({"kind": "person", "issuer": "i", "subject": None}, "subject"),
    ({"kind": "person", "issuer": "i" * 2049, "subject": "s"}, "issuer"),
    ({"kind": "person", "issuer": "i", "subject": "s" * 2049}, "subject"),
    ({"kind": "person", "issuer": "i\x00", "subject": "s"}, "issuer"),
    ({"kind": "person", "issuer": "i", "subject": "s\x00"}, "subject"),
    ({"kind": "person", "issuer": "\udc00", "subject": "s"}, "issuer"),
    ({"kind": "person", "issuer": "i", "subject": "s\ud800"}, "subject"),
    ({"kind": "person", "issuer": "i", "subject": "s", "name": "x"}, ""),
    ({"kind": "person", "issuer": "i", "subject": "s", "email": "x@y"}, ""),
    ({"kind": "person", "issuer": "i", "subject": "s", SENTINELLE: "x"}, ""),
]


def sous(objet: str, champ: str) -> str:
    """Chemin du champ en cause : l'objet lui-même quand le champ relatif est vide."""
    return f"{objet}.{champ}" if champ else objet


IDENTIFIANTS_INVALIDES: list[object] = [
    None,
    1,
    True,
    [],
    {},
    "",
    "n",
    "A",
    "Nouveau",
    "NOUVEAU",
    "-nouveau",
    "nouveau-",
    "nou_veau",
    "nou veau",
    " nouveau",
    "nouveau ",
    "nouveau\n",
    "nouveau.fr",
    "..",
    "nouveau/x",
    "%6Eouveau",
    "élan",
    "a" * 41,
    "nou\x00veau",
    "nouveau\x00",
    "nouveau\ud800",
    SENTINELLE,
]

NOMS_INVALIDES: list[object] = [
    None,
    1,
    [],
    {},
    "",
    " ",
    "   ",
    " Nouveau",
    "Nouveau ",
    "\tNouveau",
    "Nouveau\n",
    " Nouveau",
    "N" * 81,
    f" {SENTINELLE}",
    "\x00",
    "Nou\x00veau",
    "Nouveau\x00",
    "Nou\ud800veau",
    "\udfff\udbff",
]

ROLES_INVALIDES: list[object] = [
    None,
    1,
    True,
    [],
    ["admin"],
    {"role": "admin"},
    "",
    "owner",
    "ADMIN",
    "Admin",
    " admin",
    "admin ",
    "platform_admin",
    "lecteur",
    "admin\x00",
    "admin\ud800",
    SENTINELLE,
]


def cas_creation() -> list[tuple[str, bytes | dict[str, Any], str]]:
    cas: list[tuple[str, bytes | dict[str, Any], str]] = [
        (f"illisible-{i}", contenu, "body") for i, contenu in enumerate(CORPS_ILLISIBLES)
    ]
    cas += [
        ("vide", {}, "first_admin"),
        ("sans-id", sans(CREATION, "id"), "id"),
        ("sans-nom", sans(CREATION, "name"), "name"),
        ("sans-admin", sans(CREATION, "first_admin"), "first_admin"),
        ("en-trop-role", {**CREATION, "role": "admin"}, "body"),
        ("en-trop-atlas", {**CREATION, "atlas": "/etc"}, "body"),
        (
            "en-trop-auteur",
            {**CREATION, "created_by": {"issuer": "i", "subject": "s"}},
            "body",
        ),
        ("en-trop-implicite", {**CREATION, "implicit": True}, "body"),
        ("en-trop-sentinelle", {**CREATION, SENTINELLE: 1}, "body"),
        ("en-trop-vide-de-sens", {"x": 1}, "body"),
    ]
    cas += [(f"id-{i}", {**CREATION, "id": v}, "id") for i, v in enumerate(IDENTIFIANTS_INVALIDES)]
    cas += [(f"nom-{i}", {**CREATION, "name": v}, "name") for i, v in enumerate(NOMS_INVALIDES)]
    cas += [
        (f"admin-{i}", {**CREATION, "first_admin": v}, sous("first_admin", champ))
        for i, (v, champ) in enumerate(PRINCIPAUX_INVALIDES)
    ]
    return cas


def cas_liaison() -> list[tuple[str, bytes | dict[str, Any], str]]:
    cas: list[tuple[str, bytes | dict[str, Any], str]] = [
        (f"illisible-{i}", contenu, "body") for i, contenu in enumerate(CORPS_ILLISIBLES)
    ]
    cas += [
        ("vide", {}, "principal"),
        ("sans-principal", sans(LIAISON, "principal"), "principal"),
        ("sans-role", sans(LIAISON, "role"), "role"),
        ("en-trop-espace", {**LIAISON, "space_id": "rh"}, "body"),
        ("en-trop-id", {**LIAISON, "id": "liaison"}, "body"),
        (
            "en-trop-auteur",
            {**LIAISON, "created_by": {"issuer": "i", "subject": "s"}},
            "body",
        ),
        ("en-trop-sentinelle", {**LIAISON, SENTINELLE: 1}, "body"),
    ]
    cas += [(f"role-{i}", {**LIAISON, "role": v}, "role") for i, v in enumerate(ROLES_INVALIDES)]
    cas += [
        (f"principal-{i}", {**LIAISON, "principal": v}, sous("principal", champ))
        for i, (v, champ) in enumerate(PRINCIPAUX_INVALIDES)
    ]
    return cas


def envoyer(
    monde: Monde, profil: Profil, methode: str, chemin: str, envoi: bytes | dict[str, Any]
) -> Any:
    # Un objet est sérialisé en JSON ASCII : un demi-code isolé y passe en échappement
    # `\\ud800`, comme un client peut l'envoyer.
    contenu = envoi if isinstance(envoi, bytes) else json.dumps(envoi).encode()
    return monde.requete(profil, methode, chemin, contenu=contenu)


def sans_trace(texte: str) -> None:
    """Ni valeur reçue, ni secret, ni trace, ni chemin dans un refus."""
    for interdit in (SENTINELLE, SECRET, "Traceback", 'File "', "sqlalchemy", "pg8000", "/api"):
        assert interdit not in texte


@pytest.mark.parametrize(
    "profil,chemin,cas",
    [
        (PLATEFORME_SEULE, "/api/spaces", cas_creation()),
        (ADMIN_GROUPE, f"/api/spaces/{A}/members", cas_liaison()),
        (PLATEFORME_SEULE, f"/api/spaces/{A}/members", cas_liaison()),
    ],
    ids=["creation", "liaison-admin", "liaison-plateforme"],
)
def test_corps_invalides(
    monde: Monde,
    profil: Profil,
    chemin: str,
    cas: list[tuple[str, bytes | dict[str, Any], str]],
) -> None:
    avant = instantane(monde.moteur)
    ecarts = []
    for nom, envoi, champ in cas:
        reponse = envoyer(monde, profil, "POST", chemin, envoi)
        if (reponse.status_code, reponse.json()) != (400, invalide(champ)):
            ecarts.append(f"{nom} : {reponse.status_code} {reponse.text}")
        sans_trace(reponse.text)
    assert ecarts == []
    assert instantane(monde.moteur) == avant


def test_corps_json_mal_type_par_l_en_tete(monde: Monde) -> None:
    """Le corps est lu comme JSON quel que soit le type annoncé ; un formulaire est illisible."""
    entetes = {
        "Cookie": f"__Host-sb_session={monde.session(PLATEFORME_SEULE)}",
        "Origin": ORIGINE,
    }
    reponse = monde.client.post(
        "/api/spaces",
        content=b"id=nouveau&name=Nouveau",
        headers={**entetes, "Content-Type": "application/x-www-form-urlencoded"},
    )
    assert (reponse.status_code, reponse.json()) == (400, invalide("body"))
    reponse = monde.client.post(
        "/api/spaces",
        content=json.dumps(CREATION).encode(),
        headers={**entetes, "Content-Type": "text/plain"},
    )
    assert reponse.status_code == 201


@pytest.mark.parametrize(
    "corps",
    [
        {**CREATION, "id": "ab"},
        {**CREATION, "id": "a" * 40},
        {**CREATION, "id": "0-9"},
        {**CREATION, "name": "N" * 80},
        {**CREATION, "name": "N"},
        {**CREATION, "name": "Ressources humaines — été"},
        {**CREATION, "first_admin": {"kind": "group", "name": "g" * 256}},
        {**CREATION, "first_admin": {"kind": "group", "name": " Groupe Exact "}},
        {
            **CREATION,
            "first_admin": {"kind": "person", "issuer": "i" * 2048, "subject": "s" * 2048},
        },
    ],
    ids=[
        "id-2",
        "id-40",
        "id-chiffres",
        "nom-80",
        "nom-1",
        "nom-unicode",
        "groupe-256",
        "groupe-exact",
        "personne-2048",
    ],
)
def test_creation_aux_limites_acceptee(monde: Monde, corps: dict[str, Any]) -> None:
    monde.magasin.record_login(Identity("i" * 2048, "s" * 2048, None, None, ()), monde.horloge())
    reponse = monde.requete(PLATEFORME_SEULE, "POST", "/api/spaces", corps=corps)
    assert reponse.status_code == 201
    assert reponse.json()["id"] == corps["id"]
    assert reponse.json()["name"] == corps["name"]
    assert reponse.json()["role"] is None
    [liaison] = monde.magasin.bindings(corps["id"])
    premier = corps["first_admin"]
    attendu = (
        GroupPrincipal(premier["name"])
        if premier["kind"] == "group"
        else PersonRef(premier["issuer"], premier["subject"])
    )
    # Valeur exacte, ni repliée ni rognée (E3).
    assert liaison.principal == attendu
    assert liaison.role is Role.ADMIN
    assert liaison.created_by == PLATEFORME_SEULE.ref
    journal = [(e.action, e.actor) for e in monde.magasin.events(corps["id"])]
    assert journal == [
        ("binding_added", PLATEFORME_SEULE.ref),
        ("space_created", PLATEFORME_SEULE.ref),
    ]


def test_creation_puis_espace_existant(monde: Monde) -> None:
    assert monde.requete(PLATEFORME_SEULE, "POST", "/api/spaces", corps=CREATION).status_code == 201
    avant = instantane(monde.moteur)
    for corps in (
        CREATION,
        {**CREATION, "name": "Autre nom", "first_admin": {"kind": "group", "name": "autre"}},
        {**CREATION, "id": A},
    ):
        reponse = monde.requete(PLATEFORME_SEULE, "POST", "/api/spaces", corps=corps)
        assert (reponse.status_code, reponse.json()) == (409, {"error": {"code": "space_exists"}})
    assert instantane(monde.moteur) == avant


def test_premier_administrateur_inconnu(monde: Monde) -> None:
    avant = instantane(monde.moteur)
    for premier in (
        {"kind": "person", "issuer": EMETTEUR, "subject": SENTINELLE},
        # Sujet connu, chez un autre émetteur : une autre personne, inconnue (E3, E5).
        {"kind": "person", "issuer": "https://autre.example.invalid", "subject": "ines"},
    ):
        corps = {**CREATION, "first_admin": premier}
        reponse = monde.requete(PLATEFORME_SEULE, "POST", "/api/spaces", corps=corps)
        assert reponse.status_code == 422
        assert reponse.json() == {"error": {"code": "unknown_person"}}
    # Rien de créé : ni l'espace, ni sa liaison, ni le journal.
    assert instantane(monde.moteur) == avant
    reponse = monde.requete(PLATEFORME_SEULE, "GET", "/api/spaces/nouveau")
    assert reponse.status_code == 404


def test_liaison_de_personne_inconnue(monde: Monde) -> None:
    avant = instantane(monde.moteur)
    principal = {"kind": "person", "issuer": EMETTEUR, "subject": SENTINELLE}
    reponse = monde.requete(
        ADMIN_GROUPE,
        "POST",
        f"/api/spaces/{A}/members",
        corps={"principal": principal, "role": "reader"},
    )
    assert (reponse.status_code, reponse.json()) == (422, {"error": {"code": "unknown_person"}})
    assert instantane(monde.moteur) == avant


def test_liaison_de_personne_connue(monde: Monde) -> None:
    principal = {"kind": "person", "issuer": EMETTEUR, "subject": INVITEE.sujet}
    reponse = monde.requete(
        ADMIN_GROUPE,
        "POST",
        f"/api/spaces/{A}/members",
        corps={"principal": principal, "role": "creator"},
    )
    assert reponse.status_code == 200
    corps = reponse.json()
    assert set(corps) == {
        "id",
        "principal",
        "person",
        "role",
        "created_at",
        "created_by",
        "created_by_person",
    }
    assert corps["principal"] == principal
    assert corps["person"] == {"name": "Nom ines", "email": "ines@example.invalid"}
    assert corps["role"] == "creator"
    assert corps["created_at"] == monde.horloge().isoformat()
    assert corps["created_by"] == {"issuer": EMETTEUR, "subject": ADMIN_GROUPE.sujet}
    # L'auteur est une personne connue : son nom et son adresse accompagnent sa référence (8.4).
    assert corps["created_by_person"] == {"name": "Nom ada", "email": "ada@example.invalid"}
    # Les groupes de la personne ne sont ni gardés ni exposés (E5).
    assert "groupe-secret" not in reponse.text
    assert monde.requete(INVITEE, "GET", f"/api/spaces/{A}").json()["role"] == "creator"


def test_liaison_inchangee_acceptee_sans_journal(monde: Monde) -> None:
    avant = instantane(monde.moteur)
    for principal, role, liaison in (
        ({"kind": "group", "name": "finance-lecteurs"}, "reader", "a-lecteurs"),
        ({"kind": "group", "name": "finance-admins"}, "admin", "a-admins"),
        ({"kind": "person", "issuer": EMETTEUR, "subject": "axel"}, "admin", "a-axel"),
    ):
        reponse = monde.requete(
            ADMIN_GROUPE,
            "POST",
            f"/api/spaces/{A}/members",
            corps={"principal": principal, "role": role},
        )
        assert reponse.status_code == 200
        assert reponse.json()["id"] == monde.liaisons[liaison]
        assert reponse.json()["role"] == role
        # L'auteur reste celui de la liaison d'origine.
        assert reponse.json()["created_by"] == {"issuer": EMETTEUR, "subject": "pia"}
    assert instantane(monde.moteur) == avant


def test_changement_de_role_journalise(monde: Monde) -> None:
    principal = {"kind": "group", "name": "finance-lecteurs"}
    reponse = monde.requete(
        ADMIN_PERSONNE,
        "POST",
        f"/api/spaces/{A}/members",
        corps={"principal": principal, "role": "creator"},
    )
    assert reponse.status_code == 200
    assert reponse.json()["id"] == monde.liaisons["a-lecteurs"]
    journal = monde.requete(ADMIN_GROUPE, "GET", f"/api/spaces/{A}/events").json()["events"]
    assert journal[0] == {
        "id": journal[0]["id"],
        "at": monde.horloge().isoformat(),
        "actor": {"issuer": EMETTEUR, "subject": "axel"},
        "actor_person": {"name": "Nom axel", "email": "axel@example.invalid"},
        "action": "binding_changed",
        "detail": {"principal": principal, "before": "reader", "after": "creator"},
        # Un groupe n'est pas une personne : rien à nommer.
        "principal_person": None,
    }
    retrait = monde.requete(
        PLATEFORME_SEULE, "DELETE", f"/api/spaces/{A}/members/{monde.liaisons['a-lecteurs']}"
    )
    assert retrait.status_code == 204
    journal = monde.requete(ADMIN_GROUPE, "GET", f"/api/spaces/{A}/events").json()["events"]
    assert journal[0]["action"] == "binding_removed"
    assert journal[0]["actor"] == {"issuer": EMETTEUR, "subject": "pia"}
    assert journal[0]["actor_person"] == {"name": "Nom pia", "email": "pia@example.invalid"}
    assert journal[0]["detail"] == {"principal": principal, "before": "creator"}
    assert journal[0]["principal_person"] is None


def test_dernier_administrateur_par_retrait_et_par_abaissement(monde: Monde) -> None:
    # Deux liaisons administrateur : le groupe et Axel. Retirer Axel est permis.
    retrait = monde.requete(
        ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/members/{monde.liaisons['a-axel']}"
    )
    assert retrait.status_code == 204
    avant = instantane(monde.moteur)
    dernier = {"error": {"code": "last_admin"}}
    for profil in (ADMIN_GROUPE, PLATEFORME_SEULE):
        reponse = monde.requete(
            profil, "DELETE", f"/api/spaces/{A}/members/{monde.liaisons['a-admins']}"
        )
        assert (reponse.status_code, reponse.json()) == (409, dernier)
        for role in ("creator", "reader"):
            reponse = monde.requete(
                profil,
                "POST",
                f"/api/spaces/{A}/members",
                corps={"principal": {"kind": "group", "name": "finance-admins"}, "role": role},
            )
            assert (reponse.status_code, reponse.json()) == (409, dernier)
    assert instantane(monde.moteur) == avant
    # La plateforme peut toujours en ajouter un ; le retrait devient alors possible (E8).
    ajout = monde.requete(
        PLATEFORME_SEULE,
        "POST",
        f"/api/spaces/{A}/members",
        corps={"principal": {"kind": "group", "name": "secours"}, "role": "admin"},
    )
    assert ajout.status_code == 200
    retrait = monde.requete(
        PLATEFORME_SEULE, "DELETE", f"/api/spaces/{A}/members/{monde.liaisons['a-admins']}"
    )
    assert retrait.status_code == 204


INTROUVABLE = {"error": {"code": "binding_not_found"}}
UUID_INCONNU = "5b0e4c1e-0000-4000-8000-000000000000"
# Identifiants hors du format des liaisons (UUID en minuscules) : aucune liaison, sans
# atteindre la base.
HORS_FORMAT = [
    "inconnue",
    "a" * 36,
    "x" * 300,
    "%2E%2E",
    "a%00b",
    UUID_INCONNU.upper(),
    "5B0E4C1E-0000-4000-8000-000000000000",
    "{" + UUID_INCONNU + "}",
    UUID_INCONNU.replace("-", ""),
    UUID_INCONNU + "0",
    UUID_INCONNU[1:],
    UUID_INCONNU + "%0A",
    "%20" + UUID_INCONNU,
    UUID_INCONNU.replace("5b0e", "5g0e"),
    SENTINELLE,
]


def test_liaison_introuvable_hors_format(monde: Monde, monkeypatch: pytest.MonkeyPatch) -> None:
    """Hors format : 404 sans identifiant renvoyé, et la suppression n'atteint pas la base."""
    appels: list[str] = []

    def espion(_magasin: SpaceStore, espace: str, liaison: str, *_args: object) -> None:
        appels.append(liaison)

    avant = instantane(monde.moteur)
    monkeypatch.setattr(SpaceStore, "remove_binding", espion)
    for identifiant in HORS_FORMAT:
        for profil in (ADMIN_GROUPE, PLATEFORME_SEULE):
            chemin = f"/api/spaces/{A}/members/{identifiant}"
            reponse = monde.requete(profil, "DELETE", chemin)
            assert (reponse.status_code, reponse.json()) == (404, INTROUVABLE), identifiant
            sans_trace(reponse.text)
    assert appels == []
    # Le format valide, lui, va jusqu'au magasin.
    monde.requete(ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/members/{UUID_INCONNU}")
    assert appels == [UUID_INCONNU]
    monkeypatch.undo()
    assert instantane(monde.moteur) == avant


def test_liaison_hors_format_apres_le_controle_du_role(monde: Monde) -> None:
    """Le contrôle du rôle passe avant celui du format : un identifiant hors format ne
    renseigne pas un non-gestionnaire."""
    for identifiant in ("inconnue", UUID_INCONNU, monde.liaisons["a-stagiaires"]):
        chemin = f"/api/spaces/{A}/members/{identifiant}"
        refus = monde.requete(LECTEUR_GROUPE, "DELETE", chemin)
        assert (refus.status_code, refus.json()) == (
            403,
            {"error": {"code": "forbidden", "required": "admin"}},
        )
        cache = monde.requete(NON_MEMBRE, "DELETE", chemin)
        assert (cache.status_code, cache.json()) == (404, {"error": {"code": "space_not_found"}})
        anonyme = monde.requete(None, "DELETE", chemin)
        assert anonyme.status_code == 401


def test_liaison_introuvable_au_bon_format(monde: Monde) -> None:
    """Format valide mais inconnue, ou identifiant d'une liaison en majuscules : même 404."""
    avant = instantane(monde.moteur)
    for identifiant in (UUID_INCONNU, "00000000-0000-0000-0000-000000000000"):
        reponse = monde.requete(ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/members/{identifiant}")
        assert (reponse.status_code, reponse.json()) == (404, INTROUVABLE)
    existante = monde.liaisons["a-stagiaires"]
    reponse = monde.requete(ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/members/{existante.upper()}")
    assert (reponse.status_code, reponse.json()) == (404, INTROUVABLE)
    assert instantane(monde.moteur) == avant
    # L'identifiant exact, lui, désigne bien la liaison.
    reponse = monde.requete(ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/members/{existante}")
    assert reponse.status_code == 204


# --- Contrôle d'origine des écritures (plan 06, I8). -----------------------------------------

ORIGINES_REFUSEES = [
    None,
    "null",
    "",
    "https://autre.example.invalid",
    "http://board.example.invalid",
    "https://board.example.invalid/",
    "https://board.example.invalid:8443",
    "https://board.example.invalid.autre.example",
    "https://BOARD.example.invalid",
    "http://127.0.0.1:5173",
    "http://localhost",
]


def test_ecritures_hors_origine_refusees_sans_ecriture(monde: Monde) -> None:
    avant = instantane(monde.moteur)
    ecritures = (
        (PLATEFORME_SEULE, "POST", "/api/spaces", CREATION),
        (PLATEFORME_SEULE, "POST", f"/api/spaces/{A}/members", LIAISON),
        (ADMIN_GROUPE, "POST", f"/api/spaces/{A}/members", LIAISON),
        (ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/members/{monde.liaisons['a-stagiaires']}", None),
        (ADMIN_GROUPE, "POST", "/api/spaces/inconnu/members", {"invalide": True}),
        (None, "POST", "/api/spaces", CREATION),
    )
    for origine, (profil, methode, chemin, corps) in itertools.product(
        ORIGINES_REFUSEES, ecritures
    ):
        reponse = monde.requete(profil, methode, chemin, corps=corps, origine=origine)
        assert reponse.status_code == 403, (origine, chemin)
        assert reponse.json() == {"error": {"code": "origin_refused"}}
    assert instantane(monde.moteur) == avant


def test_lectures_sans_origine_permises(monde: Monde) -> None:
    for chemin in (f"/api/spaces/{A}/members", f"/api/spaces/{A}/events", "/api/people?q=Nom"):
        assert monde.requete(ADMIN_GROUPE, "GET", chemin, origine=None).status_code == 200


# --- Entrées hors du domaine de la base : jamais d'écriture ni de trace. ---------------------

ENTREES_HORS_DOMAINE: list[tuple[str, str, str, bytes]] = [
    (
        "nul-groupe",
        "POST",
        f"/api/spaces/{A}/members",
        b'{"principal": {"kind": "group", "name": "a\\u0000b"}, "role": "reader"}',
    ),
    (
        "nul-emetteur",
        "POST",
        f"/api/spaces/{A}/members",
        b'{"principal": {"kind": "person", "issuer": "i\\u0000", "subject": "s"}, '
        b'"role": "reader"}',
    ),
    (
        "nul-nom-espace",
        "POST",
        "/api/spaces",
        b'{"id": "nouveau", "name": "N\\u0000", "first_admin": {"kind": "group", "name": "g"}}',
    ),
    (
        "surrogate-groupe",
        "POST",
        f"/api/spaces/{A}/members",
        b'{"principal": {"kind": "group", "name": "a\\ud800"}, "role": "reader"}',
    ),
    ("imbrication-profonde", "POST", f"/api/spaces/{A}/members", b"[" * 50000 + b"]" * 50000),
    ("nul-liaison", "DELETE", f"/api/spaces/{A}/members/a%00b", b""),
    ("nul-recherche", "GET", "/api/people?q=a%00b", b""),
]
CHAMPS_ATTENDUS = {
    "nul-groupe": (400, invalide("principal.name")),
    "nul-emetteur": (400, invalide("principal.issuer")),
    "nul-nom-espace": (400, invalide("name")),
    "surrogate-groupe": (400, invalide("principal.name")),
    "imbrication-profonde": (400, invalide("body")),
    "nul-liaison": (404, INTROUVABLE),
    "nul-recherche": (400, {"error": {"code": "invalid_parameter", "parameter": "q"}}),
}


def profil_de(chemin: str) -> Profil:
    return PLATEFORME_SEULE if chemin == "/api/spaces" else ADMIN_GROUPE


@pytest.mark.parametrize(
    "nom,methode,chemin,contenu", ENTREES_HORS_DOMAINE, ids=[e[0] for e in ENTREES_HORS_DOMAINE]
)
def test_entree_hors_domaine_sans_ecriture_ni_trace(
    monde: Monde, nom: str, methode: str, chemin: str, contenu: bytes
) -> None:
    avant = instantane(monde.moteur)
    reponse = monde.requete(profil_de(chemin), methode, chemin, contenu=contenu or None)
    assert reponse.status_code in (400, 404, 500)
    assert reponse.json()["error"]["code"] in {
        "invalid_request",
        "invalid_parameter",
        "binding_not_found",
        "internal_error",
    }
    sans_trace(reponse.text)
    assert instantane(monde.moteur) == avant


@pytest.mark.parametrize(
    "nom,methode,chemin,contenu", ENTREES_HORS_DOMAINE, ids=[e[0] for e in ENTREES_HORS_DOMAINE]
)
def test_entree_hors_domaine_sans_effet_sur_les_requetes_suivantes(
    monde: Monde, nom: str, methode: str, chemin: str, contenu: bytes
) -> None:
    monde.requete(profil_de(chemin), methode, chemin, contenu=contenu or None)
    requetes_suivantes_intactes(monde)


def requetes_suivantes_intactes(monde: Monde) -> None:
    """Plusieurs tours de requêtes de profils et d'espaces différents : un pool empoisonné
    les ferait échouer (la même connexion resservie)."""
    for _ in range(4):
        membres = monde.requete(ADMIN_B, "GET", f"/api/spaces/{B}/members")
        assert membres.status_code == 200
        assert {m["id"] for m in membres.json()["members"]} == monde.liaison_ids(B)
        vu = monde.requete(LECTEUR_GROUPE, "GET", f"/api/spaces/{A}")
        assert (vu.status_code, vu.json()["role"]) == (200, "reader")
        refus = monde.requete(NON_MEMBRE, "GET", f"/api/spaces/{A}/members")
        assert (refus.status_code, refus.json()) == (404, {"error": {"code": "space_not_found"}})


@pytest.mark.parametrize(
    "nom,methode,chemin,contenu", ENTREES_HORS_DOMAINE, ids=[e[0] for e in ENTREES_HORS_DOMAINE]
)
def test_entree_hors_domaine_refusee_par_la_validation(
    monde: Monde, nom: str, methode: str, chemin: str, contenu: bytes
) -> None:
    reponse = monde.requete(profil_de(chemin), methode, chemin, contenu=contenu or None)
    assert (reponse.status_code, reponse.json()) == CHAMPS_ATTENDUS[nom]


@pytest.mark.parametrize(
    "groupe",
    ["a\ud800", "\udfff", "a\x00b"],
    ids=["demi-code-haut", "demi-code-bas", "nul"],
)
def test_magasin_direct_hors_domaine_sans_empoisonner_le_pool(monde: Monde, groupe: str) -> None:
    """Une valeur qui contournerait la validation et atteindrait le magasin échoue, sans rien
    écrire, et ne laisse pas une connexion désynchronisée dans le pool (défense en
    profondeur de `connect`)."""
    avant = instantane(monde.moteur)
    magasin = SpaceStore(monde.moteur)
    # Demi-code : le pilote ne sait pas l'encoder ; U+0000 : la base le refuse.
    with pytest.raises((UnicodeEncodeError, DBAPIError)):
        magasin.set_binding(
            A, GroupPrincipal(groupe), Role.READER, ADMIN_GROUPE.ref, monde.horloge()
        )
    assert instantane(monde.moteur) == avant
    requetes_suivantes_intactes(monde)
    # Le magasin lui-même reste utilisable.
    pose = magasin.set_binding(
        A, GroupPrincipal("finance-invites"), Role.READER, ADMIN_GROUPE.ref, monde.horloge()
    )
    assert pose.principal == GroupPrincipal("finance-invites")


# --- Taille maximale du corps (64 Kio) et clés en double. ------------------------------------

TAILLE_MAX = 64 * 1024


def rembourre(corps: dict[str, Any], taille: int) -> bytes:
    """Corps JSON valide d'exactement `taille` octets, complété par des blancs."""
    brut = json.dumps(corps, ensure_ascii=False).encode()
    assert len(brut) <= taille
    return brut + b" " * (taille - len(brut))


@pytest.mark.parametrize(
    "profil,chemin,corps,succes",
    [
        (PLATEFORME_SEULE, "/api/spaces", CREATION, 201),
        (PLATEFORME_SEULE, "/api/spaces", {**CREATION, "name": "é" * 80}, 201),
        (ADMIN_GROUPE, f"/api/spaces/{A}/members", LIAISON, 200),
        (PLATEFORME_SEULE, f"/api/spaces/{A}/members", LIAISON, 200),
    ],
    ids=["creation", "creation-multioctet", "liaison-admin", "liaison-plateforme"],
)
def test_corps_a_la_taille_maximale(
    monde: Monde, profil: Profil, chemin: str, corps: dict[str, Any], succes: int
) -> None:
    """64 Kio exactement : accepté ; un octet de plus : refusé sans écriture. La taille se
    compte en octets, pas en caractères."""
    avant = instantane(monde.moteur)
    for taille in (TAILLE_MAX + 1, TAILLE_MAX + 2, 10 * TAILLE_MAX):
        reponse = monde.requete(profil, "POST", chemin, contenu=rembourre(corps, taille))
        assert (reponse.status_code, reponse.json()) == (400, invalide("body")), taille
    # Corps illisible et trop grand : toujours le corps en cause.
    reponse = monde.requete(profil, "POST", chemin, contenu=b"{" * (TAILLE_MAX + 1))
    assert (reponse.status_code, reponse.json()) == (400, invalide("body"))
    assert instantane(monde.moteur) == avant
    contenu = rembourre(corps, TAILLE_MAX)
    assert len(contenu) == TAILLE_MAX
    reponse = monde.requete(profil, "POST", chemin, contenu=contenu)
    assert reponse.status_code == succes, reponse.text


def test_taille_comptee_en_octets(monde: Monde) -> None:
    """Moins de 64 Ki caractères, mais plus de 64 Kio : refusé."""
    corps = {**CREATION, "name": "é" * 80}
    brut = json.dumps(corps, ensure_ascii=False).encode()
    contenu = brut + b" " * (TAILLE_MAX + 1 - len(brut))
    assert len(contenu) == TAILLE_MAX + 1
    assert len(contenu.decode()) < TAILLE_MAX
    reponse = monde.requete(PLATEFORME_SEULE, "POST", "/api/spaces", contenu=contenu)
    assert (reponse.status_code, reponse.json()) == (400, invalide("body"))


CLES_EN_DOUBLE_CREATION: list[tuple[str, bytes]] = [
    (
        "racine-identique",
        b'{"id": "nouveau", "id": "nouveau", "name": "Nouveau", '
        b'"first_admin": {"kind": "group", "name": "g"}}',
    ),
    (
        "racine-differente",
        b'{"id": "nouveau", "name": "Nouveau", "id": "autre", '
        b'"first_admin": {"kind": "group", "name": "g"}}',
    ),
    (
        "racine-echappee",
        b'{"id": "nouveau", "\\u0069d": "nouveau", "name": "Nouveau", '
        b'"first_admin": {"kind": "group", "name": "g"}}',
    ),
    (
        "racine-objet",
        b'{"id": "nouveau", "name": "Nouveau", "first_admin": {"kind": "group", "name": "g"}, '
        b'"first_admin": {"kind": "group", "name": "g"}}',
    ),
    (
        "premier-admin-genre",
        b'{"id": "nouveau", "name": "Nouveau", '
        b'"first_admin": {"kind": "group", "kind": "group", "name": "g"}}',
    ),
    (
        "premier-admin-nom",
        b'{"id": "nouveau", "name": "Nouveau", '
        b'"first_admin": {"kind": "group", "name": "g", "name": "h"}}',
    ),
    (
        "premier-admin-personne",
        b'{"id": "nouveau", "name": "Nouveau", "first_admin": {"kind": "person", '
        b'"issuer": "i", "subject": "s", "subject": "s"}}',
    ),
    (
        "cle-inconnue-imbriquee",
        b'{"id": "nouveau", "name": "Nouveau", "first_admin": {"kind": "group", "name": "g"}, '
        b'"x": [{"a": 1, "a": 1}]}',
    ),
]
CLES_EN_DOUBLE_LIAISON: list[tuple[str, bytes]] = [
    (
        "racine-role",
        b'{"principal": {"kind": "group", "name": "g"}, "role": "reader", "role": "admin"}',
    ),
    (
        "racine-principal",
        b'{"principal": {"kind": "group", "name": "g"}, "role": "reader", '
        b'"principal": {"kind": "group", "name": "h"}}',
    ),
    (
        "principal-nom",
        b'{"principal": {"kind": "group", "name": "g", "name": "g"}, "role": "reader"}',
    ),
    (
        "principal-genre",
        b'{"principal": {"kind": "person", "kind": "group", "name": "g"}, "role": "reader"}',
    ),
    (
        "principal-emetteur",
        b'{"principal": {"kind": "person", "issuer": "i", "issuer": "j", "subject": "s"}, '
        b'"role": "reader"}',
    ),
]


@pytest.mark.parametrize(
    "profil,chemin,cas",
    [
        (PLATEFORME_SEULE, "/api/spaces", CLES_EN_DOUBLE_CREATION),
        (ADMIN_GROUPE, f"/api/spaces/{A}/members", CLES_EN_DOUBLE_LIAISON),
        (PLATEFORME_SEULE, f"/api/spaces/{A}/members", CLES_EN_DOUBLE_LIAISON),
    ],
    ids=["creation", "liaison-admin", "liaison-plateforme"],
)
def test_cles_en_double_refusees(
    monde: Monde, profil: Profil, chemin: str, cas: list[tuple[str, bytes]]
) -> None:
    """Une clé en double, à tout niveau, même de valeur identique : le corps est refusé, sans
    choisir laquelle croire."""
    avant = instantane(monde.moteur)
    ecarts = []
    for nom, contenu in cas:
        reponse = monde.requete(profil, "POST", chemin, contenu=contenu)
        if (reponse.status_code, reponse.json()) != (400, invalide("body")):
            ecarts.append(f"{nom} : {reponse.status_code} {reponse.text}")
    assert ecarts == []
    assert instantane(monde.moteur) == avant


def test_cles_distinctes_de_meme_valeur_acceptees(monde: Monde) -> None:
    """Le refus porte sur les clés, pas sur les valeurs répétées ; un caractère hors BMP
    (paire de demi-codes valide) est un texte comme un autre."""
    contenu = (
        b'{"id": "nouveau", "name": "nouveau", '
        b'"first_admin": {"kind": "group", "name": "\\ud83d\\ude00 nouveau"}}'
    )
    reponse = monde.requete(PLATEFORME_SEULE, "POST", "/api/spaces", contenu=contenu)
    assert reponse.status_code == 201
    [liaison] = monde.magasin.bindings("nouveau")
    assert liaison.principal == GroupPrincipal("\U0001f600 nouveau")
