---
description: "Task list for LIRA-322 — OMT settlement by amount, one currency at a time"
---

# Tasks: OMT settlement by amount, one currency at a time

**Input**: Design documents from `/specs/322-omt-amount-first-settle/`:
- [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md)
- [contracts/settle-account.md](./contracts/settle-account.md), [contracts/allocator.md](./contracts/allocator.md)
- [quickstart.md](./quickstart.md)

**Tests**: REQUIRED.
- **Failing first (CLAUDE.md rule 17)**: write every guard first and see it fail on the unfixed code before writing the fix. Never prove a test by reverting finished code.
- **When a test cannot fail first**: it may test a contract that does not exist yet, so it fails only to compile. Write "not proven failing-first (new contract)" next to its task.
- **Ask the owner before running any test suite** (standing rule).
- **Desktop e2e is never run** on the owner's Mac.

**Organization**: grouped by user story. Delivery order (plan "Phasing"):
1. Foundation (Phase 2)
2. **MVP**: US1 + US2 + US6
3. US3
4. US4
5. US5
6. Polish

**Abbreviations**:
- `SR` = `packages/core/src/repositories/SupplierRepository.ts`
- `TR` = `packages/core/src/repositories/TransactionRepository.ts`
- `FSR` = `packages/core/src/repositories/FinancialServiceRepository.ts`
- `Sheet` = `frontend/src/features/suppliers/components/AccountSettleSheet.tsx`
- `Page` = `frontend/src/features/suppliers/pages/Suppliers/index.tsx`

Line numbers are from commit `7b921120` and may drift; search for the named symbol.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US6 from spec.md

---

## Phase 1: Setup

- [X] T001 Read `docs/FEATURE_GUIDE.md` §13. Append a short "§13 map" section to `specs/322-omt-amount-first-settle/research.md` covering the items this feature touches:
  - payment legs (IN per currency, change legs);
  - transaction row fields for a two-direction `SUPPLIER_SETTLEMENT`;
  - IN/OUT badge;
  - supplier ledger rows;
  - void path;
  - profit stamping (entered commission + cash-out commission);
  - `is_auto` siblings.
- [X] T002 Confirm the Node ABI for core jest: `node -e "const D=require('better-sqlite3'); new D(':memory:'); console.log('Node ABI')"`. If it fails, run `yarn rebuild:node`. Record the result in the task report (no file change).
- [X] T003 Rule-23 three-way key diff for `suppliers:settle-account`. Compare:
  - (a) `supplierSettleAccountSchema` keys (`packages/core/src/validators/supplier.ts:216-260`);
  - (b) the hand-typed `settleAccount` payload in `electron-app/preload.ts:745-774`;
  - (c) the fields `electron-app/handlers/supplierHandlers.ts:217` and `backend/src/api/suppliers.ts:504-530` forward to `SupplierService.settleAccount`.

  Write the diff table into research.md under "Rule-23 diff". Any key in (b) or (c) that is missing from (a) is a finding. Report it; do not invent support for it.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the coverage table, the shared allocator, the queue's coverage fields, the F3 fix and the additive schema. No sheet behaviour changes yet. The legacy whole-row path must stay byte-identical.

### Tests first

- [X] T004 [P] Write failing unit tests for the allocator in `packages/core/src/utils/__tests__/accountSettleAllocation.test.ts`.
  - **Table rows**: one test per row of the table in contracts/allocator.md. Rows $152/$101/$101/$101/$21/$21, all with `created_at` strings in order. Assert `closed`, `partial`, `remaining_after` and `extra` exactly.
  - **Ordering**: two rows with the same `created_at` order by kind (`FINANCIAL_SERVICE` before `LEDGER`), then by id. Rows passed out of order are sorted by string comparison of `created_at`, never `new Date()`.
  - **LBP**: rows 900,000 and 450,000 LBP, `paid` 1,000,000. Expect 900,000 closed, 450,000 partial (applied 100,000, remaining 350,000). eps 0.5.
  - **COLLECT**: credits −40 and −20, `paid` −60. Both close, extra 0.
  - **Commission**: commission 0.70 with no model-1 row closing gives an empty `commission_alloc` and a flag the repository uses to refuse. Commission 0.70 over three closed model-1 rows is allocated in proportion to the amount each owed before this settlement, by largest remainder to the cent.
  - **Cash-out commission**: `cashout_commission` counts only for credit rows in `closed`.
  - **Netting pairs**: a credit on member 30 netted against a debt on member 28 yields `netting_pairs: [{credit_member: 30, debit_member: 28, amount}]`. Same-member netting yields no pair.
  - Done 2026-10-15. Failing first: 30/30 red against a stub that threw (`Error: allocateAccountSettlement: not implemented`), then 30/30 green. Every contract-table row verified by hand and correct as written; row 4 needs `commission_model1: true` on the rows (set in the fixture).
- [X] T005 [P] Write a failing repository test for finding F3 in `packages/core/src/repositories/__tests__/SupplierRepository.lira322CommissionCreditQueue.test.ts`. Run a LEGACY account settlement (current payload) with `commission_usd: 0.70` on a model-1 OMT row, then call `getAccountUnsettled`. Expect NO row with `entry_type='SUPPLIER_PAYS_US'` and `source_ref_table='supplier_ledger'`. It is expected to fail today (research F3). Record the actual failure output.
  - Done 2026-10-15. F3 reproduced (now Certain): on the unfixed queue `getAccountUnsettled` returned `+ "LEDGER:5"` (the commission credit) — 1 failed / 1 passed (the overpay + manual-credit guard is a regression guard and passed before and after). Green after T011. Uses the shared full-schema fixture `repositories/testHelpers/omtAccountDb.ts`. Added on review (not proven failing-first): the OMT member's ledger balance (101) equals the queue's remaining (101), so hiding the credit loses no money (data-model invariant 1).
- [X] T006 [P] Write a failing migration test in `packages/core/src/db/migrations/__tests__/v217.settlementCoverage.test.ts`:
  - `up()` creates `supplier_settlement_coverage` with the columns, CHECKs and indexes in data-model.md, quoted verbatim:
    - `row_kind` CHECK IN ('FINANCIAL_SERVICE','LEDGER');
    - `currency` CHECK IN ('USD','LBP');
    - `amount` CHECK (amount > 0);
    - `source` CHECK IN ('PAYMENT','NETTING','COMMISSION','WAIVE');
    - `closes_row` DEFAULT 0;
    - `is_reversed` DEFAULT 0;
    - `created_at`/`updated_at` NOT NULL DEFAULT datetime('now');
    - indexes `(tenant_id, row_kind, row_id, is_reversed)` and `(tenant_id, transaction_id)`.
  - `down()` drops it.
  - An insert with `amount = 0` or `currency='EUR'` is rejected.
  - Done 2026-10-15. Failing first: 7/7 red (`migration v217 not found`), then 7/7 green. `created_at`/`updated_at` use `DEFAULT (datetime('now'))` (SQLite needs the parentheses).
- [X] T007 [P] Write failing schema tests in `packages/core/src/validators/__tests__/supplierSettleAccount.lira322.test.ts`:
  - A payload with `per_currency.USD` and no `direction`/`amount_*`/`selections` parses.
  - `per_currency: {}` is refused.
  - An IN leg with `currency_code: "LBP"` inside the `USD` section is refused.
  - An OUT (change) leg in LBP inside the USD section is accepted.
  - `per_currency` together with `direction`, `amount_usd`, `surplus_usd` or `discount` is refused.
  - `commission`/`waive` < 0 is refused.
  - The legacy payload (today's sheet shape) still parses unchanged.
  - Done 2026-10-15. Failing first: 16 failed / 8 passed on the unchanged schema (the 8 passing are the legacy-unchanged regression guards); refusals assert the issue path so they cannot pass for the wrong reason. 24/24 green after T013.
- [X] T008 [P] Write a failing repository test for the queue's coverage fields in `packages/core/src/repositories/__tests__/SupplierRepository.lira322QueueCoverage.test.ts`. Insert two coverage rows by hand (one active, one with `is_reversed=1`) against an FS row, then check `getAccountUnsettled`:
  - `covered_usd` counts only the active row;
  - `remaining_usd = amount_usd − covered_usd`;
  - a row whose remaining is within $0.005 is still returned until it is stamped.
  - Done 2026-10-15. Failing first: the 4 fields were added to the core `AccountUnsettledRow` type only, then 5/5 red at runtime (`Expected: 47, Received: undefined`), then 5/5 green after T011. Includes a no-table case (covered 0).

- [X] T008a [P] Write a failing test in `packages/core/src/repositories/__tests__/SupplierRepository.lira322LegacyGuard.test.ts`: after an amount-first $300 settlement, a LEGACY payload that selects the part-paid $101 row is refused with "This transfer is partly paid; settle it from the Settle Account sheet." Nothing is written. It needs the coverage table (T009) and the amount-first path (T018) to set up; it fails first against the unguarded legacy branch.
  - Done 2026-10-15. Not proven failing-first: the guard was written with T018 before this test (not re-broken, rule 17). Green.

### Implementation

- [X] T009 Add migration **v217** `supplier_settlement_coverage` to `packages/core/src/db/migrations/index.ts`, after v216, with a real `down()`. Mirror the table and indexes in `electron-app/create_db.sql` (rule 10). Every column, CHECK and index exactly as listed in data-model.md, until T006 passes.
  - Done 2026-10-15. v217 `supplier_settlement_coverage` + `idx_ssc_row` / `idx_ssc_transaction`, real `down()`; mirrored in `create_db.sql` with the `(217, …)` seed row. `yarn check:schema-equivalence`: zero diffs across 99 tables.
- [X] T010 [P] Create `packages/core/src/utils/accountSettleAllocation.ts` with `allocateAccountSettlement(input): AllocResult`, exactly per contracts/allocator.md, until T004 passes.
  - Build on `allocateFifo` from `utils/fifoCoverage.ts`.
  - Within the budget, take sources in this order: commission, then waive, then money.
  - Round every take to cents (USD) or whole units (LBP) before returning.
  - Export the function and its types from `packages/core/src/index.ts` AND `packages/core/src/browser.ts`.
  - Import nothing but pure utils (rule 29).
  - Done 2026-10-15. Integer minor units (cents / whole LBP) over `allocateFifo` + `allocateProportional`; types prefixed `AccountSettleAlloc*` (avoid `export *` collisions); also exports `compareAccountSettleRows` (the one row order) and returns `commission_without_closed_model1`. Exported from `index.ts` and `browser.ts`; `browserEntryIsNodeFree` guard green.
- [X] T011 In SR, add one exported named fragment `ACCOUNT_ROW_COVERED_SQL` (rule 14): the active-coverage SUM per `(tenant_id, row_kind, row_id, currency)` over `is_reversed = 0`. Add `isSettlementCommissionCredit(alias)`: `entry_type='SUPPLIER_PAYS_US' AND source_ref_table='supplier_ledger' AND is_auto=1`.
  - In `getAccountUnsettled` (SR:2550-2647), add `covered_usd`, `covered_lbp`, `remaining_usd` and `remaining_lbp` to every row using the fragment.
  - Exclude commission credit rows with `NOT (isSettlementCommissionCredit)` in the ledger query (SR:2588-2604).
  - Stop when T005 and T008 pass and the existing queue suites still pass.
  - Done 2026-10-15. `ACCOUNT_ROW_COVERED_SQL` binds `(tenant_id, row_kind, row_id)` and returns `{covered_usd, covered_lbp}` (one indexed lookup per row); `isSettlementCommissionCredit(alias)` is NULL-safe (COALESCE on `source_ref_table`/`is_auto`) so overpay and manual credits stay in the queue. Table guard memoized like `_hasServiceProvidersTable`. Both exported from `repositories/index.ts`. `check:tenant-scoping` 0 violations, `check:bind-arity` OK. The new table is also classified in `offline/idRange.ts` (appended) and `constants/resetTables.ts` (WIPE), with a seed row in `DatabaseResetRepository.test.ts` — both guards caught it.
- [X] T012 [P] Add `covered_usd`, `covered_lbp`, `remaining_usd` and `remaining_lbp` to `AccountUnsettledRow` in `packages/ui/src/api/types.ts` (~619-650) and to the core return type.
  - Delete the duplicate `AccountUnsettledRow` in `frontend/src/types/electron.d.ts` (~356) and import the `@liratek/ui` one instead (rule 14).
  - Run `yarn typecheck` (ask first) to confirm no consumer broke.
  - Done 2026-10-15. `covered_*`/`remaining_*` added to `AccountUnsettledRow` in `packages/ui/src/api/types.ts` (core already had them). The duplicate in `electron.d.ts` is gone; it now re-exports core's own type (not `@liratek/ui`: `tsconfig.playwright.json` includes that file and has no JSX). Root `yarn typecheck` green.
- [X] T013 Extend `supplierSettleAccountSchema` in `packages/core/src/validators/supplier.ts` per contracts/settle-account.md, until T007 passes:
  - add `per_currency` with `CurrencySection` and `expected_owed`;
  - make `direction`, `selections`, `amount_usd`, `amount_lbp`, `commission_usd` and `commission_lbp` optional;
  - add the refinements in a `superRefine`. Keep a plain `ZodObject` base so `.shape` users keep working.

  Export `SupplierSettleAccountPayload = z.input<…>` from both entry points.
  - Done 2026-10-15. Base stays a plain `ZodObject`; the cross-field rules run in a parent `superRefine`, and the refined export carries the base `.shape` (`Object.assign`) because the backend and frontend key tests read `.shape`. Section rules (≥1 section, IN-leg currency) are on `per_currency` itself. `SupplierSettleAccountPayload` was already exported from both entry points. `SupplierService.settleAccount` now takes `SettleAccountRequest` (new, in SR) and refuses a `per_currency` payload with "Settling the OMT account by amount is not available yet." until Phase 3; legacy path unchanged. Open: `commission_usd/lbp` are still accepted next to `per_currency` (the contract does not list them); `expected_owed` is optional in the schema — Phase 3 should require it on the amount-first path.
- [X] T014 Replace the hand-typed `settleAccount` payload in `electron-app/preload.ts:745-774` and the bridge type in `frontend/src/types/electron.d.ts` (~1877, ~1972) with `SupplierSettleAccountPayload` (rules 12, 21).
  - Re-export the schema in `electron-app/schemas/index.ts` with the zod-major cast, if the handler imports it from there.
  - Type `settleSupplierAccount` in `frontend/src/api/backendApi.ts:3619-3636`, `ElectronApiAdapter.ts:583-586` and `packages/ui/src/api/types.ts:1883` with the same derived type, never `any`.
  - Update `SettleAccountRequest` in `frontend/src/features/suppliers/hooks/useSuppliers.ts:603-639` to that type and remove the defensive cast at 676-683.
  - Done 2026-10-15. `preload.ts` `settleAccount` and the `electron.d.ts` bridge now take `SupplierSettleAccountPayload`. The adapters (`backendApi.ts`, `ElectronApiAdapter.ts`, `ApiAdapter`) were already typed with it. `SettleAccountRequest` in `useSuppliers.ts` is now `Omit<SupplierSettleAccountPayload, "account_supplier_id">` and the defensive cast is gone. The schema was already re-exported in `electron-app/schemas/index.ts`.

**Checkpoint**:
- The legacy settle path is unchanged: existing suites `SupplierRepository.{accountSettlement,overpaymentCredit,coveredTypesSettlement,lira310AccountSettle}.test.ts` and `TransactionRepository.accountSettlementReversal.test.ts` pass (ask first).
- The allocator, migration, F3, queue and schema tests pass.
- `browserEntryIsNodeFree.guard.test.ts` passes.

---

## Phase 3: User Story 1 — Pay OMT in one currency only (P1) 🎯 MVP

**Goal**: settle USD only or LBP only. Two separate amounts, never a merged figure.

**Independent test**: with $497 and 900,000 LBP owed, settle Cash $497 only. USD rows close; the LBP row and the LBP balance are untouched. Then do the same for LBP.

### Tests first

- [X] T015 [P] [US1] Write failing repository tests in `packages/core/src/repositories/__tests__/SupplierRepository.lira322AmountFirst.test.ts` using the six USD rows ($152/$101/$101/$101/$21/$21) and one 900,000 LBP send. Snapshot drawers, member balances and the queue before each action and assert deltas (rule 15 style).
  - (a) `per_currency.USD` Cash $497 closes all six USD rows (`settlement_id` = anchor), LBP row untouched, parent balance USD −497 / LBP 0 delta, cash drawer USD −497.
  - (b) LBP-only Cash 900,000 closes the LBP row only.
  - (c) both sections in one call close everything.
  - (d) USD $507.11 closes the six rows and books $10.11 as an open overpay credit (LIRA-315), LBP still 900,000 owed.
  - (e) `expected_owed` off by $1 is refused with the stale message and writes nothing (row counts unchanged).
  - (f) one `SUPPLIER_SETTLEMENT` transaction, `metadata_json.per_currency` present.
  - (g) one coverage row per closed row with `source='PAYMENT'`, `closes_row=1`.

  These fail first because the path does not exist; mark them "not proven failing-first (new contract)" if they only fail on the schema.
  - Done 2026-10-15. Failing first: 19/19 red on the legacy-only repository (`DatabaseError: No rows selected for account settlement`), then green. Every case also asserts the per-member balance invariant (data-model inv. 1). Plus (e2) missing expected_owed and (e3) service returns the refusal verbatim (e3 not proven failing-first).
- [X] T016 [P] [US1] Write failing transport tests:
  - extend `backend/src/api/__tests__/suppliers.api.test.ts` (~731) with an amount-first payload: 200 + `{success:true,id}`, actor taken from the JWT, admin-only (a staff role gets refused);
  - add the same case to `electron-app/handlers/__tests__/supplierHandlers.coveredTypes.test.ts` or a new `supplierHandlers.lira322.test.ts`, asserting the handler forwards `per_currency` and `expected_owed` untouched.
  - Done 2026-10-15. Failing first: backend `Expected: 200, Received: 500` (audit read `req.body.selections.length`); electron 3/4 red `TypeError: Cannot read properties of undefined (reading 'length')`. New `electron-app/handlers/__tests__/supplierHandlers.lira322.test.ts` (also pins the legacy audit text byte-identical, and no audit on a refused settlement). Green.
- [X] T017 [P] [US1] Write failing sheet tests in `frontend/src/features/suppliers/components/__tests__/AccountSettleSheet.lira322Currency.test.tsx`. Use a mocked `useApi` with a STABLE reference (rule 25).
  - The sheet shows `supplier-account-settle-owed-usd` "$497.00" and `supplier-account-settle-owed-lbp` "900,000 LBP", and no `supplier-account-settle-net` merged figure.
  - Two payment boxes are present, each locked to its currency.
  - Entering only USD Cash 497 and confirming sends `per_currency: { USD: {direction:"PAY", payments:[…USD…]} }` with no `LBP` key, plus `expected_owed: {usd: 497, lbp: 900000}`, and no `selections`/`direction`/`amount_*`. Take the field names from the schema type (rule 24).
  - Confirm is enabled with only one currency entered.
  - Done 2026-10-15 in `AccountSettleSheet.lira322Currency.test.tsx` (4 tests; fixtures in `features/suppliers/testing/accountSettleFixtures.ts`). Failing first: red on the old sheet (`Unable to find an element by: [data-testid="supplier-account-settle-owed-usd"]`), then green. Every payload is parsed through `supplierSettleAccountSchema` (rule 24). Two inclusion-rule cases were added later (pure netting sends `USD: {PAY, payments: []}` and no LBP key; USD money only sends no LBP key even when LBP netting could close something). Not proven failing-first (written after the code).

### Implementation

- [X] T018 [US1] In SR `settleAccount` (4726), dispatch to a new private `_settleAccountAmountFirst(data)` when `data.per_currency` is present. Leave the legacy body untouched. Inside ONE `this.db.transaction`:
  1. Read the queue fresh (`getAccountUnsettled`) and apply the covered-types filter (`isOmtRowCovered`). Apply the `selections` scope when given.
  2. Compare the signed in-scope remaining with `expected_owed` (eps $0.005 / 0.5 LBP). On a mismatch, throw `DatabaseError("OMT's balance changed since you opened this sheet. Check the new amounts. (expected … found …)")`.
  3. For each currency section:
     - (a) P = Σ IN − Σ OUT legs in that currency, signed by direction.
     - (b) Check the direction against the remaining sign, then run `allocateAccountSettlement` to get `applied` and `extra`.
     - (c) Call `_resolveSettlementLegs(legs, owed = applied, {allowOverpay: !waive})` ONLY for its leg checks: drawer method, cash-only change, change ≤ extra.
     - (d) Book the overpay from the calculation's `extra` alone (rule 14), never from both.
     - (e) A change leg in the other currency books that currency's extra per LIRA-315.
  4. Write the `SUPPLIER_SETTLEMENT` transaction via `createTransaction`. `amount_*` are magnitudes, and `metadata_json.per_currency` holds `{direction, paid, commission, waive, extra}` per currency plus `members`/`selections`.
  5. Write the anchor and one `supplier_ledger` row per member per currency with a nonzero money share (−money for PAY, entry type from sign), each with `transaction_id`, a self-stamped `settlement_id` and a `.changes` guard.
  6. Insert coverage rows.
  7. Stamp `settlement_id = anchor` on closed rows via `_markFinancialServicesSettled` / `_markLedgerRowsSettled`, with the `.changes` guards.
  8. Post the legs to drawers with `resolveServiceCashDrawer` + `applyDrawerDelta` + `insertPaymentRow`, using the section's direction sign (OUT legs inverted, as SR:5477-5500).
  9. Book any extra with `_bookSettlementOverpay`.

  In the LEGACY branch, refuse any selection with active coverage (`ACCOUNT_ROW_COVERED_SQL` > 0): "This transfer is partly paid; settle it from the Settle Account sheet." Stop when T008a passes.

  Stop when T015 (a)–(g) pass.
  - Done 2026-10-15. `_settleAccountAmountFirst` + `_amountFirstScope` + `_planAmountFirstSection` in SR; one db.transaction on a fresh queue; per-member-per-currency ledger rows; coverage + `.changes`-guarded stamps; refusals pass through unwrapped (non-DatabaseError is wrapped). Phase-3 refusals: two sections with different directions, cross-member netting pairs ("not available yet"). Same-member netting and one-direction COLLECT work (tests added after the code, not proven failing-first). Legacy branch refuses part-paid rows (T008a). Returns the anchor ledger id, as the legacy path does. `amount_*` keeps the legacy meaning (money applied to rows; waive and extra excluded).
- [X] T019 [US1] In `packages/core/src/services/SupplierService.ts:220-239`, accept the amount-first payload. The selections and amount checks apply to the legacy path only. Forward `created_by` from the caller. No SQL in the service (rule 13). Stop when T016 passes.
  - Done 2026-10-15. Service routes `per_currency` to the repository (refuses a missing `expected_owed`); legacy checks unchanged. IPC handler + REST route audit through the shared `describeSettleAccountForAudit` (core `utils/settleAccountAudit.ts`), only on success. Schema now requires `expected_owed` and refuses `commission_usd/lbp` next to `per_currency` (failing first: 3 red / 24 green, then 27/27).
- [X] T020 [US1] Rewrite Sheet so its math comes from `allocateAccountSettlement`. Remove `collapseNetBalance`, the single `targetAmount` and the merged `-net` figure.
  - Render one section per currency that has rows or entered money. Testids: `supplier-account-settle-section-usd` / `-lbp`, owed `-owed-usd` / `-owed-lbp`.
  - Each section has its own `MultiPaymentInput`: `totals=[{amount: |remaining|, currency}]`, IN line currency locked, `payer` from the section direction, `cashOnlyReturn`, `unreturnedChangeTo="ACCOUNT_BALANCE"`, its own `onReturnChange`.
  - Build the payload ONCE (rule 22) as `{account_supplier_id, per_currency, expected_owed, exchange_rate, note?, covered_omt_service_types?}`.
  - On the stale error, refetch the queue and keep the entered lines.

  Stop when T017 passes and the existing sheet suites are updated to the new testids. Do not delete their intent; rewrite assertions (rule 24).
  - Done 2026-10-15. Sheet rewritten. Each currency is its own section: header "You pay OMT $497.00" / "OMT pays you …", its own `MultiPaymentInput` offering only that currency (change in either currency, cash only), its own commission. The preview comes from `allocateAccountSettlement`, fed exactly as the server feeds it. The payload is built once. Payment boxes start EMPTY via `fillTotals=[0]`; `totals` still shows what is owed. A section goes into `per_currency` only when money or commission was entered in it; a pure-netting section is sent only when nothing is entered anywhere. On the stale error the sheet refetches, shows the message inline and keeps the typed lines (boxes are keyed by currency + direction). `alert()` was replaced by an inline error. The five old sheet suites were rewritten (intent kept). Not proven failing-first: the rewritten suites' assertions, plus the new-behaviour cases in them (credit nets + deferred commission, COLLECT section, underpay is partial, existing credit nets, stale refusal keeps lines), were written after the code.
- [X] T021 [P] [US1] In `frontend/src/features/suppliers/utils/accountSettleMath.ts`:
  - delete `collapseNetBalance` and `computeSelectionTotals`'s merged net;
  - keep `accountRowKey`;
  - replace `sortOldestFirst` with the allocator's string order (one ordering, rule 14);
  - update the header comment.

  Grep for any other importer first and migrate it.
  - Done 2026-10-15. `collapseNetBalance` and `computeSelectionTotals` deleted (the sheet was the only importer). `accountRowKey` kept. `sortOldestFirst` now uses core `compareAccountSettleRows`. New pure helpers: `isWaitingRow` (moved from the sheet), `settlementScope`, `scopeOwed`, `rowsInCurrency`, `directionFromOwed`, `allocateSection` and `roundMoney`.

**Checkpoint**: US1 works on its own, and the legacy suites are still green.

---

## Phase 4: User Story 2 — Partial payment; the system picks what closes (P1) 🎯 MVP

**Goal**: any amount is accepted. Oldest first, one row may be part-paid, and the preview shows the result before confirming.

**Independent test**: pay $300, then $197, against the six USD rows. Check each row's status and remaining amount, and the balance.

### Tests first

- [X] T022 [P] [US2] Add to `SupplierRepository.lira322AmountFirst.test.ts`:
  - (h) Cash $300: $152 and the first $101 close; the next $101 has coverage $47 `closes_row=0` with no `settlement_id`; `getAccountUnsettled` shows it with `remaining_usd 54`; parent balance delta −300; account owes $197.
  - (i) then Cash $197: the part-paid row and the rest close; the part-paid row now has two coverage rows (47 + 54), and only the second has `closes_row=1`.
  - (j) Cash $0.50: the $152 row is partly paid by 0.50.
  - (k) Cash $496.30 with `commission: 0.70` closes all six. `settlement_commission_allocations` has rows only for the closed model-1 rows and sums to 0.70. Profit stamp is 0.70.
  - (l) Cash $496.30, no commission: the $21 newest row is partly paid (20.30 / 0.70 remaining).
  - (m) Cash $200 + commission 0.70 (budget $200.70): the $152 row closes and the next $101 is partly paid $48.70; all 0.70 commission is allocated to the $152 row, none to the part-paid row. Cash $100 + commission 0.70 (budget $100.70, no row closes) is refused.
  - (n) **balance invariant**: after (h) and (i), per member and for the account total, the ledger sum per currency equals Σ `remaining_*` over the queue.
  - (o) **Waive (FR-011, server only)**: Cash $495 + `waive: 2` closes all six; coverage source WAIVE $2; the waive's ledger rows are absent from `getAccountUnsettled`; a void nets to 0 per currency.
  - Done 2026-10-15. (h)–(m2), (o), (o2) in `SupplierRepository.lira322AmountFirst.test.ts`; (n) is asserted in every case via `expectBalanceInvariant`. Failing first with T015 (same red run). (o2) waive leaving a part-paid row refused: "A waive must settle the transfers it covers in full."
- [X] T023 [P] [US2] Write a failing test in `packages/core/src/services/__tests__/FinancialService.lira322CoverageStatus.test.ts`. For an account-member supplier, `getAllByProvider` returns:
  - "partial" with `fifo_paid_usd` 47 for the part-paid row;
  - "paid" for closed rows;
  - LBP rows with `fifo_paid_lbp`, never compared with a USD pool.

  A non-member supplier still uses `getManualPaymentPools` (existing `FinancialService.voidedFifoStatus.test.ts` stays green).
  - Done 2026-10-15. Failing first: 2/2 red (no `fifo_paid_lbp`; pool estimate said "paid" for an untouched account row), then green. `FinancialService.voidedFifoStatus.test.ts` mock gained `isAccountMember: () => false` (no assertion change).
- [X] T024 [P] [US2] Write a failing test in `packages/core/src/repositories/__tests__/SupplierRepository.lira322ExpectedStatement.test.ts`: after a $300 partial settlement, `getAccountExpectedStatement` uses each row's REMAINING gross ($197) and still subtracts the part-paid row's full expected commission.
  - Done 2026-10-15. Passed on its FIRST run against the unchanged `getAccountExpectedStatement`: gross is the ledger balance (already lowered by the settlement's money row) and the part-paid row is still in `getUnsettledBySupplier`, so its full commission is subtracted. Not a failing-first guard; kept as a regression net.
- [X] T025 [P] [US2] Write failing sheet tests in `AccountSettleSheet.lira322Preview.test.tsx`. Typing Cash 300 in the USD box shows, before confirming:
  - `supplier-account-settle-preview-usd` with 2 rows chipped `closes`, 1 chipped `part-paid` ("$47 of $101 · $54 owed"), 3 chipped `untouched`;
  - "Still owed after: $197.00";
  - the LBP section unchanged.

  An amount above what is owed shows "Extra $X goes on the account" (or change).
  - Done 2026-10-15 in `AccountSettleSheet.lira322Preview.test.tsx` (2 tests). Failing first: red on the old sheet (missing section testids), then green. Covers Cash $300 → closes/closes/part-paid "$47 of $101 · $54 owed"/3 untouched, "$197.00" still owed, LBP untouched, and "Extra $10.11 goes on the account".

### Implementation

- [X] T026 [US2] Complete the partial path in `_settleAccountAmountFirst` (SR):
  - write coverage for the partial row without stamping it;
  - book entered commission through a new private `_bookAmountFirstCommission(…)` that reuses `allocateProportional` and the `supplier_settlements` / `settlement_commission_allocations` writers from `_bookCommissionAtSettlement` (SR:3889-4057) over CLOSED model-1 rows only;
  - write the commission credit ledger row stamped `settlement_id = anchor` (research R6), so F3 cannot recur;
  - refuse commission when no model-1 row closes;
  - keep the one-commission-member rule (SR:4828).

  Stop when T022 passes.
  - Done 2026-10-15. `_bookAmountFirstCommission`: supplier_settlements + allocations from the allocator's split over CLOSED model-1 rows (weighted by what each owed before), commission credit is_auto, `source_ref` = anchor, stamped `settlement_id = anchor`; refuses commission with no closing model-1 row, commission larger than owed, COMMISSION coverage or closed model-1 rows on two members, bills-only. Failing first with T015/T022.
- [X] T027 [US2] In `packages/core/src/services/FinancialService.ts:238-345` (`getAllByProvider`), for suppliers with `account_supplier_id != null` or that parent an account, take status and `fifo_paid_usd`/`fifo_paid_lbp` from coverage. Add a SupplierRepository read that uses `ACCOUNT_ROW_COVERED_SQL`; no SQL in the service (rule 13). Add `fifo_paid_lbp` to `TransactionWithFifoStatus` in core, in Page (~126-160) and in `electron.d.ts` (~268). Stop when T023 passes.
  - Done 2026-10-15. SR `isAccountMember` + `getRowCoverage` (via `ACCOUNT_ROW_COVERED_SQL`); service-side `coverageFifoStatus`; core `TransactionWithFifoStatus.fifo_paid_lbp?: number` (set for account members only). Page / electron.d.ts types left to the frontend agent.
- [X] T028 [US2] In SR `getAccountExpectedStatement` (2361-2446), use the remaining gross via `ACCOUNT_ROW_COVERED_SQL`. Stop when T024 passes.
  - Done 2026-10-15. No code change needed (see T024): the gross already is the remaining gross.
- [X] T029 [US2] In Sheet, render the per-currency preview from `AllocResult`: chips `closes` / `part-paid` / `untouched`, "Still owed after", and the extra note. Testids per T025. Stop when T025 passes.
  - Done 2026-10-15 with T020: `-preview-<cur>` rows with `data-status` closes / part-paid / untouched, `-still-owed-<cur>`, `-extra-<cur>`, `-deferred-commission-<cur>`, and a commission warning that disables Confirm when the commission closes nothing or exceeds what is owed.
- [X] T030 [P] [US2] In Page's Transactions history (2618-2704):
  - "Partial" shows the paid amount ("Partial · $47.00");
  - the counts footer uses the new statuses;
  - "Outstanding" shows both currencies ("$197.00 · 1,350,000 LBP").

  Update `Suppliers.voidedTxnStatus` / `saleCostNothingOwedStatus` / `settlementCommissionDisplay` tests only where their assertions encode the old USD-only text.
  - Done 2026-10-15. "Partial · $47.00" / "Partial · 100,000 LBP" uses the row's own currency. "Outstanding" adds LBP only where the server sends `fifo_paid_lbp` (account members), so Katsh is unchanged. The counts footer already reads the new statuses. Guarded in `Suppliers.lira322AccountOnly.test.tsx`; failing first: `Unable to find an element with the text: Partial · $47.00` and `Outstanding: $54.00 · 800,000 LBP`. `fifo_paid_lbp?` was added to the page's `SupplierTxn` and to `electron.d.ts`. No existing page suite needed changes.

**Checkpoint**: US1 + US2 work. A partial settlement leaves the balance equal to Σ remaining.

---

## Phase 5: User Story 6 — Undo a settlement (P2) 🎯 MVP

**Goal**: a void gives back exactly its share, newest first.

**Independent test**: settle $300, then $100. A void of the $300 is refused. Void the $100, then the $300: back to the start in every ledger.

### Tests first

- [X] T031 [P] [US6] Write failing tests in `packages/core/src/repositories/__tests__/TransactionRepository.lira322AmountFirstVoid.test.ts`:
  - (a) create the $300 partial settlement, then void it: drawers, parent and member balances, profit, allocations and coverage (all `is_reversed=1`) return to before, per currency. The part-paid row is back to remaining $101. The closed rows are reopened (`settlement_id` NULL, `is_settled=0`).
  - (b) $300, then $100: voiding the $300 throws "A later settlement (#id, …) paid the same transfers. Void it first." and changes nothing.
  - (c) void the $100, then the $300: nets to 0.
  - (d) a settlement with commission 0.70, voided: allocations deleted, commission credit row soft-voided via the sibling cascade, profit reversed.
  - (e) a settlement with an overpay extra, voided: the overpay row is soft-voided.
  - Done 2026-10-15. Failing first: 7/7 red — (a) owed 197 vs 497 after void (coverage still active), (b)/(b2) "Received function did not throw", (d) `Cannot void/refund — its auto supplier-ledger entry has already been included in settlement #8`, (f) part-paid transfer void not refused. Then 7/7 green. (b2) covers refund refusal; (f) is an added guard (rule 20). (a2) refund of a settlement nets to 0 — written after T032, not proven failing-first.

### Implementation

- [X] T032 [US6] In TR `_reverseSupplierSettlement` (8977-9107):
  - Add `_assertSettlementIsNewestOnItsRows(txnId)`, run BEFORE any reversal write (including `_reversePayments`). It refuses when another active coverage row (`is_reversed=0`, different `transaction_id`, later `created_at`/id) touches any `(row_kind,row_id)` this settlement covered. Call it from the `SUPPLIER_SETTLEMENT` pre-check in the void entry, before `_reversePayments` (TR:5709), so nothing is written first.
  - After the existing reopen steps, run `UPDATE supplier_settlement_coverage SET is_reversed=1, updated_at=datetime('now') WHERE transaction_id=? AND tenant_id=?`.

  Stop when T031 passes and `TransactionRepository.accountSettlementReversal.test.ts` still passes.
  - Done 2026-10-15. TR: `_assertSettlementIsNewestOnItsRows` (ordered by transaction id — same-second safe) and `_assertNoActiveSettlementCoverage` (a part-paid/netted row's own transaction, or a settlement whose overpay credit a later one applied) in BOTH void and refund pre-checks; coverage soft-void (`requestNow()`) inside `_reverseSupplierSettlement`; `_assertSupplierSiblingsVoidable` exempts the settlement's own stamped commission credit. `accountSettlementReversal` suite green.

**Checkpoint (MVP)**: US1 + US2 + US6 are shippable. Ask the owner before deploying.

---

## Phase 6: User Story 3 — Credits net first; OMT pays the shop; two directions (P2)

**Goal**: credits net in their currency (across lines too), COLLECT works, and one settlement can pay USD and receive LBP.

**Independent test**: a $60 OMT App cash-out credit plus the six USD rows. The sheet shows $437. Paying it closes everything, and both card lines are right.

### Tests first

- [X] T033 [P] [US3] Write failing repository tests in `SupplierRepository.lira322Netting.test.ts`:
  - (a) same-member credit −$60 (a manual `SUPPLIER_PAYS_US` row on the counter) and Cash $437: everything closes; coverage `NETTING` 60 on the credit and 60 on the $152.
  - (b) cross-member: a cash-out credit −$60 on OMT App (supplier 30) and debts on the counter (28), Cash $437. Writes the auto pair counter −60 `PAYMENT` / OMT App +60 `SUPPLIER_PAYS_US`, both `is_auto=1` and `transaction_id`=settlement. Afterwards, each member's ledger sum equals Σ remaining on its own queue rows, and the parent total is unchanged by the pair. Both pair rows carry `settlement_id = anchor`, and neither appears in `getAccountUnsettled`.
  - (c) credit −$60 and Cash $100: credit closed, $152 closed, next $101 remaining $93 (spec US3 scenario 3).
  - (d) the cash-out's deferred commission is recognised only when its credit row closes, and not when it is only partly netted.
  - (e) a USD credit is never used against LBP debt.
  - Done 2026-10-15 in `SupplierRepository.lira322Netting.test.ts`. Failing first: (b)/(c)/(d) red on the Phase-3 refusal (`DatabaseError: Netting a credit on one OMT line against a debt on another is not available yet … (Account settlement: USD cross-member netting 5→3 60)`), then green. (a) and (e) passed on their first run (same-member netting / currency isolation already worked) — not proven failing-first. (b2) added: the cross-member void soft-voids the pair and nets 0 per member per currency (rule 20). (d) uses a real cash-out shape (ACTIVE `WALLET_CASHOUT` txn + `recharges` source-ref'd ledger row): partly netted by $21 → profit 0; closed by the next settlement → that settlement's profit +1.50.
- [X] T034 [P] [US3] Write failing tests in the same file for directions:
  - (f) USD net −$40 (credits exceed debts) with `USD: {direction:"COLLECT", payments:[Cash 40]}`: closes everything; drawer +40.
  - (g) a direction that contradicts the remaining sign is refused.
  - (h) one call with `USD: PAY Cash 497` and `LBP: COLLECT Cash 2,000,000` against debts of $497 and credits of −2,000,000 LBP. Result: ONE transaction; USD drawer −497 and LBP drawer +2,000,000; one ledger row per member per currency, none mixing signs; both currencies settled.
  - (i) PAY $150 on $100 with change returned as 4,450,000 LBP Cash (OUT leg in LBP inside the USD section). Extra +$50 USD and −4,450,000 LBP are booked per currency (LIRA-315), and the LBP drawer goes −4,450,000.
  - (j) void of (h) nets to 0 in both currencies.
  - Done 2026-10-15 (same file). Failing first: (h)/(i2)/(j)/(j2) red on `Paying OMT in one currency and collecting from OMT in the other in one settlement is not available yet`, (f) red on the cross-member refusal; then green. (g) and (i) passed first (direction check / single-section LIRA-315 change already worked) — not proven failing-first. **(i) corrected**: the task text says "the LBP drawer goes −4,450,000"; on a PAY, OMT hands the change BACK, so the LBP drawer goes **+** (same as `SupplierRepository.cashflowChangeLegs.test.ts` and the leg loop's `-cashSign` for OUT legs). The test uses $150 on the $101 row with 4,361,000 LBP change: drawer USD −150 / LBP +4,361,000, ledger USD −150 (−101 applied, −49 overpay) / LBP +4,361,000. (i2) is the two-direction version (plus LBP COLLECT 2,000,000) and its void. (j2) refund also nets 0. Plus an LBP-section commission case (PAY 890,000 + commission 10,000 → allocation and profit in LBP, void nets 0) — passed first run, not proven failing-first.
- [X] T035 [P] [US3] Write a failing test for finding F4 in `AccountSettleSheet.lira322Commission.test.tsx`: entering commission 0.70 with Cash 496.30 sends `per_currency.USD.commission: 0.70`, and the preview closes all six rows. Mark "not proven failing-first (old sheet sent a different contract)". Also write the repository-level twin in `SupplierRepository.lira322AmountFirst.test.ts` (k) if not already covered.
  - Done 2026-10-15 in `AccountSettleSheet.lira322Commission.test.tsx` (2 tests). Not proven failing-first (old sheet sent a different contract; red only on missing testids). $496.30 + 0.70 sends `per_currency.USD.commission` and closes all six; without the commission the newest $21 stays part-paid ($0.70). Repository twin already exists as (k)/(l) in `SupplierRepository.lira322AmountFirst.test.ts`.
- [X] T036 [P] [US3] Write a failing test in `frontend/src/features/audit/__tests__/` (next to the existing badge tests) checking that a `SUPPLIER_SETTLEMENT` whose payments run both ways shows two badges side by side, **OUT $497.00 · IN 2,000,000 LBP**, each from its own payment legs, not the static settlement direction. A one-direction settlement shows one badge, as today.
  - Done 2026-10-15 in `audit/components/__tests__/CashFlowBadge.lira322MixedSettlement.test.tsx` (3 tests). Failing first: 2 red (`data-direction="out"` instead of `"mixed"`; no `cash-flow-badge-part`), then green. The one-direction guard (change in the other currency) passed before and after.

### Implementation

- [X] T037 [US3] In `_settleAccountAmountFirst` (SR), write netting coverage on both sides, and the cross-member auto pair (`is_auto=1`, note "Auto: netted with <member> in settlement #id", `transaction_id`). Write both pair rows with `settlement_id = anchor` and a `.changes` guard, so they never re-enter the queue. Sum the cash-out commission over closed credit rows only (reuse `_cashoutCommissionByLedgerId`, SR:4515) and add it to the profit stamp. Stop when T033 passes.
  - Done 2026-10-15. Netting refusal removed from `_planAmountFirstSection`; new `_writeAccountNettingPairs` writes, per allocator pair per currency, debit member −x `PAYMENT` / credit member +x `SUPPLIER_PAYS_US`, `is_auto=1`, `transaction_id`=settlement, `settlement_id`=anchor in the INSERT, `.changes` guard, note "Auto: netted with <name> in settlement #<txn id>". No `source_ref_*` (a +x SUPPLIER_PAYS_US linked to supplier_ledger would match `isSettlementCommissionCredit`). Cash-out commission was already summed over CLOSED credits only (allocator `cashout_commission_recognised`) — proven by T033 (d). Reversal owner: existing `_reverseSupplierSettlement` transaction_id scan.
- [X] T038 [US3] Support COLLECT and two directions:
  - direction per section;
  - one ledger row per member per currency with its own sign;
  - per-section drawer signs;
  - change legs inverted against their own section;
  - `metadata_json.per_currency` direction per currency.

  Confirm `_reversePayments` reverses legs by their own signed amounts without change, or fix it (rule 20). Stop when T034 passes.
  - Done 2026-10-15. Mixed-direction refusal removed. Per section: `dirSign` on the plan; waive ledger sign; drawers posted section by section (OUT legs inverted against their own section, any currency); extra accumulated in LEDGER sign (`−dirSign × flow extra`, incl. a change leg crossing into the other currency) and booked by the new `_insertSettlementOverpayRows` (one row per currency, own sign; `_bookSettlementOverpay` now delegates to it, legacy rows unchanged). A waive in two opposite-direction sections is refused ("A waive can't be used when you pay OMT in one currency and collect from OMT in the other — settle the waived currency on its own.") — one DISCOUNT row has one direction (test in lira322Netting, not proven failing-first). T033 (d) also voids the settlement that recognised the cash-out commission: profit back to 0, credit part-netted again. `_reversePayments` needed no change: it negates each `payments` row by its own signed amount (proved by (j)/(j2)/(i2)). Transaction-level: `amount_*` magnitudes; `metadata_json.per_currency.<CUR>.direction` per currency; `counterparty.flow` (CQ-8 allows IN/OUT only) = the USD section's direction when present, else the LBP one's; default note "(USD PAY / LBP COLLECT)" when mixed. Frontend badge: read the signed `payments` rows per currency (<0 OUT, >0 IN), falling back to `per_currency.<CUR>.direction` (PAY=OUT, COLLECT=IN) for a section with no legs.
- [X] T039 [US3] In Sheet:
  - each currency section shows its direction label ("You pay OMT $437.00" / "OMT pays you 2,000,000 LBP"), derived from the remaining sign and overridable only when nothing is owed in that currency;
  - drop the global `-direction-pay` / `-direction-collect` toggle; there is no direction toggle. Only a currency that owes 0 shows a small override (`-direction-pay-usd` / `-direction-collect-usd`, same for LBP);
  - add a per-section commission input (`-commission-usd` / `-commission-lbp`).

  Update the existing sheet suites. Stop when T035 passes.
  - Done 2026-10-15 with T020. There is no global toggle. Direction comes from the sign of what is owed. Only a currency that owes 0 shows `-direction-pay-<cur>` / `-direction-collect-<cur>`, both in its section and in the "Nothing owed in LBP" line. Each section has `-commission-<cur>`.
- [X] T040 [P] [US3] Update the IN/OUT badge for `SUPPLIER_SETTLEMENT` in `frontend/src/features/audit/` (`transactionPresentation.ts:295-298` / `CashFlowBadge.tsx`) so a settlement with legs in both directions shows two badges side by side (OUT per currency, IN per currency), each from its own legs. A one-direction settlement keeps one badge. Stop when T036 passes.
  - Done 2026-10-15. Pure helper `audit/settlementBadge.ts` (`mixedSettlementParts`). It applies only when `metadata_json.per_currency` has USD and LBP sections with OPPOSITE directions. Each part takes its direction and amount from that currency's signed legs, falling back to the section direction and the stored amount. `CashFlowBadge` renders ONE `cash-flow-badge` wrapper (`data-direction="mixed"`) holding two `cash-flow-badge-part`s, so existing e2e lookups still match one element. A void without legs inverts the fallback.
- [X] T041 [P] [US3] Add a `SUPPLIER_SETTLEMENT/account-amount-first` entry to `packages/core/src/constants/postingRules.ts` (next to the `system-model1` entry at ~940). It describes the rows written: anchor + member/currency rows, netting pair, coverage, commission credit stamped, overpay rows, legs. Run the posting-rules guard test if one exists (ask first).
  - Done 2026-10-15. `SUPPLIER_SETTLEMENT/account-amount-first`: drawers and supplier `unchecked` with reasons (per-section signs and per-member rows have no single formula; pinned by lira322AmountFirst / lira322Netting / lira322Invariant), partner/debt none, notes list coverage, stamps and the void path. `postingRules.guard.test.ts` 4/4.

---

## Phase 7: User Story 4 — One place to pay OMT (P2)

**Goal**: account members offer only Settle Account; others are unchanged.

**Independent test**: the OMT counter, OMT App and iPick show no Pay / Receive tab and no Commission settlement list. Katsh keeps both.

### Tests first

- [X] T042 [P] [US4] Write failing page tests in `frontend/src/features/suppliers/pages/Suppliers/__tests__/Suppliers.lira322AccountOnly.test.tsx`:
  - selecting the parent OMT or a child (OMT App, iPick) renders no "Pay / Receive" tab and no "Commission settlement" block, and the default tab is the transactions history;
  - the `supplier-account-settle-button` is present on the card;
  - selecting Katsh renders both as today.
  - Done 2026-10-15 in `Suppliers.lira322AccountOnly.test.tsx` (counter, OMT App, iPick, Katsh + 2 label tests). Failing first: the 3 member cases were red (`expect(received).toBeNull()` on "Pay / Receive"); the Katsh guard passed before and after.
- [X] T043 [P] [US4] Write a failing repository test in `SupplierRepository.lira322Netting.test.ts`:
  - (k) a manual Pay / Receive payment recorded earlier on the OMT counter (`recordSupplierCashflow` PAY $100, an open credit row) is netted at the next amount-first settlement against the oldest debt, and is never counted twice;
  - the balance invariant holds.
  - Done 2026-10-15 as (k) in `SupplierRepository.lira322Netting.test.ts`: `recordSupplierCashflow` PAY $100 on the counter is an open credit, nets 100 (NETTING, closes_row) against the oldest debt at the next amount-first settlement (Cash $397); drawers and the counter's balance move −497 in total, never −597; invariant holds; voiding the netted cashflow is then refused and writes nothing. Passed on its first run — not proven failing-first (the path already existed).

### Implementation

- [X] T044 [US4] In Page:
  - compute `isAccountMember = isSelectedAccountParent || accountChildSupplierIds.has(selectedSupplierId) || selectedSupplier?.account_supplier_id != null` (938-965);
  - hide the Pay / Receive tab entries (2150/2157), the `activeTab==="manual"` block (2711-2821) and the Commission Settlement block (2279-2510) for members;
  - make `selectSupplierFromList` (994-997) default members to the history tab.

  Keep `OmtStatementCheckPanel` and the ledger. Update `Suppliers.accountSettlement.test.tsx` and `Suppliers.settlePaymentReconciliation` only where they assumed those blocks for members. Stop when T042 passes.
  - Done 2026-10-15. Added `isAccountMember`; members get no Pay / Receive tab, no `manual` block and no Commission Settlement block. An effect moves a member off `manual`, so the history tab is always the default. `OmtStatementCheckPanel` and the ledger are kept. No existing page suite needed changes.
- [X] T045 [US4] Make T043 pass. Expected: no code beyond Phase 6, because these payments are already open credit rows in the queue. If it fails, fix it in `_settleAccountAmountFirst`.
  - Done 2026-10-15. No code needed beyond Phase 6 (T043 passed on its first run).

---

## Phase 8: User Story 5 — Pick transactions by hand (P3)

**Goal**: ticked rows restrict the scope. With nothing ticked, the whole account is in scope.

**Independent test**: tick the two $21 rows and pay $30. The older one closes, the other is part-paid $9, and nothing else is touched.

### Tests first

- [X] T046 [P] [US5] Add to `SupplierRepository.lira322AmountFirst.test.ts`:
  - (o) `selections` = the two $21 rows with Cash $30: oldest of the two closed, other partial $9, the other four untouched;
  - (p) `selections` that include a row of a type excluded by `covered_omt_service_types` is refused (existing LIRA-256 rule);
  - (q) a selected id not in the account queue is refused.
  - Done 2026-10-15 as (T046 o)/(T046 p)/(T046 q) in `SupplierRepository.lira322AmountFirst.test.ts`. All three passed on their first run (`_amountFirstScope` from T018) — not proven failing-first. (p) refusal text: "Cannot settle transfer #<id>: its commission type Western Union is not included in this statement"; (q): "A ticked transfer is no longer open on this account — reopen the sheet.". `expected_owed` must be computed over the SCOPED rows.
- [X] T047 [P] [US5] Write failing sheet tests in `AccountSettleSheet.lira322Picker.test.tsx`:
  - the sheet opens with NO rows ticked and a "Pick transfers" toggle (`supplier-account-settle-pick-toggle`);
  - ticking rows narrows the preview and sends `selections`;
  - "Clear" returns to the whole account and omits `selections`.
  - Done 2026-10-15 in `AccountSettleSheet.lira322Picker.test.tsx` (3 tests). Failing first: red on the old sheet (no `-pick-toggle`), then green.

### Implementation

- [X] T048 [US5] In Sheet, replace the always-pre-ticked row list with an optional picker:
  - collapsed by default;
  - rows show `remaining` with a "part-paid" marker;
  - covered-types waiting rows stay unpickable (`isWaitingRow`);
  - `expected_owed` is computed over the scoped rows.

  In SR `_settleAccountAmountFirst`, the scope already honours `selections` (T018). Verify (o)–(q). Stop when T046 and T047 pass.
  - Done 2026-10-15 with T020. "Pick transfers" is collapsed and unticked by default. Rows show remaining with "Part-paid" / "Credit" / "Waiting" markers, and waiting rows cannot be picked. Ticked rows set the scope, `expected_owed` and `selections`; "Clear — whole account" resets. Server-side (o)–(q) were already green (T046).

---

## Phase 9: Polish and cross-cutting

- [X] T049 [P] Write a property test in `packages/core/src/repositories/__tests__/SupplierRepository.lira322Invariant.test.ts`:
  - **Sequence**: a seeded random sequence of 30 amount-first settlements and newest-first voids over mixed USD/LBP rows and credits on two members.
  - **After every step, assert**:
    - per member and currency, the ledger sum equals Σ remaining on that member's queue rows;
    - Σ NETTING on debts equals Σ NETTING on credits;
    - no row has two active `closes_row=1` coverage rows (data-model invariants 1–4).
  - **On failure**: print the seed.
  - Done 2026-10-15 in `SupplierRepository.lira322Invariant.test.ts`: mulberry32, seeds 11/22/33/44 × 40 steps over USD+LBP debts and credits on the counter and OMT App (optional ticked scope, overpay, change in either currency, both directions); checks invariants 1–3 after every step, nothing written on a refusal, only an older settlement's void may be refused, and an unwind (void all newest first) back to the start on drawers, every member, profit and coverage. Non-vacuous floors (settled ≥ 30, voided ≥ 10, mixed ≥ 1, pairs ≥ 1); measured once: settled 74, voided 74, refused voids 14, refused settles 7, mixed-direction 17, pair rows 32. Refusals are allow-listed (settle: "There is nothing to settle…"; void: the newest-first and "partly paid by settlement" texts — the only ones seen in the measured run: 7 / 7 / 7); any other refusal, incl. "aborted"/"disagree"/"Failed to settle account", fails the run. Failure message names seed and step. ~0.35 s. Not proven failing-first (written after T037/T038). No commission or waive in the random mix.
- [X] T050 [P] Write web e2e `frontend/tests/e2e-web/lira-web-065-omt-amount-first-settle.spec.ts`:
  - USD-only settle with LBP owed;
  - $300 partial with the preview checked before confirming;
  - the Transactions "Partial · $47.00" label;
  - void of the older settlement refused, newest-first void allowed.

  Match rows by identity, never position, and assert deltas (rule 15).
  - Done 2026-10-15. One test over its own rows (three OMT SENDs owing $152/$101/$21 + an iPick LBP top-up): UI picks exactly those four, Cash $199 in the USD box previews closes / part-paid "$47 of $101 · $54 owed" / untouched, "$75.00" still owed and the LBP section untouched, before confirming; after: OMT drawer −$199 / 0 LBP, LBP row untouched, `per_currency` has only `USD`. Suppliers → OMT → Transactions shows "Partial · $47.00" / "Settled" / "Unpaid". A REST second settlement (B+C, $60), then voiding the first is refused ("Void it first", nothing changes), the second then the first are voided (rows, drawer and account back to the start), and a final both-currencies call settles all four (clean-up). Every settlement is scoped by ticks / `selections` (the account carries other specs' backlog). Passed on its first run (not a failing-first guard — written after the code).
- [X] T051 [P] Update `frontend/tests/e2e-web/lira-web-035-omt-account-settlement.spec.ts` and `lira-web-053-omt-statement-commission-types.spec.ts` to the new sheet (per-currency boxes, picker, commission per section). Keep each spec's original intent.
  - Done 2026-10-15. lira-web-035: the three REST tests send the amount-first payload (`per_currency` + `expected_owed` from the queue's `remaining_*` + `selections`); closed rows now share ONE `settlement_id` = the anchor the call returns (the old "distinct per member" assertion is inverted to that); amounts are whole cents (two 3-decimal rows could round a cent off the allocator's cent total); the hostile selection is refused by the scope check ("no longer open on this account"); the UI test ticks its row in "Pick transfers" (nothing pre-ticked), checks the USD owed figure narrows to exactly that row, the preview says "closes", and the drawer moves by exactly it. lira-web-053: the `settle-account` branch sends the amount-first payload with the commission in the USD section; the plain `/settle` branch is unchanged. Both green.
- [X] T052 [P] Update desktop `frontend/tests/e2e-electron/lira-189-omt-account-settlement.spec.ts`, and `lira-141` / `lira-158` / `helpers/katshSettlement.ts` where they drive Pay / Receive or Commission settlement on an OMT-account member. Not run on this Mac; say so in the report.
  - Done 2026-10-15. lira-189: `isolateSelection` opens "Pick transfers" and ticks only its rows; reads the USD section's owed figure and `-deferred-commission-usd`; pays in the USD section; the net-negative case asserts "OMT pays you" and no direction button (direction follows the sign). lira-158: settles its OMT SEND from the OMT card's Settle Account sheet (tick, `-commission-usd`, cash = owed − commission, preview "closes") instead of the hidden Commission Settlement list; D17 deferral still holds. lira-141 and `helpers/katshSettlement.ts`: no change (Katsh only; their OMT App part is the Recharge top-up modal). NOT run on Electron (never on this Mac); lira-189/141/158 are in the web suite's `web-shared` project and passed there over the web shim. Full web e2e after T050–T052: 454 passed / 0 failed in 11.5 min (147 web + 307 web-shared; `node scripts/run-e2e.mjs web view=off`, floor met).
- [X] T053 [P] Add the release note to `docs/release-notes/UNRELEASED.md` under a "## 💸 OMT / Whish & suppliers" heading (create it if absent):
  - "Settle Account for OMT now takes the amount you paid in $ and/or LBP and closes the oldest transfers in that currency — you can settle only $ or only LBP, and a transfer the money doesn't fully cover stays open showing what's left."
  - "For OMT, OMT App and iPick, payments are now made only from Settle Account."

  Then update `current_sprint.md` LIRA-322 (built/tests/What users will notice) (rule 30).
  - Done 2026-10-15. Seven lines under a new "## 💸 OMT / Whish & suppliers" heading (the released files use "💸 OMT / Whish & suppliers" — the heading named here was kept; rename at release if wanted). `node scripts/build-release-notes.cjs --check` passes (it compares released `v*.md` files with the generated JSON only; nothing to regenerate until `yarn release`). current_sprint.md LIRA-322 → BUILT (not committed).
- [X] T054 [P] Add a short "Amount-first account settlement" subsection to `docs/FEATURE_GUIDE.md` (near the supplier settlement section) covering:
  - per-currency rule;
  - coverage table and reversal owner;
  - newest-first void;
  - the netting pair as `is_auto`;
  - the guarding specs (lira-web-065, the lira322 jest files).
  - Done 2026-10-15: `docs/FEATURE_GUIDE.md` §8.2 "Amount-first account settlement" (payload, per-currency rule, direction, allocator, stale refusal, coverage table, ledger rows, netting pair as `is_auto`, commission, Suppliers status, void + reversal owner, guards). The §8.2 "OUT legs" row now says the rejection is the legacy payload's; amount-first allows CASH change legs.
- [X] T055 Run the full gates (ask first), as in CI. Record test counts and elapsed time for each (rule 28a):
  - `yarn lint`, `yarn typecheck`, `yarn build`;
  - `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`;
  - the core, backend, electron-handler and frontend jest suites in full, core and electron-handler above their suite/test-count floors;
  - `node scripts/build-release-notes.cjs --check`;
  - `browserEntryIsNodeFree.guard` and `constants/__tests__/moduleDebtTypes.guard.test.ts`.
  - Done 2026-10-15: lint 0 errors (28s); typecheck clean (38s); tenant-scoping 0 violations; bind-arity OK; schema-equivalence 99 tables zero diffs; release-notes check OK; `yarn build` OK; `yarn test` core 787/7569 (28s), electron 80/556 (12s), frontend 589/3593 (122s), mobile 5/41, backend 185/186 — the 1 failure (`signupInvitations.api` 401 vs 404, untouched area) passed 17/17 twice when re-run alone; web e2e full 454 passed (11.5 min).
- [X] T056 After deploy, run the manual checks in quickstart.md on test.liratek.shop (owner approves the deploy). Record what was seen.
- [X] T057 Owner decision 2026-10-15 (replaces FR-013a): "Pay the amount in full; don't let the commission amount affect the payment leg amount. After the payment is processed, the commission amount is credited to the supplier account."
  - Allocator: budget = paid ± waive; no `COMMISSION` takes (the CHECK value stays for old rows). Commission still drives `commission_alloc` over closed model-1 rows (profit).
  - Repository: step 4 no longer adds the commission to the member money row; `_bookAmountFirstCommission` writes ONE OPEN credit per currency (−c, `is_auto`, link-mode `transaction_id` = settlement, no `source_ref_*`, `settlement_id` NULL). `isSettlementCommissionCredit` unchanged (still hides only back-linked legacy credits). "Commission more than owed" refusal removed; "commission without a closed model-1 row" refusal kept (allocations per transfer feed the commission reports). Void: `_reverseSupplierSettlement` soft-voids the credit; once a later settlement netted it, `_assertNoActiveSettlementCoverage` refuses the earlier void.
  - Sheet: commission never changes lines, box totals or extra; only the "no closed transfer" warning remains.
  - Picker: `OmtCoveredTypesPicker` (one component: Settle Account sheet, OMT statement check panel, Suppliers Commission settlement for a non-account OMT supplier) now renders the shared `MultiSelect` (Audit type filter); `MultiSelect` gained an optional `getOptionLabel`. Nothing ticked = "All types". Test helper `features/suppliers/testing/coveredTypesPicker.ts`.
  - Failing first (rule 17): `SupplierRepository.lira322CommissionToAccount.test.ts` 6 red / 1 green (the kept refusal) on the old code, then 7/7; allocator "commission never covers rows" 3 red, then green. Tests that encoded commission-as-coverage were UPDATED (allocator table + sources + allocation weights, AmountFirst (k)(m), Netting LBP commission, AmountFirstVoid (d), sheet lira322Commission — sheet cases not proven failing-first, core resolves from source). Property test (lira322Invariant) now adds random commissions (≥3 commissioned settlements asserted).
  - Docs: spec (Clarifications, FR-013a, SC-003, edge case), research R3/R4/R6, data-model, contracts/allocator.md, FEATURE_GUIDE §8.2, postingRules, release notes, lira-web-053 and desktop lira-158 (pay gross).

---

## Dependencies and execution order

- **Phase 1 → Phase 2 → stories.** Phase 2 blocks everything.
- **US1 (Phase 3)** needs Phase 2. T008a is written in Phase 2 but runs green only after T018.
- **US2 (Phase 4)** needs US1's `_settleAccountAmountFirst` (T018) and sheet sections (T020).
- **US6 (Phase 5)** needs the coverage writes (T018/T026). It can run in parallel with US2's frontend tasks.
- **US3 (Phase 6)** needs US2 (commission path T026).
- **US4 (Phase 7)**: T044 is independent of the server and can start after Phase 2. T045 needs US3 netting.
- **US5 (Phase 8)** needs US2's preview (T029).
- **Polish** comes last. T049 needs US3 + US6.

## Parallel opportunities

- **Phase 2 tests**: T004, T005, T006, T007 and T008 are all different files. Then T010 and T012 in parallel with T009/T011/T013.
- **US1**: T015, T016 and T017 in parallel; T021 alongside T020.
- **US2**: T022, T023, T024 and T025 in parallel; T030 alongside T026–T029.
- **US3**: T033–T036 in parallel; T040 and T041 alongside T037–T039.
- **US4**: T042 in parallel with any US3 server task.
- **Polish**: T049–T054 in parallel.

## Implementation strategy

1. **MVP = Phase 1–5** (US1 + US2 + US6). It fixes the reported defect (settle one currency) and adds partial payment with safe voids. Stop, validate with quickstart steps 1–5 (ask before running suites), then ask the owner about deploying.
2. **Then US3**: netting, COLLECT, two directions, F4.
3. **Then US4**: hide the old paths.
4. **Then US5**: picker.
5. **Then polish.**

Each increment keeps the legacy payload working until US4 removes the last UI that sends it. The legacy server path stays as dead-but-tested code until a later cleanup ticket.
