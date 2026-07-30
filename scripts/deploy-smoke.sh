#!/usr/bin/env bash
#
# Post-deploy smoke test — proves a LiraTek web deployment actually works,
# through the nginx front door, the way a browser reaches it.
#
#   ./scripts/deploy-smoke.sh                      # http://localhost
#   ./scripts/deploy-smoke.sh http://203.0.113.10
#   ./scripts/deploy-smoke.sh https://liratek.example.com
#
# Credentials come from the environment or, failing that, ./.env.deploy:
#   SUPER_ADMIN_USERNAME, SUPER_ADMIN_PASSWORD
#
# Read-only by default. Pass --create-tenant to also exercise the write path of
# the control plane (creates a throwaway tenant named smoke-<epoch>).
#
# Exit 0 = every check passed. Non-zero = the count of failures.

set -uo pipefail

BASE_URL="${1:-http://localhost}"
BASE_URL="${BASE_URL%/}"
CREATE_TENANT=0
for arg in "$@"; do
  [ "$arg" = "--create-tenant" ] && CREATE_TENANT=1
done

# Credentials: explicit env wins; otherwise fall back to the deploy env file.
if [ -z "${SUPER_ADMIN_USERNAME:-}" ] && [ -f .env.deploy ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env.deploy; set +a
fi

PASS=0
FAIL=0

ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL + 1)); }
info() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# Prefer jq when present; fall back to sed so this runs on a bare VPS.
json_field() { # json_field <json> <key>
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$1" | jq -r --arg k "$2" '..|objects|select(has($k))|.[$k]' 2>/dev/null | head -1
  else
    printf '%s' "$1" | sed -n "s/.*\"$2\":\"\\([^\"]*\\)\".*/\\1/p" | head -1
  fi
}

printf '\033[1mLiraTek deploy smoke — %s\033[0m\n' "$BASE_URL"

# ── 1. Health ────────────────────────────────────────────────────────────────
# Public and unauthenticated by design (backend/src/api/health.ts).
info "1. Backend reachable through the proxy"
health=$(curl -fsS --max-time 10 "$BASE_URL/health" 2>&1)
if printf '%s' "$health" | grep -q '"status":"ok"'; then
  ok "GET /health → status ok"
else
  bad "GET /health → $health"
fi

api=$(curl -fsS --max-time 10 "$BASE_URL/api" 2>&1)
if printf '%s' "$api" | grep -q 'LiraTek API Server'; then
  ok "GET /api → API banner (nginx is proxying /api on the SPA's origin)"
else
  bad "GET /api → $api"
fi

# ── 2. Frontend ──────────────────────────────────────────────────────────────
info "2. Frontend served, with the runtime origin binding applied"
index=$(curl -fsS --max-time 10 "$BASE_URL/" 2>&1)
if printf '%s' "$index" | grep -q '<div id="root">'; then
  ok "GET / → SPA shell"
else
  bad "GET / → did not look like the SPA shell"
fi

# If this is missing the bundle falls back to http://127.0.0.1:3000, i.e. every
# visitor's own machine — the failure mode is "app loads, nothing works".
if printf '%s' "$index" | grep -q 'runtime-config.js'; then
  ok "index.html references runtime-config.js"
else
  bad "index.html is MISSING runtime-config.js — API calls will target 127.0.0.1"
fi

rc=$(curl -fsS --max-time 10 "$BASE_URL/runtime-config.js" 2>&1)
if printf '%s' "$rc" | grep -q '__LIRATEK_BACKEND_URL'; then
  ok "runtime-config.js sets __LIRATEK_BACKEND_URL"
else
  bad "runtime-config.js → $rc"
fi

# ── 3. Auth ──────────────────────────────────────────────────────────────────
info "3. Super admin login (proves DB, schema, migrations and bootstrap ran)"
TOKEN=""
if [ -z "${SUPER_ADMIN_USERNAME:-}" ] || [ -z "${SUPER_ADMIN_PASSWORD:-}" ]; then
  bad "SUPER_ADMIN_USERNAME/PASSWORD not set — skipping auth and tenant checks"
else
  login=$(curl -fsS --max-time 15 -X POST "$BASE_URL/api/auth/login" \
            -H 'Content-Type: application/json' \
            -d "{\"username\":\"$SUPER_ADMIN_USERNAME\",\"password\":\"$SUPER_ADMIN_PASSWORD\"}" 2>&1)
  TOKEN=$(json_field "$login" token)
  if [ -n "$TOKEN" ]; then
    ok "POST /api/auth/login → JWT issued"
  else
    bad "POST /api/auth/login → $login"
  fi
fi

# ── 4. Control plane ─────────────────────────────────────────────────────────
if [ -n "$TOKEN" ]; then
  info "4. Tenant control plane"
  tenants=$(curl -fsS --max-time 15 "$BASE_URL/api/admin/tenants" \
              -H "Authorization: Bearer $TOKEN" 2>&1)
  if printf '%s' "$tenants" | grep -q '"success":true'; then
    ok "GET /api/admin/tenants → authorized as super_admin"
  else
    bad "GET /api/admin/tenants → $tenants"
  fi

  # An unauthenticated request must NOT be served. A pass here would mean the
  # control plane is open to the internet.
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
           "$BASE_URL/api/admin/tenants")
  if [ "$code" = "401" ] || [ "$code" = "403" ]; then
    ok "GET /api/admin/tenants without a token → $code (rejected)"
  else
    bad "GET /api/admin/tenants without a token → $code (SHOULD be 401/403)"
  fi

  if [ "$CREATE_TENANT" = "1" ]; then
    slug="smoke-$(date +%s)"
    created=$(curl -fsS --max-time 15 -X POST "$BASE_URL/api/admin/tenants" \
                -H "Authorization: Bearer $TOKEN" \
                -H 'Content-Type: application/json' \
                -d "{\"name\":\"Smoke Test $slug\",\"slug\":\"$slug\"}" 2>&1)
    if printf '%s' "$created" | grep -q '"success":true'; then
      ok "POST /api/admin/tenants → created $slug (write path + volume OK)"
      printf '        note: remove it later — tenants are not auto-cleaned\n'
    else
      bad "POST /api/admin/tenants → $created"
    fi
  fi
fi

# ── 5. Transport warnings (not failures) ─────────────────────────────────────
info "5. Warnings"
case "$BASE_URL" in
  https://*)
    printf '  none — TLS in use\n' ;;
  *)
    printf '  \033[33mHTTP, not HTTPS\033[0m: voice/mic (getUserMedia) will not work,\n'
    printf '  and JWTs travel in cleartext. Fine for a private dev box only.\n' ;;
esac

# ── Summary ──────────────────────────────────────────────────────────────────
printf '\n\033[1m%d passed, %d failed\033[0m\n' "$PASS" "$FAIL"
exit "$FAIL"
