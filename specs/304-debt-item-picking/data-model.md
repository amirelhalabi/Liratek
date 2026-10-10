# Data Model: LIRA-304

Migration **v209**, written in BOTH `packages/core/src/db/migrations/index.ts` and `electron-app/create_db.sql`, with a `down()` (rule 10).

## Changed table: `customer_session_transactions`

| Column | Type | Default | Meaning |
|---|---|---|---|
| `owed_usd` | REAL NOT NULL | 0 | This member's share of the basket's on-account portion (USD), fixed at checkout. 0 for SALE members (tracked on `sales`), for payouts, For-Partner items and `session_item_refund` link rows. |
| `owed_lbp` | REAL NOT NULL | 0 | Same, LBP. |
| `covered_usd` | REAL NOT NULL | 0 | How much of `owed_usd` repayments/discounts have paid. |
| `covered_lbp` | REAL NOT NULL | 0 | Same, LBP. |

Existing `id`, `created_at` present; add `updated_at` if missing (rule 5).

**Member open amount** (per currency) = `owed − covered − refund credit attributed to this member`. The refund credit already exists as the member's `'Session Item Refund'` debt row (linked by the REFUND transaction whose `reverses_id` = the member's unified transaction).

### Invariant I1 (per basket row, per currency)
```
Session Debt.covered = gift-card pre-cover + sale pre-cover/coverage share + Σ non-sale member.covered
Session Debt.amount  = gift-card part + Σ sale debt share + Σ non-sale member.owed
```
Written only by `DebtRepository.applyCoverage` (research D2). Guarded by `sessionMemberCoverage.invariant.test.ts`.

### Backfill (research D12)
For each `'Session Debt'` row with `transaction_id IS NULL`: non-sale debt = `amount − sale share − gift card` per currency, split over non-sale charge members by their `amount_*` (by-share, as checkouts were split before this change), last member takes the rounding remainder; existing non-sale `covered_*` distributed oldest-first by `cst.id`. Assert I1; abort the migration if any basket fails.

## Unchanged tables, new meaning documented

- **`debt_ledger` (`'Session Debt'`)** — still one row per basket; `covered_*` now always equals I1's right side.
- **`transactions.metadata_json` on `DEBT_REPAYMENT`**
  - `coverage_applied`: `{ sales: [{id, usd}], charges: [{id, usd, lbp}], members: [{id, usd, lbp}] }` — `members` is new; the void reads it.
  - `routed` (new): `{ provider: "OMT"|"WHISH", drawer: "OMT_System"|"Whish_System", by_transfer: [{ ref: {kind, id}, debt_currency: "USD"|"LBP", value: number }], legs: [{ currency, amount }] }` — `value` is in the transfer's own currency, fixed at the repayment's stamped rate (research D3); the cap per transfer = its amount − Σ earlier `value`s for that transfer.
  - `targets` (new, audit only): the ticked items as sent `[{kind, id}]`.
- **`transactions.metadata_json` on `COUNTERPARTY_DISCOUNT`** — gains `coverage_applied` (audit; discounts stay non-reversible).
- **`payments`** — the routed share keeps two internal rows (research D4): paying drawer −X (internal) and system drawer +X (internal, method = provider). New repayments no longer use the method label `RESERVE` if a clearer internal label exists in `isInternalLegJs`; whichever label is used must stay internal and non-overridable.

## Entities (read model)

### OpenDebtItem (returned to the Debts page)
| Field | Type | Notes |
|---|---|---|
| `kind` | `"sale" \| "charge" \| "member"` | research D7 |
| `id` | number | `sales.id` / `debt_ledger.id` / `customer_session_transactions.id` |
| `session_id` | number \| null | set for basket members and basket sales |
| `label` | string | e.g. "OMT SEND $100 + $1 fee", "Anker Braided USB-C Cable 2m" |
| `type` | string | `SALE`, `FINANCIAL_SERVICE`, `LOTO`, `RECHARGE`, … |
| `provider` | string \| null | for transfers: `OMT`, `WHISH`, `OMT_APP`, `WHISH_APP`, `BINANCE` |
| `is_primary_system` | boolean | `provider === shop_base_system` and provider is a system |
| `created_at` | string | ordering |
| `owed_usd`, `owed_lbp` | number | |
| `open_usd`, `open_lbp` | number | after coverage and refunds |
| `refunded` | boolean | shown, not pickable |
| `pickable` | boolean | false for Manual Debt, refunded, closed |
| `routed_value` | number \| null | primary-system transfers only: Σ earlier routed `value`s, in the transfer's own currency (research D3) |

### RepaymentTarget (request)
`{ kind: "sale" | "charge" | "member", id: number }` — validated server-side: belongs to the client, open, pickable.
