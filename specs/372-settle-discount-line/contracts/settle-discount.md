# Contract: settle discount on the wire (LIRA-372)

No key is renamed (rules 22/23). Every change below is a refinement or a widening.

## Shared core pieces (`packages/core`, browser-safe)

```ts
// validators/counterparty.ts  (moved from supplier.ts `settlementDiscountSchema`)
export const settleDiscountInputSchema       // {amount_usd ≥0, amount_lbp ≥0, reason?}, ≥1 > 0,
                                             // each isWithinShortfallMax(…, c); message "The discount is more than $5." / "… 450,000 LBP."
export const settleForgiveAmountSchema = (c) // number ≥ 0 within SHORTFALL_MAX[c] (partner per-day)
// utils/settleDiscount.ts (new pure leaf; exported from browser.ts and index.ts)
// `owed` = owed in that currency BEFORE the payment (net of credit used) — research R2
export function settleDiscountRoom(currency: "USD"|"LBP", owed: number): number
export function clampSettleDiscount(currency, typed: number, owed: number):
  { applied: number; capped: boolean; room: number }
export function settleDiscountOverpaid(currency, owed: number, paid: number, discount: number): boolean
```

## Per channel

| Channel (IPC / REST) | Key | Before | After |
|---|---|---|---|
| `debt:add-repayment` / `POST /api/debts/repayments` | `discount` | uncapped | `settleDiscountInputSchema` |
| `suppliers:record-cashflow` / `POST /api/suppliers/:id/cashflow` | `discount` | PAY only, uncapped | PAY **or RECEIVE**, `settleDiscountInputSchema`; server also refuses when > balance − cash per currency |
| `suppliers:settle-transactions` / `POST /api/suppliers/:id/settle` | `discount` | capped (LIRA-310) | same schema, imported from counterparty.ts |
| `suppliers:settle-account` / `POST /api/suppliers/:id/settle-account` (amount-first) | `per_currency.<C>.waive` | uncapped in the schema (the repository caps) | schema caps per currency in the parent `superRefine` |
| `suppliers:settle-account` (amount-first) | **`discount_reason`** (new, optional, ≤ 500) | — | only with `per_currency`; becomes the DISCOUNT row's note |
| `partners:settle` / `POST /api/partners/settle` | `discount` | uncapped (≤ balance in service) | `settleDiscountInputSchema` |
| `partners:settle-days` / `POST /api/partners/settle-days` | `sections[].forgive.amount` | uncapped | `settleForgiveAmountSchema(section.currency)` |

Every refusal uses the IPC-identical envelope `{ success:false, error }`, with HTTP 200 on REST.

Adapter payload types are already `z.input<…>` of these schemas (rule 21). The only hand-written type to update is the preload `SettleAccountRequest` (adds `discount_reason`), plus `frontend/src/types/electron.d.ts`. Rule-23 diff tasks cover both new keys.

## UI contract — `SettleDiscountLine` (`packages/ui`)

```ts
interface SettleDiscountLineProps {
  currencies: ("USD"|"LBP")[];                       // one field each
  values: Partial<Record<"USD"|"LBP", string>>;
  onChange: (c: "USD"|"LBP", raw: string) => void;
  room: Partial<Record<"USD"|"LBP", number>>;        // from settleDiscountRoom
  reason?: { value: string; onChange: (v: string) => void };
  hint?: ReactNode;
}
```

- Label: `discountLine.settleLabel` = "Discount".
- Test ids: `settle-discount-line`, `settle-discount-usd`, `settle-discount-lbp`, `settle-discount-reason`, plus `discount-cap-note` from `DiscountLine`.
- It is rendered through MPI `discountRow`.
- Waive: `waiveDisabled` and no `onWaiveRemaining` on every settle screen.
- Payment line: MPI `discountMovesPayment` is true (the default) on every settle screen (FR-010). Every screen passes `fillTotals` net of the discount and puts the discount in `fillKey`, so the line follows it even when typed by hand (owner 2026-11-05, option B). Confirm is blocked only when the cashier edits the payment AFTER the discount so that payment + discount exceeds what is owed (`settleDiscountOverpaid`, Debts' `repayForgiveBlocked`).
- Batch Settle renders the line only on the shop-pays branch (FR-002 exception).
- Roles are unchanged (research R13).
