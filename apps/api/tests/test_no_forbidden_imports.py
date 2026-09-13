"""Guard: skifer-board never depends on skifer or pyspark from its own code."""

import ast
from pathlib import Path

FORBIDDEN_TOP_LEVEL_MODULES = {"pyspark", "skifer"}

SRC_ROOT = Path(__file__).resolve().parents[1] / "src"


def find_forbidden_imports(source: str, forbidden: set[str]) -> list[str]:
    """Return the forbidden top-level module names imported by `source`."""
    tree = ast.parse(source)
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                top_level = alias.name.split(".")[0]
                if top_level in forbidden:
                    found.add(top_level)
        elif isinstance(node, ast.ImportFrom):
            if node.module is None:
                continue
            top_level = node.module.split(".")[0]
            if top_level in forbidden:
                found.add(top_level)
    return sorted(found)


def test_detector_flags_plain_import() -> None:
    source = "import skifer\n"
    assert find_forbidden_imports(source, FORBIDDEN_TOP_LEVEL_MODULES) == ["skifer"]


def test_detector_flags_from_import() -> None:
    source = "from skifer.x import y\n"
    assert find_forbidden_imports(source, FORBIDDEN_TOP_LEVEL_MODULES) == ["skifer"]


def test_detector_flags_pyspark_submodule_import() -> None:
    source = "import pyspark.sql\n"
    assert find_forbidden_imports(source, FORBIDDEN_TOP_LEVEL_MODULES) == ["pyspark"]


def test_detector_allows_skifer_board() -> None:
    source = "import skifer_board\n"
    assert find_forbidden_imports(source, FORBIDDEN_TOP_LEVEL_MODULES) == []


def test_no_forbidden_imports_in_source_tree() -> None:
    violations: dict[str, list[str]] = {}
    for path in SRC_ROOT.rglob("*.py"):
        source = path.read_text(encoding="utf-8")
        forbidden = find_forbidden_imports(source, FORBIDDEN_TOP_LEVEL_MODULES)
        if forbidden:
            violations[str(path)] = forbidden
    assert violations == {}
