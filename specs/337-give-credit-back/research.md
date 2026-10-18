# Research: Give credit back (LIRA-337)

## R1 — Where the record lives

**Decision**: a new table `resale_line_give_backs`, one row per give-back. It is the reversal record for `LINE_CREDIT_GIVE_BACK`.

**Rationale**: `resale_line_recharges` has `CHECK(source IN ('CARD','SHOP_LINE_CREDIT','DAYS'))`, `cost_usd > 0` and `credits_added >= 0`. A give-back lowers cost and credit, and its price change differs from its cost change. SQLite cannot change a CHECK without rebuilding the table.

**Alternatives**: rebuild `resale_line_recharges` with a signed shape. Rejected because it means a risky rebuild of a live money table.

## R2 — SMS fee split (sender pays)

**Decision**: the amount leaving the line is G = credit before − credit kept. Send the largest X, in cents, such that X + ⌈X / 3⌉ × 0.16 ≤ G. The fee is F = ⌈X / 3⌉ × 0.16 and the credit left is before − X − F. That is exactly the amount kept when a split exists, otherwise up to a few cents above it. Refuse when X ≤ 0 (G ≤ 0.16).

To compute it, try each message count n from 1 to ⌈G / 3⌉ + 1:

- candidate X = min(3n, G − 0.16n);
- the candidate is valid when X > 3(n − 1);
- keep the largest valid X.

**Check**:

| G | n | X | Fee | Credit left |
|---|---|---|---|---|
| 6.00 | 2 | 5.68 | 0.32 | 9.00 (exact) |
| 3.17 | 1 | 3.00 | 0.16 | 3.17 − 3.16 → 0.01 above the amount kept |

**Rationale**: owner, 2026-10-18: "the buyer keeps exactly the amount they asked for". The fee formula is the same as `planSmsTransfer` (`SMS_TRANSFER_FEE_USD`, `MAX_CREDIT_PER_SMS_USD`), reused from `utils/telecomCredit.ts`, not copied.

## R3 — Price drop

**Decision**: priceDrop = round2((before − after) × creditSellPriceLbp / rate).

- `creditSellPriceLbp` is typed on screen. It defaults to setting `alfa_credit_sell_rate_lbp`, or 100,000 when unset.
- `rate` is the shop's USD sell rate, the same one the LIRA-309 panel sends as `exchange_rate`.

Example: 6 × 100,000 / 89,500 = 6.7039 → $6.70.

## R4 — Cost drop

**Decision**: costDrop = round2(X × creditCostRateLbp / rate).

- `creditCostRateLbp` is the `alfa_credit_cost_lbp` setting, or 85,000 when unset.
- It comes from the server, through `getCreditCostRateLbp`, which is the same rate LIRA-309's credit recharge capitalizes at.
- The panel reads the same setting for its preview. The server's value is the one saved.

The fee is not subtracted from the cost, so it stays in the line's cost (owner, 2026-10-18).

Example with a cost rate equal to the exchange rate: 5.68 → $5.68.

## R5 — Money posting

**Decision**: mirror LIRA-309's SHOP_LINE_CREDIT recharge, with the signs flipped:

- one USD leg of +X on the carrier drawer ("MTC" or "Alfa"), as a payments row;
- `applyMovement` of +X credits on the shop line, with reason `RESALE_GIVE_BACK`.

The transaction is booked with `amount_usd = +X`, `profit = 0` and cash flow null, like LINE_RECHARGE. No expense row.

## R6 — Void when the shop line has spent the credit

**Decision**: allow it; the shop line may go below zero.

**Rationale**: the owner decided on 2026-10-13 that a credit recharge from a low shop line is allowed ("like a credit sale today"). Refusing here would be inconsistent. The spec's unconfirmed default was changed to match.

## R7 — Newest-first across recharges and give-backs

**Decision**: one repository helper, `getLatestActiveLineChange(resaleLineId)`. It returns the active row with the highest `transaction_id` across both `resale_line_recharges` and `resale_line_give_backs`.

Both `reverseRecharge` and `reverseGiveBack` refuse unless their own transaction is that latest one. The message is the same in both: "Undo the newer recharge of this line first."

**Rationale**: transaction ids increase over time, so they order both tables. A single helper keeps one rule (rule 14).

## R8 — Guards

- The line must be unsold, have a carrier and a details row, and have credit > 0.
- The credit kept must be ≥ 0 and < the credit before.
- The shop line must be active and the same carrier, defaulting to the primary line.
- The new price and the new cost must each be ≥ 0. The line must not be burned: the same check as recharge.
- The batch is changed by `addToOpenBatchUnitCost(productId, −costDrop)`, which already refuses a line with more than one unit in stock.

## R9 — Roles

Admin and staff, the same as the recharge channel.
