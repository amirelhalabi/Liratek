---
description: "Task list for LIRA-309 Phone Lines Management"
---

# Tasks: Phone Lines Management

**Input**: Design documents from `specs/309-phone-lines-management/`: plan.md, spec.md, research.md, data-model.md, contracts/resale-lines.md, quickstart.md

**Tests**: Required. Constitution §VI and CLAUDE.md rule 17: every guard test is written FIRST and seen FAILING on the unchanged code before the fix. Record the real failure in the task note. Never revert finished code to prove a test. Money flows need net-zero tests per ledger and per currency (rule 20).

**Organization**: tasks are grouped by user story. US1/US2/US3 are P1 and US4 is P2.

**Hard prerequisite**: US3 and US4 (Phases 5–6) touch `RechargeRepository.ts`, `TransactionRepository.ts` and the recharge page. Do not start them until the parallel LIRA-308 session has committed. Check `git status` first.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US4 from spec.md

## Conventions used by every task

- Core paths are `packages/core/src/…`. After any core change, rebuild and sync: `cd packages/core && npm run build && cp -r dist/. ../../node_modules/@liratek/core/dist/`.
- Every SQL statement takes `tenant_id` and uses `?` placeholders only.
- Repositories extend `BaseRepository`.
- Envelope `{ success, data?, error? }`, with REST HTTP 200 on failure.
- Schemas live in `validators/resaleLine.ts` and are exported from **both** `index.ts` and `browser.ts`. Adapter payload types are `z.input<typeof …>`.
- Run core jest under the Node ABI (`yarn rebuild:node`). Never run desktop e2e or Electron on the owner's Mac.

---

## Phase 1: Setup

**Purpose**: confirm the baseline and register the ticket.

- [x] T001 Read the last entry of `packages/core/src/db/migrations/index.ts`. Confirm it is still **v210**; if not, use last+1 everywhere this file says v211, and record the number here.
- [x] T002 Add the LIRA-309 ticket entry to `current_sprint.md` with status, spec link `specs/309-phone-lines-management/`, the owner decisions (for-sale 3 days / shop 7 days; recharge cost capitalized into cost and price; 3 sources: days, shop-line credit, iPick/Katsh card; lost line → owner Write off) and a "What users will notice:" line. Edit only the new entry; another session also edits this file.
- [x] T003 [P] Read `docs/FEATURE_GUIDE.md` §13 and `specs/309-phone-lines-management/plan.md` §13 walk-through before any money code (rule 18).

---

## Phase 2: Foundational (blocks all stories)

**Purpose**: schema, the shared status helper and the repository skeleton.

- [x] T004 Write the migration **v211** in `packages/core/src/db/migrations/index.ts`, with `down()` dropping both tables. Create:
  - `resale_lines`: `id INTEGER PK`, `tenant_id INTEGER REFERENCES tenants(id)`, `product_id INTEGER NOT NULL REFERENCES products(id)`, `carrier TEXT NOT NULL CHECK(carrier IN ('mtc','alfa'))`, `credits REAL NOT NULL DEFAULT 0`, `validity_expires_at TEXT` (NULL = "No expiry set"), `created_at`, `updated_at`; `UNIQUE(tenant_id, product_id)`. **No phone column** (the number is `products.barcode`).
  - `resale_line_recharges`: `id`, `tenant_id`, `transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id)`, `resale_line_id INTEGER NOT NULL`, `product_id INTEGER NOT NULL`, `source TEXT NOT NULL CHECK(source IN ('CARD','SHOP_LINE_CREDIT','DAYS'))`, `days_added INTEGER NOT NULL DEFAULT 0`, `credits_added REAL NOT NULL DEFAULT 0`, `cost_usd REAL NOT NULL`, `source_carrier_line_id INTEGER NULL`, `mobile_service_item_id INTEGER NULL`, `prev_cost_usd REAL NOT NULL`, `prev_price_usd REAL NOT NULL`, `prev_validity_expires_at TEXT NULL`, `prev_credits REAL NOT NULL`, `batch_id INTEGER NULL`, `is_reversed INTEGER NOT NULL DEFAULT 0`, `created_at`, `updated_at`; index `(tenant_id, resale_line_id, is_reversed, id)`.
- [x] T005 Mirror T004's two tables byte-for-byte into `electron-app/create_db.sql`, then run `yarn check:schema-equivalence`.
- [x] T006 Add the tenant-scoping registration for the two new tables wherever `yarn check:tenant-scoping` requires it (see `packages/core/src/constants/resetTables.ts` for the reset classification). Decide whether Reset Data wipes `resale_line_recharges` and keeps `resale_lines`, matching how product data is treated.
- [x] T007 [P] Write the guard test `packages/core/src/utils/__tests__/lineStatus.test.ts` (quickstart C1). Cases:
  - `classifyLineStatus(expiry, today, 3)` at d = 4, 3, 0, −1, −5, −6 and null gives OK, EXPIRING, EXPIRING, IN_GRACE(daysToSave 4), IN_GRACE(0), LOST, NO_EXPIRY.
  - With window 7: d = 8 gives OK, d = 7 gives EXPIRING.

  Run it and record that it fails because the module does not exist.
- [x] T008 Create the browser-safe leaf `packages/core/src/utils/lineStatus.ts`:
  - `RESALE_LINE_EXPIRY_WARNING_DAYS = 3`, `SHOP_LINE_EXPIRY_WARNING_DAYS = 7`;
  - `classifyLineStatus(expiry, today, warningDays)` as a **thin layer over `classifyLineValidity`** (`utils/carrierLineValidity.ts:180`). VALID with `daysRemaining ≤ window` → EXPIRING, other VALID → OK, GRACE → IN_GRACE with `daysToSave = LINE_REVIVAL_GRACE_DAYS − lapseDays`, BURNED → LOST, NO_EXPIRY → NO_EXPIRY.

  Do not compare the grace boundary again here. Export from `index.ts` and `browser.ts`. T007 passes, and `src/__tests__/browserEntryIsNodeFree.guard.test.ts` stays green.
- [x] T009 Create `packages/core/src/validators/resaleLine.ts` with `listResaleLinesQuerySchema` `{ carrier?: 'mtc'|'alfa', include_sold?: boolean }`, `saveResaleLineSchema` and `writeOffResaleLineSchema` exactly as in `contracts/resale-lines.md`:
  - `validity_expires_at`: `'YYYY-MM-DD'` real calendar date or null;
  - `credits ≥ 0`;
  - `client_day` optional `'YYYY-MM-DD'`.

  Export the input types. Export from `index.ts` and `browser.ts`, and re-export in `electron-app/schemas/index.ts` with the zod-major cast.
- [x] T010 Create `packages/core/src/repositories/ResaleLineRepository.ts` (extends `BaseRepository`):
  - Define the "unsold line" SQL fragment ONCE as a named constant (`products.is_active = 1 AND products.stock_quantity > 0`, plus a lines-category check) (rule 14).
  - `listLines({ carrier?, includeSold })` joins `products` (barcode = number, name, cost_price_usd, selling_price_usd, stock_quantity, category) LEFT JOIN `resale_lines`, so line products with no details row list as NO_EXPIRY.
  - `getByProductId`, `upsertDetails(productId, { carrier, credits, validityExpiresAt })`, and `findUnsoldByNumber(normalisedNumber, carrier?)`.
  - Add a getter in the repository index alongside the others.

**Checkpoint**: schema, status helper and read model exist, and core jest is green.

---

## Phase 3: User Story 1 — See every line and its expiry in one place (P1) 🎯 MVP

**Goal**: one Phone Lines page with Shop lines and For sale groups. For-sale details (carrier, expiry, credit) are editable from the page and from ProductForm, on both transports.

**Independent Test**: add one shop line and one for-sale line with expiries, open `/phone-lines`, and see both in the right group with the right days left and colour. The MTC/Alfa drawer total is unchanged.

### Tests for User Story 1 (write first, see them fail)

- [x] T011 [P] [US1] Write `packages/core/src/repositories/__tests__/ResaleLineRepository.test.ts` (in-memory DB):
  - a line product with no details lists as NO_EXPIRY;
  - after upsert it lists carrier, credits and expiry;
  - a sold product (stock 0) is excluded unless `includeSold`;
  - **C15**: saving details on 3 lines leaves `getCarrierCreditsSum` and the MTC/Alfa drawer balance unchanged.
- [x] T012 [P] [US1] Write `packages/core/src/services/__tests__/ResaleLineService.save.test.ts` (**C13**):
  - saving details for a product whose barcode equals an **active** `carrier_lines.phone_number` (compared with `normalizeLebanesePhone`) is refused with "This number is already one of your lines.";
  - a non-lines-category product is refused.
- [x] T013 [P] [US1] Write `packages/core/src/repositories/__tests__/CarrierLineRepository.resaleConflict.test.ts`: creating or updating a carrier line whose number equals an unsold for-sale line's barcode is refused (FR-005, reverse direction).

### Implementation for User Story 1

- [x] T014 [US1] Create `packages/core/src/services/ResaleLineService.ts`, with the repository injected through the constructor (rule 13; no `getDatabase()`). Add `listLines(query)` and `saveDetails(input)`:
  - validate the lines category with `isPhoneLineCategoryName`;
  - run the FR-005 conflict check against active carrier lines;
  - call `upsertDetails`.

  T011 and T012 pass.
- [x] T015 [US1] In `packages/core/src/repositories/CarrierLineRepository.ts` create/update, refuse a number that matches `ResaleLineRepository.findUnsoldByNumber`. T013 passes.
- [x] T016 [US1] Create the IPC handlers in `electron-app/handlers/resaleLineHandlers.ts`:
  - `resale-lines:list` (any authenticated session);
  - `resale-lines:save` (`requireRole(['admin'])` + `validatePayload(SaveResaleLineSchema)`).

  Register them in `electron-app/main.ts`. Add preload bindings with full `data` types (rule 12) in `electron-app/preload.ts`, and types in `frontend/src/types/electron.d.ts`.
- [x] T017 [US1] Classify `resale-lines:list` (read, offline-safe) and `resale-lines:save` (write) in `packages/core/src/offline/channelPolicy.ts`, following neighbouring carrier-line channels.
- [x] T018 [US1] Create the REST routes in `backend/src/api/resaleLines.ts`:
  - `GET /` (`authenticateJWT`, query via `listResaleLinesQuerySchema`);
  - `PUT /:productId` (`authenticateJWT` → `requireRole('admin')` → `validateRequest(saveResaleLineSchema)`; `product_id` from the path must equal the body's).

  Return the IPC-identical envelope with HTTP 200 on failure. Mount at `/api/resale-lines` in `backend/src/server.ts`, with static paths before `/:productId`.
- [x] T019 [P] [US1] Write the backend route test `backend/src/api/__tests__/resaleLines.routes.test.ts`: a cashier gets a refusal on PUT, and an admin gets `{success:true}`. Assert payload field names from the schema (rule 24).
- [x] T020 [US1] Add adapter functions in `frontend/src/api/backendApi.ts` (`ipcOrHttp`): `getResaleLines(q?)` returns the raw array, and `saveResaleLine(input: z.input<typeof saveResaleLineSchema>)` returns the envelope. Expose them in `frontend/src/api/ElectronApiAdapter.ts` and type them in `packages/ui/src/api/types.ts` (`ApiAdapter`).
- [x] T021 [P] [US1] Write the frontend test `frontend/src/features/phoneLines/pages/PhoneLines/__tests__/PhoneLines.test.tsx`. With fixtures, the page shows a Shop lines group and a For sale group, and the status chips are right (green OK, amber EXPIRING, red IN_GRACE, grey LOST / "No expiry set"). The `useApi` mock returns a **stable** reference (rule 25).
- [x] T022 [US1] Create `frontend/src/features/phoneLines/pages/PhoneLines/index.tsx`, a default-export page with two tabs:
  - **Shop lines**: lists via the existing `getAdminCarrierLines` and edits through the existing carrier-line add/edit/archive/reactivate UI from `CarrierLinesManager.tsx`. Extract or reuse it; do not copy it.
  - **For sale**: lists via `getResaleLines`, with an inline edit of carrier (owner picks MTC/Alfa; never guessed from the prefix), expiry and credit via `saveResaleLine`, a "No expiry set" filter and a "Sold" filter.

  Columns: number, carrier, credit, expiry, days left, status chip. Status comes from `classifyLineStatus(expiry, localDay(), window)`, with window `SHOP_LINE_EXPIRY_WARNING_DAYS` for shop lines and `RESALE_LINE_EXPIRY_WARNING_DAYS` for for-sale lines. `api` is read through a ref. T021 passes.
- [x] T023 [US1] Add the route `/phone-lines` (lazy) in `frontend/src/app/App.tsx`. Add a sidebar link "Phone Lines" in `frontend/src/shared/components/layouts/Sidebar.tsx`, gated on `isModuleEnabled("recharge")` like the Warranty link (≈:265), and add `"/phone-lines": "recharge"` to the `routeToModule` map in `frontend/src/contexts/ActiveModuleContext.tsx`.
- [x] T024 [US1] In `frontend/src/features/inventory/pages/Inventory/ProductForm.tsx`, when `isPhoneLineCategoryName(category)`, show Carrier (MTC/Alfa, required), Expiry date and Credit fields:
  - load existing details with `getResaleLines`;
  - after product create/update succeeds, call `saveResaleLine` once.
  - Build the payload once (rule 22).
  - Add a test `ProductForm.lineDetails.test.tsx` beside the existing `ProductForm.numberLabel.test.tsx`.
- [x] T025 [US1] Add a release note line under `## 📱 MTC / Alfa` in `docs/release-notes/UNRELEASED.md`: a new Phone Lines page lists your shop lines and the lines you sell, with credit, expiry and days left, and you can now enter the expiry and credit of a line you sell.

**Checkpoint**: US1 works on desktop and web, and the MVP is demonstrable.

---

## Phase 4: User Story 2 — Get warned before a line expires (P1)

**Goal**:
- for-sale lines amber at ≤3 days, shop lines amber at ≤7 days (unchanged);
- red during the 5-day grace;
- an unsold LOST for-sale line gets a "lost — write off?" prompt;
- shown in Dashboard "needs attention" and in the bell, once per line, status and day;
- Write off books the loss reversibly.

**Independent Test**: set a for-sale line's expiry to today+2 and open the Dashboard. "needs attention" and the bell name the number. At today+4 there is no alert.

### Tests for User Story 2 (write first, see them fail)

- [x] T026 [P] [US2] Write `frontend/src/features/dashboard/utils/__tests__/lineExpiryAlerts.test.ts`:
  - for-sale alert at d = 3, none at d = 4;
  - shop-line alert at d = 7, none at d = 8 (unchanged behaviour);
  - red at d = −2 with "3 days left to save it";
  - LOST for-sale line → write-off item; LOST shop line → no alert;
  - sold or archived lines → none.

  Keep the existing `carrierLineAlerts` tests passing (`missing`, `sold-ahead`).
- [x] T027 [P] [US2] Write `packages/core/src/services/__tests__/ResaleLineService.writeOff.test.ts` (**C14**):
  - writing off an unsold LOST line with batch cost 18 creates an `EXPENSE_INVENTORY` expense of 18 at FIFO cost, stock 1→0, category "Lost phone line";
  - voiding that transaction restores stock 1 and removes the expense;
  - writing off a non-LOST or sold line is refused.

### Implementation for User Story 2

- [x] T028 [US2] Evolve `frontend/src/features/dashboard/utils/carrierLineAlerts.ts` into `computeLineExpiryAlerts(shopLines, resaleLines, today, rechargeEnabled)`:
  - move today's 7-day literal to `SHOP_LINE_EXPIRY_WARNING_DAYS` from core;
  - use `classifyLineStatus` for both kinds;
  - add kinds `resale-expiring`, `resale-grace` and `resale-lost` (write-off).

  Keep `missing` and `sold-ahead`. T026 passes.
- [x] T029 [US2] In `frontend/src/features/dashboard/pages/Dashboard.tsx`:
  - load `getResaleLines()` beside `getAllActiveCarrierLines()` (≈:711);
  - feed `computeLineExpiryAlerts`;
  - render items in `pageAlerts` (≈:1030), each naming the number, carrier, kind (shop / for sale) and days left or days left to save it;
  - actions navigate to `/phone-lines`.
- [x] T030 [US2] In `frontend/src/shared/components/layouts/TopBar.tsx` (beside the low-stock poll ≈:216-280):
  - compute the same alerts and `appEvents.emit("notification:show", text, "warning")`;
  - emit **at most once per `lineId:status:day` per session** through an in-memory `Set`, so the 20-entry bell does not flood (research R9).
- [x] T031 [US2] Add `writeOff({ productId, note, clientDay, userId })` to `ResaleLineService` (any transaction goes through a repository `withTransaction`; no `getDatabase()` in the service, rule 13):
  - require status LOST (computed with `clientDay ?? localDay()`, rule 27) and an unsold line;
  - call the existing `ExpenseRepository.createStockExpense` (ExpenseRepository.ts:654) with category "Lost phone line", quantity 1 and the note;
  - add **no** new money path.

  T027 passes.
- [x] T032 [US2] Wire `resale-lines:write-off` on every layer:
  - IPC handler with `requireRole(['admin'])` + `validatePayload(WriteOffResaleLineSchema)` in `electron-app/handlers/resaleLineHandlers.ts`, plus preload and `electron.d.ts`;
  - `channelPolicy.ts` (write);
  - REST `POST /api/resale-lines/:productId/write-off` (admin) in `backend/src/api/resaleLines.ts`, with `userId` from the JWT;
  - `writeOffResaleLine` in `backendApi.ts`, `ElectronApiAdapter.ts` and `packages/ui/src/api/types.ts`.
- [x] T033 [US2] Add a "Write off" button on LOST unsold for-sale rows in `frontend/src/features/phoneLines/pages/PhoneLines/index.tsx`, with an in-page confirm showing the amount (e.g. "Book $18.00 as a loss?") and a success toast.
- [x] T034 [US2] Add a release note line: the Dashboard and the bell now warn 3 days before a line you sell expires (shop lines still warn 7 days before), and a lost line asks whether to write it off.

**Checkpoint**: US1 + US2 work independently. Alerts are live with no money changes beyond the reversible write-off.

---

## Phase 5: User Story 3 — Recharge a for-sale line and carry the cost into its price (P1)

**⚠️ Start only after LIRA-308 is committed** (shared recharge and transaction files).

**Goal**: internal recharge from three sources. Cost *c* is capitalized into product cost, price and the open batch unit cost. The recharge is one `LINE_RECHARGE` transaction, reversible by delta and LIFO, and refused once the line is sold.

**Independent Test** (quickstart C2–C4): a $15/$25 line plus a DAYS recharge costing $3 gives cost $18 / price $28 / batch $18, with no expense row. Selling it books $10 profit. Voiding before the sale restores everything.

### Tests for User Story 3 (write first, see them fail)

- [x] T035 [P] [US3] Write `packages/core/src/repositories/__tests__/StockBatchRepository.addToOpenBatchUnitCost.test.ts`:
  > Delivered as (2026-10-13): T035–T039 were folded into ONE file, `packages/core/src/services/__tests__/ResaleLineService.recharge.test.ts` (15 tests, full create_db.sql DB). The separately named files do not exist. The batch-cost rule is tested through the service ("more than one unit" case).
  - adding 3 to the single open batch (`quantity_remaining = 1`) raises `unit_cost_usd` 15→18;
  - refused when there are 2 open batches or `quantity_remaining > 1`;
  - returns null and changes nothing when there is no batch (legacy);
  - a negative delta (reversal) lowers it.
- [x] T036 [P] [US3] Write `packages/core/src/services/__tests__/ResaleLineService.recharge.days.test.ts` (**C2, C3, C4, C11**). DAYS 30 days, cost $3, on an MTC line in stock:
  - product 18/28, batch 18, line expiry +30 through `projectValidityExpiry`;
  - source shop line validity −30 and credits −3, with a `carrier_line_movements` row;
  - MTC drawer −3, zero expense rows;
  - one `LINE_RECHARGE` transaction with `profit_usd 0`, `source_table='resale_line_recharges'` and `exchange_rate` stamped.

  Then:
  - sell it and assert `sale_items.cost_price_snapshot_usd = 18` and profit 10;
  - in a separate case, void before the sale and assert every field and drawer back to its prior snapshot (delta 0);
  - manual price edit 28→27, then void → 24.
- [x] T037 [P] [US3] Write `packages/core/src/services/__tests__/ResaleLineService.recharge.card.test.ts` (**C7, C10**):
  - an iPick MTC card with `cost_lbp` 356,000 at rate 89,000: iPick drawer −356,000 LBP, c = 4, line credits + card credits, expiry + `validity_days`, MTC/Alfa drawer untouched;
  - void → every delta 0;
  - a carrier mismatch (Alfa card on an MTC line) is refused;
  - **(E1)** a card whose `cost_lbp` is 0 or empty is refused with "Enter what this recharge cost before saving.";
  - **(U2)** the iPick drawer movement is a payment leg linked to the `LINE_RECHARGE` transaction (assert by `transaction_id`).
- [x] T038 [P] [US3] Write `packages/core/src/services/__tests__/ResaleLineService.recharge.credit.test.ts` (**C8, C10**). 2 credits from the primary MTC shop line:
  - shop line credits −(2 + SMS fee) and MTC drawer −(2 + SMS fee);
  - for-sale line credits +2;
  - c = (2×`alfa_credit_cost_lbp` + fee×rate) ÷ rate;
  - **no** `SMS_Transfer_Fee` expense row;
  - void → every delta 0;
  - insufficient shop-line credit is refused with the existing message.
- [x] T039 [P] [US3] Write `packages/core/src/repositories/__tests__/TransactionRepository.lineRechargeReversal.test.ts` (**C5, C6**):
  - void after the line is sold is refused with "Refund the sale of this line first.";
  - with two recharges, voiding the older first is refused with "Undo the newer recharge of this line first.";
  - newer then older both succeed;
  - a recharge on a LOST (BURNED) line is refused;
  - a recharge on a sold line is refused with "This line is not in stock."
  - **(U1, corrected 2026-10-13)** a DAYS recharge, then a later customer DAYS sale on the same source shop line: voiding the recharge SUCCEEDS. The recharge's days come back onto the shop line's current expiry and the later sale is kept (a sell reverses by arithmetic addback, `CarrierLineRepository.reverseMovement`).

### Implementation for User Story 3

- [x] T040 [US3] Register `LINE_RECHARGE` everywhere a transaction type must be classified:
  - `packages/core/src/constants/transactionTypes.ts` (`TRANSACTION_TYPES`; **not** in `NON_REVERSIBLE_TRANSACTION_TYPES`);
  - label "Line recharge" in `packages/core/src/utils/transactionText.ts`;
  - `TRANSACTION_CASH_DIRECTION.LINE_RECHARGE = null` in `packages/core/src/utils/cashFlow.ts` (analogue `TELECOM_SELF_CHARGE`);
  - a posting rule in `packages/core/src/constants/postingRules.ts`;
  - `ACTIONABLE_TYPES` in `frontend/src/features/audit/auditConstants.ts`.

  Typecheck passes; the exhaustive records compile.
- [x] T041 [US3] Add `addToOpenBatchUnitCost(productId, deltaUsd)` in `packages/core/src/repositories/StockBatchRepository.ts`, a guarded single UPDATE that checks `.run().changes`, returning `batchId` or null. T035 passes.
- [x] T042 [US3] Add to `ResaleLineRepository`:
  - `insertRecharge(row)`, `getLatestUnreversedForLine`, `markReversed` and `getByTransactionId`;
  - `applyCapitalization(productId, deltaUsd)`, which updates `products.cost_price_usd` and `selling_price_usd` by `+delta` inside the caller's transaction;
  - `setDetailsSnapshot(lineId, { validityExpiresAt, credits })`.
- [x] T043 [US3] Add the `rechargeResaleLineSchema` from `contracts/resale-lines.md` to `packages/core/src/validators/resaleLine.ts`:
  - `source: 'CARD' | 'SHOP_LINE_CREDIT' | 'DAYS'`;
  - `mobile_service_item_id` required for CARD, `credits > 0` required for SHOP_LINE_CREDIT, `days > 0` and `days_cost_usd > 0` required for DAYS, all through `superRefine`;
  - optional `source_carrier_line_id`;
  - `exchange_rate > 0`;
  - optional `client_day`.

  Export from both entry points and `electron-app/schemas/index.ts`.
- [x] T044 [US3] Implement `ResaleLineService.recharge(input, userId)` in ONE DB transaction, run through **`ResaleLineRepository.withTransaction(...)`**, the repository pattern used by `WarrantyService` (`this.claims.withTransaction`, WarrantyService.ts:284). The service never calls `getDatabase()` (rule 13). Guards first:
  > Owner decisions 2026-10-13: DAYS from a shop line with **no expiry** is refused ("Set the expiry of shop line X first"); DAYS needing more days than the shop line has is refused; SHOP_LINE_CREDIT is **allowed** when the shop line is low (like a credit sale). Not proven failing-first: the U1 test (undo succeeds) and the multi-unit test.
  - unsold, else "This line is not in stock.";
  - not LOST/BURNED, using `client_day ?? localDay()`;
  - carrier match;
  - a single open batch;
  - a known cost: DAYS `days_cost_usd > 0` (schema); CARD catalog item active, same carrier and `cost_lbp > 0`, else "Enter what this recharge cost before saving."

  Compute *c* once (research R3–R5), then per source:
  - **DAYS**: reuse the DAYS line movement on the source shop line (default primary), with reason `RESALE_DAYS`, `days_owed` handling and the `VALIDITY_DAYS_COST` drawer leg; *c* = `days_cost_usd`.
  - **SHOP_LINE_CREDIT**: shop line `applyMovement` credits −(credits + smsCostUsd) with reason `RESALE_TRANSFER`, the MTC/Alfa drawer leg by the same amount, and no SMS expense; *c* = (credits × `alfa_credit_cost_lbp` + smsCostUsd × rate) ÷ rate.
  - **CARD**: the provider (iPick/Katsh) drawer leg `−cost_lbp`, mirroring `FinancialServiceRepository.selfChargeTelecomItem` (≈:4830) but targeting the for-sale line; *c* = `cost_lbp ÷ rate`.

  **Every drawer movement (CARD provider leg, DAYS/SHOP_LINE_CREDIT MTC/Alfa leg) MUST be written as a payment leg linked to the `LINE_RECHARGE` transaction id**, so the generic `_reversePayments` reverses it (U2). Before copying, read how `selfChargeTelecomItem` posts its drawer movement. If it does not write a leg linked to its transaction, use the leg writer that does; never write a bare drawer adjustment.

  Then:
  - write the `LINE_RECHARGE` transaction (no client, `profit_usd 0`, `metadata_json.source`);
  - `applyCapitalization(+c)`, `addToOpenBatchUnitCost(+c)`;
  - project the line expiry with `projectValidityExpiry` and raise credits;
  - `insertRecharge` with the `prev_*` snapshot.

  Reuse the existing movement and leg writers; never re-implement them. T036–T038 pass.
- [x] T045 [US3] Add the `_reverseResaleLineRecharge` step in `packages/core/src/repositories/TransactionRepository.ts`, keyed on `resale_line_recharges.transaction_id` and placed beside `_reverseCarrierLineMovements` (≈:9368) in the void and refund sequences. It:
  - refuses if the line has been sold (batch consumed or stock 0) with "Refund the sale of this line first.";
  - refuses if it is not `getLatestUnreversedForLine` with "Undo the newer recharge of this line first.";
  - otherwise applies `applyCapitalization(−c)` and `addToOpenBatchUnitCost(−c)`, restores the `prev_validity_expires_at`/`prev_credits` snapshot and calls `markReversed`.

  Drawer legs and shop-line movements are reversed by the existing generic steps. T039 passes, and C10 net-zero passes for all three sources.
- [x] T046 [US3] Wire `resale-lines:recharge` on every layer:
  - an IPC handler (any authenticated session, like `recharge:process`) with `validatePayload(RechargeResaleLineSchema)` and `userId` from the session;
  - preload and `electron.d.ts`;
  - `channelPolicy.ts` (classified like `recharge:process`);
  - REST `POST /api/resale-lines/:productId/recharge` (`authenticateJWT`, no extra role, `userId` from the JWT, client day from `X-Client-Day`/body);
  - `rechargeResaleLine` in `backendApi.ts`, `ElectronApiAdapter.ts` and `packages/ui/src/api/types.ts`.
- [x] T047 [US3] Create `frontend/src/features/recharge/components/ResaleLineRechargePanel.tsx`. It has three source tabs:
  > Delivered as (2026-10-13): the panel lives in `frontend/src/features/phoneLines/components/ResaleLineRechargePanel.tsx` (test beside it), and a **Recharge** button on the Phone Lines page opens it. Phase 6 (T052) imports it from there.
  - Days: days, days cost (USD) and source shop line (default primary);
  - Shop-line credit: credits and source shop line, with the SMS fee preview;
  - Card: the iPick/Katsh card picker, loaded with the existing **`api.getActiveMobileServiceItems()`** (as `KatshForm.tsx:819` does) and filtered to provider iPick/Katsh, the line's carrier (`category` `mtc`/`alfa`) and `cost_lbp > 0`.

  It shows a live preview "Cost $15 → $18 · Price $25 → $28" and submits one payload. On success it shows the toast and refreshes the line. Add a test `ResaleLineRechargePanel.test.tsx` that asserts payload fields from the schema (rule 24).
- [x] T048 [US3] Add a release note line: you can now recharge a line you sell from Mobile Recharge (days, credit from your shop line, or an iPick/Katsh card). What it cost is added to the line's cost and selling price, so its profit stays the same, and voiding the recharge puts everything back.

**Checkpoint**: US3 money flow is proven net-zero per source and its profit is unchanged.

---

## Phase 6: User Story 4 — Mobile Recharge recognises every number that is ours (P2)

**Goal**: a typed number in any format is recognised as a shop line or an unsold for-sale line. A for-sale line opens the internal recharge, and the backend refuses a customer recharge on it.

**Independent Test**: type "+961 3 555 101" for an unsold for-sale line and see the banner. The customer payment section is replaced by `ResaleLineRechargePanel`.

### Tests for User Story 4 (write first, see them fail)

- [x] T049 [P] [US4] Write `packages/core/src/repositories/__tests__/RechargeRepository.resaleLineGuard.test.ts` (**C12**):
  - `processRecharge` for a customer on number "+961 3 555 101" matching an unsold for-sale line is refused with "This is your line for sale — use Recharge line on the Phone Lines or Mobile Recharge page.";
  - after the line is sold (stock 0) it is accepted.
- [x] T050 [P] [US4] Write `frontend/src/features/recharge/pages/Recharge/__tests__/Recharge.resaleLineDetection.test.tsx`:
  > Delivered as (2026-10-13): the frontend test is `frontend/src/features/recharge/components/__tests__/TelecomForm.resaleLineMatch.test.tsx` (form-level, `resaleLineMatch` prop); the page matches the number and passes it in. The guard message is "This is your line for sale — use Recharge on the Phone Lines page (or the Recharge line panel on Mobile Recharge)."
  - "+961 3 555 101" shows "This is your line for sale: MTC line 03 555 101" and renders the panel instead of the payment section;
  - an Alfa line's number on the MTC tab shows "This is an Alfa line" and no panel;
  - shop-line behaviour is unchanged;
  - the `useApi` mock is stable.

### Implementation for User Story 4

- [x] T051 [US4] In `packages/core/src/repositories/RechargeRepository.ts`, next to the `isShopOwnLine` re-check (≈:975-983), refuse customer recharges whose number matches `ResaleLineRepository.findUnsoldByNumber` (using the same "unsold line" fragment from T010). T049 passes.
- [x] T052 [US4] In `frontend/src/features/recharge/pages/Recharge/index.tsx`:
  - load `getResaleLines({ carrier, include_sold: false })` beside `getActiveCarrierLines` (≈:292);
  - match with `isSameLebanesePhone`;
  - on a match show the banner and render `ResaleLineRechargePanel` instead of the customer payment section;
  - block when the carrier tab differs.

  `api` is read through a ref. T050 passes.
- [x] T053 [US4] Add a release note line: Mobile Recharge now recognises the lines you sell, however the number is typed, and won't let them be charged as a customer sale.

**Checkpoint**: all four stories work independently.

---

## Phase 7: Polish & cross-cutting

- [ ] T054 Write the web e2e `frontend/tests/e2e-web/lira-web-057-phone-lines.spec.ts`, renumbering if 057 has been taken (quickstart steps 1–4: details → Dashboard alert → DAYS recharge via +961 number → Inventory $18/$28 → void → $15/$25 → POS sale profit delta $10). Match rows by identity and assert deltas (rule 15). Run it with `npx playwright test --config playwright.web.config.ts -g "phone lines"`.
- [ ] T055 [P] Write the electron handler tests `electron-app/handlers/__tests__/resaleLineHandlers.roleGate.test.ts`: save and write-off are admin-only; list and recharge are allowed for an authenticated cashier.
- [ ] T056 Run the full quality gates and record elapsed times and suite counts (rule 28): `yarn lint`, `yarn typecheck`, `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`, core/backend/frontend/electron-handler test suites, `yarn build`, `node scripts/build-release-notes.cjs --check`.
- [ ] T057 [P] Update `docs/FEATURE_GUIDE.md` with a short `LINE_RECHARGE` entry: capitalization by delta, the LIFO/sold refusals and the reversal owner `_reverseResaleLineRecharge`.
- [ ] T058 Do a manual check on the test tenant after the owner pushes, with the Alfa demo line 70 444 202 ($12/$20) from 2026-10-11. Repeat quickstart "Manual check" and update `current_sprint.md` LIRA-309 status.

---

## Dependencies & execution order

```
Phase 1 Setup ─▶ Phase 2 Foundational ─┬─▶ US1 (P1, MVP) ─┬─▶ US2 (P1)
                                       │                  └─▶ US3 (P1) ─▶ US4 (P2)
                                       └── (LIRA-308 committed) ──┘
                                                     all ─▶ Phase 7 Polish
```

- **US1** needs Phase 2.
- **US2** needs US1's read API (`getResaleLines`) and page (for Write off).
- **US3** needs Phase 2, US1's details (expiry/credit to update), and **LIRA-308 committed**.
- **US4** needs US3's `ResaleLineRechargePanel` and recharge operation. Its backend guard (T049/T051) could land earlier than the rest of US4.
- Within each story: tests (fail) → repository → service → handler/route/adapter → UI → release note.

## Parallel opportunities

- Phase 2: T007 (test) runs alongside T009 (schemas).
- US1: T011, T012, T013 and T019 are written in parallel. T021 runs in parallel with the backend work.
- US2: T026 and T027 run in parallel. T028–T030 (frontend) run in parallel with T031–T032 (core and transports).
- US3: T035–T039 are all parallel test files. T040 and T041 are parallel.
- US4: T049 and T050 run in parallel.
- Polish: T055 and T057 run in parallel.

### Example: US3 test burst

```
T035 StockBatchRepository.addToOpenBatchUnitCost.test.ts
T036 ResaleLineService.recharge.days.test.ts
T037 ResaleLineService.recharge.card.test.ts
T038 ResaleLineService.recharge.credit.test.ts
T039 TransactionRepository.lineRechargeReversal.test.ts
```

## Implementation strategy

1. **MVP = Phases 1–3 (US1)**: a page listing every line with expiry and credit. No money code is touched, and it can ship while LIRA-308 is in flight.
2. **US2** next: alerts plus the reversible write-off. This is the owner's main pain point, and it still adds no new money path.
3. **US3** after LIRA-308 lands: the money part, test-first, net-zero proven per source.
4. **US4** last: detection and the backend guard, then web e2e and gates.

Each phase ends at a checkpoint with gates green, and each can be committed on the owner's "commit".
