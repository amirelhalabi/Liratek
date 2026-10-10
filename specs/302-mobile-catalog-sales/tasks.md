---

description: "Tasks for LIRA-302 — phone Katsh / iPick catalog sales"
---

# Tasks: Phone Katsh / iPick catalog sales

**Input**: Design documents from `specs/302-mobile-catalog-sales/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/catalog-sale.md, quickstart.md

**Tests**: requested by the plan and the constitution (money path): builder unit tests, a web parity test written
before the web refactor, and a real-schema money suite. UI flows are checked by hand / Maestro (quickstart).

**Organization**: by user story. Paths are relative to the repository root.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US4 from spec.md

---

## Phase 1: Setup

- [ ] T001 Read the web's LBP→USD tender conversion used by the Katsh checkout (`frontend/src/features/recharge/components/KatshForm.tsx` PaymentSheet / `MultiPaymentInput` and whatever helper they call) and record in research.md R3 the exact rule (division by the buy rate, rounding mode and precision) and the function to reuse, if any

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the shared core pieces (FR-007) and the parity guard before any web change.

- [ ] T002 [P] Create `packages/core/src/utils/exchangeRates.ts` by moving `getExchangeRates` (and its `ExchangeRates` type) verbatim from `frontend/src/utils/exchangeRates.ts`; make the fallback optional so a caller can get `null` when there is no LBP row (keep the web's behaviour: the web passes its fallback); `frontend/src/utils/exchangeRates.ts` re-exports from `@liratek/core`
- [ ] T003 [P] Create `packages/core/src/utils/catalogSale.ts` with `formatCatalogItemName` (moved verbatim from `frontend/src/features/recharge/hooks/useMobileServiceItems.ts`, which re-exports it) and `catalogCartNote(lines)` — per line `"<name>"` + `" x<qty>"` when qty > 1 + optional `suffix`, joined by `", "` (same text as `KatshForm.tsx:1687-1692`)
- [ ] T004 Add `usdForLbp(lbp, rate)` to `packages/core/src/utils/catalogSale.ts` using the rule recorded in T001
- [ ] T005 Add `buildCatalogSalePayload(input)` to `packages/core/src/utils/catalogSale.ts` returning `CreateFinancialServicePayload`: `provider`, `serviceType: "SEND"`, `currency: "LBP"`, `amount` = Σ `sell_lbp` × qty, `cost` = Σ `cost_lbp` × qty, `commission` = `max(0, amount − cost)`, `note` = `catalogCartNote`, `paidByMethod`, `payments`, `checkoutTotal: { usd: 0, lbp: amount }` when legs are given, `tender_exchange_rate` when given, `clientId`/`clientName` when a client is given; throw on an empty cart or a quantity that is not an integer ≥ 1 (data-model "quantity an integer ≥ 1")
- [ ] T006 Export both modules from `packages/core/src/browser.ts` and `packages/core/src/index.ts`; run `src/__tests__/browserEntryIsNodeFree.guard.test.ts` (rule 29)
- [ ] T007 [P] Unit tests `packages/core/src/utils/__tests__/catalogSale.test.ts`: totals and commission for a 2-line cart; note text with and without quantities and a suffix; `usdForLbp` rounding; every builder output parses through `createFinancialServiceSchema` (field names from the schema, rule 24); errors on empty cart / qty 0 / qty 1.5
- [ ] T008 [P] Unit tests `packages/core/src/utils/__tests__/exchangeRates.test.ts` (move the web's cases if any exist; else cover v59 row, legacy rows, missing LBP row with and without fallback)
- [ ] T009 Parity test `frontend/src/features/recharge/components/__tests__/KatshForm.builderParity.test.tsx`: render `KatshForm` with a mocked `useApi()` (stable reference, rule 25), add two catalog items (one ×2), check out paid on a customer's account and once with a Whish USD leg, capture the `addOMTTransaction` payload, and assert it equals `buildCatalogSalePayload` for the same cart (plus only the extras the web adds: `transaction_time`, undefined keys). Run it against the CURRENT inline code first and record that it passes (characterization; this is the guard for T010)
- [ ] T010 Refactor the walk-in cart construction in `frontend/src/features/recharge/components/KatshForm.tsx` (`:1687-1773`) to call `buildCatalogSalePayload` and spread the web-only extras on top (discount lowers `amount`/`commission`/`checkoutTotal`; Only-Days `telecomCreditReturns` and the `" [Only Days]"` note suffix; `split_*`; `kept_change_*`; `transaction_time`). Leave the BILL, session-basket, For-Partner and self-charge paths untouched
- [ ] T011 Run the parity test and the 8 existing `KatshForm.*` suites plus `frontend/src/features/recharge` and `frontend/src/utils` tests; all must pass unchanged (SC-005)

**Checkpoint**: one builder, used by the web; web behaviour proven unchanged.

---

## Phase 3: User Story 3 — Same sale everywhere (P1, money proof first)

**Goal**: prove the builder's payload books exactly like the counter and reverses to zero, for every combination.

**Independent test**: the money suite below.

- [ ] T012 [US3] Money suite `packages/core/src/repositories/__tests__/FinancialServiceRepository.phoneCatalogSales.test.ts` on the real schema (`installWarrantyTestDb`, as `FinancialServiceRepository.phoneSales.test.ts`): for provider ∈ {Katsh, iPick} × method ∈ {CUSTOMER_ACCOUNT, WHISH, OMT} × currency ∈ {LBP, USD}, a 2-line cart through `buildCatalogSalePayload` → `createFinancialServiceSchema.parse` → `getFinancialService().addTransaction`; assert as deltas (rule 15): provider drawer −cost (LBP); Whish_App/OMT_App +price (LBP) or +USD amount; customer debt +price or +USD amount on account and unchanged otherwise; `transactions.client_id` set when a client was given; profit = price − cost; no supplier_ledger row; then `voidTransaction` → every drawer and the debt back to the starting values, per currency (rule 20)
- [ ] T013 [US3] Same suite: an MTC/Alfa card item sold as a plain line books like any other item and moves no carrier-line drawer (FR-011)
- [ ] T014 [US3] Same suite: the sale's title and summary through `transactionTitle` / `transactionSummary` (LIRA-301) read "Katsh" / "iPick" and contain the item names

**Checkpoint**: SC-002 / SC-003 proven on the real schema.

---

## Phase 4: User Story 1 — Sell catalog items on the customer's account (P1) 🎯 MVP

**Goal**: the phone screen, account payment in LBP.

**Independent test**: quickstart manual scenarios 1–3.

- [ ] T015 [P] [US1] `mobile/src/api/catalog.ts`: `getCatalog()` → `GET /api/mobile-service-items` (typed rows: `id, provider, category, subcategory, label, cost_lbp, sell_lbp`); `getRates()` → `GET /api/rates`
- [ ] T016 [P] [US1] `mobile/src/data/queryKeys.ts`: add `catalog(shop)` and `rates(shop)`; extend `mobile/src/data/__tests__/queryKeys.test.ts`
- [ ] T017 [US1] `mobile/src/data/invalidation.ts`: rename the action kind `"transfer"` to `"sale"` (map unchanged); update `mobile/src/app/(app)/sell/[provider].tsx` and `mobile/src/data/__tests__/invalidation.test.ts`
- [ ] T018 [US1] Register `catalog/[provider]` in `mobile/src/app/(app)/sell/_layout.tsx` (title from provider: "Katsh" / "iPick")
- [ ] T019 [US1] `mobile/src/app/(app)/sell/index.tsx`: the Katsh and iPick tiles open `/sell/catalog/[provider]` (remove the "Coming next" alert)
- [ ] T020 [US1] Screen `mobile/src/app/(app)/sell/catalog/[provider].tsx`, catalog part: cached `useQuery(catalog)`; keep rows with `provider` = route param, `sell_lbp > 0` and `cost_lbp > 0`; `SectionList` grouped by category, each row `formatCatalogItemName`-derived label + price (`formatMoneyAmount(sell_lbp, "LBP")`); search box filtering by name; empty-state text when nothing matches or the provider has no items
- [ ] T021 [US1] Same screen, cart part: tap an item → add or +1; per-line − / + / remove; quantities are integers ≥ 1; sticky cart summary (item count, total LBP); the cart lives in the screen's state so it survives a tab switch (LIRA-300)
- [ ] T022 [US1] Same screen, client + payment part: reuse the transfer form's client search / new client and the `Segmented` method picker (On account / Whish wallet / OMT wallet); "On account" without a client → message, no save (FR-005); LBP only in this task
- [ ] T023 [US1] Same screen, Save: build with `buildCatalogSalePayload` (legs `[{ method, currencyCode: "LBP", amount: total }]`), create the client first if new (as the transfer form), `recordServiceSale(body, idemKey)` with one Idempotency-Key per cart (reset when the cart or payment changes, kept across retries); on success `invalidateAfter(shop, { kind: "sale", paidBy, clientId })`, clear the cart, alert "Saved"; on failure keep the cart and show the server's / no-connection message (FR-008, FR-010)
- [ ] T024 [US1] On the simulator (Maestro): quickstart scenarios 1–3 and 6 (double tap / no connection); record results in this file

**Checkpoint**: a Katsh/iPick cart on account from the phone, booked once, visible on Home / Debts / Activity.

---

## Phase 5: User Story 2 — Customer pays into Whish / OMT, LBP or USD (P1)

**Goal**: wallet payments and the USD option (FR-013).

**Independent test**: quickstart scenarios 4–5.

- [ ] T025 [US2] Screen: currency picker LBP / USD; rate from cached `useQuery(rates)` via core `getExchangeRates` WITHOUT fallback; USD disabled with "No exchange rate set — ask the admin to set it in Settings" when no rate (spec edge case)
- [ ] T026 [US2] Screen: USD shows `usdForLbp(total, buyRate)` and the rate used before saving; Save sends legs `[{ method, currencyCode: "USD", amount }]` and `tenderExchangeRate: buyRate`
- [ ] T027 [US2] Wallet payments allow saving without a client (FR-005); a client picked is still sent
- [ ] T028 [US2] Simulator: scenarios 4–5; parity check of one USD sale against the web (quickstart "Parity check")

**Checkpoint**: all payment × currency combinations work from the phone.

---

## Phase 6: User Story 4 — The phone shows the result at once (P2)

- [ ] T029 [US4] Verify (simulator) that after a save Home (provider balance, since-last-count), Activity ("Katsh · client" + items) and Debts (on account) update without a pull; fix any missing invalidation key in `mobile/src/data/invalidation.ts` with a test first

---

## Phase 7: Polish & cross-cutting

- [ ] T030 Gates: `yarn typecheck`, `yarn lint`, `yarn test` (confirm the new core suites, the parity test and mobile tests ran — counts and elapsed time, rule 28), `node scripts/build-release-notes.cjs --check`
- [ ] T031 [P] Docs: LIRA-302 in `current_sprint.md` (status, what was built, what users will notice); `docs/plans/ongoing_plans/MOBILE_APP_PLAN.md` vouchers row; `specs/289-mobile-after-hours-sales/tasks.md` T035 note (vouchers done here). No release-note line (no web/desktop-visible change; the phone app has not shipped)
- [ ] T032 Fresh signed APK (local only, no EAS) and the quickstart manual scenarios on the Android phone
- [ ] T033 Commit on the owner's go; push decision separate

---

## Dependencies & execution order

- T001 → T004 (rounding rule) → T005.
- Foundational T002–T011 before any story. T009 (parity, against old code) strictly before T010 (refactor).
- US3 (T012–T014) needs only T005/T006 — it can run right after the builder exists, in parallel with T009–T011.
- US1 (T015–T024) needs T005/T006 and T017; US2 (T025–T028) extends the US1 screen; US4 (T029) after US1.
- Polish last.

## Parallel examples

- T002, T003 together; then T007, T008 together.
- T012–T014 (core money suite) alongside T009–T011 (web parity + refactor).
- T015, T016 together.

## Implementation strategy

1. **Foundation + money proof** (T001–T014): one builder, web unchanged, every combination proven on the real
   schema. Stop and report.
2. **MVP** (US1): phone cart on account, LBP. Show on the simulator.
3. **US2**: wallets and USD.
4. **US4 + polish**, APK, owner's go to commit.
