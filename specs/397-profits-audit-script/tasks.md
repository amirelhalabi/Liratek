---
description: "Task list for LIRA-397 Profits tenant audit script"
---

# Tasks: Profits tenant audit script

**Input**: Design documents from `/specs/397-profits-audit-script/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/cli.md, quickstart.md

**Tests**: REQUIRED by FR-002 and rule 17 — the check test is written first and seen failing on an empty stub.

The spec has no numbered user stories; they are derived from its numbered "What it does" items:
- **US1 (P1)** — the ten checks as pure, unit-tested functions (spec "Checks", FR-002)
- **US2 (P1)** — the CLI that logs in, unlocks, fetches sequentially and reports (spec "What it does" 1–3, FR-001, SC-001/002)
- **US3 (P2)** — wiring and runbook (FR-001 yarn script, FR-003 OPERATIONS.md)

## Phase 1: Setup

- [X] T001 Create an empty stub `scripts/lib/profitsAuditChecks.mjs` exporting every check name (`checkModuleSums`, `checkViewsAgree`, `checkPriceMinusCost`, `checkReasonSanity`, `checkDetailText`, `checkCounterpart`, `checkZeroRows`, `checkNegativeProfit`, `checkNotCountedReason`, `checkRowCounts`, `runAllChecks`, `formatReport`) each returning an empty/PASS result, so the test fails on assertions, not on import

## Phase 2: Foundational

- [X] T002 Define the synthetic fixture (no real tenant data) inside `scripts/__tests__/profitsAuditChecks.test.mjs`: a clean baseline AuditInput that passes every check, plus a helper that applies exactly one violation per check

## Phase 3: User Story 1 — the ten checks (P1)

**Goal**: each check reports exactly its injected violation and nothing on the clean baseline.
**Independent test**: `node --test scripts/__tests__/profitsAuditChecks.test.mjs`.

- [X] T003 [US1] Write tests in `scripts/__tests__/profitsAuditChecks.test.mjs`: clean baseline → no FAIL from any check; for each check #1–#9 one violation → that check's status (FAIL, or INFO for #7/#8) with exactly one finding naming the violating module/row, and every OTHER check still PASS/clean; #7 under `strictZeroRows` FAILs for SALE/KEPT_CHANGE/TOPUP_BUYBACK only; #10 reports row counts and timings as INFO; `runAllChecks` returns ten results; `formatReport` caps examples at 5 and never contains the strings passed as secrets
- [X] T004 [US1] Run `node --test scripts/__tests__/profitsAuditChecks.test.mjs` against the stub and record the real failure output (rule 17)
- [X] T005 [US1] Implement checks #1–#10 in `scripts/lib/profitsAuditChecks.mjs` with tolerances USD ± 0.02, LBP ± 2; #3 modules: SALE, RECHARGE_*, FINANCIAL_SERVICE_*, CUSTOM_SERVICE, MAINTENANCE, LOTO, EXCHANGE, rows with "(settlement allocation)" excluded; #4 regex `paid $X of $Y` → 0 ≤ X ≤ Y and no "still owes" on refunded rows; #5 enum regex `^[A-Z_]+( \(settlement allocation\))?$`, blank/null, `^\d[\d.,]* credit$`; #6 `^Client\d+$`; #9 not-counted rows without a reason; `runAllChecks(input)` and `formatReport(result)`
- [X] T006 [US1] Re-run the test file until `# fail 0`; confirm `# tests N` matches the number of test() calls

## Phase 4: User Story 2 — the CLI (P1)

**Goal**: `node scripts/profits-audit.mjs …` per contracts/cli.md.
**Independent test**: quickstart.md steps 2–4.

- [X] T007 [US2] Implement `scripts/profits-audit.mjs`: argv parsing (`--host --user --from --to --json --module --strict-zero-rows`), env secrets (`LIRATEK_PASSWORD`, `LIRATEK_PROFITS_PASSWORD`; exit 2 if missing), login → unlock → by-module → module-detail per key → summary → by-date → by-user → by-client → by-payment-method → best-effort lock; one request at a time with ≥ 300 ms between starts; timings per endpoint; never print secrets or token
- [X] T008 [US2] `node --check scripts/profits-audit.mjs scripts/lib/profitsAuditChecks.mjs`; run without env → exit 2 and no request

## Phase 5: User Story 3 — wiring and runbook (P2)

- [X] T009 [P] [US3] Add `"profits:audit": "node scripts/profits-audit.mjs"` to root `package.json` and append `scripts/__tests__/profitsAuditChecks.test.mjs` to `test:scripts`
- [X] T010 [P] [US3] Add a short "Profits audit" section to `docs/OPERATIONS.md`: when to run, command, env vars, "sequential only — never run two audits at once"

## Phase 6: Polish

- [X] T011 Run `yarn test:scripts` (all script tests together) and confirm the count rose by this file's tests
- [X] T012 ONE live run against Cornertech (quickstart step 4); compare with the expected baseline; record elapsed time (SC-002)
- [X] T013 Log design decisions in spec.md "## Decisions taken unattended (2026-11-18)"; prepare the proposed `current_sprint.md` block (not edited — owner/orchestrator owns it); no release-note line (developer tooling)

## Dependencies

T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008 → (T009 ∥ T010) → T011 → T012 → T013.
US2 depends on US1 (the CLI imports the checks). US3 is independent of US2 except T011.

## Parallel opportunities

T009 and T010 touch different files. Nothing else is parallel; the live run (T012) must never run alongside another audit.

## Implementation strategy

MVP = US1 + US2 (a working, tested audit). US3 makes it discoverable and CI-guarded.
