"""La frontière Atlas ne préjuge pas de l'accès futur au moteur skifer (C2)."""

import ast
from pathlib import Path


def test_imports_de_board() -> None:
    """Seul catalog/atlas.py importe Atlas ; aucun module Board n'importe skifer."""
    racine = Path(__file__).resolve().parents[2] / "src" / "skifer_board"
    fichiers = sorted(racine.rglob("*.py"))
    assert fichiers, "Les sources Board doivent être présentes pour vérifier la frontière."
    violations: list[str] = []
    for fichier in fichiers:
        relatif = fichier.relative_to(racine)
        for noeud in ast.walk(ast.parse(fichier.read_text(), filename=str(fichier))):
            if not isinstance(noeud, (ast.Import, ast.ImportFrom)):
                continue
            modules: list[str] = []
            if isinstance(noeud, ast.Import):
                modules = [alias.name for alias in noeud.names]
            elif isinstance(noeud, ast.ImportFrom) and noeud.level == 0:
                modules = [noeud.module or ""]
            for module in modules:
                prefixe = module.split(".")[0]
                if prefixe == "skifer" or (
                    prefixe == "skifer_atlas" and relatif.as_posix() != "catalog/atlas.py"
                ):
                    violations.append(f"{relatif}:{noeud.lineno} importe {module}")
    assert not violations, "\n".join(violations)
