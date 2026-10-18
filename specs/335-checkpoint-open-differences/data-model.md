# Data model: Checkpoint open differences (LIRA-335)

Migration **v222** `checkpoint_differences` (both `packages/core/src/db/migrations/index.ts` and `electron-app/create_db.sql`, rule 10). Modelled on v217.

## Table `checkpoint_differences`

One row per checkpoint, drawer and currency where the checkpoint corrected the balance (|delta| > epsilon). Written inside `createCheckpoint` from the same `adjustments` it posts.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| tenant_id | INTEGER NOT NULL REFERENCES tenants(id) | |
| closing_id | INTEGER NOT NULL REFERENCES daily_closings(id) | the checkpoint |
| drawer_name | TEXT NOT NULL | real drawer (never `AGGREGATED`) |
| currency_code | TEXT NOT NULL | |
| amount | REAL NOT NULL | posted delta, signed: > 0 Over, < 0 Short |
| closed_at | TEXT NULL | set by Close, cleared by Reopen |
| closed_by | INTEGER NULL REFERENCES users(id) | |
| created_at | TEXT NOT NULL DEFAULT (datetime('now')) | the checkpoint's own time (`requestNow()`) |
| updated_at | TEXT NOT NULL DEFAULT (datetime('now')) | |

Indexes: UNIQUE `(tenant_id, closing_id, drawer_name, currency_code)`; `(tenant_id, drawer_name, currency_code)`.

## Table `checkpoint_difference_resolutions`

One row per resolving transaction, drawer and currency.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| tenant_id | INTEGER NOT NULL REFERENCES tenants(id) | |
| difference_id | INTEGER NOT NULL REFERENCES checkpoint_differences(id) | |
| transaction_id | INTEGER NOT NULL REFERENCES transactions(id) | the back-timed transaction that carries the offset leg |
| amount | REAL NOT NULL | magnitude resolved, with the difference's sign |
| created_at / updated_at | TEXT NOT NULL DEFAULT (datetime('now')) | |

Indexes: `(tenant_id, difference_id)`, `(tenant_id, transaction_id)`.

**Active resolution** (derived, never stored): its transaction is not voided. One named fragment `ACTIVE_RESOLUTION_SQL` (rule 14).

## Payments rows (existing table, new method)

Offset leg written on the resolving transaction: `method = 'CHECKPOINT_RESOLUTION'`, same drawer and currency, amount = −(resolved, signed like the transaction's net movement), note `Resolves checkpoint #<closing_id> (<drawer>)`. Plus `applyDrawerDelta` with the same amount.

## Expense (existing table)

Drawer shortage expense: `category = 'Drawer shortage'`, `books_only = true`, `source_ref_table = 'checkpoint_differences'`, `source_ref_id = difference id`, `expense_date = daily_closings.closing_date`, `paid_by_method = 'CASH'`, USD or LBP only. At most one active per difference.

## Derived values (one pure function, browser-safe: `utils/checkpointDifference.ts`)

```
abs        = |amount|
resolved   = Σ |active resolutions|            (≤ abs)
open       = max(0, abs − resolved)
direction  = amount > 0 ? "OVER" : "SHORT"
status     = open ≤ ε          → "RESOLVED"
             closed_at set     → "CLOSED"       (with direction)
             resolved > ε      → "PARTLY_RESOLVED"
             otherwise         → "OPEN"
shortage expense target (closed SHORT, USD/LBP) = open
```

ε = the checkpoint's existing `RECONCILE_EPSILON` rule (0.01 USD-like, 1 LBP), reused, not redefined.

## State transitions

```
            resolution (partial)          resolution (rest)
   OPEN ─────────────────────▶ PARTLY ───────────────────▶ RESOLVED
    │  ▲                         │  ▲                         │
    │  └──── void of resolver ───┘  └──── void of resolver ───┘
    │ Close                         │ Close
    ▼                               ▼
  CLOSED(open part) ◀── Reopen ── (back to OPEN / PARTLY)
    │ resolution while closed (FR-016): shortage expense shrinks; RESOLVED when open = 0
```

## Reversal owners (rule 20)

| Row written | Reversal owner |
|---|---|
| `CHECKPOINT_RESOLUTION` payments leg + drawer delta | generic void (`_reversePayments` mode `void`); refund skips it by design |
| `checkpoint_difference_resolutions` row | none needed: inactive once its transaction is voided (derived) |
| Drawer shortage expense | `syncShortageExpense` (Reopen, new resolution, void of a resolver); manual void refused |
| `checkpoint_differences` row | none: belongs to its checkpoint, which is non-reversible |
