"""Environnement Alembic : toujours une connexion fournie par Board, jamais une adresse lue
dans un fichier (plan 07, P3)."""

from alembic import context
from skifer_board.state.schema import metadata

context.configure(connection=context.config.attributes["connection"], target_metadata=metadata)
with context.begin_transaction():
    context.run_migrations()
