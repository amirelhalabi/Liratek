# Payment Method Fees Plan

## Non-Cash Payment Surcharge on OMT / WHISH SEND Transactions

**Date:** 2026-03-01  
**Status:** ✅ Phases 1–5 Complete  
**Analogy:** Same two-leg logic as cross-currency exchange (X → USD → Y), but here the "pivot" is not USD — it is the **payment method wallet** that the customer uses to fund the transaction instead of cash.

---

## 🔴 HIGH PRIORITY — Architectural Review Findings

> Reviewed: `create_db.sql`, all migrations (v9→v32), `FinancialServiceRepository.ts`, `payments.ts`, `omtFees.ts`, `whishFees.ts`, `Services/index.tsx`

### ✅ What Already Exists (Good News)

The system is **remarkably well-positioned** for this feature. Almost everything needed is already in place:

| Component                       | Status    | Details                                                                                                                                                                                                                                                   |
| ------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payment_methods` table         | ✅ Exists | Has `code`, `label`, `drawer_name`, `affects_drawer` — exactly what we need to identify non-cash methods and their target drawer                                                                                                                          |
| `drawer_balances` table         | ✅ Exists | `OMT_App`, `Whish_App`, `Binance`, `General`, `OMT_System`, `Whish_System` are all seeded and tracked                                                                                                                                                     |
| `payments` table                | ✅ Exists | Generic `method`, `drawer_name`, `amount` rows — already used for multi-leg accounting (RESERVE, COMMISSION, OMT entries). A `PM_FEE` method row fits naturally                                                                                           |
| `paymentMethodToDrawerName()`   | ✅ Exists | `packages/core/src/utils/payments.ts` — already DB-driven, looks up `drawer_name` from `payment_methods` table dynamically                                                                                                                                |
| `isDrawerAffectingMethod()`     | ✅ Exists | Already distinguishes CASH vs DEBT vs wallet methods                                                                                                                                                                                                      |
| Multi-payment support           | ✅ Exists | `CreateFinancialServiceData.payments[]` array already accepted; `MultiPaymentInput` component exists in frontend                                                                                                                                          |
| `includingFees` checkbox        | ✅ Exists | Already implemented in both frontend and backend for OMT/WHISH fee deduction                                                                                                                                                                              |
| Fee breakdown UI panel          | ✅ Exists | The grey breakdown box in `Services/index.tsx` (lines 669-730) already shows "Customer paid / fee / Sent to recipient" — we just extend it                                                                                                                |
| `profit_rate` field pattern     | ✅ Exists | `ONLINE_BROKERAGE` already uses a configurable per-transaction profit rate with a rate selector UI. Same pattern can be reused for PM fee rate                                                                                                            |
| `omt_fee` / `whish_fee` columns | ✅ Exists | Already stored per-transaction on `financial_services` — same pattern for `payment_method_fee`                                                                                                                                                            |
| Settlement tracking             | ✅ Exists | `is_settled`, `settled_at`, `settlement_id` columns on `financial_services` — PM fee profit is immediate (no settlement), so this stays clean                                                                                                             |
| Two-leg drawer logic            | ✅ Exists | The SEND flow in `FinancialServiceRepository.createTransaction()` already does: `Payment drawer +totalCollected → RESERVE General -totalCollected → System drawer +totalCollected`. The PM fee is a **modification** of this existing flow, not a new one |

### ✅ Critical Gaps — Resolution Status

| Gap                                          | Severity        | Status                                                                             |
| -------------------------------------------- | --------------- | ---------------------------------------------------------------------------------- |
| ** reserve for non-cash**                    | 🔴 BLOCKER      | ✅ **Fixed** — from wallet drawer instead of from General                          |
| **PM fee not extracted from system drawer**  | 🔴 BLOCKER      | ✅ **Fixed** — only transfers to system drawer; stays in wallet                    |
| ** columns missing**                         | 🔴 REQUIRED     | ✅ **Done** — Migration v33 added +                                                |
| ** missing**                                 | 🟡 NEEDED       | ✅ **Done** — ; DB-driven with fallback                                            |
| **Frontend PM fee input missing**            | 🟡 NEEDED       | ✅ **Done** — Dollar input, auto-filled at 1%, fully editable, violet-styled       |
| **Breakdown panel doesn't show PM fee**      | 🟡 NEEDED       | ✅ **Done** — PM fee line in both includingFees and normal modes                   |
| **includingFees max-amount ignores PM fee**  | 🟡 NEEDED       | ✅ **Done** — iterates tiers; single + multi both handled                          |
| **Split payment PM fee missing**             | 🟡 NEEDED       | ✅ **Done** — // props                                                             |
| **Infinite loop in MultiPaymentInput**       | 🔴 BUG          | ✅ **Fixed** — dep instead of object ref                                           |
| **Provider fee not in split payment total**  | 🔴 BUG          | ✅ **Fixed** — passed to MultiPaymentInput                                         |
| **Profits page has no PM fee visibility**    | 🟢 NICE TO HAVE | ✅ **Done** — "By Payment" tab shows PM_FEE rows violet, "Immediate Profit" status |
| **DEBT leg not inserted in **                | 🔴 BLOCKER      | ✅ **Done (Phase 4)**                                                              |
| **Client required when DEBT leg present**    | 🔴 BLOCKER      | ✅ **Done (Phase 4)**                                                              |
| **Eye button missing for Service Debt**      | 🔴 BUG          | ✅ **Done (Phase 4)**                                                              |
| **No payment breakdown in debt detail view** | 🟡 NEEDED       | ✅ **Done (Phase 4)**                                                              |

### 🔴 Most Critical Fix: The General Reserve Bug

This is the **core architectural issue** that must be resolved before anything else.

**Current behavior (wrong for non-cash):**

```
Customer pays $102 via WHISH Wallet for a $100 INTRA send:
  Whish_App:  +$102   ✅ (customer payment in)
  General:    -$101   ❌ BUG — General has no cash! Shop only has WHISH funds.
  OMT_System: +$101   ✅
```

**Correct behavior:**

```
  Whish_App:  +$102   ✅ (customer payment in)
  Whish_App:  -$101   ✅ (internal transfer: amount+omtFee goes to OMT_System)
  OMT_System: +$101   ✅ (OMT debt)
  Whish_App net: +$1  ✅ (PM fee profit stays in wallet)
  General:     0      ✅ (untouched — no cash involved)
```

**Root cause in code** (`FinancialServiceRepository.ts`, lines 581-611):

```typescript
// CURRENT — always reserves from General regardless of payment method:
if (isSystemProvider) {
  insertPayment.run(txnId, "RESERVE", "General", currency, -totalCollected, ...);
  upsertBalanceDelta.run("General", currency, -totalCollected);
}
```

**Fix required:** When `paidByMethod` is non-cash (OMT, WHISH, BINANCE):

- Skip the `General` RESERVE entry entirely
- Instead, insert a `TRANSFER` payment row from the payment method drawer to the system drawer: `Whish_App -( amount + omtFee )`
- The PM fee amount stays in `Whish_App` naturally (it was already credited in Leg 1 but only `amount+omtFee` is transferred out)

This fix is **independent of the PM fee feature** and should arguably be done first as a standalone correctness fix. The PM fee feature builds directly on top of it.

### 📊 Migration Version Gap

The migration registry in `index.ts` skips from v29 directly to v31, then v32. The `create_db.sql` marks v30 as `exchange_rates_universal_formula_schema` (in the seed INSERT at the bottom) but it's not defined in the MIGRATIONS array. Next migration should be **v33** for PM fee columns.

Also note: v31 and v32 are **out-of-order** in `index.ts` (v32 appears before v31 in the file). This doesn't affect correctness since migrations run by version number, but it should be cleaned up.

### 📋 Summary: Can We Implement This?

**Yes — and the foundation is strong.** The drawer system, payment methods table, payments ledger, multi-payment support, fee breakdown UI, and rate selector pattern are all already built.

The main work is:

1. Fix the `General` reserve routing for non-cash payments (critical correctness fix)
2. Add `payment_method_fee` + `payment_method_fee_rate` columns (migration v33)
3. Extend the SEND drawer logic to extract PM fee before the system drawer transfer
4. Add PM fee rate selector to the UI (reuse Online Brokerage pattern)
5. Extend the breakdown panel and `includingFees` calculation

**Estimated complexity: Medium** — most infrastructure is in place. No new tables, no new architecture. Pure extension of an existing well-structured flow.

---

---

## 1. Concept Summary

When a customer sends money via OMT or WHISH using a **non-cash payment method** (OMT Wallet, WHISH Wallet, Binance), the shop earns an additional **1% fee** (configurable) on top of its regular OMT/WHISH commission. This surcharge is the shop's profit for providing the intermediary wallet service.

### Real-World Flow (Example: Send $100 via INTRA using WHISH Wallet)

| Step | Actor             | Action                                                                      | Amount                                                      |
| ---- | ----------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1    | Customer          | Pays via WHISH Wallet                                                       | $100 + $1 (OMT fee) + $1 (1% payment method fee) = **$102** |
| 2    | Shop              | Credits customer's payment method fee to WHISH Wallet drawer                | +$102                                                       |
| 3    | Shop              | Internally transfers $101 (amount + OMT fee) from WHISH Wallet → OMT_System | -$101 WHISH Wallet, +$101 OMT_System                        |
| 4    | Shop keeps        | $1 payment method fee in WHISH Wallet drawer (immediate profit)             | stays in WHISH drawer                                       |
| 5    | At OMT settlement | OMT owes shop: $100 + OMT commission ($0.10)                                | pending                                                     |

**Net effect:**

- WHISH Wallet drawer: +$102 (customer payment) − $101 (internal transfer to OMT system) = **+$1 profit kept in WHISH drawer**
- OMT_System: +$101 (will be paid to OMT when settling)
- General drawer: **untouched** (no reserve needed — WHISH Wallet handles it)

---

## 2. Supported Payment Methods (Non-Cash)

Only **non-CASH, drawer-affecting** payment methods trigger the surcharge. These map from the `payment_methods` table (`is_system`, `drawer_name`):

| Method Code              | Drawer    | Triggers Surcharge           |
| ------------------------ | --------- | ---------------------------- |
| `CASH`                   | General   | ❌ No                        |
| `OMT` / `OMT_WALLET`     | OMT_App   | ✅ Yes                       |
| `WHISH` / `WHISH_WALLET` | Whish_App | ✅ Yes                       |
| `BINANCE`                | Binance   | ✅ Yes                       |
| `DEBT`                   | General   | ❌ No (not drawer-affecting) |

The list of surcharge-eligible methods is **dynamic** — any active payment method whose `drawer_name` is NOT `General` and `affects_drawer = 1` qualifies.

---

## 3. Fee Calculation

### 3.1 Default Rate

```
PAYMENT_METHOD_FEE_RATE = 0.01  // 1% — configurable per transaction in the UI
```

### 3.2 Formula (not including fees mode)

```
sentAmount            = amount entered by user
omtFee                = auto-looked-up or user-entered (e.g. $1 for INTRA $100)
paymentMethodFee      = sentAmount × paymentMethodFeeRate  (e.g. 1% × $100 = $1)
totalCustomerPays     = sentAmount + omtFee + paymentMethodFee
                      = $100 + $1 + $1 = $102

→ Customer's payment method drawer: +$102
→ Internal transfer to OMT_System:   $100 + $1 = $101  (amount + omtFee)
→ Shop keeps in payment method drawer: $1  (paymentMethodFee — immediate profit)
```

### 3.3 Formula (including fees mode — max amount calculation)

When the customer says "I have $100 in my WHISH wallet, send as much as possible":

```
totalBudget = $100  (customer's total in wallet)

We need to solve:
  totalBudget = sentAmount + omtFee(sentAmount) + paymentMethodFee(sentAmount)

Since omtFee is tiered (not linear), we solve by iterating brackets:
  For each INTRA tier, check: does sentAmount + tier.fee + sentAmount × rate ≤ totalBudget?

  Simplified for linear approximation:
  sentAmount ≈ (totalBudget − omtFee) / (1 + paymentMethodFeeRate)

Then verify with actual tiered fee lookup and adjust.
```

**Example ($100 budget, 1% PM fee, INTRA):**

```
Trying sentAmount = $98:
  omtFee($98) = $1 (tier ≤ $100)
  pmFee = $98 × 0.01 = $0.98
  total = $98 + $1 + $0.98 = $99.98 ✓ (fits in $100)

Trying sentAmount = $99:
  omtFee($99) = $1
  pmFee = $99 × 0.01 = $0.99
  total = $99 + $1 + $0.99 = $100.99 ✗ (exceeds $100)

→ Max sentAmount = $98, customer pays exactly $99.98
```

This logic mirrors the **existing `includingFees` calculation** but with an extra PM fee term.

---

## 4. Two-Leg Drawer Logic (The "Pivot" Analogy)

This is structurally identical to **cross-currency exchange passing through USD**, but:

- Instead of pivoting through a currency, we pivot through a **payment method wallet**.
- Leg 1: Customer → Payment Method Wallet (customer-facing transaction)
- Leg 2: Payment Method Wallet → OMT_System (internal shop transaction, stored as owed amount)

### Drawer Movements

#### Non-Cash Payment (e.g. WHISH Wallet)

```
Leg 1 (customer pays):
  WHISH_App drawer:  +(sentAmount + omtFee + pmFee)   [customer payment in]

Leg 2 (internal transfer to OMT system):
  WHISH_App drawer:  -(sentAmount + omtFee)           [shop moves funds to OMT]
  OMT_System drawer: +(sentAmount + omtFee)           [OMT owes this at settlement]

Net in WHISH_App: +pmFee  (shop's immediate profit)
Net in OMT_System: +(sentAmount + omtFee)  (pending settlement with OMT)
General: UNTOUCHED (no General reserve needed — wallet handles it)
```

#### Cash Payment (existing behavior — unchanged)

```
General drawer:  +(sentAmount + omtFee)   [customer cash in]
General drawer:  -(sentAmount + omtFee)   [reserve for OMT]
OMT_System:      +(sentAmount + omtFee)   [OMT debt]
Net General: 0
```

### Key Difference from Current Cash Flow

Currently, cash payment uses `General` as both inflow and reserve (net zero). With non-cash, the **payment method wallet** absorbs the inflow, and only `(sentAmount + omtFee)` moves to `OMT_System`. The shop retains `pmFee` in the wallet drawer immediately — it does **not** need to wait for OMT settlement.

---

## 5. Activity Log / Audit Trail

Two `payments` rows will be inserted per leg (inside the same DB transaction):

```
Leg 1 — Customer payment:
  payments row: { method: 'WHISH', drawer_name: 'Whish_App', amount: +(sentAmount + omtFee + pmFee) }

Leg 2 — Internal transfer to system:
  payments row: { method: 'RESERVE', drawer_name: 'Whish_App',  amount: -(sentAmount + omtFee) }
  payments row: { method: 'OMT',     drawer_name: 'OMT_System', amount: +(sentAmount + omtFee) }

PM Fee row (profit capture):
  payments row: { method: 'PM_FEE', drawer_name: 'Whish_App', amount: +pmFee, note: '1% payment method fee' }
```

This follows the **exact same pattern** as the existing `RESERVE` + system drawer entries in the SEND flow, extended with the PM fee leg.

The `financial_services` row stores two new fields:

- `payment_method_fee` REAL — the fee amount charged
- `payment_method_fee_rate` REAL — the rate used (for audit)

---

## 6. Schema Changes

### 6.1 `financial_services` table — 2 new columns

```sql
ALTER TABLE financial_services ADD COLUMN payment_method_fee REAL DEFAULT 0;
ALTER TABLE financial_services ADD COLUMN payment_method_fee_rate REAL DEFAULT 0;
```

Add to the migration in `packages/core/src/db/migrations/index.ts`.

### 6.2 No changes to `payment_methods` table

The existing `drawer_name` and `affects_drawer` columns are sufficient to determine eligibility and drawer routing.

---

## 7. Fee Rate Configuration (UI)

### 7.1 Per-Transaction Rate (in Services form)

Similar to how **Online Brokerage** lets the user pick a profit rate (0.1%–0.4%), the Services form will show a **payment method fee rate selector** when a non-cash method is chosen for SEND:

```
Payment Method Fee Rate:  [0.5%] [1% ✓ default] [1.5%] [2%]   (or custom input)
```

- Only visible when: `serviceType === 'SEND'` AND `paidByMethod !== 'CASH'` AND not multi-payment (or at least one non-cash leg)
- Default: 1%
- Range: 0.1% to 5% (configurable bounds)
- Shows live preview: "PM fee: $1.00 — Customer pays $102 total"

### 7.2 Global Default (Settings)

A global default PM fee rate can optionally be stored in `settings` table under key `payment_method_fee_rate_default`. The Services form reads this on load and pre-populates the rate field.

---

## 8. `includingFees` Checkbox Interaction

The existing `includingFees` checkbox now needs to account for the PM fee as a third component (in addition to sent amount + OMT fee):

### Currently (cash only):

```
includingFees = true:
  Customer paid: $101
  OMT fee: -$1
  Sent to recipient: $100
```

### New (non-cash, includingFees = true):

```
Customer paid via WHISH: $102
  PM fee (1%):   -$1.00   → shop keeps in WHISH drawer immediately
  OMT fee:       -$1.00   → goes to OMT_System
  Sent to recipient: $100.00
```

### Breakdown UI update

The existing fee breakdown box (the grey panel showing "Customer paid / OMT fee / Sent to recipient") must add a third line:

```
Customer paid:       $102.00
OMT fee:             -$1.00
PM fee (1%):         -$1.00
Sent to recipient:   $100.00
```

### Max-Amount Calculation (includingFees=true + non-cash)

```typescript
function calcMaxSentAmount(
  totalBudget: number,
  pmFeeRate: number,
  feeTable: FeeTier[],
): number {
  // Binary search or iterate tiers to find max sentAmount where:
  //   sentAmount + lookupFee(sentAmount) + sentAmount * pmFeeRate <= totalBudget
  for (const tier of feeTable) {
    const maxForTier = (totalBudget - tier.fee) / (1 + pmFeeRate);
    if (maxForTier <= tier.maxAmount && maxForTier > 0) {
      return Math.floor(maxForTier * 100) / 100; // floor to 2 decimals
    }
  }
  return 0;
}
```

---

## 9. Files to Modify

### Backend / Core

| File                                                           | Change                                                                                                                                             |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/db/migrations/index.ts`                     | Add migration: 2 new columns on `financial_services`                                                                                               |
| `packages/core/src/repositories/FinancialServiceRepository.ts` | Accept `paymentMethodFee` + `paymentMethodFeeRate` in `CreateFinancialServiceData`; insert 2-leg drawer movements when non-cash; store new columns |
| `packages/core/src/services/FinancialService.ts`               | Pass-through of new fields (minimal change)                                                                                                        |
| `packages/core/src/validators/financial.ts`                    | Add optional `paymentMethodFee` and `paymentMethodFeeRate` fields to validation schema                                                             |
| `packages/core/src/utils/payments.ts`                          | Add `isNonCashDrawerMethod(method)` helper — returns true if method is drawer-affecting AND not CASH/DEBT                                          |

### Frontend

| File                                                      | Change                                                                                                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `frontend/src/features/services/pages/Services/index.tsx` | Add `pmFeeRate` state (default 0.01); show rate selector when non-cash SEND; update breakdown panel; update `handleSubmit` to pass `paymentMethodFee` + `paymentMethodFeeRate` |
| `frontend/src/features/services/pages/Services/index.tsx` | Update `includingFees` max-amount calculation to include PM fee                                                                                                                |

### Electron / API

| File                                   | Change                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `electron-app/handlers/omtHandlers.ts` | Pass-through new fields (no logic change needed — thin wrapper)                  |
| `packages/ui/src/api/types.ts`         | Add `paymentMethodFee?` and `paymentMethodFeeRate?` to `AddOMTTransactionParams` |

---

## 10. Challenges & Edge Cases

### 10.1 Multi-Payment (Split Payment)

When the customer splits payment across methods (e.g. $50 CASH + $50 WHISH), the PM fee only applies to the **non-cash legs**:

```
WHISH leg: $50 → pmFee = $50 × 1% = $0.50
CASH leg:  $50 → pmFee = $0
Total pmFee = $0.50
```

Each non-cash leg independently triggers its own PM fee. The fee is charged proportionally and goes to the respective wallet drawer.

### 10.2 OMT Wallet Service Type vs. WHISH Wallet Payment Method

- `omtServiceType = 'OMT_WALLET'` means **the OMT transaction type is wallet-to-wallet** (zero OMT commission, no OMT fee)
- `paidByMethod = 'OMT'` or `'WHISH'` means the **payment funding method** is a wallet
  These are orthogonal: a customer can pay by WHISH wallet for an INTRA send. Both conditions are independently checked.

### 10.3 PM Fee on OMT Wallet (zero-fee) Transactions

Since OMT_WALLET has no OMT fee, the PM fee still applies to the sent amount:

```
Send $100 OMT_WALLET via WHISH_Wallet:
  pmFee = $100 × 1% = $1
  Customer pays: $101
  OMT_System: +$100 (no OMT fee, just amount)
  WHISH drawer: +$1 profit
```

### 10.4 RECEIVE Transactions

PM fees **do not apply** to RECEIVE transactions. The customer is receiving cash — the shop pays them out from its drawers. No payment method surcharge is relevant.

### 10.5 Settlement Impact

The PM fee profit is **immediately realized** (no pending settlement needed) because it stays in the payment method's own drawer. The existing OMT/WHISH commission settlement flow is **unchanged**. The `financial_services.is_settled` flag logic stays the same.

### 10.6 Profits Page

The PM fee profit is captured as an immediate drawer movement (`PM_FEE` payment row). It should appear in the profits breakdown either:

- As part of the payment method drawer's balance (already reflected via `drawer_balances`), or
- As a separate line in the "By Payment Method" tab on the Profits page (preferred for clarity).

Filter: `payments.method = 'PM_FEE'` to isolate PM fee income.

---

## 11. Implementation Order

1. **Migration** — add 2 columns to `financial_services`
2. **`payments.ts` util** — add `isNonCashDrawerMethod()` helper
3. **`FinancialServiceRepository`** — two-leg drawer logic + store new columns
4. **Validator** — extend `CreateFinancialServiceData` type
5. **Frontend Services UI** — PM fee rate selector, breakdown panel update, `includingFees` max-amount logic
6. **API types** — add new optional fields
7. **Test** — unit tests for new drawer logic and max-amount calculation
8. **Profits page** — optionally add `PM_FEE` row filtering to "By Payment Method" tab

---

---

## 🔴 PHASE 4 — Split Payment Debt + Transaction Detail (High Priority)

> This phase addresses the following confirmed bugs/gaps found during testing:
>
> 1. Debt leg of a split payment doesn't enforce client name requirement correctly
> 2. Debt entries from split-payment OMT/WHISH SEND don't appear in Debts ledger
> 3. Eye button (👁) on debt entries for `Service Debt` shows nothing — only `Sale Debt` is wired
> 4. No full payment breakdown (cash $50 + WHISH $49.5 + $0.5 fee + debt $1.5) stored or visible anywhere

---

### 4.1 The Problem in Full Detail

**Scenario:** Customer sends $100 INTRA (+ $1 OMT fee). Pays via:

- Cash: $50
- WHISH Wallet: $49.50 + $0.50 PM fee
- Debt: $1.50

**Current system failures:**

| Failure                                           | Root Cause                                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transaction saved without client name             | `MultiPaymentInput` warns but doesn't block submission when DEBT leg exists without `hasClient=true` effectively enforced at `handleSubmit` level       |
| Debt entry never created in `debt_ledger`         | `FinancialServiceRepository.createTransaction()` has no DEBT leg handling for multi-payment — it only processes drawer-affecting methods and skips DEBT |
| Eye button (👁) doesn't work on Service Debt rows | `loadSaleDetails()` in `Debts/index.tsx` only handles `source_table = 'sales'` — Service Debt entries point to `financial_services`, not `sales`        |
| No payment breakdown visible anywhere             | The `payments` table rows exist per-leg, but no UI reads them back for a given `transaction_id`                                                         |

---

### 4.2 Required Changes

#### A. `FinancialServiceRepository` — Handle DEBT leg in multi-payment SEND

When any payment line has `method === 'DEBT'`, after recording all drawer movements:

```typescript
// For each DEBT leg in multi-payment:
const debtLegs = data.payments.filter((p) => p.method === "DEBT");
for (const debtLeg of debtLegs) {
  // 1. Insert into debt_ledger
  insertDebtLedger.run({
    client_id: data.clientId, // REQUIRED — must be validated before here
    transaction_type: "Service Debt",
    amount_usd: debtLeg.amount,
    amount_lbp: 0,
    note: `Service debt — ${data.provider} ${data.serviceType} $${data.amount}`,
    created_by: data.userId,
    transaction_id: txnId, // link to the unified transaction
  });
}
```

This mirrors exactly what `SalesRepository` does when a sale has a DEBT payment leg.

#### B. `FinancialServiceRepository` — Require `clientId` when DEBT leg present

```typescript
const hasDebtLeg = data.payments?.some((p) => p.method === "DEBT");
if (hasDebtLeg && !data.clientId) {
  throw new ValidationError("Client is required when paying by debt");
}
```

#### C. `Services/index.tsx` — Enforce client name before submit

In `handleSubmit`, before calling `api.addOMTTransaction`:

```typescript
const hasDebtLeg =
  useMultiPayment && paymentLines.some((p) => p.method === "DEBT");
if (hasDebtLeg && !clientName.trim()) {
  alert("Client name is required for debt payments.");
  return;
}
```

#### D. `Debts/index.tsx` — Wire eye button for Service Debt

Currently `loadSaleDetails()` only handles `source_table = 'sales'`. Add a new handler:

```typescript
const loadServiceDebtDetails = async (transactionId: number) => {
  // 1. Get the unified transaction
  const txn = await api.getTransactionById(transactionId);
  // 2. If source_table = 'financial_services', load the FS record
  if (txn.source_table === "financial_services") {
    const fs = await api.getFinancialServiceById(txn.source_id);
    // 3. Also load payments rows linked to this transaction_id
    const payments = await api.getPaymentsByTransactionId(txn.id);
    setSelectedServiceDetail({ fs, payments });
    setShowServiceDetails(true);
  }
};
```

Show a modal with:

- Provider + service type + amount + OMT fee
- Payment breakdown table (method, amount, PM fee if any)
- Debt amount highlighted

#### E. New API endpoint: `getPaymentsByTransactionId`

```typescript
// In TransactionRepository or PaymentRepository:
getPaymentsByTransactionId(transactionId: number): PaymentRow[]
// SELECT method, drawer_name, currency_code, amount, note FROM payments WHERE transaction_id = ?
```

This powers the eye button detail view for ALL transaction types (not just sales).

#### F. `getFinancialServiceById` API

```typescript
// Already exists in FinancialServiceRepository as findById()
// Just needs to be exposed via electron handler + API adapter
```

---

### 4.3 Data Flow (Correct End-to-End)

```
Customer: Send $100 INTRA
Payment split: Cash $50 + WHISH $49.50 (+$0.50 PM fee) + Debt $1.50

handleSubmit():
  → validate: clientName required (DEBT leg present) ✓
  → api.addOMTTransaction({
      amount: 100,
      provider: 'OMT',
      serviceType: 'SEND',
      omtServiceType: 'INTRA',
      clientId: 123,
      clientName: 'John Doe',
      payments: [
        { method: 'CASH',  amount: 50,    currencyCode: 'USD' },
        { method: 'WHISH', amount: 50,    currencyCode: 'USD' },  // 49.5 + 0.5 PM fee baked in
        { method: 'DEBT',  amount: 1.5,   currencyCode: 'USD' },
      ],
      paymentMethodFee: 0.50,
      paymentMethodFeeRate: 0.01,
    })

FinancialServiceRepository.createTransaction():
  DB transaction {
    INSERT financial_services → id=42
    INSERT transactions → id=99 (source_table='financial_services', source_id=42)

    // CASH leg:
    INSERT payments (txn=99, method=CASH, drawer=General, +50)
    UPDATE drawer_balances General +50

    // WHISH leg:
    INSERT payments (txn=99, method=WHISH, drawer=Whish_App, +50)   ← includes PM fee
    UPDATE drawer_balances Whish_App +50
    INSERT payments (txn=99, method=PM_FEE, drawer=Whish_App, +0.5) ← audit row
    INSERT payments (txn=99, method=TRANSFER, drawer=Whish_App, -49.5) ← to OMT_System
    UPDATE drawer_balances Whish_App -49.5

    // System drawer:
    INSERT payments (txn=99, method=OMT, drawer=OMT_System, +101)
    UPDATE drawer_balances OMT_System +101

    // CASH reserve:
    INSERT payments (txn=99, method=RESERVE, drawer=General, -50)
    UPDATE drawer_balances General -50

    // DEBT leg:
    INSERT debt_ledger (client_id=123, txn_id=99, type='Service Debt', amount_usd=1.5)
    UPDATE transactions SET client_id=123
  }
```

---

### 4.4 Eye Button Detail Modal (New Component: `ServiceDebtDetailModal`)

```
┌─────────────────────────────────────────────────────┐
│  OMT SEND — INTRA                           [×]     │
├─────────────────────────────────────────────────────┤
│  Send Amount:    $100.00                            │
│  OMT Fee:        $1.00                              │
│  Total Charged:  $101.00                            │
├─────────────────────────────────────────────────────┤
│  Payment Breakdown                                  │
│  ──────────────────────────────────────────────     │
│  Cash              $50.00                           │
│  WHISH Wallet      $49.50  + PM fee $0.50           │
│  Debt (John Doe)   $1.50   ← red highlight          │
│  ──────────────────────────────────────────────     │
│  Total Paid:       $101.00  (+$0.50 shop profit)    │
└─────────────────────────────────────────────────────┘
```

---

### 4.5 Universal Eye Button Pattern (All Pages with DEBT + Split)

The same pattern applies to:

- POS (`Sale Debt` → already works via `loadSaleDetails`)
- Services (`Service Debt` → needs `loadServiceDebtDetails` — this phase)
- Custom Services (`Custom Service Debt` → same pattern)
- Recharge (`Recharge Debt` → same pattern)

**Unified approach:** Create a generic `getTransactionDetail(transactionId)` API that:

1. Fetches the unified transaction
2. Fetches all `payments` rows for that transaction
3. Fetches the source record (sale / financial_service / custom_service / recharge)
4. Returns a `TransactionDetail` object

This can be reused across all debt entry eye buttons, eliminating the per-type special casing.

---

### 4.6 Implementation Order (Phase 4)

1. **`FinancialServiceRepository`** — add DEBT leg insertion into `debt_ledger`
2. **`FinancialServiceRepository`** — add `clientId` required validation when DEBT leg present
3. **`Services/index.tsx`** — enforce client name before submit when DEBT leg in `paymentLines`
4. **New API** — `getPaymentsByTransactionId(txnId)` in TransactionRepository + expose via handlers
5. **New API** — expose `getFinancialServiceById` via handlers + adapter
6. **`Debts/index.tsx`** — add eye button handler for `Service Debt` type
7. **`ServiceDebtDetailModal`** — new component showing full payment breakdown
8. **Generalize** — refactor toward `getTransactionDetail()` for universal debt detail support

---

---

## 🔴 PHASE 5 — Debt Repayment Routing & Profit Share Accuracy

> Added: 2026-03-02. Covers correct drawer routing when settling debts, and accurate profit share attribution in the By Payment tab.

### 5.1 The Problem

When a client repays a `Service Debt` (e.g. OMT SEND), the cash they hand over must route to `OMT_System` (not stay in `General`). Otherwise the drawer balance is wrong — General inflates while OMT_System stays underfunded.

Similarly, the "By Payment" tab in Profits was showing CASH debt repayments as having a share % — but a debt repayment is a pass-through (no profit generated), so it should show `No Profit` + `0%`.

### 5.2 Drawer Routing Rules (by debt type)

| Debt Type                   | Repayment Goes To                                        | Logic                                                     |
| --------------------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| `Service Debt` (OMT SEND)   | `General` +inflow → RESERVE out → `OMT_System` +credit   | Cash in, immediately reserved for OMT settlement          |
| `Service Debt` (WHISH SEND) | `General` +inflow → RESERVE out → `Whish_System` +credit | Same pattern for WHISH                                    |
| `Sale Debt`                 | `General` +inflow (stays)                                | No system drawer — sale profit recognized on full payment |
| `Recharge Debt`             | `General` +inflow (stays)                                | Recharge was pre-paid from General                        |

### 5.3 Share % Calculation — Key Thinking

**Current (wrong):** Share = method.total_usd / sum(all methods). Treats debt repayment CASH the same as a profitable CASH sale.

**Correct principle:** Share only counts **profit-generating** payment legs:

- ✅ CASH/WHISH/OMT used for a sale, recharge, custom service, maintenance → counts
- ✅ CASH/WHISH paid for OMT SEND directly → counts (revenue generated)
- ❌ CASH for debt repayment → excluded (no profit, pass-through)
- ❌ PM_FEE rows → excluded from share (shown separately as Immediate Profit)
- ❌ Commission rows → excluded from share (shown as Settled/Pending)

**Future cases to think about:**

- Partial debt repayment on a sale: CASH portion counts as revenue, share should count it
- Mixed method payment (CASH $50 + DEBT $50): CASH $50 counts, DEBT $0 counts (no profit yet)
- When a sale debt is repaid later: should that CASH repayment now count toward share? Arguably yes — it's when profit is realized. Needs a `is_sale_debt_repayment` flag separate from `is_service_debt_repayment`.

### 5.4 Status Labels in By Payment Tab

| Row Type                | Status           | Share  |
| ----------------------- | ---------------- | ------ |
| Regular CASH/WHISH sale | —                | Shown  |
| PM_FEE                  | Immediate Profit | Hidden |
| Commission (Settled)    | Settled          | Hidden |
| Commission (Pending)    | Profit Pending   | Hidden |
| Debt repayment (any)    | No Profit        | 0%     |

---

## 12. Open Questions

1. Should the PM fee rate be **per payment method** (e.g. WHISH charges different than Binance) or a single global rate applied to all non-cash methods? _Proposal: single rate per transaction, configurable with a global default._
2. Should multi-payment split the PM fee **proportionally per non-cash leg** or apply a flat rate to the **total non-cash portion**? _Proposal: flat rate on total non-cash amount — simpler and equivalent._
3. Should the PM fee appear as a separate `financial_services` row (like the exchange second leg) or as extra columns on the existing row? _Proposal: extra columns + dedicated `payments` rows — avoids creating ghost transactions in the history table._
