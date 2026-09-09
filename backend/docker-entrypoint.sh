#!/bin/sh
#
# Container entrypoint: restore-if-empty, then replicate, then serve.
#
# The ordering principle throughout: NOTHING here may stop the shop from
# selling. A point-of-sale system that will not boot because a backup tool is
# misconfigured has traded a small risk for a total one.
#
set -u

: "${DATABASE_PATH:=/data/liratek.db}"
export DATABASE_PATH

start_app() {
  echo "[entrypoint] starting backend (DATABASE_PATH=$DATABASE_PATH)"
  exec node dist/server.js
}

# ── Litestream is OFF unless FULLY configured ────────────────────────────────
# Partial configuration is treated as "off", not as "try anyway": a backup that
# silently fails is worse than an absent one, because you plan around it.
if [ -z "${LITESTREAM_BUCKET:-}" ] ||
  [ -z "${LITESTREAM_ENDPOINT:-}" ] ||
  [ -z "${LITESTREAM_ACCESS_KEY_ID:-}" ] ||
  [ -z "${LITESTREAM_SECRET_ACCESS_KEY:-}" ]; then
  echo "[entrypoint] Litestream NOT configured — running with no off-box replication."
  echo "[entrypoint] Set LITESTREAM_BUCKET / _ENDPOINT / _ACCESS_KEY_ID / _SECRET_ACCESS_KEY to enable."
  start_app
fi

# ── Restore, but only onto an empty volume ───────────────────────────────────
# Two guards, both load-bearing:
#   -if-db-not-exists   makes this a no-op when a database is already present,
#                       so a running shop's data can never be replaced by a
#                       stale replica. This is the one that prevents a
#                       catastrophe.
#   -if-replica-exists  exits 0 when there is no backup yet, so the very first
#                       boot does not crash-loop before anything was ever
#                       replicated.
if [ ! -f "$DATABASE_PATH" ]; then
  echo "[entrypoint] no database at $DATABASE_PATH — attempting restore from replica"
  if litestream restore -if-replica-exists -if-db-not-exists "$DATABASE_PATH"; then
    echo "[entrypoint] restore step completed"
  else
    echo "[entrypoint] restore returned non-zero — continuing; the app will bootstrap a fresh schema"
  fi
else
  echo "[entrypoint] database already present — restore skipped (correct: never overwrite live data)"
fi

# ── Replicate in the BACKGROUND; the app runs in the FOREGROUND ──────────────
# The documented pattern is `litestream replicate -exec "…"`, which makes
# Litestream the supervisor and the app its child. Deliberately not used: that
# couples the till's availability to the backup tool, and if Litestream dies the
# shop stops selling.
#
# The cost of this choice is that a Litestream crash would otherwise be silent,
# so it is checked and logged loudly below. Accepted trade: a missing backup is
# recoverable, a dead POS during business hours is not.
litestream replicate &
LITESTREAM_PID=$!

# Give it a moment to fail on bad credentials or an unreachable endpoint.
sleep 3
if kill -0 "$LITESTREAM_PID" 2>/dev/null; then
  echo "[entrypoint] litestream replicating (pid $LITESTREAM_PID) -> ${LITESTREAM_BUCKET}"
else
  echo "[entrypoint] ############################################################"
  echo "[entrypoint] WARNING: litestream exited immediately. REPLICATION IS OFF."
  echo "[entrypoint] The app will still serve. Check the credentials/endpoint."
  echo "[entrypoint] ############################################################"
fi

start_app
