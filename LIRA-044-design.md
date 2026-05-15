# LIRA-044: Full Cashout Method Parity — Design & Implementation Guide

> **Status:** Ready for Implementation  
> **Priority:** High  
> **Dependencies:** None (LIRA-030, LIRA-037 already done)  
> **Date:** 2026-05-15

---

## Concept

When a customer does a RECEIVE transaction (e.g., incoming $50 Whish), the shop pays them out. Currently only Cash or Customer Account. This ticket adds OMT Wallet, Whish Wallet, and Binance as cashout options.

**Key decision:** Cashout = simple drawer debit on the RECEIVE record. No linked SEND transaction is created. The RECEIVE record itself is the audit trail.

---

## Cashout Methods

| Code               | Label            | Debits Drawer              | Notes           |
| ------------------ | ---------------- | -------------------------- | --------------- |
| `CASH`             | Cash             | General                    | Current default |
| `CUSTOMER_ACCOUNT` | Customer Account | — (credits client balance) | Existing        |
| `OMT`              | OMT Wallet       | OMT_App                    | NEW             |
| `WHISH`            | Whish Wallet     | Whish_App                  | NEW             |
| `BINANCE`          | Binance          | Binance                    | NEW             |

These mirror the existing **payment methods** (customer → shop) but in reverse (shop → customer).

---

## Why No Linked Transaction

- OMT App, Whish App, and Binance SEND all have **optional fees (can be 0)**
- No mandatory fees are "lost" without a SEND record
- The RECEIVE record shows the cashout method used — fully traceable
- Simpler implementation, fewer moving parts

---

## Implementation Steps

### Step 1: Backend Validator

**File:** `packages/core/src/validators/financial.ts` (line ~86)

Change:

```typescript
// FROM:
cashoutMethod: z.enum(["CASH", "CUSTOMER_ACCOUNT"]);

// TO:
cashoutMethod: z.enum(["CASH", "CUSTOMER_ACCOUNT", "OMT", "WHISH", "BINANCE"]);
```

---

### Step 2: Backend Repository Type

**File:** `packages/core/src/repositories/FinancialServiceRepository.ts` (line ~161)

Change the type union:

```typescript
// FROM:
cashoutMethod?: "CASH" | "CUSTOMER_ACCOUNT"

// TO:
cashoutMethod?: "CASH" | "CUSTOMER_ACCOUNT" | "OMT" | "WHISH" | "BINANCE"
```

---

### Step 3: Backend Drawer Logic — RECEIVE Paths

**File:** `packages/core/src/repositories/FinancialServiceRepository.ts`

There are **two RECEIVE code paths** that need updating:

#### Path A: Binance RECEIVE (around line ~702-733)

Currently checks `cashoutMethod`:

- `CUSTOMER_ACCOUNT` → credits client balance
- `CASH` (default) → debits General drawer

Add new branches:

```typescript
} else if (cashoutMethod === "OMT") {
  // Debit OMT_App drawer
} else if (cashoutMethod === "WHISH") {
  // Debit Whish_App drawer
} else if (cashoutMethod === "BINANCE") {
  // Debit Binance drawer (edge case: Binance RECEIVE, cashout via Binance = no net movement on Binance drawer — may want to block this)
}
```

#### Path B: OMT/Whish RECEIVE (around line ~1318-1386)

Same pattern — add branches for OMT/WHISH/BINANCE cashout that debit the mapped drawer instead of General.

**Drawer mapping helper** (create if useful):

```typescript
const CASHOUT_DRAWER_MAP: Record<string, string> = {
  CASH: "General",
  OMT: "OMT_App",
  WHISH: "Whish_App",
  BINANCE: "Binance",
};
```

**Important:** When `cashoutMethod` is not `CASH`, do NOT debit General drawer. Only debit the mapped drawer.

---

### Step 4: Frontend — CashoutMethodPicker Component

**Create:** `frontend/src/features/services/components/CashoutMethodPicker.tsx`

A reusable component that:

- Shows buttons/dropdown for: Cash, Customer Account, OMT Wallet, Whish Wallet, Binance
- Only shows "Customer Account" if a client is selected (existing logic)
- Returns the selected cashout method code
- Styled consistently with existing payment method selectors

**Props:**

```typescript
interface CashoutMethodPickerProps {
  value: string;
  onChange: (method: string) => void;
  showCustomerAccount?: boolean; // only when client is selected
}
```

**Data source:** Can hardcode the options or load from `payment_methods` table (already seeded with matching codes/labels).

---

### Step 5: Frontend — Add Picker to RECEIVE Forms

**File:** `frontend/src/features/services/pages/Services/index.tsx`

When `serviceType === "RECEIVE"`, show the `CashoutMethodPicker` instead of (or in addition to) the current payment method logic.

Currently (around line ~835-836), cashout is derived:

```typescript
cashoutMethod: paidByMethod === "DEBT" ? "CUSTOMER_ACCOUNT" : "CASH";
```

Replace with explicit picker selection. The picker should appear on ALL RECEIVE forms:

- OMT System RECEIVE
- Whish System RECEIVE
- OMT App RECEIVE
- Whish App RECEIVE
- Binance RECEIVE

---

### Step 6: Frontend — SessionCheckoutModal

**File:** `frontend/src/features/services/components/SessionCheckoutModal.tsx` (line ~107-110)

Currently restricts RECEIVE to "CASH and DEBT only". Remove this restriction to allow all cashout methods.

---

### Step 7: Rebuild & Test

```bash
# Rebuild core
cd packages/core && npm run build

# Typecheck
yarn typecheck

# Lint
yarn lint

# Build
yarn build

# Test backend
yarn workspace @liratek/backend test
```

---

## Edge Cases to Handle

1. **Binance RECEIVE + Binance cashout:** Customer receives Binance, wants payout in Binance — this is a no-op on Binance drawer (credits then debits same drawer). Consider blocking this combination or just allowing it (net zero).

2. **Partner transactions:** Partner RECEIVE should also show the cashout picker. The partner settles separately — the cashout method here is how the shop pays the partner's customer (or the partner themselves).

3. **Currency:** Ensure the cashout drawer debit uses the correct currency. OMT_App and Whish_App have both USD and LBP. Binance is USD only.

4. **Insufficient drawer balance:** Currently no validation on drawer balance. Decide if you want to warn (not block) when a drawer would go negative.

---

## Files to Modify (Summary)

| File                                                                 | Change                                  |
| -------------------------------------------------------------------- | --------------------------------------- |
| `packages/core/src/validators/financial.ts`                          | Expand cashout enum                     |
| `packages/core/src/repositories/FinancialServiceRepository.ts`       | Expand type + add drawer logic branches |
| `frontend/src/features/services/components/CashoutMethodPicker.tsx`  | NEW — reusable component                |
| `frontend/src/features/services/pages/Services/index.tsx`            | Add picker to RECEIVE forms             |
| `frontend/src/features/services/components/SessionCheckoutModal.tsx` | Remove RECEIVE restriction              |

---

## Verification Checklist

- [ ] Validator accepts OMT, WHISH, BINANCE as cashout methods
- [ ] RECEIVE with cashout=OMT debits OMT_App drawer (not General)
- [ ] RECEIVE with cashout=WHISH debits Whish_App drawer (not General)
- [ ] RECEIVE with cashout=BINANCE debits Binance drawer (not General)
- [ ] RECEIVE with cashout=CASH still debits General (no regression)
- [ ] RECEIVE with cashout=CUSTOMER_ACCOUNT still credits client balance
- [ ] CashoutMethodPicker appears on all RECEIVE forms
- [ ] SessionCheckoutModal allows all cashout methods for RECEIVE
- [ ] Partner RECEIVE transactions also support all cashout methods
- [ ] Typecheck passes
- [ ] Lint passes
- [ ] Build succeeds
- [ ] Backend tests pass
