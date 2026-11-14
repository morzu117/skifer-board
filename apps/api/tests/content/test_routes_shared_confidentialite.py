"""Les contrats et les refus ne recopient pas de secrets ni de couleurs brutes."""

from __future__ import annotations

import copy
import logging
import re
from pathlib import Path
from typing import Any

from spaces.monde import CREATEUR_GROUPE, A

from .serveur import Banc
from .test_routes_shared_cycle import body

ROOT = Path(__file__).resolve().parents[4] / "contracts"
HEX = re.compile(r"#[0-9a-fA-F]{6}")
SQL = re.compile(r"\bSELECT\b.{0,100}\bFROM\b", re.IGNORECASE | re.DOTALL)
BEARER = re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]+", re.IGNORECASE)


def test_sentinelle_sur_les_contrats_produits() -> None:
    paths = [
        path
        for directory in ("themes", "page_templates", "components")
        for path in (ROOT / directory / "routes").glob("*.json")
    ]
    paths += [
        ROOT / "dashboards/routes/refus-reference-non-approuvee.json",
        ROOT / "dashboards/routes/lire-references-resolues.json",
        ROOT / "analyses/routes/refus-analyse-utilisee-par-composant.json",
    ]
    assert len(paths) >= 50
    for path in paths:
        raw = path.read_text(encoding="utf-8")
        assert not HEX.search(raw), path
        assert not SQL.search(raw), path
        assert not BEARER.search(raw), path


def test_valeurs_sensibles_ne_sont_ni_renvoyees_ni_journalisees(banc: Banc, caplog: Any) -> None:
    secret, sql, color = "Bearer eyJsecret.sentinel.sig", "SELECT secret FROM sentinel", "#a1b2c3"
    documents = []
    invalid = copy.deepcopy(body("themes", "clair.json"))
    invalid["roles"]["marks"]["series"] = color
    documents.append(invalid)
    documents.append({**body("themes", "clair.json"), "query": sql})
    documents.append({**body("themes", "clair.json"), "token": secret})
    caplog.set_level(logging.INFO)
    for document in documents:
        response = banc.appel(CREATEUR_GROUPE, "POST", f"/api/spaces/{A}/themes", json=document)
        assert response.status_code == 422
        for value in (secret, sql, color):
            assert value not in response.text
    for value in (secret, sql, color):
        assert value not in caplog.text
