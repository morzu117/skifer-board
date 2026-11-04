"""Authorization Code, PKCE et refus fermés du parcours (I1)."""

import base64
import hashlib
from datetime import timedelta
from typing import Any
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit

import pytest
from skifer_board.identity import OidcConfig, ProviderError, ProviderKeys
from skifer_board.identity.flow import LoginFlow, LoginRefusal
from skifer_board.identity.model import Identity

from identity.conftest import Cles, Fournisseur, Horloge


@pytest.fixture
def parcours(
    config: OidcConfig, trousse: ProviderKeys, fournisseur: Fournisseur, horloge: Horloge
) -> LoginFlow:
    return LoginFlow(config, trousse, fournisseur, horloge)


def parametres(url: str) -> dict[str, str]:
    return {cle: valeurs[0] for cle, valeurs in parse_qs(urlsplit(url).query).items()}


@pytest.mark.parametrize("requete", ["", "?tenant=exemple"])
def test_autorisation_et_echange_exacts(
    parcours: LoginFlow,
    fournisseur: Fournisseur,
    config: OidcConfig,
    cles: Cles,
    claims: dict[str, Any],
    requete: str,
) -> None:
    fournisseur.document["authorization_endpoint"] += requete
    debut = parcours.start()
    params = parametres(debut.redirect_url)
    fournisseur.reponse = {
        "id_token": cles.signer({**claims, "nonce": params["nonce"]}),
        "access_token": "acces-secret",
        "refresh_token": "refresh-secret",
    }
    resultat = parcours.finish({"state": params["state"], "code": "code-factice"}, debut.binding)
    assert resultat == Identity(
        config.issuer, claims["sub"], claims["name"], claims["email"], tuple(claims["groups"])
    )
    assert len(fournisseur.formulaires) == 1
    url, formulaire = fournisseur.formulaires[0]
    assert url == fournisseur.document["token_endpoint"]
    verifier = formulaire["code_verifier"]
    assert len(verifier) >= 43
    assert formulaire == {
        "grant_type": "authorization_code",
        "code": "code-factice",
        "redirect_uri": config.redirect_uri,
        "client_id": config.client_id,
        "client_secret": config.client_secret,
        "code_verifier": verifier,
    }
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    )
    assert params == {
        **({"tenant": "exemple"} if requete else {}),
        "response_type": "code",
        "client_id": config.client_id,
        "redirect_uri": config.redirect_uri,
        "scope": "openid profile email",
        "state": params["state"],
        "nonce": params["nonce"],
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    assert len({params["state"], params["nonce"], verifier, debut.binding}) == 4
    assert debut.redirect_url.startswith(
        fournisseur.document["authorization_endpoint"] + ("&" if requete else "?")
    )
    assert parcours.pending_count() == 0
    assert (
        parcours.finish({"state": params["state"], "code": "code-factice"}, debut.binding)
        == LoginRefusal.INVALID_STATE
    )


@pytest.mark.parametrize(
    "cas,attendu",
    [
        ("absent", "invalid_state"),
        ("inconnu", "invalid_state"),
        ("cookie_absent", "invalid_state"),
        ("cookie_different", "invalid_state"),
        ("expire", "invalid_state"),
        ("annule", "login_cancelled"),
        ("sans_code", "code_rejected"),
        ("erreur", "code_rejected"),
        ("sans_jeton", "code_rejected"),
        ("jeton_nombre", "code_rejected"),
        ("echange_indisponible", "provider_unavailable"),
        ("decouverte_indisponible", "provider_unavailable"),
        ("nonce", "token_refused"),
        ("jeton_expire", "token_refused"),
    ],
)
def test_refus_et_usage_unique(
    parcours: LoginFlow,
    fournisseur: Fournisseur,
    trousse: ProviderKeys,
    horloge: Horloge,
    cles: Cles,
    claims: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    cas: str,
    attendu: str,
) -> None:
    debut = parcours.start()
    state = parametres(debut.redirect_url)["state"]
    params = {"state": state, "code": "code-factice"}
    liaison: str | None = debut.binding
    fournisseur.reponse = {}
    if cas == "absent":
        del params["state"]
    elif cas == "inconnu":
        params["state"] = "inconnu"
    elif cas == "cookie_absent":
        liaison = None
    elif cas == "cookie_different":
        liaison = "autre"
    elif cas == "expire":
        horloge.instant += timedelta(minutes=10)
    elif cas == "annule":
        params["error"] = "access_denied"
    elif cas == "sans_code":
        del params["code"]
    elif cas == "erreur":
        fournisseur.reponse = {"error": "invalid_grant", "id_token": "ignore"}
    elif cas == "jeton_nombre":
        fournisseur.reponse = {"id_token": 42}
    elif cas == "echange_indisponible":
        fournisseur.erreur_echange = ProviderError("indisponible")
    elif cas == "decouverte_indisponible":
        monkeypatch.setattr(trousse, "metadata", Mock(side_effect=ProviderError("indisponible")))
    elif cas in ("nonce", "jeton_expire"):
        claims["nonce"] = "mauvais" if cas == "nonce" else parametres(debut.redirect_url)["nonce"]
        if cas == "jeton_expire":
            claims["exp"] = horloge().timestamp()
        fournisseur.reponse = {"id_token": cles.signer(claims)}
    assert parcours.finish(params, liaison) == LoginRefusal(attendu)
    if cas not in ("absent", "inconnu"):
        assert parcours.pending_count() == 0
        assert (
            parcours.finish({"state": state, "code": "valide"}, debut.binding)
            == LoginRefusal.INVALID_STATE
        )


def test_purge_des_demandes_a_dix_minutes(parcours: LoginFlow, horloge: Horloge) -> None:
    ancien = parcours.start()
    horloge.instant += timedelta(minutes=10, microseconds=-1)
    recent = parcours.start()
    assert parcours.pending_count() == 2
    horloge.instant += timedelta(microseconds=1)
    parcours.start()
    assert parcours.pending_count() == 2
    assert (
        parcours.finish({"state": parametres(ancien.redirect_url)["state"]}, ancien.binding)
        == LoginRefusal.INVALID_STATE
    )
    assert (
        parcours.finish({"state": parametres(recent.redirect_url)["state"]}, recent.binding)
        == LoginRefusal.CODE_REJECTED
    )
