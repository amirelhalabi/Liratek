# Contracts: payload changes (LIRA-310)

Every write keeps the IPC-identical envelope `{ success, data?, error? }`, with HTTP 200 on failure. The adapter types are derived from the core schemas (rule 21). Where a hand-written type already exists (supplier settle preload / `electron.d.ts` / `SettleAccountRequest`), the new key is added there too (rules 12, 23).

## Customer side (offline-capable channels)

### `loto:sell` / `POST /api/loto/sell`
```ts
// added to lotoSellSchema
discount_usd?: number; // >= 0
discount_lbp?: number; // >= 0
```
Refusals (plain sentence, then the technical detail in parentheses):
- "The discount is more than the shop's commission on this ticket."
- "The discount does not match what is left to pay." (claim ≠ gap)
- "A discount can't be combined with change kept." / "…with a partner ticket." / "…inside a customer basket."

### `session:checkout` / `POST /api/sessions/checkout`
```ts
// added to sessionCheckoutSchema
waived_usd?: number; // >= 0
waived_lbp?: number; // >= 0
```
Refusals:
- "The waived amount is more than $5 / 450,000 LBP."
- "The waived amount does not match what is left to pay."
- "Waive can't be combined with change kept."

## Counterparty side (online-only channels)

### `suppliers:settle-account` / `POST /api/suppliers/:id/settle-account`
```ts
discount?: { amount_usd: number; amount_lbp: number; reason?: string } // counterpartyDiscountInputSchema
```
### `suppliers:settle` / `POST /api/suppliers/:id/settle`
Same `discount?` field.

### `loto:checkpoint:settle`, `loto:checkpoints:settle-batch` / `POST /api/loto/checkpoints/:id/settle`, `POST /api/loto/checkpoints/settle-batch`
```ts
discount_lbp?: number; // >= 0
```

## UI component contract (`@liratek/ui` MultiPaymentInput)

```ts
onWaiveRemaining?: (amount: number, remainingByCurrency: Money[]) => void; // amount rounded to the total's currency
waiveRemainingThreshold?: number; // now in totalAmountCurrency; default SHORTFALL_MAX[totalAmountCurrency]
waiveRemainingMax?: number;       // room left in the page's own discount; Waive hidden when shortfall exceeds it
```
- The built-in Waive (no `onWaiveRemaining`) appears only when the internal discount is visible, lowers the total, is booked (`onDiscountChange`), and fits under `maxDiscount`.
- No Waive on payouts.
- `data-testid="waive-remaining"` for both paths.
- Waive renders inside the Remaining row only. Whenever Remaining is hidden (paid in full, overpaid, payout keep, auto-debt account line), Waive is hidden too.

`PaymentSheet` forwards the three props. `CounterpartySettleModal` passes them through its existing MPI bag.
