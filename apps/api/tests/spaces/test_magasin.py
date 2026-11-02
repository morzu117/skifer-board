"""Magasin des espaces sur une base migrée : personnes, espaces, liaisons, dernier
administrateur et journal (plan 08, E3 à E5, E8, E10 ; plan 07, P2, P8)."""

from __future__ import annotations

import ast
from datetime import UTC, datetime, timedelta

import pytest
import skifer_board.spaces
from identity.conftest import INSTANT
from skifer_board.identity.model import Identity
from skifer_board.spaces import (
    EVENTS_LIMIT,
    PEOPLE_LIMIT,
    Binding,
    BindingNotFound,
    GroupPrincipal,
    LastAdmin,
    Person,
    PersonRef,
    Principal,
    Role,
    Space,
    SpaceEvent,
    SpaceExists,
    SpaceNotFound,
    SpaceStore,
    UnknownPerson,
)
from skifer_board.state.schema import people, space_bindings, space_events
from sqlalchemy import Engine, inspect, select

from .conftest import (
    ACTEUR,
    ALICE,
    ALICE_AILLEURS,
    ATLAS,
    AUTRE_EMETTEUR,
    BOB,
    CHLOE,
    EMETTEUR,
    compter,
    groupe,
    plus,
    ref,
    traces,
)


def creer(
    magasin: SpaceStore,
    espace: str = "ventes",
    premier: Principal | None = None,
    instant: datetime = INSTANT,
) -> Space:
    return magasin.create_space(
        espace, f"Espace {espace}", ATLAS, premier or groupe(f"admins-{espace}"), ACTEUR, instant
    )


def utc(instant: datetime) -> bool:
    return instant.tzinfo is not None and instant.utcoffset() == timedelta(0)


def principal_json(principal: Principal) -> dict[str, str]:
    if isinstance(principal, GroupPrincipal):
        return {"kind": "group", "name": principal.name}
    return {"kind": "person", "issuer": principal.issuer, "subject": principal.subject}


def resume(evenements: list[SpaceEvent]) -> list[tuple[str, dict[str, object]]]:
    return [(e.action, e.detail) for e in evenements]


# --- Personnes connues (E5) ----------------------------------------------------------------


def test_connexion_cree_puis_met_a_jour(magasin: SpaceStore, migre: Engine) -> None:
    assert magasin.get_person(ref(ALICE)) is None
    magasin.record_login(ALICE, INSTANT)
    assert magasin.get_person(ref(ALICE)) == Person(
        EMETTEUR, "alice", "Alice Martin", "alice@example.invalid", INSTANT
    )
    renommee = Identity(EMETTEUR, "alice", "Alice Bernard", "a.bernard@example.invalid", ("x",))
    magasin.record_login(renommee, plus(60))
    assert magasin.get_person(ref(ALICE)) == Person(
        EMETTEUR, "alice", "Alice Bernard", "a.bernard@example.invalid", plus(60)
    )
    anonyme = Identity(EMETTEUR, "alice", None, None, ())
    magasin.record_login(anonyme, plus(120))
    assert magasin.get_person(ref(ALICE)) == Person(EMETTEUR, "alice", None, None, plus(120))
    assert compter(migre, people) == 1


def test_groupes_jamais_gardes(magasin: SpaceStore, migre: Engine) -> None:
    secrets = ("groupe-tres-confidentiel", "équipe-α")
    magasin.record_login(Identity(EMETTEUR, "s", "Nom", "n@example.invalid", secrets), INSTANT)
    colonnes = {c["name"] for c in inspect(migre).get_columns("people")}
    assert colonnes == {"issuer", "subject", "name", "email", "name_key", "email_key", "last_login"}
    with migre.connect() as connexion:
        lignes = connexion.execute(select(people)).all()
    assert len(lignes) == 1
    for valeur in lignes[0]:
        for secret in secrets:
            assert secret not in str(valeur)


def test_meme_sujet_deux_emetteurs_deux_personnes(magasin: SpaceStore, migre: Engine) -> None:
    magasin.record_login(ALICE, INSTANT)
    magasin.record_login(
        Identity(AUTRE_EMETTEUR, "alice", "Autre Alice", "autre@example.invalid", ()), plus(1)
    )
    assert compter(migre, people) == 2
    ici = magasin.get_person(ref(ALICE))
    ailleurs = magasin.get_person(ref(ALICE_AILLEURS))
    assert ici is not None and ici.name == "Alice Martin" and ici.last_login == INSTANT
    assert ailleurs is not None and ailleurs.name == "Autre Alice"
    assert ailleurs.last_login == plus(1)


# --- Recherche de personnes ----------------------------------------------------------------


def connaitre(magasin: SpaceStore, sujet: str, nom: str | None, adresse: str | None) -> None:
    magasin.record_login(Identity(EMETTEUR, sujet, nom, adresse, ()), INSTANT)


def sujets(personnes: list[Person]) -> list[str]:
    return [p.subject for p in personnes]


def test_recherche_insensible_a_la_casse_sur_nom_et_adresse(magasin: SpaceStore) -> None:
    connaitre(magasin, "alice", "Alice Martin", "alice@exemple.invalid")
    connaitre(magasin, "bob", "Bob Durand", "bob.martin@exemple.invalid")
    connaitre(magasin, "chloe", "Chloé Petit", None)
    assert sujets(magasin.search_people("MARTIN")) == ["alice", "bob"]
    assert sujets(magasin.search_people("martin")) == ["alice", "bob"]
    assert sujets(magasin.search_people("aLiCe")) == ["alice"]
    assert sujets(magasin.search_people("DURAND")) == ["bob"]
    assert sujets(magasin.search_people("BOB.MARTIN@")) == ["bob"]
    assert sujets(magasin.search_people("petit")) == ["chloe"]
    assert magasin.search_people("introuvable") == []
    # Le sujet n'est pas un critère de recherche.
    connaitre(magasin, "sujet-opaque", "Dan", "dan@exemple.invalid")
    assert magasin.search_people("opaque") == []


# Accent décomposé (NFD) compris : la clé est normalisée avant et après le repli.
@pytest.mark.parametrize("recherche", ["CHLOÉ", "élodie", "ñúñez", "CHLOE\u0301"])
def test_recherche_insensible_a_la_casse_hors_ascii(magasin: SpaceStore, recherche: str) -> None:
    connaitre(magasin, "chloe", "Chloé Petit", None)
    connaitre(magasin, "elodie", "Élodie Ñúñez", "elodie@exemple.invalid")
    attendu = "chloe" if "chlo" in recherche.lower() else "elodie"
    assert sujets(magasin.search_people(recherche)) == [attendu]


@pytest.mark.parametrize(
    "recherche,attendus",
    [
        ("%", ["pourcent", "oblique"]),
        ("_", ["souligne"]),
        ("\\", ["oblique"]),
        ("a_b", ["souligne"]),
        ("100%", ["pourcent"]),
        ("\\%", ["oblique"]),
        ("%%", []),
    ],
)
def test_jokers_pris_litteralement(
    magasin: SpaceStore, recherche: str, attendus: list[str]
) -> None:
    connaitre(magasin, "pourcent", "100% fiable", None)
    connaitre(magasin, "souligne", "a_b", None)
    connaitre(magasin, "temoin", "axb 1000 fiable", "temoin@exemple.invalid")
    connaitre(magasin, "oblique", "c:\\%dossier", None)
    assert sujets(magasin.search_people(recherche)) == attendus


def test_recherche_limitee(magasin: SpaceStore) -> None:
    assert PEOPLE_LIMIT == 20
    for i in range(PEOPLE_LIMIT + 5):
        connaitre(magasin, f"p{i:02d}", f"Membre {i:02d}", None)
    trouvees = magasin.search_people("membre")
    assert sujets(trouvees) == [f"p{i:02d}" for i in range(PEOPLE_LIMIT)]
    assert len(magasin.search_people("membre", limit=5)) == 5
    assert len(magasin.search_people("")) == PEOPLE_LIMIT


def test_recherche_vide_et_personnes_sans_nom_ni_adresse(magasin: SpaceStore) -> None:
    connaitre(magasin, "muet", None, None)
    connaitre(magasin, "nomme", "Nommé", None)
    connaitre(magasin, "adresse", None, "adresse@exemple.invalid")
    assert sujets(magasin.search_people("")) == ["nomme", "adresse"]
    assert magasin.search_people("muet") == []
    assert magasin.get_person(PersonRef(EMETTEUR, "muet")) is not None


def test_ordre_stable(magasin: SpaceStore) -> None:
    # Enregistrées dans le désordre : l'ordre rendu est le nom, puis l'adresse, puis le sujet,
    # les personnes sans nom en dernier.
    connaitre(magasin, "s5", None, "zz@exemple.invalid")
    connaitre(magasin, "s4", "membre b", "b@exemple.invalid")
    connaitre(magasin, "s3", "membre a", "z@exemple.invalid")
    connaitre(magasin, "s2", "membre a", "a@exemple.invalid")
    connaitre(magasin, "s1", None, "membre@exemple.invalid")
    connaitre(magasin, "s0", "membre a", "a@exemple.invalid")
    attendu = ["s0", "s2", "s3", "s4", "s1", "s5"]
    assert sujets(magasin.search_people("e")) == attendu
    assert sujets(magasin.search_people("e")) == attendu


# --- Création d'un espace ------------------------------------------------------------------


def test_creation_avec_premier_administrateur(magasin: SpaceStore) -> None:
    espace = creer(magasin, "ventes")
    assert espace == Space("ventes", "Espace ventes", ATLAS, INSTANT, ACTEUR)
    assert magasin.get_space("ventes") == espace
    assert magasin.list_spaces() == [espace]
    [premiere] = magasin.bindings("ventes")
    assert premiere.principal == groupe("admins-ventes")
    assert premiere.role == Role.ADMIN
    assert premiere.space_id == "ventes"
    assert (premiere.created_at, premiere.created_by) == (INSTANT, ACTEUR)
    evenements = magasin.events("ventes")
    assert resume(evenements) == [
        ("binding_added", {"principal": principal_json(groupe("admins-ventes")), "after": "admin"}),
        ("space_created", {"name": "Espace ventes"}),
    ]
    assert all(e.actor == ACTEUR and e.at == INSTANT and e.space_id == "ventes" for e in evenements)
    assert evenements[0].id > evenements[1].id


def test_creation_avec_une_personne_connue(magasin: SpaceStore) -> None:
    magasin.record_login(ALICE, INSTANT)
    creer(magasin, "rh", ref(ALICE))
    [premiere] = magasin.bindings("rh")
    assert premiere.principal == ref(ALICE)
    assert magasin.role_in("rh", ALICE) == Role.ADMIN
    assert magasin.events("rh")[0].detail == {
        "principal": {"kind": "person", "issuer": EMETTEUR, "subject": "alice"},
        "after": "admin",
    }


def test_identifiant_deja_pris(magasin: SpaceStore, migre: Engine) -> None:
    premier = creer(magasin, "ventes")
    avant = traces(migre)
    with pytest.raises(SpaceExists):
        magasin.create_space("ventes", "Autre nom", "/autre", groupe("intrus"), ACTEUR, plus(5))
    assert traces(migre) == avant
    assert magasin.get_space("ventes") == premier
    assert [b.principal for b in magasin.bindings("ventes")] == [groupe("admins-ventes")]


@pytest.mark.parametrize("inconnue", [ref(ALICE), ref(ALICE_AILLEURS)])
def test_premier_administrateur_inconnu_aucune_trace(
    magasin: SpaceStore, migre: Engine, inconnue: PersonRef
) -> None:
    if inconnue == ref(ALICE_AILLEURS):
        # Connue chez un autre émetteur seulement : toujours inconnue ici.
        magasin.record_login(ALICE, INSTANT)
    with pytest.raises(UnknownPerson):
        creer(magasin, "ventes", inconnue)
    assert traces(migre) == (0, 0, 0)
    assert magasin.get_space("ventes") is None
    assert magasin.list_spaces() == []
    # L'identifiant reste libre.
    creer(magasin, "ventes")
    assert traces(migre) == (1, 1, 2)


# --- Espaces d'une identité et rôle (E3, E4) -----------------------------------------------


@pytest.fixture
def deux_espaces(magasin: SpaceStore) -> SpaceStore:
    """A : `equipe-a` administre, `analystes` crée. B : `equipe-b` administre, `analystes`
    lit. Alice est dans `equipe-a`, Bob dans `lecteurs`."""
    for personne in (ALICE, BOB, CHLOE):
        magasin.record_login(personne, INSTANT)
    creer(magasin, "a", groupe("equipe-a"))
    creer(magasin, "b", groupe("equipe-b"))
    magasin.set_binding("a", groupe("analystes"), Role.CREATOR, ACTEUR, plus(1))
    magasin.set_binding("b", groupe("analystes"), Role.READER, ACTEUR, plus(1))
    return magasin


def test_isolation_de_deux_espaces(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    espaces = magasin.spaces_of(ALICE)
    assert [(s.id, r) for s, r in espaces] == [("a", Role.ADMIN)]
    assert magasin.role_in("a", ALICE) == Role.ADMIN
    assert magasin.role_in("b", ALICE) is None
    analyste = Identity(EMETTEUR, "zoe", None, None, ("analystes",))
    assert [(s.id, r) for s, r in magasin.spaces_of(analyste)] == [
        ("a", Role.CREATOR),
        ("b", Role.READER),
    ]
    assert magasin.role_in("a", analyste) == Role.CREATOR
    assert magasin.role_in("b", analyste) == Role.READER
    assert magasin.spaces_of(BOB) == []
    assert magasin.role_in("inconnu", ALICE) is None


def test_le_plus_eleve_et_meme_sujet_ailleurs(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    magasin.set_binding("b", ref(ALICE), Role.READER, ACTEUR, plus(2))
    magasin.set_binding("b", groupe("equipe-a"), Role.CREATOR, ACTEUR, plus(3))
    assert magasin.role_in("b", ALICE) == Role.CREATOR
    [(espace, role)] = [(s, r) for s, r in magasin.spaces_of(ALICE) if s.id == "b"]
    assert role == Role.CREATOR
    assert espace.created_by == ACTEUR
    # Même sujet, autre émetteur, sans groupes : rien.
    assert magasin.spaces_of(ALICE_AILLEURS) == []
    assert magasin.role_in("b", ALICE_AILLEURS) is None


def test_identite_sans_groupes(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    assert magasin.spaces_of(CHLOE) == []
    magasin.set_binding("b", ref(CHLOE), Role.READER, ACTEUR, plus(2))
    assert [(s.id, r) for s, r in magasin.spaces_of(CHLOE)] == [("b", Role.READER)]
    assert magasin.role_in("a", CHLOE) is None


def test_groupe_nomme_comme_un_sujet(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    magasin.set_binding("a", groupe("chloe"), Role.ADMIN, ACTEUR, plus(2))
    assert magasin.role_in("a", CHLOE) is None
    magasin.set_binding("b", groupe(EMETTEUR), Role.ADMIN, ACTEUR, plus(2))
    assert magasin.spaces_of(CHLOE) == []


def test_revocation_effective_a_l_appel_suivant(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    analyste = Identity(EMETTEUR, "zoe", None, None, ("analystes",))
    [liaison_a] = [b for b in magasin.bindings("a") if b.principal == groupe("analystes")]
    magasin.remove_binding("a", liaison_a.id, ACTEUR, plus(5))
    assert magasin.role_in("a", analyste) is None
    assert [s.id for s, _ in magasin.spaces_of(analyste)] == ["b"]
    magasin.set_binding("b", groupe("analystes"), Role.CREATOR, ACTEUR, plus(6))
    assert magasin.role_in("b", analyste) == Role.CREATOR
    # La session garde ses groupes : un groupe retiré chez le fournisseur ne compte qu'à la
    # connexion suivante (E4), mais une liaison retirée dans Board ne compte plus du tout.
    assert magasin.role_in("a", analyste) is None


# --- Poser une liaison ---------------------------------------------------------------------


def test_ajout_d_une_liaison(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    autre = PersonRef(EMETTEUR, "autre-acteur")
    pose = magasin.set_binding("a", ref(BOB), Role.READER, autre, plus(10))
    assert (pose.space_id, pose.principal, pose.role) == ("a", ref(BOB), Role.READER)
    assert (pose.created_at, pose.created_by) == (plus(10), autre)
    assert pose in magasin.bindings("a")
    [dernier] = magasin.events("a", limit=1)
    assert (dernier.action, dernier.actor, dernier.at) == ("binding_added", autre, plus(10))
    assert dernier.detail == {"principal": principal_json(ref(BOB)), "after": "reader"}


def test_changement_de_role_journalise(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    [avant] = [b for b in magasin.bindings("a") if b.principal == groupe("analystes")]
    autre = PersonRef(EMETTEUR, "autre-acteur")
    apres = magasin.set_binding("a", groupe("analystes"), Role.ADMIN, autre, plus(10))
    assert apres == Binding(
        avant.id, "a", groupe("analystes"), Role.ADMIN, avant.created_at, avant.created_by
    )
    assert apres in magasin.bindings("a")
    [dernier] = magasin.events("a", limit=1)
    assert (dernier.action, dernier.actor, dernier.at) == ("binding_changed", autre, plus(10))
    assert dernier.detail == {
        "principal": principal_json(groupe("analystes")),
        "before": "creator",
        "after": "admin",
    }


def test_liaison_inchangee_non_journalisee(deux_espaces: SpaceStore, migre: Engine) -> None:
    magasin = deux_espaces
    avant = traces(migre)
    evenements = magasin.events("a")
    liaisons = magasin.bindings("a")
    rendue = magasin.set_binding("a", groupe("analystes"), Role.CREATOR, ACTEUR, plus(30))
    assert rendue in liaisons
    assert traces(migre) == avant
    assert magasin.events("a") == evenements
    assert magasin.bindings("a") == liaisons


def test_personne_inconnue_refusee(deux_espaces: SpaceStore, migre: Engine) -> None:
    magasin = deux_espaces
    avant = traces(migre)
    for inconnue in (PersonRef(EMETTEUR, "jamais-connectee"), ref(ALICE_AILLEURS)):
        with pytest.raises(UnknownPerson):
            magasin.set_binding("a", inconnue, Role.READER, ACTEUR, plus(10))
    assert traces(migre) == avant


@pytest.mark.parametrize("principal", [groupe("equipe-a"), ref(ALICE)])
def test_espace_inconnu(deux_espaces: SpaceStore, migre: Engine, principal: Principal) -> None:
    avant = traces(migre)
    with pytest.raises(SpaceNotFound):
        deux_espaces.set_binding("inconnu", principal, Role.READER, ACTEUR, plus(10))
    with pytest.raises(SpaceNotFound):
        deux_espaces.remove_binding("inconnu", "nimporte", ACTEUR, plus(10))
    assert traces(migre) == avant
    assert deux_espaces.bindings("inconnu") == []
    assert deux_espaces.events("inconnu") == []


def test_une_seule_liaison_par_principal(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    for role in (Role.READER, Role.CREATOR, Role.READER, Role.ADMIN):
        magasin.set_binding("a", groupe("analystes"), role, ACTEUR, plus(10))
        magasin.set_binding("a", ref(BOB), role, ACTEUR, plus(10))
    principaux = [b.principal for b in magasin.bindings("a")]
    assert principaux.count(groupe("analystes")) == 1
    assert principaux.count(ref(BOB)) == 1
    # Un groupe nommé comme le sujet de Bob est une autre liaison.
    magasin.set_binding("a", groupe("bob"), Role.READER, ACTEUR, plus(11))
    roles = {b.principal: b.role for b in magasin.bindings("a")}
    assert roles[ref(BOB)] == Role.ADMIN
    assert roles[groupe("bob")] == Role.READER
    # Le même groupe garde sa propre liaison dans B.
    assert {b.principal: b.role for b in magasin.bindings("b")}[groupe("analystes")] == Role.READER


# --- Retrait et dernier administrateur (E8) ------------------------------------------------


def seule_admin(magasin: SpaceStore, espace: str) -> Binding:
    [admin] = [b for b in magasin.bindings(espace) if b.role == Role.ADMIN]
    return admin


def test_retrait_journalise(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    [analystes] = [b for b in magasin.bindings("a") if b.principal == groupe("analystes")]
    magasin.remove_binding("a", analystes.id, ACTEUR, plus(10))
    assert analystes not in magasin.bindings("a")
    [dernier] = magasin.events("a", limit=1)
    assert (dernier.action, dernier.actor, dernier.at) == ("binding_removed", ACTEUR, plus(10))
    assert dernier.detail == {"principal": principal_json(groupe("analystes")), "before": "creator"}
    with pytest.raises(BindingNotFound):
        magasin.remove_binding("a", analystes.id, ACTEUR, plus(11))


@pytest.mark.parametrize("role", [Role.CREATOR, Role.READER])
def test_dernier_administrateur_ni_retire_ni_abaisse(
    deux_espaces: SpaceStore, migre: Engine, role: Role
) -> None:
    magasin = deux_espaces
    admin = seule_admin(magasin, "a")
    avant = traces(migre)
    liaisons = magasin.bindings("a")
    with pytest.raises(LastAdmin):
        magasin.remove_binding("a", admin.id, ACTEUR, plus(10))
    with pytest.raises(LastAdmin):
        magasin.set_binding("a", admin.principal, role, ACTEUR, plus(10))
    assert traces(migre) == avant
    assert magasin.bindings("a") == liaisons
    assert magasin.role_in("a", ALICE) == Role.ADMIN


def test_dernier_administrateur_compte_par_espace(deux_espaces: SpaceStore) -> None:
    # B a son propre administrateur, A aussi : chacun reste le dernier de son espace.
    magasin = deux_espaces
    magasin.set_binding("b", groupe("equipe-a"), Role.ADMIN, ACTEUR, plus(1))
    with pytest.raises(LastAdmin):
        magasin.remove_binding("a", seule_admin(magasin, "a").id, ACTEUR, plus(2))


@pytest.mark.parametrize("second", [groupe("secours"), ref(BOB)])
def test_retrait_possible_s_il_reste_un_administrateur(
    deux_espaces: SpaceStore, second: Principal
) -> None:
    magasin = deux_espaces
    premier = seule_admin(magasin, "a")
    magasin.set_binding("a", second, Role.ADMIN, ACTEUR, plus(1))
    magasin.remove_binding("a", premier.id, ACTEUR, plus(2))
    restant = seule_admin(magasin, "a")
    assert restant.principal == second
    with pytest.raises(LastAdmin):
        magasin.remove_binding("a", restant.id, ACTEUR, plus(3))
    # Un nouvel administrateur permet d'abaisser l'ancien.
    magasin.set_binding("a", groupe("equipe-a"), Role.ADMIN, ACTEUR, plus(4))
    abaisse = magasin.set_binding("a", second, Role.READER, ACTEUR, plus(5))
    assert abaisse.role == Role.READER
    assert seule_admin(magasin, "a").principal == groupe("equipe-a")


def test_liaison_d_un_autre_espace_introuvable(deux_espaces: SpaceStore, migre: Engine) -> None:
    magasin = deux_espaces
    magasin.set_binding("b", groupe("secours-b"), Role.ADMIN, ACTEUR, plus(1))
    liaisons_b = magasin.bindings("b")
    avant = traces(migre)
    for liaison_b in liaisons_b:
        with pytest.raises(BindingNotFound):
            magasin.remove_binding("a", liaison_b.id, ACTEUR, plus(2))
    with pytest.raises(BindingNotFound):
        magasin.remove_binding("a", "00000000-0000-0000-0000-000000000000", ACTEUR, plus(2))
    assert traces(migre) == avant
    assert magasin.bindings("b") == liaisons_b


# --- Journal (E10) -------------------------------------------------------------------------


def test_journal_complet_ordonne_et_limite(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    magasin.set_binding("a", ref(BOB), Role.READER, ref(ALICE), plus(10))
    magasin.set_binding("a", ref(BOB), Role.ADMIN, ref(ALICE), plus(11))
    [bob] = [b for b in magasin.bindings("a") if b.principal == ref(BOB)]
    magasin.remove_binding("a", bob.id, ref(ALICE), plus(12))
    evenements = magasin.events("a")
    assert [(e.action, e.actor, e.at) for e in evenements] == [
        ("binding_removed", ref(ALICE), plus(12)),
        ("binding_changed", ref(ALICE), plus(11)),
        ("binding_added", ref(ALICE), plus(10)),
        ("binding_added", ACTEUR, plus(1)),
        ("binding_added", ACTEUR, INSTANT),
        ("space_created", ACTEUR, INSTANT),
    ]
    assert [e.detail for e in evenements[:3]] == [
        {"principal": principal_json(ref(BOB)), "before": "admin"},
        {"principal": principal_json(ref(BOB)), "before": "reader", "after": "admin"},
        {"principal": principal_json(ref(BOB)), "after": "reader"},
    ]
    ids = [e.id for e in evenements]
    assert ids == sorted(ids, reverse=True)
    assert len(set(ids)) == len(ids)
    assert magasin.events("a", limit=2) == evenements[:2]
    assert magasin.events("a", limit=0) == []
    assert {e.space_id for e in evenements} == {"a"}
    assert {e.space_id for e in magasin.events("b")} == {"b"}
    assert len(magasin.events("b")) == 3


def test_journal_en_ajout_seul(deux_espaces: SpaceStore, migre: Engine) -> None:
    magasin = deux_espaces
    with migre.connect() as connexion:
        brut_avant = connexion.execute(select(space_events).order_by(space_events.c.id)).all()
    avant = magasin.events("a")
    [analystes] = [b for b in magasin.bindings("a") if b.principal == groupe("analystes")]
    magasin.set_binding("a", groupe("analystes"), Role.READER, ACTEUR, plus(20))
    magasin.set_binding("a", groupe("analystes"), Role.ADMIN, ACTEUR, plus(21))
    magasin.remove_binding("a", analystes.id, ACTEUR, plus(22))
    magasin.set_binding("a", groupe("analystes"), Role.CREATOR, ACTEUR, plus(23))
    apres = magasin.events("a")
    assert apres[len(apres) - len(avant) :] == avant
    assert len(apres) == len(avant) + 4
    with migre.connect() as connexion:
        brut_apres = connexion.execute(select(space_events).order_by(space_events.c.id)).all()
    assert brut_apres[: len(brut_avant)] == brut_avant


def test_journal_limite_par_defaut(magasin: SpaceStore) -> None:
    assert EVENTS_LIMIT == 200
    creer(magasin, "a", groupe("admins"))
    for i in range(EVENTS_LIMIT):
        magasin.set_binding("a", groupe(f"g{i}"), Role.READER, ACTEUR, plus(i))
    evenements = magasin.events("a")
    assert len(evenements) == EVENTS_LIMIT
    assert evenements[0].detail["principal"] == {"kind": "group", "name": f"g{EVENTS_LIMIT - 1}"}
    assert evenements[-1].action == "binding_added"
    assert len(magasin.events("a", limit=EVENTS_LIMIT + 10)) == EVENTS_LIMIT + 2


def test_instants_de_l_horloge_de_board(magasin: SpaceStore, migre: Engine) -> None:
    # Un instant lointain : la base n'y substitue pas le sien (plan 07, P8).
    lointain = datetime(2001, 2, 3, 4, 5, 6, 789, tzinfo=UTC)
    magasin.record_login(ALICE, lointain)
    creer(magasin, "a", ref(ALICE), lointain)
    assert magasin.get_person(ref(ALICE)) == Person(
        EMETTEUR, "alice", ALICE.name, ALICE.email, lointain
    )
    assert {e.at for e in magasin.events("a")} == {lointain}
    assert {b.created_at for b in magasin.bindings("a")} == {lointain}
    with migre.connect() as connexion:
        assert connexion.execute(select(space_bindings.c.created_at)).scalar_one() == lointain


# --- Instants relus en UTC -----------------------------------------------------------------


def test_instants_relus_en_utc_quel_que_soit_le_fuseau(moteur_hors_utc: Engine) -> None:
    magasin = SpaceStore(moteur_hors_utc)
    magasin.record_login(ALICE, INSTANT)
    creer(magasin, "a", ref(ALICE))
    personne = magasin.get_person(ref(ALICE))
    assert personne is not None
    [trouvee] = magasin.search_people("alice")
    [(espace, _)] = magasin.spaces_of(ALICE)
    lus = [
        personne.last_login,
        trouvee.last_login,
        espace.created_at,
        *(s.created_at for s in magasin.list_spaces()),
        *(b.created_at for b in magasin.bindings("a")),
        *(e.at for e in magasin.events("a")),
    ]
    stocke = magasin.get_space("a")
    assert stocke is not None
    lus.append(stocke.created_at)
    for instant in lus:
        assert instant == INSTANT
        assert utc(instant), instant
        assert instant.isoformat().endswith("+00:00")


# --- Requêtes construites (plan 07, P2) ----------------------------------------------------


def test_requetes_construites_jamais_ecrites() -> None:
    """Ni `text()`, ni instruction en chaîne dans le paquet des espaces (P2)."""
    from pathlib import Path

    sources = sorted(Path(skifer_board.spaces.__file__).parent.rglob("*.py"))
    assert any(p.name == "store.py" for p in sources)
    for source in sources:
        arbre = ast.parse(source.read_text(encoding="utf-8"))
        for noeud in ast.walk(arbre):
            if isinstance(noeud, ast.ImportFrom) and (noeud.module or "").startswith("sqlalchemy"):
                assert "text" not in {alias.name for alias in noeud.names}, source
            if isinstance(noeud, ast.Call) and isinstance(noeud.func, ast.Attribute):
                assert noeud.func.attr not in {"text", "exec_driver_sql"}, source
                if noeud.func.attr == "execute":
                    assert not any(
                        isinstance(argument, ast.Constant) and isinstance(argument.value, str)
                        for argument in noeud.args
                    ), source
