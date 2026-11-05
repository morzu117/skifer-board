"""Dépôt de contenus git : adaptateur unique et révisions des analyses (plan 18, A1 et A3).

Ce module est la seule frontière de Board vers git. Il lance `git` sans shell, avec une
liste d'arguments fixe, un environnement reconstruit (ni configuration globale ou système,
ni hook, ni invite, ni variable `GIT_*` héritée) et un délai. Aucune valeur extérieure ne
devient un argument : les chemins sont construits ici à partir de deux UUID de forme vérifiée,
les empreintes viennent de git et sont revérifiées. Il ne pousse vers aucun dépôt distant.

Le dépôt (`SKIFER_BOARD_CONTENT_REPOSITORY`) est un dépôt nu (`git init --bare`) dédié à Board
et provisionné par l'exploitant, qui en lit le contenu par un clone. Sans arbre de travail ni
index réel, Board n'a rien à synchroniser, rien à écraser et rien à nettoyer : il n'écrit que
des objets, des références et son verrou. Une révision est un commit sur la branche courante
qui n'ajoute, ne modifie ou ne retire que `analyses/<space_id>/<analysis_id>.yaml`. Le numéro
de révision et l'auteur sont portés par des lignes de fin de message (`Board-Revision`,
`Board-Action`, `Board-Actor`) et relus avec contrôle : une histoire qui n'est pas celle que
Board a écrite rend le contenu indisponible.

Aucune commande lancée ici ne peut exécuter un programme désigné par le dépôt. Un filtre,
un `textconv`, un pilote, un alias ou un `fsmonitor` n'existent que par la configuration
locale, qui n'est acceptée que si elle ne contient que des clés d'une liste blanche. En plus,
aucune commande ne lit un arbre de travail (il n'y en a pas), les hooks, `fsmonitor` et
attributs sont neutralisés, et les objets, l'index privé et la référence sont écrits par
plomberie (`hash-object --no-filters`, `read-tree`, `update-index --index-info`, `write-tree`,
`commit-tree`, `update-ref`).

Écriture, sous un verrou `flock` du dépôt, donc exclusive entre threads et entre processus :
lecture de la tête, contrôle de la révision attendue, objets écrits avec un index privé placé
dans un répertoire temporaire unique hors du dépôt, puis mise à jour conditionnelle de la
branche (`update-ref` avec l'ancienne valeur). Cette mise à jour est le seul point de
publication : avant elle il n'existe que des objets sans référence, après elle la révision
existe et l'appel réussit. Si l'appel à git échoue sans qu'on sache s'il a eu effet, la référence
est relue : notre commit est un succès, une autre valeur donne `head_moved`, la valeur de départ
`git_failed`, une référence illisible `outcome_unknown`. Les fichiers temporaires ne sont jamais
créés dans le dépôt (`unsafe_tmpdir`).
"""

from __future__ import annotations

import contextlib
import fcntl
import functools
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from ..spaces.model import PersonRef
from .analysis import Change, Document, diff, dumps, loads, validate
from .errors import (
    ANALYSIS_NOT_FOUND,
    CONTENT_UNAVAILABLE,
    INVALID_ANALYSIS,
    REVISION_CONFLICT,
    ContentError,
    Violation,
)

REPOSITORY_VARIABLE = "SKIFER_BOARD_CONTENT_REPOSITORY"
AUTHOR_NAME_VARIABLE = "SKIFER_BOARD_CONTENT_AUTHOR_NAME"
AUTHOR_EMAIL_VARIABLE = "SKIFER_BOARD_CONTENT_AUTHOR_EMAIL"
DEFAULT_AUTHOR_NAME = "Skifer Board"
# `.invalid` est réservé (RFC 2606) : l'adresse de service ne désigne aucune boîte réelle.
DEFAULT_AUTHOR_EMAIL = "board@skifer.invalid"
MAX_DOCUMENT_BYTES = 16 * 1024 * 1024
LOCK_NAME = "board-content.lock"

_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
_OBJECT = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")
_BRANCH = re.compile(r"refs/heads/[A-Za-z0-9._+@/-]{1,200}")
_NAME = re.compile(r"[^\x00-\x1f\x7f<>]{1,100}")
_EMAIL = re.compile(r"[^\s<>@\x00-\x1f\x7f]{1,64}@[^\s<>@\x00-\x1f\x7f]{1,255}")
_PERSON_PART = re.compile(r"[^\x00-\x1f\x7f-\x9f\u2028\u2029\ud800-\udfff]{1,512}")
_RECORD = re.compile(r"([0-9a-f]{40}|[0-9a-f]{64})\x1f([^\x1f]+)\x1f(.*)", re.DOTALL)
_TRAILERS = re.compile(
    r"analysis [^\n]*\n\nBoard-Revision: ([0-9]{1,9})\nBoard-Action: (save|delete)\n"
    r"Board-Actor: ([^\n]+)\n*",
)
# Configuration locale admise, par clé en minuscules (la sous-section garde sa casse). Tout le
# reste est refusé : une clé inconnue ou future peut désigner un programme (`unsafe_config`).
# - `core.*` : ce que `git init --bare` écrit (`repositoryformatversion`, `filemode`, `bare`,
#   `ignorecase`, `precomposeunicode`, `logallrefupdates`, `symlinks`) et `sharedrepository`
#   (droits de groupe d'un dépôt partagé) ; aucune ne désigne un programme.
# - `extensions.objectformat` : empreintes SHA-256.
# - `gc.<clé>` : seulement `auto`, `autopacklimit`, `bigpackthreshold`, `pruneexpire`,
#   `reflogexpire` et `reflogexpireunreachable`, des nombres ou des durées que l'exploitant règle
#   pour son propre `gc`. Les autres clés `gc.*` sont refusées : `recentObjectsHook` désigne une
#   commande, et rien d'autre n'est nécessaire à un dépôt nu.
# - `remote.<nom>.url` et `.fetch` : miroir de l'exploitant. Elles ne sont lues que par les
#   commandes de transport (`fetch`, `push`, `ls-remote`, `clone`), qu'aucune commande de Board
#   n'est ni ne lance ; `protocol.allow=never` est de plus forcé (une URL `ext::` n'est jamais
#   exécutée). Les clés voisines (`pushurl`, `vcs`, `uploadpack`, `url.*.insteadof`) sont refusées.
_ALLOWED = re.compile(
    r"core\.(repositoryformatversion|filemode|bare|ignorecase|precomposeunicode"
    r"|logallrefupdates|symlinks|sharedrepository)"
    r"|extensions\.objectformat"
    r"|gc\.(auto|autopacklimit|bigpackthreshold|pruneexpire|reflogexpire|reflogexpireunreachable)"
    r"|remote\..+\.(url|fetch)",
    re.IGNORECASE,
)
# Fichiers d'un dépôt nu qui détourneraient les objets ou l'identité du dépôt : alternates
# (objets lus hors du dépôt), `commondir` (répertoire d'arbre de travail lié).
_FOREIGN = ("objects/info/alternates", "objects/info/http-alternates", "commondir")
# États du dépôt où une écriture serait imprévisible : on s'arrête, l'exploitant reprend la main.
_BUSY = (
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "BISECT_LOG",
    "rebase-merge",
    "rebase-apply",
    "sequencer",
)
# Appliqués à chaque commande, par-dessus la configuration du dépôt.
_OPTIONS = (
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.attributesFile=/dev/null",
    "-c",
    "core.pager=cat",
    "-c",
    "core.quotePath=false",
    "-c",
    "commit.gpgSign=false",
    "-c",
    "gc.auto=0",
    "-c",
    "protocol.allow=never",
)


class ContentConfigError(ValueError):
    """Configuration invalide ; aucune valeur n'est recopiée dans le message."""


@dataclass(frozen=True)
class ContentConfig:
    """Dépôt de contenus et identité de service qui signe les commits."""

    path: Path
    author_name: str = DEFAULT_AUTHOR_NAME
    author_email: str = DEFAULT_AUTHOR_EMAIL
    timeout: float = 30.0
    lock_timeout: float = 10.0

    def __post_init__(self) -> None:
        if _NAME.fullmatch(self.author_name) is None:
            raise ContentConfigError(f"{AUTHOR_NAME_VARIABLE} : nom d'auteur invalide.")
        if _EMAIL.fullmatch(self.author_email) is None:
            raise ContentConfigError(f"{AUTHOR_EMAIL_VARIABLE} : adresse d'auteur invalide.")
        if self.timeout <= 0 or self.lock_timeout <= 0:
            raise ContentConfigError("Les délais du dépôt de contenus doivent être positifs.")


def config_from_env(environ: Mapping[str, str]) -> ContentConfig | None:
    """Configuration du dépôt de contenus, ou `None` si la variable est absente ou vide."""
    value = environ.get(REPOSITORY_VARIABLE)
    if not value:
        return None
    if not Path(value).is_absolute():
        raise ContentConfigError(f"{REPOSITORY_VARIABLE} doit désigner un chemin absolu.")
    return ContentConfig(
        Path(value),
        environ.get(AUTHOR_NAME_VARIABLE) or DEFAULT_AUTHOR_NAME,
        environ.get(AUTHOR_EMAIL_VARIABLE) or DEFAULT_AUTHOR_EMAIL,
    )


@dataclass(frozen=True)
class Revision:
    """Une entrée de l'historique. Une suppression porte le numéro de la dernière révision."""

    number: int
    commit: str
    committed_at: datetime
    actor: PersonRef
    action: Literal["save", "delete"]


@dataclass(frozen=True)
class StoredRevision:
    revision: Revision
    document: Document


def _unavailable(reason: str) -> ContentError:
    return ContentError(CONTENT_UNAVAILABLE, reason)


def _invalid(path: str, rule: str) -> ContentError:
    return ContentError(INVALID_ANALYSIS, rule, (Violation(path, rule),))


def _relative(space_id: str, analysis_id: str) -> str:
    """Seul chemin que Board écrit ; les deux identifiants sont vérifiés avant tout appel git."""
    for path, part in (("/space_id", space_id), ("/id", analysis_id)):
        if not isinstance(part, str) or _UUID.fullmatch(part) is None:
            raise _invalid(path, "bad_identifier")
    return f"analyses/{space_id}/{analysis_id}.yaml"


def _check_revision(number: object) -> None:
    if type(number) is not int or number < 1 or number > 999_999_999:
        raise _invalid("/revision", "bad_revision")


def _person_ok(issuer: object, subject: object) -> bool:
    return all(
        isinstance(part, str) and _PERSON_PART.fullmatch(part) is not None
        for part in (issuer, subject)
    )


def _message(space_id: str, analysis_id: str, number: int, action: str, actor: PersonRef) -> str:
    who = json.dumps(
        {"issuer": actor.issuer, "subject": actor.subject}, sort_keys=True, separators=(",", ":")
    )
    return (
        f"analysis {space_id}/{analysis_id}: {action} r{number}\n\n"
        f"Board-Revision: {number}\nBoard-Action: {action}\nBoard-Actor: {who}\n"
    )


def _scratch_parent(root: Path) -> Path:
    """Répertoire des fichiers temporaires : jamais le dépôt ni un chemin qui s'y trouve.

    Il suit `TMPDIR` (puis `TEMP`, `TMP`, puis `/tmp`), comme le reste du système, mais est résolu
    (liens suivis) puis comparé à la racine du dépôt, elle aussi résolue. Un répertoire qui est le
    dépôt ou qui s'y trouve est refusé (`unsafe_tmpdir`) plutôt que remplacé : choisir un autre
    emplacement en silence cacherait une configuration fausse, et rien n'a encore été écrit à ce
    stade. Un répertoire parent du dépôt reste admis : l'index privé est créé dans un
    sous-répertoire neuf, exclusif et hors du dépôt.
    """
    name = os.environ.get("TMPDIR") or os.environ.get("TEMP") or os.environ.get("TMP") or "/tmp"
    parent = Path(name).resolve()
    if parent == root or root in parent.parents:
        raise _unavailable("unsafe_tmpdir")
    return parent


def _guarded[**P, R](function: Callable[P, R]) -> Callable[P, R]:
    """Une erreur du système de fichiers rend le dépôt indisponible, jamais une trace."""

    @functools.wraps(function)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return function(*args, **kwargs)
        except OSError:
            raise _unavailable("io_error") from None

    return wrapper


class _Git:
    """Lance git : sans shell, arguments en liste, environnement reconstruit, délai."""

    def __init__(self, executable: str, root: Path, config: ContentConfig) -> None:
        self._argv = [executable, *_OPTIONS]
        self._root = root
        self._timeout = config.timeout
        self._env = {
            "PATH": os.pathsep.join(
                dict.fromkeys((str(Path(executable).parent), "/usr/bin", "/bin"))
            ),
            "HOME": "/nonexistent",
            "LC_ALL": "C",
            "TZ": "UTC",
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_SYSTEM": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_ATTR_NOSYSTEM": "1",
            "GIT_TERMINAL_PROMPT": "0",
            "GIT_OPTIONAL_LOCKS": "0",
            "GIT_NO_REPLACE_OBJECTS": "1",
            "GIT_CEILING_DIRECTORIES": str(root.parent),
            "GIT_AUTHOR_NAME": config.author_name,
            "GIT_AUTHOR_EMAIL": config.author_email,
            "GIT_COMMITTER_NAME": config.author_name,
            "GIT_COMMITTER_EMAIL": config.author_email,
        }

    def run(
        self,
        args: Sequence[str],
        *,
        stdin: bytes = b"",
        env: Mapping[str, str] | None = None,
        ok: tuple[int, ...] | None = (0,),
    ) -> subprocess.CompletedProcess[bytes]:
        try:
            done = subprocess.run(
                [*self._argv, *args],
                cwd=self._root,
                env={**self._env, **(env or {})},
                input=stdin,
                capture_output=True,
                timeout=self._timeout,
                check=False,
                shell=False,
            )
        except (OSError, subprocess.SubprocessError):
            raise _unavailable("git_failed") from None
        if ok is not None and done.returncode not in ok:
            raise _unavailable("git_failed")
        return done

    def text(self, args: Sequence[str], **kwargs: Any) -> str:
        try:
            return self.run(args, **kwargs).stdout.decode("utf-8")
        except UnicodeDecodeError:
            raise _unavailable("git_output") from None

    def object_id(self, args: Sequence[str], **kwargs: Any) -> str:
        found = self.text(args, **kwargs).strip()
        if _OBJECT.fullmatch(found) is None:
            raise _unavailable("git_output")
        return found


@dataclass(frozen=True)
class _Place:
    git: _Git
    root: Path


@dataclass(frozen=True)
class _Head:
    branch: str
    base: str | None


class ContentRepository:
    """Lecture et écriture des révisions d'analyses dans le dépôt de contenus."""

    def __init__(
        self,
        config: ContentConfig,
        *,
        clock: Callable[[], datetime] | None = None,
        git: str = "git",
    ) -> None:
        self._config = config
        self._clock = clock or (lambda: datetime.now(UTC))
        self._executable = shutil.which(git)

    # -- lecture -----------------------------------------------------------------------------

    @_guarded
    def read(self, space_id: str, analysis_id: str, revision: int | None = None) -> StoredRevision:
        """Révision courante, ou la révision donnée (même d'une analyse supprimée depuis)."""
        _relative(space_id, analysis_id)
        if revision is not None:
            _check_revision(revision)
        place = self._locate()
        history = self._history(place, self._commit(place, "HEAD"), space_id, analysis_id)
        saves = [item for item in history if item.action == "save"]
        if revision is None:
            if not history or history[-1].action == "delete":
                raise ContentError(ANALYSIS_NOT_FOUND, "missing")
            target = history[-1]
        elif revision > len(saves):
            raise ContentError(ANALYSIS_NOT_FOUND, "missing_revision")
        else:
            target = saves[revision - 1]
        return StoredRevision(target, self._load(place, target, space_id, analysis_id))

    @_guarded
    def history(self, space_id: str, analysis_id: str) -> tuple[Revision, ...]:
        """Révisions de la plus ancienne à la plus récente, suppression comprise."""
        _relative(space_id, analysis_id)
        place = self._locate()
        found = self._history(place, self._commit(place, "HEAD"), space_id, analysis_id)
        if not found:
            raise ContentError(ANALYSIS_NOT_FOUND, "missing")
        return found

    @_guarded
    def diff(self, space_id: str, analysis_id: str, before: int, after: int) -> tuple[Change, ...]:
        """Écarts structurels entre deux révisions enregistrées, calculés sur le contenu validé."""
        _check_revision(before)
        _check_revision(after)
        return diff(
            self.read(space_id, analysis_id, before).document,
            self.read(space_id, analysis_id, after).document,
        )

    # -- écriture ----------------------------------------------------------------------------

    @_guarded
    def write(
        self,
        space_id: str,
        analysis_id: str,
        document: Document,
        *,
        expected_revision: int | None,
        actor: PersonRef,
    ) -> StoredRevision:
        """Crée la révision 1 (`expected_revision=None`) ou la suivante de la révision attendue."""
        relative = _relative(space_id, analysis_id)
        valid = validate(document)
        if valid["id"] != analysis_id:
            raise _invalid("/id", "id_mismatch")
        if not _person_ok(actor.issuer, actor.subject):
            raise _invalid("/actor", "bad_actor")
        if expected_revision is not None:
            _check_revision(expected_revision)
        payload = dumps(valid)
        place = self._locate()
        scratch = _scratch_parent(place.root)
        with self._locked(place):
            head = self._ready(place)
            history = self._history(place, head.base, space_id, analysis_id)
            if expected_revision is None:
                if history:
                    raise ContentError(REVISION_CONFLICT, "exists")
                number = 1
            else:
                number = self._current(history, expected_revision).number + 1
            saved = self._publish(
                place,
                head,
                relative,
                (space_id, analysis_id),
                number,
                "save",
                payload,
                actor,
                scratch,
            )
        return StoredRevision(saved, valid)

    @_guarded
    def delete(
        self, space_id: str, analysis_id: str, *, expected_revision: int, actor: PersonRef
    ) -> Revision:
        """Retire le fichier par un commit ; l'historique et chaque révision restent lisibles."""
        relative = _relative(space_id, analysis_id)
        if not _person_ok(actor.issuer, actor.subject):
            raise _invalid("/actor", "bad_actor")
        _check_revision(expected_revision)
        place = self._locate()
        scratch = _scratch_parent(place.root)
        with self._locked(place):
            head = self._ready(place)
            history = self._history(place, head.base, space_id, analysis_id)
            current = self._current(history, expected_revision)
            return self._publish(
                place,
                head,
                relative,
                (space_id, analysis_id),
                current.number,
                "delete",
                None,
                actor,
                scratch,
            )

    # -- internes ----------------------------------------------------------------------------

    def _now(self) -> datetime:
        return self._clock().astimezone(UTC).replace(microsecond=0)

    def _locate(self) -> _Place:
        """Le chemin configuré doit être, tel quel, la racine d'un dépôt nu au contenu sûr."""
        if self._executable is None:
            raise _unavailable("git_missing")
        configured = self._config.path
        if not configured.is_absolute():
            raise _unavailable("relative_path")
        if configured.is_symlink():
            raise _unavailable("symlink_path")
        if not configured.is_dir():
            raise _unavailable("repository_missing")
        root = configured.resolve()
        if any(os.path.lexists(root / name) for name in _FOREIGN):
            raise _unavailable("foreign_objects")
        git = _Git(self._executable, root, self._config)
        bare, gitdir, absolute = git.text(
            ["rev-parse", "--is-bare-repository", "--git-dir", "--absolute-git-dir"]
        ).split("\n")[:3]
        if bare != "true":
            raise _unavailable("not_bare")
        if gitdir != "." or Path(absolute).resolve() != root:
            raise _unavailable("unexpected_root")
        place = _Place(git, root)
        self._check_config(place)
        return place

    @staticmethod
    def _check_config(place: _Place) -> None:
        """Liste blanche de la configuration locale : une clé inconnue est refusée."""
        listing = place.git.text(["config", "--local", "--list", "-z"])
        for entry in listing.split("\0"):
            if entry and _ALLOWED.fullmatch(entry.partition("\n")[0]) is None:
                raise _unavailable("unsafe_config")

    def _commit(self, place: _Place, ref: str) -> str | None:
        """Commit de la référence ; `None` si elle est absente, erreur si elle est illisible.

        L'existence se lit d'abord (`show-ref --verify` : 1 absente, 128 présente mais cassée), puis
        la référence est résolue : une référence qui pointe un objet absent n'est pas « absente ».
        """
        done = place.git.run(["show-ref", "--verify", "--quiet", ref], ok=(0, 1))
        if done.returncode == 1:
            return None
        return place.git.object_id(["rev-parse", "--verify", f"{ref}^{{commit}}"])

    def _ready(self, place: _Place) -> _Head:
        """État d'écriture : branche attachée, aucune opération git en cours."""
        if any((place.root / name).exists() for name in _BUSY):
            raise _unavailable("operation_in_progress")
        done = place.git.run(["symbolic-ref", "--quiet", "HEAD"], ok=(0, 1))
        branch = done.stdout.decode("utf-8", "replace").strip()
        if done.returncode == 1:
            raise _unavailable("detached_head")
        if _BRANCH.fullmatch(branch) is None:
            raise _unavailable("unexpected_branch")
        return _Head(branch, self._commit(place, branch))

    def _history(
        self, place: _Place, tip: str | None, space_id: str, analysis_id: str
    ) -> tuple[Revision, ...]:
        """Histoire relue et contrôlée : révisions 1, 2, 3…, puis éventuellement la suppression."""
        if tip is None:
            return ()
        relative = _relative(space_id, analysis_id)
        output = place.git.text(
            [
                "log",
                "--no-color",
                "--no-show-signature",
                "--no-ext-diff",
                "--no-textconv",
                "--encoding=UTF-8",
                "--format=%H%x1f%cI%x1f%B%x1e",
                tip,
                "--",
                relative,
            ]
        )
        revisions: list[Revision] = []
        records = [item.lstrip("\n") for item in output.split("\x1e") if item.strip("\n")]
        try:
            for record in reversed(records):
                entry = self._parse(record, space_id, analysis_id)
                last = revisions[-1] if revisions else None
                if last is not None and last.action == "delete":
                    raise ValueError
                if entry.action == "save":
                    expected = 1 if last is None else last.number + 1
                elif last is None:
                    raise ValueError
                else:
                    expected = last.number
                if entry.number != expected:
                    raise ValueError
                revisions.append(entry)
        except (ValueError, KeyError, TypeError):
            raise _unavailable("history_inconsistent") from None
        return tuple(revisions)

    @staticmethod
    def _parse(record: str, space_id: str, analysis_id: str) -> Revision:
        found = _RECORD.fullmatch(record)
        if found is None:
            raise ValueError
        commit, stamp, body = found.groups()
        trailers = _TRAILERS.fullmatch(body)
        if trailers is None:
            raise ValueError
        number, action, who = int(trailers[1]), trailers[2], json.loads(trailers[3])
        if not isinstance(who, dict) or set(who) != {"issuer", "subject"}:
            raise ValueError
        if not _person_ok(who["issuer"], who["subject"]):
            raise ValueError
        actor = PersonRef(who["issuer"], who["subject"])
        if body.rstrip("\n") + "\n" != _message(space_id, analysis_id, number, action, actor):
            raise ValueError
        kind: Literal["save", "delete"] = "save" if action == "save" else "delete"
        return Revision(number, commit, datetime.fromisoformat(stamp), actor, kind)

    def _load(self, place: _Place, revision: Revision, space_id: str, analysis_id: str) -> Document:
        relative = _relative(space_id, analysis_id)
        raw = place.git.run(["cat-file", "blob", f"{revision.commit}:{relative}"]).stdout
        if len(raw) > MAX_DOCUMENT_BYTES:
            raise _unavailable("document_too_large")
        try:
            document = loads(raw)
        except ContentError:
            raise _unavailable("stored_invalid") from None
        if document["id"] != analysis_id:
            raise _unavailable("stored_mismatch")
        return document

    @staticmethod
    def _current(history: tuple[Revision, ...], expected: int) -> Revision:
        if not history or history[-1].action == "delete":
            raise ContentError(ANALYSIS_NOT_FOUND, "missing")
        if history[-1].number != expected:
            raise ContentError(REVISION_CONFLICT, "stale")
        return history[-1]

    @contextmanager
    def _locked(self, place: _Place) -> Iterator[None]:
        """Verrou exclusif entre threads et processus, sur un fichier du dépôt nu."""
        flags = os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC
        descriptor = os.open(place.root / LOCK_NAME, flags, 0o600)
        try:
            deadline = time.monotonic() + self._config.lock_timeout
            while True:
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except OSError as error:
                    if not isinstance(error, BlockingIOError) or time.monotonic() >= deadline:
                        raise _unavailable("lock_unavailable") from None
                    time.sleep(0.005)
            yield
        finally:
            # Le verrou tombe avec le descripteur, même si `close` signale une erreur : après une
            # publication, cette erreur ne doit pas transformer un succès en échec.
            with contextlib.suppress(OSError):
                os.close(descriptor)

    def _outcome(self, place: _Place, head: _Head, commit: str, *, refused: bool) -> None:
        """Issue d'un `update-ref` en échec, tranchée par la référence elle-même.

        `refused` dit que git a répondu par un code d'échec : il n'a alors rien appliqué, son
        refus est un fait. Sans réponse (délai, erreur de lancement) l'effet est inconnu.
        - La référence porte notre commit : la révision est publiée, l'appel réussit.
        - Elle n'a pas changé : rien n'est publié, l'échec est celui de git (`git_failed`) et
          une nouvelle tentative avec la même révision attendue est sûre.
        - Elle a bougé et git a refusé : conflit confirmé, `head_moved`.
        - Elle a bougé sans réponse de git : si notre commit est un ancêtre de la nouvelle tête,
          la publication est établie et c'est un succès ; sinon (remplacement de la branche) elle
          ne peut pas l'être : `outcome_unknown`.
        - Elle est illisible : `outcome_unknown`. La révision a pu être publiée ; l'historique
          le dit, et rejouer la demande est sûr (la révision attendue ne correspond plus si elle
          l'a été : `revision_conflict`).
        """
        try:
            found = self._commit(place, head.branch)
        except ContentError:
            raise _unavailable("outcome_unknown") from None
        if found == commit:
            return
        if found == head.base:
            raise _unavailable("git_failed")
        if refused:
            raise _unavailable("head_moved")
        if found is not None and self._descends(place, found, commit):
            return
        raise _unavailable("outcome_unknown")

    @staticmethod
    def _descends(place: _Place, head: str, ancestor: str) -> bool:
        try:
            done = place.git.run(["merge-base", "--is-ancestor", ancestor, head], ok=(0, 1))
        except ContentError:
            return False
        return done.returncode == 0

    def _publish(
        self,
        place: _Place,
        head: _Head,
        relative: str,
        ids: tuple[str, str],
        number: int,
        action: Literal["save", "delete"],
        payload: bytes | None,
        actor: PersonRef,
        scratch_parent: Path,
    ) -> Revision:
        """Écrit les objets, puis avance la branche si elle n'a pas bougé (seule publication)."""
        git = place.git
        now = self._now()
        stamp = now.isoformat()
        identity = {"GIT_AUTHOR_DATE": stamp, "GIT_COMMITTER_DATE": stamp}
        message = _message(ids[0], ids[1], number, action, actor)
        blob = (
            None
            if payload is None
            else git.object_id(["hash-object", "-w", "--no-filters", "--stdin"], stdin=payload)
        )
        # Index privé, hors du dépôt, dans un répertoire créé en mode exclusif (0700) et retiré.
        with tempfile.TemporaryDirectory(prefix="board-index-", dir=scratch_parent) as scratch:
            private = {"GIT_INDEX_FILE": str(Path(scratch) / "index")}
            if head.base is not None:
                git.run(["read-tree", head.base], env=private)
            # Mode 0 retire l'entrée : `--index-info` n'exige pas d'arbre de travail.
            # (une suppression ne se produit que sur une tête existante, donc de longueur connue)
            entry = f"100644 {blob}" if blob is not None else f"0 {'0' * len(head.base or '')}"
            git.run(
                ["update-index", "--index-info"],
                stdin=f"{entry}\t{relative}\n".encode(),
                env=private,
            )
            tree = git.object_id(["write-tree"], env=private)
        parents = [] if head.base is None else ["-p", head.base]
        commit = git.object_id(
            ["commit-tree", tree, *parents, "-F", "-"], stdin=message.encode(), env=identity
        )
        arguments = [
            "update-ref",
            "-m",
            f"board: {action} {ids[0]}/{ids[1]} r{number}",
            head.branch,
            commit,
            head.base or "",
        ]
        try:
            code = git.run(arguments, ok=None).returncode
        except ContentError:
            # Délai ou erreur de lancement : l'effet est inconnu, seule la référence le dit.
            self._outcome(place, head, commit, refused=False)
        else:
            if code != 0:
                # Un code négatif est un signal (`-9`) : git a pu publier avant d'être tué, ce qui
                # vaut une absence de réponse. Seul un code positif est un refus de git.
                self._outcome(place, head, commit, refused=code > 0)
        return Revision(number, commit, now, actor, action)
