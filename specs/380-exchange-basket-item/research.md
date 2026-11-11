# Research — LIRA-380

## R1. Is the exchange's payout netted against the basket charge?

- **Decision**: No. It is posted as its own gross PAYOUT leg (`kind: "PAYOUT"`,
  `payoutOrigin: "GENERAL"`, exactly `amountOut`, in its own currency), whatever
  method the cashier picks for the payout.
- **Rationale**: `netCashPayoutAgainstCharge` nets a General CASH payout against
  the charge *across currencies* through `allocatePayments`, at the checkout's
  editable rate. For story 1 ($20 charger + $100 → 8,950,000 LBP) that would
  seed "$20 to collect" and never debit the LBP drawer — the exchange cancels
  itself and the session rate decides what the customer gets, which the owner
  ruled out ("The rate of the session should not affect the rate of the
  exchange transaction"). Gross legs give exactly the spec's figures:
  +$120 USD / −8,950,000 LBP. The server needs nothing new: `basketCollectNet`
  adds PAYOUT legs back.
- **Alternatives**: same-currency-only netting (more code, no visible gain;
  the drawer delta is identical either way); the existing cross-currency
  netting (rejected above). Deviation from FR-003 / scenario 1.3's "netted by
  the existing rule" wording — recorded in spec.md "Decisions taken unattended".

## R2. Currencies other than USD/LBP

- **Decision**: An exchange side in a currency other than USD/LBP is not basket
  money. At checkout the exchange posts that side itself (the existing
  single-lump CASH leg to General); its USD/LBP side(s) go through the basket.
  Nothing moves before checkout in either case, and lots are consumed at
  checkout.
- **Rationale**: every basket bucket (`customer_session_transactions.amount_usd/
  amount_lbp`, `CartItem.currency`, the checkout modal's currency list) is
  USD/LBP only. Pooling EUR would need new columns and a new modal currency —
  far beyond this ticket. Option (b), refusing exotic pairs in a session,
  would leave the cashier unable to change euros while a basket is open.
- **Alternatives**: refuse (b); keep today's book-and-link for exotic pairs
  (contradicts the owner's report).

## R3. Deferred mode in `ExchangeRepository.createTransaction`

- **Decision**: `deferPayment?: boolean` and `paid_in_session?: number` on
  `CreateExchangeData` only (never in a schema). In deferred mode the writer
  refuses, before any write: `payments`, `customerPayments`,
  `customer_waived_amount`, kept change, round-up, added change, the tender
  rate, the account rates and `partnerMode`. It skips the customer-side and
  payout-side legs for USD/LBP sides, stamps `buildPaymentSnapshot({ sessionId })`
  and `details.paid_in_session`. Lot effects and profit stamping run as usual.
- **Rationale**: mirrors `RechargeRepository`/`FinancialServiceRepository`
  (rule 16: the basket's shared loop owns the legs). Refusing the walk-in-only
  fields stops a hand-built cart line from posting its own money.

## R4. Profit on the session link

- **Decision**: the exchange case returns `bookedProfitUsd` on `ProcessedItem`;
  the checkout uses it (USD) for the link's `profit_usd` and the checkout's
  profit total, instead of `formData.totalProfitUsd` bucketed by the line
  currency.
- **Rationale**: the generic path would stamp an LBP→USD line's USD margin into
  `profit_lbp` and a lot-tracked line's pre-lot estimate.

## R5. Which rate books the exchange

- **Decision**: its own (`leg1Rate`/`leg2Rate` from the line). The checkout's
  `exchange_rate`/`exchangeRate` injection is not applied to the exchange case
  (the line is re-validated through `exchangeSubmitSchema`, which has neither key).

## R6. Session mode on the Exchange page

- **Decision**: In session mode (not For partner — already hidden in a session),
  Confirm skips the PaymentSheet and adds the line. That hides Discount,
  on-account, keep-change, round-up and added change by construction (all live
  in the sheet). The loss confirmation still runs first.
- **Payload**: one builder `buildExchangePayload(input, mode)`; the session mode
  drops every payment-side field (rule 22).

## R7. Whole-basket void/refund

- **Decision**: no change expected — `refundSessionBasket` runs the generic
  per-member EXCHANGE reversal (`_assertExchangeLotsVoidable`, lot restore,
  mirror legs; a deferred exchange has no own USD/LBP legs, the pooled legs are
  reversed once by `_reverseSessionPooledPayments`). Proven by a core test.
  `TransactionRepository.ts` is owned by LIRA-381 tonight: if the test shows a
  gap, the needed change is reported, not applied.
