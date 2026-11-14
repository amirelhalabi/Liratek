# Data model — LIRA-391

No schema change, no migration.

## Payload fields involved (existing, `CreateFinancialServiceData`)

| Field | Role after the fix |
|---|---|
| `payments[]` (IN legs) | **The** routing source when at least one leg has a non-zero amount: each leg is booked by its method (CUSTOMER_ACCOUNT → client ledger credit, drawer method → that drawer). |
| `cashoutMethod` | Routes money only when no non-zero IN leg exists (legacy callers). Still stored in details for display. |
| `paidByMethod` | Display label (`MULTI` on a split); unchanged. |

## Derived values (pure helpers, `utils/paymentLegs.ts`)

- `hasPostingLegs(legs)` — any leg with `|amount| > 0`.
- `lumpFlagWhenNoLegs(flag, legs)` — `flag` when `!hasPostingLegs(legs)`, else `undefined`.
- `payoutMethodOf(flag, legs)` — legs present: the method every non-zero leg shares, else `"MIXED"`; no legs: `flag`.

## Frontend derived value

- `lumpMethodOf(lines)` — the method when every line shares it (≥1 line), else `undefined`.
