# Data Model: Wrong-Number Card Recharge (LIRA-312)

Migration **v214** (built 2026-10-14; planned as v212, which LIRA-319 took): re-check the last entry at build time. It goes into both
`migrations/index.ts` and `create_db.sql`, with a `down()`. Reset Data wipes
the table, and the new table is appended to `OFFLINE_ID_TABLES`.

## wrong_number_cards (new)

| Column | Type | Rule |
|---|---|---|
| id | INTEGER PK | |
| tenant_id | INTEGER FK tenants | every query filters on it |
| expense_id | INTEGER NOT NULL FK expenses | the loss (stock-use expense) |
| expense_transaction_id | INTEGER NOT NULL UNIQUE FK transactions | its `EXPENSE_IPICK/KATSH/WHISH_APP` row |
| sale_transaction_id | INTEGER NULL FK transactions | set on path B (from the sale row) |
| provider | TEXT NOT NULL | CHECK IN ('iPick','Katsh','WHISH_APP') |
| carrier | TEXT NOT NULL | CHECK IN ('mtc','alfa') |
| mobile_service_item_id | INTEGER NOT NULL FK mobile_service_items | the card |
| card_label | TEXT NOT NULL | snapshot, e.g. "Alfa 7.58" |
| card_cost_lbp | REAL NOT NULL | > 0, snapshot of the expense amount |
| card_credit_usd | REAL NOT NULL | ≥ 0, cap for recoveries |
| wrong_number | TEXT NOT NULL | stored with `normalizeLineNumber`; optional since LIRA-325 — stored as `''` when not entered (no migration: the column stays NOT NULL) and read back as `NULL` (`NULLIF(wrong_number, '')`, one helper in the repository) |
| right_number | TEXT NULL | path B only; ≠ wrong_number (compared with `isSameLebanesePhone`) |
| created_at / updated_at | DATETIME | |

Index: (`tenant_id`, `sale_transaction_id`).

## Credits-received entries

These are not a table. Each entry is a `transactions` row:

- `type = 'WRONG_NUMBER_CREDITS'`
- `source_table = 'wrong_number_cards'`, `source_id = wrong_number_cards.id`
- `amount_usd = X`
- `profit_lbp = X × telecom_credit_sell_price_lbp` (resold-credit price, default 100,000), `profit_usd = 0`
- `metadata_json`: `{ carrier, carrier_line_id, credit_rate_lbp }`

Each row also writes:
- a `carrier_line_movements` row: `creditsDelta +X`, `transaction_id`;
- a `payments` row: `+X` USD on the MTC/Alfa drawer (plus the drift leg rule).

An entry is active while its row is ACTIVE.

## Derived (not stored)

- **total_recovered_usd** = Σ `amount_usd` of the record's ACTIVE `WRONG_NUMBER_CREDITS` rows.
- **recovered_value_lbp** = Σ `profit_lbp` of the same rows.
- **remaining_loss_lbp** = `card_cost_lbp − recovered_value_lbp`.
- **status:**
  - `WAITING`: no active entry;
  - `PARTLY_RECOVERED`: some recovered, less than the card's credit;
  - `RECOVERED`: total recovered = card credit;
  - `VOIDED`: the expense is voided.

## Rows per action (Alfa $7.58, cost 770,000, credit sell rate R = 100,000)

| Action | Rows | Reversal owner |
|---|---|---|
| Record wrong number (A or B) | `expenses` row (770,000 LBP, "Wrong number card"); `EXPENSE_IPICK` txn; payments −770,000 on the iPick drawer; `wrong_number_cards` row | generic void (existing stock-expense path). New guard: refused while active credits entries exist |
| Credits received $6.68 on 03222875 | `WRONG_NUMBER_CREDITS` txn (profit_lbp 6.68×100,000 = 668,000 → remaining loss 102,000); `carrier_line_movements` +6.68; payments +6.68 USD on the Alfa drawer | generic void: `_reversePayments` + `_reverseCarrierLineMovements`; the profit stamp drops with VOIDED |
| Sale (path B) | unchanged | unchanged |

**Ledger invariant per credits entry:** shop line Δ = drawer Δ = +X USD, and loss Δ = −X × R LBP. Void nets all three to 0.
