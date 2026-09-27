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

# Per-tenant database mode (`PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 11/§ 12).
# Both default to the same values `backend/src/database/connection.ts` computes,
# kept in sync by hand (there is no single source both a shell script and a
# TS module can read at container-build time) — if one changes, change both.
: "${TENANT_DB_MODE:=shared}"
: "${TENANT_DATABASES_DIR:=$(dirname "$DATABASE_PATH")/tenants}"
export TENANT_DB_MODE TENANT_DATABASES_DIR

# Created UNCONDITIONALLY, in every mode, before Litestream's config is ever
# read: the `dir`-based replica entry in litestream.yml needs this directory
# to exist. In `shared` mode it stays empty forever and Litestream's
# directory watcher tolerates that (see litestream.yml's comment) — this
# mkdir is what makes "harmless in shared mode" actually true rather than
# merely assumed.
mkdir -p "$TENANT_DATABASES_DIR" 2>/dev/null || true

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

# ── Per-tenant restore-if-empty (per-tenant mode only) ───────────────────────
# UNVERIFIED / documented gap, not a full solution: Litestream 0.5's `restore`
# command takes exactly one DB_PATH or REPLICA_URL per invocation — there is
# no "restore every database under this dir replica" command (checked against
# the reference CLI docs, litestream.io/reference/restore/, 2026-09-27: the
# usage is `litestream restore [arguments] DB_PATH`, singular, every time).
# So this box needs to be TOLD which tenant ids to attempt, one restore per
# id. Two ways, tried in this order:
#
#  1. `TENANT_DATABASE_IDS_HINT` — an explicit, operator-set override (a
#     comma-separated list, e.g. "1,5"), unchanged from before this list was
#     ever auto-derived. Still the only option when the platform file itself
#     is missing (a genuinely empty volume — see the Phase D runbook,
#     PRODUCTION_DATABASE_AND_HOSTING_PLAN.md § 12), since there is then
#     nothing on this box to derive ids FROM.
#  2. Otherwise, once the platform file is present (restored above, or never
#     lost), `dist/scripts/listTenantIds.js` reads that file's own `tenants`
#     table directly and prints the real id list — no more hand-maintained
#     hint for the common case (a machine that lost its volume but whose
#     platform replica is intact). See `backend/src/scripts/listTenantIds.ts`.
#
# Either way, an id with nothing to restore is not an error: `-if-replica-
# exists` exits 0, and that shop's requests will error until it is
# provisioned/restored, same as any other missing-file case
# `TenantDatabasePool` already handles. This whole block is still a no-op in
# `shared` mode and a failure anywhere here logs loudly and never stops the
# platform from starting (the ordering principle at the top of this file).
if [ "$TENANT_DB_MODE" = "per-tenant" ]; then
  tenant_ids=""
  if [ -n "${TENANT_DATABASE_IDS_HINT:-}" ]; then
    echo "[entrypoint] TENANT_DATABASE_IDS_HINT set ('$TENANT_DATABASE_IDS_HINT') — using it verbatim, skipping auto-discovery"
    tenant_ids="$TENANT_DATABASE_IDS_HINT"
  elif [ -f "$DATABASE_PATH" ]; then
    echo "[entrypoint] deriving tenant ids from the platform database's own tenants table"
    if discovered="$(node dist/scripts/listTenantIds.js "$DATABASE_PATH")"; then
      tenant_ids="$(printf '%s' "$discovered" | tr '\n' ',')"
      echo "[entrypoint] discovered tenant ids: ${tenant_ids:-<none>}"
    else
      echo "[entrypoint] WARNING: listTenantIds.js failed (see stderr above) — no automatic per-tenant restore this boot. Set TENANT_DATABASE_IDS_HINT to force one."
    fi
  else
    echo "[entrypoint] no platform database at $DATABASE_PATH yet — cannot derive tenant ids automatically; set TENANT_DATABASE_IDS_HINT to force a restore onto a genuinely empty volume"
  fi

  if [ -n "$tenant_ids" ]; then
    IFS=','
    for tenant_id in $tenant_ids; do
      unset IFS
      case "$tenant_id" in
        ''|*[!0-9]*)
          echo "[entrypoint] skipping invalid tenant id '$tenant_id'"
          IFS=','
          continue
          ;;
      esac
      tenant_db_path="$TENANT_DATABASES_DIR/$tenant_id.db"
      if [ ! -f "$tenant_db_path" ]; then
        echo "[entrypoint] no database for tenant $tenant_id at $tenant_db_path — attempting restore from replica"
        if litestream restore -if-replica-exists -if-db-not-exists "$tenant_db_path"; then
          echo "[entrypoint] tenant $tenant_id restore step completed"
        else
          echo "[entrypoint] tenant $tenant_id restore returned non-zero — continuing; that shop's requests will error until it is provisioned/restored"
        fi
      else
        echo "[entrypoint] tenant $tenant_id database already present — restore skipped"
      fi
      IFS=','
    done
    unset IFS
  fi
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
