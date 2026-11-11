# Data model: LIRA-382

No stored data changes. No new payload keys.

## UI state (inside `MultiPaymentInput`, payout mode)

| Field              | Type                              | Meaning                                                                              |
| ------------------ | --------------------------------- | ------------------------------------------------------------------------------------ |
| `payoutLineMode`   | `"extra" \| "less"`               | active side when nothing is derived from the lines                                   |
| `payoutLineText`   | `string \| null`                  | raw text while the cashier types; `null` = show the value read back from the lines   |
| `payoutLineBump`   | number (signed, total's currency) | how far the fill target is moved from what is owed (+ extra, − less); 0 = plain owed |
| `payoutLineCapped` | boolean                           | last typed value was held at the cap                                                 |

## Payload fields (existing, unchanged)

- "+ Extra" → `rounding_given_usd` / `rounding_given_lbp` (via `onRoundUpChange`)
- "− Less" → `kept_change_usd` / `kept_change_lbp` (via `onKeptChange`)
