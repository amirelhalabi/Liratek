# OMT Fee Calculation Implementation Summary

**Date**: February 24, 2026  
**Status**: ✅ Backend Complete | 🚧 Frontend Pending

---

## 🎯 Overview

Implemented automatic commission calculation for OMT financial services based on service type and fee structure. The system now auto-calculates shop profit based on OMT fees or transaction amounts depending on the service type.

---

## ✅ Completed Work

### 1. Fee Calculator Utility (`packages/core/src/utils/omtFees.ts`)

**Created comprehensive fee calculation logic:**

- `calculateCommission(serviceType, omtFee)` - Calculates shop commission as % of OMT fee
- `calculateOnlineBrokerageProfit(amount, profitRate)` - Direct profit calculation for ONLINE_BROKERAGE
- Helper functions for UI integration

**Commission Rates Implemented:**

```typescript
INTRA:            15% of OMT fee
WESTERN_UNION:    10% of OMT fee
CASH_TO_BUSINESS: 25% of OMT fee
CASH_TO_GOV:      25% of OMT fee (bills: darayeb, water, meliye)
OMT_WALLET:       0% (NO FEES)
OMT_CARD:         10% of OMT fee
OGERO_MECANIQUE:  25% of OMT fee
ONLINE_BROKERAGE: 0.1%-0.4% of cashed amount (configurable)
```

### 2. Database Schema Updates

**Migration v28** (`add_fee_calculation_fields`):

- Added `omt_fee` column (DECIMAL 10,2) - OMT's fee (user-entered)
- Added `profit_rate` column (DECIMAL 6,5) - For ONLINE_BROKERAGE (0.1%-0.4%)
- Added `pay_fee` column (INTEGER) - For BINANCE fee checkbox

**Updated `create_db.sql`** for fresh installations.

### 3. Validators Updated

**`packages/core/src/validators/financial.ts`:**

- Added `omtFee`, `profitRate`, `payFee` fields
- Added validation refinements:
  - OMT fee required for standard services (except OMT_WALLET and ONLINE_BROKERAGE)
  - BINANCE with `payFee=true` requires `omtServiceType`
  - Profit rate range validation (0.1%-0.4%)

### 4. Repository Auto-Calculation

**`packages/core/src/repositories/FinancialServiceRepository.ts`:**

Auto-calculates commission in `createTransaction()`:

```typescript
if (provider === "OMT" && omtServiceType) {
  if (omtServiceType === "OMT_WALLET") {
    commission = 0; // No fees
  } else if (omtServiceType === "ONLINE_BROKERAGE") {
    commission = calculateOnlineBrokerageProfit(amount, profitRate);
  } else if (omtFee) {
    commission = calculateCommission(omtServiceType, omtFee);
  }
}
```

### 5. Comprehensive Tests

**`packages/core/src/utils/__tests__/omtFees.test.ts`:**

- 8 test suites, 30+ test cases
- Tests all commission rates
- Tests profit rate clamping for ONLINE_BROKERAGE
- Tests helper functions
- All tests passing ✅

### 6. Documentation

**Updated Files:**

- `docs/PHASE2_OMT_FEES.md` - Complete fee structure documentation
- `docs/OMT_SERVICE_TYPES_UPDATE.md` - Service type migration guide
- `docs/OMT_FEE_CALCULATION_IMPLEMENTATION.md` - This summary

---

## 🚧 Pending Work

### 1. Frontend UI Updates (Task #4)

**For OMT Services (except OMT_WALLET and ONLINE_BROKERAGE):**

- [ ] Amount field (user enters transaction amount)
- [ ] OMT Fee field (user enters fee from OMT system)
- [ ] Auto-calculated commission display (read-only)
- [ ] Example: INTRA with $5 OMT fee → "Shop profit: $0.75 (15%)"

**For OMT_WALLET:**

- [ ] Show alert: "⚠️ This service has no fees"
- [ ] Disable/hide commission and fee fields
- [ ] Set commission to 0 automatically

**For ONLINE_BROKERAGE:**

- [ ] Amount field (cashed amount)
- [ ] Profit rate field (default 0.25%, range 0.1%-0.4%)
- [ ] Auto-calculated profit display
- [ ] Example: $800 @ 0.1% → "Shop profit: $0.80"

**File to update:** `frontend/src/features/services/pages/Services/index.tsx`

### 2. BINANCE Fee Checkbox (Task #5)

**UI Requirements:**

- [ ] Amount field
- [ ] "Charge fee to customer" checkbox
- [ ] When checked:
  - [ ] OMT Service Type dropdown appears
  - [ ] Fee field (editable, pre-filled with calculated fee)
  - [ ] Total charged display: `amount + fee`
  - [ ] Commission calculated same as OMT services

**File to update:** `frontend/src/features/services/pages/Services/index.tsx`

### 3. Supplier Ledger Management Page (Task #6)

**Requirements:**

- [ ] New page accessible from Settings → Suppliers
- [ ] Button: "Manage Owed Amounts"
- [ ] Display supplier ledger entries
- [ ] Connected to `supplier_ledger` table
- [ ] Show balance owed to each supplier

**Files to create:**

- `frontend/src/features/settings/pages/SupplierLedger/index.tsx`
- Route in settings

---

## 📊 Implementation Architecture

### Data Flow

```
User Input → Validator → Repository (Auto-calc) → Database
                ↓
          Fee Calculator
                ↓
          Commission Stored
```

### Commission Calculation Logic

**Most Services:**

```
OMT communicates fee → User enters fee → System calculates commission
commission = omtFee × commissionRate
```

**Online Brokerage:**

```
User enters amount & rate → System calculates profit
profit = amount × profitRate (0.1%-0.4%)
```

**OMT Wallet:**

```
Zero fees → commission = 0
```

---

## 🧪 Testing Status

| Component              | Tests           | Status         |
| ---------------------- | --------------- | -------------- |
| Fee Calculator         | 30+             | ✅ All passing |
| Validators             | Integrated      | ✅ Type-safe   |
| Repository             | Auto-calc logic | ✅ Implemented |
| Database Migration     | v28             | ✅ Ready       |
| TypeScript Compilation | All modules     | ✅ No errors   |
| **Frontend UI**        | -               | 🚧 **Pending** |

**Total Backend Tests Passing:** 328/328 ✅

---

## 🔄 Migration Path

**For existing databases:**

1. Migration v27 runs automatically (OMT service type updates)
2. Migration v28 runs automatically (adds fee fields)
3. Existing records: `omt_fee = NULL`, `profit_rate = NULL`, `pay_fee = 0`
4. New transactions: Auto-calculated based on user input

**For new installations:**

- `create_db.sql` includes all new fields
- No migration needed

---

## 📝 Next Steps

1. **Implement Frontend UI** (Task #4, #5)
   - Update Services page with new fields
   - Add real-time fee preview
   - Add OMT_WALLET alert
   - Add ONLINE_BROKERAGE rate selector
   - Add BINANCE fee checkbox

2. **Implement Supplier Ledger Page** (Task #6)
   - Create new page component
   - Wire up to supplier_ledger table
   - Add navigation from Settings

3. **User Testing**
   - Test each service type
   - Verify calculations match OMT fees
   - Test edge cases (zero fees, varying rates)

4. **Documentation**
   - User guide for entering fees
   - Screenshots of UI
   - FAQ for common questions

---

## 🎓 Key Design Decisions

1. **Auto-calculation at Repository Level**
   - Ensures consistency across all entry points
   - Backend validates and calculates
   - Frontend can preview but backend is source of truth

2. **Flexible Profit Rate for Online Brokerage**
   - Default: 0.25%
   - Range: 0.1% - 0.4%
   - Allows per-transaction adjustment
   - Clamped to valid range

3. **BINANCE Fee as Optional Add-on**
   - Checkbox approach for flexibility
   - Uses same commission calculation as OMT
   - Requires service type selection when enabled

4. **OMT Wallet Special Handling**
   - Explicit zero-fee service
   - UI alert to prevent user confusion
   - Backend enforces zero commission

---

## ✨ Benefits

- ✅ **Eliminates manual commission entry** for OMT services
- ✅ **Reduces errors** - system calculates based on rules
- ✅ **Consistent profit tracking** - standardized across service types
- ✅ **Flexible rates** - configurable per service type
- ✅ **Audit trail** - stores OMT fee + calculated commission
- ✅ **Type-safe** - full TypeScript validation
- ✅ **Tested** - comprehensive unit tests

---

**Status:** Backend implementation complete. Ready for frontend integration.
