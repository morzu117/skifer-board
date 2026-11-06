"""Parcours nominal des routes des analyses sur un vrai serveur (plan 18.2)."""

from __future__ import annotations

from spaces.monde import CREATEUR_GROUPE

from .serveur import CHEMIN, Banc


def test_creation_puis_lecture(banc: Banc) -> None:
    identifiant = banc.creer_ok(CREATEUR_GROUPE)
    lu = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{identifiant}")
    assert lu.status_code == 200, lu.text
    assert lu.json()["revision"] == 1
