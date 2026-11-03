# Tasks: Settle OMT from the SMS amount (LIRA-370)

**Input**: `specs/370-omt-sms-amount-settle/` — plan.md, spec.md, research.md (R1–R11), data-model.md, contracts/settle-account-sms.md, quickstart.md

**Tests**: REQUIRED. Project rule 17: every guard is written first and seen failing on the unfixed code before the fix. Never revert finished code to prove a test. Rule 28d: a variant table for money forms. Run only explicit test paths (owner rule: no full suites).

**Format**: `- [ ] Tnnn [P?] [Story?] description (file)`

---

## Phase 1: Setup

- [X] T001 Read `docs/FEATURE_GUIDE.md` §13 and `docs/plans/ongoing_plans/WEB_PARITY_ROADMAP.md`. Note in `specs/370-omt-sms-amount-settle/research.md` (new "§13 walk" section) how each checklist item applies to an SMS settlement: transaction fields, IN/OUT legs, supplier ledger, void path, profit stamping.
- [X] T002 [P] Pin today's figures before anything changes: add `packages/core/src/repositories/__tests__/SupplierRepository.lira370Baseline.test.ts`. It asserts `getAccountExpectedStatement` (all types, WU only, `upToDay`) and `allocateAccountSettlement` outputs on a fixture copied from the test-shop state (gross 776.50 / commission 4.20 / expected 772.30; collect −223.50 / 6.20 / −229.70). It must pass now and keep passing wherever the plan says "unchanged".

## Phase 2: Foundational (blocks every story)

- [X] T003 Migration **v229** `omt_owed_shares` in `packages/core/src/db/migrations/index.ts`. Check the last entry is still 228 first. Columns exactly as in data-model.md: `id` PK, `tenant_id INTEGER NOT NULL`, `financial_service_id INTEGER NOT NULL`, `omt_service_type TEXT NOT NULL`, `currency TEXT NOT NULL CHECK(currency IN ('USD','LBP'))`, `amount REAL NOT NULL CHECK(amount > 0)`, `created_settlement_txn_id INTEGER NOT NULL`, `created_anchor_ledger_id INTEGER NOT NULL`, `cleared_settlement_txn_id INTEGER NULL`, `cleared_anchor_ledger_id INTEGER NULL`, `is_reversed INTEGER NOT NULL DEFAULT 0`, `created_at`/`updated_at TEXT NOT NULL DEFAULT (datetime('now'))`. Indexes `(tenant_id, is_reversed, cleared_settlement_txn_id)` and `(tenant_id, financial_service_id)`. Include `down()`. Use the `add-migration` skill.
- [X] T004 Same table and indexes in `electron-app/create_db.sql` (rule 10).
- [X] T005 [P] Failing-first tests for the pure leaf in `packages/core/src/utils/__tests__/omtSmsSettlement.test.ts`. `expectedSmsFigure` and `deriveSmsCommission` on every worked example in the spec checklist notes:
  - 776.50/4.20 + SMS 762.30 → 14.20 (4.20 + 10.00)
  - 774.50 → 2.00, less than expected
  - 790 → 0, OMT asks more by 13.50
  - collect −223.50/6.20 + SMS −249.70 → 26.20
  - SMS −210 → 0, OMT asks more by 13.50
  - WU only → expected −225.50
  - owed shares of ticked types included
  - outstanding estimate = estimate − allocations − owed shares, never below 0

  Integer minor units (cents, whole LBP).
- [X] T006 Create `packages/core/src/utils/omtSmsSettlement.ts`: `outstandingEstimate`, `expectedSmsFigure`, `deriveSmsCommission`, types `OwedShareView`, `SmsDerivation`. Pure leaf, imports only pure utils (rule 29). Export from `packages/core/src/browser.ts` and `packages/core/src/index.ts`. T005 passes. `src/__tests__/browserEntryIsNodeFree.guard.test.ts` passes.
- [X] T007 [P] Add `commissionCoversOwed(s: SettlesByDayInput)` (true only for the OMT account parent) in `packages/core/src/utils/settlesByDay.ts`, with tests in its existing `__tests__` file. Failing-first for OMT true and Whish/Katsh/product false.
- [X] T008 Schema keys in `packages/core/src/validators/supplier.ts`: `sms_amount: z.number().optional()` on `settleAccountCurrencySectionSchema`, root `owed_shares_only: z.boolean().optional()`. Comments explain the OMT sign. Rule 23 three-way diff: schema vs `electron-app/preload.ts` settleAccount binding vs `electron-app/handlers/supplierHandlers.ts` forwarding vs `backend/src/api/suppliers.ts`. Record the result in research.md. Make the preload `data` type and `packages/ui/src/api/types.ts` `ApiAdapter.settleSupplierAccount` derive from `z.input<typeof supplierSettleAccountSchema>` if they don't already (rule 21). Validator test `packages/core/src/validators/__tests__/supplierSettleAccount.lira370.test.ts`.
- [X] T009 Add `expected_commission_usd` / `expected_commission_lbp` (the `financial_services.commission` estimate) and `commission_accounted_usd/lbp` (sum of live `settlement_commission_allocations` + live owed shares, keyed by `financial_service_id`) to FS rows in `SupplierRepository._accountRows`, and to `AccountUnsettledRow`. LEDGER rows get 0. Define `OWED_SHARE_LIVE_SQL` once, as a named fragment (rule 14). Every query carries `tenant_id`.

**Checkpoint**: the migration applies, the leaf is green, rows carry what the formula needs.

---

## Phase 3: US1 — We owe OMT: pay the SMS amount (P1) 🎯 MVP

**Goal**: one settlement, drawer = SMS, profit = derived commission, every picked day closed. **Independent test**: spec US1 (776.50 → SMS 762.30 → profit 14.20, balance 0, no open credit).

- [X] T010 [P] [US1] Failing-first allocator tests `packages/core/src/utils/__tests__/accountSettleAllocation.lira370.test.ts`:
  - `commission_covers: true` closes every row with paid 762.30 + commission 14.20, with COMMISSION-source takes.
  - Order is waive → commission → money.
  - Split: expected part per transfer = its outstanding estimate; extra spread pro rata over ticked-type closed model-1 transfers; largest remainder.
  - `commission_covers: false` output is byte-identical to today (T002 fixture).
- [X] T011 [US1] Implement in `packages/core/src/utils/accountSettleAllocation.ts`: input `commission_covers?: boolean`, `covered_types?`, per-row outstanding estimate. The commission joins the budget with the owed sign when the flag is true. Source `'COMMISSION'`. Step 4 split per R2. Update the header comment (2026-11-03 reverses 2026-10-15 for the OMT account). T010 green, existing allocator suites green (explicit paths).
- [X] T012 [P] [US1] Failing-first repository test `packages/core/src/repositories/__tests__/SupplierRepository.lira370Sms.test.ts` (pay direction):
  - Payload with `sms_amount: 762.30` → drawer OUT leg 762.30, `profit_usd` 14.20, account balance 0, no open account rows, every selection closed.
  - `supplier_settlements.commission_usd` 14.20.
  - Allocations sum 14.20.
  - No `SUPPLIER_PAYS_US` "Auto: commission credit" row.
  - Client `commission` ≠ derived → refused with `settleStaleMessage("OMT")`.
  - `$700` short pay: commission only for closed transfers (R3), no double count after a second settlement;
  - MVP combination (before Phase 6): a WU-only tick keeps today's waiting-row filter, and the commission covers only the rows left in scope.
- [X] T013 [US1] In `SupplierRepository.settleAccount` amount-first path (`packages/core/src/repositories/SupplierRepository.ts`), when `commissionCoversOwed`:
  - derive commission per currency from `sms_amount` with `deriveSmsCommission` over server rows;
  - refuse a mismatch;
  - pass `commission_covers: true` to the allocator;
  - write COMMISSION coverage rows;
  - book `supplier_settlements` + allocations;
  - skip `_bookAmountFirstCommission`'s ledger credit loop;
  - stamp `metadata_json.per_currency[c]` keys (`sms_amount`, `expected_commission`, `extra_commission`, `omt_asks_more`, `difference`) and the summary "… · SMS 762.30 · commission $14.20 ($4.20 expected + $10.00 extra)".

  Without `sms_amount` the OMT path still uses coverage with the typed commission. T012 green.
- [X] T013a [US1] Transaction details window: show the SMS figure, expected and extra commission, owed shares created/cleared and the "OMT asks more" difference for an OMT SMS settlement, read from `metadata_json.per_currency` (FR-012). Find the existing settlement details renderer (`packages/core/src/utils/transactionRowDisplay.ts` or the frontend details component) and extend it. Test next to the existing renderer tests.
- [X] T014 [US1] Settle sheet `frontend/src/features/suppliers/components/AccountSettleSheet.tsx`, OMT account only (`commissionCoversOwed` via the account prop/settlesByDay input):
  - "OMT SMS amount (USD/LBP)" box per shown currency, prefilled from `expectedSmsFigure`;
  - commission line "Commission $x (expected $y, $z extra)" replaces the settlement-commission input;
  - main payment line follows |SMS| until hand-edited;
  - preview through `allocateSection` with `commission_covers`;
  - payload via the ONE `buildSettlePayload` (rule 22) adds `sms_amount` + derived `commission`.

  Other suppliers unchanged.
- [X] T015 [P] [US1] (not proven failing-first — sheet change came first) Frontend test `frontend/src/features/suppliers/components/__tests__/AccountSettleSheet.lira370.test.tsx`:
  - prefill 772.30;
  - typing 762.30 shows commission 14.20 and payment 762.30, every row "Closes";
  - payload has `sms_amount` 762.30 and `commission` 14.20 (field names taken from the schema, rule 24);
  - stable `useApi` mock (rule 25);
  - Whish sheet shows no SMS box.
- [X] T016 [P] [US1] i18n keys (`accountSettle.sms.*`, `statement.owedShares`, `statement.typeOnSettle`) in `packages/ui/src/i18n/locales/{en,ar}/suppliers.json` (no `fr` locale exists).

**Checkpoint**: US1 works end to end on both transports (same channel and route, no new transport code).

## Phase 4: US2 — OMT owes us: receive the SMS amount (P1)

**Goal**: drawer = |SMS| received, no change line, no leftover rows. **Independent test**: spec US2 (−223.50 → SMS −249.70 → +249.70, profit 26.20).

- [X] T017 [P] [US2] (allocator half done in T010's file; repository half pending in T012/T013) Failing-first: in `accountSettleAllocation.lira370.test.ts`, a receive-only collect (only a WU RECEIVE credit row) with a commission is accepted: `|orig|` eligibility, R2 guard. In `SupplierRepository.lira370Sms.test.ts`, collect −249.70 gives an IN leg 249.70, profit 26.20, balance 0, no overpay row, no commission credit.
- [X] T018 [US2] Allocator eligibility `Math.abs(orig[i]) > 0` **only when `commission_covers` is true** (Whish and every other caller keep `orig[i] > 0`, byte-identical), and the collect-sign commission budget in `packages/core/src/utils/accountSettleAllocation.ts`. T017 green, T010's byte-identical case still green.
- [X] T019 [US2] Sheet collect mode in `AccountSettleSheet.tsx`: SMS box in OMT sign (shows "OMT pays you"), receive line = |SMS|, no "Change to return" box in SMS mode (R9). Test case added to `AccountSettleSheet.lira370.test.tsx`.

## Phase 5: US3 — Nothing typed still books the expected commission (P1)

**Independent test**: confirm untouched gives drawer −772.30, profit 4.20, balance 0.

- [X] T020 [P] [US3] Failing-first in `SupplierRepository.lira370Sms.test.ts` and `AccountSettleSheet.lira370.test.tsx`: untouched sheet → payload `sms_amount` = expected → profit = expected commission (never 0).
- [X] T021 [US3] Make sure the prefill flows into the payload and that a cleared box falls back to the expected figure, not 0, in `AccountSettleSheet.tsx`.

## Phase 6: US4 + US4b — Ticked types = whole balance; owed shares (P2/P3)

**Independent test**: spec US4 (WU only → −225.50, $4.20 owed, later cleared; shares-only settlement).

- [X] T022 [P] [US4] (not proven failing-first — code came first) Failing-first repository tests in `packages/core/src/repositories/__tests__/SupplierRepository.lira370OwedShares.test.ts`:
  - WU only: all 7 rows close, profit 2.00, owed shares Intra 0.20 / C2B 1.00 / Brokerage 3.00 (`amount > 0`, `omt_service_type` set);
  - later SMS ticking Intra + C2B: expected includes 1.20, confirm → profit 1.20 dated on that settlement, shares stamped cleared, Brokerage still owed;
  - several types ticked;
  - shares-only settlement with `owed_shares_only: true`;
  - an old-style unticked row is refused with the contract message;
  - the Profits read (`ProfitRepository`, by date) counts the $2.00 on the first settlement's day and the $1.20 on the clearing settlement's day;
  - tick-list (`settleTransactions`) and legacy whole-row paths still refuse unticked types (unchanged).
- [X] T023 [US4] In `SupplierRepository.ts`:
  - skip `_assertRowsCoveredByStatement` on the amount-first path when `commissionCoversOwed`;
  - covered types scope only the commission;
  - create owed shares for closed model-1 OMT transfers of unticked types (outstanding estimate snapshot, rule 31);
  - clear live owed shares of ticked types oldest first within the commission, writing allocations against their `financial_service_id`;
  - accept `owed_shares_only`;
  - stamp `owed_shares_created` / `owed_shares_cleared`.
- [X] T024 [US4] Re-implement `getAccountExpectedStatement` over `_accountRows` + live owed shares + `expectedSmsFigure`, keeping the B7 ledger cut for `upToDay`. Add `owed_shares_usd/lbp`. T002 baseline still green (explain any cent change in research.md).
- [X] T025 [P] [US4b] Owed-shares read on both transports:
  - `SupplierRepository.getAccountOwedShares` + `SupplierService.getAccountOwedShares` (`packages/core/src/services/SupplierService.ts`);
  - IPC `suppliers:account-owed-shares` in `electron-app/handlers/supplierHandlers.ts` + preload binding + `frontend/src/types/electron.d.ts`;
  - REST `GET /api/suppliers/:id/account-owed-shares` in `backend/src/api/suppliers.ts` (`requireAuth`, static paths before `/:id`);
  - `backendApi.ts` `ipcOrHttp` fn + `ElectronApiAdapter.ts` + `ApiAdapter` type;
  - `useSupplierAccountOwedSharesQuery` in `frontend/src/features/suppliers/hooks/useSuppliers.ts`.

  Reads return the raw shape.
- [ ] T026 [US4] (DONE: opens on All types, no row filter / waiting badge, "SMS includes" chip, stays-owed line, owed-shares block. PENDING: the shares-only mode on the sheet — server + core tests done, no UI yet) Sheet in `AccountSettleSheet.tsx`, OMT only:
  - opens on "All types" (no seed from `omtCoveredTypesStorage`, R7);
  - when narrower: a chip "SMS includes: …" plus "$x stays owed by OMT";
  - no `isSettleRowWaiting` filter and no waiting badge on the OMT calendar (`buildSettleDays` / `buildDaySelections` get covered types for commission only);
  - "Shares OMT still owes us" block with per-type totals;
  - shares-only mode when no open rows but owed shares exist.

  Tests in `AccountSettleSheet.lira370.test.tsx`.
- [X] T027 [P] [US4b] Statement panel `frontend/src/features/suppliers/components/OmtStatementCheckPanel.tsx` shows owed shares (total + by type) and the new expected figure.

## Phase 7: US5 — OMT asks for more (P2)

**Independent test**: SMS 790 on 776.50 → warning, profit 0, $13.50 credit, $4.20 owed shares.

- [X] T028 [P] [US5] (core half; sheet half with T029-UI) Failing-first in `SupplierRepository.lira370Sms.test.ts`:
  - pay 790 → OUT leg 790, profit 0, overpay credit 13.50, owed shares 4.20, `omt_asks_more` true;
  - collect −210 on −223.50 → IN 210, newest credit row part-paid 13.50, owed shares 6.20.

  In the sheet test: the warning text with the exact difference, and saving allowed.
- [X] T029 [US5] (core done 2026-11-03: commission 0, expected → owed shares, overpay credit; sheet warning pending) Implement: when `omt_asks_more`, commission 0, the ticked types' expected commission becomes owed shares (owner 2026-11-03), the extra goes through the LIRA-315 overpay credit with no change legs. Sheet warning "OMT asks $13.50 more than LiraTek shows. Check for a missing transfer or fee." and "less than expected ($4.20)" note (FR-008). Files `SupplierRepository.ts`, `AccountSettleSheet.tsx`, i18n.

## Phase 8: Undo / void (FR-009c, FR-010)

- [X] T030 [P] (not proven failing-first — code came first) Failing-first `packages/core/src/repositories/__tests__/TransactionRepository.lira370Void.test.ts`:
  - void an SMS settlement → drawer, profit, coverage (COMMISSION included), allocations and owed shares back to before;
  - void a clearing settlement → shares owed again, its profit gone;
  - void the creating settlement after a later one cleared $1.20 → allowed, relief row "OMT paid shares ahead" 1.20 (`is_auto`), shares reversed, later void still nets.

  Each test: create + reverse = 0 on every ledger, per currency (rule 20).
- [X] T031 Implement the owed-share step in `TransactionRepository._reverseSupplierSettlement` and the relief via `_planSettlementCoverageRelief` / `_bookSettlementCoverageRelief` (`packages/core/src/repositories/TransactionRepository.ts`). Never refuse for owed-share reasons.
- [X] T032 Variant table `packages/core/src/repositories/__tests__/SupplierRepository.lira370Variants.test.ts` (rule 28d), through the real `SupplierService.settleAccount`: direction {PAY, COLLECT} × ticked {all, one, several} × money {SMS, short, OMT asks more} × owed shares {none, cleared later, shares-only} × void order {none, newest, creating first}. Each case checks the drawer, profit (transaction row AND the Profits read by date), balance, live owed shares, and that create + void nets to 0. Label it "not proven failing-first" if it was written after the fixes.

## Phase 9: US6 — Statement panel read-only (P3)

- [X] T033 [P] [US6] Failing-first `frontend/src/features/suppliers/components/__tests__/OmtStatementCheckPanel.lira370.test.tsx`: no inputs, no "Off by", and the same figure as the sheet for the same rows and ticked types (SC-003).
- [X] T034 [US6] Remove the SMS inputs, "Off by" and their localStorage keys from `OmtStatementCheckPanel.tsx`. The figure comes from the read that `expectedSmsFigure` backs (T024). Grep every usage of the i18n keys `statement.smsUsd/smsLbp/typeSmsFigure` (all namespaces) first; delete only the ones nothing else uses.

## Phase 10: Polish & cross-cutting

- [X] T035 (2/2 passed 2026-11-03; screenshot `frontend/public/whats-new/1.35.0/omt-sms-settle.png`) Web e2e `frontend/tests/e2e-web/lira-web-091-omt-sms-settle.spec.ts`:
  - pay 762.30 on 776.50;
  - WU receive + collect −249.70;
  - WU-only → owed 4.20 → later SMS clears 1.20;
  - undo order.

  Match rows by identity and assert deltas (rule 15). Save the landscape screenshot `frontend/public/whats-new/<next version>/omt-sms-settle.png`. Run with `npx playwright test --config playwright.web.config.ts tests/e2e-web/lira-web-091-omt-sms-settle.spec.ts --reporter=list` and confirm the count is above 0.
- [X] T036 [P] Release note in `docs/release-notes/UNRELEASED.md` under `## 💸 OMT / Whish & suppliers`, plus a `### Settle OMT from its SMS` card in `## ✨ Highlights` with the screenshot. Run `node scripts/build-release-notes.cjs --check` (rule 30).
- [X] T037 [P] Update `docs/FEATURE_GUIDE.md` (OMT settlement: the commission now covers; owed shares and their reversal owner) and `packages/core/CLAUDE.md` if settle conventions are listed there.
- [X] T038 Gates: `yarn typecheck`, `yarn lint`, `yarn check:bind-arity`, tenant-scoping check. Rebuild + sync core (`cp -r packages/core/dist/. node_modules/@liratek/core/dist/`). Desktop e2e is not run on this Mac. Say so.
- [X] T039 (test-tenant manual check not done — web e2e covers the same flows) Update the LIRA-370 entry in `current_sprint.md`: built, tests (failing-first ones named), unverified items (always: "desktop unverified: shared IPC channel, no desktop e2e on this Mac"), "What users will notice". Then manual check on the test tenant with the quickstart scenarios, voided afterwards.

---

## Dependencies

- Phase 1 → Phase 2 → stories.
- **US1** (T010–T016) needs T003–T009.
- **US2** needs US1's allocator and repository changes (T011, T013).
- **US3** needs US1's sheet (T014).
- **US4/US4b** need T009 and T013. The owed-share table comes from T003.
- **US5** needs US4 (owed-share creation).
- **Void** (T030–T032) needs US4 + US5.
- **US6** needs T024.
- **Polish** last.

## Parallel examples

- Phase 2: T005, T007 and T008 run together (different files). T006 after T005.
- US1: T010, T012, T015 and T016 are written in parallel before T011/T013/T014.
- US4: T022, T025 and T027 run in parallel. T023 → T024 → T026 in order (same files).

## Implementation strategy

1. **MVP = US1 + US2 + US3**: the SMS box in both directions with prefill, and no owed-share logic. With "All types" there are no owed shares, so US4's refusal stays in place for narrower ticks until Phase 6. Ship-able on its own.
2. Add US4/US4b (owed shares), then US5, then void, then US6.
3. After each phase: its explicit tests, typecheck, lint.

**Total**: 40 tasks. Setup 2, Foundational 7, US1 8, US2 3, US3 2, US4/4b 6, US5 2, Void 3, US6 2, Polish 5.
