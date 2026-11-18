# Research: Profits tenant audit script

## R1 — Where script tests live
- **Decision**: `scripts/__tests__/profitsAuditChecks.test.mjs` using `node:test`, listed in root `test:scripts`.
- **Rationale**: the repo already has this pattern (`clientIpCheck.test.mjs`, `tenantMigrationLogCheck.test.mjs`) and CI runs `yarn test:scripts` with a `# tests N` floor.
- **Alternatives**: jest test under `packages/core/src/__tests__/` — rejected, spec allows it only when no script-test pattern exists.

## R2 — Lint coverage
- **Decision**: no `yarn lint` for these files; `node --check` both files instead.
- **Rationale**: root `lint` is `yarn workspaces foreach … --exclude liratek run lint` — the root workspace (where `scripts/` lives) is excluded, so `scripts/` is not linted.

## R3 — API shapes
- **Decision**: confirmed against `backend/src/api/profits.ts`: all data routes accept `from`/`to`; `/by-date` defaults `from` to 30 days ago, so `from`/`to` are always sent explicitly. `/module-detail` returns HTTP 200 `{success:false,error}` for a module without detail — reported as INFO ("no drill-down"), not FAIL. `/by-client` takes `limit` (default 20) — sent as `limit=20`, INFO only.
- Unlock is per (tenant,user) in-process memory on the server; a best-effort `POST /api/profits/lock` at the end releases it.

## R4 — Reason text
- **Decision**: parse `paid $X of $Y` with `/paid \$?(-?[\d,]+(?:\.\d+)?) of \$?(-?[\d,]+(?:\.\d+)?)/i`.
- **Rationale**: `ProfitService` builds `Customer still owes — paid $${paid.toFixed(2)} of $${final.toFixed(2)}.`; other "still owes" reasons ("… Debt not yet repaid.") carry no figures.

## R5 — Tolerances and comparisons
- **Decision**: USD ± 0.02, LBP ± 2 (spec). Check 3 compares per currency only when that currency's amount AND cost are both non-zero; runs on counted and not-counted rows; skips rows whose detail contains "(settlement allocation)".

## R6 — Pacing
- **Decision**: one `await` chain, each request awaited, then `sleep(max(0, 300 - elapsed))` before the next — never `Promise.all`. A 60 s per-request timeout.
