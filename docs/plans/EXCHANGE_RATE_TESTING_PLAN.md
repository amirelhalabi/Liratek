# Exchange Rate Fix - Comprehensive Testing Plan

**Document Created:** April 1, 2026  
**Priority:** 🔴 CRITICAL  
**Estimated Testing Time:** 2-3 hours  
**Scope:** All recharge/financial modules affected by exchange rate changes

---

## 📋 TABLE OF CONTENTS

1. [Pre-Testing Setup](#1-pre-testing-setup)
2. [Unit Tests Verification](#2-unit-tests-verification)
3. [Manual Testing - Core Flows](#3-manual-testing---core-flows)
4. [Manual Testing - Edge Cases](#4-manual-testing---edge-cases)
5. [Financial Impact Verification](#5-financial-impact-verification)
6. [Integration Testing](#6-integration-testing)
7. [Regression Testing](#7-regression-testing)
8. [Performance Testing](#8-performance-testing)
9. [Sign-Off Checklist](#9-sign-off-checklist)

---

## 1. PRE-TESTING SETUP

### 1.1 Environment Setup

**Prerequisites:**

```bash
# Ensure you're on the correct branch
git checkout <branch-name>

# Install dependencies
yarn install

# Build the project
yarn build

# Start in dev mode
yarn dev
```

**Verify Build Status:**

```bash
✅ yarn build - Should complete successfully
✅ yarn typecheck - Should show 0 errors in migrated files
✅ yarn workspace @liratek/frontend test - Should pass (135+ tests)
✅ yarn workspace @liratek/backend test - Should pass (354 tests)
```

### 1.2 Test Data Preparation

**Exchange Rates Setup:**

1. Open Settings → Exchange Rates
2. Verify rates exist:
   - **USD → LBP (SELL):** 89,500 LBP
   - **LBP → USD (BUY):** 89,000 LBP
3. If not present, add them:
   ```
   From: USD, To: LBP, Rate: 89500
   From: LBP, To: USD, Rate: 89000
   ```

**Test Products (for IPEC/KATCH):**

- Ensure at least 3 IPEC items exist (different categories)
- Ensure at least 3 KATCH items exist (gaming cards)
- Ensure OMT App items exist
- Ensure Whish App items exist

**Test Clients:**

- Create test client: "Test Customer" / "+961000000"

---

## 2. UNIT TESTS VERIFICATION

### 2.1 Exchange Rate Calculator Tests

**Command:**

```bash
cd /Users/amir/Documents/Liratek
yarn workspace @liratek/frontend test exchangeRateCalculator
```

**Expected Results:**

```
✅ PASS src/utils/__tests__/exchangeRateCalculator.test.ts
  ✓ should use SELL rate for money IN transactions
  ✓ should use BUY rate for money OUT transactions
  ✓ should return 1 for USD (no conversion)
  ✓ should use fallback rate if rates are invalid
  ✓ should handle SERVICE_PAYMENT for IPEC/KATCH/OMT
  ✓ should handle DEBT_PAYMENT correctly
  ✓ should handle CUSTOM_SERVICE correctly
  ✓ should return true for revenue transactions
  ✓ should return false for expense transactions
  ✓ should fetch rates and calculate correctly
  ✓ should use fallback rate if API fails
  ✓ should calculate correct amount for $100 IPEC payment (Money IN)
  ✓ should calculate correct amount for $100 IPEC refund (Money OUT)

Test Suites: 1 passed, 1 total
Tests:       13 passed, 13 total
```

**Verification:**

- [ ] All 13 tests pass
- [ ] No TypeScript errors
- [ ] Test coverage >90%

---

## 3. MANUAL TESTING - CORE FLOWS

### 3.1 IPEC Money Transfer - SEND (Money IN)

**Test Case:** IPEC-SEND-001  
**Expected:** Uses SELL rate (89,500 LBP)

**Steps:**

1. Open Recharge page
2. Select **IPEC** provider
3. Select **SEND** service type
4. Select category: **Alfa Go**
5. Select item: **Alfa Go $50**
6. Click to expand, set quantity to **1**
7. Observe payment bar at bottom

**Verify:**

- [ ] Exchange rate shows: **89,500 LBP/USD**
- [ ] Rate type indicator: **💰 SELL** (if UI indicator added)
- [ ] Total LBP calculation: $50 × 89,500 = **4,475,000 LBP**
- [ ] Submit transaction successfully
- [ ] Check database: `financial_services` table
- [ ] Verify `metadata_json` contains correct rate

**Database Query:**

```sql
SELECT * FROM financial_services
WHERE provider = 'IPEC'
  AND metadata_json LIKE '%SERVICE_PAYMENT%'
ORDER BY created_at DESC
LIMIT 1;
```

---

### 3.2 IPEC Money Transfer - RECEIVE (Money OUT)

**Test Case:** IPEC-RECEIVE-001  
**Expected:** Uses BUY rate (89,000 LBP) ⚠️ **CRITICAL TEST**

**Steps:**

1. Open Recharge page
2. Select **IPEC** provider
3. Select **RECEIVE** service type
4. Select category: **Alfa Go**
5. Select item: **Alfa Go $50**
6. Click to expand, set quantity to **1**
7. Observe payment bar at bottom

**Verify:**

- [ ] Exchange rate shows: **89,000 LBP/USD** (NOT 89,500!)
- [ ] Rate type indicator: **💸 BUY** (if UI indicator added)
- [ ] Total LBP calculation: $50 × 89,000 = **4,450,000 LBP**
- [ ] **Savings vs wrong rate:** 4,475,000 - 4,450,000 = **25,000 LBP**
- [ ] Submit transaction successfully
- [ ] Check database: `financial_services` table
- [ ] Verify `metadata_json` contains correct rate

**Database Query:**

```sql
SELECT * FROM financial_services
WHERE provider = 'IPEC'
  AND metadata_json LIKE '%RECEIVE%'
ORDER BY created_at DESC
LIMIT 1;
```

**Financial Impact:**

```
Per $100 transaction: 50,000 LBP savings
Per day (10 transactions): 500,000 LBP savings
Per year: ~$2,000 USD savings per shop
```

---

### 3.3 KATCH Gaming Card Purchase (Money IN)

**Test Case:** KATCH-001  
**Expected:** Uses SELL rate (89,500 LBP)

**Steps:**

1. Open Recharge page
2. Select **KATCH** provider
3. Select category: **Gaming cards**
4. Select subcategory: **Pubg direct**
5. Select item: **60 UC**
6. Click to expand, set quantity to **1**
7. Observe payment bar at bottom

**Verify:**

- [ ] Exchange rate shows: **89,500 LBP/USD**
- [ ] Rate type indicator: **💰 SELL** (if UI indicator added)
- [ ] Total LBP calculation correct
- [ ] Submit transaction successfully
- [ ] Verify in database

---

### 3.4 OMT App Transfer - SEND (Money IN)

**Test Case:** OMT-SEND-001  
**Expected:** Uses SELL rate (89,500 LBP)

**Steps:**

1. Open Recharge page
2. Select **OMT App** provider
3. Select **SEND** service type (Money In)
4. Select category: **mobile topups**
5. Select subcategory: **mtc**
6. Select item: **$10**
7. Observe payment bar at bottom

**Verify:**

- [ ] Exchange rate shows: **89,500 LBP/USD**
- [ ] Total LBP calculation: $10 × 89,500 = **895,000 LBP**
- [ ] Submit transaction successfully
- [ ] Verify in database

---

### 3.5 OMT App Transfer - RECEIVE (Money OUT)

**Test Case:** OMT-RECEIVE-001  
**Expected:** Uses BUY rate (89,000 LBP) ⚠️ **CRITICAL TEST**

**Steps:**

1. Open Recharge page
2. Select **OMT App** provider
3. Select **RECEIVE** service type (Money Out)
4. Select category: **mobile topups**
5. Select subcategory: **mtc**
6. Select item: **$10**
7. Observe payment bar at bottom

**Verify:**

- [ ] Exchange rate shows: **89,000 LBP/USD** (NOT 89,500!)
- [ ] Rate type indicator: **💸 BUY** (if UI indicator added)
- [ ] Total LBP calculation: $10 × 89,000 = **890,000 LBP**
- [ ] **Savings vs wrong rate:** 895,000 - 890,000 = **5,000 LBP**
- [ ] Submit transaction successfully
- [ ] Verify in database

---

### 3.6 Whish App Transfer - SEND (Money IN)

**Test Case:** WHISH-SEND-001  
**Expected:** Uses SELL rate (89,500 LBP)

**Steps:**

1. Open Recharge page
2. Select **Whish App** provider
3. Select **SEND** service type
4. Add item to cart
5. Observe payment bar at bottom

**Verify:**

- [ ] Exchange rate shows: **89,500 LBP/USD**
- [ ] Submit transaction successfully
- [ ] Verify in database

---

### 3.7 Whish App Transfer - RECEIVE (Money OUT)

**Test Case:** WHISH-RECEIVE-001  
**Expected:** Uses BUY rate (89,000 LBP) ⚠️ **CRITICAL TEST**

**Steps:**

1. Open Recharge page
2. Select **Whish App** provider
3. Select **RECEIVE** service type
4. Add item to cart
5. Observe payment bar at bottom

**Verify:**

- [ ] Exchange rate shows: **89,000 LBP/USD** (NOT 89,500!)
- [ ] Submit transaction successfully
- [ ] Verify in database

---

### 3.8 Alfa Gift Voucher (Money IN)

**Test Case:** ALFA-GIFT-001  
**Expected:** Uses SELL rate (89,500 LBP)

**Steps:**

1. Open Recharge page
2. Select **Alfa** provider
3. Select **Alfa Gift** service type
4. Select tier from dropdown (e.g., **$50**)
5. Observe payment bar at bottom

**Verify:**

- [ ] Exchange rate shows: **89,500 LBP/USD**
- [ ] Total LBP calculation correct
- [ ] Submit transaction successfully
- [ ] Verify in database

---

## 4. MANUAL TESTING - EDGE CASES

### 4.1 Split Payment - Multiple Methods

**Test Case:** SPLIT-001  
**Expected:** Correct rate applied to split payment

**Steps:**

1. Select IPEC SEND
2. Add item worth $100
3. Enable **Split Payment** toggle
4. Add 2 payment methods:
   - CASH: 50% ($50)
   - DEBT: 50% ($50)
5. Observe payment bar

**Verify:**

- [ ] Exchange rate: **89,500 LBP/USD** (SELL)
- [ ] Split amounts calculated correctly
- [ ] Total matches item price
- [ ] Submit successfully
- [ ] Verify both payment methods in database

---

### 4.2 USD Currency Transaction (No Conversion)

**Test Case:** USD-001  
**Expected:** Rate = 1 (no conversion)

**Steps:**

1. Select transaction with USD currency
2. Add item
3. Observe payment bar

**Verify:**

- [ ] Exchange rate shows: **1 USD/USD**
- [ ] Rate type indicator: **N/A** or "No conversion"
- [ ] No LBP conversion applied
- [ ] Submit successfully

---

### 4.3 Exchange Rate API Failure (Fallback)

**Test Case:** FALLBACK-001  
**Expected:** Uses fallback rate (89,000 LBP)

**Steps:**

1. Temporarily break exchange rate API (or disconnect DB)
2. Try to create transaction
3. Observe payment bar

**Verify:**

- [ ] Exchange rate falls back to: **89,000 LBP/USD**
- [ ] No crash or error
- [ ] Transaction can still complete
- [ ] Console shows error message (for debugging)

---

### 4.4 Large Transaction Amount

**Test Case:** LARGE-001  
**Expected:** Correct rate for large amounts

**Steps:**

1. Select IPEC SEND
2. Add item worth **$1,000**
3. Observe payment bar

**Verify:**

- [ ] Exchange rate: **89,500 LBP/USD**
- [ ] Total LBP: $1,000 × 89,500 = **89,500,000 LBP**
- [ ] No overflow or precision errors
- [ ] Submit successfully

---

### 4.5 Very Small Transaction Amount

**Test Case:** SMALL-001  
**Expected:** Correct rate for small amounts

**Steps:**

1. Select IPEC SEND
2. Add item worth **$1**
3. Observe payment bar

**Verify:**

- [ ] Exchange rate: **89,500 LBP/USD**
- [ ] Total LBP: $1 × 89,500 = **89,500 LBP**
- [ ] No rounding errors
- [ ] Submit successfully

---

### 4.6 Multiple Items in Cart

**Test Case:** CART-001  
**Expected:** Correct rate for cart total

**Steps:**

1. Select KATCH
2. Add 3 different items to cart:
   - PUBG 60 UC ($10)
   - Free Fire 100 diamonds ($11)
   - Roblox $10 card
3. Observe payment bar

**Verify:**

- [ ] Exchange rate: **89,500 LBP/USD**
- [ ] Total: $31 × 89,500 = **2,774,500 LBP**
- [ ] All items in cart use same rate
- [ ] Submit successfully
- [ ] Verify all items in database

---

### 4.7 Rate Change Mid-Session

**Test Case:** RATE-CHANGE-001  
**Expected:** Updates when rates change

**Steps:**

1. Start transaction (don't submit yet)
2. In another tab, change exchange rate in Settings
3. Return to transaction tab
4. Observe if rate updates (or refresh page)

**Verify:**

- [ ] Rate updates after page refresh
- [ ] OR rate updates dynamically (if implemented)
- [ ] No stale rate used
- [ ] Submit with new rate successfully

---

## 5. FINANCIAL IMPACT VERIFICATION

### 5.1 Refund Scenario - CRITICAL TEST

**Test Case:** REFUND-001  
**Expected:** Uses BUY rate (89,000 LBP) - **SAVES MONEY** ⚠️

**This is the MOST IMPORTANT test - verifies financial loss prevention**

**Steps:**

1. Create original transaction:
   - IPEC RECEIVE
   - Amount: **$100**
   - Note the LBP amount charged: **8,900,000 LBP** (with fix)
   - vs **8,950,000 LBP** (without fix - WRONG!)

2. Create refund transaction:
   - Same amount: **$100**
   - Observe rate used

**Verify:**

- [ ] Refund uses **BUY rate (89,000 LBP)**
- [ ] Refund amount: **8,900,000 LBP**
- [ ] **Savings:** 8,950,000 - 8,900,000 = **50,000 LBP**
- [ ] Database record shows correct rate
- [ ] Financial reports show correct amounts

**Financial Impact Calculation:**

```
Per $100 refund: 50,000 LBP savings
Per month (10 refunds): 500,000 LBP savings
Per year: 6,000,000 LBP savings = ~$4,000 USD per shop
```

---

### 5.2 Expense Transaction (Money OUT)

**Test Case:** EXPENSE-001  
**Expected:** Uses BUY rate (89,000 LBP)

**Steps:**

1. Navigate to Expenses module
2. Create expense in LBP
3. Observe rate used

**Verify:**

- [ ] Exchange rate: **89,000 LBP/USD** (BUY)
- [ ] Correct conversion applied
- [ ] Submit successfully

---

### 5.3 Debt Repayment (Money IN)

**Test Case:** DEBT-001  
**Expected:** Uses SELL rate (89,500 LBP)

**Steps:**

1. Navigate to Debts module
2. Select client with outstanding debt
3. Create repayment in LBP
4. Observe rate used

**Verify:**

- [ ] Exchange rate: **89,500 LBP/USD** (SELL)
- [ ] Correct conversion applied
- [ ] Submit successfully

---

## 6. INTEGRATION TESTING

### 6.1 End-to-End Transaction Flow

**Test Case:** E2E-001  
**Expected:** Complete flow works correctly

**Steps:**

1. Create transaction (IPEC SEND, $100)
2. Verify in database
3. Check session drawer balance updated
4. Check daily closing report
5. Check financial reports
6. Check profit calculation

**Verify:**

- [ ] Transaction saved correctly
- [ ] Drawer balance: +8,950,000 LBP
- [ ] Daily report includes transaction
- [ ] Profit calculated correctly
- [ ] All reports consistent

---

### 6.2 Multi-User Concurrent Transactions

**Test Case:** CONCURRENT-001  
**Expected:** No race conditions

**Steps:**

1. User A creates IPEC SEND transaction
2. User B creates IPEC RECEIVE transaction (same time)
3. User C creates KATCH transaction (same time)
4. Verify all rates correct

**Verify:**

- [ ] User A: SELL rate (89,500)
- [ ] User B: BUY rate (89,000)
- [ ] User C: SELL rate (89,500)
- [ ] No conflicts or errors
- [ ] All transactions saved correctly

---

### 6.3 Database Consistency

**Test Case:** DB-001  
**Expected:** All records have correct rates

**Query:**

```sql
-- Check all financial services from today
SELECT
  id,
  provider,
  amount_usd,
  amount_lbp,
  metadata_json->>'$.exchangeRate' as rate,
  created_at
FROM financial_services
WHERE DATE(created_at) = CURDATE()
ORDER BY created_at DESC
LIMIT 20;
```

**Verify:**

- [ ] All IPEC/KATCH/OMT SEND transactions: **89,500**
- [ ] All IPEC/KATCH/OMT RECEIVE transactions: **89,000**
- [ ] No NULL or 0 rates
- [ ] No old localStorage rates (100,000)
- [ ] Metadata JSON structure correct

---

## 7. REGRESSION TESTING

### 7.1 Existing Functionality

**Test Case:** REGRESSION-001  
**Expected:** No broken existing features

**Verify:**

- [ ] POS sales still work correctly
- [ ] Exchange module still works
- [ ] Debt management still works
- [ ] Closing/session still works
- [ ] Reports still accurate
- [ ] No new errors in console
- [ ] No performance degradation

---

### 7.2 Other Modules Using Exchange Rates

**Test Case:** REGRESSION-002  
**Expected:** Other modules unaffected

**Modules to Test:**

- [ ] Exchange page (USD ↔ LBP)
- [ ] Sales/POS (if using multi-currency)
- [ ] Expenses (if using foreign currency)
- [ ] Reports (all financial reports)
- [ ] Settings (exchange rate management)

---

## 8. PERFORMANCE TESTING

### 8.1 Rate Fetching Performance

**Test Case:** PERF-001  
**Expected:** No noticeable delay

**Steps:**

1. Open Recharge page
2. Measure time to load exchange rates
3. Create multiple transactions rapidly

**Verify:**

- [ ] Rates load in < 1 second
- [ ] No UI freezing
- [ ] No excessive API calls
- [ ] Memory usage stable

---

### 8.2 Large Dataset Performance

**Test Case:** PERF-002  
**Expected:** No degradation with many transactions

**Steps:**

1. Create 50+ transactions in session
2. Observe performance
3. Check closing report generation time

**Verify:**

- [ ] No slowdown after many transactions
- [ ] Closing report generates in < 5 seconds
- [ ] No memory leaks
- [ ] Database queries efficient

---

## 9. SIGN-OFF CHECKLIST

### 9.1 Critical Tests (Must Pass)

- [ ] ✅ IPEC SEND uses SELL rate (89,500)
- [ ] ✅ IPEC RECEIVE uses BUY rate (89,000) ⚠️ **CRITICAL**
- [ ] ✅ KATCH uses SELL rate (89,500)
- [ ] ✅ OMT SEND uses SELL rate (89,500)
- [ ] ✅ OMT RECEIVE uses BUY rate (89,000) ⚠️ **CRITICAL**
- [ ] ✅ Whish SEND uses SELL rate (89,500)
- [ ] ✅ Whish RECEIVE uses BUY rate (89,000) ⚠️ **CRITICAL**
- [ ] ✅ Alfa Gift uses SELL rate (89,500)
- [ ] ✅ Refund scenario saves 50,000 LBP per $100 ⚠️ **CRITICAL**
- [ ] ✅ All 13 unit tests pass

### 9.2 Important Tests (Should Pass)

- [ ] Split payment works correctly
- [ ] USD transactions use rate = 1
- [ ] Fallback rate works when API fails
- [ ] Large amounts handled correctly
- [ ] Small amounts handled correctly
- [ ] Multiple items in cart work
- [ ] Database records all correct
- [ ] No regression in other modules

### 9.3 Nice-to-Have Tests (Optional)

- [ ] Rate change mid-session updates
- [ ] Concurrent transactions work
- [ ] Performance tests pass
- [ ] UI rate indicator shows (if implemented)

---

### 9.4 Final Sign-Off

**Testing Completed By:** **\*\*\*\***\_**\*\*\*\***  
**Date:** **\*\*\*\***\_**\*\*\*\***  
**Time Taken:** **\*\*\*\***\_**\*\*\*\***

**Results:**

- Critical Tests: **\_** / 10
- Important Tests: **\_** / 8
- Nice-to-Have Tests: **\_** / 4

**Overall Status:**

- [ ] ✅ PASS - All critical tests pass, ready for production
- [ ] ⚠️ PASS WITH ISSUES - Critical pass, minor issues noted
- [ ] ❌ FAIL - Critical tests failed, not ready for production

**Issues Found:**

```
[List any issues found during testing]
```

**Recommendations:**

```
[List any recommendations for improvement]
```

**Approved for Production:** [ ] YES [ ] NO

**Approved By:** **\*\*\*\***\_**\*\*\*\***  
**Date:** **\*\*\*\***\_**\*\*\*\***

---

## 📊 APPENDIX: QUICK REFERENCE

### Rate Selection Matrix

| Transaction Type | Money Flow | Rate to Use | Value  |
| ---------------- | ---------- | ----------- | ------ |
| IPEC SEND        | IN         | SELL        | 89,500 |
| IPEC RECEIVE     | OUT        | BUY         | 89,000 |
| KATCH Purchase   | IN         | SELL        | 89,500 |
| OMT SEND         | IN         | SELL        | 89,500 |
| OMT RECEIVE      | OUT        | BUY         | 89,000 |
| Whish SEND       | IN         | SELL        | 89,500 |
| Whish RECEIVE    | OUT        | BUY         | 89,000 |
| Alfa Gift        | IN         | SELL        | 89,500 |
| Refund           | OUT        | BUY         | 89,000 |
| Expense          | OUT        | BUY         | 89,000 |
| Debt Repayment   | IN         | SELL        | 89,500 |
| USD Transaction  | N/A        | 1           | 1      |

### Financial Impact Summary

| Scenario      | Wrong Rate     | Correct Rate   | Savings     |
| ------------- | -------------- | -------------- | ----------- |
| $10 Refund    | 895,000 LBP    | 890,000 LBP    | 5,000 LBP   |
| $100 Refund   | 8,950,000 LBP  | 8,900,000 LBP  | 50,000 LBP  |
| $1,000 Refund | 89,500,000 LBP | 89,000,000 LBP | 500,000 LBP |

**Annual Savings (10 refunds/day @ $100):**

```
10 × 50,000 LBP × 365 days = 182,500,000 LBP/year
At 89,500 LBP/USD = ~$2,040 USD/year per shop
```

---

**Document Version:** 1.0  
**Last Updated:** April 1, 2026  
**Maintained By:** Development Team
