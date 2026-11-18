# Implementation Plan: Profits tenant audit script

**Branch**: `397-profits-audit-script` (built on `main`, no branch) | **Date**: 2026-11-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/397-profits-audit-script/spec.md`

## Summary

A read-only Node CLI (`scripts/profits-audit.mjs`) that logs into one shop's web API, unlocks Profits, reads the
By Module list, every module's drill-down and the other five views strictly one call at a time (≥ 300 ms apart),
and runs ten checks that are pure functions in `scripts/lib/profitsAuditChecks.mjs`. Prints PASS/FAIL/INFO lines
(or `--json`) and exits 1 on any FAIL. The checks are proven by a `node:test` suite over a synthetic fixture with
exactly one violation per check, written and seen failing before the checks exist.

## Technical Context

**Language/Version**: Node ≥ 20, ESM (`.mjs`), plain JavaScript like every other `scripts/*.mjs`

**Primary Dependencies**: none new — global `fetch`, `AbortSignal.timeout`, `node:test`, `node:assert/strict`

**Storage**: N/A (nothing written to disk; token in memory only)

**Testing**: `node --test scripts/__tests__/profitsAuditChecks.test.mjs`, added to the root `test:scripts` list (CI runs it with a test-count floor)

**Target Platform**: developer machine (macOS / Windows Git Bash) talking to `https://<slug>.liratek.shop`

**Project Type**: CLI / ops tooling

**Performance Goals**: full run < 60 s on Cornertech, 2.5-month range (SC-002)

**Constraints**: strictly sequential requests, ≥ 300 ms gap; secrets only from env; never print password or token; read-only (the only POSTs are login and unlock, plus a best-effort `POST /api/profits/lock` at the end)

**Scale/Scope**: ~20 module keys × 1 drill-down call each + 6 other calls ≈ 30 requests

## Constitution Check

| Principle | Applies? | Status |
| --- | --- | --- |
| I. One core, two transports | No — tooling that reads the web API only; adds no feature to either app (spec "Web API only") | PASS (N/A) |
| II. Layer boundaries | No app code changed | PASS (N/A) |
| III. Contracts defined once | Reads REST envelopes `{success,data,error}`; field names taken from `ProfitService` row types, not invented | PASS |
| IV. Money integrity | Read-only; writes no transactions | PASS (N/A) |
| V. Data and security | Secrets from env only, never argv/stdout/disk; token kept in memory | PASS |
| VI. Testing | Guard test written first, seen failing on an empty stub; `node --test` count floor in CI via `test:scripts` | PASS |
| VII. Code quality | TS/logger rules target workspace code; `scripts/*.mjs` print to stdout by design (same as `deploy-api.mjs`) | PASS (see Decisions in spec.md) |
| Delivery (release notes) | Developer tooling — no user-visible change, no release-note line (rule 30 "Tests, docs, CI … get no line") | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/397-profits-audit-script/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/cli.md
└── tasks.md
```

### Source Code (repository root)

```text
scripts/
├── profits-audit.mjs                       # CLI: args, env secrets, sequential fetch, report
├── lib/profitsAuditChecks.mjs              # 10 pure checks + runAllChecks + formatReport
└── __tests__/profitsAuditChecks.test.mjs   # synthetic fixture, one violation per check
package.json                                # "profits:audit" + test added to "test:scripts"
docs/OPERATIONS.md                          # "Profits audit" section
```

**Structure Decision**: follows the existing `scripts/lib/<name>.mjs` + `scripts/__tests__/<name>.test.mjs` pattern
(`clientIpCheck`, `tenantMigrationLogCheck`). No file under `packages/core/src` is touched.

## Complexity Tracking

None.
