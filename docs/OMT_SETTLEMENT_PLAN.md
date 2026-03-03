# OMT/WHISH Transaction Settlement — Engineering Plan

> **Status**: Planning  
> **Author**: Rovo Dev  
> **Date**: 2026-03-01  
> **Scope**: Financial services settlement tracking, pending profit separation, and Supplier Ledger settlement UI

---

## Problem Statement

When the shop processes **RECEIVE** transactions for OMT/WHISH:

- The `commission` represents money OMT _owes_ the shop — **not cash in hand yet**
- It gets settled during a periodic OMT↔shop reconciliation
- **Currently**: profit page counts all commission (settled + unsettled) as realized profit
- **Desired**: unsettled commissions shown as **"pending / to be settled"**, separate from realized profit
- Settlement is triggered manually in Settings → Supplier Ledger

---

## Core Concepts & Invariants

| Concept            | Rule                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------- |
| SEND commission    | Earned immediately from customer → `is_settled = 1` at creation                             |
| RECEIVE commission | OMT owes it → `is_settled = 0` until explicit settlement event                              |
| Settlement         | Shop pays OMT the net (total owed − shop's commissions). Commission stays in shop's pocket. |
| `is_settled`       | Per-transaction flag on `financial_services`                                                |
| `settled_at`       | Timestamp set when the transaction is included in a settlement                              |
| `settlement_id`    | FK linking `financial_services` row → `supplier_ledger` SETTLEMENT entry                    |

### Settlement Net Amount Formula

```
totalAmountOwedToOMT = SUM(fs.amount)      for selected RECEIVE txns
totalCommission      = SUM(fs.commission)  for selected RECEIVE txns
netPayToOMT          = totalAmountOwedToOMT - totalCommission
```

The shop pays OMT `netPayToOMT`. The `totalCommission` stays in the shop's General drawer.

---

## Implementation Phases

### Phase 1 — DB Migration

Add 3 columns to `financial_services`:

```sql
ALTER TABLE financial_services ADD COLUMN is_settled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE financial_services ADD COLUMN settled_at TEXT;
ALTER TABLE financial_services ADD COLUMN settlement_id INTEGER REFERENCES supplier_ledger(id);
```

**Why default `1`**: all existing SEND transactions are already settled (commission is in General drawer).  
**Migration logic**: immediately after adding columns, set `is_settled = 0` on all existing RECEIVE rows where `commission > 0`.

```sql
UPDATE financial_services
SET is_settled = 0
WHERE service_type = 'RECEIVE' AND commission > 0;
```

Also extend the `supplier_ledger.entry_type` CHECK constraint to include `'SETTLEMENT'`:

```sql
-- Recreate supplier_ledger with updated CHECK constraint
-- entry_type IN ('TOP_UP', 'PAYMENT', 'ADJUSTMENT', 'SETTLEMENT')
```

Migration name: `"add_settlement_tracking_to_financial_services"`

---

### Phase 2 — Repository Layer (`FinancialServiceRepository.ts`)

#### 2a. `createTransaction()` — set `is_settled` at insert time

| Condition                                    | `is_settled` | `settled_at`        |
| -------------------------------------------- | ------------ | ------------------- |
| SEND (any provider, any commission)          | `1`          | `CURRENT_TIMESTAMP` |
| RECEIVE + OMT/WHISH + `commission > 0`       | `0`          | `NULL`              |
| RECEIVE + `commission = 0` (e.g. OMT_WALLET) | `1`          | `CURRENT_TIMESTAMP` |

#### 2b. New: `getUnsettledBySupplier(supplierId)`

```sql
SELECT fs.*
FROM financial_services fs
JOIN suppliers s ON s.provider = fs.provider
WHERE fs.is_settled = 0
  AND s.id = ?
ORDER BY fs.created_at ASC
```

#### 2c. New: `settleTransactions(txnIds: number[], settlementLedgerEntryId: number)`

```sql
UPDATE financial_services
SET is_settled = 1,
    settled_at = CURRENT_TIMESTAMP,
    settlement_id = ?
WHERE id IN (...)
  AND is_settled = 0   -- guard: prevent double-settling
```

Must run inside the same DB transaction as the ledger entry insert.

#### 2d. New: `getUnsettledSummaryByProvider()`

```sql
SELECT
  provider,
  COUNT(*) as count,
  SUM(CASE WHEN currency != 'LBP' THEN commission ELSE 0 END) as pending_commission_usd,
  SUM(CASE WHEN currency = 'LBP'  THEN commission ELSE 0 END) as pending_commission_lbp,
  SUM(CASE WHEN currency != 'LBP' THEN amount    ELSE 0 END) as total_owed_usd,
  SUM(CASE WHEN currency = 'LBP'  THEN amount    ELSE 0 END) as total_owed_lbp
FROM financial_services
WHERE is_settled = 0
GROUP BY provider
```

#### 2e. `getHistory()` — include `is_settled`, `settled_at` in SELECT columns

---

### Phase 3 — ProfitService Changes

Split `financial_services` commission into **realized** vs **pending** everywhere:

```sql
SUM(CASE WHEN is_settled = 1 THEN commission ELSE 0 END) AS realized_commission_usd,
SUM(CASE WHEN is_settled = 0 THEN commission ELSE 0 END) AS pending_commission_usd
```

#### Affected methods

| Method                          | Change                                                        |
| ------------------------------- | ------------------------------------------------------------- |
| `getSummary()`                  | Add `pending_commission_usd/lbp` to response                  |
| `getByModule()`                 | Split `financial_services` row into realized + pending        |
| `getByDate()`                   | Show settled vs pending per day                               |
| New: `getUnsettledByProvider()` | Return per-provider pending summary for Profits → Pending tab |

The **realized** commission feeds into today's/monthly earnings. The **pending** commission is shown separately with a "to be settled" note.

---

### Phase 4 — SupplierRepository — `settleTransactions()`

Add `'SETTLEMENT'` to the `SupplierLedgerEntryType` union:

```typescript
export type SupplierLedgerEntryType =
  | "TOP_UP"
  | "PAYMENT"
  | "ADJUSTMENT"
  | "SETTLEMENT";
```

New method signature:

```typescript
interface SettleTransactionData {
  supplier_id: number;
  financial_service_ids: number[]; // financial_services IDs to settle
  amount_usd: number; // net cash paid to OMT (after deducting commission)
  amount_lbp: number;
  drawer_name: string; // which drawer the net cash came from / went to
  note?: string;
  created_by: number;
}
```

Inside **one atomic DB transaction**:

1. Insert `supplier_ledger` row (`entry_type = 'SETTLEMENT'`, amount = net paid to OMT, stored as negative because shop is paying out)
2. Call `FinancialServiceRepository.settleTransactions(ids, ledgerEntryId)`
3. Update `drawer_balances`: the commission portion arrives in General as positive cash (`+totalCommission`)
4. Insert `transactions` row of type `SUPPLIER_PAYMENT` for full audit trail

**Why step 3 credits General**: the commission was "owed but not physically present." Settlement is the moment the shop pockets it — so General gets `+commission` at settlement time (for RECEIVE transactions only).

---

### Phase 5 — Service Layer

#### `SupplierService`

```typescript
settleTransactions(data: SettleTransactionData): SupplierResult
```

#### `FinancialService`

```typescript
getUnsettledBySupplier(supplierId: number): FinancialServiceEntity[]
getUnsettledSummary(): UnsettledSummaryByProvider[]
```

---

### Phase 6 — IPC / API Handlers

#### Electron (`supplierHandlers.ts`)

```typescript
ipcMain.handle('suppliers:unsettled-transactions', (e, supplierId: number) => ...)
ipcMain.handle('suppliers:settle-transactions', (e, data: SettleTransactionData) => ...)
ipcMain.handle('suppliers:unsettled-summary', () => ...)
```

All settlement handlers require `admin` role (same as existing supplier handlers).

#### Backend (`suppliers.ts`)

```
GET  /api/suppliers/:id/unsettled         → getUnsettledBySupplier
POST /api/suppliers/:id/settle            → settleTransactions
GET  /api/suppliers/unsettled-summary     → getUnsettledSummaryByProvider
```

---

### Phase 7 — Frontend Changes

#### 7a. Services page — history table

Add `Status` column:

| Condition                                     | Badge        |
| --------------------------------------------- | ------------ |
| RECEIVE + `commission > 0` + `is_settled = 0` | 🟡 `Pending` |
| RECEIVE + `is_settled = 1`                    | 🟢 `Settled` |
| SEND or `commission = 0`                      | `—`          |

#### 7b. Dashboard — Today's / Monthly Earnings

Add a sub-note when pending commission > 0:

```
TODAY'S EARNINGS
$0.30
2 txns
⚠ $0.30 pending settlement
```

The `$0.30` in the main number should only reflect **realized** (settled) commission.  
The pending amount is shown as an informational note below.

#### 7c. Profits page — Pending tab extension

Extend the existing "Pending Profit" tab with a new section for unsettled OMT/WHISH commissions:

- Group by provider (OMT, WHISH)
- Show: count of unsettled txns, pending commission USD, pending commission LBP
- Show: total owed to OMT (to help with settlement calculation)
- Link/button → opens Settings → Supplier Ledger for that provider

#### 7d. Settings → Supplier Ledger — full redesign

The existing `SupplierLedger.tsx` uses MUI components inconsistent with the rest of the app. Redesign using the existing Tailwind/dark-theme pattern.

**New layout:**

```
┌──────────────────────────────────────────────────────────────┐
│  OMT Supplier                                                 │
│  Ledger balance: -$543.00    Pending commission: $0.30        │
├──────────────────────────────────────────────────────────────┤
│  UNSETTLED TRANSACTIONS              [Select All] [Settle ▶] │
│  ─────────────────────────────────────────────────────────── │
│  ☐  RECEIVE  INTRA  $100.00  fee $1.00  profit $0.10  11:49  │
│  ☐  RECEIVE  INTRA  $150.00  fee $2.00  profit $0.20  11:49  │
│  ─────────────────────────────────────────────────────────── │
│  Selected: 2 txns                                            │
│  Total owed to OMT:    $250.00                               │
│  Your commission:      −$0.30                                │
│  Net you pay OMT:      $249.70   ← auto-calculated           │
│                        [Settle Selected]                      │
├──────────────────────────────────────────────────────────────┤
│  LEDGER HISTORY                                              │
│  2026-03-01  SETTLEMENT  -$249.70  "March 1 settle"  ✓      │
│  2026-02-28  PAYMENT     -$500.00  "Feb settlement"  ✓      │
└──────────────────────────────────────────────────────────────┘
```

**Settlement confirmation dialog:**

```
Settle 2 transactions with OMT

Total owed to OMT:    $250.00
Your commission:       -$0.30
─────────────────────────────
Net payment to OMT:   $249.70

Pay from drawer:  [General ▼]
Amount:           $249.70  (editable for rounding differences)
Note:             [optional free text]

[Cancel]   [Confirm Settlement]
```

On confirm:

1. Call `suppliers:settle-transactions` IPC / `POST /api/suppliers/:id/settle`
2. Atomic DB write (ledger entry + settle txns + drawer update)
3. Refresh unsettled list, ledger history, dashboard earnings

---

## Unit Tests

### `FinancialServiceRepository.test.ts` (new file)

```typescript
describe("createTransaction", () => {
  it("SEND → is_settled = 1 with settled_at set");
  it("RECEIVE with commission → is_settled = 0, settled_at = null");
  it("RECEIVE with commission = 0 → is_settled = 1");
});

describe("settleTransactions", () => {
  it("marks all specified rows is_settled = 1");
  it("sets settled_at and settlement_id correctly");
  it("ignores already-settled rows (guard prevents double-settle)");
  it("is atomic: rolled back if DB error occurs");
});

describe("getUnsettledBySupplier", () => {
  it("returns only is_settled = 0 rows for the given supplier");
  it("returns empty array when all txns are settled");
  it("does not cross-contaminate between providers");
});

describe("getUnsettledSummaryByProvider", () => {
  it("aggregates count, pending commission, total owed correctly");
  it("separates USD and LBP correctly");
});
```

### `SupplierRepository.test.ts` (extend)

```typescript
describe("settleTransactions", () => {
  it("creates SETTLEMENT ledger entry with correct net amount");
  it("calls settleTransactions on FinancialServiceRepository");
  it("credits General drawer with commission amount");
  it("is atomic: ledger entry rolled back if financial_services update fails");
  it("prevents settling an empty array of transaction IDs");
  it("throws if supplier not found");
});
```

### `ProfitService.test.ts` (extend)

```typescript
describe("getSummary with settlement tracking", () => {
  it(
    "unsettled RECEIVE commission appears only in pending_commission, not realized",
  );
  it("settled RECEIVE commission appears only in realized_commission");
  it("SEND commission always appears in realized_commission");
  it("totals: realized + pending = gross commission");
});

describe("getUnsettledByProvider", () => {
  it("groups correctly by provider");
  it("returns 0 when all settled");
});
```

### `SupplierService.test.ts` (extend)

```typescript
describe("settleTransactions", () => {
  it(
    "full flow: picks unsettled txns → creates ledger entry → marks settled → updates drawer",
  );
  it("returns error if any txn ID not found");
  it("returns error if txn already settled");
});
```

---

## Open Questions & Decisions

### ❓ Should SEND commission ever be "pending"?

**No.** SEND = customer hands over `amount + fee` in cash. The commission is physically in the General drawer. Auto-settled at creation.

### ❓ RECEIVE with commission = 0 (e.g. OMT_WALLET)?

**Auto-settled at creation** (`is_settled = 1`). Nothing to reconcile with OMT on that transaction.

### ❓ Partial settlement?

**Not in v1.** A transaction is fully settled or not. For rounding/edge cases, use a manual ADJUSTMENT entry in the supplier ledger. The settlement dialog amount is editable for minor rounding differences.

### ❓ What happens to `OMT_System` drawer during settlement?

In v1: **leave it unchanged**. `OMT_System` is a running ledger that reflects cumulative SEND/RECEIVE flow. It is not zeroed per settlement — it's a long-running balance showing how much the shop has "sent through OMT" net.

### ❓ Currency mixing in one settlement?

The dialog shows USD and LBP totals independently. Settle them together in one entry with both `amount_usd` and `amount_lbp` non-zero when needed.

### ❓ Who can settle?

**Admin only.** Role check in IPC handler (`requireRole(['admin'])`), same as existing supplier handlers.

### ❓ Dashboard earnings: show pending in the main number or separate?

**Separate.** Main number = realized only. Sub-note below shows `⚠ $X.XX pending settlement`.

---

## Implementation Order

| #   | Task                                                         | Files Touched                                            |
| --- | ------------------------------------------------------------ | -------------------------------------------------------- |
| 1   | DB Migration                                                 | `packages/core/src/db/migrations/index.ts`               |
| 2   | Repository layer (CRUD + settle methods + getHistory update) | `FinancialServiceRepository.ts`, `SupplierRepository.ts` |
| 3   | ProfitService split (realized vs pending)                    | `ProfitService.ts`                                       |
| 4   | SupplierService.settleTransactions()                         | `SupplierService.ts`                                     |
| 5   | FinancialService.getUnsettledBySupplier()                    | `FinancialService.ts`                                    |
| 6   | IPC handlers + Backend API endpoints                         | `supplierHandlers.ts`, `backend/src/api/suppliers.ts`    |
| 7   | Frontend: Services table status badge                        | `Services/index.tsx`                                     |
| 8   | Frontend: Dashboard pending note                             | `Dashboard.tsx`                                          |
| 9   | Frontend: Profits pending tab extension                      | `Profits.tsx`                                            |
| 10  | Frontend: Supplier Ledger settlement UI                      | `SupplierLedger.tsx` (full redesign)                     |
| 11  | Unit tests                                                   | All `__tests__` files above                              |

---

## Summary of New DB Shape

```sql
-- financial_services (additions)
is_settled   INTEGER  NOT NULL DEFAULT 1   -- 0 = pending, 1 = settled
settled_at   TEXT                          -- ISO timestamp of settlement
settlement_id INTEGER REFERENCES supplier_ledger(id)

-- supplier_ledger (entry_type extension)
entry_type  TEXT CHECK(entry_type IN ('TOP_UP','PAYMENT','ADJUSTMENT','SETTLEMENT'))
```

---

_End of plan. Ready for implementation upon approval._
