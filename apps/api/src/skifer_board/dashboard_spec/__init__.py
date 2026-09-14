"""Dashboard as YAML v1: safe loading, structural and semantic validation."""

from skifer_board.dashboard_spec.issues import ValidationIssue
from skifer_board.dashboard_spec.validate import validate_document, validate_file

__all__ = ["ValidationIssue", "validate_document", "validate_file"]
