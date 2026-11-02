"""Auteurs nommés des liaisons et du journal (plan 08, 8.4).

Les liaisons portent `created_by_person`, et chaque événement du journal `actor_person` et
`principal_person` (la personne visée par une liaison) : le nom et l'adresse que Board connaît
de la personne (E5), ou `null` si Board ne la connaît pas ou si l'événement ne vise pas une
personne. La référence (émetteur et sujet) reste la seule identité : le nom ne fait
qu'accompagner.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from skifer_board.identity.model import Identity
from skifer_board.spaces import GroupPrincipal, PersonRef, Role
from skifer_board.state.schema import people, space_events
from state.conftest import migre as migre

from spaces.monde import (
    ADMIN_GROUPE,
    ADMIN_PERSONNE,
    EMETTEUR,
    INVITEE,
    LECTEUR_PERSONNE,
    PLATEFORME_SEULE,
    A,
    Monde,
    Profil,
)
from spaces.monde import config_plateforme as config_plateforme
from spaces.monde import monde as monde

AUTRE_EMETTEUR = "https://autre.example.invalid"
FANTOME = PersonRef(EMETTEUR, "fantome")
CLES_LIAISON = {
    "id",
    "principal",
    "person",
    "role",
    "created_at",
    "created_by",
    "created_by_person",
}
CLES_EVENEMENT = {"id", "at", "actor", "actor_person", "action", "detail", "principal_person"}


def nomme(profil: Profil) -> dict[str, str]:
    return {"name": f"Nom {profil.sujet}", "email": f"{profil.sujet}@example.invalid"}


def membres(monde: Monde, profil: Profil = ADMIN_GROUPE) -> list[dict[str, Any]]:
    reponse = monde.requete(profil, "GET", f"/api/spaces/{A}/members")
    assert reponse.status_code == 200
    resultat: list[dict[str, Any]] = reponse.json()["members"]
    return resultat


def journal(monde: Monde, profil: Profil = ADMIN_GROUPE) -> list[dict[str, Any]]:
    reponse = monde.requete(profil, "GET", f"/api/spaces/{A}/events")
    assert reponse.status_code == 200
    resultat: list[dict[str, Any]] = reponse.json()["events"]
    return resultat


def par_principal(liste: list[dict[str, Any]], principal: dict[str, str]) -> dict[str, Any]:
    [trouvee] = [liaison for liaison in liste if liaison["principal"] == principal]
    return trouvee


def test_chaque_liaison_nomme_son_auteur_connu(monde: Monde) -> None:
    liste = membres(monde)
    assert liste
    for liaison in liste:
        assert set(liaison) == CLES_LIAISON
        # Toutes les liaisons du monde ont été posées par Pia, personne connue.
        assert liaison["created_by"] == {"issuer": EMETTEUR, "subject": PLATEFORME_SEULE.sujet}
        assert liaison["created_by_person"] == nomme(PLATEFORME_SEULE)
        if liaison["principal"]["kind"] == "group":
            assert liaison["person"] is None


def test_chaque_evenement_nomme_son_acteur_connu(monde: Monde) -> None:
    evenements = journal(monde)
    assert evenements
    for evenement in evenements:
        assert set(evenement) == CLES_EVENEMENT
        assert evenement["actor_person"] == nomme(PLATEFORME_SEULE)


def test_auteur_inconnu_de_board_donne_null(monde: Monde) -> None:
    instant = monde.horloge() + timedelta(minutes=1)
    monde.magasin.set_binding(A, GroupPrincipal("par-un-fantome"), Role.READER, FANTOME, instant)
    liaison = par_principal(membres(monde), {"kind": "group", "name": "par-un-fantome"})
    assert liaison["created_by"] == {"issuer": EMETTEUR, "subject": "fantome"}
    assert liaison["created_by_person"] is None
    [dernier, *_] = journal(monde)
    assert dernier["action"] == "binding_added"
    assert dernier["actor"] == {"issuer": EMETTEUR, "subject": "fantome"}
    assert dernier["actor_person"] is None
    # Les autres auteurs, connus, restent nommés dans la même réponse.
    assert all(e["actor_person"] == nomme(PLATEFORME_SEULE) for e in journal(monde)[1:])


def test_meme_sujet_chez_un_autre_emetteur_n_est_pas_la_personne_connue(monde: Monde) -> None:
    # Sujet « pia », connu chez EMETTEUR, inconnu chez un autre émetteur (E3).
    ailleurs = PersonRef(AUTRE_EMETTEUR, PLATEFORME_SEULE.sujet)
    instant = monde.horloge() + timedelta(minutes=1)
    monde.magasin.set_binding(A, GroupPrincipal("homonyme"), Role.READER, ailleurs, instant)
    liaison = par_principal(membres(monde), {"kind": "group", "name": "homonyme"})
    assert liaison["created_by"] == {"issuer": AUTRE_EMETTEUR, "subject": PLATEFORME_SEULE.sujet}
    assert liaison["created_by_person"] is None
    assert journal(monde)[0]["actor_person"] is None


def test_auteur_qui_est_aussi_le_principal(monde: Monde) -> None:
    # Pia, administratrice de la plateforme, se lie elle-même : la même personne est le principal
    # et l'auteur, et les deux champs la nomment.
    soi = {"kind": "person", "issuer": EMETTEUR, "subject": PLATEFORME_SEULE.sujet}
    reponse = monde.requete(
        PLATEFORME_SEULE,
        "POST",
        f"/api/spaces/{A}/members",
        corps={"principal": soi, "role": "reader"},
    )
    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["person"] == nomme(PLATEFORME_SEULE)
    assert corps["created_by_person"] == nomme(PLATEFORME_SEULE)
    liaison = par_principal(membres(monde), soi)
    assert liaison["person"] == liaison["created_by_person"] == nomme(PLATEFORME_SEULE)


def test_auteur_et_principal_inconnus_de_board(monde: Monde) -> None:
    # Liaison posée par le magasin pour une personne qui n'est plus connue ; elle se nomme
    # elle-même comme auteur. Les deux restent `null`, aucun ne prend le nom d'un autre.
    instant = monde.horloge() + timedelta(minutes=1)
    monde.magasin.record_login(
        Identity(EMETTEUR, "fantome", "Fantôme", "f@example.invalid", ()), instant
    )
    monde.magasin.set_binding(A, FANTOME, Role.READER, FANTOME, instant)
    with monde.moteur.begin() as connexion:
        connexion.execute(people.delete().where(people.c.subject == "fantome"))
    principal = {"kind": "person", "issuer": EMETTEUR, "subject": "fantome"}
    liaison = par_principal(membres(monde), principal)
    assert liaison["person"] is None
    assert liaison["created_by_person"] is None


def test_auteurs_distincts_dans_une_meme_liste(monde: Monde) -> None:
    # Axel (administrateur par personne) lie l'invitée ; Ada (par groupe) lie un groupe. Chaque
    # liaison nomme son propre auteur, sans mélange d'une ligne à l'autre.
    for profil, principal in (
        (ADMIN_PERSONNE, {"kind": "person", "issuer": EMETTEUR, "subject": INVITEE.sujet}),
        (ADMIN_GROUPE, {"kind": "group", "name": "finance-nouveaux"}),
    ):
        reponse = monde.requete(
            profil,
            "POST",
            f"/api/spaces/{A}/members",
            corps={"principal": principal, "role": "reader"},
        )
        assert reponse.status_code == 200
        assert reponse.json()["created_by_person"] == nomme(profil)
    liste = membres(monde)
    invitee = par_principal(liste, {"kind": "person", "issuer": EMETTEUR, "subject": INVITEE.sujet})
    assert invitee["person"] == nomme(INVITEE)
    assert invitee["created_by_person"] == nomme(ADMIN_PERSONNE)
    groupe = par_principal(liste, {"kind": "group", "name": "finance-nouveaux"})
    assert groupe["created_by_person"] == nomme(ADMIN_GROUPE)
    acteurs = [e["actor_person"] for e in journal(monde)[:2]]
    assert acteurs == [nomme(ADMIN_GROUPE), nomme(ADMIN_PERSONNE)]


def test_changement_de_role_garde_l_auteur_d_origine(monde: Monde) -> None:
    # Ada change le rôle d'une liaison posée par Pia : la liaison garde son auteur, le journal
    # nomme Ada.
    principal = {"kind": "group", "name": "finance-lecteurs"}
    reponse = monde.requete(
        ADMIN_GROUPE,
        "POST",
        f"/api/spaces/{A}/members",
        corps={"principal": principal, "role": "creator"},
    )
    assert reponse.status_code == 200
    assert reponse.json()["created_by_person"] == nomme(PLATEFORME_SEULE)
    assert par_principal(membres(monde), principal)["created_by_person"] == nomme(PLATEFORME_SEULE)
    assert journal(monde)[0]["actor_person"] == nomme(ADMIN_GROUPE)


def test_personne_sans_nom_ni_adresse(monde: Monde) -> None:
    instant = monde.horloge() + timedelta(minutes=1)
    muet = Identity(EMETTEUR, "muet", None, None, ("groupe-du-muet",))
    monde.magasin.record_login(muet, instant)
    monde.magasin.set_binding(
        A, GroupPrincipal("par-le-muet"), Role.READER, PersonRef(EMETTEUR, "muet"), instant
    )
    liaison = par_principal(membres(monde), {"kind": "group", "name": "par-le-muet"})
    # Connue, sans nom ni adresse : un objet aux deux champs nuls, distinct de `null`.
    assert liaison["created_by_person"] == {"name": None, "email": None}
    assert journal(monde)[0]["actor_person"] == {"name": None, "email": None}


def test_nom_relu_a_chaque_requete(monde: Monde) -> None:
    assert journal(monde)[0]["actor_person"] == nomme(PLATEFORME_SEULE)
    # Pia se reconnecte sous un autre nom : la réponse suivante le dit, rien n'est gardé en cache.
    nouvelle = Identity(
        EMETTEUR, PLATEFORME_SEULE.sujet, "Pia Renommée", "pia.r@example.invalid", ()
    )
    monde.magasin.record_login(nouvelle, monde.horloge() + timedelta(minutes=5))
    attendu = {"name": "Pia Renommée", "email": "pia.r@example.invalid"}
    assert journal(monde)[0]["actor_person"] == attendu
    assert all(liaison["created_by_person"] == attendu for liaison in membres(monde))


def test_ni_groupes_ni_autres_champs_de_la_personne(monde: Monde) -> None:
    # L'invitée porte un groupe secret ; elle pose une liaison après être devenue administratrice.
    monde.magasin.set_binding(
        A,
        PersonRef(EMETTEUR, INVITEE.sujet),
        Role.ADMIN,
        PLATEFORME_SEULE.ref,
        monde.horloge(),
    )
    reponse = monde.requete(
        INVITEE,
        "POST",
        f"/api/spaces/{A}/members",
        corps={"principal": {"kind": "group", "name": "finance-x"}, "role": "reader"},
    )
    assert reponse.status_code == 200
    assert set(reponse.json()["created_by_person"]) == {"name", "email"}
    for chemin in (f"/api/spaces/{A}/members", f"/api/spaces/{A}/events"):
        lu = monde.requete(ADMIN_GROUPE, "GET", chemin)
        assert "groupe-secret" not in lu.text
        assert "last_login" not in lu.text


# --- Personne visée par un événement de liaison : `principal_person`.


def personne(profil: Profil) -> dict[str, str]:
    return {"kind": "person", "issuer": EMETTEUR, "subject": profil.sujet}


def inscrire(monde: Monde, action: str, detail: object) -> None:
    """Événement écrit tel quel dans le journal, comme un détail que Board n'écrit pas lui-même."""
    with monde.moteur.begin() as connexion:
        connexion.execute(
            space_events.insert().values(
                space_id=A,
                at=monde.horloge() + timedelta(minutes=1),
                actor_issuer=EMETTEUR,
                actor_subject=PLATEFORME_SEULE.sujet,
                action=action,
                detail=detail,
            )
        )


def test_principal_person_seulement_pour_une_personne_visee(monde: Monde) -> None:
    for evenement in journal(monde):
        principal = evenement["detail"].get("principal")
        if evenement["action"] == "space_created" or principal["kind"] == "group":
            assert evenement["principal_person"] is None
        else:
            # Toutes les personnes liées du monde sont connues de Board.
            assert principal["kind"] == "person"
            assert set(evenement["principal_person"]) == {"name", "email"}
    [creation] = [e for e in journal(monde) if e["action"] == "space_created"]
    assert creation["principal_person"] is None


def test_principal_person_d_une_personne_ajoutee(monde: Monde) -> None:
    reponse = monde.requete(
        ADMIN_GROUPE,
        "POST",
        f"/api/spaces/{A}/members",
        corps={"principal": personne(INVITEE), "role": "reader"},
    )
    assert reponse.status_code == 200
    [dernier, *_] = journal(monde)
    assert dernier["action"] == "binding_added"
    assert dernier["principal_person"] == nomme(INVITEE)
    # L'acteur et la personne visée sont deux personnes distinctes, chacune à sa place.
    assert dernier["actor_person"] == nomme(ADMIN_GROUPE)


def test_principal_person_d_un_changement_de_role(monde: Monde) -> None:
    reponse = monde.requete(
        ADMIN_GROUPE,
        "POST",
        f"/api/spaces/{A}/members",
        corps={"principal": personne(LECTEUR_PERSONNE), "role": "creator"},
    )
    assert reponse.status_code == 200
    [dernier, *_] = journal(monde)
    assert dernier["action"] == "binding_changed"
    assert dernier["principal_person"] == nomme(LECTEUR_PERSONNE)


def test_une_personne_retiree_reste_nommee(monde: Monde) -> None:
    reponse = monde.requete(
        ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/members/{monde.liaisons['a-luc']}"
    )
    assert reponse.status_code == 204
    assert all(liaison["principal"] != personne(LECTEUR_PERSONNE) for liaison in membres(monde))
    [retrait, *_] = journal(monde)
    assert retrait["action"] == "binding_removed"
    assert retrait["detail"]["principal"] == personne(LECTEUR_PERSONNE)
    assert retrait["principal_person"] == nomme(LECTEUR_PERSONNE)
    # L'ajout d'origine, plus ancien, la nomme aussi.
    ajouts = [
        e
        for e in journal(monde)
        if e["action"] == "binding_added" and e["detail"]["principal"] == personne(LECTEUR_PERSONNE)
    ]
    assert [e["principal_person"] for e in ajouts] == [nomme(LECTEUR_PERSONNE)]


def test_principal_person_d_un_groupe_est_null(monde: Monde) -> None:
    reponse = monde.requete(
        ADMIN_GROUPE,
        "POST",
        f"/api/spaces/{A}/members",
        corps={"principal": {"kind": "group", "name": INVITEE.sujet}, "role": "reader"},
    )
    assert reponse.status_code == 200
    # Un groupe qui porte le sujet d'une personne connue n'est pas cette personne (E3).
    assert journal(monde)[0]["principal_person"] is None


def test_principal_person_d_une_personne_inconnue_est_null(monde: Monde) -> None:
    # Le magasin refuse de lier une personne inconnue : elle est connue à l'ajout, puis oubliée.
    instant = monde.horloge() + timedelta(minutes=1)
    monde.magasin.record_login(Identity(EMETTEUR, "fantome", "Fantôme", None, ()), instant)
    monde.magasin.set_binding(A, FANTOME, Role.READER, PLATEFORME_SEULE.ref, instant)
    with monde.moteur.begin() as connexion:
        connexion.execute(people.delete().where(people.c.subject == "fantome"))
    [dernier, *_] = journal(monde)
    assert dernier["detail"]["principal"] == {
        "kind": "person",
        "issuer": EMETTEUR,
        "subject": "fantome",
    }
    assert dernier["principal_person"] is None
    assert dernier["actor_person"] == nomme(PLATEFORME_SEULE)


def test_principal_person_meme_sujet_autre_emetteur(monde: Monde) -> None:
    # Même sujet que Luc, chez un autre émetteur : une autre personne, nommée pour elle-même (E3).
    instant = monde.horloge() + timedelta(minutes=1)
    autre = Identity(AUTRE_EMETTEUR, LECTEUR_PERSONNE.sujet, "Autre Luc", None, ())
    monde.magasin.record_login(autre, instant)
    ailleurs = PersonRef(AUTRE_EMETTEUR, LECTEUR_PERSONNE.sujet)
    monde.magasin.set_binding(A, ailleurs, Role.READER, PLATEFORME_SEULE.ref, instant)
    assert journal(monde)[0]["principal_person"] == {"name": "Autre Luc", "email": None}


def test_principal_person_oublie_de_board_est_null(monde: Monde) -> None:
    # La personne était connue à l'ajout, puis oubliée : le nom n'est pas figé dans le journal.
    monde.magasin.set_binding(
        A, INVITEE.ref, Role.READER, PLATEFORME_SEULE.ref, monde.horloge() + timedelta(minutes=1)
    )
    assert journal(monde)[0]["principal_person"] == nomme(INVITEE)
    with monde.moteur.begin() as connexion:
        connexion.execute(people.delete().where(people.c.subject == INVITEE.sujet))
    assert journal(monde)[0]["principal_person"] is None


def test_principal_person_sans_nom_ni_adresse(monde: Monde) -> None:
    instant = monde.horloge() + timedelta(minutes=1)
    monde.magasin.record_login(Identity(EMETTEUR, "muet", None, None, ()), instant)
    monde.magasin.set_binding(
        A, PersonRef(EMETTEUR, "muet"), Role.READER, PLATEFORME_SEULE.ref, instant
    )
    assert journal(monde)[0]["principal_person"] == {"name": None, "email": None}


def test_principal_person_d_un_detail_sans_principal_est_null(monde: Monde) -> None:
    inscrire(monde, "binding_added", {"after": "reader"})
    [dernier, *_] = journal(monde)
    assert dernier["detail"] == {"after": "reader"}
    assert dernier["principal_person"] is None


@pytest.mark.parametrize(
    "principal",
    [
        "ines",
        None,
        ["person", EMETTEUR, "ines"],
        {"kind": "Person", "issuer": EMETTEUR, "subject": "ines"},
        {"kind": "person", "subject": "ines"},
        {"kind": "person", "issuer": EMETTEUR},
        {"kind": "person", "issuer": EMETTEUR, "subject": 7},
        {"kind": "person", "issuer": None, "subject": "ines"},
        {"issuer": EMETTEUR, "subject": "ines"},
    ],
)
def test_principal_mal_forme_dans_le_detail(monde: Monde, principal: object) -> None:
    # Le détail est rendu tel quel ; aucune personne n'est devinée, et la lecture ne tombe pas.
    inscrire(monde, "binding_added", {"principal": principal, "after": "reader"})
    [dernier, *_] = journal(monde)
    assert dernier["detail"] == {"principal": principal, "after": "reader"}
    assert dernier["principal_person"] is None
    assert dernier["actor_person"] == nomme(PLATEFORME_SEULE)


# Un détail de journal qui n'est pas un objet JSON (la colonne `detail` est un JSONB sans
# contrainte de type) est rendu tel quel, avec `principal_person` à `null`.
@pytest.mark.parametrize("detail", [["principal"], "texte", 7])
def test_detail_qui_n_est_pas_un_objet(monde: Monde, detail: object) -> None:
    inscrire(monde, "binding_added", detail)
    reponse = monde.requete(ADMIN_GROUPE, "GET", f"/api/spaces/{A}/events")
    assert reponse.status_code == 200
    [dernier, *_] = reponse.json()["events"]
    assert dernier["detail"] == detail
    assert dernier["principal_person"] is None
