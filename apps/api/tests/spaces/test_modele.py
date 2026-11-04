"""Modèle pur des espaces : rôles, identifiant, correspondance et rôle effectif (plan 08, E1 à
E3, E6)."""

from __future__ import annotations

import itertools
import string

import pytest
from hypothesis import given
from hypothesis import strategies as st
from skifer_board.identity import config_from_env
from skifer_board.identity.config import (
    ADMIN_GROUP,
    CLIENT_ID,
    CLIENT_SECRET,
    ISSUER,
    PUBLIC_ORIGIN,
    REDIRECT_URI,
)
from skifer_board.identity.model import Identity
from skifer_board.spaces import (
    SPACE_ID,
    Binding,
    BindingNotFound,
    GroupPrincipal,
    LastAdmin,
    PersonRef,
    Principal,
    Role,
    SpaceError,
    SpaceExists,
    SpaceNotFound,
    UnknownPerson,
    effective_role,
    is_platform_admin,
    matches,
)

from .conftest import ALICE, AUTRE_EMETTEUR, EMETTEUR, groupe, liaison

ORDRE = [Role.READER, Role.CREATOR, Role.ADMIN]


# --- Rôles (E2) ----------------------------------------------------------------------------


def test_trois_roles_ordonnes() -> None:
    assert list(Role) == ORDRE
    assert [role.value for role in Role] == ["reader", "creator", "admin"]
    assert [role.rank for role in ORDRE] == sorted({role.rank for role in ORDRE})
    assert Role.READER.rank < Role.CREATOR.rank < Role.ADMIN.rank


@pytest.mark.parametrize(
    "tenu,requis",
    list(itertools.product(ORDRE, ORDRE)),
    ids=lambda role: str(role),
)
def test_allows_sur_les_neuf_paires(tenu: Role, requis: Role) -> None:
    attendu = ORDRE.index(tenu) >= ORDRE.index(requis)
    assert tenu.allows(requis) is attendu


def test_allows_table_explicite() -> None:
    assert Role.READER.allows(Role.READER)
    assert not Role.READER.allows(Role.CREATOR)
    assert not Role.READER.allows(Role.ADMIN)
    assert Role.CREATOR.allows(Role.READER)
    assert Role.CREATOR.allows(Role.CREATOR)
    assert not Role.CREATOR.allows(Role.ADMIN)
    assert Role.ADMIN.allows(Role.READER)
    assert Role.ADMIN.allows(Role.CREATOR)
    assert Role.ADMIN.allows(Role.ADMIN)


def test_role_inconnu_refuse() -> None:
    for valeur in ("Admin", "ADMIN", "owner", "", "administrateur"):
        with pytest.raises(ValueError):
            Role(valeur)


# --- Identifiant d'espace (E1) -------------------------------------------------------------


@pytest.mark.parametrize(
    "identifiant",
    ["ab", "a1", "00", "9z", "a-b", "a--b", "espace-2026", "x" * 40, "a" + "-" * 38 + "b"],
)
def test_identifiant_accepte(identifiant: str) -> None:
    assert SPACE_ID.fullmatch(identifiant) is not None


@pytest.mark.parametrize(
    "identifiant",
    [
        "",
        "a",
        "-",
        "--",
        "x" * 41,
        "-ab",
        "ab-",
        "-ab-",
        "Ab",
        "aB",
        "ABC",
        "café",
        "é-a",
        "a b",
        " ab",
        "ab ",
        "a_b",
        "a.b",
        "a/b",
        "ab\n",
        "\nab",
        "ａｂ",
        "١٢",
    ],
)
def test_identifiant_refuse(identifiant: str) -> None:
    assert SPACE_ID.fullmatch(identifiant) is None


def reference_identifiant(valeur: str) -> bool:
    permis = set(string.ascii_lowercase + string.digits + "-")
    return (
        2 <= len(valeur) <= 40
        and set(valeur) <= permis
        and not valeur.startswith("-")
        and not valeur.endswith("-")
    )


@given(st.text(alphabet=st.sampled_from("az09-AZé _\n."), max_size=45))
def test_identifiant_propriete(valeur: str) -> None:
    assert (SPACE_ID.fullmatch(valeur) is not None) is reference_identifiant(valeur)


@given(st.integers(min_value=0, max_value=60))
def test_identifiant_longueur(longueur: int) -> None:
    valeur = "a" * longueur
    assert (SPACE_ID.fullmatch(valeur) is not None) is (2 <= longueur <= 40)


# --- Correspondance et rôle effectif (E3) --------------------------------------------------


def identite(
    groupes: tuple[str, ...] = (), sujet: str = "sujet", emetteur: str = EMETTEUR
) -> Identity:
    return Identity(emetteur, sujet, "Nom", "n@example.invalid", groupes)


MOI = PersonRef(EMETTEUR, "sujet")


def test_aucune_liaison() -> None:
    assert effective_role(identite(("lecteurs",)), []) is None
    assert effective_role(identite(), []) is None


def test_groupe_seul() -> None:
    liaisons = [liaison(groupe("lecteurs"), Role.READER)]
    assert effective_role(identite(("lecteurs",)), liaisons) == Role.READER
    assert effective_role(identite(("autres",)), liaisons) is None
    assert effective_role(identite(), liaisons) is None


def test_personne_seule() -> None:
    liaisons = [liaison(MOI, Role.CREATOR)]
    assert effective_role(identite(), liaisons) == Role.CREATOR
    assert effective_role(identite(sujet="autre"), liaisons) is None


def test_meme_sujet_chez_un_autre_emetteur() -> None:
    liaisons = [liaison(MOI, Role.ADMIN)]
    ailleurs = identite(emetteur=AUTRE_EMETTEUR)
    assert not matches(MOI, ailleurs)
    assert effective_role(ailleurs, liaisons) is None


@pytest.mark.parametrize(
    "liaisons",
    [
        [liaison(groupe("lecteurs"), Role.READER), liaison(MOI, Role.ADMIN)],
        [liaison(MOI, Role.ADMIN), liaison(groupe("lecteurs"), Role.READER)],
    ],
)
def test_groupe_et_personne(liaisons: list[Binding]) -> None:
    assert effective_role(identite(("lecteurs",)), liaisons) == Role.ADMIN
    # Sans le groupe, la liaison de personne suffit ; sans être la personne, le groupe suffit.
    assert effective_role(identite(), liaisons) == Role.ADMIN
    assert effective_role(identite(("lecteurs",), sujet="autre"), liaisons) == Role.READER


@pytest.mark.parametrize(
    "ordre",
    list(
        itertools.permutations(
            [("g-lecteur", Role.READER), ("g-createur", Role.CREATOR), ("g-admin", Role.ADMIN)]
        )
    ),
)
def test_plusieurs_groupes_le_plus_eleve_l_emporte(ordre: tuple[tuple[str, Role], ...]) -> None:
    liaisons = [liaison(groupe(nom), role) for nom, role in ordre]
    tous = identite(("g-lecteur", "g-createur", "g-admin"))
    assert effective_role(tous, liaisons) == Role.ADMIN
    assert effective_role(identite(("g-lecteur", "g-createur")), liaisons) == Role.CREATOR
    assert effective_role(identite(("g-createur", "g-lecteur")), liaisons) == Role.CREATOR
    assert effective_role(identite(("g-lecteur",)), liaisons) == Role.READER


def test_personne_lectrice_et_groupe_createur() -> None:
    liaisons = [liaison(MOI, Role.READER), liaison(groupe("auteurs"), Role.CREATOR)]
    assert effective_role(identite(("auteurs",)), liaisons) == Role.CREATOR


@pytest.mark.parametrize(
    "variante", ["Lecteurs", "LECTEURS", " lecteurs", "lecteurs ", "lecteur", "lect"]
)
def test_groupe_valeur_exacte(variante: str) -> None:
    liaisons = [liaison(groupe("lecteurs"), Role.READER)]
    assert effective_role(identite((variante,)), liaisons) is None
    assert not matches(groupe(variante), identite(("lecteurs",)))


def test_groupe_vide() -> None:
    liaisons = [liaison(groupe("lecteurs"), Role.ADMIN)]
    # Un claim vide ou une valeur vide ne déduit aucun rôle (fail-closed).
    assert effective_role(identite(()), liaisons) is None
    assert effective_role(identite(("",)), liaisons) is None
    assert not matches(groupe(""), identite(()))
    assert not matches(groupe(""), identite(("lecteurs",)))


def test_groupe_et_personne_ne_se_confondent_pas() -> None:
    # Un groupe nommé comme le sujet, ou une personne dont le sujet est un nom de groupe.
    assert not matches(groupe("sujet"), identite())
    assert not matches(PersonRef(EMETTEUR, "lecteurs"), identite(("lecteurs",)))
    assert not matches(PersonRef("lecteurs", "sujet"), identite(("lecteurs",)))
    assert not matches(groupe(EMETTEUR), identite())


def test_role_effectif_ignore_l_adresse() -> None:
    # Une personne n'est jamais désignée par son adresse (E3).
    adresse = identite()
    assert not matches(PersonRef(EMETTEUR, "n@example.invalid"), adresse)
    assert not matches(groupe("n@example.invalid"), adresse)


def test_role_effectif_sur_un_iterable_a_usage_unique() -> None:
    liaisons = (b for b in [liaison(groupe("a"), Role.READER), liaison(groupe("b"), Role.ADMIN)])
    assert effective_role(identite(("a", "b")), liaisons) == Role.ADMIN


def test_personne_ref_de_l_identite() -> None:
    assert PersonRef.of(ALICE) == PersonRef(ALICE.issuer, ALICE.subject)
    assert matches(PersonRef.of(ALICE), ALICE)


GROUPES = st.sampled_from(["a", "b", "A", "", "sujet"])
EMETTEURS = st.sampled_from([EMETTEUR, AUTRE_EMETTEUR])
SUJETS = st.sampled_from(["sujet", "autre", "a"])
PRINCIPAUX: st.SearchStrategy[Principal] = st.one_of(
    GROUPES.map(GroupPrincipal), st.builds(PersonRef, EMETTEURS, SUJETS)
)
ROLES = st.sampled_from(ORDRE)


def reference(identite_: Identity, liaisons: list[Binding]) -> Role | None:
    rangs = []
    for b in liaisons:
        if isinstance(b.principal, GroupPrincipal):
            if b.principal.name in identite_.groups:
                rangs.append(ORDRE.index(b.role))
        elif (b.principal.issuer, b.principal.subject) == (identite_.issuer, identite_.subject):
            rangs.append(ORDRE.index(b.role))
    return ORDRE[max(rangs)] if rangs else None


@given(
    st.lists(st.tuples(PRINCIPAUX, ROLES), max_size=8),
    st.lists(GROUPES, max_size=4).map(tuple),
    EMETTEURS,
    SUJETS,
)
def test_role_effectif_propriete(
    paires: list[tuple[Principal, Role]], groupes: tuple[str, ...], emetteur: str, sujet: str
) -> None:
    liaisons = [liaison(p, r) for p, r in paires]
    personne = identite(groupes, sujet, emetteur)
    attendu = reference(personne, liaisons)
    assert effective_role(personne, liaisons) == attendu
    # Indépendant de l'ordre des liaisons.
    assert effective_role(personne, list(reversed(liaisons))) == attendu
    if attendu is not None:
        assert all(attendu.allows(b.role) for b in liaisons if matches(b.principal, personne))


# --- Administration de la plateforme (E6) --------------------------------------------------


@pytest.mark.parametrize(
    "groupes", [(), ("",), ("admin",), ("reader",), ("None",), ("plateforme",), ("admins",)]
)
def test_sans_groupe_d_administration_personne_n_administre(groupes: tuple[str, ...]) -> None:
    assert is_platform_admin(identite(groupes), None) is False


@pytest.mark.parametrize(
    "groupes,attendu",
    [
        ((), False),
        (("",), False),
        (("admin",), False),
        (("Plateforme",), False),
        (("plateforme-x",), False),
        ((" plateforme",), False),
        (("plateforme",), True),
        (("lecteurs", "plateforme"), True),
    ],
)
def test_groupe_d_administration_configure(groupes: tuple[str, ...], attendu: bool) -> None:
    assert is_platform_admin(identite(groupes), "plateforme") is attendu


def test_administrer_la_plateforme_n_est_pas_un_role() -> None:
    admin = identite(("plateforme",))
    assert is_platform_admin(admin, "plateforme")
    assert effective_role(admin, []) is None
    assert effective_role(admin, [liaison(groupe("lecteurs"), Role.READER)]) is None


@pytest.mark.parametrize("valeur,attendu", [(None, None), ("", None), ("plateforme", "plateforme")])
def test_groupe_d_administration_lu_de_la_configuration(
    valeur: str | None, attendu: str | None
) -> None:
    environnement = {
        ISSUER: "https://id.example.invalid",
        CLIENT_ID: "board-test",
        CLIENT_SECRET: "secret",
        REDIRECT_URI: "https://board.example.invalid/auth/callback",
        PUBLIC_ORIGIN: "https://board.example.invalid",
    }
    if valeur is not None:
        environnement[ADMIN_GROUP] = valeur
    config = config_from_env(environnement)
    assert config is not None
    assert config.admin_group == attendu
    admin = identite(("plateforme", ""))
    assert is_platform_admin(admin, config.admin_group) is (attendu is not None)


# --- Refus à codes fermés ------------------------------------------------------------------


@pytest.mark.parametrize(
    "erreur,code",
    [
        (SpaceExists, "space_exists"),
        (SpaceNotFound, "space_not_found"),
        (BindingNotFound, "binding_not_found"),
        (UnknownPerson, "unknown_person"),
        (LastAdmin, "last_admin"),
    ],
)
def test_codes_fermes(erreur: type[SpaceError], code: str) -> None:
    assert issubclass(erreur, SpaceError)
    assert erreur.code == code
