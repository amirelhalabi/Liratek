# Opening & Closing Modals Standardization Plan

**Date:** December 18, 2025  
**Version:** 1.2.0  
**Status:** Planning

---

## 🎯 Objective

Standardize the Opening and Closing shift modals to have identical fields for tracking shop cash flow. This helps detect discrepancies and potential theft by comparing opening vs closing amounts.

---

## 📊 Current State Analysis

### Opening Modal (`src/features/closing/pages/Opening/index.tsx`)

**Current Fields:**

- ✅ General Drawer (USD, LBP, EUR - dynamic currencies)
- ✅ OMT Drawer (USD, LBP, EUR - dynamic currencies)
- ✅ MTC Drawer (USD, LBP, EUR - dynamic currencies)
- ✅ Alfa Drawer (USD, LBP, EUR - dynamic currencies)

**Current Behavior:**

- Shows all 4 drawers at once
- Dynamic currency support (fetches from active currencies)
- Saves opening_balance for each drawer/currency combination

### Closing Modal (`src/features/closing/pages/Closing/index.tsx`)

**Current Fields:**

- ❌ Only 2 drawer types in wizard (General, OMT)
- ❌ Hardcoded currencies (USD, LBP, EUR)
- ❌ Missing MTC drawer
- ❌ Missing Alfa drawer
- ❌ Step-by-step wizard (4 steps)

**Current Behavior:**

- Multi-step wizard (Select Drawer → Physical Count → Compare → Confirm)
- Only tracks General and OMT drawers
- Blind count enforcement (doesn't show expected until after physical count)

---

## 🎯 Required Changes

### 1. **Standardize Drawer Types**

Both modals should support the same 4 drawers:

- ✅ **General Drawer** (USD + LBP)
- ✅ **OMT Drawer** (USD or LBP)
- ✅ **MTC** (Touch amounts in $)
- ✅ **Alfa** (amounts in $)

### 2. **Standardize Fields Per Drawer**

| Drawer Type | Currencies/Fields                         |
| ----------- | ----------------------------------------- |
| **General** | USD, LBP (dynamic from active currencies) |
| **OMT**     | USD, LBP (dynamic from active currencies) |
| **MTC**     | USD only (single field)                   |
| **Alfa**    | USD only (single field)                   |

**Note:** MTC and Alfa are mobile carrier top-up services that only deal in USD.

### 3. **Opening Modal Trigger**

**Current:** Manually opened from menu  
**Required:** Automatically open after successful login

**Implementation:**

- Add check in `AuthContext.tsx` after login
- Check if opening balance already set for today
- If not set, auto-open the Opening modal
- Allow all roles to access (for now)

### 4. **Access Control**

**Phase 1 (Current Implementation):**

- All roles can perform opening/closing

**Phase 2 (Future):**

- Admin-only access
- Other roles require admin approval

---

## 🏗️ Implementation Plan

### Phase 1: Standardize Fields

#### Step 1: Update Closing Modal UI ✅

**File:** `src/features/closing/pages/Closing/index.tsx`

**Changes:**

1. Add MTC and Alfa to drawer types
2. Update step 2 to show all 4 drawers (match Opening modal layout)
3. Keep dynamic currency support
4. Maintain blind count behavior
5. Update variance calculation for all 4 drawers

#### Step 2: Update Backend Types ✅

**Files:**

- `electron/database/repositories/ClosingRepository.ts`
- `electron/services/ClosingService.ts`

**Changes:**

1. Ensure drawer types support: "General", "OMT", "MTC", "Alfa"
2. Verify `OpeningBalanceAmount` and `ClosingAmount` interfaces
3. Update `SystemExpectedBalances` to include MTC and Alfa

#### Step 3: Update Backend Logic ✅

**File:** `electron/database/repositories/ClosingRepository.ts`

**Changes:**

1. Update `getSystemExpectedBalances()` to calculate MTC and Alfa expected amounts
2. Query sales/transactions for MTC and Alfa drawers
3. Return expected balances for all 4 drawers

### Phase 2: Auto-Open After Login

#### Step 4: Add Opening Check After Login ✅

**File:** `src/features/auth/context/AuthContext.tsx`

**Changes:**

1. After successful login, check if opening balance set for today
2. Call new backend API: `window.api.closing.hasOpeningBalanceToday()`
3. If false, trigger opening modal
4. Store opening modal state in context

#### Step 5: Create Backend API ✅

**Files:**

- `electron/handlers/closingHandlers.ts`
- `electron/services/ClosingService.ts`
- `electron/database/repositories/ClosingRepository.ts`

**New Methods:**

```typescript
// Check if opening balance exists for today
hasOpeningBalanceToday(): boolean

// Get today's date in YYYY-MM-DD format
getTodayDate(): string
```

#### Step 6: Pass Opening Modal Control to Dashboard ✅

**File:** `src/features/dashboard/pages/Dashboard.tsx`

**Changes:**

1. Receive opening modal trigger from AuthContext
2. Auto-open Opening modal if needed
3. User can dismiss but will be reminded

### Phase 3: Testing & Validation

#### Step 7: Update Tests ✅

**Files:**

- `electron/handlers/__tests__/closingHandlers.test.ts`
- `electron/services/__tests__/ClosingService.test.ts`

**New Tests:**

1. Test `hasOpeningBalanceToday()` returns correct boolean
2. Test opening balance set for all 4 drawers
3. Test closing balance accepts all 4 drawers
4. Test variance calculation for MTC and Alfa

#### Step 8: Integration Testing ✅

**Manual Tests:**

1. Login → Opening modal auto-opens
2. Set opening balances for all 4 drawers
3. Perform transactions throughout the day
4. Open closing modal → verify all 4 drawers
5. Compare opening vs closing amounts
6. Verify variance calculations

---

## 📝 Detailed Implementation

### 1. Backend Schema Changes

**Database:** Already supports arbitrary drawer names via `drawer_name` field

**No schema changes needed** ✅

### 2. Frontend Changes

#### Opening Modal (Minor adjustments)

**File:** `src/features/closing/pages/Opening/index.tsx`

```tsx
// Already has:
const drawerTypes: Array<"General" | "OMT" | "MTC" | "Alfa"> = [
  "General",
  "OMT",
  "MTC",
  "Alfa",
];

// ✅ Already correct! Just verify it works
```

#### Closing Modal (Major updates)

**File:** `src/features/closing/pages/Closing/index.tsx`

**Current:**

```tsx
const [drawerType, setDrawerType] = useState<"General" | "OMT">("General");
```

**Change to:**

```tsx
const drawerTypes: Array<"General" | "OMT" | "MTC" | "Alfa"> = [
  "General",
  "OMT",
  "MTC",
  "Alfa",
];
```

**Step 2 Update:**

```tsx
// Replace single drawer view with all drawers view (match Opening modal)
<div className="space-y-4">
  {drawerTypes.map((d) => (
    <div key={d} className="border border-slate-700 rounded-lg p-3">
      <div className="font-semibold text-white mb-2">{d} Drawer</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {currencies.map((c) => (
          <div key={c.code}>
            <label className="block text-sm text-slate-400 mb-1">
              {c.code}
            </label>
            <input
              type="number"
              value={physicalText[d]?.[c.code] ?? ""}
              onChange={(e) => setDrawerCurrencyText(d, c.code, e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
            />
          </div>
        ))}
      </div>
    </div>
  ))}
</div>
```

### 3. Backend API Changes

#### New Handler

**File:** `electron/handlers/closingHandlers.ts`

```typescript
// Add new IPC handler
ipcMain.handle("closing:hasOpeningBalanceToday", async () => {
  try {
    const closingService = getClosingService();
    return closingService.hasOpeningBalanceToday();
  } catch (error: any) {
    logger.error("Error checking opening balance:", error);
    return false; // Default to false if error
  }
});
```

#### New Service Method

**File:** `electron/services/ClosingService.ts`

```typescript
/**
 * Check if opening balance has been set for today
 */
hasOpeningBalanceToday(): boolean {
  const today = new Date().toISOString().split('T')[0];
  return this.repo.hasOpeningBalanceForDate(today);
}
```

#### New Repository Method

**File:** `electron/database/repositories/ClosingRepository.ts`

```typescript
/**
 * Check if opening balance exists for a specific date
 */
hasOpeningBalanceForDate(date: string): boolean {
  const sql = `
    SELECT COUNT(*) as count
    FROM closing_amounts
    WHERE closing_date = ? AND opening_amount IS NOT NULL
  `;
  const result = this.db.prepare(sql).get(date) as { count: number };
  return result.count > 0;
}
```

### 4. Auth Context Changes

**File:** `src/features/auth/context/AuthContext.tsx`

```typescript
// Add state
const [needsOpening, setNeedsOpening] = useState(false);

// After successful login
const login = async (username: string, password: string) => {
  try {
    const response = await window.api.auth.login(username, password);
    if (response.success && response.user) {
      setUser(response.user);

      // Check if opening balance needed
      const hasOpening = await window.api.closing.hasOpeningBalanceToday();
      setNeedsOpening(!hasOpening);

      return response;
    }
    // ...
  } catch (error) {
    // ...
  }
};

// Export needsOpening state
return (
  <AuthContext.Provider value={{
    user,
    login,
    logout,
    needsOpening,
    clearOpeningFlag: () => setNeedsOpening(false)
  }}>
    {children}
  </AuthContext.Provider>
);
```

### 5. Dashboard Changes

**File:** `src/features/dashboard/pages/Dashboard.tsx`

```typescript
import { useAuth } from '../../auth/context/AuthContext';
import Opening from '../../closing/pages/Opening';

export default function Dashboard() {
  const { needsOpening, clearOpeningFlag } = useAuth();
  const [showOpening, setShowOpening] = useState(false);

  useEffect(() => {
    if (needsOpening) {
      setShowOpening(true);
    }
  }, [needsOpening]);

  const handleCloseOpening = () => {
    setShowOpening(false);
    clearOpeningFlag();
  };

  return (
    <>
      {/* Dashboard content */}

      <Opening
        isOpen={showOpening}
        onClose={handleCloseOpening}
      />
    </>
  );
}
```

---

## 🧪 Testing Checklist

### Unit Tests

- [ ] `hasOpeningBalanceForDate()` returns true when exists
- [ ] `hasOpeningBalanceForDate()` returns false when not exists
- [ ] `hasOpeningBalanceToday()` calls repository correctly
- [ ] Opening balance accepts all 4 drawer types
- [ ] Closing balance accepts all 4 drawer types

### Integration Tests

- [ ] Login → Opening modal auto-opens if no opening balance
- [ ] Login → Opening modal does NOT open if balance already set
- [ ] Set opening for all 4 drawers → saves correctly
- [ ] Close shift for all 4 drawers → saves correctly
- [ ] Variance calculation includes all 4 drawers

### Manual Tests

- [ ] Login on new day → Opening modal appears
- [ ] Fill all drawer amounts → Save successful
- [ ] Login again same day → Opening modal does NOT appear
- [ ] Perform transactions (General, OMT, MTC, Alfa)
- [ ] Open closing modal → All 4 drawers shown
- [ ] Physical counts entered → Variance calculated correctly
- [ ] Confirm closing → Saves all 4 drawers

### Edge Cases

- [ ] User dismisses opening modal → Can reopen from menu
- [ ] User closes browser before setting opening → Reopens on next login
- [ ] Multiple currencies active → All show in both modals
- [ ] Only USD/LBP active → Works correctly
- [ ] Negative variance → Displays in red
- [ ] Zero variance → Displays in green

---

## 📋 Files to Modify

### Frontend (React)

1. ✅ `src/features/closing/pages/Closing/index.tsx` - Add MTC/Alfa, update UI
2. ✅ `src/features/auth/context/AuthContext.tsx` - Add opening check after login
3. ✅ `src/features/dashboard/pages/Dashboard.tsx` - Auto-open Opening modal
4. ⚠️ `src/types/electron.d.ts` - Add new IPC types

### Backend (Electron)

5. ✅ `electron/handlers/closingHandlers.ts` - Add hasOpeningBalanceToday handler
6. ✅ `electron/services/ClosingService.ts` - Add hasOpeningBalanceToday method
7. ✅ `electron/database/repositories/ClosingRepository.ts` - Add hasOpeningBalanceForDate, update system expected
8. ✅ `electron/handlers/__tests__/closingHandlers.test.ts` - Add tests
9. ✅ `electron/services/__tests__/ClosingService.test.ts` - Add tests

### Documentation

10. ✅ This file - Implementation plan

---

## 🚀 Execution Order

### Phase 1: Backend Foundation (Day 1)

1. Update `ClosingRepository.ts` - Add `hasOpeningBalanceForDate()`
2. Update `ClosingService.ts` - Add `hasOpeningBalanceToday()`
3. Update `closingHandlers.ts` - Add IPC handler
4. Add tests for new methods
5. Run tests: `yarn test`

### Phase 2: Frontend Updates (Day 1-2)

6. Update `Closing/index.tsx` - Add MTC/Alfa drawers
7. Update `AuthContext.tsx` - Add opening check logic
8. Update `Dashboard.tsx` - Auto-open Opening modal
9. Update `electron.d.ts` - Type definitions
10. Run typecheck: `yarn typecheck`
11. Run lint: `yarn lint`

### Phase 3: Integration Testing (Day 2)

12. Build app: `yarn build`
13. Test dev mode: `yarn dev`
14. Test all scenarios manually
15. Fix any issues
16. Run full test suite: `yarn test`

### Phase 4: Deployment (Day 2-3)

17. Commit to dev branch
18. Push to GitHub
19. Verify CI passes
20. Merge to main (v1.2.0 release)

---

## ⚠️ Important Notes

### 1. Drawer Usage Clarification

**General Drawer:**

- Main cash register
- Handles all regular sales
- Tracks USD + LBP

**OMT Drawer:**

- Separate drawer for money transfer service
- Only OMT transactions
- Tracks USD or LBP (depending on transfer)

**MTC (Touch):**

- Mobile carrier: Touch
- Prepaid card/recharge sales
- USD only

**Alfa:**

- Mobile carrier: Alfa
- Prepaid card/recharge sales
- USD only

### 2. Currency Handling

- **Dynamic currencies:** General and OMT support all active currencies
- **Fixed currency:** MTC and Alfa are USD-only
- **Future-proof:** System can add more currencies easily

### 3. Access Control

**Current (v1.2.0):**

- All roles can open/close shifts
- No approval required

**Future (v1.3.0+):**

- Admin-only or requires approval
- Audit trail for who opened/closed
- Lock previous days from modification

### 4. Blind Count Enforcement

**Current:** Closing modal enforces blind count (shows expected after physical)  
**Keep this:** Important for fraud detection

### 5. Data Integrity

**Opening Balance:**

- Set once per day
- Cannot be modified after closing is done
- Becomes basis for next day's variance check

**Closing Balance:**

- Physical count vs system expected
- Variance flagged if > threshold
- Report generated with all details

---

## 📊 Success Criteria

### Functionality

- ✅ Opening modal shows all 4 drawers with correct fields
- ✅ Closing modal shows all 4 drawers with correct fields
- ✅ Opening modal auto-opens after login (if not set)
- ✅ All roles can access opening/closing
- ✅ Variance calculated correctly for all drawers
- ✅ Data persists correctly in database

### Code Quality

- ✅ All TypeScript types updated
- ✅ All tests passing
- ✅ No linting errors
  - Current (Dec 19, 2025): 0 errors, ~119 warnings (mostly `no-explicit-any` in repos/services/UI and some preload)
- ✅ No type errors
- ✅ Clean build

### User Experience

- ✅ Smooth auto-open after login
- ✅ Clear field labels
- ✅ Easy to enter amounts
- ✅ Variance clearly displayed
- ✅ Confirmation messages clear

---

## 📅 Timeline

**Estimated Time:** 1-2 days

**Day 1:**

- Morning: Backend changes (2-3 hours)
- Afternoon: Frontend changes (3-4 hours)
- Evening: Initial testing (1-2 hours)

**Day 2:**

- Morning: Integration testing (2-3 hours)
- Afternoon: Bug fixes, polish (2-3 hours)
- Evening: Final testing, commit, push (1-2 hours)

---

## 🎯 Next Steps

1. Review this plan
2. Confirm requirements
3. Begin implementation (Phase 1)
4. Test each phase before moving to next
5. Deploy when all tests pass

---

**Status:** ⏳ Ready for implementation  
**Approval:** Pending user confirmation  
**Priority:** High (Core business feature)
