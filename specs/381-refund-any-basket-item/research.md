# Research: Refund any item of a customer-session basket

## R1 — Which rows are "items"

- **Decision**: one pure predicate `isSessionItemRefundableMember(row)` in `constants/sessionPayoutMember.ts` (leaf, exported from `browser.ts`): ACTIVE, not a reversal (`reverses_id` null, not REFUND), and not a basket-level sibling (KEPT_CHANGE, WAIVED_SHORTFALL, EXTRA_CHARGE, BASKET_DISCOUNT).
- **Rationale**: removing the whitelist outright would make basket siblings refundable on their own, which no owner decision covers; the frontend must read the rule from core (rule 14).
- **Alternatives**: keep a type whitelist and add types (drifts; needs a release per new module).

## R2 — Amount and direction source

- **Decision**: non-SALE members use the `customer_session_transactions` signed amount (customer side) for both magnitude and sign; positive → `to_customer`, negative → `from_customer`. SALE keeps the per-line amounts.
- **Rationale**: a FINANCIAL_SERVICE RECEIVE's `transactions` row is positive (0/0 for Binance); a SEND's customer figure is amount + fee; a For-Partner item is 0 to the walk-in. Only the cst row carries what the customer paid / was paid.

## R3 — Netted-payout baskets (to_customer cap)

- **Decision**: when the basket holds a netted payout (`_isNettedSessionPayoutMember`), the item's pool-side remainder goes back in its own currency, capped per currency at Σ positive member charges − Σ earlier item refunds' (account + pool) attribution − this refund's account attribution. Without a netted payout the existing pool-mix split is unchanged.
- **Rationale**: the pool was reduced by the payout, so the pool mix no longer says what the customer paid in (story 1: an LBP ticket would come back as ~$3 USD). Owner open question 2 recommended the gross cap.

## R4 — Whole-basket reversal after item refunds (rule 20)

- **Decision**: one per-currency residual, used by `_reverseSessionPooledPayments` and `isSessionBasketFullyRefundedBatch`: `residual_c = poolSum_c − Σ poolSplit_c (to_customer) + Σ collected_c (from_customer)`. The pooled reversal keeps its per-leg proportional reduction and posts any leftover residual as one extra pooled CASH leg (same reversal note).
- **Rationale**: with a netted payout the pool has no positive leg in the payout's currency, and a from_customer refund puts money back that the pool never saw; without the residual the drawer ends 300,000 LBP off in story 1. Identical to today when no payout/from_customer refund exists.

## R5 — Posting a from_customer refund

- **Decision**: reuse `refundLegs` (same shape) as the customer's lines; measure + write with `measureCustomerLegs`/`writeCustomerLegs` (IN payment rows on the REFUND row, account lines as debt). Account lines book `Session Refund Debt` (added to `MODULE_DEBT_TRANSACTION_TYPES`, so repayments cover it and aging sees it). Default (no lines) = cash in the payout's own currencies. Kept / added change refused on this path.
- **Rationale**: one existing writer for "customer pays" lines (rule 14), IN legs only (rule 16), no new input key (rule 23).
- **Alternatives**: a `direction` input key (refused — the server must derive it; an accepted-but-trusted key is a rule-23 hazard).

## R6 — Members paid on their own

- **Decision**: a member whose own `payments` carry customer-facing (overridable) legs — a page-linked exchange or financial service — is refunded by mirroring its own legs only (no account-first, no pool money-back, no method override). Preview reports `paidOnItsOwn: true`; the UI then skips the method window, like a standalone exchange refund. A SWAP-type member never takes `refundLegs`.
- **Rationale**: its money never entered the pool; running both would refund it twice.

## R7 — Up-front guards

- **Decision**: the planner runs `_assertSupplierSiblingsVoidable`, `_assertSupplierBundledDiscountVoidable`, `_assertExchangeLotsVoidable`, `_assertLotoTicketVoidable`, `_assertLotoCashPrizeVoidable` (read-only), so the preview refuses too (story 1.4, 2.5).

## R8 — Undo

- **Decision**: unchanged — admin undo still supports SALE members only and refuses others with its named reason. Listed as a morning question.

## FEATURE_GUIDE §13 walk (summary)

| Item                      | Outcome                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Transaction row           | REFUND row per member, `reverses_id` = member, linked into the session (`session_item_refund`), amounts = exact negation of the member |
| IN/OUT                    | to_customer → OUT legs (existing loop); from_customer → IN legs via the customer-pays writer                                           |
| Payment legs              | member's own legs mirrored; pooled money via the refund's own legs; whole-basket residual                                              |
| Client propagation        | account lines use the member's client, else the basket's debt client, else the session client                                          |
| CUSTOMER_ACCOUNT          | to_customer: account first (unchanged); from_customer: `Session Refund Debt` charge                                                    |
| Supplier / partner ledger | existing per-type owners (`_cascadeSupplierSiblingVoid`, loto TOP_UP / CASH_PRIZE soft-void)                                           |
| Void path                 | REFUND rows are final (non-reversible); undo unchanged (SALE only)                                                                     |
| Profit                    | REFUND row negates the member's profit stamp (unchanged mechanics)                                                                     |
| Session branch            | this is the session branch                                                                                                             |
