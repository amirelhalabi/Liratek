# Financial Services Overhaul — Implementation Plan

> **Status**: PLANNING | **Date**: February 22, 2026  
> **Module**: `omt_whish` → route `/services` → sidebar "OMT/Whish"  
> **Providers**: OMT (includes Western Union as a service type), WHISH

---

## Quick Reference

- **Western Union** = OMT service type (NOT a separate provider). Same drawer, same supplier, same flow.
- **OMT_System** = physical cash envelope. **Whish_System** = virtual drawer only.
- The shop has exactly **2 physical drawers**: General (cash register) + OMT System (cash envelope).
- SEND (In) = 3-drawer movement. RECEIVE (Out) = 2-drawer movement.
- Profits filterable by **provider** (OMT vs WHISH) and by **omt_service_type** (Western Union vs Bill Payment, etc.).
- Payment method surcharge (1% default) applies to Binance / WHISH-to-WHISH / OMT Wallet across ALL modules.

---

## 1. Problems to Fix

| # | Problem | Fix |
|---|---------|-----|
| P1 | RECEIVE debits General instead of OMT_System | Rewrite drawer logic (3-drawer flow) |
| P2 | No cash-reserve for non-cash payments | 3-drawer movement: General → System drawer |
| P3 | Commission manually entered | Auto-calculate from OMT fee schedule (10% of fee) |
| P4 | `BILL_PAYMENT` in `service_type` column | Remove it (separate from `omt_service_type` Bill Payment) |
| P5 | UI only supports single payment method | Add multi-payment (backend already supports it) |
| P6 | Western Union missing | Add as `omt_service_type` value (8th option in dropdown) |
| P7 | No "including fees" toggle | Add checkbox for SEND (In) transactions |
| P8 | No cross-module transaction history page | Add filterable history page (by drawer, module) |
| P9 | supplier_ledger always TOP_UP for both SEND and RECEIVE | RECEIVE should decrease supplier debt (discovered in 8.2) |

---

## 2. Terminology

| UI Label | Direction | What happens |
|----------|-----------|--------------|
| **Send (In)** | Customer → Shop → OMT | Shop takes money, sends via OMT system |
| **Receive (Out)** | OMT → Shop → Customer | Shop gives cash to customer on behalf of OMT |

### OMT Service Types (`omt_service_type` column)

All share the same provider (OMT), drawer (OMT_System), and supplier:

1. Bill Payment
2. Cash To Business
3. Ministry of Interior
4. Cash Out
5. Ministry of Finance
6. INTRA
7. Online Brokerage
8. **Western Union** ← new

---

## 3. Drawer Movement Rules

### Core Rule

> External system drawers represent **cash the shop owes** to the company. Settlement is always in **cash**. Therefore the system drawer must reflect cash, regardless of how the customer paid.

### SEND (In) — 3-Drawer Movement

**Non-cash payment** (e.g. $100 via Binance):

| # | Drawer | Delta | Why |
|---|--------|-------|-----|
| 1 | Binance | +$100 | Customer's payment received |
| 2 | General | -$100 | Cash reserved for OMT settlement |
| 3 | OMT_System | +$100 | Amount owed to OMT company |

**Cash payment** ($100 cash): General +$100 then -$100 = net $0. Only OMT_System +$100. Optimize to skip the cancel-out.

**Multi-payment** ($60 cash + $40 Binance):

| # | Drawer | Delta | Why |
|---|--------|-------|-----|
| 1 | General | +$60 | Cash leg |
| 2 | Binance | +$40 | Binance leg |
| 3 | General | -$100 | Full amount reserved |
| 4 | OMT_System | +$100 | Full amount owed |

Net: General = -$40, Binance = +$40, OMT_System = +$100.

### RECEIVE (Out) — 2-Drawer Movement

Shop gives $100 cash to customer:

| # | Drawer | Delta | Why |
|---|--------|-------|-----|
| 1 | General | -$100 | Cash paid to customer |
| 2 | OMT_System | -$100 | OMT now owes shop |

> RECEIVE always pays cash from General. Payment method selector is irrelevant.

### WHISH — Investigation Complete (see 8.7)

**VERDICT**: WHISH tracking is **broken in the same way as OMT** — Whish_System never touched, everything routes to Whish_App. Fix with **2-drawer** movement (no General involvement, no physical drawer):

- SEND: Whish_App +amount (payment received) + Whish_System +amount (owed to company)
- RECEIVE: Whish_System -amount (company settled)
- No General drawer involvement. No cash reminder.

---

## 4. Profit & Fee Rules

### OMT Profit (BLOCKED — awaiting fee schedule from user)

- Static fee schedule based on amount ranges
- Formula: `shop_profit = omt_fee(amount) × 0.10`
- Auto-calculated in backend, stored in `commission` column
- Commission input field removed from UI
- Western Union: same 10% rule, but fee schedule may differ by `omt_service_type` — `getOmtFee()` should accept service type as parameter
- The fee structure must support per-`omt_service_type` lookup (e.g. INTRA fees vs Western Union fees may differ)

```
OMT Fee Schedule (example — user to provide actual data):

omt_service_type: INTRA (and others unless specified differently)
  Amount Range ($)  →  Fee ($)  →  Profit (10%)
  1 - 100           →  1.00     →  0.10
  101 - 200         →  ???      →  ???
  ...

omt_service_type: Western Union (if different from standard OMT)
  Amount Range ($)  →  Fee ($)  →  Profit (10%)
  TBD               →  TBD      →  TBD
```

> **BLOCKED**: User to provide the full OMT fee schedule. Clarify if Western Union has a different fee table.

### WHISH Profit — TBD

- Rules undefined. Works as-is until defined.

### Payment Method Surcharge [T-55] — All Modules

Certain payment methods charge the customer an extra fee:

| Method | Default % | Editable per tx? | Drawer |
|--------|-----------|------------------|--------|
| Binance | 1% | Yes | Binance |
| WHISH-to-WHISH | 1% | Yes | Whish_App |
| OMT Wallet | 1% | Yes | OMT_App |
| Cash / other | 0% | N/A | — |

Rules:
- Default stored in config/DB, not hardcoded
- Override per-transaction only — does NOT change stored default
- Surcharge creates a **separate drawer transaction** in the payment method's drawer
- Applies in **all modules** (POS, Financial Services, Exchange, etc.)

---

## 5. UI Behavior

### Services Page Form Layout (Left Panel)

Top to bottom, the left panel form fields:

1. **Amount field** — with currency symbol (`$` or `ل.ل`) shown to the LEFT of the input (same pattern as Exchange page). No separate currency toggle/selector — currency is indicated by the symbol prefix.
2. **OMT Service dropdown** + **Paid By dropdown** — side by side on the FIRST row under amount
   - OMT Service: default = **INTRA** (only shown for OMT provider, hidden for WHISH)
   - Paid By: default = **Cash** (NOT OMT Wallet)
3. **"Including Fees" checkbox** — visible for SEND (In) only
4. **Client Name** + **Phone #** — side by side (optional)
5. **Reference #** (optional)

> **Note**: The separate currency field/toggle is removed. Currency is determined by the symbol shown next to the amount.

### Cash-Reserve Reminder (OMT Only — NOT WHISH)

**Trigger**: OMT transaction saved successfully + at least one non-cash payment leg.

**Message**: _"Reminder: This transaction was paid via Binance. Please move **$100 cash** from the General drawer to the OMT System drawer to complete the reserve."_

Rules:
- Informational only — drawer movements already recorded automatically
- Mixed cash/non-cash: remind only for the non-cash portion
- RECEIVE: no reminder (cash always from General)
- 100% cash: no reminder
- WHISH: never shows reminder (no physical drawer)

---

## 6. Confirmed Decisions

| # | Topic | Decision |
|---|-------|----------|
| D1 | SEND drawer movement | 3-drawer: payment-method +amount, General -amount, System +amount |
| D2 | RECEIVE drawer movement | 2-drawer: General -amount, System -amount |
| D3 | General = physical cash? | Yes. General = till. System = cash envelope. Payment drawer = tracking. |
| D4 | Does "paid by" affect System drawer? | No. System drawer always gets full amount. |
| D7 | Valid payment methods | All methods valid in any module. No restrictions. |
| D8 | Profit view granularity | Per-provider (OMT/WHISH) AND within OMT filterable by `omt_service_type` |
| D9 | WHISH UI cash reminder | No. No physical WHISH drawer. Only OMT shows reminder. |
| D10 | WHISH drawer movement | 2-drawer (NOT 3). Payment drawer + Whish_System. No General. See 8.7 findings. |
| D11 | Western Union approach | OMT service type. NOT a separate provider/supplier/tab/card. |
| D12 | OMT Service default | INTRA selected by default when OMT provider is active |
| D13 | Paid By default | Cash selected by default (not OMT Wallet) |
| D14 | Currency field | Removed. Currency symbol shown to left of amount input (same as Exchange page). |
| D15 | Form field order | Row 1: Amount (with $ symbol). Row 2: OMT Service + Paid By side by side. Then: Including Fees, Client+Phone, Reference. |

---

## 7. Open Questions

### Blocks Phase 2 (Auto-Profit)

| # | Question |
|---|----------|
| Q4 | Does the shop earn profit on **RECEIVE** transactions? Or only on SEND? |
| Q5 | Are OMT fees always in **USD**? Or does an LBP transaction have LBP fees? |
| Q6 | "Including fees" checkbox: if customer gives $101 for $100 send — is the $1 the OMT company fee (shop keeps 10% = $0.10)? Or does $1 go straight to commission? |
| Q8 | **WHISH profit** — fee schedule coming? Or always manual commission? |

### Blocks Phase 3 (Multi-Payment)

| # | Question |
|---|----------|
| Q14 | Can a customer pay part as **debt**? If yes, `clientId` required when any leg is DEBT. |

### Blocks Phase 4 (Currency)

| # | Question |
|---|----------|
| Q16 | LBP transactions — does fee schedule change? Or always USD-based and converted? |
| Q17 | Do we store the **exchange rate** used at time of LBP transaction? |

### Reporting

| # | Question |
|---|----------|
| Q19 | Daily closing — break down profits by `omt_service_type`? Or just total OMT profit? |

---

## 8. Pre-Implementation Investigation — FINDINGS

> Audit completed February 22, 2026. All findings include file paths and line numbers.

### 8.1 Drawer Flow Audit

**Call chain**: Frontend `handleSubmit()` → `api.addOMTTransaction(data)` → `FinancialService.addTransaction(data)` ([FinancialService.ts:52](packages/core/src/services/FinancialService.ts#L52)) → `FinancialServiceRepository.createTransaction(data)` ([FinancialServiceRepository.ts:170](packages/core/src/repositories/FinancialServiceRepository.ts#L170))

**Legacy flow (OMT/WHISH)** — [FinancialServiceRepository.ts:370-420](packages/core/src/repositories/FinancialServiceRepository.ts#L370):
```
sign = serviceType === "SEND" ? -1 : 1
drawerName = paidByMethod ? paymentMethodToDrawerName(paidByMethod) : mapDrawerName(provider)
delta = sign * |amount|
```

- [x] **OMT SEND trace**: Frontend sends `paidByMethod: "OMT"` (default). `paymentMethodToDrawerName("OMT")` → `"OMT_App"`. delta = -amount. → **OMT_App DECREASES**. Commission: separate +commission to same drawer.
- [x] **OMT RECEIVE trace**: Same drawer (OMT_App), delta = +amount. → **OMT_App INCREASES**.
- [x] **CRITICAL BUG CONFIRMED**: OMT_System is **NEVER touched** by transactions. The code routes everything through the payment-method drawer (OMT_App). This is because the frontend always sets `paidByMethod = "OMT"` (default from `PROVIDER_DEFAULT_METHOD`). If paidByMethod were unset, mapDrawerName("OMT") → "OMT_System" would be used, but the frontend never triggers this path.

**mapDrawerName()** — [FinancialServiceRepository.ts:133-148](packages/core/src/repositories/FinancialServiceRepository.ts#L133):
| Provider | Drawer |
|----------|--------|
| OMT | OMT_System |
| WHISH | Whish_System |
| IPEC | IPEC |
| KATCH | Katch |
| WISH_APP | Whish_App |
| OMT_APP | OMT_App |
| BINANCE | Binance |
| BOB/OTHER | General |

**paymentMethodToDrawerName()** — [payments.ts:38](packages/core/src/utils/payments.ts#L38):
Looks up `payment_methods` DB table first, fallback map:
| Method | Drawer |
|--------|--------|
| CASH | General |
| OMT | OMT_App |
| WHISH | Whish_App |
| BINANCE | Binance |
| DEBT | General (no drawer affect) |

- [x] **Payment rows per tx**: 1 for amount + 1 for commission = **2 rows** per legacy transaction.
- [x] **paidByMethod="OMT"**: Maps to **OMT_App** (NOT OMT_System). This is the root cause of P1.
- [x] **currency_drawers**: Global table, not per-module. `omt_whish` has USD in `currency_modules`. All drawers mapped in [create_db.sql:637-648](electron-app/create_db.sql#L637).
- [x] **General drawer**: Always exists. Seeded at [create_db.sql:433-434](electron-app/create_db.sql#L433) with USD=0, LBP=0.
- [x] **Cash reserve pattern**: NO other module does multi-drawer reserve. POS/Maintenance only touch the payment method drawer. Closest pattern: change_given in [SalesRepository.ts:377-395](packages/core/src/repositories/SalesRepository.ts#L377).
- [x] **Negative General**: **YES, can go negative.** No CHECK constraint on `drawer_balances.balance`. Column is `balance REAL NOT NULL DEFAULT 0` — no floor.

### 8.2 Supplier / Settlement Audit

- [x] **Suppliers with module_key='omt_whish'**: 2 suppliers — `OMT` (provider='OMT') and `Whish` (provider='WHISH'). Defined at [create_db.sql:681-682](electron-app/create_db.sql#L681).
- [x] **supplier_ledger on SEND vs RECEIVE**: **BUG** — Both SEND and RECEIVE create `entry_type='TOP_UP'` with **positive** amount. See [FinancialServiceRepository.ts:432-444](packages/core/src/repositories/FinancialServiceRepository.ts#L432). RECEIVE should reduce supplier debt but doesn't.
- [x] **Settlement cards query**: Uses `getSupplierBalances()` → [SupplierRepository.ts:250-260](packages/core/src/repositories/SupplierRepository.ts#L250) which sums `supplier_ledger` per supplier (NOT per drawer). So settlement is supplier-based.
- [x] **Western Union**: Uses same OMT supplier. No separate supplier row needed. ✓

### 8.3 Profit Reporting Audit

- [x] **ProfitService** queries `financial_services.commission` in 3 places:
  - `getSummary()` → [ProfitService.ts:186](packages/core/src/services/ProfitService.ts#L186) — groups by currency
  - `getByModule()` → [ProfitService.ts:420](packages/core/src/services/ProfitService.ts#L420) — groups by **provider** (creates `FINANCIAL_SERVICE_OMT`, `FINANCIAL_SERVICE_WHISH`, etc.)
  - `getByUser()`/`getByClient()` → [ProfitService.ts:745,799](packages/core/src/services/ProfitService.ts#L745) — correlated subquery
- [x] **ClosingRepository**: SUM(commission) from financial_services WHERE today. [ClosingRepository.ts:438-439](packages/core/src/repositories/ClosingRepository.ts#L438). **No breakdown** by provider or omt_service_type.
- [x] **GROUP BY omt_service_type**: NOT implemented anywhere. Would need new queries.
- [x] **getOMTAnalytics**: Groups by provider+currency only. [FinancialServiceRepository.ts:500+](packages/core/src/repositories/FinancialServiceRepository.ts#L500). No omt_service_type breakdown.

### 8.4 Multi-Payment Audit

- [x] **Modules with multi-payment UI**: POS (`CheckoutModal`) and Maintenance (reuses POS `CheckoutModal`).
- [x] **CheckoutModal pattern** — [CheckoutModal.tsx:1-200](frontend/src/features/sales/pages/POS/components/CheckoutModal.tsx#L1):
  - `PaymentLine = { id: string, method: string, currency_code: "USD"|"LBP", amount: number }`
  - Uses `usePaymentMethods()` hook to get dynamic methods from DB
  - State: `paymentLines: PaymentLine[]`, starts with 1 CASH line
  - Add/remove rows, method dropdown, currency toggle, amount input
- [x] **Shared component?**: No shared component exists. CheckoutModal is POS-specific (has cart items, change calculation, receipt printing). Need to extract core payment row logic OR build simpler inline version for Services page.
- [x] **Backend `payments[]` format**: `{ method: string, currencyCode: string, amount: number }[]`. Already supported in FinancialServiceRepository for both legacy and cost/price flows.

### 8.5 Migration Patterns

- [x] **Current DB version**: 25 (`merge_binance_into_financial_services`)
- [x] **financial_services rebuilt**: Twice before — v14 (add cost/price columns + OMT_APP) and v25 (add BINANCE). Both used the established pattern:
  1. `ALTER TABLE financial_services RENAME TO financial_services_migrate`
  2. `CREATE TABLE financial_services (... new CHECK ...)`
  3. `INSERT INTO financial_services SELECT ... FROM financial_services_migrate`
  4. `DROP TABLE financial_services_migrate`
  5. Recreate indexes
- [x] **SQLite limitation confirmed**: Cannot ALTER CHECK constraints. Full table rebuild required.
- [x] **Combined migration plan**: v26 can do both changes in one rebuild:
  - `service_type CHECK('SEND','RECEIVE')` — remove BILL_PAYMENT
  - `omt_service_type CHECK(... 'WESTERN_UNION')` — add 8th value
  - Handle existing BILL_PAYMENT rows (migrate to SEND or skip if none)

### 8.6 Cash-Reserve Prerequisites

- [x] **General = cash**: Confirmed. CASH method → General via [payment_methods seed](electron-app/create_db.sql#L671). Drawer seeded at [line 433](electron-app/create_db.sql#L433).
- [x] **CASH → General**: `paymentMethodToDrawerName("CASH")` → "General". ✓
- [x] **Atomicity**: YES. All drawer updates are inside `this.db.transaction(() => { ... })()` at [FinancialServiceRepository.ts:174](packages/core/src/repositories/FinancialServiceRepository.ts#L174). Fully atomic.
- [x] **Daily closing**: Each drawer is a separate row in `daily_closings` table (has `drawer_name` column). OMT_System and General are independent. [create_db.sql:454](electron-app/create_db.sql#L454).
- [x] **Negative allowed**: YES. No constraint prevents General from going negative.
- [x] **Current payment rows**: 2 per tx (amount + commission). New 3-drawer flow will create 3-4 rows (payment-method +amount, General -amount, System +amount, optional commission).

### 8.7 WHISH Tracking — VERDICT

**Current WHISH flow**: Same legacy code path as OMT.
- Frontend default: `paidByMethod = "WHISH"` → `paymentMethodToDrawerName("WHISH")` → **Whish_App**
- SEND: Whish_App -amount. RECEIVE: Whish_App +amount.
- **Whish_System is NEVER touched** (same problem as OMT_System).

**Settlement card**: Uses supplier_ledger balance (supplier "Whish"), NOT drawer_balances. So Whish_System balance in drawer_balances is always 0.

**Same bugs as OMT**:
1. Drawer movement goes to Whish_App instead of Whish_System
2. Supplier ledger always positive TOP_UP regardless of direction

**VERDICT: YES, implement matched drawer fix for WHISH** — same as OMT but **without 3-drawer reserve** (no physical WHISH drawer).

Correct WHISH flow:
- SEND: Whish_App +amount (payment received), Whish_System +amount (owed to WHISH company)
- RECEIVE: Whish_System -amount (WHISH settled)
- No General involvement (no physical drawer, no cash reserve needed)
- 2-drawer movement, not 3-drawer

---

### Summary of Critical Findings

| # | Finding | Impact |
|---|---------|--------|
| F1 | OMT_System/Whish_System NEVER touched by transactions | System drawers always show $0 — settlement tracking via drawers is broken |
| F2 | `paidByMethod` routes to OMT_App/Whish_App, not system drawers | Root cause of F1 — frontend always sets payment method |
| F3 | `supplier_ledger` always TOP_UP positive for both SEND and RECEIVE | Settlement balance only goes UP — never decreases on RECEIVE |
| F4 | No other module does multi-drawer reserve pattern | 3-drawer flow is new architecture — no existing pattern to copy |
| F5 | General can go negative — no constraint | SEND with non-cash payment may push General negative if insufficient cash |
| F6 | Profit queries don't break down by `omt_service_type` | Need new queries for per-service-type reporting |
| F7 | Table rebuild pattern well-established (v14, v25) | Migration v26 is straightforward — same pattern |
| F8 | CheckoutModal is POS-specific, not reusable directly | Need simpler inline multi-payment for Services page |
| F9 | UI labels: SEND="Out", RECEIVE="In" — from customer's perspective | Matches plan business logic, just different naming perspective |

---

## 9. Implementation Phases

### Phase 1: 3-Drawer Cash-Reserve + Remove BILL_PAYMENT + Add Western Union Service Type ✅ DONE

**Backend — Drawer Logic** ([FinancialServiceRepository.ts](packages/core/src/repositories/FinancialServiceRepository.ts))

- [x] Rewrite legacy drawer logic (3-drawer OMT, 2-drawer WHISH):
  - OMT SEND (In): (1) payment drawer +amount, (2) General -amount, (3) OMT_System +amount
  - OMT SEND cash: General -amount (net 0 with cash +amount), OMT_System +amount
  - OMT RECEIVE (Out): (1) General -amount, (2) OMT_System -amount
  - WHISH SEND: (1) payment drawer +amount, (2) Whish_System +amount (NO General)
  - WHISH RECEIVE: (1) Whish_System -amount (NO General)
  - Commission routed to "General" drawer for OMT/WHISH
- [x] Multi-payment: each leg credits its drawer, General debited for full, System gets full
- [x] Fix supplier_ledger sign: RECEIVE → entry_type='PAYMENT' (negative via SupplierRepository sign)

**Backend — Schema Changes**

- [x] Remove `BILL_PAYMENT` from `service_type` CHECK in `create_db.sql`
- [x] Add `'WESTERN_UNION'` to `omt_service_type` CHECK in `create_db.sql`
- [x] Migration v26: combined table rebuild for both CHECK changes
  - Existing BILL_PAYMENT rows migrated to SEND
  - `omt_service_type` Bill Payment NOT affected (separate concept)

**Frontend**

- [x] Remove "Bill" service type button from Services/index.tsx and Recharge/index.tsx
- [x] Update `ServiceType` type to `"SEND" | "RECEIVE"` only (Services, Recharge, electron.d.ts, preload.ts)
- [x] Add Western Union to OMT_SERVICE_OPTIONS with Globe icon
- [x] Default paidByMethod → CASH, default omtServiceType → INTRA

**Validators**

- [x] Remove `BILL_PAYMENT` from Zod `service_type` enum in `packages/core/src/validators/financial.ts`
- [x] Add `WESTERN_UNION` to Zod `omt_service_type` enum

**Tests**: 328 passed, 21 suites (including 44 FinancialService tests). TypeScript: 0 errors.

### Phase 2: Auto-Profit Calculation (BLOCKED: awaiting OMT fee schedule)

> **Full plan**: [PHASE2_OMT_FEES.md](PHASE2_OMT_FEES.md) — strategy pattern architecture, per-service-type
> fee schedules, edge cases, testing plan, and implementation checklist.

**Summary**: Each of the 8 OMT service types gets its own fee calculator (flat, percentage,
tiered, or composite). The `FeeCalculator` class uses the strategy pattern to dispatch to
the correct implementation. Shop profit = fee × commission rate (configurable per service).

**Blocked on**: Fee data for all 8 service types from Amir.

### Phase 3: Multi-Payment Method Support

**Backend**: Already supports `data.payments[]` — no changes.

**Frontend**

- [ ] Replace "Paid By" dropdown with multi-payment component
- [ ] User enters 1 amount, allocates across payment methods
- [ ] Each leg affects its respective drawer
- [ ] DEBT leg creates debt ledger entry (requires client selection)
- [ ] "Including Fees" checkbox for SEND (In) only:
  - Checked: entered amount includes fee → backend deducts
  - Unchecked: entered amount is net → fee added on top

### Phase 4: Transaction History Page [T-56]

- [ ] New page: cross-module transaction history
- [ ] Filterable by **drawer** (General, OMT_System, Binance, Whish_System, etc.)
- [ ] Filterable by **module** (POS, Financial Services, Exchange, etc.)
- [ ] Shows all transactions across the system in chronological order
- [ ] Columns: date, module, drawer, amount, payment method, reference, etc.
- [ ] Export: Excel + PDF

### Phase 5: Currency Handling

- [ ] Transactions are either LBP or USD (not both)
- [ ] Currency selector: radio/toggle
- [ ] All amounts in chosen currency
- [ ] Fee schedule may differ by currency (TBD)

---

## 10. Database Changes

```sql
-- Combined in one migration (SQLite table rebuild):
-- 1. service_type CHECK: remove BILL_PAYMENT → only SEND, RECEIVE
-- 2. omt_service_type CHECK: add 'Western Union' (8th value)
-- 3. No new columns (commission already exists)
-- 4. No new provider (Western Union uses OMT provider)
```

---

## 11. Known Concerns

### Activity Log Row Duplication

3-drawer flow creates 2-3 drawer changes per transaction → may show 3 activity log rows for one action.

**Status**: Investigate after implementation. Not a blocker.

**Plan**: (1) Test row count, (2) Study schema, (3) Evaluate grouping/collapsing, (4) Decide UX fix. Functional correctness first.

---

## 12. Blocked / Awaiting Input

| Item | Status | Owner |
|------|--------|-------|
| OMT fee schedule (all ranges & fees) | **BLOCKED** | User to provide |
| Western Union fee schedule (if different from OMT) | **BLOCKED** | User to confirm |
| WHISH fee schedule & profit rules | **BLOCKED** | User to define later |
| RECEIVE profit rule | **BLOCKED** | User: "to be determined" |

---

## 13. Test Checklist

### Layout

- [ ] Sidebar "OMT/Whish" → opens /services
- [ ] Title: "Financial Services"
- [ ] Stats row: Today's Earnings, Monthly Earnings, OMT Settlement, WHISH Settlement

### Provider Tabs

- [ ] OMT (yellow) — default
- [ ] WHISH (red)
- [ ] NO Western Union tab (it's in the OMT service type dropdown)

### Service Types

- [ ] Two buttons only: **Out** (Send), **In** (Receive)
- [ ] No "Bill" button
- [ ] OMT Service dropdown: 8 options including Western Union

### Form

- [ ] Amount field with currency symbol (`$` or `ل.ل`) to the LEFT (same as Exchange page)
- [ ] No separate currency toggle/selector field
- [ ] No commission field (auto-calculated)
- [ ] First row under amount: **OMT Service dropdown** + **Paid By dropdown** side by side
- [ ] OMT Service default: **INTRA**
- [ ] Paid By default: **Cash**
- [ ] "Including Fees" checkbox: SEND only
- [ ] Multi-payment support
- [ ] Client Name + Phone (optional)
- [ ] Reference # (optional)
- [ ] OMT Service dropdown (OMT provider only, 8 options incl. Western Union)

### Drawer Effects

- [ ] SEND cash: General net $0, OMT_System +amount
- [ ] SEND Binance: Binance +amount, General -amount, OMT_System +amount
- [ ] SEND WHISH app: Whish_App +amount, General -amount, OMT_System +amount
- [ ] RECEIVE: General -amount, OMT_System -amount
- [ ] General never left unaccounted
- [ ] Western Union SEND: same as OMT, `omt_service_type = 'Western Union'`

### Profit

- [ ] OMT SEND: profit = 10% of fee → `commission` column
- [ ] History shows auto-calculated profit
- [ ] Analytics cards correct

### Settlement Cards

- [ ] OMT: bidirectional USD balance
- [ ] WHISH: bidirectional USD balance
- [ ] LBP shown when non-zero
- [ ] Persists after refresh

### History

- [ ] Columns: provider badge, type, amount, profit, client/phone, date
- [ ] Excel export
- [ ] PDF export

### Edge Cases

- [ ] All fields filled → stored correctly
- [ ] Only required fields → succeeds
- [ ] Multi-payment $60 cash + $40 Binance → General -$40, Binance +$40, OMT_System +$100
- [ ] Single cash $100 → General $0, OMT_System +$100
- [ ] Long phone (30 chars) → accepted
- [ ] App restart → data persists
