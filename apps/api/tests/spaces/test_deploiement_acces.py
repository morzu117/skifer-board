"""Environnements et droit de déployer dans l'accès à un espace (plan 09, V3, V4, V7, V8).

Le droit est recalculé à chaque appel à partir de la session : un accord retiré, une liaison
abaissée, un groupe perdu changent la réponse suivante. L'administration de la plateforme gère
les accords mais ne déploie pas ; un lecteur, même avec un accord, ne déploie pas.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from identity.conftest import INSTANT
from skifer_board.identity.model import Identity
from skifer_board.spaces import (
    LOCAL_SPACE,
    Access,
    LocalMode,
    Role,
    Spaces,
    SpaceStore,
)
from skifer_board.spaces.model import ENVIRONMENTS, Environment
from sqlalchemy import Engine, event

from .conftest import ACTEUR, ALICE, ALICE_AILLEURS, ATLAS, BOB, CHLOE, EMETTEUR, groupe, plus, ref

DEV, TEST, PROD = ENVIRONMENTS
PLATEFORME = "plateforme"
RIEN: frozenset[Environment] = frozenset()

# Rôles dans A : Alice administre par `equipe-a`, Bob crée par une liaison de personne, Chloé
# lit par une liaison de personne. Pia administre la plateforme sans rôle dans A ; Paul
# administre la plateforme et crée dans A.
PIA = Identity(EMETTEUR, "pia", None, None, (PLATEFORME,))
PAUL = Identity(EMETTEUR, "paul", None, None, (PLATEFORME, "createurs"))


@pytest.fixture
def espaces(magasin: SpaceStore) -> Spaces:
    for personne in (ALICE, BOB, CHLOE, PIA, PAUL):
        magasin.record_login(personne, INSTANT)
    for espace in ("a", "b"):
        magasin.create_space(
            espace, espace.upper(), ATLAS, groupe(f"equipe-{espace}"), ACTEUR, INSTANT
        )
    magasin.set_binding("a", ref(BOB), Role.CREATOR, ACTEUR, plus(1))
    magasin.set_binding("a", ref(CHLOE), Role.READER, ACTEUR, plus(1))
    magasin.set_binding("a", groupe("createurs"), Role.CREATOR, ACTEUR, plus(1))
    magasin.set_binding("b", ref(BOB), Role.ADMIN, ACTEUR, plus(1))
    return Spaces.database(magasin, ATLAS, PLATEFORME, lambda: plus(10))


def acces(espaces: Spaces, qui: Identity, espace: str = "a") -> Access:
    trouve = espaces.access(qui, espace)
    assert trouve is not None
    return trouve


def visibles(espaces: Spaces, qui: Identity) -> dict[str, Access]:
    return {a.space.id: a for a in espaces.visible(qui)}


# --- Environnements de l'espace (V1, V7) ---------------------------------------------------


def test_environnements_dans_l_ordre_pour_chaque_acces(espaces: Spaces) -> None:
    for qui in (ALICE, BOB, CHLOE, PIA, PAUL):
        for trouve in espaces.visible(qui):
            assert trouve.environments == ENVIRONMENTS
        assert acces(espaces, qui).environments == ENVIRONMENTS


# --- Droit de déployer selon le rôle et l'accord (V3, V4) ----------------------------------


def test_membre_createur_avec_accords(espaces: Spaces) -> None:
    espaces.grant(ALICE, "a", DEV, ref(BOB))
    espaces.grant(ALICE, "a", PROD, groupe("createurs"))
    assert acces(espaces, BOB).deploy == {DEV}
    assert acces(espaces, PAUL).deploy == {PROD}
    bob_par_groupe = Identity(EMETTEUR, "bob", None, None, ("createurs",))
    assert acces(espaces, bob_par_groupe).deploy == {DEV, PROD}


def test_administrateur_sans_accord_ne_deploie_pas(espaces: Spaces) -> None:
    espaces.grant(ALICE, "a", DEV, ref(BOB))
    trouve = acces(espaces, ALICE)
    assert trouve.role == Role.ADMIN and trouve.manages
    assert trouve.deploy == RIEN
    # Il peut s'en accorder un (V4), et le journal le montre.
    espaces.grant(ALICE, "a", PROD, ref(ALICE))
    assert acces(espaces, ALICE).deploy == {PROD}
    [dernier, *_] = espaces.events("a")
    assert dernier.action == "deploy_granted" and dernier.actor == ref(ALICE)
    assert dernier.at == plus(10)


def test_administration_de_la_plateforme_seule_ne_deploie_pas(espaces: Spaces) -> None:
    # Elle gère les accords, y compris pour elle-même, sans pouvoir déployer (V4).
    for env in ENVIRONMENTS:
        espaces.grant(PIA, "a", env, ref(PIA))
        espaces.grant(PIA, "a", env, groupe(PLATEFORME))
    trouve = acces(espaces, PIA)
    assert (trouve.role, trouve.platform_admin, trouve.deploy) == (None, True, RIEN)
    vus = visibles(espaces, PIA)
    assert set(vus) == {"a", "b"}
    assert all(a.deploy == RIEN for a in vus.values())


def test_administration_de_la_plateforme_avec_un_role_createur(espaces: Spaces) -> None:
    espaces.grant(PIA, "a", TEST, ref(PAUL))
    trouve = acces(espaces, PAUL)
    assert (trouve.role, trouve.platform_admin, trouve.deploy) == (
        Role.CREATOR,
        True,
        frozenset({TEST}),
    )
    vus = visibles(espaces, PAUL)
    assert (vus["a"].deploy, vus["b"].deploy) == (frozenset({TEST}), RIEN)
    assert vus["b"].role is None


def test_lecteur_avec_accord_ne_deploie_pas(espaces: Spaces) -> None:
    for env in ENVIRONMENTS:
        espaces.grant(ALICE, "a", env, ref(CHLOE))
    trouve = acces(espaces, CHLOE)
    assert (trouve.role, trouve.deploy) == (Role.READER, RIEN)
    assert visibles(espaces, CHLOE)["a"].deploy == RIEN


def test_meme_sujet_chez_un_autre_emetteur(espaces: Spaces) -> None:
    espaces.grant(ALICE, "a", DEV, ref(BOB))
    bob_ailleurs = Identity("https://autre.example.invalid", "bob", None, None, ("equipe-a",))
    # Administrateur de A par son groupe, mais l'accord désigne Bob chez l'autre émetteur.
    assert acces(espaces, bob_ailleurs).deploy == RIEN
    espaces.grant(ALICE, "a", PROD, ref(ALICE))
    assert espaces.access(ALICE_AILLEURS, "a") is None


def test_isolation_de_deux_espaces(espaces: Spaces) -> None:
    # Bob crée dans A et administre B ; ses accords de A ne valent pas dans B.
    espaces.grant(ALICE, "a", DEV, ref(BOB))
    espaces.grant(BOB, "b", PROD, ref(BOB))
    vus = visibles(espaces, BOB)
    assert (vus["a"].deploy, vus["b"].deploy) == (frozenset({DEV}), frozenset({PROD}))
    assert acces(espaces, BOB, "a").deploy == {DEV}
    assert acces(espaces, BOB, "b").deploy == {PROD}
    # Un accord dans un espace où la session n'est pas membre ne l'y fait pas entrer.
    espaces.grant(ALICE, "a", DEV, ref(CHLOE))
    espaces.grant(BOB, "b", DEV, ref(CHLOE))
    assert espaces.access(CHLOE, "b") is None
    assert set(visibles(espaces, CHLOE)) == {"a"}


def test_acces_et_liste_concordent(espaces: Spaces) -> None:
    espaces.grant(ALICE, "a", DEV, groupe("createurs"))
    espaces.grant(ALICE, "a", TEST, ref(BOB))
    espaces.grant(BOB, "b", PROD, groupe(PLATEFORME))
    for qui in (ALICE, BOB, CHLOE, PIA, PAUL):
        for trouve in espaces.visible(qui):
            assert espaces.access(qui, trouve.space.id) == trouve


# --- Recalcul à chaque appel (V7) ----------------------------------------------------------


def test_revocation_effective_a_l_appel_suivant(espaces: Spaces) -> None:
    accorde = espaces.grant(ALICE, "a", PROD, ref(BOB))
    assert acces(espaces, BOB).deploy == {PROD}
    espaces.revoke(ALICE, "a", accorde.id)
    assert acces(espaces, BOB).deploy == RIEN
    assert visibles(espaces, BOB)["a"].deploy == RIEN
    assert espaces.grants("a") == []


def test_role_abaisse_puis_rendu(espaces: Spaces, magasin: SpaceStore) -> None:
    # L'accord survit à la liaison (V5) ; son effet suit le rôle à chaque appel.
    espaces.grant(ALICE, "a", TEST, ref(BOB))
    espaces.set_binding(ALICE, "a", ref(BOB), Role.READER)
    assert acces(espaces, BOB).deploy == RIEN
    [liaison] = [b for b in espaces.bindings("a") if b.principal == ref(BOB)]
    espaces.remove_binding(ALICE, "a", liaison.id)
    assert espaces.access(BOB, "a") is None
    assert len(espaces.grants("a")) == 1
    espaces.set_binding(ALICE, "a", ref(BOB), Role.CREATOR)
    assert acces(espaces, BOB).deploy == {TEST}


def test_groupe_perdu_a_la_session_suivante(espaces: Spaces) -> None:
    espaces.grant(ALICE, "a", DEV, groupe("deployeurs"))
    avec = Identity(EMETTEUR, "bob", None, None, ("deployeurs",))
    sans = Identity(EMETTEUR, "bob", None, None, ())
    assert acces(espaces, avec).deploy == {DEV}
    assert acces(espaces, sans).deploy == RIEN


# --- Lectures groupées ---------------------------------------------------------------------


def test_lectures_independantes_du_nombre_d_espaces(espaces: Spaces, migre: Engine) -> None:
    """Environnements et accords se lisent en deux requêtes pour toute la liste."""

    def requetes() -> int:
        compte: list[Any] = []

        def noter(*_: Any) -> None:
            compte.append(1)

        moteur = migre
        event.listen(moteur, "before_cursor_execute", noter)
        try:
            espaces.visible(PIA)
        finally:
            event.remove(moteur, "before_cursor_execute", noter)
        return len(compte)

    avant = requetes()
    for i in range(6):
        espaces.create(PIA, f"autre-{i}", f"Autre {i}", groupe("equipe-a"))
        espaces.grant(PIA, f"autre-{i}", PROD, ref(PIA))
    apres = requetes()
    assert len(espaces.visible(PIA)) == 8
    assert apres == avant


@pytest.fixture
def sans_espaces(magasin: SpaceStore) -> Iterator[Spaces]:
    yield Spaces.database(magasin, ATLAS, PLATEFORME, lambda: INSTANT)


def test_aucun_espace(sans_espaces: Spaces) -> None:
    assert sans_espaces.visible(PIA) == []
    assert sans_espaces.visible(ALICE) == []
    assert sans_espaces.visible(None) == []
    assert sans_espaces.access(PIA, "a") is None


# --- Mode local (V8) -----------------------------------------------------------------------


def test_mode_local_deploie_partout() -> None:
    espaces = Spaces.local(ATLAS, lambda: INSTANT)
    trouve = espaces.access(None, LOCAL_SPACE)
    assert trouve is not None
    assert trouve.implicit and trouve.role == Role.ADMIN
    assert trouve.environments == ENVIRONMENTS
    assert trouve.deploy == frozenset(ENVIRONMENTS)
    assert espaces.visible(ALICE) == [trouve]
    assert espaces.access(ALICE, "autre") is None


def test_mode_local_accords_non_geres() -> None:
    espaces = Spaces.local(ATLAS, lambda: INSTANT)
    for qui in (None, ALICE):
        with pytest.raises(LocalMode) as refus:
            espaces.grant(qui, LOCAL_SPACE, DEV, ref(ALICE))
        assert refus.value.code == "local_mode"
        with pytest.raises(LocalMode):
            espaces.revoke(qui, LOCAL_SPACE, "un-accord")
    with pytest.raises(LocalMode):
        espaces.grants(LOCAL_SPACE)


def test_ecriture_sans_session_refusee_en_base(espaces: Spaces) -> None:
    # Sans session, pas d'auteur à journaliser : l'écriture est refusée, rien n'est posé.
    with pytest.raises(LocalMode):
        espaces.grant(None, "a", DEV, ref(BOB))
    with pytest.raises(LocalMode):
        espaces.revoke(None, "a", "un-accord")
    assert espaces.grants("a") == []


def test_auteur_de_l_accord_est_la_session(espaces: Spaces) -> None:
    accorde = espaces.grant(BOB, "b", DEV, groupe("deployeurs"))
    assert (accorde.created_by, accorde.created_at, accorde.space_id) == (ref(BOB), plus(10), "b")
    espaces.revoke(BOB, "b", accorde.id)
    [dernier, *_] = espaces.events("b")
    assert (dernier.action, dernier.actor) == ("deploy_revoked", ref(BOB))
