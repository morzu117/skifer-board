"""Instance PostgreSQL locale et jetable pour les tests (plan 07, P9).

Un cluster temporaire est créé par `initdb` pour toute la session de tests. Il n'écoute sur
aucune adresse réseau : seul un fichier socket, dans un répertoire court sous `/tmp`, le
rend joignable. Chaque test reçoit une base vierge, détruite après lui. Sans binaires
PostgreSQL, les tests échouent : ils ne sont jamais sautés.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import URL

USER = "board"
PORT = 5432


@dataclass(frozen=True)
class Cluster:
    root: Path

    @property
    def socket(self) -> str:
        return str(self.root / f".s.PGSQL.{PORT}")

    def url(self, database: str) -> URL:
        return URL.create(
            "postgresql+pg8000", username=USER, database=database, query={"unix_sock": self.socket}
        )


def _bindir() -> Path:
    found = shutil.which("pg_ctl")
    if found is not None:
        return Path(found).parent
    config = shutil.which("pg_config")
    if config is not None:
        return Path(
            subprocess.run(
                [config, "--bindir"], check=True, capture_output=True, text=True
            ).stdout.strip()
        )
    pytest.fail(
        "Binaires PostgreSQL introuvables (pg_ctl, pg_config) : installez PostgreSQL, "
        "par exemple `brew install postgresql@18`. Les tests de la base d'état ne sont pas sautés.",
        pytrace=False,
    )


@pytest.fixture(scope="session")
def postgres_cluster() -> Iterator[Cluster]:
    bindir = _bindir()
    # Court : un chemin de socket dépasse vite les 104 caractères permis par macOS.
    root = Path(tempfile.mkdtemp(prefix="sbpg-", dir="/tmp"))
    data = root / "data"
    subprocess.run(
        [bindir / "initdb", "-D", data, "-U", USER, "--auth=trust", "-E", "UTF8", "--locale=C"],
        check=True,
        capture_output=True,
    )
    with (data / "postgresql.conf").open("a") as conf:
        conf.write(
            f"\nlisten_addresses = ''\nunix_socket_directories = '{root}'\nport = {PORT}\n"
            "fsync = off\nsynchronous_commit = off\nfull_page_writes = off\n"
        )
    subprocess.run(
        [bindir / "pg_ctl", "-D", data, "-l", root / "postgres.log", "-w", "start"],
        check=True,
        capture_output=True,
    )
    try:
        yield Cluster(root)
    finally:
        subprocess.run(
            [bindir / "pg_ctl", "-D", data, "-m", "immediate", "-w", "stop"], capture_output=True
        )
        shutil.rmtree(root, ignore_errors=True)


@pytest.fixture
def database_url(postgres_cluster: Cluster) -> Iterator[URL]:
    """Adresse d'une base vierge, sans aucune table, détruite après le test."""
    name = f"t_{uuid.uuid4().hex}"
    admin = create_engine(postgres_cluster.url("postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{name}"'))
        yield postgres_cluster.url(name)
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
    finally:
        admin.dispose()


@pytest.fixture
def engine(database_url: URL) -> Iterator[Engine]:
    """Moteur sur une base vierge ; les migrations restent à appliquer par le test."""
    created = create_engine(database_url)
    try:
        yield created
    finally:
        created.dispose()
