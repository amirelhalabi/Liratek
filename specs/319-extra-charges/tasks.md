---
description: "Task list for LIRA-319 Extra charges"
---

# Tasks: Extra charges (LIRA-319)

**Input**: Design documents from `/specs/319-extra-charges/` — [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. Constitution VI / CLAUDE.md rule 17: every money guard is written FIRST, run against the unfixed code, and seen failing before the fix; finished code is never reverted to prove a test. Tests that can only be written after the code are labelled "not proven failing-first". Payload field names in tests come from the schemas (rule 24). Owner allows running only the test files a task touches; ask before full suites.

**Organization**: by user story (spec.md priorities). Paths are repo-relative. "SR" = `packages/core/src/repositories/SalesRepository.ts`, "TR" = `packages/core/src/repositories/TransactionRepository.ts`, "MPI" = `packages/ui/src/components/ui/MultiPaymentInput.tsx`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallel-safe (different files, no dependency on an unfinished task)
- **[Story]**: US1–US5 from spec.md

---

## Phase 1: Setup

- [X] T001 Read `docs/FEATURE_GUIDE.md` §2, §4, §4.1, §5, §9, §10 and the §13 checklist (rule 18) and `docs/POSTING_MAP.md` §4–§5; note in `specs/319-extra-charges/research.md` under R9 any rule the plan missed
- [X] T002 Check `electron-app/create_db.sql` for the v208–v211 migration markers that `packages/core/src/db/migrations/index.ts` has (last = v211 at :14599); add any missing markers so `yarn check:schema-equivalence` passes before v212

---

## Phase 2: Foundational (blocks every story)

**Purpose**: storage, the shared profit fragment, generic refund columns, the payment-box switch.

- [X] T003 Write guard test FIRST `packages/core/src/db/migrations/__tests__/v212.extraCharges.test.ts`: after migrating, `transactions` has `extra_usd REAL NOT NULL DEFAULT 0` and `extra_lbp REAL NOT NULL DEFAULT 0`, existing rows read 0, `down()` removes them; run it and record the failure
- [X] T004 Add migration v212 (`extra_usd`, `extra_lbp` — "REAL NOT NULL DEFAULT 0", `down()` drops them) in `packages/core/src/db/migrations/index.ts` and the same columns + v212 marker in `electron-app/create_db.sql` (rule 10); rerun T003
- [X] T005 Extend `createTransaction` in TR (~:1289-1322) and its input type to accept `extra_usd`/`extra_lbp` (default 0 when omitted, so every existing caller is unchanged)
- [X] T006 [P] Add one named SQL fragment `EXTRA_CHARGE_PROFIT_USD` / `EXTRA_CHARGE_PROFIT_LBP` ("extra counts as profit on rows that count as profit") next to the existing profit fragments in `packages/core/src/repositories/ProfitRepository.ts` (rule 14) — the only definition used by every later query
- [X] T007 [P] Add posting type `EXTRA_CHARGE` (no-money, profit via `extra_*`, like `KEPT_CHANGE` at `packages/core/src/constants/postingRules.ts:1312`) and classify it so the `moduleDebtTypes` and posting-rule guards stay green
- [X] T008 [P] Shared extra fields: a reusable Zod piece `extraChargeFields = { extra_usd: z.number().nonnegative().optional(), extra_lbp: z.number().nonnegative().optional() }` with **no `.default()`** (offline replay, research R4) in `packages/core/src/validators/common.ts`, plus a helper refine "discount and extra not both" with the message "A sale can have a discount or an extra, not both."
- [X] T009 [P] Guard test FIRST `packages/core/src/offline/__tests__/extraChargeReplayShape.test.ts`: an event recorded before LIRA-319 (no `extra_*` keys) stays compatible with each schema in contracts/write-payloads.md (`isCompatible` in `packages/core/src/offline/schemaShape.ts`); it must fail if a `.default()` is added
- [X] T010 [P] `DiscountLine` "− Discount | + Extra" switch in `packages/ui/src/components/ui/DiscountLine.tsx` per `contracts/payment-box.md` (props `mode`, `onModeChange`, `allowExtra`; test ids `discount-mode-discount`, `discount-mode-extra`; label "Extra" in extra mode; cap note "Capped to max (…)" in both modes)
- [X] T011 MPI built-in extra mode in MPI: `onExtraChange`, `maxExtra` (default pre-extra total); in extra mode the line ADDS to `effectiveTotals`, row "After Extra" (test id `after-page-extra`), payment line follows the total, never on a payout; built-in Waive unaffected (depends on T010)
- [X] T012 [P] Frontend jest `frontend/src/shared/components/__tests__/MultiPaymentInput.extraMode.test.tsx` (not proven failing-first — new props): switch flips label; extra 1 on 14 → After Extra 15.00, payment fills 15; cap note above maxExtra; payout shows no switch

**Checkpoint**: column, fragment, schema piece and switch exist; nothing records an extra yet.

---

## Phase 3: User Story 1 — Sell an item for a little more than its price (P1) 🎯 MVP

**Goal**: POS sale with an extra: item price/cost unchanged, extra on the SALE row, money in the payment method's drawer, receipt and Transactions show it.

**Independent Test**: quickstart scenarios 1, 2, 3 (POS), 9 (refusals), 11 (receipt).

### Tests (write first, see fail)

- [X] T013 [P] [US1] Core guard `packages/core/src/repositories/__tests__/SalesRepository.extraCharge.test.ts` using `postingAssert`: cost $5 price $6, `extra_usd: 1`, cash $7 → SALE `amount_usd` 7, `profit_usd` 1, `extra_usd` 1, `General|USD` +7, sale_items price 6 / cost 5; Whish $7 → Whish drawer +7; payload parsed through `saleProcessSchema`
- [X] T014 [P] [US1] Core guard in the same file: refusals — extra + discount; extra on `partnerMode: "FOR"`; extra above the pre-extra total ("The extra can't be more than the sale itself."); extra with `deferPayment` ("Add the extra at the session checkout.") — each `success: false`, `expectPostings(before, after, {})`
- [X] T015 [P] [US1] Core guard: extra 1, pay $6 with a client → 'Sale Debt' +1 (debt residual includes the extra)

### Implementation

- [X] T016 [US1] `saleProcessSchema` in `packages/core/src/validators/sale.ts` (~:75-77) gets `extraChargeFields` + the discount/extra refine + "No extra on a for-partner sale." refine; rule-23 key diff vs `electron-app/preload.ts` `processSale` data type and `electron-app/handlers/salesHandlers.ts:35`
- [X] T017 [US1] `processSale` in SR: refuse extra on `deferPayment` and above `total_amount`; reconcile against `final_amount + extra` (`resolveKeptChange` expected ~:669 and its gate ~:636); debt residual `final_amount + extra − paid` (~:1506-1529); SALE row `amount_usd = final_amount + extra_usd`, `extra_usd/lbp` set, `profit_usd` unchanged (~:1223-1234); metadata gets `extra_usd/lbp` (~:1248). Rerun T013–T015
- [X] T018 [P] [US1] REST `POST /api/sales/process` in `backend/src/api/sales.ts:172` uses the same schema (no change expected — verify) and a backend jest case sending `extra_usd` gets the same result
- [X] T019 (preload.ts + electron.d.ts → `SaleProcessPayload`; ApiAdapter/ElectronApiAdapter/backendApi.ts already used it) [P] [US1] Derived adapter/preload types: `electron-app/preload.ts`, `frontend/src/types/electron.d.ts`, `packages/ui/src/api/types.ts`, `frontend/src/api/backendApi.ts` — payload types from `z.input<typeof saleProcessSchema>` (rule 21), no hand-written fields — UI half done: `packages/ui/src/api/types.ts`, `backendApi.ts`, `ElectronApiAdapter.ts` already type `processSale` as `SaleProcessPayload = z.input<typeof saleProcessSchema>` (no edit needed); CheckoutModal `PaymentData` picks `extra_usd`/`extra_lbp` from it. Preload / `electron.d.ts` half is the electron agent's.
- [X] T020 [US1] POS `frontend/src/features/sales/pages/POS/components/CheckoutModal.tsx`: `mode` state on the `DiscountLine` (`allowExtra` unless for-partner); extra state; `totals` = final + extra, `totalBeforeDiscount` pre-extra; payload `extra_usd` (or `extra_lbp` on an LBP total); switching mode clears the other amount; drafts save/restore the extra; hide the switch when `addsToSessionBasket` (Maintenance in a session) — the POS "Add to Session Cart" path never shows it — **Draft extra (owner 2026-10-14) done server-side + POS resume**: migration v213 `sales.extra_usd`; `processSale` stores it on draft save/autosave (and on completion); `findDrafts` returns it; POS `index.tsx` resume passes `extra: draft.extra_usd` into CheckoutModal draftData and autosave re-sends it (guards: `v213.salesDraftExtra.test.ts`, `SalesRepository.draftExtra.test.ts`)
- [X] T021 [P] [US1] Frontend jest `frontend/src/features/sales/pages/POS/components/__tests__/CheckoutModal.extra.test.tsx`: switch to Extra, 1 on $6 → payload parsed through `saleProcessSchema` has `extra_usd: 1`, `discount: 0`, payment 7; discount and extra never both sent; and a session-basket checkout case: no `discount-mode-extra` button, no `extra_*` in the cart item
- [X] T022 [P] [US1] Receipt "Extra +$X" line after the discount slot: `frontend/src/features/sales/utils/receiptFormatter.ts` (`ReceiptData` :49-59, 58 mm :185-189, 80 mm :333-338, JSON :399-401), `getReceiptData` in CheckoutModal (~:693-725), reprint `frontend/src/features/sales/.../SaleDetailModal.tsx` (:579-597, on-screen row :915-918); jest for the formatter
- [X] T023 [P] [US1] Transactions view: append "extra +$X" in the SALE branch of `cashMovementLine` (`packages/core/src/utils/transactionRowDisplay.ts:155-174`) and a line in `buildLegDetailTr` (`frontend/src/features/audit/pages/TransactionsViewer.tsx:738-800`); jest for `cashMovementLine`

**Checkpoint**: POS sale with an extra works end to end on both apps (quickstart 1–3, 9, 11).

---

## Phase 4: User Story 2 — "Extra charges" on the Profits page (P1)

**Goal**: Profits shows "Extra charges" from `extra_*`; no item category changes.

**Independent Test**: quickstart 1 (Profits part); SC-005.

- [X] T024 [P] [US2] Core guard FIRST `packages/core/src/services/__tests__/ProfitService.extraCharges.test.ts`: two sales with extras $1 and $2 → `getByModule` has `{ module: "EXTRA_CHARGE", label: "Extra charges", profit_usd: 3, cost_usd: 0 }`; SALE row profit unchanged and `sale_kept_change_usd` 0; `getSummary` gross includes +3; LBP extra counted in LBP
- [X] T025 [US2] `ProfitRepository` query `getExtraChargeTotals` (+ detail query modelled on `getKeptChangeDetail` :6426) using `EXTRA_CHARGE_PROFIT_*`, `status = 'ACTIVE'` and REFUND rows, tenant-scoped, parameterised
- [X] T026 [US2] `ProfitService.getByModule` (:1260) adds the EXTRA_CHARGE row (shown like Kept Change :1510-1530); `getSummary` (:782) adds `extra_charges {usd,lbp}` into the gross total (:1050-1110); `moduleDetailRegistry` (~:1700); rerun T024
- [X] T027 [P] [US2] `PROFIT_ONLY_MODULES` in `packages/core/src/constants/profitRowClass.ts:70` and `packages/core/src/constants/profitModuleDetailSupport.ts:26` include EXTRA_CHARGE
- [X] T028 [US2] Other profit sums use the same fragment: `getByDate` (:6627), `getByUser` (:8039), `getByClient` (:8758), `getPaymentMethodRows` (:7418) in ProfitRepository; session profit sums in `packages/core/src/repositories/CustomerSessionRepository.ts` (:415, :480); one core test per function that an extra raises its total by exactly the extra
  - Note (T028): `getPaymentMethodRows` deliberately NOT changed — it reports payment-leg intake, not profit, and the extra is already inside the legs (amount includes it, R2); adding the fragment would count it twice. No test added for it. Session sums: `getSessionsByDateRange` + `getTodaySessions`.
  - Owner decisions 2026-10-14 (built): a refunded extra share is dated on the REFUND's own day; basket EXTRA_CHARGE rows count in By Cashier / By Client as profit only; `saleTotalPaidUsdEquiv` nets the sale's extra so a $6 + $1 sale paid $6 is not fully paid. Guards in `ProfitService.extraCharges.test.ts`, failing-first.
- [X] T029 [P] [US2] Frontend `frontend/src/features/profits/pages/Profits.tsx`: `ModuleRow` type (~:400), Overview card (~:2210-2306) "Extra charges", row classification (~:2880); jest for the row
- [X] T030 [P] [US2] REST `backend/src/api/profits.ts` and IPC profits handler return the new row/field (types derived); backend jest

**Checkpoint**: Profits shows "Extra charges"; item margins unchanged.

---

## Phase 5: User Story 3 — Undo a sale that had an extra (P1)

**Goal**: void, full refund, partial item refund and undo all net the extra to 0 (rule 20).

**Independent Test**: quickstart 4, 5, 6.

- [X] T031 [P] [US3] Core guard FIRST `packages/core/src/repositories/__tests__/TransactionRepository.extraChargeReversal.test.ts`: sale $6 + extra $1 cash → void → drawer −7, extra no longer counted (EXTRA_CHARGE profit 0), item profit 0; full refund → REFUND row `amount_usd` −7, `extra_usd` −1, all ledgers net 0 per currency (`expectPostings`)
- [X] T032 [US3] `_createRefundRow` in TR (:5927-6004) writes `extra_usd/lbp = −original.extra_*`; confirm `_voidTransactionInternal` (:5357-5606) needs nothing (VOIDED leaves profit queries); rerun T031
- [X] T033 [P] [US3] Core guard FIRST `packages/core/src/repositories/__tests__/SalesRepository.itemRefundExtraShare.test.ts`: items $10 + $5, extra $3, refund the $5 item → customer gets 6.00, REFUND `extra_usd` −1.00, Profits "Extra charges" 2.00; undo → 3.00; preview (`getItemRefundPreview` SR:1903) legs = 6.00
- [X] T034 [US3] `_computeSaleItemRefundAmounts` (SR:3000-3032): `extraShare = saleTxn.extra_* × lineShareOfSale` added to `refundAmount`; REFUND row (SR:2210-2225) `extra_usd/lbp = −extraShare`; server computes the share, never the client; rerun T033
- [X] T035 [US3] `undoSaleItemRefund` (SR:2588, row :2787-2808) and the session undo (TR:5048, row ~:5229) write `extra_* = −refund.extra_*`; extend T033 for undo
- [X] T036 [P] [US3] RefundMethodModal (`frontend/src/features/audit/components/RefundMethodModal.tsx`) shows "incl. extra share $X" when the preview carries one; jest — NOT NEEDED (owner 2026-10-14): the total always includes the extra, so a refund returns it with no choice to show; the refund window already pre-fills price + share.

**Checkpoint**: every reversal nets the extra to 0 (SC-003).

---

## Phase 6: User Story 4 — Extra on every page where a customer pays (P2)

**Goal**: Maintenance, Custom Services, Loto, Recharge / MTC-Alfa, financial-service sends (OMT/Whish send, Katsh, crypto send, app transfer) and the session checkout record the extra the same way.

**Independent Test**: quickstart 7, 8.

### Maintenance

- [X] T037 [P] [US4] Core guard FIRST `packages/core/src/repositories/__tests__/MaintenanceRepository.extraCharge.test.ts`: labour $20 + extra $2 cash → MAINTENANCE `amount_usd` 22, `extra_usd` 2, labour profit unchanged, drawer +22; LBP job: extra in LBP; plus an over-limit extra refused with no postings
- [X] T038 [US4] `saveMaintenanceJobSchema` (`packages/core/src/validators/maintenance.ts` ~:87-89) + `extraChargeFields`; `MaintenanceService.saveJob` / `MaintenanceRepository.processPayments` (:601) reconcile and residual include the extra (:763-765, :1020-1052); row :829-840 sets amount + `extra_*`; refuse extra on a session-basket job; `Maintenance/index.tsx` (:672-714) sends `extra_usd`/`extra_lbp` from CheckoutModal's extra; rerun T037 Refuse an extra above the pre-extra total with "The extra can't be more than the sale itself." Apply the discount/extra refine from T008 (server refuses both).
  - Note (T037/T038, 2026-10-14): failing-first — 10 of 11 core cases red on assertions before the fix (amount 20 not 22, refusals `success: true`, kept change refused "payment is more than the total"); the void-nets-0 case passes on unfixed code too (regression guard only). Server rules: the extra is in the job's currency (USD job `extra_usd`, LBP job `extra_lbp`; other currency refused, "A repair's extra is in the job's currency — enter it in that currency."); cap = the checkout's own total in that currency (USD: labour + parts; LBP: LBP labour — USD parts are a separate total), same cap as the payment box; an LBP job's discount is the implicit `price_lbp − final_amount_lbp` (`maintenanceDiscountOf`, shared by schema refine and service); session-basket job refused in `saveJob` before any write. `maintenance.final_amount_*` unchanged. Page: `allowExtraCharge` on CheckoutModal; extra forwarded only outside a session (frontend jest `Maintenance.extraChargePayload.test.tsx`, 3 red → green).

### Custom Services

- [X] T039 [P] [US4] Core guard FIRST in `packages/core/src/repositories/__tests__/CustomServiceRepository.extraCharge.test.ts` (price $9 cost $7 + extra $1 → amount 10, profit 2, extra 1); plus an over-limit extra refused with no postings
- [X] T040 [US4] Custom service create schema (`packages/core/src/validators/customService.ts`), `CustomServiceRepository` (`customerAmountDue` :68 includes extra, row :525-542); page `frontend/src/features/custom-services/pages/CustomServices/index.tsx` turns on MPI extra mode (`onExtraChange`) and sends `extra_*` (not folded into price); rerun T039 Refuse an extra above the pre-extra total with "The extra can't be more than the sale itself." Apply the discount/extra refine from T008 (server refuses both).

### Loto

- [X] T041 [P] [US4] Core guard FIRST `packages/core/src/repositories/__tests__/LotoTicketRepository.extraCharge.test.ts` (sale 100,000 LBP + extra 10,000 LBP → amount 110,000, commission profit unchanged, extra 10,000); plus an over-limit extra refused with no postings — _red recorded 2026-10-14 before the fix: 21 of 23 failed (with the schema test), e.g. "The payment is more than the total … expected 100,000 LBP" and legacy amount_lbp 100000 ≠ 110000; green after T042_
- [X] T042 [US4] `lotoSellSchema` (`packages/core/src/validators/loto.ts:17`, refine :104 extended), `LotoTicketRepository` (expected :338-364, refusals :270-293, row :429-460); page `frontend/src/features/loto/pages/Loto/index.tsx` (:697-699) extra mode outside a session; rerun T041 Refuse an extra above the pre-extra total with "The extra can't be more than the sale itself." Apply the discount/extra refine from T008 (server refuses both). — _done: extra LBP-only (`LOTO_EXTRA_LBP_ONLY_MESSAGE`), service forwards `extra_*`; schema guard `validators/__tests__/lotoSell.extraCharge.schema.test.ts`_

### Recharge / MTC-Alfa

- [X] T043 [P] [US4] Core guard FIRST `packages/core/src/repositories/__tests__/RechargeRepository.extraCharge.test.ts` (price $5 + extra $1 → amount 6, commission profit unchanged, extra 1); plus an over-limit extra refused with no postings
- [X] T044 [US4] `createRechargeSchema` (`packages/core/src/validators/recharge.ts:32-67`), `RechargeRepository.processRecharge` (:919-965 charge, :1248-1255 reconcile, :1590-1625 debt, row :1090-1120); `frontend/src/features/recharge/components/PaymentSheet.tsx` passes `onExtraChange`/`maxExtra` through (typed from MPI props); Recharge page / TelecomForm / CardGridPayView send `extra_*` (sales only, not buy-back); rerun T043 Refuse an extra above the pre-extra total with "The extra can't be more than the sale itself." Apply the discount/extra refine from T008 (server refuses both).

### Financial-service sends (OMT/Whish send, Katsh, crypto send, app transfer)

- [X] T045 [P] [US4] Core guard FIRST `packages/core/src/repositories/__tests__/FinancialServiceRepository.extraCharge.test.ts`: OMT SEND $100 + fee $1 + extra $1 → provider fee unchanged, commission unchanged, `extra_usd` 1, drawer +102; Katsh cart and crypto send likewise; plus an over-limit extra refused with no postings
- [X] T046 [US4] `createFinancialServiceSchema` (`packages/core/src/validators/financial.ts:81`), `FinancialServiceRepository` (cart `checkoutTotal` :3245, crypto :3491, SEND expected :3873-3918, row :2246-2305) include `extra_*`; rerun T045 Refuse an extra above the pre-extra total with "The extra can't be more than the sale itself."
- [X] T047 [US4] Pages send the extra as its own field, never folded: `frontend/src/features/services/pages/Services/index.tsx` (SEND, extra-only line — `showDiscount={false}` today :2412), `frontend/src/features/recharge/components/KatshForm.tsx` (:1683-1730), `FinancialForm.tsx` (:422-484), `CryptoForm.tsx` (SEND, :205-211), `OmtWhishAppTransferForm.tsx` (:255-386); not offered when the item goes into a session basket (the session checkout takes the extra). These pages fold the discount into the price on the client, so the switch enforces discount-or-extra in the UI; the server cannot see the folded discount
- [X] T048 [P] [US4] Frontend jest per page payload (parsed through the schema, rule 24): Custom Services, Loto, Telecom, OMT send, Katsh — `extra_*` sent, price/fee/discount fields unchanged — _Custom Services done: `CustomServices.extraCharge.test.tsx`_; _Loto done: `Loto.extraCharge.test.tsx` (not proven failing-first)_; _Telecom done: `Recharge.telecomExtra.test.tsx` (red first: `extra_lbp` undefined), plus `PaymentSheet.extra.test.tsx` (red first) and `TelecomForm.extraField.test.tsx` (not proven failing-first)_
  - Financial-send part done: `Services.sendExtra.test.tsx` (OMT send), `KatshForm.extraCharge.test.tsx` (Katsh carrier) — not proven failing-first.

### Session basket

- [X] T049 [P] [US4] Core guard FIRST `packages/core/src/services/__tests__/SessionCheckoutService.extraCharge.test.ts`: basket of two items + extra $2 → one EXTRA_CHARGE row (amount 2, profit 0, `extra_usd` 2) linked with a positive amount, basket charge +2, payment +2 in the drawer; basket refund/void nets 0; refunding one item returns its share of the basket extra by its share of the basket charge; plus an over-limit extra refused with no postings. **Red run (2026-10-14, before the fix): 10 failed / 2 passed of 12** (no EXTRA_CHARGE row, no item share, no cap/waive refusal, negative extra accepted); after the fix 12/12.
- [X] T050 [US4] `sessionCheckoutSchema` (`packages/core/src/validators/session.ts:47-66`) and REST `checkoutSchema` (`backend/src/api/sessions.ts:65`) + `extraChargeFields`; `SessionCheckoutService` writes the EXTRA_CHARGE row and links it (pattern :789-797, :850-884); basket reversal (TR basket void/refund) and item refund share (`refundSessionBasketItem` TR:4684, `_reverseRemainingSaleLines` TR:2403-2460); rerun T049 Refuse an extra above the pre-extra total with "The extra can't be more than the sale itself."
- [X] T051 [US4] `frontend/src/features/sessions/components/SessionCheckoutModal.tsx`: switch on the payment box (`showDiscount={false}` today :1346 — turn on extra mode only), send `extra_*`; session receipt "Extra" line (`frontend/src/features/sessions/utils/sessionReceipt.ts:157-179`)
- [X] T052 [P] [US4] Service receipt "Extra" branch in `frontend/src/shared/utils/serviceReceipt.ts` (:141-142, :228-231) for Maintenance / Custom / Recharge / financial reprints; jest

**Checkpoint**: every page in FR-011 records and reports the extra (SC-004).

---

## Phase 7: User Story 5 — Extra on a sale charged to the client's account (P3)

**Goal**: a sale on account includes the extra in the client's debt.

**Independent Test**: quickstart 3 (account part).

- [X] T053 [P] [US5] (Maintenance part done: `MaintenanceRepository.extraCharge.test.ts` "$6 labour + $1 extra fully on CUSTOMER_ACCOUNT", red before the fix — debt +6 / amount 6) Core guards per module FIRST: $6 + extra $1 fully on CUSTOMER_ACCOUNT → client debt +7 (POS 'Sale Debt', Maintenance, Custom Services, Loto, Recharge, financial send); void → debt back to 0 — in each module's `*.extraCharge.test.ts` — _Custom Services done: `CustomServiceRepository.extraCharge.test.ts` T053 block_; _Loto done: `LotoTicketRepository.extraCharge.test.ts` T053 block (LBP: 110,000 on account → Loto Debt +110,000; void → 0)_; _Recharge done: `RechargeRepository.extraCharge.test.ts` US5 block (300,000 + 20,000 on account, legs and no-legs → Recharge Debt +320,000; void → every ledger 0), red before the fix_
  - Financial-send part done (failing-first): OMT SEND single + leg CUSTOMER_ACCOUNT and a Katsh catalog sale on account → debt includes the extra, void nets 0 — in `FinancialServiceRepository.extraCharge.test.ts`.
- [X] T054 [US5] Fix any module whose account debt uses the pre-extra total (`bookClientDebtCharge` in `packages/core/src/repositories/moneyPosting.ts:544` callers); rerun T053

---

## Phase 8: Polish & cross-cutting

- [X] T055 [P] Rule-23 three-way key diff for all 7 channels (schema / preload type / handler-forwarded fields) recorded in `specs/319-extra-charges/research.md`; fix any key the handler drops
- [X] T055a [P] (Maintenance part done: `backend/src/__tests__/maintenance.extraCharge.api.test.ts`, 7 tests — not proven failing-first at the route level) Backend jest per REST route (rule 19 web parity) — `POST /api/maintenance/jobs`, `/api/custom-services/`, `/api/loto/sell`, `/api/recharge/process`, `/api/services/transactions`, `/api/sessions/checkout` (sessions part done: `backend/src/__tests__/sessions.extraCharge.api.test.ts`, 5/5): a payload with `extra_usd` records it on the row; discount + extra and an over-limit extra return HTTP 200 `{ success: false }`; same core schema as the IPC handler. Files: `backend/src/__tests__/<module>.extraCharge.api.test.ts` — _Custom Services done: `backend/src/__tests__/customServices.extraCharge.api.test.ts`_; _Loto done: `backend/src/__tests__/loto.extraCharge.api.test.ts` (not proven failing-first)_; _Recharge done: `backend/src/__tests__/recharge.extraCharge.api.test.ts`, 7 tests (not proven failing-first)_
  - Financial-send part done: `backend/src/__tests__/services.extraCharge.api.test.ts` (forwards `extra_usd`; RECEIVE / for-partner / deferred refused by the schema; over-limit repository refusal → HTTP 200 `{ success: false }`) — not proven failing-first.
- [X] T056 [P] Web e2e `frontend/tests/e2e-web/lira-web-058-extra-charges.spec.ts`: POS sale with an extra (quickstart 1), void (4), item refund share (6) — match rows by identity, assert drawer/ledger deltas (rule 15); a second spec `frontend/tests/e2e-web/lira-web-059-extra-charges-modules.spec.ts`: Maintenance checkout with an extra and a session basket with an extra, matched by identity, deltas asserted
- [X] T057 [P] Docs: `docs/FEATURE_GUIDE.md` §2, §9 (pro-rata extra, reversal owners), §10 ("Extra charges"), §13 checklist; `docs/POSTING_MAP.md` §4.1, §4.3–4.6, §5 (EXTRA_CHARGE)
- [X] T058 [P] Release note in `docs/release-notes/UNRELEASED.md` (rule 30): shop-owner wording — "+ Extra" on the payment box's Discount line, "Extra charges" in Profits, receipt line; and the ticket's "What users will notice" in `current_sprint.md`
- [X] T059 Rebuild + sync core (`cd packages/core && npm run build && cp -r dist/. ../../node_modules/@liratek/core/dist/`); `yarn typecheck`, `yarn lint`, `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`, `node scripts/build-release-notes.cjs --check` — confirm each actually ran (rule 28)
- [X] T060 With owner approval: full core, backend, frontend jest and the web e2e suite; record counts and elapsed time; run quickstart.md scenarios on the test tenant

---

## Dependencies & execution order

- **Phase 1 → Phase 2** (blocks everything).
- **US1 (Phase 3)** needs T003–T011. **US2** needs T004–T006 and benefits from US1's SALE rows for its test data (its guard can seed rows directly). **US3** needs US1 (a sale with an extra to reverse).
- **US4** needs Phase 2; each module block (Maintenance, Custom Services, Loto, Recharge, financial sends, session) is independent of the others. Maintenance UI reuses US1's CheckoutModal extra (T020).
- **US5** after the modules it checks.
- **Polish** last.

### Parallel opportunities

- Phase 2: T006, T007, T008, T009, T010 in parallel; T011 after T010.
- US1: T013–T015 together; T018, T019, T021, T022, T023 in parallel after T016–T017.
- US4: the six module blocks in parallel (different repositories, schemas and pages); within a block the guard comes first.

### Example — US4 in parallel

```text
Agent A: T037–T038 (Maintenance)        Agent D: T043–T044 (Recharge)
Agent B: T039–T040 (Custom Services)    Agent E: T045–T047 (financial sends)
Agent C: T041–T042 (Loto)               Agent F: T049–T051 (session basket)
```

## Implementation strategy

1. **MVP** = Phase 1 + 2 + US1 + US2 + US3 on the POS: the owner's $5 / $6 / $7 example works, shows in Profits, and reverses cleanly — on both apps.
2. Then US4 page by page (each is shippable alone), then US5, then polish.
3. Each phase ends with typecheck + the phase's own tests; a release-note line lands with the first user-visible phase.
