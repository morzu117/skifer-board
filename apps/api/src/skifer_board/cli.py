"""Command-line entry point: `skifer-board validate <path>...`."""

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from skifer_board.dashboard_spec import validate_file

YAML_SUFFIXES = {".yaml", ".yml"}
EXIT_OK = 0
EXIT_ISSUES = 1
EXIT_USAGE = 2


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="skifer-board", description="skifer-board tools.")
    commands = parser.add_subparsers(dest="command", required=True, metavar="COMMAND")
    validate = commands.add_parser(
        "validate",
        help="validate Dashboard as YAML v1 files",
        description="Validate Dashboard as YAML v1 files. Prints one line per issue.",
    )
    validate.add_argument(
        "paths",
        nargs="+",
        type=Path,
        metavar="PATH",
        help="a dashboard file, or a directory searched recursively for *.yaml and *.yml files",
    )
    return parser


def _dashboard_files(path: Path) -> list[Path]:
    if path.is_dir():
        return sorted(
            candidate
            for candidate in path.rglob("*")
            if candidate.is_file() and candidate.suffix in YAML_SUFFIXES
        )
    return [path]


def main(argv: Sequence[str] | None = None) -> int:
    """Run the command line; return 0 without issue, 1 with issues, 2 on invalid usage."""
    parser = _build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exit_request:
        return exit_request.code if isinstance(exit_request.code, int) else EXIT_USAGE

    paths: list[Path] = args.paths
    missing = [path for path in paths if not path.exists()]
    for path in missing:
        print(f"skifer-board validate: no such file or directory: {path}", file=sys.stderr)
    if missing:
        return EXIT_USAGE

    found_issue = False
    for path in paths:
        for dashboard_file in _dashboard_files(path):
            for issue in validate_file(dashboard_file):
                found_issue = True
                print(f"{dashboard_file}:{issue.path}: {issue.layer}/{issue.code}: {issue.message}")
    return EXIT_ISSUES if found_issue else EXIT_OK
