# Tasks: Payment form on payout baskets at Session Checkout (LIRA-402)

**Input**: spec.md, plan.md · **Tests**: required (rule 17 failing-first, rule 28d variants).

## Phase 1: Guard tests FIRST

- [x] T001 Component guard `frontend/src/features/sessions/components/__tests__/SessionCheckoutModal.payoutForm.test.tsx`: owner's basket renders a payout-mode payment input; payout lines reach the payload as OUT/PAYOUT/GENERAL legs; no per-currency select for that money. Record failure.
- [x] T002 Core guard + variants `packages/core/src/services/__tests__/lira402.sessionPayoutForm.test.ts` through `sessionCheckoutSchema.parse` + `SessionCheckoutService.checkout`: payout-only, LBP payout, split USD+LBP, + Extra (rounding expense), − Less (KEPT_CHANGE), mixed payout > charge, mixed charge > payout (unchanged), SYSTEM payout present, over-cap refused, void nets 0. Record failure.

## Phase 2: Core

- [x] T003 `utils/sessionCheckoutLegs.ts` leaf builder, exported from `browser.ts` + `index.ts`
- [x] T004 `sessionCheckoutSchema` + `CheckoutRequest` gain `rounding_given_*`
- [x] T005 `resolveBasketPayoutAdjustment` + wiring in `recordBasketPayment`; result `roundingUsd/Lbp`
- [x] T006 `SessionCheckoutService` books the rounding expense; `TransactionRepository` basket void/refund voids linked expenses
- [x] T007 Core build + sync; T002 green; full core suite `--maxWorkers=2`

## Phase 3: Frontend

- [x] T008 `SessionCheckoutModal`: mode, payout box, legs via the builder, Confirm gate, select only for SYSTEM payouts, note copy (en/ar/fr locales)
- [x] T009 T001 green; existing SessionCheckoutModal suites green (update expectations that encoded the old select for General payouts)

## Phase 4: Proof + delivery

- [x] T010 Web e2e `frontend/tests/e2e-web/lira-web-105-session-payout-form.spec.ts` + screenshot `frontend/public/whats-new/1.35.0/session-payout-form.png`
- [x] T011 `docs/release-notes/UNRELEASED.md` line + Highlights card; `node scripts/build-release-notes.cjs --check`
- [x] T012 `current_sprint.md` LIRA-402 entry
- [x] T013 `yarn typecheck`, `yarn lint`

## Failing-first evidence (rule 17, recorded 2026-11-19 on the unfixed code)

- T001 component guard (`SessionCheckoutModal.payoutForm.test.tsx`), 7 failed / 1 passed (the unchanged charge > payout case): `TestingLibraryElementError: Unable to find an element by: [data-testid="mpi-payout"]` (and `mpi-payout-split` / `-extra` / `-less` / `-short` / `-totals`).
- T002 core guard (`lira402.sessionPayoutForm.test.ts`), 8 failed / 7 passed (the plain payout-leg variants already passed — the server accepted payout legs; only Less/Extra and their reversal were missing):
  - − Less: `There is no payment to keep change from. (Session checkout: keeping change needs the payment lines — there is nothing to keep it from)`
  - - Extra: success but no "Change rounding" expense (`Expected - 7 / Received + 1` → `[]`); over-cap, unmatched and account round-ups were accepted (`Expected: false, Received: true`); basket void/refund: `Expected length: 1, Received length: 0`.
- SYSTEM + wallet payout in one basket (written with the builder, before the repository fix): `Expected: -40, Received: -73.33` — General paid $33.33 of the OMT receive because `systemPayoutTotalUsd` counted the Whish App receive (`fs.provider IS NOT NULL`). Pre-existing defect, fixed in `SessionPaymentRepository` (`fs.provider IN ('OMT','WHISH')`).
