# Bug: Client Balance Not Reduced After Katsh DEBT Payment

## The Problem

When a customer with a pre-loaded credit balance pays for a Katsh service using the
"Customer Account" payment method, the transaction is recorded correctly in the
transactions table, but the client's credit balance **appears unchanged** in the Debts page.

---

## What I've Confirmed

### 1. Payment method code used is "DEBT"
Migration v9 seeded `DEBT` into `payment_methods` without specifying `is_active`, so it
inherited the column default of `1`. Migration v76 renamed its label from "Debt (On Tab)"
to "Customer Account" but **never changed** `is_active`. Result in existing databases:

| code             | label            | is_active | affects_drawer |
|------------------|------------------|-----------|----------------|
| DEBT             | Customer Account | 1         | 0              |
| CUSTOMER_ACCOUNT | Customer Account | 0         | 0              |

So the "Customer Account" button in the payment dropdown sends code `"DEBT"` to the backend.
That is consistent with the UI warning the user saw: *"Client is required when using DEBT
payment method"* — `MultiPaymentInput` checks `line.method === "DEBT"`.

---

### 2. Two bugs were already fixed in this session

**Fix A (UI warning):** `KatchForm` passed `PaymentSheet` without `hasClient`, so
`MultiPaymentInput` always showed the "Client is required" warning even after a client was
selected. Fixed by passing `hasClient={!!clientName}`.

**Fix B (submission error):** `KatchForm` stored the client name but not the client ID.
When the user selected a client from the autocomplete dropdown, `clientId` was never
captured. The backend validator (`createFinancialServiceSchema`) and the repository both
throw if `paidByMethod === "DEBT"` and `clientId` is absent. Fixed by adding a `clientId`
state in `KatchForm` and wiring `onClientSelect={(c) => setClientId(c.id)}` on the
`ClientAutocompleteInput`.

After Fix B, the user confirmed: **"ok now it worked"** — the transactions are now visible
in the transactions table (`financial_services #1` 355,000 LBP and `#2` 500,000 LBP).

---

### 3. The `debt_ledger` entry IS being created (post-fix)

Because the transactions committed successfully (they appear in the txn table), and the
`debt_ledger` INSERT is inside the same `db.transaction()` wrapper, the entries **must**
exist. If the INSERT had failed, the entire transaction would have rolled back and the
`financial_services` rows would not be there.

The repository path for `useCostPriceFlow` (Katsh has `cost > 0`) + single DEBT payment:

```typescript
// FinancialServiceRepository.ts ~line 615
if (paidBy === "DEBT") {
  // clientId is now present → no throw
  db.prepare(`INSERT INTO debt_ledger (...) VALUES (...)`)
    .run(clientId, "Service Debt", 0, price_lbp, txnId, note, createdBy);
}
```

This inserts a **positive** LBP amount. Since credits are stored as negative amounts
(`CREDIT_DEPOSIT` → `-1,000,000 LBP`), adding a positive entry reduces the credit:

```
Before:  SUM(amount_lbp) = -1,000,000
After:   SUM(amount_lbp) = -1,000,000 + 355,000 + 500,000 = -145,000
```

The balance calculation is correct.

---

### 4. The root cause of "balance not reduced" is stale data

The Debts page calls `loadDebtors()` **once on mount**. This populates the left-panel
client list with `total_debt_usd` and `total_debt_lbp` snapshot values.

When a DEBT transaction is made from the **Recharge page**, the Debts page is never
notified. The left-panel list keeps showing the old credit balance.

**When the user clicks the client in the left panel**, `loadHistory(clientId)` and
`loadClientTotal(clientId)` are called fresh. The right panel then computes:

```
netLbp = debtTotals.lbp - paymentTotals.lbp
       = 855,000 - 1,000,000
       = -145,000  →  shows "145,000 LBP" credit remaining
```

So the right panel IS correct after clicking the client — the user just doesn't know
they need to click to refresh.

---

### 5. Secondary UX issue: "Service Debt" label is confusing

The `debt_ledger` entry created for a DEBT payment has `transaction_type = "Service Debt"`.
In the Debts page history, this row appears **red** (same color as regular unpaid debts),
which makes it look like the client incurred a new obligation rather than paid from their
balance. The entry is correct mathematically but semantically confusing.

The `DebtRepository.useCreditForPurchase` method uses `transaction_type = "CREDIT_USED"`,
which the UI renders in orange and labels "Credit Used". Using "CREDIT_USED" for DEBT
payments from a financial service would make the history much clearer.

---

## What Needs to Be Done (Fix Plan)

### Fix 1 — Refresh debtors list after DEBT transaction (UX / data freshness)
After a successful Katsh (or any financial service) DEBT transaction, the Debts page
left-panel list should reflect the updated balance.

Options:
- **A. Custom DOM event:** fire a `"debt-ledger-changed"` event after any DEBT transaction
  succeeds; the Debts page subscribes to that event and calls `loadDebtors()`.
- **B. Polling / refetch on focus:** the Debts page re-fetches when the window regains
  focus.
- **C. Accept the stale state:** document that the user must click the client to see
  the updated balance (minimum viable — no code change, just UX awareness).

Option A is the cleanest.

### Fix 2 — Use `CREDIT_USED` transaction type instead of `Service Debt` for DEBT payments
In `FinancialServiceRepository.ts`, change the cost/price flow DEBT insert (single payment
~line 620, multi-payment ~line 591) from `"Service Debt"` to `"CREDIT_USED"`:

```typescript
// Single payment path
if (paidBy === "DEBT") {
  db.prepare(`INSERT INTO debt_ledger (...) VALUES (...)`)
    .run(clientId, "CREDIT_USED", ...);  // was "Service Debt"
}

// Multi-payment path (hasDebt block ~line 591)
if (hasDebt) {
  db.prepare(`INSERT INTO debt_ledger (...) VALUES (...)`)
    .run(clientId, "CREDIT_USED", ...);  // was "Service Debt"
}
```

Also add `"CREDIT_USED"` to the Debts page's `PAYMENT_TYPES` set or keep it in the
debt/purchase section — **verify which section makes more sense** for the user flow.

Currently `PAYMENT_TYPES = new Set(["Repayment", "CREDIT_DEPOSIT"])` so `CREDIT_USED`
entries go into `debtEntries` (purchases/charges side). That is correct — they represent
spending against the balance, not a deposit.

---

## Still Needs Verification

1. **Confirm `debt_ledger` rows exist** for `financial_services #1` and `#2` — run a quick
   DB query: `SELECT * FROM debt_ledger WHERE transaction_id IN (<txnId1>, <txnId2>)`.

2. **Confirm the Debts page shows the correct balance after clicking the client** — if it
   does, then Fix 1 (refresh) is all that's needed. If it doesn't, there's a deeper issue.

3. **The `filteredDebtors` "ongoing" filter** uses `Math.abs(d.total_debt_usd) > 0.01`.
   If a future client has ONLY LBP credits (no USD), they would be hidden from the
   "ongoing" view even with a non-zero balance. Should add a LBP component to this check.

---

## Files Involved

| File | Relevance |
|------|-----------|
| `frontend/src/features/recharge/components/KatchForm.tsx` | Fixed A + B |
| `packages/core/src/repositories/FinancialServiceRepository.ts` | DEBT ledger insert (Fix 2) |
| `frontend/src/features/debts/pages/Debts/index.tsx` | Stale data (Fix 1), filteredDebtors |
| `packages/core/src/db/migrations/index.ts` | v76 renamed DEBT → "Customer Account" |
| `electron-app/create_db.sql` | DEBT is_active=0 (discrepancy with migration path) |
