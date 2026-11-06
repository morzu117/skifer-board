"""Dépôts git jetables et documents d'exemple pour les tests du dépôt de contenus (plan 18.1)."""

from __future__ import annotations

import copy
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Any

from skifer_board.content import ContentConfig, ContentRepository
from skifer_board.spaces.model import PersonRef

GIT = shutil.which("git") or "git"
ACTOR = PersonRef("https://idp.example.test", "user-0001")
OTHER = PersonRef("https://idp.example.test", "user-0002")
# Environnement de test : ni configuration de l'utilisateur, ni identité héritée.
ENV = {
    "PATH": "/usr/bin:/bin",
    "HOME": "/nonexistent",
    "GIT_CONFIG_GLOBAL": "/dev/null",
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_AUTHOR_NAME": "Test",
    "GIT_AUTHOR_EMAIL": "test@example.test",
    "GIT_COMMITTER_NAME": "Test",
    "GIT_COMMITTER_EMAIL": "test@example.test",
}


def git(
    root: Path,
    *args: str,
    check: bool = True,
    input: str | None = None,
    env: dict[str, str] | None = None,
) -> str:
    done = subprocess.run(
        [GIT, *args],
        cwd=root,
        env={**ENV, **(env or {})},
        capture_output=True,
        text=True,
        check=False,
        input=input,
    )
    if check:
        assert done.returncode == 0, done.stderr
    return done.stdout


def init(path: Path, *, commit: bool = False) -> Path:
    """Dépôt nu jetable ; `commit` y pose un premier commit (README) par plomberie."""
    path.mkdir(parents=True)
    git(path, "init", "-q", "--bare")
    if commit:
        blob = git(path, "hash-object", "-w", "--stdin", input="contenus\n").strip()
        tree = git(path, "mktree", input=f"100644 blob {blob}\tREADME.md\n").strip()
        premier = git(path, "commit-tree", tree, "-m", "départ").strip()
        git(path, "update-ref", "refs/heads/master", premier)
    return path


def commit(root: Path, fichiers: dict[str, bytes | None], message: str) -> str:
    """Commit « étranger » (hors de Board) sur la branche courante, par plomberie.

    `None` retire le chemin. Rend l'empreinte du commit.
    """
    with tempfile.TemporaryDirectory(prefix="monde-index-") as scratch:
        private = {"GIT_INDEX_FILE": str(Path(scratch) / "index")}
        tete = git(root, "rev-parse", "--verify", "--quiet", "HEAD^{commit}", check=False).strip()
        if tete:
            git(root, "read-tree", tete, env=private)
        lignes = ""
        for chemin, octets in fichiers.items():
            if octets is None:
                lignes += f"0 {'0' * 40}\t{chemin}\n"
            else:
                blob = subprocess.run(
                    [GIT, "hash-object", "-w", "--stdin"],
                    cwd=root,
                    env=ENV,
                    input=octets,
                    capture_output=True,
                    check=True,
                ).stdout.decode()
                lignes += f"100644 {blob.strip()}\t{chemin}\n"
        git(root, "update-index", "--index-info", input=lignes, env=private)
        arbre = git(root, "write-tree", env=private).strip()
    parents = ["-p", tete] if tete else []
    nouveau = git(root, "commit-tree", arbre, *parents, "-m", message).strip()
    branche = git(root, "symbolic-ref", "HEAD").strip()
    git(root, "update-ref", branche, nouveau)
    return nouveau


def fichier(root: Path, espace: str, ident: str, ref: str = "HEAD") -> bytes | None:
    """Octets du fichier d'une analyse dans git, ou `None` s'il n'y est pas."""
    done = subprocess.run(
        [GIT, "cat-file", "blob", f"{ref}:{relative(espace, ident)}"],
        cwd=root,
        env=ENV,
        capture_output=True,
        check=False,
    )
    return done.stdout if done.returncode == 0 else None


# Fichiers qu'un dépôt nu ordinaire contient hors objets, références, journaux et hooks.
ORDINAIRES = {"HEAD", "config", "description", "info/exclude", "board-content.lock", "packed-refs"}


def propre(root: Path) -> None:
    """Dépôt intact : objets cohérents et aucun fichier que Board n'a pas à écrire."""
    git(root, "fsck", "--strict", "--no-dangling")
    trouves = {
        p.relative_to(root).as_posix()
        for p in root.rglob("*")
        if p.is_file() and p.relative_to(root).parts[0] not in {"objects", "refs", "logs", "hooks"}
    }
    assert trouves <= ORDINAIRES, trouves - ORDINAIRES
    assert not (root / "analyses").exists()
    assert not (root / "index").exists()
    assert not list(root.rglob("*.tmp"))
    assert not list(root.rglob("board-index-*"))


def document(analysis_id: str, **changes: Any) -> dict[str, Any]:
    value: dict[str, Any] = {
        "api_version": "board.analysis/v1",
        "id": analysis_id,
        "name": "Chiffre d'affaires",
        "description": "Suivi.",
        "visibility": "personal",
        "owner": {"issuer": ACTOR.issuer, "subject": ACTOR.subject},
        "query": {
            "connection": "finance",
            "model": "sales",
            "metrics": ["revenue"],
            "dimensions": ["region"],
            "filters": [{"column": "region", "operator": "in", "value": ["Sud", "Nord"]}],
        },
        "contextual": [
            {"operation": "aggregate", "metric": "revenue", "group_by": ["region"], "scope": None}
        ],
        "presentation": {"chart": "bars"},
    }
    value.update(copy.deepcopy(changes))
    return value


def new_id() -> str:
    return str(uuid.uuid4())


def relative(space_id: str, analysis_id: str) -> str:
    return f"analyses/{space_id}/{analysis_id}.yaml"


def repository(path: Path, **options: Any) -> ContentRepository:
    return ContentRepository(ContentConfig(path, **options.pop("config", {})), **options)
