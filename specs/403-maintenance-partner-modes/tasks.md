# Tasks: Partner switch on repair jobs (LIRA-403)

**Input**: spec.md, plan.md · **Tests**: required (rule 17 failing-first, rule 28d variants).

## Phase 1: Guard tests FIRST

- [x] T001 Core guard + variants `packages/core/src/services/__tests__/lira403.maintenancePartnerModes.test.ts` (real schema, payloads through `saveMaintenanceJobSchema.parse`). Run against unchanged code and record the failure here.

## Phase 2: Core

- [x] T002 Migration v234 in `packages/core/src/db/migrations/index.ts` + `electron-app/create_db.sql`
- [x] T003 `PartnerRepository` union + doc: `FOR_MAINTENANCE`, `THROUGH_MAINTENANCE`
- [x] T004 `validators/maintenance.ts` keys + refines
- [x] T005 `MaintenanceRepository`: partner columns, lock, `processPayments` partner branches
- [x] T006 `MaintenanceService.saveJob`: effective mode, basket refusal, charge gate, persist
- [x] T007 `ProfitRepository` maintenance totals / daily / detail weighted by partner coverage
- [x] T008 Core build + sync; guard test green; full core suite `--maxWorkers=2`

## Phase 3: Frontend

- [x] T009 Move `PartnerModeSwitch` / `partnerModeTransition` (+ tests) to `features/partners/`; Custom Services imports; i18n keys in `partners` (en, ar)
- [x] T010 Maintenance page: switch, partner picker, For "Deliver to partner", Via checkout, lock, session rule; types (`MaintenanceJob`, `electron.d.ts`)
- [x] T011 Frontend unit test for the For/Via payloads (failing first)
- [x] T012 Web e2e (extend a maintenance web spec)

## Phase 4: Notes

- [x] T013 `docs/release-notes/UNRELEASED.md` line + Highlight card; `node scripts/build-release-notes.cjs --check`
- [x] T014 `current_sprint.md` LIRA-403 entry; FEATURE_GUIDE §8 row
- [x] T015 `yarn typecheck`, `yarn lint` (elapsed times recorded)

## Evidence

**T001 failing-first (2026-11-24, unchanged code, real `create_db.sql`, payloads through `saveMaintenanceJobSchema.parse`)** — `PASS (2) FAIL (12)`:

- For DEBIT: `Expected [{ FOR_MAINTENANCE, DEBIT, 100, USD }]`, `Received []` (Zod stripped `partner_mode`/`partner_id`; nothing booked).
- LBP + parts: expected two DEBIT rows, received `[]`.
- Received → Delivered: `Expected length: 1, Received length: 0`.
- Refusals: `Received function did not throw` (FOR + legs accepted).
- For refund / void / Profits: `Cannot read properties of undefined (reading 'id')` (no MAINTENANCE txn — the no-leg checkout never charged).
- Via CREDIT / parts / basket: expected the THROUGH_MAINTENANCE CREDIT, received `[]`.
- Variant walk: FOR and VIA failed; the customer variant passed (baseline). The Via refund case passed vacuously (nothing booked).

After the change: 17/17 green. Added after the fix, so NOT proven failing-first: the lock case, the settled-refund case, the every-Profits-surface case (By Module / summary / By Date / By Cashier / By Client / closing all 0 before the partner pays and 30 after half; the pending list shows the $60), and in `lira381.refundAnyBasketItem.test.ts` a Via-Partner repair row (single-item refund nets the partner) plus a basket void (CREDIT booked at checkout, every ledger back to 0). Frontend `Maintenance.partnerModes.test.tsx` (4) — written after the page change, not proven failing-first.

Final runs (after the last core change, core rebuilt + synced): core full suite `--maxWorkers=2` 1052 suites / 10043 passed, 1 skipped (1:52); frontend maintenance + custom-services + partners 56 suites / 347 passed (16 s); backend maintenance API 4 suites / 17 passed; web e2e `lira-web-106` + `lira-web-030` + `lira-web-custom-service-payout` 5 passed; `yarn typecheck` exit 0 (1:03), `yarn lint` 0 errors (35 s); frontend `tsc -p tsconfig.app.json` clean (15 s); `check:schema-equivalence`, `check:i18n`, `check:transport-parity`, `check:bind-arity`, `check:tenant-scoping` OK; `build-release-notes --check` OK.

Process note: spec.md / plan.md / tasks.md were written by hand in the templates' shape; the Spec Kit skills were not invoked (same as LIRA-402).
