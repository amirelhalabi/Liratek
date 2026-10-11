---
description: "Task list for LIRA-256 — OMT statement commission types"
---

# Tasks: OMT statement commission types (LIRA-256)

**Input**: `specs/256-omt-statement-commission-types/` — spec.md, plan.md, research.md, data-model.md, contracts/supplier-commission-types.md, quickstart.md

**Prerequisites**: read CLAUDE.md rules 13–30, `docs/FEATURE_GUIDE.md` §8.1/§9/§10/§13 (this is money), and research.md R1 (why uncovered rows are REFUSED, not settled at 0).

**Tests**: REQUIRED. CLAUDE.md rule 17 — every guard test is written first and **run red against the unfixed code; record the real failure message in the task's completion note** before its implementation task starts. Never revert or stash finished code to prove a test. A test that cannot be red first (pure regression net) must say "not proven failing-first".

**Commands** (repo root, Mac, Node ABI — `yarn rebuild:node` once):
- core: `yarn workspace @liratek/core test --runTestsByPath <path relative to packages/core>`
- backend: `yarn workspace @liratek/backend test --runTestsByPath <path relative to backend>`
- electron handlers: `yarn workspace @liratek/electron-app test --runTestsByPath <path relative to electron-app>`
- frontend: `yarn workspace @liratek/frontend test --runTestsByPath <path relative to frontend>`
- core build & sync after ANY core edit: `cd packages/core && npm run build` then from root `cp -r packages/core/dist/. node_modules/@liratek/core/dist/`
- Confirm every green run actually executed the new `it(...)` titles and print elapsed time (rule 28a).

**Never** run desktop e2e or launch Electron on this Mac (owner rule). Never `git commit`/push (the parent commits).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 = statement check by type (P1), US2 = settle by type (P2)

---

## Phase 1: Setup

**Purpose**: Record the baseline so "unchanged when no choice is made" (S3, SC-004) is measurable.

- [X] T001 Run the current suites and record suite/test counts and elapsed time in a "Baseline" note appended to `specs/256-omt-statement-commission-types/research.md` (new section R10): core `src/repositories/__tests__/SupplierRepository.accountExpectedStatement.test.ts`, `src/repositories/__tests__/SupplierRepository.settlement.test.ts`, `src/repositories/__tests__/SupplierRepository.accountSettlement.test.ts`, `src/repositories/__tests__/TransactionRepository.supplierSettlementReversal.test.ts`, `src/repositories/__tests__/TransactionRepository.accountSettlementReversal.test.ts`, `src/__tests__/browserEntryIsNodeFree.guard.test.ts`; backend `src/api/__tests__/suppliers.api.test.ts`; frontend `src/features/suppliers` (whole folder). Also confirm the last entry in `packages/core/src/db/migrations/index.ts` is still v209 (this feature adds no migration).

---

## Phase 2: Foundational (blocks both stories)

**Purpose**: one definition of the type list, one "is this row covered" predicate, one shared schema (rule 14, rule 21).

### Tests first

- [X] T002 [P] Write failing test `packages/core/src/utils/__tests__/omtCoveredTypes.test.ts` for the new module `packages/core/src/utils/omtCoveredTypes.ts`: (1) `isOmtRowCovered(row, undefined)` → true for any row; (2) `{ provider: "WHISH", omt_service_type: null }` with `["INTRA"]` → true (only OMT rows have types); (3) `{ provider: "OMT", omt_service_type: "INTRA" }` with `["INTRA"]` → true, with `["WESTERN_UNION"]` → false; (4) `{ provider: "OMT", omt_service_type: null }` with `["INTRA"]` → false, with `["INTRA","UNSPECIFIED"]` → true; (5) `normaliseCoveredTypes(["WESTERN_UNION","INTRA","INTRA"])` → `["INTRA","WESTERN_UNION"]` (de-duplicated, ordered by `OMT_SERVICE_TYPES` then `"UNSPECIFIED"` last); (6) `coveredTypeLabel("UNSPECIFIED")` → `"Type not recorded"`, `coveredTypeLabel("WESTERN_UNION")` → `"Western Union"`; (7) parity guard: `OMT_SERVICE_TYPES` equals, as a set, the values inside the `omt_service_type TEXT CHECK(omt_service_type IN (...))` clause read from `electron-app/create_db.sql`. Run red (module missing).
- [X] T003 [P] Write failing test `packages/core/src/validators/__tests__/supplier.coveredTypes.test.ts`: `omtCoveredTypesSchema` accepts every value of `OMT_SERVICE_TYPES` and `"UNSPECIFIED"`, rejects `[]` and `["BOGUS"]`; `supplierSettleSchema.parse({...validFixture, covered_omt_service_types: ["INTRA"]})` KEEPS the key (Zod strips unknown keys silently — rule 23) and parses without it; same two checks for `supplierSettleAccountSchema`; `createFinancialServiceSchema` (`packages/core/src/validators/financial.ts`, owns `omtServiceType`) still accepts each value of `OMT_SERVICE_TYPES` — iterate the tuple, never hand-type the names (rule 24). Run red.

### Implementation

- [X] T004 In `packages/core/src/utils/omtFees.ts` add `export const OMT_SERVICE_TYPES = ["INTRA","WESTERN_UNION","CASH_TO_BUSINESS","CASH_TO_GOV","OMT_WALLET","OMT_CARD","OGERO_MECANIQUE","ONLINE_BROKERAGE"] as const;` and redefine `export type OmtServiceType = (typeof OMT_SERVICE_TYPES)[number];` (same 8 values, same order as today's union; no behaviour change).
- [X] T005 Create `packages/core/src/utils/omtCoveredTypes.ts` (pure leaf: imports ONLY from `./omtFees.js`; no Node built-in, no db import — rule 29): `export const OMT_COVERED_TYPE_VALUES = [...OMT_SERVICE_TYPES, "UNSPECIFIED"] as const`, `export type OmtCoveredType`, `isOmtRowCovered(row: { provider: string | null; omt_service_type: string | null }, covered: readonly OmtCoveredType[] | undefined): boolean` (truth table in data-model.md), `normaliseCoveredTypes`, `coveredTypeLabel`. Export it from BOTH `packages/core/src/index.ts` and `packages/core/src/browser.ts`.
- [X] T006 In `packages/core/src/validators/financial.ts` replace the inline 8-value `z.enum([...])` of `omtServiceType` with `z.enum(OMT_SERVICE_TYPES)` (import from `../utils/omtFees.js`). In `packages/core/src/validators/supplier.ts` add `export const omtCoveredTypesSchema = z.array(z.enum(OMT_COVERED_TYPE_VALUES)).min(1);` and `export type OmtCoveredTypesInput = z.input<typeof omtCoveredTypesSchema>;`, and add `covered_omt_service_types: omtCoveredTypesSchema.optional()` to `supplierSettleSchema` and `supplierSettleAccountSchema`, each with a comment citing LIRA-256 and "absent = all types = unchanged behaviour (S3)". Confirm both are re-exported through `packages/core/src/validators/index.ts`. Also derive the values of `OMT_SERVICE_OPTIONS` in `frontend/src/features/services/pages/Services/index.tsx` (~L57) from `OMT_SERVICE_TYPES` (keep its existing rate-suffix labels) so there is one list (rule 14).
- [X] T007 Rule 23 three-way key diff for `suppliers:settle-transactions` and `suppliers:settle-account`: list keys of (a) the two schemas, (b) the `data` types of `settleTransactions` and `settleAccount` in `electron-app/preload.ts`, (c) `SettleTransactionsData` and `SettleAccountData` in `packages/core/src/repositories/SupplierRepository.ts`. Add `covered_omt_service_types?: OmtCoveredType[]` to both repository interfaces (doc comment: "LIRA-256 — when present, the batch is refused if a model-1 OMT row's type is not covered; see `_assertRowsCoveredByStatement`"). Write the diff result (any other pre-existing mismatch found = report it in the completion note, do not invent support — rule 23 corollary).
- [X] T008 In `electron-app/schemas/index.ts` re-export `omtCoveredTypesSchema` as `OmtCoveredTypesSchema` with the zod-major cast pattern used by `SupplierSettleSchema` (`as unknown as z.ZodSchema<...>`).
- [X] T009 Core build & sync; run T002 and T003 green; run `src/__tests__/browserEntryIsNodeFree.guard.test.ts` green (new leaf reachable from `browser.ts`); run `yarn workspace @liratek/core typecheck`.

**Checkpoint**: shared constants, predicate and schema exist; no behaviour has changed.

---

## Phase 3: User Story 1 — Check OMT's SMS when it covers only some types (P1) 🎯 MVP

**Goal**: the statement check subtracts only covered types' unsettled commission and shows each type's amount. Display only.

**Independent test**: quickstart §1, §3 (read part), §4 (panel), and lira-web-053 steps 1–2.

### Tests first (all red before T014)

- [X] T010 [US1] Extend `packages/core/src/repositories/__tests__/SupplierRepository.accountExpectedStatement.test.ts` with a `describe("LIRA-256 covered types")` block using the REAL writer `FinancialServiceRepository.createTransaction` with real `omtServiceType`/`omtFee` so the stored estimate is non-zero (never `commission: 0` fixtures): an INTRA USD SEND, a WESTERN_UNION USD SEND, an INTRA LBP SEND, and one OMT SEND created without `omtServiceType` but with an explicit `commission` (NULL type). Read each row's stored `commission` back by id and assert: (1) `getAccountExpectedStatement(id, ["INTRA"])` → `unsettled_commission_usd` = INTRA USD row's commission, `unsettled_commission_lbp` = INTRA LBP row's commission, `expected_* = gross_* − commission_*`; (2) `getAccountExpectedStatement(id)` and `(id, undefined)` → equal to the sum of all four (today's figure, S3) and `covered_omt_service_types === null`; (3) `["UNSPECIFIED"]` → only the NULL-type row's commission; (4) `commission_by_type` lists INTRA (count 2, usd+lbp), WESTERN_UNION (count 1), UNSPECIFIED (count 1) whatever the choice; (5) in its OWN `it(...)` with its own rows (so (1)–(4)'s expected values stay exact), raw-insert an `OMT_APP` `service_type = 'BILL'`, `commission_model = 1` pending row with `commission = 0.40` on a commission-eligible OMT App member of the account and assert its 0.40 is included in `unsettled_commission_usd` under EVERY choice (non-OMT members are never filtered); (6) S9 (analyze re-check, supersedes S7), in its OWN `it(...)` with its own rows: raw-insert a legacy `commission_model = 0` OMT WESTERN_UNION SEND (x=100, f=5, c=0.5) WITH its net ledger TOP_UP (104.50, the shape `SUPPLIER_OWED_EXPR`'s legacy branch documents) and assert expected = 104.50 under no choice and under `["WESTERN_UNION"]` (no double subtraction), and 105.00 under `["INTRA"]` (commission added back) (FR-014). Run red.
- [X] T011 [P] [US1] Extend `backend/src/api/__tests__/suppliers.api.test.ts`: `GET /api/suppliers/:id/account-expected-statement?covered=INTRA,WESTERN_UNION` calls `supplierService.getAccountExpectedStatement` with `(id, ["INTRA","WESTERN_UNION"])` and returns `{ success: true, statement }`; without `covered` → called with `(id, undefined)`; `?covered=BOGUS` and `?covered=` → HTTP 200 `{ success: false, error }` and the service is NOT called. Run red.
- [X] T012 [P] [US1] Create `electron-app/handlers/__tests__/supplierHandlers.coveredTypes.test.ts` (pattern: `electron-app/handlers/__tests__/omtHandlers.test.ts` — mock `electron`'s `ipcMain.handle`, `@liratek/core`'s `getSupplierService`, `../../session`'s `requireRole`): `suppliers:account-expected-statement` invoked with `(event, 7, ["INTRA"])` forwards `(7, ["INTRA"])`; with `(event, 7)` forwards `(7, undefined)`; with `(event, 7, ["BOGUS"])` REJECTS (`await expect(...).rejects.toThrow()`) without calling the service (raw-shape read — see T016). Run red.
- [X] T013 [P] [US1] Extend `frontend/src/features/suppliers/components/__tests__/OmtStatementCheckPanel.test.tsx` (its `useApi` mock MUST return one stable object — rule 25): (1) the picker shows "All types", the 8 type labels and "Type not recorded"; (2) ticking only Intra makes `getSupplierAccountExpectedStatement` be called with `(id, ["INTRA"])` and the commission/expected lines render the mocked response; (3) each option shows the amount and count from `commission_by_type`; (4) the choice is saved to `localStorage` key `liratek:omt-covered-types:<accountSupplierId>` and restored on remount; (5) a `localStorage` that throws on get/set does not break rendering (falls back to "All types"); (6) "All types" calls the read with ONE argument, `toHaveBeenCalledWith(id)` — so the file's existing `toHaveBeenCalledWith(1)` assertion stays valid unedited. Run red.

### Implementation

- [X] T014 [US1] `packages/core/src/repositories/SupplierRepository.ts`: change `getAccountExpectedStatement(accountSupplierId: number, coveredTypes?: OmtCoveredType[])`. Inside the EXISTING per-member loop over `getUnsettledBySupplier(member.provider)` (no new query, rule 14): for rows with `provider === "OMT"`, always accumulate into a `commission_by_type` map keyed by `omt_service_type ?? "UNSPECIFIED"` (usd/lbp by `row.currency`, count), and add to the totals only when `isOmtRowCovered(row, coveredTypes)` — EXCEPT legacy rows (`commission_model === 0`, booked net): add 0 when covered and SUBTRACT the commission when not (S9); non-OMT rows accumulate into the totals exactly as today. Return `covered_omt_service_types: coveredTypes ? normaliseCoveredTypes(coveredTypes) : null` and `commission_by_type` sorted by `OMT_COVERED_TYPE_VALUES` order. Extend the `AccountExpectedStatement` interface and its doc comment (replace "don't split by type yet — LIRA-256" with the LIRA-256 rule and the S9 legacy rule). The zeroed graceful-degrade return must also carry `covered_omt_service_types: null, commission_by_type: []`. Update the existing zeroed-statement `toEqual` in `SupplierRepository.accountExpectedStatement.test.ts` (~L397–408) to include those two keys — this is the ONE sanctioned edit to a pre-existing assertion (the read gains two always-present keys; every existing VALUE is unchanged); name it in T040's note.
- [X] T015 [US1] `packages/core/src/services/SupplierService.ts`: `getAccountExpectedStatement(accountSupplierId, coveredTypes?)` passes both through.
- [X] T016 [US1] `electron-app/handlers/supplierHandlers.ts` `suppliers:account-expected-statement`: accept `(_e, accountSupplierId: number, coveredTypes?: unknown)`; when `coveredTypes !== undefined`, `validatePayload(OmtCoveredTypesSchema, coveredTypes)` and on failure THROW an `Error(v.error)` (this is a raw-shape read: the IPC promise rejects and the query enters its error state — never return an envelope where a statement is expected); call the service with the parsed value. No role gate (unchanged).
- [X] T017 [US1] `backend/src/api/suppliers.ts` `GET /:id/account-expected-statement`: read `req.query.covered`; absent → `undefined`; present → accept `string` or `string[]` (Express parses `?covered=A&covered=B` as an array), flatten, split each on `,`, trim, `omtCoveredTypesSchema.safeParse`; failure → `res.json({ success: false, error })` (HTTP 200, rule 6); pass the parsed array to the service.
- [X] T018 [P] [US1] `electron-app/preload.ts`: `getAccountExpectedStatement: (accountSupplierId: number, coveredTypes?: OmtCoveredTypesInput) => ipcRenderer.invoke("suppliers:account-expected-statement", accountSupplierId, coveredTypes)`; add `OmtCoveredTypesInput` to preload's EXISTING `import type … from "@liratek/core"` block (keep its resolution-mode attribute); same signature in `frontend/src/types/electron.d.ts` (rule 12), and add `covered_omt_service_types` + `commission_by_type` to `electron.d.ts`'s own `AccountExpectedStatement` copy (~L349).
- [X] T019 [P] [US1] `packages/ui/src/api/types.ts`: add OPTIONAL `covered_omt_service_types?: string[] | null` and `commission_by_type?: Array<{ omt_service_type: string; commission_usd: number; commission_lbp: number; count: number }>` to the `AccountExpectedStatement` mirror (optional so existing typed test fixtures still compile; components read them with `?? null` / `?? []`); change `ApiAdapter.getSupplierAccountExpectedStatement` to `(accountSupplierId: number, coveredTypes?: OmtCoveredTypesInput) => Promise<AccountExpectedStatement>` with `OmtCoveredTypesInput` imported from `@liratek/core` (rule 21; confirm it resolves through `browser.ts`).
- [X] T020 [US1] `frontend/src/api/backendApi.ts` `getSupplierAccountExpectedStatement(accountSupplierId, coveredTypes?)`: IPC passes `coveredTypes` as the 2nd argument; REST appends `?covered=${coveredTypes.join(",")}` only when defined (ONE call site, `ipcOrHttp` is the only branch — rule 22); in the REST branch THROW when `res.success === false` (instead of falling back to zeros), and add `covered_omt_service_types: null, commission_by_type: []` to the existing zeroed fallback literal. Update `frontend/src/api/ElectronApiAdapter.ts` to forward the new argument.
- [X] T021 [US1] `frontend/src/features/suppliers/hooks/useSuppliers.ts`: `useSupplierAccountExpectedStatementQuery(accountSupplierId, coveredTypes?)` — call `api.getSupplierAccountExpectedStatement(id)` with ONE argument when `coveredTypes` is undefined and `(id, coveredTypes)` otherwise; query key becomes `[...SUPPLIER_KEYS.accountExpectedStatement(id), coveredTypes ? normaliseCoveredTypes(coveredTypes).join(",") : "ALL"]`; confirm `invalidateAccountQueries` still invalidates it (prefix match on the first two elements).
- [X] T022 [P] [US1] Create `frontend/src/features/suppliers/utils/omtCoveredTypesStorage.ts`: `loadCoveredTypes(accountSupplierId): OmtCoveredType[] | undefined` and `saveCoveredTypes(accountSupplierId, value | undefined)`, key `liratek:omt-covered-types:<accountSupplierId>`, every read/write in try/catch, invalid stored JSON or unknown values → `undefined` (= All types). Per-device convenience only (CLAUDE.md browser-storage rule).
- [X] T023 [P] [US1] Create `frontend/src/features/suppliers/components/OmtCoveredTypesPicker.tsx` (default export, rule 7): props `{ value: OmtCoveredType[] | undefined; onChange; byType?: AccountExpectedStatement["commission_by_type"]; testIdPrefix: string }`; an "All types" option (value `undefined`) plus one checkbox per `OMT_COVERED_TYPE_VALUES` entry labelled with `coveredTypeLabel`, showing count and amount when `byType` has the type; unticking the last box returns to "All types" (never sends `[]`). `data-testid`s: `${testIdPrefix}-all`, `${testIdPrefix}-${TYPE}`.
- [X] T024 [US1] `frontend/src/features/suppliers/components/OmtStatementCheckPanel.tsx`: state initialised lazily from `loadCoveredTypes` (no setState in an effect), picker above the three figures with heading "Which shares does this SMS include?", pass the choice to the query, save on change; update the doc comment (LIRA-256). `testIdPrefix="omt-statement-covered"`.
- [X] T025 [US1] Core build & sync; run T010–T013 green; `yarn workspace @liratek/core typecheck`, frontend typecheck.

**Checkpoint**: US1 complete and shippable alone (display only).

---

## Phase 4: User Story 2 — Settle only the covered types' transfers (P2)

**Goal**: a settlement naming covered types is refused if it contains an uncovered model-1 OMT transfer; uncovered transfers stay queued at gross; commission splits only over settled rows; the choice is stamped on the settlement; void nets to 0.

**Independent test**: quickstart §2, §3 (settle part), §4 (sheets), lira-web-053 steps 3–5.

### Tests first (all red before T033)

- [X] T026 [US2] Create `packages/core/src/repositories/__tests__/SupplierRepository.coveredTypesSettlement.test.ts` on the full v150+ schema (fixture/setup copied from `SupplierRepository.commissionAtSettlement.test.ts` for `settleTransactions` — NOT `SupplierRepository.settlement.test.ts`, whose schema predates v150 and cannot hold model-1 rows — and from `SupplierRepository.accountSettlement.test.ts` for `settleAccount`; add the `omt_service_type` column to a copied fixture if it lacks it), rows created with the REAL writer and real `omtServiceType`/`omtFee`. Cases: (a) `settleTransactions({ …, financial_service_ids: [intraId, wuId], covered_omt_service_types: ["INTRA"] })` throws an error whose message contains `#${wuId}` and `Western Union`; afterwards the counts of `supplier_ledger`, `payments`, `supplier_settlements`, `settlement_commission_allocations` and `transactions` are unchanged and both rows still have `settlement_id IS NULL`; (b) same refusal through `settleAccount` with FINANCIAL_SERVICE selections for both rows; (c) `settleTransactions` with `[intraId]`, commission 1.37, `covered ["INTRA"]` succeeds: allocations Σ = 1.37 exactly and only on `intraId`; the SUPPLIER_SETTLEMENT transaction's `metadata_json.covered_omt_service_types` deep-equals `["INTRA"]`; the WU row's `settlement_id` stays NULL and its stored `commission` is unchanged; (d) no `covered_omt_service_types` with both rows → today's behaviour: both settled, both get allocation rows, metadata has no `covered_omt_service_types` key; (e) a NULL-type row is refused under `["INTRA"]` (message contains `Type not recorded`) and accepted under `["INTRA","UNSPECIFIED"]`; (f) a legacy model-0 OMT batch (raw-insert two `commission_model = 0` OMT rows into the same fixture, commission > 0: one INTRA, one WESTERN_UNION) with `covered ["INTRA"]` is NOT refused (S5) and stamps the metadata; (g) `["WESTERN_UNION","INTRA","INTRA"]` is stamped as `["INTRA","WESTERN_UNION"]`; (h) `settleAccount` with an OMT App LEDGER selection plus an INTRA row and `covered ["INTRA"]` succeeds (LEDGER rows never restricted); (i) `settleAccount` with FS rows from TWO members — the OMT INTRA and WESTERN_UNION model-1 rows plus an OMT App legacy cost-flow FS row raw-inserted with `supplier_debt_booked = 1` (the `getUnsettledBySupplier` UNION branch) — commission 0, `covered ["INTRA"]` → refused naming the WU row, nothing written (this is the path where `commissionSupplierId` is null and `_resolveSettlementBatchModel` never runs); (j) covered-types settle → void through `settleAccount` (INTRA-only, `covered ["INTRA"]`): supplier balances, Primary Cash Drawer and allocation rows return to pre-settle values per currency (FR-012 on the owner's main screen). Run red (record: (a)/(b)/(e)/(i) settle instead of throwing; (c)/(g) metadata key missing). (d)/(h)/(j): not proven failing-first — regression nets that pass on today's code.
- [X] T027 [US2] Extend `packages/core/src/repositories/__tests__/TransactionRepository.supplierSettlementReversal.test.ts` with a LIRA-256 case: an INTRA USD SEND, an INTRA LBP SEND and a WESTERN_UNION USD SEND; settle the two INTRA rows with `covered ["INTRA"]`, commission 1.37 USD + 15,000 LBP, cash legs; snapshot before settle, then void the SUPPLIER_SETTLEMENT; assert per currency: supplier balance delta 0, Primary Cash Drawer delta 0, `settlement_commission_allocations` rows for this settlement = 0 after the void, and the SUPPLIER_SETTLEMENT transaction is VOIDED (so its `profit_usd`/`profit_lbp` stop counting — the generic profit reversal); the end-to-end Profits figure is proven by lira-web-053 step 5; the WU row's `settlement_id`, `is_settled` and `commission` are identical at every snapshot. Add an assertion that the metadata stamp existed before the void (this is the line that is red first; the net-zero part is a regression net — label it "net-zero: not proven failing-first, existing reversal code is unchanged").
- [X] T028 [P] [US2] Extend `backend/src/api/__tests__/suppliers.api.test.ts`: `POST /api/suppliers/:id/settle` and `POST /api/suppliers/:id/settle-account` with `covered_omt_service_types: ["INTRA"]` reach the service spy WITH the key (rule 23 — Zod must not strip it); `covered_omt_service_types: []` and `["BOGUS"]` return the same `{ success: false }` shape `validateRequest` returns for any invalid field (copy the assertion style of the file's existing invalid-commission case) and the service is not called. Build the expected payload from the schema's own keys (`Object.keys(supplierSettleSchema.shape)`), not hand-typed names (rule 24). Not proven failing-first: forwarding is automatic once T006 lands (route spreads the validated body); this is a rule-23 regression net.
- [X] T029 [P] [US2] Extend `electron-app/handlers/__tests__/supplierHandlers.coveredTypes.test.ts`: `suppliers:settle-transactions` and `suppliers:settle-account` (with `requireRole` mocked ok/admin) forward `covered_omt_service_types` to `service.settleTransactions`/`service.settleAccount`; an invalid value returns `{ success: false, error }` and the service is not called. Not proven failing-first: forwarding is automatic once T006 lands (handler spreads `...v.data`); this is a rule-23 regression net.
- [X] T030 [P] [US2] Create `frontend/src/features/suppliers/components/__tests__/AccountSettleSheet.coveredTypes.test.tsx` (stable `useApi` mock, rule 25; fixtures shaped like `AccountUnsettledRow` with the new `omt_service_type`/`commission_model` fields): storage pre-set to `["INTRA"]` → INTRA FS rows and LEDGER rows start ticked, the WESTERN_UNION model-1 row is disabled and shows "Waiting — not in this statement"; submitting sends `covered_omt_service_types: ["INTRA"]` and `selections` without the WU row; switching to "All types" enables the WU row and the payload has NO `covered_omt_service_types` key; a model-0 WU row is never disabled. Assert payload keys against `supplierSettleAccountSchema.shape` (rule 24). Run red.
- [X] T031 [P] [US2] Create `frontend/src/features/suppliers/pages/Suppliers/__tests__/Suppliers.settleCoveredTypes.test.tsx` (render setup from `Suppliers.commissionAtSettlement.test.tsx`, BUT its `useApi` mock MUST return ONE module-level stable object — copy the `mockApi` pattern from `OmtStatementCheckPanel.test.tsx`, NOT that file's inline object literal; rule 25): with the OMT supplier selected on the Settle tab, the picker appears; with `["INTRA"]` chosen, "Select all" selects only covered rows, uncovered model-1 rows are disabled with "Waiting — not in this statement" and are dropped from the selection when the choice changes; nothing is pre-selected (unchanged Settle-tab behaviour); and `settleTransactions` receives `covered_omt_service_types` when not "All types"; with a non-OMT supplier (e.g. Katsh) no picker renders and the payload never carries the key. Run red.
- [X] T032 [US2] Write the web e2e `frontend/tests/e2e-web/lira-web-053-omt-statement-commission-types.spec.ts` NOW (before T033) and run it red with `yarn test:e2e:web -g "lira-web-053"` (expected red step: the refused settlement succeeds). Spec (REST only, IPC-identical envelopes, rule 15 deltas + identity; unique amounts for this file, e.g. INTRA SEND x = 461 with its table fee, WESTERN_UNION SEND x = 517 with `omtFee` 9; header comment names the desktop twin): (1) snapshot `GET /api/suppliers/:omtId/account-expected-statement?covered=INTRA` and without `covered`; create both SENDs; read each row's `commission` from `/api/suppliers/unsettled?provider=OMT` by id; assert the covered=INTRA commission delta = INTRA row's commission only, the all-types delta = both; (2) `commission_by_type` INTRA and WESTERN_UNION counts each rose by 1; (3) `POST /api/suppliers/:omtId/settle` with `[intraId, wuId]`, `covered_omt_service_types: ["INTRA"]` → `success: false`, error contains `#${wuId}`; OMT supplier balance unchanged; (4) settle `[intraId]` with `covered ["INTRA"]`, LUMP commission 1.11, CASH net leg → success; the WU row is still in the unsettled list with `settlement_id` null; the settlement transaction's metadata has `covered_omt_service_types: ["INTRA"]`; (5) void the settlement (same endpoint lira-web-052 uses) → OMT balance, Primary Cash Drawer and Profits "Commission (at settlement)" deltas are 0 vs the pre-settle snapshot (unlock Profits once at the start, as lira-web-052 does; wide date window, no server-clock dependency — rule 27); (6) repeat steps 3–5 through `POST /api/suppliers/:omtId/settle-account` (FINANCIAL_SERVICE selections; WU selected → refused; INTRA-only → success; void → deltas 0). Note: the red run settles rows in that run's DB — expected; rows are matched by identity. Leave both SENDs queued (same precedent as lira-web-052; later specs match by identity).

### Implementation

- [X] T033 [US2] `packages/core/src/repositories/SupplierRepository.ts`: add `omt_service_type: string | null` to `EligibleSettlementRow` and to the SELECT in `_resolveSettlementBatchModel` (`SELECT id, provider, service_type, commission, commission_model, currency, omt_service_type …`). Project the column through a PRAGMA guard (`_financialServicesHasOmtServiceTypeColumn()`, checked on every call like `_hasCommissionAtSettlementSchema` — no caching, tests swap databases): `omt_service_type` when the column exists, else `NULL AS omt_service_type` — `TransactionRepository.accountSettlementReversal.test.ts`'s fixture has the v150 tables but no such column and must stay green UNEDITED. No other change to that method.
- [X] T034 [US2] Same file: add `private _assertRowsCoveredByStatement(rows: EligibleSettlementRow[], covered: OmtCoveredType[] | undefined): void` — returns immediately when `covered === undefined`; considers only rows with `commission_model === 1`; uses `isOmtRowCovered` (never a re-typed condition, rule 14); on any offender throws `DatabaseError` with `Cannot settle transfer #<lowest id>: its commission type <coveredTypeLabel(type ?? "UNSPECIFIED")> is not included in this statement` plus ` (and N more)` when several. Signature takes structural rows `{ id: number; provider: string | null; omt_service_type: string | null; commission_model: number | null }[]` (satisfied by both `EligibleSettlementRow` and the T036 `AccountUnsettledRow`). Call it in `settleTransactions` immediately after `_resolveSettlementBatchModel` (pre-try tier, so the message reaches the caller verbatim like the mixed-model error). In `settleAccount`, call it right after step 0 (`selectedRows` built) on EVERY selected `kind === "FINANCIAL_SERVICE"` row (mapping `provider = source_provider`), independent of commission scope and member count, before any write — NOT on `commissionEligibleRows`, which is empty when FS selections span two members. Do NOT touch `_bookCommissionAtSettlement` or any reversal code (research R1).
- [X] T035 [US2] Same file: in the `metadata_json` object of the SUPPLIER_SETTLEMENT transaction written by `settleTransactions` and by `settleAccount`, add `...(data.covered_omt_service_types ? { covered_omt_service_types: normaliseCoveredTypes(data.covered_omt_service_types) } : {})` (informational; nothing reads it for money).
- [X] T036 [US2] Same file, `getAccountUnsettled`: add `omt_service_type: row.omt_service_type ?? null` and `commission_model: row.commission_model` to FINANCIAL_SERVICE rows and `omt_service_type: null, commission_model: null` to LEDGER rows; extend the `AccountUnsettledRow` interface; mirror both fields as OPTIONAL (`?:`) in `packages/ui/src/api/types.ts` `AccountUnsettledRow` and in `frontend/src/types/electron.d.ts`'s own `AccountUnsettledRow` copy (~L328), so existing typed fixtures keep compiling; components read them with `?? null`.
- [X] T037 [P] [US2] `electron-app/preload.ts`: add `covered_omt_service_types?: OmtCoveredTypesInput` to the `data` types of `settleTransactions` and `settleAccount`; same in `frontend/src/types/electron.d.ts` (rule 12). Re-run T007's diff and confirm all three key sets now agree.
- [X] T038 [US2] `frontend/src/features/suppliers/components/AccountSettleSheet.tsx`: picker (`testIdPrefix="supplier-account-settle-covered"`) initialised lazily from `loadCoveredTypes(account.account_supplier_id)`; initial selection = rows where NOT (`kind === "FINANCIAL_SERVICE" && commission_model === 1 && !isOmtRowCovered({ provider: source_provider, omt_service_type }, covered)`) — oldest-first order unchanged; such rows render disabled with "Waiting — not in this statement"; changing the choice re-derives the selection and saves it; the submit payload (built ONCE, rule 22) includes `covered_omt_service_types` only when the choice is not "All types".
- [X] T039 [US2] `frontend/src/features/suppliers/pages/Suppliers/index.tsx` Settle tab: when the selected supplier's `provider === "OMT"`, render the same picker (`testIdPrefix="supplier-settle-covered"`, storage keyed by the OMT supplier id). Do NOT add auto pre-selection (the tab starts empty today; FR-003). When a covered choice is set, exclude uncovered model-1 rows (row's existing `omt_service_type` and `commission_model`, via `isOmtRowCovered`) from `selectableUnsettled` so "Select all" picks covered rows only, render them disabled with "Waiting — not in this statement", and drop them from `selectedSettleIds` when the choice changes; add `covered_omt_service_types` to the existing `settleTransactions.mutateAsync({...})` payload only when not "All types". Non-OMT suppliers: unchanged, no picker.
- [X] T040 [US2] Core build & sync; run T026–T031 green; re-run T032 green (`1 passed`, record elapsed); re-run every Phase 1 baseline suite (incl. `TransactionRepository.accountSettlementReversal.test.ts`, which must pass UNEDITED) and confirm counts are baseline + new tests only; the only edited pre-existing assertion is T014's zeroed-statement `toEqual` (two new keys, same values) (SC-004).

**Checkpoint**: both stories work on web; desktop proven by unit/handler tests and by the CI twin below.

---

## Phase 5: Desktop twin & suite index

- [X] T041 [P] [US2] Create `frontend/tests/e2e-electron/lira-256-omt-statement-commission-types.spec.ts`, the IPC twin of lira-web-053 (same amounts/asserts through `window.api.suppliers.*` and `window.api.omt.*` as `lira-095-omt-commission-settlement-void.spec.ts` does). Do NOT run it on this Mac (G5). Typecheck with `cd frontend && npx tsc --noEmit -p tsconfig.playwright.json` and lint the file; record "desktop: unverified until CI".
- [X] T042 [P] Add an index row for `lira-256-omt-statement-commission-types` (REST twin: lira-web-053) to `frontend/tests/e2e-electron/README.md`, matching the format of the `lira-095-omt-commission-settlement-void` row; add lira-web-053 to `frontend/tests/e2e-web/README.md` if that file lists specs.

---

## Phase 6: Polish & delivery

- [X] T043 [P] Docs: `docs/FEATURE_GUIDE.md` §10 "Commission at settlement" bullet — add one sentence: a settlement may name the OMT commission types its statement covers; transfers of other types are refused from that batch and stay queued at gross until a statement covers them (LIRA-256); `docs/COUNTERPARTY_LEDGERS.md` §4.1 — same rule in its own words, noting no new ledger row and no reversal change.
- [X] T044 [P] Release note (rule 30) in `docs/release-notes/UNRELEASED.md` under `## 💸 OMT / Whish & suppliers`, plain words, no ticket ids: "OMT account: when OMT's balance SMS says which shares it includes (for example only Intra), tick those types in the statement check. The expected balance then counts only those types' commission, and the settle screen settles only those transfers; the others wait in the list until a statement includes them." Then run `node scripts/build-release-notes.cjs` and `node scripts/build-release-notes.cjs --check`.
- [X] T045 [P] `current_sprint.md` LIRA-256: Status → DONE with date, files, test names and measured results (counts + elapsed, "desktop twin unverified until CI"); add "**What users will notice:**" (same meaning as T044); note that S7 was measured and fixed here as S9 (the statement check no longer subtracts an old-style transfer's commission twice).
- [X] T046 Under each of S1–S9 in `docs/plans/OVERNIGHT_DECISIONS_2026-10-11.md` §2 (written during the design phase; if missing, write them first from spec.md Clarifications + research.md R5) append "Measured:" lines — only facts that were run.
- [X] T047 Gates (constitution): `yarn typecheck`, `yarn lint`, `yarn build`, `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`, `node scripts/build-release-notes.cjs --check`, then the full core, backend, electron-handler and frontend suites. Record elapsed time and suite/test counts for each (rule 28a: a sub-second green is a no-op).

---

## Dependencies & execution order

- Phase 1 → Phase 2 → (Phase 3 ∥ Phase 4 tests) → implementations.
- Within each story: every "Tests first" task is red before the first implementation task of that story.
- US2 depends on Phase 2 only for code; T032 (e2e) also needs US1's read (steps 1–2), so run it after T025.
- T036 (row fields) must land before T034's `settleAccount` call and before T038/T039 can pass — implement T033 → T036 → T034 → T035.
- Phase 5 after T040. Phase 6 last; T047 is the final task.

### Parallel opportunities

- Phase 2: T002 ∥ T003.
- US1 tests: T011 ∥ T012 ∥ T013 (T010 alone in its core file). US1 impl: T018 ∥ T019 ∥ T022 ∥ T023 after T014–T017.
- US2 tests: T028 ∥ T029 ∥ T030 ∥ T031 (T026, T027 are separate core files and may also run in parallel).
- Phase 5: T041 ∥ T042. Phase 6: T043 ∥ T044 ∥ T045.

## Implementation strategy

- **MVP = US1** (display only; zero money risk). Can ship alone after T025 + T044/T045 wording limited to the check.
- **Then US2** (money posting restriction; no new rows, no reversal change).
- Every increment keeps "no choice = today" (S3) provable by the untouched baseline suites.

## Task count

| Phase | Tasks |
|-------|-------|
| 1 Setup | 1 (T001) |
| 2 Foundational | 8 (T002–T009) |
| 3 US1 | 16 (T010–T025) |
| 4 US2 | 15 (T026–T040) |
| 5 Desktop twin & index | 2 (T041–T042) |
| 6 Polish | 5 (T043–T047) |
| **Total** | **47** |

## Completion notes (implementation, 2026-10-11)

Red-first records (rule 17), each run against the unchanged code before its implementation:

- **T002** — `Cannot find module '../omtCoveredTypes'` (suite failed to load, 0 tests).
- **T003** — `TypeError: omtFees_js_1.OMT_SERVICE_TYPES is not iterable` (suite failed to load).
- **T010** — 7 of 10 failed: covered=[INTRA] expected 0.3 received 2.1; `covered_omt_service_types` undefined; UNSPECIFIED expected 0.6 received 2.1; `commission_by_type` undefined; S9 legacy row expected **104.5 received 104** (included) and **105 received 104** (not included) — the S7 double subtraction, measured.
- **T011** — 5 failed: service called with `(3)` instead of `(3, ["INTRA","WESTERN_UNION"])` / `(3, undefined)`; `covered=BOGUS` and `covered=` returned `success: true`.
- **T012** — 4 failed: read forwarded `(7)` only; BOGUS/[] resolved instead of rejecting.
- **T013** — 6 of 7 new cases failed (no picker; 1 s `findBy` timeouts). The "All types calls with ONE argument" case passed on the old code — it is an S3 regression guard, **not proven failing-first**.
- **T028/T029** — passed on first run (schema key from T006 already built): **not proven failing-first**, as the tasks predicted.

Green: T002+T003+browser guard 3 suites / 25 tests (2 s); T010 10/10; T011 backend 43/43; T012 handler 8/8; T013 panel 11/11. Core typecheck clean; frontend typecheck clean (22 s).

Note: on this Mac `node_modules/@liratek/core` is a symlink to `packages/core`, so the `cp -r … dist` sync is a no-op ("identical"); `npm run build` alone refreshes what backend/electron jest load.

US2 red-first records:

- **T026** — 9 of 10 failed: (a)/(b)/(e) "Expected function to throw, but it did not" (the uncovered row settled); (c)/(f)/(g)/(h) metadata `covered_omt_service_types` undefined; (i) settled past the coverage point. (d) [no choice = today] and (j) [void nets to 0] passed on the old code — regression nets, **not proven failing-first**. Deviation: rows are seeded directly (with the TOP_UP sibling the writer books), not through `FinancialServiceRepository.createTransaction` — the guard reads only provider/type/model and the commission is typed at settlement, so the writer's estimate plays no part.
- **T027** — red: metadata stamp `Expected ["INTRA"], Received undefined`. Net-zero part: not proven failing-first (reversal code unchanged).
- **T030** — 3 of 5 failed (WU row ticked/enabled; no picker). The schema-key and "old-style row never disabled" cases passed first (regression guards).
- **T031** — 2 of 4 failed (`supplier-settle-covered-*` not found). Schema-key and non-OMT cases passed first (regression guards).
- **T032** — web e2e red: step 3 `refused.success` Expected false, Received true (`{"success":true,"id":3}`); steps 1–2 already green on the US1 build.

Green (T040): core settlement suites 6 suites / 120 tests (coveredTypesSettlement 10, supplierSettlementReversal +1, accountSettlementReversal UNEDITED, accountSettlement, settlement, commissionAtSettlement); frontend `src/features/suppliers` 21 suites / 91 tests (baseline 19 / 75 + 16 new); lira-web-053 **1 passed (5.6 s)**, and run together with lira-web-015/021/052: 4 passed (7.6 s). Pre-existing test edits: T014's zeroed-statement `toEqual` (two new keys, same values) and, at T047, `embeddedCommission.guard.test.ts`'s exclusion `sqlContains` (same query, new column in its text).

Final gates (T047, 2026-10-11, after Prettier on the touched files):

| Gate | Result | Elapsed |
|------|--------|---------|
| core jest (full) | 643 suites / 6274 tests pass | 12 s |
| backend jest (full) | 165 / 1735 pass | 8 s |
| electron-app jest (full) | 63 / 348 pass | 8 s |
| frontend jest (full) | 513 / 514 suites, 3145 pass, 2 fail in `landingSignIn.test.ts`: that test only parses `landing/index.html` + `ar.html`, and both it and those files are identical to HEAD (`git status`), so this ticket's changes cannot reach it — a pre-existing failure | 45 s |
| `yarn typecheck` | exit 0 | 35 s |
| `yarn lint` | 0 errors (warnings pre-existing) | 23 s |
| `yarn build` | exit 0 (vite built in 5.5 s) | 11 s |
| check-tenant-scoping / bind-arity / transport-parity / schema-equivalence | all exit 0 (parity: 0 payload-per-transport, 0 violations; schema: 87 tables, 0 diffs) | ~1 s each |
| `build-release-notes.cjs --check` | up to date | <1 s |
| web e2e lira-web-053 (+052) | 2 passed | 8 s |
| desktop e2e twin | typechecks (`tsconfig.playwright.json`, file listed); **not run (G5)** | — |

Side effects found: `embeddedCommission.guard.test.ts` keys an exclusion on the
`_resolveSettlementBatchModel` SELECT text; its `sqlContains` was updated for the new
`omt_service_type` column (same query, same reason). `yarn build`'s staging step replaced the
`node_modules/@liratek/core` symlink with a real copy (its documented behaviour), so later core
edits need the `cp -r packages/core/dist/. node_modules/@liratek/core/dist/` sync again.
Checklist gate: `checklists/requirements.md` had no unchecked items.
