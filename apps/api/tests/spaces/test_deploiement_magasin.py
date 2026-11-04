"""Environnements et accords du droit de déployer dans le magasin des espaces (plan 09, V1, V3,
V5, V6 ; plan 07, P2, P8)."""

from __future__ import annotations

from typing import Any

import pytest
from identity.conftest import INSTANT
from skifer_board.identity.model import Identity
from skifer_board.spaces import (
    PersonRef,
    Principal,
    Role,
    SpaceExists,
    SpaceNotFound,
    SpaceStore,
    UnknownPerson,
)
from skifer_board.spaces.model import ENVIRONMENTS, DeployGrant, Environment, GrantNotFound
from skifer_board.state.schema import deploy_grants, space_environments, space_events
from sqlalchemy import Engine, select

from .conftest import (
    ACTEUR,
    ALICE,
    ALICE_AILLEURS,
    ATLAS,
    BOB,
    CHLOE,
    EMETTEUR,
    compter,
    groupe,
    plus,
    ref,
)
from .test_magasin import creer, principal_json, resume, utc

DEV, TEST, PROD = ENVIRONMENTS
AUTRE_ACTEUR = PersonRef(EMETTEUR, "admin-espace")


def lignes_environnements(moteur: Engine) -> list[tuple[str, str, int]]:
    with moteur.connect() as connexion:
        lignes = connexion.execute(
            select(space_environments).order_by(
                space_environments.c.space_id, space_environments.c.position
            )
        ).all()
    return [(ligne.space_id, ligne.code, ligne.position) for ligne in lignes]


def detail(environnement: Environment, principal: Principal) -> dict[str, Any]:
    return {"environment": environnement.value, "principal": principal_json(principal)}


@pytest.fixture
def deux_espaces(magasin: SpaceStore) -> SpaceStore:
    """A et B, chacun administré par son groupe ; Alice, Bob et Chloé sont connus."""
    for personne in (ALICE, BOB, CHLOE):
        magasin.record_login(personne, INSTANT)
    creer(magasin, "a", groupe("equipe-a"))
    creer(magasin, "b", groupe("equipe-b"))
    return magasin


# --- Environnements (V1) -------------------------------------------------------------------


def test_trois_environnements_crees_avec_l_espace(magasin: SpaceStore, migre: Engine) -> None:
    assert lignes_environnements(migre) == []
    creer(magasin, "ventes")
    assert magasin.environments(["ventes"]) == {"ventes": ENVIRONMENTS}
    assert lignes_environnements(migre) == [
        ("ventes", "DEV", 1),
        ("ventes", "TEST", 2),
        ("ventes", "PROD", 3),
    ]


def test_environnements_de_plusieurs_espaces(magasin: SpaceStore) -> None:
    for espace in ("c", "a", "b"):
        creer(magasin, espace)
    trouves = magasin.environments(["b", "c"])
    assert trouves == {"b": ENVIRONMENTS, "c": ENVIRONMENTS}
    assert magasin.environments([]) == {}
    # Un espace inconnu n'a aucun environnement.
    assert magasin.environments(["inconnu", "a"]) == {"inconnu": (), "a": ENVIRONMENTS}


def test_creation_refusee_ne_laisse_aucun_environnement(magasin: SpaceStore, migre: Engine) -> None:
    creer(magasin, "ventes")
    with pytest.raises(UnknownPerson):
        creer(magasin, "achats", ref(ALICE))
    with pytest.raises(SpaceExists):
        creer(magasin, "ventes")
    assert compter(migre, space_environments) == 3
    assert magasin.environments(["achats"]) == {"achats": ()}


# --- Accorder (V3, V5) ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "principal", [groupe("deployeurs"), ref(ALICE)], ids=["groupe", "personne"]
)
def test_accorder(deux_espaces: SpaceStore, principal: Principal) -> None:
    magasin = deux_espaces
    accorde = magasin.grant("a", PROD, principal, ACTEUR, plus(1))
    assert accorde == DeployGrant(accorde.id, "a", PROD, principal, plus(1), ACTEUR)
    assert magasin.grants("a") == [accorde]
    assert magasin.grants("b") == []
    [dernier, *_] = magasin.events("a")
    assert (dernier.action, dernier.detail, dernier.actor, dernier.at) == (
        "deploy_granted",
        detail(PROD, principal),
        ACTEUR,
        plus(1),
    )


@pytest.mark.parametrize(
    "principal", [groupe("deployeurs"), ref(ALICE)], ids=["groupe", "personne"]
)
def test_accord_idempotent_sans_second_evenement(
    deux_espaces: SpaceStore, migre: Engine, principal: Principal
) -> None:
    magasin = deux_espaces
    premier = magasin.grant("a", DEV, principal, ACTEUR, plus(1))
    evenements = compter(migre, space_events)
    second = magasin.grant("a", DEV, principal, AUTRE_ACTEUR, plus(2))
    # Rien n'est refait : l'accord rendu est le premier, avec son auteur et son instant.
    assert second == premier
    assert compter(migre, space_events) == evenements
    assert compter(migre, deploy_grants) == 1
    assert magasin.grants("a") == [premier]


def test_un_accord_par_environnement(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    accords = [
        magasin.grant("a", env, groupe("deployeurs"), ACTEUR, plus(i))
        for i, env in enumerate(ENVIRONMENTS)
    ]
    assert len({a.id for a in accords}) == 3
    assert magasin.grants("a") == accords
    assert [a.environment for a in magasin.grants("a")] == list(ENVIRONMENTS)


def test_groupe_et_personne_homonymes_sont_deux_accords(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    par_groupe = magasin.grant("a", DEV, groupe("alice"), ACTEUR, plus(1))
    par_personne = magasin.grant("a", DEV, ref(ALICE), ACTEUR, plus(2))
    assert par_groupe.id != par_personne.id
    assert magasin.grants("a") == [par_groupe, par_personne]
    assert magasin.grants_of(ALICE, ["a"]) == {"a": [par_personne]}


@pytest.mark.parametrize(
    "inconnue",
    [ref(ALICE_AILLEURS), PersonRef(EMETTEUR, "personne"), PersonRef(EMETTEUR, "equipe-a")],
    ids=["autre-emetteur", "jamais-connectee", "nom-de-groupe"],
)
def test_personne_inconnue_refusee(
    deux_espaces: SpaceStore, migre: Engine, inconnue: PersonRef
) -> None:
    magasin = deux_espaces
    avant = compter(migre, space_events)
    with pytest.raises(UnknownPerson):
        magasin.grant("a", DEV, inconnue, ACTEUR, plus(1))
    assert magasin.grants("a") == []
    assert compter(migre, space_events) == avant


@pytest.mark.parametrize(
    "principal", [groupe("deployeurs"), ref(ALICE)], ids=["groupe", "personne"]
)
def test_espace_inconnu_refuse(
    deux_espaces: SpaceStore, migre: Engine, principal: Principal
) -> None:
    magasin = deux_espaces
    avant = compter(migre, space_events)
    with pytest.raises(SpaceNotFound):
        magasin.grant("inconnu", DEV, principal, ACTEUR, plus(1))
    with pytest.raises(SpaceNotFound):
        magasin.revoke("inconnu", "un-accord", ACTEUR, plus(1))
    assert compter(migre, deploy_grants) == 0
    assert compter(migre, space_events) == avant
    assert magasin.grants("inconnu") == []


# --- Retirer (V5, V6) ----------------------------------------------------------------------


def test_retrait(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    garde = magasin.grant("a", DEV, groupe("deployeurs"), ACTEUR, plus(1))
    retire = magasin.grant("a", PROD, ref(BOB), ACTEUR, plus(2))
    magasin.revoke("a", retire.id, AUTRE_ACTEUR, plus(3))
    assert magasin.grants("a") == [garde]
    [dernier, *_] = magasin.events("a")
    assert (dernier.action, dernier.detail, dernier.actor, dernier.at) == (
        "deploy_revoked",
        detail(PROD, ref(BOB)),
        AUTRE_ACTEUR,
        plus(3),
    )
    # Retirer deux fois : la seconde fois, l'accord est inconnu.
    with pytest.raises(GrantNotFound):
        magasin.revoke("a", retire.id, ACTEUR, plus(4))


@pytest.mark.parametrize(
    "identifiant", ["", "inconnu", "x" * 200, "00000000-0000-0000-0000-000000000000"]
)
def test_accord_inconnu(deux_espaces: SpaceStore, migre: Engine, identifiant: str) -> None:
    magasin = deux_espaces
    magasin.grant("a", DEV, groupe("deployeurs"), ACTEUR, plus(1))
    avant = compter(migre, space_events)
    with pytest.raises(GrantNotFound) as refus:
        magasin.revoke("a", identifiant, ACTEUR, plus(2))
    assert refus.value.code == "grant_not_found"
    assert len(magasin.grants("a")) == 1
    assert compter(migre, space_events) == avant


def test_accord_d_un_autre_espace_introuvable(deux_espaces: SpaceStore, migre: Engine) -> None:
    magasin = deux_espaces
    de_b = magasin.grant("b", PROD, groupe("deployeurs"), ACTEUR, plus(1))
    avant = compter(migre, space_events)
    with pytest.raises(GrantNotFound):
        magasin.revoke("a", de_b.id, ACTEUR, plus(2))
    assert magasin.grants("b") == [de_b]
    assert compter(migre, space_events) == avant


def test_reaccorder_apres_retrait(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    premier = magasin.grant("a", TEST, ref(ALICE), ACTEUR, plus(1))
    magasin.revoke("a", premier.id, ACTEUR, plus(2))
    second = magasin.grant("a", TEST, ref(ALICE), ACTEUR, plus(3))
    assert second.id != premier.id
    assert magasin.grants("a") == [second]
    actions = [e.action for e in magasin.events("a")]
    assert actions[:3] == ["deploy_granted", "deploy_revoked", "deploy_granted"]


# --- Journal complet (V6) ------------------------------------------------------------------


def test_journal_complet(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    par_groupe = magasin.grant("a", DEV, groupe("deployeurs"), ACTEUR, plus(1))
    magasin.grant("a", PROD, ref(ALICE), AUTRE_ACTEUR, plus(2))
    magasin.grant("a", DEV, groupe("deployeurs"), ACTEUR, plus(3))  # déjà accordé
    magasin.revoke("a", par_groupe.id, AUTRE_ACTEUR, plus(4))
    evenements = magasin.events("a")
    assert resume(evenements) == [
        ("deploy_revoked", detail(DEV, groupe("deployeurs"))),
        ("deploy_granted", detail(PROD, ref(ALICE))),
        ("deploy_granted", detail(DEV, groupe("deployeurs"))),
        ("binding_added", {"principal": principal_json(groupe("equipe-a")), "after": "admin"}),
        ("space_created", {"name": "Espace a"}),
    ]
    assert [(e.actor, e.at) for e in evenements[:3]] == [
        (AUTRE_ACTEUR, plus(4)),
        (AUTRE_ACTEUR, plus(2)),
        (ACTEUR, plus(1)),
    ]
    # Le journal de B n'a rien reçu.
    assert [e.action for e in magasin.events("b")] == ["binding_added", "space_created"]


# --- Isolation, lecture par session --------------------------------------------------------


def test_isolation_de_deux_espaces(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    a_dev = magasin.grant("a", DEV, ref(ALICE), ACTEUR, plus(1))
    b_prod = magasin.grant("b", PROD, ref(ALICE), ACTEUR, plus(2))
    b_test = magasin.grant("b", TEST, groupe("equipe-a"), ACTEUR, plus(3))
    assert magasin.grants("a") == [a_dev]
    assert magasin.grants("b") == [b_prod, b_test]
    trouves = magasin.grants_of(ALICE, ["a", "b"])
    assert trouves.keys() == {"a", "b"}
    assert trouves["a"] == [a_dev]
    assert sorted(trouves["b"], key=lambda a: a.created_at) == [b_prod, b_test]
    assert magasin.grants_of(ALICE, ["a"]) == {"a": [a_dev]}
    assert magasin.grants_of(ALICE, []) == {}
    assert magasin.grants_of(ALICE, ["inconnu"]) == {"inconnu": []}


def test_accords_de_la_session_seulement(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    pour_bob = magasin.grant("a", DEV, ref(BOB), ACTEUR, plus(1))
    pour_lecteurs = magasin.grant("a", TEST, groupe("lecteurs"), ACTEUR, plus(2))
    magasin.grant("a", PROD, groupe("chloe"), ACTEUR, plus(3))
    magasin.grant("a", PROD, groupe(EMETTEUR), ACTEUR, plus(4))
    magasin.grant("a", PROD, groupe("Lecteurs"), ACTEUR, plus(5))
    magasin.grant("a", PROD, ref(ALICE), ACTEUR, plus(6))
    trouves = magasin.grants_of(BOB, ["a"])["a"]
    assert sorted(trouves, key=lambda a: a.created_at) == [pour_bob, pour_lecteurs]
    # Chloé n'a pas de groupe : le groupe qui porte son sujet ne la désigne pas.
    assert magasin.grants_of(CHLOE, ["a"]) == {"a": []}
    # Même sujet qu'Alice, autre émetteur, sans groupes : rien.
    assert magasin.grants_of(ALICE_AILLEURS, ["a"]) == {"a": []}
    sans_groupes = Identity(EMETTEUR, "bob", None, None, ())
    assert magasin.grants_of(sans_groupes, ["a"]) == {"a": [pour_bob]}


def test_accord_survit_au_retrait_de_la_liaison(deux_espaces: SpaceStore) -> None:
    # Retirer ou abaisser une liaison de rôle ne retire aucun accord (V5).
    magasin = deux_espaces
    liaison = magasin.set_binding("a", ref(BOB), Role.CREATOR, ACTEUR, plus(1))
    accorde = magasin.grant("a", PROD, ref(BOB), ACTEUR, plus(2))
    magasin.set_binding("a", ref(BOB), Role.READER, ACTEUR, plus(3))
    assert magasin.grants("a") == [accorde]
    magasin.remove_binding("a", liaison.id, ACTEUR, plus(4))
    assert magasin.grants("a") == [accorde]
    assert magasin.grants_of(BOB, ["a"]) == {"a": [accorde]}
    actions = [e.action for e in magasin.events("a")]
    assert "deploy_revoked" not in actions


# --- Instants (P8) -------------------------------------------------------------------------


def test_instants_des_accords_relus_en_utc(moteur_hors_utc: Engine) -> None:
    magasin = SpaceStore(moteur_hors_utc)
    magasin.create_space("a", "A", ATLAS, groupe("admins"), ACTEUR, INSTANT)
    magasin.grant("a", DEV, groupe("deployeurs"), ACTEUR, INSTANT)
    magasin.grant("a", DEV, groupe("deployeurs"), ACTEUR, plus(1))
    lus = [
        *(a.created_at for a in magasin.grants("a")),
        *(
            a.created_at
            for a in magasin.grants_of(Identity(EMETTEUR, "x", None, None, ("deployeurs",)), ["a"])[
                "a"
            ]
        ),
        *(e.at for e in magasin.events("a")),
    ]
    assert len(lus) == 5
    for instant in lus:
        assert instant == INSTANT
        assert utc(instant), instant
