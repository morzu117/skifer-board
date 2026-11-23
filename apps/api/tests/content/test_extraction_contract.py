"""L'exemple partagé est produit par l'extraction serveur réelle."""

import json
from pathlib import Path

from skifer_board.content.composition import extract_template

EXAMPLE = (
    Path(__file__).resolve().parents[4]
    / "contracts/page_templates/extraction/dashboard-vers-modele.json"
)


def test_exemple_extraction_est_a_jour() -> None:
    example = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    components = {
        (entry["document"]["id"], entry["revision"]): entry["document"]
        for entry in example["components"]
    }
    assert (
        extract_template(example["dashboard"], example["template_id"], components)
        == example["expected"]
    )
