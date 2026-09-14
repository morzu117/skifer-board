"""Tests for local identity fallback to 'unknown' when getpass.getuser() raises (D20)."""

from unittest.mock import patch

from skifer_board.identity.local import local_identity


def test_local_identity_with_oserror() -> None:
    """getpass.getuser() raises OSError → subject='unknown', consumer_class='dashboard'."""
    with patch("getpass.getuser", side_effect=OSError("no user")):
        identity = local_identity()
    assert identity.subject == "unknown"
    assert identity.consumer_class == "dashboard"


def test_local_identity_with_keyerror() -> None:
    """getpass.getuser() raises KeyError (Python 3.12: UID absent) → subject='unknown'."""
    with patch("getpass.getuser", side_effect=KeyError("UID 1234 not in passwd")):
        identity = local_identity()
    assert identity.subject == "unknown"
    assert identity.consumer_class == "dashboard"


def test_local_identity_with_importerror() -> None:
    """getpass.getuser() raises ImportError (Windows: pwd module missing) → subject='unknown'."""
    with patch("getpass.getuser", side_effect=ImportError("No module named 'pwd'")):
        identity = local_identity()
    assert identity.subject == "unknown"
    assert identity.consumer_class == "dashboard"


def test_local_identity_nominal() -> None:
    """getpass.getuser() returns a value → subject is that value, consumer_class='dashboard'."""
    with patch("getpass.getuser", return_value="alice"):
        identity = local_identity()
    assert identity.subject == "alice"
    assert identity.consumer_class == "dashboard"
