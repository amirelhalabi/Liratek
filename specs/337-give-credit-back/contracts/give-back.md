# Contract: give credit back

## Schema `giveBackResaleLineSchema` (`packages/core/src/validators/resaleLine.ts`)

| Field | Type | Rule |
|---|---|---|
| product_id | int > 0 | required |
| credits_kept | number >= 0 | required, < line credit (checked by service) |
| carrier_line_id | int > 0 | optional; default = carrier's primary shop line |
| credit_sell_price_lbp | number > 0 | required |
| exchange_rate | number > 0 | optional; default = shop USD sell rate |
| client_day | YYYY-MM-DD | optional (rule 27) |

`GiveBackResaleLineInput = z.input<typeof giveBackResaleLineSchema>`, exported from `index.ts` AND `browser.ts`.

## Transports

| Transport | Channel / route | Roles |
|---|---|---|
| IPC | `resale-lines:give-back` | admin, staff |
| REST | `POST /api/resale-lines/:productId/give-back` (body carries `product_id` too; refused when it differs from the path, like the recharge route) | admin, staff |
| Adapter | `giveBackResaleLineCredit(payload: GiveBackResaleLineInput)` | |

Actor `userId` from session (IPC) / JWT (REST). HTTP 200 on refusal.

## Response

```ts
{ success: true, data: {
    transaction_id: number; give_back_id: number;
    credits_sent: number; sms_fee_usd: number;
    price_drop_usd: number; cost_drop_usd: number;
    line: { credits: number; price_usd: number; cost_usd: number };
} }
| { success: false, error: string }
```

## Refusals (exact text)

- "This line is not in stock."
- "Save this line's carrier on the Phone Lines page first."
- "This line has no credit to give back."
- "The buyer must keep less credit than the line has."
- "Too little credit to cover the SMS fee."
- "Pick an active MTC shop line." / "Pick an active Alfa shop line."
- "Use an MTC card or line for this MTC number." (carrier mismatch, existing text)
- "This line's price would go below zero." / "This line's cost would go below zero."
- "This line has expired past its grace period and can no longer be recharged."

Void refusals: "Refund the sale of this line first.", "Undo the newer recharge of this line first."

## Pure planner `planLineGiveBack` (`packages/core/src/utils/lineGiveBack.ts`, browser-safe)

Input: `{ creditsBefore, creditsKept, creditSellPriceLbp, creditCostRateLbp, exchangeRate }`.
Output: `{ ok: true, creditsSent, smsFeeUsd, creditsAfter, priceDropUsd, costDropUsd } | { ok: false, error }`.
