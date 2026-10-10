# Tasks: LIRA-296 — Warranty for any item, not just phones

**Input**: spec.md, plan.md, research.md, data-model.md, contracts/api.md, quickstart.md (this folder).

**Tests**: REQUIRED (rule 17). Write each test first, run it, record the real failure, then implement. Never revert finished code to prove a test. Money tests assert deltas, never row position (rule 15).

**Rules**: work directly on local `main`. Commit locally after each release phase; push only on the owner's go. Never run Electron or desktop e2e on this Mac. After core changes, rebuild core; restore the `node_modules/@liratek/core` symlink if `yarn build` replaces it.

**Release phases**: P1 = Phases 1–6 (US1, US2, US3, side fixes). P2 = Phases 7–8 (US4, US5). P3 = Phases 9–11 (US6, US7, US8). Each ends with its own gates and release note.

## Phase 1: Setup

- [X] T001 Read `docs/FEATURE_GUIDE.md` §13, and note in `specs/296-warranty-any-item/research.md` (append "§13 walk-through" under R6) which checklist items P2 and P3 touch. Rule 18: this is required before any money code.
- [X] T002 Confirm the last migration in `packages/core/src/db/migrations/index.ts` is v204. If not, renumber v205/v206/v207 in `data-model.md` and in these tasks.

## Phase 2: Foundational (blocks every P1 story)

- [X] T003 [P] Test first, then the pure `packages/core/src/utils/receiptNumber.ts`:
  - `receiptNumberFor(saleId)` returns `"RCP-<id>"`;
  - `parseReceiptNumber(input)` accepts `RCP-12`, `rcp12`, `rcp-12` and `12`, and returns null for anything else.

  Export it from `packages/core/src/index.ts` and `packages/core/src/browser.ts`. Test: `packages/core/src/utils/__tests__/receiptNumber.test.ts`.
- [X] T004 [P] Test first, then the pure `packages/core/src/utils/warrantyState.ts`: `warrantyState(untilIso, todayIso, { overrideUntil?, fullyRefunded? })` returns `'COVERED'|'EXPIRED'|'VOID'|'NONE'`.
  - Precedence: OVERRIDE > REFUND (VOID) > SALE stamp > NONE.
  - The end date counts as covered (inclusive), comparing the first 10 characters.

  Port every existing case from `frontend/src/features/sales/utils/__tests__/warrantyStatus.test.ts` and from `ProductUnitService.computeWarrantyStatus`'s tests into `packages/core/src/utils/__tests__/warrantyState.test.ts`. Export from index and browser.
- [X] T005 Replace `ProductUnitService.computeWarrantyStatus` (`packages/core/src/services/ProductUnitService.ts:68`) and the frontend `getWarrantyState` (`frontend/src/features/sales/utils/warrantyStatus.ts`) with calls to `warrantyState`. Keep the frontend module as a thin re-export so imports keep working (rule 14). Existing tests must stay green.
- [X] T006 Test first (`packages/core/src/db/migrations/__tests__/v205_warrantyCategoryDefault.test.ts`), then migration **v205 `warranty_category_default_and_line_audit`** in `packages/core/src/db/migrations/index.ts`:
  - `product_categories.warranty_months INTEGER NULL` ("Category default warranty in months; NULL means none. 0–60.");
  - `sale_items.warranty_months INTEGER NULL`;
  - `sale_items.warranty_set_by INTEGER NULL REFERENCES users(id)`;
  - index `idx_sale_items_warranty_until` on `sale_items(tenant_id, warranty_until)`.

  Write a `down()`. Mirror it in `electron-app/create_db.sql` (columns, index, and the `(205, …)` ledger row). Run `yarn check:schema-equivalence`.
- [X] T007 [P] Add the `warranty_terms_text` setting (at most 1000 characters) to the settings schema or whitelist wherever settings keys are validated (`packages/core/src/validators/*settings*`, if a whitelist exists). Test that it saves and reads back.

## Phase 3: User Story 1 — Find a warranty without an IMEI (P1)

**Goal**: staff find any warranty item by customer, phone, receipt number, product or serial/IMEI.
**Independent test**: quickstart.md, P1 table, "Search" row.

- [X] T008 [US1] Test first, then the receipt number at checkout:
  - `frontend/src/features/sales/pages/POS/components/CheckoutModal.tsx` (~:128) prints `receiptNumberFor(saleId)` from the sale-process response instead of `RCP-${Date.now()}`.
  - `SaleDetailModal.tsx` (~:555) uses `receiptNumberFor(sale.id)`.
  - Remove or redirect `RECEIPT_NUMBER_PREFIX` in `frontend/src/constants/checkout.ts`.
  - Test: checkout and reprint print the same number. Test file: `frontend/src/features/sales/pages/POS/components/__tests__/CheckoutModal.receiptNumber.test.tsx`.
- [X] T009 [P] [US1] Test first, then schemas in the new `packages/core/src/validators/warranty.ts`:
  - `warrantySearchSchema`: `{ q?: string ≤100, from?: YYYY-MM-DD, to?: YYYY-MM-DD, state?: 'COVERED'|'EXPIRED'|'VOID', client_day: YYYY-MM-DD, limit?: int 1–200 default 50 }`;
  - its type `WarrantySearchInput`;
  - the row type `WarrantySearchRow` (data-model.md).

  Export from index and browser.
- [X] T010 [US1] Test first (`packages/core/src/repositories/__tests__/WarrantyRepository.search.test.ts`, using a seeded database), then `packages/core/src/repositories/WarrantyRepository.ts` (extends BaseRepository, tenant-scoped).
  - **Method:** `search(filters)` over `sale_items` with `warranty_until IS NOT NULL`, joined to:
    - `sales`;
    - `clients`, or for walk-ins the transaction's `client_name`/`client_phone` (same source as `SalesRepository.getSaleWithCustomer`, :3888);
    - `products`;
    - `product_units` (by `sale_item_id`).
  - **`q` matches:** the receipt number (via `parseReceiptNumber`), a LIKE on the name, a LIKE on the phone with spaces stripped, the product name or barcode, and the unit IMEI/serial.
  - **Returns:** `quantity`, `refunded_quantity` and units per line.
  - **Cases:** found by each field; walk-in found by receipt; tenant isolation; the limit is respected.
  - Run `check:tenant-scoping` and `check:bind-arity`.
- [X] T011 [US1] Test first, then `packages/core/src/services/WarrantyService.ts` `search(input)`.
  - It validates the input, calls the repository, and computes for each row `coveredQuantity = quantity − refunded_quantity` and `state` via `warrantyState(warranty_until, client_day, {overrideUntil, fullyRefunded})`.
  - It filters by `state` when one is given.
  - **Rule 27 test:** a sale at 23:30 UTC is still COVERED on its end day when the client's day says so.
  - Export a singleton getter in `packages/core/src/services/index.ts` (Node-only; not in browser.ts).
- [X] T012 [US1] Test first, then IPC `warranty:search` in the new `electron-app/handlers/warrantyHandlers.ts`:
  - `requireRole(['admin','staff'])` and `validatePayload(warrantySearchSchema)`;
  - registered in `electron-app/main.ts`;
  - preload binding `window.api.warranty.search` in `electron-app/preload.ts`;
  - re-exported schema in `electron-app/schemas/index.ts`;
  - type in `frontend/src/types/electron.d.ts`.

  Test: `electron-app/handlers/__tests__/warrantyHandlers.test.ts`.
- [X] T013 [US1] Test first, then REST `GET /api/warranty/search` in the new `backend/src/api/warranty.ts`:
  - `authenticateJWT` → `requireRole(['admin','staff'])` → `validateRequest(warrantySearchSchema, 'query')`;
  - envelope identical to IPC;
  - mounted in `backend/src/server.ts`.

  Test: `backend/src/api/__tests__/warranty.search.api.test.ts`.
- [X] T014 [US1] Adapter: `searchWarranties(input: WarrantySearchInput)` in `frontend/src/api/backendApi.ts` (`ipcOrHttp`), plus `frontend/src/api/ElectronApiAdapter.ts` and the `ApiAdapter` type in `packages/ui/src/api/types.ts` (rule 21: the type comes from core).
- [X] T015 [US1] Test first, then the page `frontend/src/features/warranty/pages/WarrantyLookup.tsx`:
  - one search box with the hint "Name, phone, receipt (RCP-…), product or serial";
  - a state filter;
  - a results table: product, customer, sold on, receipt, "warranty until", state badge, and covered quantity "x of y";
  - clicking a row opens the sale (existing `SaleDetailModal`).
  - It uses `useApi()` (rule 19, no raw `window.api`), with `api` read through a ref (rule 25).
  - Route `/warranty` in `frontend/src/app/App.tsx` (ProtectedRoute, admin and staff), plus a sidebar entry.

  Test: `frontend/src/features/warranty/pages/__tests__/WarrantyLookup.test.tsx`.

## Phase 4: User Story 2 — Warranty state on every sale line (P1)

**Goal**: every warranty line shows its state; partly refunded lines show "x of y refunded".

- [X] T015a [US1] Speed check for SC-001 (G1): `packages/core/src/repositories/__tests__/WarrantyRepository.searchPerf.test.ts` seeds about 2 years of sales (~50,000 warranty lines across ~5,000 clients) and asserts `search` by phone, by receipt and by product each returns in under 1 second. Add an index if it fails (never loosen the limit).

- [X] T016 [US2] Test first, then `frontend/src/features/sales/pages/POS/components/SaleDetailModal.tsx` (~:760, :795-808):
  - use `warrantyState`, with the unit override when there is one;
  - show "Covered until <date>" / "Expired on <date>" / "Void";
  - add "· 1 of 3 refunded" when `0 < refunded_quantity < quantity`;
  - lines without a warranty show nothing.

  Test: `frontend/src/features/sales/pages/POS/components/__tests__/SaleDetailModal.warrantyState.test.tsx`.

## Phase 5: User Story 3 — Category defaults, per-line edit, terms on receipt (P1)

**Goal**: length = line edit ?? product ?? category ?? none; terms print on warranty receipts.

- [X] T017 [US3] Category default through all layers:
  - `CategoryRepository.update/getAll` (`packages/core/src/repositories/CategoryRepository.ts`) handle `warranty_months` (0–60 or null);
  - the category schema in `packages/core/src/validators/inventory.ts`;
  - IPC `inventory:update-category` and `inventory:get-categories-full`;
  - REST `PUT /api/inventory/categories/:id` and `GET /categories-full` (`backend/src/api/inventory.ts`);
  - adapter `updateCategory`.

  Tests first for the repository, the handler and the route.
- [X] T018 [US3] UI: a "Default warranty (months)" input per category in `frontend/src/features/settings/pages/Settings/CategoriesManager.tsx`, with "No warranty" when empty. Test first.
- [X] T019 [US3] **Rule 23 three-way key diff first**: for the sale item, compare (a) the sale schema in `packages/core/src/validators/sale.ts`, (b) the `preload.ts` sales binding type, and (c) the fields `salesHandlers.ts` forwards. Write the diff result into the PR notes. Then add the optional `warranty_months: number | null` (0–60) per item to the schema, the preload type and the REST body.
- [X] T020 [US3] Test first (`packages/core/src/repositories/__tests__/SalesRepository.warrantyResolution.test.ts`), then in `SalesRepository.processSale` (`packages/core/src/repositories/SalesRepository.ts` ~:683 and :848-855):
  - resolve the length as `item.warranty_months ?? product.warranty_months ?? category.warranty_months ?? null` (join the category by `products.category` name);
  - stamp `sale_items.warranty_months`, and `warranty_until` (sale day + length) only on completed lines;
  - stamp `warranty_set_by` = the actor when the line's value differs from the resolved default.

  Cases: each source wins in order; NULL everywhere means no warranty; a draft gets no stamp; changing a product's or category's length later never changes an already-sold line (G3). **Rule 27 (U1):** the warranty start day is the shop's own day — a web sale at 00:30 Beirut (21:30 UTC the day before) starts its warranty on the Beirut day; the client sends `client_day` with the sale and the server's day is only a fallback.
- [X] T021 [US3] Test first, then the per-line warranty edit in the checkout:
  - a small "Warranty: N months (edit)" control per cart line in `frontend/src/features/sales/pages/POS/components/CartLineRow.tsx`, or in the CheckoutModal items list;
  - it starts from the resolved default (product, else category);
  - it is sent as `warranty_months` in the ONE sale payload (rule 22).
- [X] T022 [P] [US3] Test first, then the terms setting UI: a "Warranty terms" textarea (at most 1000 characters) in `frontend/src/features/settings/pages/Settings/ShopConfig.tsx`, saved as `warranty_terms_text`.
- [X] T023 [US3] Test first (`frontend/src/features/sales/utils/__tests__/receiptFormatter.test.ts`, `frontend/src/shared/utils/__tests__/serviceReceipt.test.ts`), then:
  - `useShopInfo` (`frontend/src/hooks/useShopName.ts`) also returns `warranty_terms_text` and `receipt_header_text`;
  - `receiptFormatter.ts` (58mm and 80mm) prints the terms below the items only when a line has a warranty.

## Phase 6: P1 side fixes (same ticket, owner decision 2026-10-10)

- [X] T024 [P] SF-1, test first (`backend/src/api/__tests__/sales.todayDate.api.test.ts`): `GET /api/sales/today` (`backend/src/api/sales.ts:83`) and `GET /api/dashboard/todays-sales` (`backend/src/api/dashboard.ts:88`) accept a validated `date` (YYYY-MM-DD) and pass it to `SalesRepository.getTodaysSales(limit, date)`, matching IPC. Asserts: a past day returns that day's sales, the same as IPC.
- [X] T025 [P] SF-2, test first: `GET /api/sales/by-date-range?from&to` in `backend/src/api/sales.ts` (same roles as the IPC `sales:get-by-date-range`), calling `SalesService.findByDateRange`.
  - Core schema `salesDateRangeSchema` and its Input type in `packages/core/src/validators/sale.ts`.
  - Adapter `getSalesByDateRange` in `backendApi.ts` / `ElectronApiAdapter.ts` / `ApiAdapter`.
  - Test: same rows on IPC and REST.
- [X] T026 SF-3, test first: print `receipt_header_text` under the shop name in `receiptFormatter.ts` (58mm and 80mm) and in `frontend/src/shared/utils/serviceReceipt.ts`, only when it is not empty. Depends on T023's `useShopInfo` change.
- [X] T027 P1 release:
  - **`docs/release-notes/UNRELEASED.md`** (shop-owner wording):
    - warranty lookup by customer, phone or receipt for any item;
    - a default warranty per category, and changing it at the till;
    - your warranty terms on receipts;
    - one receipt number per sale;
    - partly refunded lines show what's still covered;
    - the receipt header now prints;
    - web: recent sales show the day you pick.
  - **`current_sprint.md` LIRA-296:** set to "P1 DONE", with "What users will notice".
- [X] T028 P1 web e2e `frontend/tests/e2e-web/lira-web-0NN-warranty-lookup.spec.ts` (next free number):
  - set the Accessories category to 1 month;
  - sell an accessory to a named client;
  - search by phone and by `RCP-<id>`: the item is found, "Covered until";
  - open the sale: the state is shown;
  - the receipt contains the terms and the header.
- [X] T029 P1 gates:
  - `yarn typecheck`, `yarn lint`
  - `check:tenant-scoping`, `check:bind-arity`, `check:schema-equivalence`
  - release-notes check
  - `node scripts/run-tests.mjs`
  - `yarn build` (restore the symlink)
  - the full web e2e

  Then commit P1 locally and report to the owner.

## Phase 7: User Story 4 — Claims: repair, replace, refund (P2)

**Goal**: act on a covered warranty; one "Warranty cost" line in Profits; faulty items held as defective (D1, D2).
**Independent test**: quickstart.md, P2 table.

- [X] T030 [US4] Test first, then migration **v206 `warranty_claims_defective_items_repair_warranty`**:
  - new tables `warranty_claims` and `defective_items` (columns, CHECK lists and FKs exactly as in data-model.md);
  - `maintenance.warranty_months`, `maintenance.warranty_until`, `maintenance.warranty_claim_id`;
  - `stock_batch_consumptions.warranty_claim_id`;
  - `product_units.warranty_claim_id`;
  - indexes on every new FK;
  - a `down()`, the `create_db.sql` mirror and the ledger row.

  Register the new tables wherever tenant tables are listed: `tenantSplit` and the reset tables.
- [X] T031 [US4] Transaction type `WARRANTY_COST` in `packages/core/src/constants/transactionTypes.ts`:
  - add it to `NON_REVERSIBLE_TRANSACTION_TYPES` (reversal owner: the warranty service);
  - add its IN/OUT presentation (no drawer) in `getCashFlowDirection`;
  - `is_auto` is derived from its `warranty_claim_id` link at the single writer (rule 26), and `auditConstants` hides it by default.

  Tests first, including `moduleDebtTypes.guard` staying green.
- [X] T032 [US4] **Failing-first reversal test** before any claim code: `packages/core/src/services/__tests__/WarrantyService.voidNetsZero.test.ts`. For each of REFUND, REPLACE and REPAIR, a create-then-void asserts zero change, per currency, in:
  - stock and batches;
  - units;
  - `defective_items`;
  - drawers;
  - client debt;
  - the supplier ledger;
  - the profit sum (rule 20).
- [X] T033 [US4] Test first, then `refundSaleItem` gains the option `restock: false` (`packages/core/src/repositories/SalesRepository.ts:1750`, `_applySaleItemReversal` :2730):
  - it skips `stock_quantity +=` and `restoreForSaleItem`;
  - linked units stay out of IN_STOCK, flagged `is_defective = 1`;
  - the default behaviour is unchanged (existing refund tests stay green).
- [X] T034 [US4] Test first, then `WarrantyClaimRepository` and `DefectiveItemRepository` (`packages/core/src/repositories/`): create, get-by-line/job/unit, status update, and an open-claim lookup (invariant: one open claim per unit).
- [X] T035 [US4] Test first, then `WarrantyService.createClaim(input, actor, client_day)`:
  - **Guards:**
    - EXPIRED: NOT_COVERED unless an admin gives an override with a reason;
    - VOID: always NOT_COVERED, even with an override (FR-003);
    - ALREADY_CLAIMED (the unit has an open claim);
    - NO_COVERED_UNIT_LEFT (one unit per claim; the line's claims never exceed its covered quantity);
    - FORBIDDEN_ACTION (staff may only REPAIR).
  - **REFUND:** the existing refund-item flow with `restock: false`, using the operator's refund legs; a `defective_items` HELD row at the line's FIFO cost; a `WARRANTY_COST` row (−cost).
  - **REPLACE:**
    - OUT_OF_STOCK guard;
    - FIFO `StockBatchRepository.consume` with owner `warranty_claim_id`;
    - a unit-tracked replacement is marked SOLD with `warranty_claim_id` and `warranty_override_until` = the original end (D2);
    - the faulty item is a HELD defective row;
    - a `WARRANTY_COST` row (−replacement cost).
  - **REPAIR:** a maintenance job with price 0 and `warranty_claim_id`; the claim stays OPEN.
  - Everything runs in one transaction. Client propagation (rule 11): the claim's customer is carried to the job and the transactions.
- [X] T036 [US4] Test first, then `WarrantyService.voidClaim(id)`: reverses everything T035 wrote. T032 must now pass.
- [X] T037 [US4] Test first, then `WarrantyService.resolveDefective(id, 'WRITE_OFF'|'NOT_FAULTY')`. NOT_FAULTY puts the item back into stock (`stock_quantity` and a batch restore at cost) and books a `WARRANTY_COST` row of +cost.
- [X] T038 [US4] Test first, then the WARRANTY_JOB predicate and Profits:
  - one named SQL fragment `WARRANTY_JOB` (`maintenance.warranty_claim_id IS NOT NULL`) excludes warranty jobs from the Maintenance totals and detail (`ProfitRepository.ts` ~:3577, :4966, :6054);
  - a warranty job's parts cost, booked at delivery, becomes a `WARRANTY_COST` row (`MaintenanceRepository.processPayments` ~:674 / its status change to Delivered*);
  - `ProfitRepository.getWarrantyTotals` and `getWarrantyDetail` sum `WARRANTY_COST`;
  - `ProfitService.getByModule` adds the row `{module:'WARRANTY', label:'Warranty cost'}`, and `getSummary` includes it in gross;
  - `getModuleDetail` gets a WARRANTY builder.
- [X] T039 [US4] Schemas: `createWarrantyClaimSchema`, `voidWarrantyClaimSchema` and `resolveDefectiveSchema` in `packages/core/src/validators/warranty.ts`. Then:
  - IPC `warranty:claim`, `warranty:claims-for`, `warranty:void-claim`, `warranty:defective` and `warranty:defective-resolve` (roles as in contracts/api.md);
  - matching REST routes in `backend/src/api/warranty.ts`;
  - adapter functions (rule 21).

  Tests first for handlers and routes.
- [X] T040 [US4] Test first, then the UI in `frontend/src/features/warranty/components/`:
  - **`ClaimModal.tsx`**, opened from WarrantyLookup and SaleDetailModal for covered lines: pick an action; REFUND reuses `RefundMethodModal` for the legs; out-of-stock shows a message; the admin override field.
  - **`ClaimHistory.tsx`**, on the sale line and the unit story.
  - **`DefectiveItems.tsx`**, an admin list with Write off and Not faulty.
- [X] T041 [US4] Test first, then the Profits page: a "Warranty cost" row and its detail list in `frontend/src/features/profits/pages/Profits.tsx`.
- [X] T042 [US4] Add a `WARRANTY_COST` posting row (legs, drawers, profit, reversal owner) in `docs/FEATURE_GUIDE.md` and `docs/POSTING_MAP.md`.

## Phase 8: User Story 5 — Warranty on repairs (P2)

- [X] T043 [US5] Test first, then the repair warranty:
  - `maintenance.warranty_months` is editable in the job form (`frontend/src/features/maintenance/...`), through `maintenance:save` and `POST /api/maintenance/jobs` (schema `packages/core/src/validators/maintenance.ts`; three-way key diff first, rule 23);
  - `warranty_until` is stamped from `client_day` when the job reaches Delivered_Paid (`MaintenanceRepository`);
  - it is printed by `serviceReceipt.ts`.
- [X] T044 [US5] Test first, then extend `WarrantyRepository.search` to return repair warranties (`source:'REPAIR'`), and allow `createClaim` on `maintenance_id` (REPAIR only).
- [X] T045 P2 release:
  - release-note lines: warranty claims, defective items, the Warranty cost in Profits, warranty on repairs;
  - the sprint line;
  - web e2e `lira-web-0NN-warranty-claims.spec.ts`: replace, then void, then deltas back to zero, plus the Profits row;
  - gates;
  - local commit, then report.

## Phase 9: User Story 6 — Serial numbers for any category (P3)

- [ ] T046 [US6] Test first, then migration **v207 `serial_categories_supplier_returns`**:
  - `product_categories.serial_label TEXT NOT NULL DEFAULT 'Serial'`, back-filled to `'IMEI'` where `tracks_imei_units=1`;
  - `product_categories.serial_required TEXT CHECK IN ('BLOCK','WARN') DEFAULT 'BLOCK'`;
  - the `supplier_returns` table (data-model.md).

  Mirror it in `create_db.sql`, with a `down()`. Register `supplier_returns` wherever tenant tables are listed (tenantSplit, the reset tables), as T030 does for P2 (G2).
- [ ] T047 [US6] Test first, then the category fields through all layers and `CategoriesManager.tsx`. Every IMEI label in inventory, POS, receipts and the unit story card uses the category's `serial_label`.
- [ ] T048 [US6] Test first, then `SalesRepository.processSale`: a serial-tracked line without a unit gets `SERIAL_REQUIRED` when the category is BLOCK; when it is WARN, the response carries `warnings[]`, and the checkout shows the warning.

## Phase 10: User Story 7 — Supplier returns (P3)

- [ ] T049 [US7] Test first, then `SupplierReturnRepository` and `WarrantyService.createSupplierReturn/closeSupplierReturn`. The supplier defaults from the FIFO batch (via `stock_batch_consumptions.sale_item_id` → batch `supplier_id`).
  - **CREDITED:** `SupplierRepository.addLedgerEntry` ADJUSTMENT plus a `WARRANTY_COST` +credit row.
  - **REPLACED:** the unit goes back IN_STOCK at cost, plus a +cost row.
  - **REJECTED:** no money moves.
  - `voidClaim` refuses `DEFECTIVE_ALREADY_SENT`.

  Extend the T032 nets-to-zero test to supplier outcomes.
- [ ] T050 [US7] Schemas, IPC, REST and adapter for `warranty:supplier-return-*` (admin), then the UI `SupplierReturns.tsx`. Tests first.

## Phase 11: User Story 8 — Warranty report (P3)

- [ ] T051 [US8] Test first, then `WarrantyService.report({from,to,client_day})`: items under warranty grouped by category, and claims by action with gross cost, supplier recovered and net. Wire IPC and REST `warranty:report`, plus the adapter.
- [ ] T052 [US8] Test first, then the report UI `frontend/src/features/warranty/components/WarrantyReport.tsx`, using `@liratek/ui` DataTable and ExportBar, with a "Report" tab on the Warranty page (admin).

## Phase 12: Polish and release

- [ ] T053 P3 release:
  - release-note lines: serial numbers for any item, supplier returns, the warranty report;
  - the sprint line;
  - web e2e `lira-web-0NN-warranty-supplier.spec.ts`;
  - gates;
  - local commit, then report.
- [ ] T054 Move `docs/plans/todo_plans/WARRANTY_ANY_ITEM_PLAN.md` to `docs/plans/ongoing_plans/` after P1 ships, and to `done_plans/` after P3. Update `PLAN_OVERVIEW.md` and every reference to the file.

## Dependencies

- **Phase 1 → Phase 2 → P1 stories.** US1 (T008–T015) needs T003, T004 and T009.
- **US2** (T016) needs T004.
- **US3** (T017–T023) needs T006.
- **Side fixes:** T024 and T025 are independent; T026 needs T023.
- **P1 release** (T027–T029) comes after all of the above.
- **P2:** T030 → T031 → T032 (failing) → T033–T037 → T038 → T039–T041. US5 (T043–T044) needs T030 and T035.
- **P3:** T046 → US6 (T047–T048). US7 (T049–T050) needs P2. US8 (T051–T052) needs P2 and T049.

## Parallel opportunities

- **Phase 2:** T003, T004 and T007.
- **US1:** T009 alongside T008; T012, T013 and T014 after T011.
- **US3:** T022 alongside T017–T021.
- **Side fixes:** T024 and T025 alongside each other and alongside US1–US3.
- **P2:** T040 and T041 after T039; T042 at any time.

## Implementation strategy

- **MVP = P1** (US1, US2, US3 and the side fixes). It is shippable on its own: staff find and see warranties for any item, and receipts carry terms and the header.
- Each later phase (P2, P3) is its own local commit and release, after owner review. They are pushed together only when the owner says so.
