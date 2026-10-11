# Implementation Plan: Syria remittance — send and receive through a partner

**Branch**: `305-syria-remittance` (spec dir only; work on `main`) | **Date**: 2026-10-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/305-syria-remittance/spec.md`

## Summary

Both directions of the Syria corridor already exist and work on both apps (Custom Services → Via Partner = SEND,
Via Partner + Pay out = RECEIVE; owner notes #16 Route A, migration v185, owner "as built — no change" 2026-09-25). The plan
this ticket came from (Route B, a new provider on the OMT/Whish page) is superseded and is **not** built.

The one measured defect: a RECEIVE's commission is held until the partner pays, but netting against what the shop owes the
partner for SENDs is never counted, so in a two-way corridor the RECEIVE commission is never (or only partly) counted
(research R3). The fix is one read-time rule defined once in `packages/core/src/constants/partnerObligation.ts`
(`partnerEffectiveCoveredSql`, with `partnerNettingBalanceSql`), used by the two existing coverage fragments: a Pay out's
effective coverage is its amount minus its share of what the partner still owes in that currency — paper credits left out
(Y13) — with the newest Pay outs holding the unpaid part. Nothing is
stored, so nothing new needs reversing. Then: prove the full corridor end to end on web (new `lira-web-054`) and desktop
(twin, CI-only), archive the stale plan, bring FEATURE_GUIDE / COUNTERPARTY_LEDGERS / POSTING_MAP up to date, add the
release note.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node 20+ for jest; SQLite via better-sqlite3 (SQLCipher on desktop)

**Primary Dependencies**: `@liratek/core` (repositories, constants), Express backend, Electron 31 main, React 19 frontend
(unchanged), Playwright for e2e

**Storage**: SQLite — no schema change (stays v209)

**Testing**: core jest on the real schema (`electron-app/create_db.sql`) and real writers; existing backend/electron
suites as regression nets (no route or handler changes); Playwright web e2e over REST (REST parity proof) + desktop twin
over IPC (CI-only). After any core edit: `cd packages/core && npm run build` then
`cp -r packages/core/dist/. node_modules/@liratek/core/dist/` (`node_modules/@liratek/core` is a real copy).

**Target Platform**: desktop (Electron, shop machine) and web (Fly backend + Vercel frontend), same core

**Project Type**: monorepo desktop + web app

**Performance Goals**: Profits by-module, one partner with 300 SENDs + 300 RECEIVEs: < 3 s when square, < 10 s with 150 more unpaid RECEIVEs (SC-004; full path measured 1.08 s / 4.22 s at design time, research R5)

**Constraints**: rule 14 (one definition), rule 19 (both transports from one core), rule 20 (reversal), rule 17
(failing-first), rule 27 (no clock — the rule reads none), rule 29 (the constants file is not browser-reachable and
imports nothing)

**Scale/Scope**: four small exported SQL fragments in one core file (two of them `@internal` for tests) + two call sites; 1 new core test file, 2 e2e specs, docs

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design — still passes.*

| Principle | Status | Note |
| --- | --- | --- |
| I. One core, two transports | ✅ | No transport code changes; IPC and REST Profits both call `ProfitService` → shared fragments. REST parity proven by the web e2e `lira-web-054` (constitution VI); desktop by the twin (CI). No `window.api` use, no payload built per transport, no clock read. |
| II. Layer boundaries | ✅ | SQL stays in `constants/partnerObligation.ts` fragments consumed by repositories; no service touches the DB. |
| III. Contracts defined once | ✅ | One fragment, two consumers. No schema/adapter change (rules 21–24 not triggered; nothing put in front of a handler). |
| IV. Money integrity | ✅ | §13 checklist worked below. No drawer/ledger write changes. Reversal: nothing stored; create+void nets proven per currency (T004 cases h, q, r; T005; T011). No new `is_auto` row (rule 26 n/a). Legs untouched (rule 16). |
| V. Data and security | ✅ | Sub-queries tenant-scoped (`tenant_id = alias.tenant_id`); no bind params; no migration. |
| VI. Testing | ✅ | Guard tests first, recorded red on today's code (T004 and T005 before T006). E2E by identity + deltas, fresh partner. Assertions read field names from the schema (`createCustomServiceSchema.parse`). |
| VII. Code quality | ✅ | No `any` in new code; module loggers only; no frontend change. |

### FEATURE_GUIDE §13 checklist (worked)

1. Schema/plumbing — none needed (v209). 2. Transactions row — unchanged (existing `CUSTOM_SERVICE`). 3. IN/OUT badge —
unchanged (metadata `direction`, `cashFlow.ts`). 4. Payment legs — unchanged (payout = synthetic OUT legs through the
shared loop). 5. Drawers — General only, unchanged. 6. Client propagation — unchanged (measured P1). 7. CUSTOMER_ACCOUNT —
SEND only, unchanged. 8. Partner ledger — signs unchanged (SEND CREDIT cost, RECEIVE DEBIT arrived). 9. Void path —
existing, measured; netting stores nothing. 10. Profits — **the change**: RECEIVE recognition counts netting (FR-001..006);
refunds/voids net to 0. 11. Sessions — Pay out never joins a basket (Y12). 12. Audit viewer — unchanged. 13. E2E guard —
T005 (web) / T011 (desktop). 14. One obligation, one owner — the partner balance stays the only owner of "who owes whom"; netting reads it
and writes nothing. 15. Legs reconcile — unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/305-syria-remittance/
├── plan.md              # this file
├── research.md          # R1–R9
├── data-model.md        # no schema change; derived quantity + invariants
├── quickstart.md        # validation commands
├── contracts/
│   └── partner-effective-coverage.md
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
packages/core/src/constants/partnerObligation.ts                       # + partnerEffectiveCoveredSql, 2 call sites
packages/core/src/repositories/__tests__/ProfitRepository.syriaCorridorNetting.test.ts   # NEW guard (failing-first)
packages/core/src/repositories/__tests__/CustomServiceRepository.payout.test.ts          # header comment only
frontend/tests/e2e-web/lira-web-054-syria-corridor.spec.ts             # NEW web e2e
frontend/tests/e2e-electron/lira-305-syria-corridor-netting.spec.ts    # NEW desktop twin (CI-only)
frontend/tests/e2e-web/lira-web-custom-service-payout.spec.ts          # header comment only
frontend/tests/e2e-electron/lira-custom-service-payout.spec.ts         # header comment only
frontend/tests/e2e-electron/README.md                                  # index row
docs/FEATURE_GUIDE.md, docs/COUNTERPARTY_LEDGERS.md, docs/POSTING_MAP.md
docs/plans/todo_plans/SYRIA_REMITTANCE_PLAN.md → docs/plans/done_plans/ (git mv + banner)
docs/plans/ongoing_plans/PARTNER_DISBURSEMENT_MATRIX.md (status note)
docs/release-notes/UNRELEASED.md, current_sprint.md, docs/plans/OVERNIGHT_DECISIONS_2026-10-11.md
```

Files deliberately **not** touched (verified by grep in T014): `electron-app/handlers/*`, `electron-app/preload.ts`,
`frontend/src/types/electron.d.ts`, `backend/src/api/*.ts` (routes), `frontend/src/api/backendApi.ts`,
`frontend/src/api/ElectronApiAdapter.ts`, `packages/ui/src/api/types.ts`, `packages/core/src/validators/*`,
`packages/core/src/db/migrations/index.ts`, `electron-app/create_db.sql`, `frontend/src/features/services/**`,
`Services.throughPartnerInvariant.test.tsx`, `useShopBase.ts`, `SetupContext.tsx`, `StepBaseSystem.tsx`,
`PartnerRepository.applySettlementCoverage`, `TransactionRepository._unwindPartnerSettlementCoverage`.

**Structure Decision**: monorepo; the change lives in `packages/core`, proven through `backend` and both e2e suites.

## Complexity Tracking

No constitution violations. One judgement call recorded instead: the read-time rule is chosen over write-time stamps
(research R4) because it needs no migration, no new reversal owner and is undone by deleting one function; its cost is
read performance, measured on a prototype (research R5) and bounded by the SC-004 guards (T004 k/k2); the fallback (an
index migration) is an owner decision, not built.
