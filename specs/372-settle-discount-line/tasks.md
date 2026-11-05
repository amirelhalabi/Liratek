# Tasks: One Discount line on every settle screen (LIRA-372)

**Input**: `specs/372-settle-discount-line/`: plan.md, spec.md, research.md (R1–R12), data-model.md, contracts/settle-discount.md, quickstart.md

**Tests**: REQUIRED.
- Rule 17: every guard is written first and seen failing on the unfixed code. Never revert finished code to prove a test. A test written after its fix says "not proven failing-first".
- Rule 28d: a variant table.
- Rule 24: field names come from the schemas.
- Run only explicit test paths, never full suites.

**Format**: `- [ ] Tnnn [P?] [Story?] description (file)`

---

**Owner answer 2026-11-05 (option B, replaces the spec's "typed payment kept" assumption)**: whenever the discount changes, payment = owed − discount in that currency, typed by hand or not. Screens put the discount into MPI `fillKey` (with `fillTotals` net of it); a split box lowers its LAST line (per currency in a `perCurrencyTotals` box). `settleDiscountOverpaid` still blocks Confirm when the cashier edits the payment AFTER the discount.

## Phase 1: Setup

- [X] T000 **Merge-order gate (research R15)** — OWNER OVERRIDE 2026-11-05: 371 and 372 built in parallel in one tree; not waited for: LIRA-371 (settle drawer choice) MUST be committed on `main` before any LIRA-372 source edit. Check with `git log --oneline -20 | grep LIRA-371` (read-only). If it is missing, stop and tell the owner.
  - Files both tickets change: `packages/core/src/validators/{debt,supplier}.ts`, `packages/core/src/repositories/{SupplierRepository,DebtRepository}.ts`, `electron-app/preload.ts`, `frontend/src/types/electron.d.ts`, `frontend/src/features/debts/pages/Debts/index.tsx`, `frontend/src/features/suppliers/components/AccountSettleSheet.tsx` (`buildSettlePayload` gains `cash_drawer` from 371), `frontend/src/features/suppliers/pages/Suppliers/index.tsx` (`handleBatchSettle` / `handleCashflow`), and `docs/release-notes/UNRELEASED.md`.
  - Add 372's keys inside the payload builders as 371 left them. Never write a second literal (rule 22).
- [X] T001 Confirm that no LIRA-366 note-edit path reaches a settlement DISCOUNT row (data-model rule 31). Re-read `docs/FEATURE_GUIDE.md` §13 and `docs/COUNTERPARTY_LEDGERS.md` (supplier/partner/debt DISCOUNT rows and their reversal owners). Re-check every line number cited in `specs/372-settle-discount-line/research.md` and in this file against `main` after LIRA-371 and after `414ce0da` (LIRA-373 changed `TransactionRepository.ts`). Fix any that drifted.
- [X] T002 [P] Baseline pin, which must pass now and keep passing. Add `packages/core/src/repositories/__tests__/lira372.discountBaseline.test.ts`. Under $5 it books today's discounts and asserts ledger, profit and void net 0:
  - Supplier Pay discount $2 (received, FIFO coverage applied and given back)
  - batch Settle waive $2
  - Settle Account PAY waive $2 and COLLECT waive $2
  - Partner by-amount forgive $3 (partner owes)
  - Partner by-day forgive $3 (PARTNER payer)
  - Debt repayment discount $3

## Phase 2: Foundational (blocks every story)

- [X] T003 [P] Failing-first tests for the shared cap schema in `packages/core/src/validators/__tests__/counterparty.settleDiscount.test.ts`:
  - `settleDiscountInputSchema`: $5.00 accepted, $5.01 refused with "The discount is more than $5."; 450,000 LBP accepted, 450,001 refused; both zero refused; negative refused.
  - `settleForgiveAmountSchema("USD"|"LBP")`: the same bounds.
- [X] T004 Implement both schemas in `packages/core/src/validators/counterparty.ts` by moving `settlementDiscountSchema` out of `packages/core/src/validators/supplier.ts:99`. Reword the messages from "waived amount" to "discount". Import from `./exchange.js` only (rule 29). `supplierSettleSchema.discount` and the legacy `supplierSettleAccountSchema.discount` import it from there. T003 passes.
- [X] T005 [P] Failing-first tests for the pure helper in `packages/core/src/utils/__tests__/settleDiscount.test.ts`. `owed` is what is owed **before** the payment (research R2):
  - `settleDiscountRoom("USD", 2.5)` = 2.5
  - `settleDiscountRoom("USD", 100)` = 5
  - `settleDiscountRoom("LBP", 300000)` = 300000
  - `settleDiscountRoom("LBP", 900000)` = 450000
  - negative owed → 0
  - `clampSettleDiscount("USD", 6, 100)` → `{applied:5, capped:true, room:5}`
  - cents and whole-LBP rounding
  - `settleDiscountOverpaid("USD", 412.5, 410, 2.5)` = false; `("USD", 412.5, 412.5, 2.5)` = true; `("USD", 412.5, 410.004, 2.5)` = false (half-cent tolerance); `("LBP", 900000, 450000, 450000)` = false; `("LBP", 900000, 450001, 450000)` = true
- [X] T006 Implement `packages/core/src/utils/settleDiscount.ts` (`settleDiscountRoom`, `clampSettleDiscount`, `settleDiscountOverpaid`; imports only `validators/exchange.js`). Export it from `packages/core/src/browser.ts` and `packages/core/src/index.ts`. Run `packages/core/src/__tests__/browserEntryIsNodeFree.guard.test.ts`. T005 passes.
- [X] T007 Wire the shared schemas into the remaining keys:
  - `addRepaymentSchema.discount` (`packages/core/src/validators/debt.ts:52`)
  - `partnerSettleSchema.discount` (`packages/core/src/validators/partner.ts:134`)
  - `partnerSettleDaysSectionSchema.forgive.amount` (`partner.ts` ~258; refine with the section's `currency` in the parent `superRefine`)
  - `settleAccountCurrencySectionSchema.waive` (`supplier.ts` ~229; per-currency check in `settleAccountPerCurrencySchema.superRefine`)

  Add schema tests first, failing on today's code, to `packages/core/src/validators/__tests__/counterparty.settleDiscount.test.ts`: each of the 4 keys refuses $5.01 / 450,001 LBP. Confirm `debtWriteOffSchema` / `partnerWriteOffSchema` still accept $50 (FR-009).
- [X] T008 [P] `SettleDiscountLine` in `packages/ui/src/components/ui/SettleDiscountLine.tsx` (props per contracts/settle-discount.md), exported from `packages/ui/src/components/ui/index.ts`. Add i18n `discountLine.settleLabel` = "Discount" and the cap note in `packages/ui/src/i18n/locales/{en,ar,fr}/ui.json`. Component test, written first, in `frontend/src/shared/components/__tests__/SettleDiscountLine.test.tsx`: one field per currency, the cap note at 6 → "Capped to max ($5.00)", the reason field, and the label "Discount".

**Checkpoint**: one cap, one helper, one line component.

---

## Phase 3: US1 — Shop pays a supplier a little less (P1)

**Goal**: the Discount line on Settle Account (PAY), batch Settle and Pay, with the cap, booked as discount received.

**Independent test**: supplier owes-to $412.50 on picked days → Settle Account, Discount 2.50, pay $410 cash → drawer −410, balance 0, days settled, profit +2.50.

- [X] T009 [P] [US1] Failing-first sheet test in `frontend/src/features/suppliers/components/__tests__/AccountSettleSheet.lira372.test.tsx`:
  - The line (`settle-discount-line`) shows in the main box and in each side box.
  - Typing 2.50 with $412.50 owed drops the pre-filled pay line to $410.00 (FR-010, R4); in a two-currency main box (USD 412.50 + LBP 900,000) only the USD line moves; in a side box the line moves too.
  - **Owner 2026-11-05 (option B)**: a pay line typed by hand ($412.50) is LOWERED to $410.00 when 2.50 is typed afterwards, and Confirm works.
  - The payload's `per_currency.USD.waive === 2.5` and `discount_reason` is sent, with the key names taken from `supplierSettleAccountSchema` (rule 24).
  - Typing 6 shows the cap note and sends 5.
  - Waive (`waive-remaining`) is absent.
- [X] T010 [US1] Preview = server: add `waive` to `SectionMoney` and pass it in `allocateSection` (`frontend/src/features/suppliers/utils/accountSettleMath.ts` ~217). Test first in `frontend/src/features/suppliers/utils/__tests__/accountSettleMath.lira372.test.ts`: the allocator closes 412.50 with paid 410 + waive 2.50 and leaves `remaining_after` 0.
- [X] T035 [US1] (do before T011) MPI per-currency follow for split boxes, in `packages/ui/src/components/ui/MultiPaymentInput.tsx`. When `perCurrencyTotals` is on and `fillTotals` changes, re-fill each currency's last line. **Owner 2026-11-05 (option B)**: driven by `fillKey` (the page puts its discount into it), the line is re-filled even when the cashier typed it; only currencies whose `fillTotals` changed are touched. No other caller passes `perCurrencyTotals` together with changing `fillTotals`; re-check with grep.

  Test first, failing on today's code, in `frontend/src/shared/components/__tests__/MultiPaymentInput.lira372PerCurrencyFollow.test.tsx`:
  - seeded USD 412.50 + LBP 900,000; `fillTotals` changes to USD 410.00 → the USD line reads 410.00 and the LBP line stays
  - a USD line typed by hand to 412.50 is lowered to 410.00 when the discount (fillKey) changes; a hand-typed LBP line stays

  Also run the existing `frontend/src/shared/components/__tests__/MultiPaymentInput.lira308OwnerAnswers.test.tsx` and `MultiPaymentInput.test.tsx`.
- [X] T011 [US1] Implement the line in `frontend/src/features/suppliers/components/AccountSettleSheet.tsx`:
  - per-currency discount state
  - `SettleDiscountLine` through `discountRow` on both MPI boxes (~1527, ~1610), with `totalBeforeDiscount`; the room comes from `settleDiscountRoom(c, owed − credit)`
  - **payment follows the discount (FR-010, research R4)**:
    - `mainTotals` (~699) becomes net of each currency's discount: SMS − discount in SMS mode, owed − discount otherwise. It feeds `totals` and `initialLines`.
    - the side box's `totals` and `fillTotals` (~1628/1637) become net too
    - for a two-currency main box, pass `fillTotals = mainTotals`, which relies on T035
  - `waive` added per currency in `handleSubmit` (~893) inside the existing `buildSettlePayload` path (rule 22, no second literal)
  - `waiveDisabled` kept

  Before Confirm, disable it with the server's sentences when:
  - the discount comes with an extra in the same currency
  - the discount would stop inside a partial row (from the allocator's `partial` / `takes`)
  - discounts are typed in two sections with opposite directions

  T009 passes.
- [X] T012 [US1] Rule-23 three-way diff, then add `discount_reason` (optional, ≤ 500, `per_currency` only) to `packages/core/src/validators/supplier.ts`, `electron-app/preload.ts` (`SettleAccountRequest`) and `frontend/src/types/electron.d.ts`. In `SupplierRepository` amount-first (~7749), pass `reason: data.discount_reason` to `postSupplierBundledDiscount`. Pass `discount: {amount_usd: waive.usd, amount_lbp: waive.lbp, reason}` to the `ACCOUNT_SETTLE` `buildSupplierEntryDetails` call (~7493) (FR-008). Repository test first in `packages/core/src/repositories/__tests__/SupplierRepository.lira372SettleAccountDiscount.test.ts`:
  - the reason lands on the DISCOUNT ledger note and on the COUNTERPARTY_DISCOUNT details
  - the settlement details carry the single-currency discount
  - per_currency waive $5.01 is refused by the schema
- [X] T013 [US1] Batch Settle line in `frontend/src/features/suppliers/pages/Suppliers/index.tsx` (`CounterpartySettleModal` net-pay branch ~4226):
  - `SettleDiscountLine` via `discountRow`, USD/LBP per `settleNetPayCurrency`
  - room = `settleDiscountRoom(c, settleNetPay)`; Confirm is off when the discount equals the whole net pay (the server's `assertSettlementWaive` says "pay at least part of it"), and off while `settleDiscountOverpaid` is true
  - the net-pay MPI (~4220) keeps `discountMovesPayment` at its default (true) and gets `totals` = `settleNetPayAmount − discount`, with `totalBeforeDiscount` = `settleNetPayAmount`
  - the payload adds `discount` in the single `settleTransactions.mutateAsync` call (~2154)
  - no line on the bills-only branch (R7)

  Test first in `frontend/src/features/suppliers/pages/Suppliers/__tests__/Suppliers.lira372.test.tsx`: the line shows on a net-pay batch, is hidden on bills-only, typing 2.50 on a $412.50 net pay fills the pay line to $410.00, and the payload carries `discount` (names from `supplierSettleSchema`). Rewrite `Suppliers.lira310BatchWaive.test.tsx` to assert Waive stays absent and the line is present (rule 24).
- [X] T014 [US1] Supplier Pay via `discountRow` in `frontend/src/features/suppliers/pages/Suppliers/index.tsx` (~3120–3191):
  - replace the built-in `showDiscount`/`maxDiscount` with `SettleDiscountLine`, room = `settleDiscountRoom(payCurrency, cashflowOwed)`
  - pass `totals` = `cashflowOwed − discount` and `totalBeforeDiscount` = `cashflowOwed`, so the untouched line keeps following the discount once the built-in discount is gone (research R4)
  - move the separate reason input into the line
  - `handleCashflow` (~2140) keeps one payload

  Extend `Suppliers.lira372.test.tsx` first: the same line test ids; a typed 6 is capped at 5; owed $412.50 + discount 2.50 → pay line $410.00; and the payload `discount.amount_usd === 5`. The auto-fill case pins today's MPI built-in behaviour (the Pay tab already follows the discount), so label it a pin. The line test ids and the cap are the failing-first parts.

**Checkpoint**: US1's independent test passes in jsdom and in core.

---

## Phase 4: US2 — Shop receives a little less (P1)

**Goal**: the same line when money comes in, on Debts, Partners (both) and Supplier Receive, booked as a discount given.

**Independent test**: partner owes $500 → settle, Discount 5, receive 495 → drawer +495, balance 0, profit −5.

- [X] T015 [P] [US2] Failing-first core test in `packages/core/src/repositories/__tests__/SupplierRepository.lira372ReceiveDiscount.test.ts`. The supplier owes the shop $500 (balance −500); `recordSupplierCashflow` RECEIVE $495 + discount $5:
  - ledger: one +495 payment row + one DISCOUNT +5 (balance 0)
  - drawer +495
  - COUNTERPARTY_DISCOUNT profit −5, summary "Supplier discount given"
  - `supplier_purchases` untouched
  - **void**: balance −500, drawer 0 net, profit 0 net, `supplier_purchases.paid_usd` unchanged. This fails today in two ways: (a) refused, and after the fix (b) the void gives back coverage that was never applied.
  - room check: RECEIVE $495 + discount $6 on −500 refused by the schema; RECEIVE $498 + discount $5 on −500 refused ("more than is owed"); PAY $410 + discount $5 on +412.50 refused
- [X] T016 [US2] Implement in `packages/core/src/validators/supplier.ts`: drop the PAY-only refine on `supplierCashflowSchema` (~212) and use `settleDiscountInputSchema`.
- [X] T017 [US2] Implement in `packages/core/src/repositories/SupplierRepository.ts` `recordSupplierCashflow`:
  - drop the PAY-only guard (~8795)
  - room check inside the db transaction, per currency: discount ≤ |owed in this direction| − net cash, from `getSupplierBalance`
  - RECEIVE → `postSupplierBundledDiscount(direction:"forgiven", applyPurchaseCoverage:false)`
  - PAY unchanged
- [X] T018 [US2] Reversal gate (rule 20) in `packages/core/src/repositories/TransactionRepository.ts` `_reverseSupplierBundledDiscount` (~7823): skip `_giveBackSupplierPurchaseCoverage` when the discount row is forgiven (`amount_usd + amount_lbp > 0`). T015 passes; T002 stays green.
- [X] T019 [US2] Supplier Receive UI in `frontend/src/features/suppliers/pages/Suppliers/index.tsx`: show the T014 line on RECEIVE too, with room = what the supplier owes the shop; the payload sends `discount` for both directions. Extend `Suppliers.lira372.test.tsx` first: RECEIVE shows the line; the supplier owes $500, discount 5 → receive line fills to $495.00; and the payload carries the discount.
- [X] T020 [P] [US2] Failing-first core test in `packages/core/src/repositories/__tests__/DebtRepository.lira372Cap.test.ts`, via `DebtService.addRepayment`: discount $5.01 → `{success:false}`, $5 accepted and booked as 'Debt Discount' + COUNTERPARTY_DISCOUNT (profit −5), void nets 0. The $5.01 refusal is proven failing-first at schema level in T007 (it runs earlier). This test pins the service envelope, the booking and the void, so label it a pin, not a failing-first guard.
- [X] T021 [US2] Debts UI in `frontend/src/features/debts/pages/Debts/index.tsx` (~3099–3200) and `frontend/src/features/debts/utils/repaymentReduction.ts`:
  - replace the hand-rolled line with `SettleDiscountLine` (USD + LBP, reason)
  - cap = `min(due, SHORTFALL_MAX)` via `settleDiscountRoom` inside `applyDebtDiscount`
  - remove `onWaiveRemaining`, set `waiveDisabled`
  - **payment follows the discount (FR-010, R4)**:
    - remove `discountMovesPayment: false` (~3109)
    - make `repayFillTotals` (~888) net of the applied discount (`repayTickedUsd − repayCreditUseUsd − repayAppliedDiscountUsd`, and the same for LBP, floored at 0). `fillTotals` wins over the flag in MPI's `prefillAmountFor`, so flipping the flag alone leaves the picker line at the gross ticked sum.
  - keep `waiveTotals` for the "Remaining on ticked" row
  - keep `repayForgiveBlocked` / `repayForgiveHint` for a payment edited AFTER the discount, reworded to "Discount". Owner option B: the discount goes into `fillKey`, so typing it re-fills even a hand-typed line
  - `afterDiscountLabel` → the default "After Discount"

  The calendar picker shares this modal; no second change.

  Test first in `frontend/src/features/debts/pages/Debts/__tests__/Debts.lira372Discount.test.tsx`:
  - label "Discount"
  - typed 20 on a $100 due → capped at 5 with the note
  - LBP 500,000 → 450,000
  - Waive absent in picker and calendar mode
  - **auto-fill, failing first** (today the line stays gross):
    - picker, $412.50 ticked, discount 2.50 → pay line $410.00
    - no picker, $500 due, discount 5 → $495.00
    - LBP 900,000 due, discount 450,000 → 450,000 LBP
    - a line typed by hand ($412.50) is lowered to $410.00 when 2.50 is typed (owner option B)
  - payload `discount` names from `addRepaymentSchema`

  Rewrite (rule 24, not delete), all under `frontend/src/features/debts/pages/Debts/__tests__/`:
  - into absent-Waive guards: `Debts.lira310Waive.test.tsx`, `Debts.lira310WaiveTicked.test.tsx`
  - `Debts.lira318Forgive.test.tsx`: the header and the "never moves the payment" cases become "an untouched line drops by the discount" plus "a typed line is lowered too (owner option B)"
  - any assertion over $5 in `Debts.lira308TicksAmount.test.tsx` / `repayment.payloadLanguage.test.tsx`
  - `frontend/src/features/debts/utils/__tests__/repaymentReduction.test.ts`, where it asserts an uncapped discount
- [X] T022 [P] [US2] Failing-first core test in `packages/core/src/repositories/__tests__/PartnerSettlement.lira372ShopPaysForgive.test.ts`. The shop owes the partner $500 on picked days; `settle-days` with payer SHOP, pay $497, forgive $3:
  - DISCOUNT row DEBIT → "received", profit +3
  - balance 0, days settled
  - void nets 0
  - forgive $5.01 refused by the schema

  Also by amount: partner owes $500, pays $495 + discount $5 → profit −5, balance 0, void nets 0; discount $6 refused.

  Likely, based on research R9: the SHOP-payer booking already works server-side (DEBIT → received), and the cap refusals are proven failing-first in T007. Label this a pin unless it fails on today's code; if it fails, record the failure as the guard.
- [X] T023 [US2] Partners by day in `frontend/src/features/partners/components/PartnerSettleSheet.tsx` (~315–340, ~842–1005):
  - compute forgive and room for both payers (drop `partnerPays &&`), room = `settleDiscountRoom(c, m.due)`, measured **before** the payment (R2)
  - `SettleDiscountLine` instead of the hand-built `DiscountLine`
  - `waiveDisabled` always; remove `onWaiveRemaining`
  - remove `discountMovesPayment={false}` (~963). `totals` is already `due − forgive`, so the untouched line follows it (FR-010). Block Confirm while `settleDiscountOverpaid(c, m.due, paid, forgive)` is true.
  - the payload still goes through `partnerSettleDaysPayload.ts` (one builder)

  Test first in `frontend/src/features/partners/components/__tests__/PartnerSettleSheet.lira372.test.tsx`:
  - the line shows for SHOP payer
  - the cap at 5
  - Waive absent
  - **failing first**: partner owes $500 on picked days, discount 5 → pay line $495.00; SHOP payer, owes $500, discount 3 → $497.00
  - a typed line is lowered by the discount too (owner option B)

  Rewrite (rule 24) the forgive/Waive assertions in `frontend/src/features/partners/components/__tests__/PartnerSettleSheet.test.tsx` and the by-day case ("by day: paid 80 + forgive 20 … payment st[ays]") in `frontend/src/features/partners/pages/Partners/__tests__/Partners.lira318ForgiveLine.test.tsx`.
- [X] T024 [US2] Partners by amount in `frontend/src/features/partners/pages/Partners/index.tsx` (~459–786):
  - `SettleDiscountLine`, room = `settleDiscountRoom(currency, balanceInCurrency)`, measured before the payment (R2). This replaces today's "balance − settled".
  - `waiveDisabled: true`; remove `onWaiveRemaining`
  - remove `discountMovesPayment: false` (~736); `totals` is already `nettedBalance`, so the untouched line follows it. Block Confirm while `settleDiscountOverpaid` is true.
  - make `frontend/src/features/partners/utils/settlementDiscount.ts` wrap the core helper (rule 14), and update `frontend/src/features/partners/utils/__tests__/settlementDiscount.test.ts` to the new room meaning

  Test first in `frontend/src/features/partners/pages/Partners/__tests__/Partners.lira372.test.tsx`:
  - **failing first**: partner owes $500, discount 5 → pay line $495.00; shop owes $500, discount 5 → $495.00
  - typed 6 → capped at 5
  - a typed $500 is lowered to $495 when 5 is typed (owner option B)
  - Waive absent

  Rewrite as guards (rule 24), all under `frontend/src/features/partners/pages/Partners/__tests__/`: `Partners.lira310Waive.test.tsx`, `Partners.lira318ForgiveLine.test.tsx` ("payment stays 80", "payment does not move", "payment stays 90" become "untouched line drops / typed line lowered too"), and `partners.payloadLanguage.test.tsx`.

**Checkpoint**: US2's independent test passes in jsdom and in core.

---

## Phase 5: US3 — OMT account settlement with a discount (P2)

**Goal**: the OMT sheet takes a discount in both directions; the commission is unchanged.

**Independent test**: expected 772.30 (gross 776.50, commission 4.20), SMS 772.30, Discount 2.30, pay 770 → commission 4.20, OMT balance 0, profit 4.20 + 2.30.

- [X] T025 [P] [US3] Core pin in `packages/core/src/repositories/__tests__/SupplierRepository.lira372SettleAccountDiscount.test.ts`. Reuse the LIRA-370 fixture from `SupplierRepository.lira370Baseline.test.ts`:
  - SMS 772.30 + waive 2.30 + pay 770 → commission 4.20 (FR-006), DISCOUNT received 2.30, balance 0
  - collect side: −229.70 expected, SMS −229.70, waive 1.70, receive 228 → commission 6.20, DISCOUNT forgiven 1.70
  - void each → net 0, including the owed-shares state

  Likely, based on research R6: this passes on today's server (the waive never touches `deriveSmsCommission`). Label it a pin, not a failing-first guard.
- [X] T026 [US3] Sheet summary in `frontend/src/features/suppliers/components/AccountSettleSheet.tsx`: when the SMS mode and a discount are both present, show "SMS amount", "Commission" and "Discount" as three separate summary lines; the commission line does not change while a discount is typed. Test first in `AccountSettleSheet.lira372.test.tsx`: typing 2.30 leaves the commission text at 4.20 and the pay line moves to 770.00.

---

## Phase 6: US4 — Void or refund reverses the discount (P1)

**Goal**: create + void/refund nets to 0 on every ledger, per currency, for every screen and direction.

- [X] T027 [US4] Variant table (rule 28d) in `packages/core/src/__tests__/lira372.settleDiscountVariants.test.ts`. One row per screen × direction:

  | # | Screen | Shop pays | Shop receives |
  |---|---|---|---|
  | 1 | Debts Repay, picker scope | — (no pay side) | yes |
  | 2 | Debts Repay, calendar scope (same builder, day-picked items) | — | yes |
  | 3 | Supplier Pay / Receive | yes | yes (new booking) |
  | 4 | Supplier batch Settle | yes | no line; a hand-built bills-only payload with a discount is refused |
  | 5 | Supplier Settle Account incl. OMT SMS | yes | yes |
  | 6 | Partner settle by day | yes (SHOP payer) | yes (PARTNER payer) |
  | 7 | Partner settle by amount | yes | yes |
  | 5x | Settle Account, sections going opposite ways | a discount on one currency is accepted; on both it is refused (FR-011) | |

  Pattern: `packages/core/src/repositories/__tests__/SupplierRepository.lira370Variants.test.ts`, reusing `testHelpers/omtAccountDb` and `omtTestShop`. Core jest cannot import `frontend/src` (the `@/` alias, React), so each row builds its payload from the core schema's input type and `parse`s it. Each screen's jsdom test (T009, T013, T014, T019, T021, T023, T024) asserts that its real builder emits that same shape, with keys from the schema (rule 24). Label the file "not proven failing-first" for the rows whose code lands before it.

  For each row:
  - build the payload in the schema-derived shape the screen's builder emits
  - parse it through the real core schema, run the real service
  - assert accepted, the amounts match, and profit sign is received + / given −
  - auto-fill: the payload's paid amount = owed − discount (FR-010), built through the same screen helper the UI uses
  - then void **and** refund separately, and assert every drawer, ledger and profit nets 0 per currency. Refunds follow LIRA-373 (research R14): `SUPPLIER_SETTLEMENT` / `PARTNER_SETTLEMENT` rows refund with **no** `refundLegs` override (an override must be refused). `DEBT_REPAYMENT` and `SUPPLIER_PAYMENT` refund with their default legs.
  - the $5.01 / 450,001 LBP variants are refused on every row
- [X] T028 [US4] FR-008 check in the same file: each booked discount and its reason are readable from the counterparty's Payments history read, i.e. the ledger reads the Suppliers/Partners/Debts history panels use (the DISCOUNT row with its note), and from the transaction details.

---

## Phase 7: Polish & cross-cutting

- [X] T029 [P] Web e2e `frontend/tests/e2e-web/lira-web-093-settle-discount.spec.ts` (first check that `ls frontend/tests/e2e-web` shows 093 free; LIRA-371 may take 092). Steps:
  - (1) Supplier Settle Account PAY with Discount 2.50 → assert drawer and balance deltas by identity (rule 15)
  - (2) Partner by amount, partner owes $500: type Discount 5 → the pay line reads 495.00 by itself → Confirm
  - (3) Debts repay with Discount 5: the pay line drops by 5 by itself; typing 6 shows the cap
  - (4) void (1) → deltas back to 0
  - (5) no `waive-remaining` on any of the screens
  - (6) SC-004 on the web transport: POST a hand-built repayment with `discount.amount_usd: 6` (keys from `addRepaymentSchema`) through the test's authenticated request context → `{success:false}`, error "The discount is more than $5.", HTTP 200. Desktop takes the same refusal from the shared schema through `validatePayload` (T007).

  Save the What's new screenshot from step (1) to `frontend/public/whats-new/1.35.0/settle-discount.png` (landscape). Confirm the reported test count is greater than 0. Web e2e only: no desktop/Electron e2e on this Mac.
- [X] T030 [P] Rewrite `frontend/tests/e2e-web/lira-web-057-waive.spec.ts`'s Debts/Partners Waive steps into "Waive not shown on settle screens" checks (Loto and POS Waive steps unchanged). Re-read `frontend/tests/e2e-web/lira-web-071-shop-day.spec.ts` for any forgive over $5 or any Waive click on Debts/Partners, and adjust.
- [X] T031 [P] Reword the `discountMovesPayment` doc comment in `packages/ui/src/components/ui/MultiPaymentInput.tsx` (~318–323): no settle page passes `false` any more (LIRA-372 reversed LIRA-318 for Debts and Partners). Keep the prop. i18n: "Forgive (no cash)" / "Forgive" labels on the settle screens → the shared "Discount" in `packages/ui/src/i18n/locales/{en,ar,fr}/debts.json` and `partners.json` (keep the Write off wording); remove now-unused keys.
- [X] T032 Release note (rule 30) in `docs/release-notes/UNRELEASED.md`:
  - a `### Discount on every settle screen` card in `## ✨ Highlights` with the T029 screenshot
  - bullets under Debts, Suppliers / OMT and Partners: "Settle screens show one Discount line, up to $5 or 450,000 LBP; the Waive button is gone from Debts and Partners settle; bigger amounts go through Write off (admin)"
  - "Suppliers: you can now take a discount when a supplier pays you"
  - Debts and Partners: "Typing a discount now lowers the amount to pay by itself (owed $500, discount $5 → pay $495)"

  Then run `node scripts/build-release-notes.cjs --check`.
- [X] T033 Add LIRA-372 to `current_sprint.md` with a "What users will notice:" line.
- [X] T034 Core build and sync (`cd packages/core && npm run build && cp -r packages/core/dist/. node_modules/@liratek/core/dist/`). Then run `yarn typecheck`, `yarn lint`, `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`, `yarn check:transport-parity`, `yarn build` and `node scripts/build-release-notes.cjs --check` (constitution Quality Gates). The full core, backend, electron-handler and frontend suites run in CI, not locally (owner: explicit paths only). Run only the explicit test paths in `specs/372-settle-discount-line/quickstart.md`, plus the touched existing suites:
  - `packages/core/src/repositories/__tests__/SupplierRepository.discount.test.ts`
  - `packages/core/src/repositories/__tests__/SupplierPayment.bundledDiscountVoid.test.ts`
  - `packages/core/src/repositories/__tests__/DebtRepository.discount.test.ts`
  - `packages/core/src/validators/__tests__/partner.settleLegs.test.ts`
  - `packages/core/src/validators/__tests__/debt.repaymentFieldNames.test.ts`
  - `packages/core/src/repositories/__tests__/SupplierRepository.lira370{Baseline,Sms,Variants,OwedShares}.test.ts`
  - `packages/core/src/validators/__tests__/supplierSettleAccount.lira370.test.ts`
  - `packages/core/src/utils/__tests__/accountSettleAllocation.lira370.test.ts`
  - `packages/core/src/repositories/__tests__/TransactionRepository.lira373SettlementRefund.test.ts`
  - `frontend/src/features/suppliers/components/__tests__/AccountSettleSheet.lira370Sms.test.tsx`
  - every rewritten test named in T013, T021, T023 and T024
  - the LIRA-371 suites that touch the same files

  Re-grep `requireRole` on the six write channels in `electron-app/handlers/{debt,supplier,partner}Handlers.ts` and `backend/src/api/{debts,suppliers,partners}.ts`. They should be unchanged (research R13).

  Confirm the elapsed time and test counts (rule 28a).

---

## Dependencies

- T000 (LIRA-371 committed first) blocks every source edit; T001 re-reads line references after it.
- Phase 2 (T003–T008) blocks every story.
- US1, US2 and US3 are independent after Phase 2. US3 reuses T011's sheet line (do it after T011).
- US4 (T027–T028) needs US1 + US2 + US3.
- Polish comes last; T029's screenshot needs T011.
- Inside a story: test task → implementation task.
- T035 (MPI per-currency follow) comes before T011 and T026.

## Parallel examples

- Phase 2: T003, T005 and T008 together (different files).
- US1 ∥ US2: T009/T010 (suppliers frontend) ∥ T015 (supplier core) ∥ T020 (debts core) ∥ T022 (partner core).
- Polish: T029, T030 and T031 together.

## Implementation strategy

MVP = Phase 2 + US1 (supplier PAY on all three supplier screens), which is the owner's daily rounding. Then US2 (receive side + Waive removal), US3 (OMT pin + summary), then the US4 variant table before any release note.

**Task count**: 36. Setup 3 · Foundational 6 · US1 7 (T035 sits before T011) · US2 10 · US3 2 · US4 2 · Polish 6.
