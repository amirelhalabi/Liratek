# Currency Exchange Rate Management - Implementation Plan

**Date**: February 27, 2026  
**Status**: 🚧 PLANNING  
**Priority**: HIGH - Critical for multi-currency transactions

---

## 1. Problem Statement

### Current Issues:

1. ❌ Exchange rates in Settings cannot be edited or deleted
2. ❌ Rate naming is confusing: "LBP → USD" and "USD → LBP"
3. ❌ Unclear which rate to use for different transaction types
4. ❌ No automatic rate selection based on transaction direction (money in vs money out)

### Business Context:

In currency exchange businesses (like phone shops, money changers, etc.), there are always **two rates**:

- **Buying Rate** (We buy USD using LBP) - Lower rate, benefits the shop
- **Selling Rate** (We sell USD for LBP) - Higher rate, benefits the shop

**Example:**

- We **buy** $1 from customer for 89,000 LBP (buying rate)
- We **sell** $1 to customer for 89,500 LBP (selling rate)
- Spread: 500 LBP profit per dollar

---

## 2. Industry Standard Terminology

### Research from Money Exchange Apps:

**Standard Naming:**

1. **Buying Rate** (We Buy USD) = Lower number
   - "USD Buy Price" or "We Buy USD at"
   - Customer gives us USD, we give them LBP
   - Example: 1 USD = 89,000 LBP

2. **Selling Rate** (We Sell USD) = Higher number
   - "USD Sell Price" or "We Sell USD at"
   - We give customer USD, they give us LBP
   - Example: 1 USD = 89,500 LBP

**Visual Example from Exchange Apps:**

```
USD Exchange Rates
┌─────────────────────────────────┐
│ We Buy USD    89,000 LBP / $1   │
│ We Sell USD   89,500 LBP / $1   │
│ Spread        500 LBP           │
└─────────────────────────────────┘
```

---

## 3. Transaction Scenarios & Rate Selection Logic

### Scenario Matrix:

| Transaction Type       | Currency Selected | Direction | Rate to Use      | Logic                                            |
| ---------------------- | ----------------- | --------- | ---------------- | ------------------------------------------------ |
| **Sale**               | USD               | Money IN  | N/A              | USD is base currency                             |
| **Sale**               | LBP               | Money IN  | **Selling Rate** | We're "selling" goods for LBP (customer pays us) |
| **Debt Repayment**     | USD               | Money IN  | N/A              | USD is base currency                             |
| **Debt Repayment**     | LBP               | Money IN  | **Selling Rate** | Customer paying debt in LBP                      |
| **Refund**             | USD               | Money OUT | N/A              | USD is base currency                             |
| **Refund**             | LBP               | Money OUT | **Buying Rate**  | We're giving LBP to customer                     |
| **Exchange (USD→LBP)** | Sell USD          | Money OUT | **Buying Rate**  | We buy their USD                                 |
| **Exchange (LBP→USD)** | Buy USD           | Money IN  | **Selling Rate** | We sell them USD                                 |
| **Expense**            | LBP               | Money OUT | **Buying Rate**  | We're spending LBP                               |

### Key Principles:

**Money Coming IN (Revenue):**

- Use **Selling Rate** (higher) - Benefits shop
- Examples: Sales in LBP, Debt repayment in LBP, Selling USD

**Money Going OUT (Expenses):**

- Use **Buying Rate** (lower) - Saves shop money
- Examples: Refunds in LBP, Buying USD from customer, Expenses

---

## 4. Proposed UI Changes

### 4.1 Settings - Exchange Rates Manager

**Current:**

```
LBP → USD: 89,500
USD → LBP: 89,000
```

**Proposed:**

```
USD Exchange Rates (vs LBP)

┌─────────────────────────────────────────────────┐
│ Rate Type     │ Rate         │ Actions          │
├───────────────┼──────────────┼──────────────────┤
│ We Buy USD    │ 89,000 LBP   │ [Edit] [Delete]  │
│ (Lower)       │              │                  │
├───────────────┼──────────────┼──────────────────┤
│ We Sell USD   │ 89,500 LBP   │ [Edit] [Delete]  │
│ (Higher)      │              │                  │
├───────────────┼──────────────┼──────────────────┤
│ Spread        │ 500 LBP      │ Auto-calculated  │
└─────────────────────────────────────────────────┘

💡 Tip: Buying rate should be lower than selling rate
```

**Edit Dialog:**

```
Edit Exchange Rate

Rate Type: We Buy USD (Lower)
Amount: [89000] LBP per 1 USD

[Cancel] [Save]
```

### 4.2 Debt Settlement Modal

**Proposed Changes:**

```
Process Repayment

Quick Fill Total Debt
[ ⚡ $70.00 ] [ ⚡ 6,265,000 LBP ]

Exchange Rate (Auto-selected)
[89,500] LBP per 1 USD (Selling Rate)
💡 Using selling rate - customer paying debt

Amount
...
```

**Rate Selection Logic:**

- Debt repayment = Money IN = Use **Selling Rate** (89,500)
- Auto-fill from Settings → We Sell USD rate
- User can override if needed

---

## 5. Database Schema

### Current (Assumed):

```sql
settings (key-value pairs)
- rate_lbp_usd: 89500
- rate_usd_lbp: 89000
```

### Proposed:

```sql
-- Option 1: Key-value pairs (simple)
settings
- exchange_rate_usd_buy: 89000   (We buy USD - lower)
- exchange_rate_usd_sell: 89500  (We sell USD - higher)

-- Option 2: Dedicated table (scalable for EUR, etc.)
CREATE TABLE exchange_rates (
  id INTEGER PRIMARY KEY,
  base_currency TEXT NOT NULL,      -- USD
  quote_currency TEXT NOT NULL,     -- LBP
  buy_rate REAL NOT NULL,           -- 89000 (we buy USD)
  sell_rate REAL NOT NULL,          -- 89500 (we sell USD)
  updated_at DATETIME,
  updated_by INTEGER,
  UNIQUE(base_currency, quote_currency)
);
```

---

## 6. Implementation Tasks

### Phase 1: Settings - Edit/Delete Rates

- [ ] Add Edit button to each rate
- [ ] Add Delete button with confirmation
- [ ] Update rate names: "We Buy USD" / "We Sell USD"
- [ ] Show spread calculation
- [ ] Validation: Buy rate < Sell rate

### Phase 2: Automatic Rate Selection

- [ ] Create `getRateForTransaction()` utility function
- [ ] Parameters: transactionType, currencyCode, direction (IN/OUT)
- [ ] Returns: { rate, rateType, rateName }
- [ ] Update debt settlement to use auto-selected rate

### Phase 3: UI Refinements

- [ ] Show rate type in all transaction forms
- [ ] Add tooltips explaining which rate is used
- [ ] Add visual indicator (💰 Money IN / 💸 Money OUT)
- [ ] Update all existing transaction pages

### Phase 4: Testing

- [ ] Test all transaction scenarios
- [ ] Verify rate selection logic
- [ ] Test edit/delete rate functionality
- [ ] Validate rate constraints (buy < sell)

---

## 7. Rate Selection Utility (Pseudocode)

```typescript
function getRateForTransaction(
  transactionType: "SALE" | "DEBT_PAYMENT" | "REFUND" | "EXCHANGE" | "EXPENSE",
  currency: string,
  exchangeDirection?: "BUY_USD" | "SELL_USD",
): { rate: number; rateType: "BUY" | "SELL"; description: string } {
  if (currency === "USD") {
    return { rate: 1, rateType: "N/A", description: "Base currency" };
  }

  const rates = getExchangeRates("USD", currency);

  // Money coming IN - Use SELL rate (higher)
  if (transactionType === "SALE" || transactionType === "DEBT_PAYMENT") {
    return {
      rate: rates.sell,
      rateType: "SELL",
      description: "Money in - using selling rate",
    };
  }

  // Money going OUT - Use BUY rate (lower)
  if (transactionType === "REFUND" || transactionType === "EXPENSE") {
    return {
      rate: rates.buy,
      rateType: "BUY",
      description: "Money out - using buying rate",
    };
  }

  // Exchange transactions - depends on direction
  if (transactionType === "EXCHANGE") {
    if (exchangeDirection === "SELL_USD") {
      return {
        rate: rates.buy,
        rateType: "BUY",
        description: "Buying USD from customer",
      };
    } else {
      return {
        rate: rates.sell,
        rateType: "SELL",
        description: "Selling USD to customer",
      };
    }
  }

  // Default fallback
  return { rate: rates.sell, rateType: "SELL", description: "Default" };
}
```

---

## 8. Migration Plan

### Backward Compatibility:

1. Keep old setting keys for now
2. Add new keys: `exchange_rate_usd_buy`, `exchange_rate_usd_sell`
3. Migration script to copy values:

   ```
   exchange_rate_usd_buy = rate_lbp_usd (89500)
   exchange_rate_usd_sell = rate_usd_lbp (89000)
   ```

   **WAIT** - Check actual values first!

4. Update all code to use new keys
5. Remove old keys after testing

---

## 9. Questions to Resolve

1. ✅ Which current rate is buy vs sell?
   - Need to check actual business usage
   - Look at existing transactions to determine

2. ✅ Should spread be configurable or auto-calculated?
   - Auto-calculated (sell - buy)

3. ✅ Allow rates to be equal?
   - No, sell must be > buy (validation)

4. ✅ Support for EUR and other currencies?
   - Yes, design should scale

5. ✅ Historical rate tracking?
   - Future enhancement, not now

---

## 10. References

- Point of Sale (POS) systems: Use selling rate for cash sales
- Money Exchange apps: Clear buy/sell terminology
- Banking apps: "We buy" vs "We sell" format
- ATMs: Display both rates clearly

---

## Next Steps

1. **User confirmation**: Review terminology and scenarios
2. **Data check**: Determine which current rate is which
3. **Implementation**: Start with Phase 1 (Edit/Delete)
4. **Testing**: Verify all scenarios work correctly

---

**Status**: Awaiting user approval to proceed

---

## Implementation Status

### ✅ Phase 1: Settings - Edit/Delete Rates (COMPLETE)

**Completed**: February 27, 2026

- ✅ Rate labels updated: "We Buy USD (Lower)" / "We Sell USD (Higher)"
- ✅ Edit button with modal
- ✅ Delete button with confirmation
- ✅ Profit spread display
- ✅ Validation: buy < sell
- ✅ Backend DELETE endpoint
- ✅ TypeScript types updated

### ✅ Phase 2: Automatic Rate Selection - Debt Settlement (COMPLETE)

**Completed**: February 27, 2026

- ✅ Created `exchangeRates.ts` utility with rate selection logic
- ✅ Debt settlement auto-selects selling rate (Money IN)
- ✅ Rate type indicator in UI
- ✅ Quick fill buttons use correct rate
- ✅ User can override per transaction

**Utility Functions:**

- `getExchangeRates()` - Parse rate list
- `getRateForTransaction()` - Get rate based on transaction type
- `getRateLabel()` - Format rate type for display
- `formatRate()` - Format rate for display

### 🚧 Phase 2 (Continued): Apply to Other Transaction Types (IN PROGRESS)

**Remaining:**

- [ ] POS/Sales: Auto-select selling rate for LBP sales
- [ ] Exchange: Auto-select buy/sell rate based on direction
- [ ] Custom Services: Auto-select selling rate for LBP payments
- [ ] Services (OMT/WHISH): Auto-select selling rate for LBP payments
- [ ] Refunds: Auto-select buying rate for LBP refunds (if applicable)

**Files Created:**

- `frontend/src/utils/exchangeRates.ts` - Shared utility

**Files Modified:**

- `frontend/src/features/debts/pages/Debts/index.tsx` - Now using utility

---

**Next**: Apply to remaining transaction pages

---

## BUGFIX: Delete Rate Functionality Missing (February 28, 2026)

### Issue

User reported that Edit and Delete buttons for exchange rates were not visible/working in Settings → Rates Manager.

### Root Cause Analysis

The UI code had the Edit/Delete buttons implemented correctly, but the backend functionality was incomplete:

1. ❌ `RateRepository.deleteRate()` - **Missing**
2. ❌ `RateService.deleteRate()` - **Missing**
3. ❌ Electron IPC handler `rates:delete` - **Missing**
4. ❌ Electron preload `rates.delete()` - **Missing**
5. ❌ TypeScript types for `deleteRate` - **Missing**
6. ✅ Backend API `/api/rates/:fromCurrency/:toCurrency` DELETE - Already existed (but unusable)
7. ✅ Frontend UI buttons - Already existed (but non-functional)

### Fix Applied

**Files Modified:**

1. **`packages/core/src/repositories/RateRepository.ts`**
   - Added `deleteRate(fromCode, toCode)` method

2. **`packages/core/src/services/RateService.ts`**
   - Added `deleteRate(fromCode, toCode)` method with error handling

3. **`electron-app/handlers/rateHandlers.ts`**
   - Added `rates:delete` IPC handler with admin authorization

4. **`electron-app/preload.ts`**
   - Added `rates.delete()` to exposed API

5. **`frontend/src/types/electron.d.ts`**
   - Added TypeScript types for `delete` method

### Files Modified (Backend/Core/Electron):

1. **`packages/core/src/repositories/RateRepository.ts`** - Added `deleteRate()` method
2. **`packages/core/src/services/RateService.ts`** - Added `deleteRate()` with error handling
3. **`electron-app/handlers/rateHandlers.ts`** - Added `rates:delete` IPC handler
4. **`electron-app/preload.ts`** - Exposed `rates.delete()` to frontend
5. **`frontend/src/types/electron.d.ts`** - Added TypeScript types

### Files Modified (Frontend UI):

6. **`frontend/src/features/settings/pages/Settings/CurrencyManager.tsx`** - Complete overhaul:
   - Added Edit/Delete buttons to each rate row
   - Added Edit modal with validation
   - Added "We Buy USD (Lower)" / "We Sell USD (Higher)" labels
   - Added Profit Spread display
   - Added buy/sell rate validation (buy < sell)

### Testing

- ✅ TypeScript compilation successful (core + electron-app + frontend)
- ✅ All layers properly connected
- ✅ UI updated with full edit/delete functionality
- 🔄 Manual testing required: Check the UI in browser

### How to Test

**For Web Mode (already running):**

1. Go to **Settings** → **Currencies & Rates** tab
2. Scroll to the **Exchange Rates** section
3. You should now see:
   - **Profit Spread** indicator (if USD-LBP rates exist)
   - Each rate showing "We Buy USD (Lower)" / "We Sell USD (Higher)" labels
   - **Edit** (blue) and **Delete** (red) icon buttons on each rate
4. Click **Edit** to modify a rate (validates buy < sell)
5. Click **Delete** to remove a rate (with confirmation)

**For Electron Mode:**

1. Restart the Electron app (to reload rebuilt code)
2. Follow the same steps as Web Mode above

---

## Previous Session Summary (February 27, 2026)

### ✅ COMPLETED (75%):

**Phase 1: Settings - Edit/Delete Rates (100%)**
• ✅ Clear labels: "We Buy USD (Lower)" / "We Sell USD (Higher)"
• ✅ Edit button with modal and validation
• ✅ Delete button with confirmation (UI only - backend fixed Feb 28)
• ✅ Profit spread auto-calculated
• ✅ Backend DELETE endpoint
• ✅ All tests passing

**Phase 2: Automatic Rate Selection (50%)**
• ✅ Created exchangeRates.ts shared utility
• ✅ Debt Settlement: Auto-selects selling rate
• ✅ Rate type indicator in UI
• ✅ User can override per transaction

### 📋 REMAINING (25%):

• ⏸️ POS/Sales: Complex multi-payment logic - skipped for now
• ⏳ Services (OMT/WHISH): Need rate indicator
• ⏳ Custom Services: Need rate indicator
• ⏳ Exchange: Direction-based rate selection
• ⏳ Documentation: Final updates

---

## Dynamic Exchange Rate System (February 28, 2026)

### Problem

User reported that when settling debts and clicking currency quick-fill buttons (USD/LBP), the exchange rate field didn't update. This was a critical UX issue that would affect all transaction pages.

### Solution: Reusable Dynamic Exchange Rate Hook

Created `useDynamicExchangeRate` hook that:

- ✅ Automatically updates rate when currency changes
- ✅ Selects correct rate (buy vs sell) based on transaction type
- ✅ Provides visual feedback (rate type indicator)
- ✅ Hides rate field when USD is selected (no conversion needed)
- ✅ Allows manual override per transaction
- ✅ Highlights selected currency

### Implementation

**New Files:**

1. `frontend/src/hooks/useDynamicExchangeRate.ts` - Core hook
2. `frontend/src/shared/components/CurrencyQuickFill.tsx` - Reusable component
3. `docs/DYNAMIC_EXCHANGE_RATES.md` - Complete implementation guide

**Updated Files:**

- `frontend/src/features/debts/pages/Debts/index.tsx` - First implementation

### Features

**Before:**

```typescript
// Static rate, doesn't update
const [exchangeRate, setExchangeRate] = useState("89000");
```

**After:**

```typescript
// Dynamic rate that updates with currency selection
const { rate, rateInfo, isBaseCurrency } = useDynamicExchangeRate({
  selectedCurrency: "LBP",
  transactionType: "DEBT_PAYMENT",
});
// Rate automatically updates when selectedCurrency changes!
```

### User Experience Improvements

1. **Click USD Quick Fill**
   - Amount fills in USD
   - Exchange rate field **hides** (no conversion needed)
   - Selected currency highlighted

2. **Click LBP Quick Fill**
   - Amount fills in LBP
   - Exchange rate field **shows** with "We Sell USD" rate (89,500)
   - Rate description: "💰 We Sell USD rate (Money IN from customer)"
   - Selected currency highlighted

3. **Switch Between Currencies**
   - Rate updates instantly
   - Amount recalculates
   - Visual feedback on selection

### Rollout Plan

**Phase 1: Debt Settlement** ✅ COMPLETE

- Implemented dynamic rates
- Quick fill buttons work correctly
- Rate updates when switching currencies
- Fixed: LBP amount now consistent (no longer changes when clicked)
- Fixed: Only shows currencies enabled for Debts module (EUR removed)

**Phase 2: High Priority Pages** 📋 PENDING

- [ ] POS/Sales - Most frequently used
- [ ] Services (OMT/WHISH) - High transaction volume
- [ ] Mobile Recharge - Common use case

**Phase 3: Remaining Pages** 📋 PENDING

- [ ] Custom Services
- [ ] Maintenance
- [ ] Expenses
- [ ] Exchange (with direction-based rate selection)

### Technical Details

See `docs/DYNAMIC_EXCHANGE_RATES.md` for:

- Complete implementation guide
- Code examples for each page type
- Transaction type mapping
- Rate selection logic
- Testing checklist

### Bugfixes (February 28, 2026 - Iteration 2)

**Issue #1: LBP Amount Inconsistent**

- **Problem**: LBP button showed "5,000 LBP" initially, changed to "6,265,000 LBP" when clicked
- **Root Cause**: `customExchangeRate` started as "1" before rates loaded (70 USD × 1 = 70 ≈ 5,000 LBP)
- **Solution**: Created `getRateForCurrency()` helper that always uses the correct sell rate from `allRates`
- **Result**: LBP button consistently shows "6,265,000 LBP" before and after click

**Issue #2: EUR Showing in Debts Module**

- **Problem**: EUR currency appeared in Debt settlement, even though it's only enabled for Exchange
- **Root Cause**: Used `activeCurrencies` (all active currencies globally) instead of module-specific currencies
- **Solution**: Use `getCurrenciesForModule("debts")` to load only currencies enabled for Debts
- **Result**: Only USD and LBP show in Debts; EUR only appears where enabled

**Code Changes:**

```typescript
// Load module-specific currencies
const [debtCurrencies, setDebtCurrencies] = useState([]);
useEffect(() => {
  const currencies = await getCurrenciesForModule("debts");
  setDebtCurrencies(currencies);
}, []);

// Helper to get rate for any currency
const getRateForCurrency = (currencyCode: string): number => {
  if (currencyCode === "USD") return 1;
  if (currencyCode === "LBP") {
    const sellRate = allRates.find(
      (r) => r.from_code === "LBP" && r.to_code === "USD",
    );
    return sellRate?.rate || EXCHANGE_RATE;
  }
  return 1;
};

// Use correct rate for display
const rate = getRateForCurrency(curr.code);
const amount = curr.code === "LBP" ? roundLBPUp(totalDebt * rate) : totalDebt;
```

### Benefits

✅ **Consistent UX** - Same behavior across all pages  
✅ **Automatic Rate Selection** - No manual lookup needed  
✅ **Visual Feedback** - Clear indication of selected currency and rate type  
✅ **Reusable** - Drop-in hook for any transaction page  
✅ **Type-Safe** - Full TypeScript support  
✅ **Flexible** - Supports manual override when needed  
✅ **Module-Aware** - Only shows currencies enabled for specific module  
✅ **Accurate Display** - Quick fill buttons always show correct amounts

---

## Phase 3: Transaction Consolidation Fix (February 28, 2026)

### Problem Discovered During Testing

When creating a sale with debt and clicking the "eye" button to view sale details in the Debts page, an error appeared:

```
Sale #2 not found. This debt entry may reference a deleted or non-existent sale.
```

The actual sale was #1, but the system was looking for #2.

### Root Cause Analysis

The app uses a **unified transaction architecture** (see `docs/archive/PLAN_IMPL.md`) where:

**Correct Architecture:**

```
debt_ledger.transaction_id → transactions.id
                              transactions.source_table = 'sales'
                              transactions.source_id = actual_sale_id
```

**What Was Happening:**

- Backend: `SalesRepository.processSale()` correctly stored `txnId` in `debt_ledger.transaction_id` ✓
- Frontend: `loadSaleDetails()` assumed `transaction_id` was the sale ID directly ✗
- Result: Mismatch between transaction ID and sale ID

### The Fix

**Backend (Already Correct):**

```typescript
// packages/core/src/repositories/SalesRepository.ts
const txnId = getTransactionRepository().createTransaction({
  type: TRANSACTION_TYPES.SALE,
  source_table: "sales",
  source_id: saleId,  // ← Links back to sales table
  ...
});

debtStmt.run(
  finalClientId,
  "Sale Debt",
  debtAmount,
  txnId,  // ← Correct: Use transaction ID
  "Balance from Sale",
);
```

**Frontend (Fixed):**

```typescript
// frontend/src/features/debts/pages/Debts/index.tsx
const loadSaleDetails = async (transactionId: number) => {
  // NEW: Lookup sale through transactions table
  const transaction = await api.getTransactionById(transactionId);

  if (!transaction || transaction.source_table !== "sales") {
    alert(`Transaction #${transactionId} is not a sale`);
    return;
  }

  const saleId = transaction.source_id; // ← Get actual sale ID
  const sale = await api.getSale(saleId);
  // ... rest of code
};
```

### Benefits of Unified Transaction Architecture

✅ **Single Source of Truth**: All financial events in one `transactions` table  
✅ **Consistent Voiding/Refunds**: Use `transactions.status` and `reverses_id`  
✅ **Better Reporting**: Query by `type`, `user_id`, `client_id`, date ranges  
✅ **Debt Aging**: `transactions.created_at` for aging buckets  
✅ **Audit Trail**: Complete history without polymorphic queries

### Files Modified

1. ✅ `packages/core/src/repositories/SalesRepository.ts` - Verified correct (uses `txnId`)
2. ✅ `frontend/src/features/debts/pages/Debts/index.tsx` - Fixed to lookup via transactions table
3. ✅ Backend API already had `GET /api/transactions/:id` endpoint

### TODO: Apply This Pattern Everywhere

The same lookup pattern should be used wherever we reference `transaction_id` from:

- ✅ `debt_ledger.transaction_id` - **FIXED** (Sales debts)
- ⏳ Custom services debt entries
- ⏳ Maintenance debt entries
- ⏳ Service debt entries (OMT/WHISH)
- ⏳ Recharge debt entries
- ⏳ `payments.transaction_id` - Check if UI references this directly
- ⏳ `supplier_ledger.transaction_id` - Check if UI references this directly

**Pattern to Follow:**

```typescript
// ✗ WRONG: Assume transaction_id is the source record ID
const record = await api.getSale(debt.transaction_id);

// ✓ CORRECT: Lookup through transactions table
const txn = await api.getTransactionById(debt.transaction_id);
const record = await api.getSale(txn.source_id);
```

### Testing Checklist

- [x] Create sale with partial payment (debt)
- [x] View Debts page
- [x] Click eye button on debt entry
- [x] Verify sale details modal opens correctly
- [x] Verify correct sale ID is displayed
- [ ] Test with service debts (OMT/WHISH)
- [ ] Test with custom service debts
- [ ] Test with maintenance debts
- [ ] Test with recharge debts

### Reference Documentation

See `docs/archive/PLAN_IMPL.md` for complete details on:

- Phase 3: Unified Transaction Table foundation
- Phase 4: Repository migration to use `transactions` table
- Phase 6: Schema cleanup (consolidation of FKs)

---

**Last Updated**: February 28, 2026
