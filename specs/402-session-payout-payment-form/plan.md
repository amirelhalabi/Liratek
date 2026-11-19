# Implementation Plan: Payment form on payout baskets at Session Checkout (LIRA-402)

**Spec**: spec.md · **Branch**: main

## Summary

Session Checkout gets a payout-mode payment box (the same `MultiPaymentInput` the standalone payout screens use) whenever the basket's cash-basis net is a General-drawer payout. Its lines become `OUT/PAYOUT/GENERAL` legs; the "− Less | + Extra" line books kept change / a "Change rounding" expense exactly as the other payout screens.

## Technical context

- Frontend: `frontend/src/features/sessions/components/SessionCheckoutModal.tsx` (shared by desktop and web, no transport branch).
- Core (browser-safe leaf): `packages/core/src/utils/sessionCheckoutLegs.ts` — the ONE leg builder (rule 22), exported from `browser.ts` and `index.ts`.
- Core (server): `validators/session.ts` (+`roundingGivenFields`), `services/SessionCheckoutService.ts` (book rounding), `services/SessionPaymentService.ts` (`resolveBasketPayoutAdjustment`, verify before writes), `repositories/TransactionRepository.ts` (basket void/refund → `voidLinkedExpenses`).
- Transports: IPC handler and REST route already forward the whole parsed checkout object; preload / ApiAdapter types are `SessionCheckoutPayload` (schema-derived), so the new keys flow through with no hand edits (rule 21/23 diff below).

## Rule 23 three-way key diff (session checkout)

| Key                    | schema                        | preload/adapter type | service reads                                                                     |
| ---------------------- | ----------------------------- | -------------------- | --------------------------------------------------------------------------------- |
| rounding_given_usd/lbp | added (`roundingGivenFields`) | derived from schema  | `CheckoutRequest` → `resolveBasketPayoutAdjustment` → `bookPayoutRoundingExpense` |
| kept_change_usd/lbp    | existing                      | derived              | existing; payout baskets now verified by the payout branch                        |

## Design

1. **Mode** (modal): `cashBasis = netCashPayoutAgainstCharge(general charge, general payout as CASH)`. `payoutMode = no charge to collect on the cash basis (incl. SYSTEM charge) && (cashBasis excess + exchange payout) > 0`. Charge mode keeps today's code path exactly (overrides, selects, netting).
2. **Payout box**: totals = form payout per currency; `totalAmountCurrency` = LBP for an LBP-only payout else USD; `payer="payout"`; wires `onKeptChange`, `onRoundUpChange` only; methods = today's payout choices; initial method CASH. Own state (`payoutLines`, `payoutKept`, `payoutRoundUp`), cleared on open and on mode change.
3. **Legs**: `buildSessionCheckoutLegs({ mode, … })`. Payout mode: payout lines → `OUT/PAYOUT/GENERAL`; SYSTEM payouts → gross `SYSTEM` legs with their per-currency select. Charge mode: today's legs, byte-identical.
4. **Server**: `resolveBasketPayoutAdjustment` in `SessionPaymentService.recordBasketPayment`, before the first write, when kept or rounding is claimed AND the basket has no IN/change legs: all non-SYSTEM payout legs drawer-affecting, claim in one currency within `isWithinShortfallMax`, `net(USD-eq)` = −kept or +rounding within tolerance. The customer-payer kept path is unchanged for baskets with IN legs. Rounding without a payout basket → refused (`ROUNDING_GIVEN_NOT_ALLOWED_MESSAGE`).
5. **Booking**: Less → existing KEPT_CHANGE row; Extra → `bookPayoutRoundingExpense` (parent `customer_sessions` / id). Reversal: `voidSessionBasket`/`refundSessionBasket` → `voidLinkedExpenses("customer_sessions", id)`.

## Constitution check

Rules 14/22 (one builder, one cap helper), 16 (no IN legs in the payout branch), 17 (guards first), 19 (shared component), 20 (reversal owner named), 21/23/24 (schema-derived keys, assertions via schema), 26 (expense is auto via its link), 27 (expense day = checkout time / client day), 29 (builder is a leaf), 30 (release note + card).

## Risks

- Deployed backend (test tenant page on 5176) predates the core change: "− Less" refused, "+ Extra" silently unbooked until deploy.
- Desktop e2e `lira-098` (Binance session cash-out) asserted the payout select for a General payout; it now sees the payout box. Updated by reading; not run on this Mac (owner rule).
