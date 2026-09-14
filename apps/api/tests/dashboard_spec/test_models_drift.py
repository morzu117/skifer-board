"""Drift check: the committed Pydantic models equal a fresh datamodel-code-generator run.

Regenerate from the repository root with the command recorded in the header of `models.py`,
writing its standard output to the file:

    uv run datamodel-codegen <arguments of COMMAND below> \
        > apps/api/src/skifer_board/dashboard_spec/models.py
"""

import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
MODELS_PATH = REPO_ROOT / "apps" / "api" / "src" / "skifer_board" / "dashboard_spec" / "models.py"
COMMAND = [
    "datamodel-codegen",
    "--input",
    "packages/dashboard-spec/schema/dashboard.v1.json",
    "--input-file-type",
    "jsonschema",
    "--output-model-type",
    "pydantic_v2.BaseModel",
    "--target-python-version",
    "3.12",
    "--use-standard-collections",
    "--use-union-operator",
    "--use-annotated",
    "--field-constraints",
    "--enum-field-as-literal",
    "all",
    "--use-double-quotes",
    "--disable-timestamp",
    "--enable-command-header",
    "--formatters",
    "ruff-format",
    "ruff-check",
]


def _lf(content: bytes) -> bytes:
    return content.replace(b"\r\n", b"\n")


def test_models_header_documents_the_command() -> None:
    header = MODELS_PATH.read_text(encoding="utf-8").splitlines()[:3]
    assert header[2] == "#   command:   " + " ".join(COMMAND)


def test_committed_models_match_generator_output(tmp_path: Path) -> None:
    executable = shutil.which(COMMAND[0], path=str(Path(sys.executable).parent))
    assert executable is not None
    result = subprocess.run(
        [executable, *COMMAND[1:]], cwd=REPO_ROOT, capture_output=True, check=True
    )
    generated = tmp_path / "models.py"
    generated.write_bytes(result.stdout)
    assert _lf(generated.read_bytes()) == _lf(MODELS_PATH.read_bytes())
