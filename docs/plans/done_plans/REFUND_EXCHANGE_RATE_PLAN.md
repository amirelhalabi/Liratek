# Refund form — editable exchange rate and free currency mix (plan)

**Status:** DONE 2026-09-27 (verified: full suites, desktop and web e2e; not yet committed; adds migration v186). Ticket: **LIRA-236**.
**Source:** owner answer to the LIRA-232 rate question (2026-09-27): "when refunding we should open a popup that has a
multipayment form where we can set exchange rate, and all payment methods etc".
**Builds on:** LIRA-078 (`RefundMethodModal`), LIRA-231 (POS refunds use the form), LIRA-232 (session item refund).

## 1. What changes for the cashier

Every refund already opens the refund popup (`RefundMethodModal`, built on the shared `MultiPaymentInput`). It is
pre-filled, and methods and drawers can be changed. Two things change:

1. **The exchange rate is shown and can be edited** in the popup.
2. **Currencies can be mixed freely.** Example: a $50 item paid in USD can be refunded as 4,450,000 LBP, or $20 plus the
   rest in LBP.
   - Today each currency's total must equal what was paid in that currency.
   - After this change, the TOTAL VALUE at the popup's rate must equal the refund amount.

## 2. Owner decisions (2026-09-27)

1. **Scope: all refunds.** This covers:
   - POS "Refund Sale" and "Refund item";
   - the Transactions page "Refund";
   - session-basket item refunds.

   They all use one shared form.
2. **One rate per refund.** The rate typed in the popup drives both:
   - the account reduction (the "account first" part of a session refund, when the debt and the item are in
     different currencies);
   - the cash handed back.

   This replaces the "day's buy rate" answer (LIRA-232 Q3) and settles LIRA-232 §9b item 12.
3. **Default rate = the rate the sale was paid at.** An untouched refund therefore returns exactly what the customer
   paid, and returning everything clears the account exactly.
   - A sale's rate is its stored rate, `sales.exchange_rate_snapshot`.
   - A basket member's rate is its own recorded rate.
   - The day's buy rate is used only when nothing was recorded, and the popup says so.

## 3. Contract

- **Every refund payload** gains an optional `exchangeRate` (LBP per 1 USD, > 0). It applies to:
  - the POS whole-sale refund;
  - the POS item refund;
  - the Transactions page refund with a leg override;
  - the session item refund.

  When the cashier's legs are sent, the server checks that the value of the legs at that rate equals the refund value
  at that rate. The tolerance is one shared constant in `constants/refundTolerance.ts`. Without legs, today's default
  behaviour is unchanged.
- **Every refund preview** returns `bookedRate` (the default for the popup) and `bookedRateSource`
  (`"sale" | "transaction" | "fallback"`).
  - The session item preview also accepts an optional `exchangeRate`, so the account reduction and the remainder are
    shown at the typed rate.
- **Each REFUND row** records the rate it used in `metadata_json` (`exchangeRate`), for audit.
- **Session baskets:**
  - `_crossCurrencyRateForBasket` uses the typed rate, else the booked rate.
  - A whole-basket reversal after item refunds subtracts what item refunds handed back by VALUE, not per currency. A
    refund paid in a different currency must not be refunded twice.

## 4. Known limitation (not in scope)

If the cashier refunds at a different rate from the one the sale was paid at, the drawer's value differs slightly from
the refunded amount. That exchange difference is not booked as profit or loss. The drawers stay physically right, and
closing counts them as they are.

## 5. Phases

1. Core + transports: validator, all refund repositories, previews, session conversions, whole-basket value
   subtraction, schemas, IPC/REST, adapter types.
2. UI: `RefundMethodModal` rate field and value-based matching; re-preview on rate change (session); all callers pass
   the booked rate.
3. Tests (failing first), review, full checks, e2e.
