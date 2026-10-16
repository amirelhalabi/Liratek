# Research: LIRA-326

## R1 — Reuse the session checkout, or build a new multi-sale checkout?
- **Decision**: Reuse it. A paid mixed basket becomes a customer session created and checked out in one call.
- **Rationale**: `SessionCheckoutService.checkout` already does everything the spec asks for:
  - replays per-module `_batch` entries in deferred mode, one sale per provider, each costed against its own provider balance and supplier;
  - posts ONE payment (legs, change, account debt, kept change, waive, extra), reconciled per currency;
  - stamps profit;
  - is reversed as a whole (`refundSessionBasket` / `voidSessionBasket`), and a lone item's reversal is already refused.

  A new checkout would duplicate the most sensitive money code in the app (rule 14, constitution IV).
- **Alternatives**:
  - A new BasketCheckoutService with its own posting: rejected, it duplicates the money flow.
  - Frontend calling `session.start` and then `session.checkout`: rejected. It is not atomic, leaves an open session on failure, and flips the UI into session mode.

## R2 — Where the session comes from
- **Decision**: The service creates it with `customer_notes = "Mobile Recharge basket"` and the client's name (or "Walk-in"). The checkout closes it. On failure the service deletes it.
- **Rationale**: No migration. The session shows on the Sessions page as a closed basket, which links the per-provider sales (FR-008).
- **Risk**: For a few milliseconds the session is "active" before checkout closes it. Accepted: checkout is one server call.

## R3 — Pricing lines owned by another screen
- **Decision**: Each form publishes priced lines (`PricedLine`) into the shared basket whenever its cart or pricing changes; the paying form uses the published lines.
- **Rationale**: iPick/Katsh pricing (Only Days, tenant credit price, catalog pricing fetch) lives in KatshForm. Re-deriving it elsewhere would be a second definition (rule 14).

## R4 — Discount on a combined basket
- **Decision**:
  - Allowed only when every line is in one currency.
  - Spread over sub-items in proportion to each sub-item's commission, capped at that commission.
  - Both `amount` and `commission` are lowered, so the customer pays less and profit drops, like KatshForm's walk-in discount.
  - Mixed currencies: discount hidden.
- **Rationale**: A single currency avoids converting a discount between currencies; the cap keeps any sale from going below its cost (FR-006).

## R5 — Offline
- **Decision**: `recharge-basket:checkout` is `online_only`.
- **Rationale**: A new money write; the offline replay family for sessions does not cover a server-created session.
