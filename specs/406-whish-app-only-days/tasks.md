# Tasks: Whish App "Only Days" for MTC / Alfa prepaid cards (LIRA-406)

**Input**: design documents in `specs/406-whish-app-only-days/` (plan, research, data-model, contracts, quickstart)

**Tests**: required here. Project rule 17: each guard test is written first and seen failing on the unchanged code, before the fix. Rule 28(d): a variant table walks every sale mode.

**Format**: `- [ ] [ID] [P?] [Story] Description with file path`

## Phase 1: Setup

- [ ] T001 Confirm Node ABI for core jest (`node -e "const D=require('better-sqlite3'); new D(':memory:')"`), and record the baseline: run `frontend/src/features/recharge/components/__tests__/KatshForm.*.test.tsx` and `packages/core/src/repositories/__tests__/FinancialServiceRepository.telecomOnlyDays.test.ts`, note pass counts in this file's Notes

## Phase 2: Foundational (blocks every story)

**Server gate**

- [ ] T002 In `packages/core/src/repositories/__tests__/FinancialServiceRepository.telecomOnlyDays.test.ts`, change the provider of "a non-telecom-reseller provider (e.g. OMT_APP cost/price) never books a credit-return leg" from `WHISH_APP` to `OMT_APP`, so it still guards the non-reseller case
- [ ] T003 Same file: add failing-first tests: (a) a `WHISH_APP` LBP sale with `itemCategory: "alfa"` + `returnedCreditsUsd: 7` credits the Alfa USD drawer +7 and the primary Alfa line +7, and the stamped profit includes `7 × telecom_credit_cost_rate_lbp`; (b) `WHISH_APP` + `mobileServiceItemId` of a split-complete mtc item credits the computed default to MTC; (c) a `WHISH_APP` USD sale carrying `returnedCreditsUsd` books NO credit-return leg; (d) two `WHISH_APP` units where the second is `deferPayment: true` (first carries the legs) both credit; (e) void of each nets Whish App LBP, carrier USD and line credits to 0. Run and record the real failures
- [ ] T004 In `packages/core/src/repositories/FinancialServiceRepository.ts` (`isTelecomResellerApp`, ~line 2370): allow `WHISH_APP` when `currency === "LBP"`; Katsh / iPick unchanged; update the comment. Run T003 green and the whole telecomOnlyDays file green

**Shared Only Days pricing (pure move from KatshForm)**

- [ ] T005 Create `frontend/src/features/recharge/utils/onlyDaysPricing.ts`: move from `KatshForm.tsx` `CatalogPricingRow`, `OnlyDaysPricingResult`, `resolveOnlyDaysPricing`, `calcPrice`, `lineUnitPriceOf`, `TELECOM_CREDIT_SELL_PRICE_SETTING_KEY`; add `onlyDaysDefaultReturnedCredits(item, catalogPricing)` (the toggle default: split complete → `resolveMaxReturnedCredits(credits, max_returned_credits_usd)`, else `maxReturnableCredits(parseFloat(label))`, else 0) and `isTelecomVoucher(item)`. Types take a structural line (`item`, `onlyDays`, `returnedCreditsUsd`, overrides) so both cart line types fit
- [ ] T006 Create `frontend/src/features/recharge/hooks/useOnlyDaysPricingData.ts`: loads `getActiveMobileServiceItems` + `getAllSettings` once, returns `{ catalogPricing, catalogPricingRef, tenantCreditSellPriceLbp }`; `api` read through a ref, never in deps (rule 25)
- [ ] T007 Create `frontend/src/features/recharge/components/OnlyDaysPanel.tsx`: move the Only Days block of KatshForm's `ItemCard` (checkbox, Credits input, days price, credit price, warnings, kept credits, total); props `item`, `brand`, `onlyDays`, `returnedCreditsUsd`, `pricing`, and the four change callbacks; keep the existing `data-testid`s (`katsh-onlydays-credits`) and i18n keys
- [ ] T008 Refactor `frontend/src/features/recharge/components/KatshForm.tsx` to use T005–T007 (no behaviour change); move `handleOnlyDaysChange`'s default to `onlyDaysDefaultReturnedCredits`. Run all `KatshForm.*` suites: same pass count as T001, unchanged tests
- [ ] T009 In `frontend/src/features/recharge/utils/basketCheckout.ts`, extract `onlyDaysUnitFields(line)` → `{ mobileServiceItemId?, returnedCreditsUsd? }` (B2 rule: id only when split complete and id present; returned credit only when edited or split incomplete); `catalogBatchSubItems` uses it; KatshForm's `telecomCreditReturnsLines` uses it too. Existing basketCheckout + KatshForm tests stay green

**Checkpoint**: server accepts Whish App Only Days; Katsh unchanged; shared pieces ready.

## Phase 3: User Story 1 — walk-in Whish App Only Days (P1) 🎯 MVP

**Goal**: sell a Whish App MTC / Alfa card Only Days to a walk-in customer.
**Independent test**: one Alfa 7.58 sale, cash; Whish LBP −765,007, Alfa USD +7, line +7; refund nets 0.

- [ ] T010 [US1] Add `onlyDays`, `returnedCreditsUsd`, `returnedCreditsEdited`, `sellDaysLbpOverride?`, `creditPriceLbpOverride?` to `WhishCartLine` in `frontend/src/features/recharge/types/basket.ts` (optional on read: an old basket entry without them is not Only Days); update where FinancialForm creates lines
- [ ] T011 [P] [US1] Failing-first frontend test `frontend/src/features/recharge/components/__tests__/FinancialForm.onlyDays.test.tsx`: Whish App LBP, eligible Alfa card → Only Days checkbox shown; ineligible card (no days) and USD mode → not shown; ticking it sets the price to the Only Days price and the returned credit to the default; walk-in submit sends per unit `amount` = Only Days price, `cost` = gross, `itemCategory`, `mobileServiceItemId` (default) or `returnedCreditsUsd` (edited), note ends ` [Only Days]`; non-Only-Days unit sends neither field. Assert keys by parsing through `createFinancialServiceSchema.strict()` (rule 24); stable `useApi` mock (rule 25)
- [ ] T012 [US1] Pass `alfaCreditSellRate` to FinancialForm from `frontend/src/features/recharge/pages/Recharge/index.tsx` (same value KatshForm gets); add the prop to `FinancialFormProps`
- [ ] T013 [US1] In `frontend/src/features/recharge/components/FinancialForm.tsx`: use `useOnlyDaysPricingData`; add toggle / credits / price-override handlers (same as Katsh, via `onlyDaysDefaultReturnedCredits`); render `OnlyDaysPanel` in a `Collapsible` under the card when `!isUsd && qty > 0 && isExpanded && isTelecomVoucher(item)`
- [ ] T014 [US1] Same file: ONE `lineUnitPrice(line)` (wrapping `lineUnitPriceOf`) used by BOTH `pricedLines` and the walk-in submit loop (rule 14); totals, discount spread and sheet items read it
- [ ] T015 [US1] Same file, walk-in loop: add `itemCategory` and `onlyDaysUnitFields(line)` per unit and the ` [Only Days]` note suffix. Run T011 green

## Phase 4: User Story 2 — session basket and cross-provider basket (P1)

**Goal**: Whish App Only Days through a customer session and the one-payment basket.
**Independent test**: session checkout / Whish+Katsh basket credit each carrier; whole-basket refund nets 0.

- [ ] T016 [P] [US2] Failing-first test in `frontend/src/features/recharge/utils/__tests__/basketCheckout.test.ts`: `whishBatchSubItems` for an Only Days line carries the Only Days unit price, `itemCategory`, `onlyDaysUnitFields`, note suffix; `buildBasketCheckoutPayload` with Whish + Katsh Only Days lines keeps those keys through `rechargeBasketCheckoutSchema.strict()` and each sub-item through `createFinancialServiceSchema`
- [ ] T017 [US2] `whishBatchSubItems` in `frontend/src/features/recharge/utils/basketCheckout.ts`: take the unit price from the caller (the shared `lineUnitPrice`) and add `onlyDaysUnitFields` + note suffix; update its callers in FinancialForm. Run T016 green
- [ ] T018 [P] [US2] Core test `packages/core/src/services/__tests__/SessionCheckout*` or the basket checkout service test (whichever already books `_batch` Whish units on the real schema): a Whish App Only Days sub-item credits the carrier drawer + line, and the basket refund nets every ledger to 0 per currency

## Phase 5: User Story 3 — For Partner (P2)

**Goal**: Whish App Only Days on a partner order.
**Independent test**: partner order with one Whish Alfa Only Days card; void nets 0.

- [ ] T019 [P] [US3] Failing-first test in `frontend/src/features/recharge/utils/__tests__/basketCheckout.test.ts`: `buildPartnerOrderPayload` WHISH_APP branch forwards `mobileServiceItemId` / `returnedCreditsUsd` from each sub-item (strict schema parse)
- [ ] T020 [US3] Forward those two fields in the WHISH_APP branch of `buildPartnerOrderPayload` (`frontend/src/features/recharge/utils/basketCheckout.ts`). Run T019 green
- [ ] T021 [P] [US3] Core test in `packages/core/src/services/__tests__/RechargePartnerOrderService.test.ts`: a WHISH_APP LBP Only Days partner sale credits the carrier drawer + line, partner owes the Only Days price, void nets 0

## Phase 6: Polish & cross-cutting

- [ ] T022 Variant test (rule 28d) in `frontend/src/features/recharge/utils/__tests__/onlyDaysVariants.test.ts`: one table over walk-in unit / session sub-item / basket sub-item / partner sale × Alfa / MTC × default / edited credits: each builds the payload as the screen does and asserts the same per-unit Only Days fields
- [ ] T023 Web e2e `frontend/tests/e2e-web/lira-web-1xx-whish-only-days.spec.ts`: sell a Whish App Alfa card Only Days walk-in; assert deltas (Whish App LBP, Alfa USD, line credits) by identity (rule 15); refund; save landscape screenshot `frontend/public/whats-new/<next version>/whish-only-days.png`
- [ ] T024 Release note line under `## 📱 MTC / Alfa` and a `### ` Highlights card with the screenshot in `docs/release-notes/UNRELEASED.md`; run `node scripts/build-release-notes.cjs --check`; add LIRA-406 to `current_sprint.md` with "What users will notice"
- [ ] T025 Gates: `yarn typecheck`, `yarn lint`, `yarn check:transport-parity`, affected frontend suites, full core suite `--maxWorkers=2`

## Dependencies

- T002–T004 (server) and T005–T009 (shared frontend) are independent of each other.
- US1 needs T004–T009. US2 needs US1's T010/T014 (cart fields, unit price). US3 needs T010 and T017 (sub-items carry the fields).
- Polish after all stories.

## Parallel opportunities

- T002–T004 ∥ T005–T007.
- T011, T016, T019 (tests, different files) can be written together once T010 lands.
- Core tests T018 and T021 ∥ frontend work.

## Implementation strategy

MVP = Phase 2 + US1 (walk-in). Then US2 (session/basket), US3 (partner), polish. One commit at the end, after the owner's go.

## Notes

- Never revert finished code to prove a test (rule 17); tests that pass before their fix are labelled "not failing-first".
