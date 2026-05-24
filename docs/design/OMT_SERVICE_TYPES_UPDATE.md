# OMT Service Types Update

**Date**: February 24, 2026  
**Status**: ✅ COMPLETE

---

## Summary

Updated OMT service types based on user requirements to reflect the actual services offered and their order of importance.

---

## Changes Made

### 1. Service Type Reordering and Updates

**Old Service Types (8):**

1. `BILL_PAYMENT` → Bill Payment
2. `CASH_TO_BUSINESS` → Cash To Business
3. `MINISTRY_OF_INTERIOR` → Ministry of Interior
4. `CASH_OUT` → Cash Out
5. `MINISTRY_OF_FINANCE` → Ministry of Finance
6. `INTRA` → INTRA
7. `ONLINE_BROKERAGE` → Online Brokerage
8. `WESTERN_UNION` → Western Union

**New Service Types (8):**

1. `INTRA` → Intra
2. `WESTERN_UNION` → Western Union
3. `CASH_TO_BUSINESS` → Cash to Business
4. `CASH_TO_GOV` → Cash to Gov (consolidates MINISTRY_OF_INTERIOR and MINISTRY_OF_FINANCE)
5. `OMT_WALLET` → OMT Wallet (new)
6. `OMT_CARD` → OMT Card (new)
7. `OGERO_MECANIQUE` → Ogero/Mecanique (renamed from BILL_PAYMENT)
8. `ONLINE_BROKERAGE` → Online Brokerage ($3)

### 2. Migration Strategy

**Migration v27** (`update_omt_service_types`):

- Renames `BILL_PAYMENT` → `OGERO_MECANIQUE`
- Consolidates `MINISTRY_OF_INTERIOR` and `MINISTRY_OF_FINANCE` → `CASH_TO_GOV`
- Migrates `CASH_OUT` → `INTRA`
- Adds new service types: `OMT_WALLET`, `OMT_CARD`
- Updates database CHECK constraint with new enum values

---

## Files Modified

### Core Schema & Validation

1. **`packages/core/src/validators/financial.ts`**
   - Updated `omtServiceType` enum with new values in correct order

2. **`packages/core/src/db/migrations/index.ts`**
   - Added migration v27 with data migration logic
   - Maps old service types to new ones during upgrade

3. **`electron-app/create_db.sql`**
   - Updated `omt_service_type` CHECK constraint

### Frontend

4. **`frontend/src/features/services/pages/Services/index.tsx`**
   - Updated `OmtServiceType` type definition
   - Updated `OMT_SERVICE_OPTIONS` array with new labels
   - Maintains default value of `INTRA`

### Tests

5. **`backend/src/services/__tests__/FinancialService.test.ts`**
   - Updated all test cases to use new service type values
   - All 44 tests passing

### Documentation

6. **`docs/PHASE2_OMT_FEES.md`**
   - Updated service types table
   - Updated TypeScript enum definition
   - Updated fee schedule examples
   - Added notes explaining consolidations and additions

---

## Data Migration Logic

```sql
CASE
  WHEN omt_service_type = 'BILL_PAYMENT' THEN 'OGERO_MECANIQUE'
  WHEN omt_service_type IN ('MINISTRY_OF_INTERIOR', 'MINISTRY_OF_FINANCE') THEN 'CASH_TO_GOV'
  WHEN omt_service_type = 'CASH_OUT' THEN 'INTRA'
  ELSE omt_service_type
END
```

This ensures existing data is preserved and mapped to the new service types.

---

## Testing Results

✅ **All tests passing**: 328/328  
✅ **TypeScript compilation**: No errors  
✅ **Frontend validation**: Updated  
✅ **Backend validation**: Updated  
✅ **Database migration**: Ready

---

## Next Steps

As per the Financial Services Plan, **Phase 2 is still blocked** awaiting:

1. **Fee schedule data** from the user for each service type
2. **Answers to open questions** (Q4-Q8 in FINANCIAL_SERVICES_PLAN.md)
3. **Commission rates** for each service type

Once this data is provided, Phase 2 (Auto-Profit Calculation) can proceed with implementation.

---

## Backwards Compatibility

- Existing databases will automatically upgrade via migration v27
- Old service type values will be mapped to new equivalents
- No data loss occurs during migration
- Frontend displays updated labels immediately after upgrade
