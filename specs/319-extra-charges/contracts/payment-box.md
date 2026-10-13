# Contract: payment box (UI) — Extra charges

## `DiscountLine` (packages/ui)

New optional props:

| Prop | Type | Meaning |
| --- | --- | --- |
| `mode` | `"discount" \| "extra"` | Active side of the switch. Absent = no switch (today's behaviour). |
| `onModeChange` | `(mode) => void` | Switch tapped. The page clears the other amount (FR-007). |
| `allowExtra` | `boolean` | Show the "− Discount \| + Extra" switch. Pages that may not take an extra omit it. |

Label follows the mode: "Discount" / "Forgive (no cash)" or "Extra". The cap note reads "Capped to max (…)" in both modes.

## `MultiPaymentInput` built-in discount

| Prop | Type | Meaning |
| --- | --- | --- |
| `onExtraChange` | `(extra: number) => void` | Enables extra mode on the built-in line; reports the extra in `totalAmountCurrency`. |
| `maxExtra` | `number` | Cap (default: the pre-extra total). |

In extra mode the line ADDS to `effectiveTotals`, the row below reads "After Extra", and the payment line follows the total like a discount does. Payout mode never offers it.

## Pages that own their line (`discountRow`)

POS / Maintenance checkout pass `mode`/`onModeChange`/`allowExtra` on their `DiscountLine`, pass `totalBeforeDiscount` = pre-extra total and `totals` = total + extra.

## Test ids

`discount-mode-discount`, `discount-mode-extra` (switch buttons), existing `checkout-discount-input`, new `after-page-extra`.
