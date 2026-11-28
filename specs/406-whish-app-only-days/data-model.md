# Data Model: Whish App "Only Days" (LIRA-406)

No schema change. No migration.

## Existing catalog columns used (`mobile_service_items`, Whish App rows already populated)
| Column | Use |
| --- | --- |
| `category` (`alfa` / `mtc`) | carrier → drawer (`Alfa` / `MTC`) and primary line |
| `cost_lbp` | card cost paid from the Whish App drawer (unchanged) |
| `credits`, `days_cost_lbp` | split-complete gate (`isTelecomSplitComplete`) |
| `validity_days` | eligibility display (same rule as Katsh) |
| `sell_days_lbp`, `sell_credit_lbp` | Only Days price model |
| `max_returned_credits_usd` | per-card returnable override (v160) |

## Frontend cart line (in memory, basket context)
`WhishCartLine` gains the Katsh fields (same names, same meaning as `CatalogCartLine`):
- `onlyDays: boolean` (default false)
- `returnedCreditsUsd: number` (default 0)
- `returnedCreditsEdited: boolean` (default false)
- `sellDaysLbpOverride?: number`
- `creditPriceLbpOverride?: number`

Old basket entries without these fields read as not Only Days.

## Rows written per Only Days unit (unchanged from Katsh, now also for WHISH_APP)
- `payments`: method `CREDIT_RETURN`, drawer `Alfa`/`MTC`, USD, `+credits`
- `drawer_balances`: carrier drawer USD `+credits`
- `carrier_line_movements`: reason `ONLY_DAYS_RETURN`, `credits_delta = +credits`, tied to the transaction
- profit stamp: `price − cost + credits × telecom_credit_cost_rate_lbp`

Reversal: `_reversePayments` + `_reverseCarrierLineMovements` (generic void / refund).
