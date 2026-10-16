---

description: "Task list for LIRA-324 — Whish App items in USD (LBP | USD switch)"
---

# Tasks: Whish App items in USD (LBP | USD switch)

**Input**: Design documents from `specs/324-whish-usd-mode/` (plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md)

**Tests**: Included — the constitution (VI) and Feature Guide §13 require money guards. New behaviour: write the test first and see it fail (rule 17). Characterization tests of behaviour that already exists are labelled "pins existing behaviour (not failing-first)".

**Organization**: grouped by user story (spec.md US1–US4). Ask the owner before running any jest/e2e suite (owner rule).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US4 from spec.md

---

## Phase 1: Setup

**Purpose**: the USD price data every later phase reads

- [X] T001 Build the USD price list from the 2026-10-14 crawl (`docs/whish-prices/` + scratch join): for every WHISH_APP item in `frontend/src/data/providers/whishApp.ts` outside alfa/mtc `Prepaid`, its USD cost by `(category, subcategory, label)`; and the 34 USD-only items (exclude ALFA WAFFER, a Prepaid card) mapped to `(category, subcategory, label)` with the same subcategory rules used for the LBP additions (provider + Whish tab for multi-region providers). Output a reviewed JSON in the scratchpad; expected counts 319 priced + 33 USD-only (Climbing Sand Dune $37.39 is the LBP item $37.79 — priced, not added)
- [X] T002 Commit the frozen data file `packages/core/src/db/migrations/data/v218WhishUsdPrices.ts` from T001: `V218_USD_PRICES` (rows `{category, subcategory, label, cost_usd}`) and `V218_USD_ONLY_ITEMS` (rows `{category, subcategory, label, cost_usd}`), header comment "FROZEN data for migration v218 — do not edit"

---

## Phase 2: Foundational (blocking)

**Purpose**: columns, contracts and the sellability rule that all stories use

- [X] T003 Write `packages/core/src/db/migrations/__tests__/v218.whishUsdPrices.test.ts` FIRST (fails: no v218): follows v215→v216→v218 order; `create_db.sql` declares `cost_usd`, `sell_usd`; up() on a seeded tenant sets `cost_usd = sell_usd = X` only where `cost_usd IS NULL` (a row with an existing USD price and every LBP column untouched); adds the 34 USD-only items with `cost_lbp = 0, sell_lbp = 0`; a tenant with no catalog rows untouched; idempotent; down() keeps a repriced item and a referenced USD-only row, drops the columns
- [X] T004 Add migration v218 `whish_app_usd_prices` in `packages/core/src/db/migrations/index.ts`: add `cost_usd REAL NULL`, `sell_usd REAL NULL` if missing; exported helpers `addWhishUsdPrices(db)` / `removeWhishUsdPrices(db)` modelled on v216 (tenants = `SELECT DISTINCT tenant_id FROM mobile_service_items`; `tenant_id IS ?`; `?` placeholders; transaction; down nulls only values still equal to what v218 wrote, deletes unchanged + unreferenced USD-only rows (`wrong_number_cards`, `resale_line_recharges`), then `ALTER TABLE … DROP COLUMN`)
- [X] T005 Mirror in `electron-app/create_db.sql`: the two columns in `CREATE TABLE mobile_service_items` (comment "v218 (LIRA-324): USD price pair — NULL = not sold in USD") and the seed row `(218, 'whish_app_usd_prices')`; run `yarn check:schema-equivalence`
- [X] T006 [P] Repository `packages/core/src/repositories/MobileServiceItemRepository.ts`: `cost_usd: number | null`, `sell_usd: number | null` on `MobileServiceItemEntity`; optional on `CreateMobileServiceItemData` / `UpdateMobileServiceItemData`; add to `getColumns()`, `createItem`, `updateItem` (one `!== undefined` block each, `null` clears), `bulkCreate`
- [X] T007 [P] Schemas `packages/core/src/validators/mobileServiceItem.ts`: `cost_usd`, `sell_usd` = "`number ≥ 0`, nullable, optional (update: `null` clears)" on create and update (seed follows create); do the three-way key diff (rule 23) for create/update/seed against `electron-app/preload.ts` and `frontend/src/types/electron.d.ts`
- [X] T008 [P] Types: `electron-app/preload.ts` (`mobileServiceItems.create/update/seed`), `frontend/src/types/electron.d.ts` (`MobileServiceItem` + create/update/seed), `frontend/src/api/backendApi.ts` `MobileServiceItemEntity`, `packages/ui/src/api/types.ts` `MobileServiceItemEntity` — add `cost_usd`/`sell_usd`
- [X] T009 Write `packages/core/src/constants/__tests__/catalogCurrency.test.ts` FIRST (fails: no module): `isUsdSellable` true only when `cost_usd > 0 AND sell_usd > 0` and never for `category IN ('alfa','mtc') AND subcategory = 'Prepaid'`; `isLbpSellable` false only for `cost_lbp = 0 AND sell_lbp = 0 AND cost_usd > 0` (a legacy item with LBP 0 and no USD stays sellable)
- [X] T010 Create `packages/core/src/constants/catalogCurrency.ts` (pure, no imports — reachable from `browser.ts`, rule 29) exporting `isUsdSellable`, `isLbpSellable`, `CatalogCurrency = "LBP" | "USD"`; export from `packages/core/src/browser.ts` and `packages/core/src/constants/index.ts`
- [X] T011 `frontend/src/contexts/MobileServiceItemsContext.tsx`: `ServiceItem` gains `catalogCostUsd?: number`, `catalogSellPriceUsd?: number` from `cost_usd`/`sell_usd`; read the `item_costs` merge (~L202-221) and apply a saved cost only in its own currency (research R6) — RESOLVED 2026-10-16: `savedCost` has no consumer anywhere in the frontend, so there is nothing to guard; only the USD fields were added
- [X] T012 Starting catalog plumbing: `ItemPricing` in `frontend/src/data/mobileServices.ts` gains `cost_usd?: string`, `sell_usd?: string`; `SeedItem` + `parseCatalogToSeedData` in `frontend/src/features/recharge/utils/parseCatalogToSeedData.ts` pass `cost_usd`/`sell_usd` (number or null)
- [X] T013 `yarn build:core` (sync), `yarn workspace @liratek/core typecheck`, `yarn workspace @liratek/frontend typecheck`, `yarn workspace @liratek/backend typecheck`; ask the owner, then run T003 and T009 tests

**Checkpoint**: schema, types and rule in place; LBP behaviour unchanged.

_Analysis C1 (2026-10-16): StockUsePicker and ResaleLineRechargePanel list only items with `cost_lbp > 0`, WrongNumberPanel only mtc/alfa cards — USD-only items cannot appear there; no change needed._

---

## Phase 3: User Story 1 — Sell a Whish App item at its USD price (P1) 🎯 MVP

**Goal**: in USD mode a Whish App item sells at its USD price; cost from `Whish_App` USD; profit in USD; void nets 0; For Partner and session basket in USD (FR-006–FR-008, FR-013, FR-015).

**Independent test**: switch to USD, sell one item paid $ cash → USD sale, `Whish_App` USD −cost, cash +price, `profit_usd = price − cost`; void → all back.

- [X] T014 [P] [US1] `packages/core/src/repositories/__tests__/FinancialServiceRepository.whishUsdSale.test.ts` — pins existing behaviour (not failing-first): WHISH_APP cost/price sale with `currency: "USD"`: `payments` cost row on `Whish_App` USD = −cost, `drawer_balances` deltas per currency, `transactions.amount_usd`/`profit_usd`, `checkoutTotal {usd}` leg reconciliation, split LBP+USD legs, `CUSTOMER_ACCOUNT` debt in USD; void and refund via `TransactionRepository` net 0 per currency on every balance (Feature Guide §13 items 4, 5, 7, 9, 10, 14, 15). If any assertion fails, fix the repository (that is a real defect), not the test
  - Done in `TransactionRepository.refundCostPriceFlow.test.ts` (describe "LIRA-324"): cash, split USD+LBP, customer account, short payment. All passed on first run; no repository change needed.
- [X] T015 [P] [US1] Same file or `FinancialServiceRepository.whishUsdPartner.test.ts`: For Partner USD catalog sale → `partner_ledger` delta in USD; session `_batch` cart entry with `currency: "USD"` → checkout buckets customer amount and profit in USD (`SessionCheckoutService`)
  - For Partner: `FinancialServiceRepository.partner.test.ts`. Session: `FinancialForm.usdMode.test.tsx` pins the USD cart entry; checkout of a USD cost/price `_batch` is already covered by `TransactionRepository.refundSessionBasketCostPriceFlow.test.ts` (USD is the checkout's default bucket).
- [X] T016 [US1] Write `frontend/src/features/recharge/components/__tests__/FinancialForm.usdMode.test.tsx` FIRST (fails: no prop): with `currency="USD"` the grid shows only `isUsdSellable` items with `$` prices; submit sends `currency: "USD"`, `amount = sell_usd`, `cost = cost_usd`, `checkoutTotal.usd = total`, `checkoutTotal.lbp = 0`, `extra_usd`; For Partner sends `currency: "USD"`; session add sends cart entry + sub-items `currency: "USD"`; field names parsed through `createFinancialServiceSchema` (rule 24); with no prop the LBP payload is byte-identical to today
- [X] T017 [US1] `frontend/src/features/recharge/components/FinancialForm.tsx`: add prop `currency?: CatalogCurrency` (default `"LBP"`); price source `catalogCostUsd`/`catalogSellPriceUsd` in USD; replace every hard-coded `"LBP"` (session label + sub-items + entry, `checkoutTotal`, walk-in `currency`, `extra_lbp`→per-currency extra, partner `currency`/`currencyCode`, display strings, `PaymentSheet totalAmountCurrency`/`currency`) with the prop; filter items with `isUsdSellable`/`isLbpSellable`; USD formatting `$0.00`; empty-state text from `contracts/bills-currency-switch-ui.md`
- [X] T018 [US1] `frontend/src/features/recharge/pages/Recharge/index.tsx`: LBP | USD segmented control on Whish App → Bills only (same style as Transfer | Bills, accessible name "Currency"), state `whishBillsCurrency` passed to `<FinancialForm currency=…>`; no switch on any other provider or on Transfer
- [X] T019 [US1] Ask the owner, then run T014–T016 + `src/features/recharge` + `src/contexts` frontend tests

**Checkpoint**: USD sale works end to end (no memory, no confirm yet).

---

## Phase 4: User Story 2 — The switch remembers; LBP stays as today (P1)

**Goal**: default LBP, remembered per device; confirm-then-clear when switching with a selection (FR-002, FR-009).

**Independent test**: fresh device → LBP; pick USD, reload → USD; with 2 items selected, switching asks and clears.

- [X] T020 [P] [US2] Write `frontend/src/features/recharge/utils/__tests__/whishBillsCurrencyStorage.test.ts` FIRST: absent/invalid/throwing storage → `"LBP"`; save/load round-trip; key `liratek:whish-bills-currency`
- [X] T021 [P] [US2] Create `frontend/src/features/recharge/utils/whishBillsCurrencyStorage.ts` (`loadWhishBillsCurrency()`, `saveWhishBillsCurrency()`, try/catch, modelled on `features/suppliers/utils/omtCoveredTypesStorage.ts`)
- [X] T022 [US2] Write `frontend/src/features/recharge/pages/Recharge/__tests__/Recharge.whishCurrencySwitch.test.tsx` FIRST: initial mode from storage; switching saves; with a non-empty selection a confirm appears — Cancel keeps mode + selection, Continue clears selection and switches
- [X] T023 [US2] Wire storage + confirm dialog in `frontend/src/features/recharge/pages/Recharge/index.tsx` (selection state lives in `FinancialForm`: expose a "has selection" signal or lift a `clearSelection` callback; no transport branching)
  - Done differently: the form owns the basket, so it renders the switch and the confirm (`onCurrencyChange` prop); the page only loads/saves the choice. Confirm tests live in `FinancialForm.usdMode.test.tsx` (seen failing first), not a page test.

**Checkpoint**: US1 + US2 = shippable MVP for shops that already have USD prices.

---

## Phase 5: User Story 3 — Which items appear in which currency (P2)

**Goal**: USD-only items in USD only; LBP-only items in LBP only; Prepaid cards never in USD; same name/picture/order in both (FR-003–FR-005).

**Independent test**: USD shows Razer $1, hides Genshin Impact and every Prepaid card; LBP the opposite; order and pictures identical.

- [X] T024 [P] [US3] Extend `FinancialForm.usdMode.test.tsx`: a USD-only item hidden in LBP, an LBP-only item hidden in USD, alfa/mtc Prepaid hidden in USD; `sortItems` order of the shared items identical in both modes
- [X] T025 [P] [US3] Card images for the 34 USD-only labels: regenerate `frontend/src/features/recharge/utils/cardImageManifest.ts` + `frontend/src/assets/cards/` from the crawl images (same generator, border trim, one file per source card); `cardImages.test.ts` gets one USD-only key

---

## Phase 6: User Story 4 — Existing shops get USD prices; owners can edit them (P2)

**Goal**: USD prices in new shops' starting catalog and existing shops (v218); Settings edits USD (FR-010–FR-012).

**Independent test**: after v218 on a copy of a shop, every crawled USD price is set where empty, 34 USD-only items exist, 0 LBP prices/names changed; Settings shows and saves USD.

- [X] T026 [US4] `frontend/src/data/providers/whishApp.ts`: add `cost_usd`/`sell_usd` (sell = cost) to the 319 items from T001; add the 34 USD-only items with `cost: "0", sell: "0"` in their subcategories; verify with a bundled dump that every v218 row (T002) matches a `whishApp.ts` item (same key, same USD cost)
- [X] T027 [US4] Update `frontend/src/data/__tests__/mobileServices.test.ts` / `parseCatalogToSeedData.test.ts` expectations: WHISH_APP item count +34; no alfa/mtc Prepaid item carries `cost_usd`; seed rows carry `cost_usd`/`sell_usd`
- [X] T028 [US4] Write `frontend/src/features/settings/pages/Settings/__tests__/MobileServicesManager.usdPrices.test.tsx` FIRST: edit row shows "Cost (USD)" / "Sell (USD)"; saving sends `cost_usd`/`sell_usd` (numbers, 2 decimals) or `null` when cleared; add form sends them; row summary shows `$10.00 / $10.00`
- [X] T029 [US4] `frontend/src/features/settings/pages/Settings/MobileServicesManager.tsx`: `EditingState`, `NewItemForm`, `EMPTY_NEW_ITEM`, `handleSaveEdit`, `handleAddItem`, edit row and add form inputs (`parseFloat`, empty → `null`), row summary
- [X] T030 [US4] Offline check: `packages/core/src/offline/channelPolicy.ts` — if any `mobile-service-items:*` channel is `offline`/`checkpoint`, update its fixture under `packages/core/src/offline/testHelpers/fixtures/`; run the offline guards (ask first)
  - No change needed: every `mobile-service-items:*` write is `online_only`, reads are `READ`.

---

## Phase 7: Polish & cross-cutting

- [ ] T031 (written, not run yet) Web e2e `frontend/tests/e2e-web/lira-web-0NN-whish-usd-sale.spec.ts` (next free number): switch to USD, sell one item paid $ cash, assert `Whish_App` USD and cash drawer **deltas** and the transaction by identity (rule 15); void and assert deltas back to 0; prove it fails before T017/T018 (rule 17)
- [X] T032 [P] Release note in `docs/release-notes/UNRELEASED.md` (📱 MTC / Alfa or the Whish App heading): shop-owner wording — Whish App → Bills has an LBP | USD switch; USD prices from Whish; Prepaid cards stay LBP; set USD selling prices in Settings → Mobile Services. Do not let Prettier reformat the Highlights section; run `yarn release-notes:check`
- [X] T033 [P] Add LIRA-324 to `current_sprint.md` with a "What users will notice:" line (coordinate: another session may be editing the file — touch only the new ticket block)
- [X] T034 Gates: `yarn lint`, `yarn typecheck`, `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`, `yarn release-notes:check`; ask the owner, then core + backend + frontend suites (confirm suite counts and elapsed time, rule 28)
- [ ] T035 Run `specs/324-whish-usd-mode/quickstart.md` scenarios 1–11 on `yarn dev:web` (local DB gets v218); screenshots for the owner
- [X] T036 Update `docs/plans/todo_plans/WHISH_USD_PREPAID_CARDS.md` if anything learned changes the deferred Prepaid scope

---

## Dependencies & execution order

- **Setup (T001–T002)** → **Foundational (T003–T013)** → stories.
- **US1 (T014–T019)** needs Foundational. **US2 (T020–T023)** needs T018 (the switch exists). **US3 (T024–T025)** needs T017. **US4 (T026–T030)** needs Foundational; T026 needs T001.
- To see USD items in practice, US4's T026 (new shops) or v218 (existing shops) must have run — tests use fixtures, so US1–US3 are testable without it.
- **Polish** after the stories it covers; T031 needs US1 + US2 + data (T026 or v218).

## Parallel opportunities

- Foundational: T006, T007, T008 in parallel after T004/T005; T009→T010 alongside them.
- US1: T014 and T015 (core tests) in parallel with T016 (frontend test).
- US2: T020/T021 in parallel with T022.
- US3: T024 and T025 in parallel.
- Polish: T032 and T033 in parallel.

## Implementation strategy

1. **MVP = Setup + Foundational + US1 + US2**: shops can switch and sell in USD wherever USD prices exist.
2. **US4** next — without it, existing shops' USD mode is empty; ship US4 in the same release as the MVP (the release note promises USD prices).
3. **US3** polish of visibility + USD-only pictures.
4. Commit per phase (owner says "commit"); push only on the owner's word — pushing runs v218 on production.
