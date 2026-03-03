# Financial Services Architecture Analysis

**Date**: February 24, 2026 (updated)
**Scope**: Database vs code implementation of financial modules, best practices recommendations
**Status**:

- ✅ Phase 1 complete — 3-drawer OMT, 2-drawer WHISH, BILL_PAYMENT removed, Western Union added
- ✅ Phase 2 backend complete — Auto-calculation, fee schedules, service types updated
- 🚧 Phase 2 frontend pending — UI updates for fee input and commission preview

---

## 1. Database Tables: What Exists

### 1a. `financial_services` — The Multi-Provider Table

| Column             | Type               | Notes                                                                         |
| ------------------ | ------------------ | ----------------------------------------------------------------------------- |
| `id`               | INTEGER PK         | Auto-increment                                                                |
| `provider`         | TEXT               | CHECK: `OMT, WHISH, BOB, OTHER, IPEC, KATCH, WISH_APP, OMT_APP` (8 providers) |
| `service_type`     | TEXT               | CHECK: `SEND, RECEIVE` (BILL_PAYMENT removed in migration v26)                |
| `amount`           | DECIMAL(10,2)      | Transaction amount                                                            |
| `currency`         | TEXT               | DEFAULT `'USD'` — **note: named `currency`, not `currency_code`**             |
| `commission`       | DECIMAL(10,2)      | For legacy flow; auto-calculated as `price - cost` for cost/price flow        |
| `cost`             | DECIMAL(10,2)      | Shop pays provider (IPEC/Katch/WishApp/OMT_APP)                               |
| `price`            | DECIMAL(10,2)      | Customer pays shop                                                            |
| `paid_by`          | TEXT               | Payment method code                                                           |
| `client_id`        | INTEGER FK→clients |                                                                               |
| `client_name`      | TEXT               | Denormalized                                                                  |
| `reference_number` | TEXT               |                                                                               |
| `phone_number`     | TEXT               | Added by T-30                                                                 |
| `omt_service_type` | TEXT               | CHECK: 8 OMT sub-types (updated v27). Added by T-30                           |
| `omt_fee`          | DECIMAL(10,2)      | OMT's fee (user-entered). Added by migration v28                              |
| `profit_rate`      | DECIMAL(6,5)       | For ONLINE_BROKERAGE (0.1%-0.4%). Added by migration v28                      |
| `pay_fee`          | INTEGER            | BINANCE fee checkbox (0 or 1). Added by migration v28                         |
| `item_key`         | TEXT               | Links to mobileServices catalog                                               |
| `note`             | TEXT               |                                                                               |
| `created_at`       | DATETIME           |                                                                               |
| `created_by`       | INTEGER            |                                                                               |

### 1b. `binance_transactions` — Standalone Table

| Column          | Type             | Notes                                                              |
| --------------- | ---------------- | ------------------------------------------------------------------ |
| `id`            | INTEGER PK       |                                                                    |
| `type`          | TEXT             | CHECK: `SEND, RECEIVE` only (no BILL_PAYMENT)                      |
| `amount`        | DECIMAL(15,2)    |                                                                    |
| `currency_code` | TEXT             | DEFAULT `'USDT'` — **note: named `currency_code`, not `currency`** |
| `description`   | TEXT             | Instead of `note`                                                  |
| `client_name`   | TEXT             | **No `client_id` FK**                                              |
| `created_at`    | DATETIME         |                                                                    |
| `created_by`    | INTEGER FK→users |                                                                    |

### 1c. `recharges` — Currently Unused (WILL BE FIXED)

Exists in schema with columns (`carrier`, `amount_usd`, `phone_number`, `client_name`, `note`) but currently unused — `RechargeRepository` erroneously writes to `sales` instead.

**Decision**: MTC/Alfa will be migrated to write to this table. Schema will be expanded to support the full recharge workflow (see Section 8).

### 1d. Key Structural Differences

| Aspect              | `financial_services`                                               | `binance_transactions`       |
| ------------------- | ------------------------------------------------------------------ | ---------------------------- |
| Providers           | 8 (multi-tenant)                                                   | 1 (implicit Binance)         |
| Service types       | SEND, RECEIVE, BILL_PAYMENT                                        | SEND, RECEIVE only           |
| Cost/Price tracking | Yes                                                                | No                           |
| Commission          | Yes                                                                | No                           |
| Payment method      | `paid_by` column                                                   | None (always Binance drawer) |
| Client FK           | `client_id` FK + `client_name` text                                | `client_name` text only      |
| Currency column     | `currency`                                                         | `currency_code`              |
| Default currency    | USD                                                                | USDT                         |
| Extra fields        | `reference_number`, `phone_number`, `omt_service_type`, `item_key` | `description`                |

---

## 2. Code Architecture: End-to-End Provider Flow

### Provider → Repository → API → Frontend mapping

| Provider     | DB Table                                                     | Repo Flow                                    | API Route                            | Frontend Page     | Module Key   | Drawer(s)            |
| ------------ | ------------------------------------------------------------ | -------------------------------------------- | ------------------------------------ | ----------------- | ------------ | -------------------- |
| **OMT**      | `financial_services`                                         | Legacy flow                                  | `/api/services`                      | Services page     | `omt_whish`  | OMT_System USD/LBP   |
| **WHISH**    | `financial_services`                                         | Legacy flow                                  | `/api/services`                      | Services page     | `omt_whish`  | Whish_System USD/LBP |
| **OMT_APP**  | `financial_services`                                         | Cost/Price flow                              | `/api/services`                      | **Recharge page** | `ipec_katch` | OMT_App USD/LBP      |
| **WISH_APP** | `financial_services`                                         | Cost/Price flow                              | `/api/services`                      | **Recharge page** | `ipec_katch` | Whish_App USD/LBP    |
| **IPEC**     | `financial_services`                                         | Cost/Price flow                              | `/api/services`                      | Recharge page     | `ipec_katch` | IPEC USD/LBP         |
| **KATCH**    | `financial_services`                                         | Cost/Price flow                              | `/api/services`                      | Recharge page     | `ipec_katch` | Katch USD/LBP        |
| **BINANCE**  | `binance_transactions` → **merge into `financial_services`** | Separate repo → **use FinancialServiceRepo** | `/api/binance` → **`/api/services`** | Recharge page     | `binance`    | Binance USD          |
| **MTC**      | `sales` (!) → **fix: use `recharges`**                       | RechargeRepo                                 | `/api/recharge`                      | Recharge page     | `recharge`   | MTC USD              |
| **Alfa**     | `sales` (!) → **fix: use `recharges`**                       | RechargeRepo                                 | `/api/recharge`                      | Recharge page     | `recharge`   | Alfa USD             |

### Two Code Flows Inside `FinancialServiceRepository.createTransaction()`

**Legacy Flow** (OMT, WHISH, BOB, OTHER) — **Updated Phase 1**:

OMT and WHISH now use multi-drawer flows (see Section 4a below for full details).
BOB/OTHER continue with single-drawer logic.

- `commission` → always positive inflow to General drawer (for OMT/WHISH) or provider drawer (others)
- No cost/price tracking

> **UI Labels**: SEND = "Money In" (customer gives money to shop), RECEIVE = "Money Out" (shop gives money to customer).

**Cost/Price Flow** (IPEC, KATCH, WISH_APP, OMT_APP):

- `cost` outflow → decrements provider drawer
- `price` inflow → increments paid-by drawer (unless DEBT)
- `commission = price - cost` (auto-calculated)
- Supports DEBT → creates `debt_ledger` entry

Both flows: insert `financial_services` row → create `transactions` row → insert `payments` → upsert `drawer_balances` → auto-record `supplier_ledger`

### Sidebar Grouping

Three module keys share the `/recharge` route: `recharge`, `binance`, `ipec_katch`. The sidebar consolidates them into one **"Mobile Recharge"** link with sub-tabs. The `omt_whish` module remains a **separate** sidebar entry at `/services`.

---

## 3. Frontend Page Breakdown

### Services Page (`/services`) — OMT & WHISH only

- **File**: `frontend/src/features/services/pages/Services/index.tsx`
- **Providers**: `OMT` | `WHISH` (toggle)
- **Form**: service type, amount (USD only), commission, phone, OMT service dropdown, client name, reference #, paid-by
- **API calls**: `api.addOMTTransaction()`, `api.getOMTHistory()`, `api.getOMTAnalytics()`, `api.getSuppliers()`, `api.getSupplierBalances()`
- **Currency**: Hardcoded USD

### Recharge Page (`/recharge`) — 7 Providers, 3 Form Modes

- **File**: `frontend/src/features/recharge/pages/Recharge/index.tsx` (**2258 lines**)
- **Three form modes**:
  1. **Telecom** (MTC/Alfa): recharge type, phone, amount, price, paid-by → calls `api.processRecharge()`
  2. **Financial** (IPEC/KATCH/WISH_APP/OMT_APP): service type, cost, price, item picker → calls `api.addOMTTransaction()`
  3. **Crypto** (BINANCE): type, amount USDT, client, description → calls `api.addBinanceTransaction()`

### Orphaned Pages (Dead Code)

- `frontend/src/features/recharge/pages/IKWServices/index.tsx` (638 lines) — `/ikw-services` redirects to `/recharge`
- `frontend/src/features/recharge/pages/Binance/index.tsx` — `/binance` redirects to `/recharge`

---

## 4. Drawer Architecture

| Drawer Name    | Currencies | Used By                    | Notes                                           |
| -------------- | ---------- | -------------------------- | ----------------------------------------------- |
| `General`      | USD, LBP   | Sales, BOB, OTHER, OMT     | Main cash drawer + OMT cash reserve             |
| `OMT_System`   | USD, LBP   | OMT (legacy flow)          | Tracks OMT system debt (what OMT owes shop)     |
| `OMT_App`      | USD, LBP   | OMT_APP (cost/price flow)  | OMT app reselling                               |
| `Whish_System` | USD, LBP   | WHISH (legacy flow)        | Tracks WHISH system debt (what WHISH owes shop) |
| `Whish_App`    | USD, LBP   | WISH_APP (cost/price flow) | Whish app reselling                             |
| `Binance`      | USD only   | BINANCE                    | Crypto                                          |
| `MTC`          | USD only   | MTC recharges              | Telecom stock                                   |
| `Alfa`         | USD only   | Alfa recharges             | Telecom stock                                   |
| `IPEC`         | USD, LBP   | IPEC                       | Financial service                               |
| `Katch`        | USD, LBP   | KATCH                      | Financial service                               |

### 4a. OMT / WHISH Drawer Logic (Phase 1 — Implemented)

The OMT and WHISH providers use distinct multi-drawer flows to track real cash positions
and system obligations. This was implemented in migration v26.

#### Terminology

| UI Label      | DB Value  | Meaning                                                     |
| ------------- | --------- | ----------------------------------------------------------- |
| **Money In**  | `SEND`    | Customer gives money to shop, shop sends via OMT/WHISH      |
| **Money Out** | `RECEIVE` | Customer receives money from OMT/WHISH, shop gives cash out |

#### OMT — 3-Drawer Cash-Reserve Model

OMT settles with the shop periodically. The shop must set aside cash to cover what OMT
will later collect. The "General" drawer acts as the cash reserve.

**Money In (SEND) — customer pays shop, shop sends via OMT:**

```
1. Payment drawer  +amount   (e.g., General +$50 if paid CASH)
2. General         -amount   (cash reserve: set aside for OMT settlement)
3. OMT_System      +amount   (OMT now owes the shop this amount)
```

- If paid CASH: General +50 then -50 = **net 0** on General. The cash is "reserved".
- If paid non-cash (e.g., Whish_App): Whish_App +50, General -50 (actual cash set aside).
- Commission (if any): General +commission.

**Money Out (RECEIVE) — OMT sends money, shop gives cash to customer:**

```
1. General         -amount   (shop pays cash out to customer)
2. OMT_System      -amount   (OMT debt decreases — they settled)
```

**OMT Settlement (end of period):**

- OMT pays the shop the net OMT_System balance.
- Shop releases the cash reserve from General.
- Both OMT_System and General return toward 0.

**Example — Full OMT Cycle:**

| Step | Action               | General                                 | OMT_System |
| ---- | -------------------- | --------------------------------------- | ---------- |
| 1    | Money In $100 (CASH) | +100 -100 = **0**                       | **+100**   |
| 2    | Money In $50 (CASH)  | +50 -50 = **0**                         | **+150**   |
| 3    | Money Out $30        | **-30**                                 | **+120**   |
| 4    | OMT settles $120     | **+120** (cash from OMT)                | **0**      |
| —    | Final                | **+90** (net: -30 out + 120 settlement) | **0**      |

#### WHISH — 2-Drawer Model (No Cash Reserve)

WHISH does **not** require cash reserve. The shop does not set aside physical cash
for WHISH settlement, so General is not involved in the system drawer flow.

**Money In (SEND) — customer pays shop, shop sends via WHISH:**

```
1. Payment drawer  +amount   (e.g., General +$50 if paid CASH)
2. Whish_System    +amount   (WHISH now owes the shop this amount)
```

- General is only touched if payment method is CASH (normal cash receipt).
- No General reserve deduction, unlike OMT.
- Commission (if any): General +commission.

**Money Out (RECEIVE) — WHISH sends money, shop gives cash to customer:**

```
1. Whish_System    -amount   (WHISH debt decreases)
```

- General is NOT touched. The cash outflow for WHISH RECEIVE is not tracked
  via General because WHISH settles differently than OMT.

**Example — Full WHISH Cycle:**

| Step | Action               | General              | Whish_System |
| ---- | -------------------- | -------------------- | ------------ |
| 1    | Money In $100 (CASH) | **+100**             | **+100**     |
| 2    | Money Out $50        | **+100** (unchanged) | **+50**      |
| 3    | WHISH settles $50    | **+100** (unchanged) | **0**        |

#### BOB / OTHER — Single-Drawer (Legacy)

BOB and OTHER providers use simple single-drawer logic:

- Money In: payment drawer +amount (e.g., General if CASH)
- Money Out: payment drawer +amount (money coming in from provider)
- Commission: same drawer +commission

No system drawer tracking. No settlement cycle.

#### Supplier Ledger Integration

Every financial service transaction auto-records to the `supplier_ledger`:

| Service Type        | Ledger Entry Type | Effect                                       |
| ------------------- | ----------------- | -------------------------------------------- |
| SEND (Money In)     | `TOP_UP`          | Increases supplier debt (shop owes supplier) |
| RECEIVE (Money Out) | `PAYMENT`         | Decreases supplier debt (supplier settled)   |

#### OMT Service Types (omt_service_type)

OMT transactions have a sub-classification (8 values):

| Value              | Description                                 |
| ------------------ | ------------------------------------------- | ------------------- |
| Service Type       | Description                                 | Commission Rate     |
| --------------     | -------------                               | -----------------   |
| `INTRA`            | Internal transfers (default)                | 15% of OMT fee      |
| `WESTERN_UNION`    | Western Union transfers                     | 10% of OMT fee      |
| `CASH_TO_BUSINESS` | Cash to business                            | 25% of OMT fee      |
| `CASH_TO_GOV`      | Cash to gov (bills: darayeb, water, meliye) | 25% of OMT fee      |
| `OMT_WALLET`       | OMT Wallet (NO FEES)                        | 0%                  |
| `OMT_CARD`         | OMT Card                                    | 10% of OMT fee      |
| `OGERO_MECANIQUE`  | Ogero/Mecanique (renamed from BILL_PAYMENT) | 25% of OMT fee      |
| `ONLINE_BROKERAGE` | Online Brokerage (UNICEF, etc.)             | 0.1%-0.4% of amount |

**Changes in Migration v27** (Feb 24, 2026):

- Reordered service types to match business priority
- Consolidated `MINISTRY_OF_INTERIOR` + `MINISTRY_OF_FINANCE` → `CASH_TO_GOV`
- Renamed `BILL_PAYMENT` → `OGERO_MECANIQUE`
- Migrated `CASH_OUT` → `INTRA`
- Added `OMT_WALLET` and `OMT_CARD` as new service types
- Removed obsolete service types: `MTC_BILL`, `EDL_BILL`, `IDM_BILL`, `CASH_ON_DELIVERY`, `OTHER`

**Auto-Calculation** (Migration v28):

- Backend automatically calculates `commission` based on `omt_service_type`
- User enters `omt_fee` (OMT's fee) → system calculates shop profit
- Special case: `ONLINE_BROKERAGE` uses `profit_rate` (0.1%-0.4%) × amount
- Special case: `OMT_WALLET` always has 0 commission

> **Note**: `BILL_PAYMENT` as a `service_type` was removed in v26 because all transactions
> are either SEND or RECEIVE. The `omt_service_type` `BILL_PAYMENT` was renamed to
> `OGERO_MECANIQUE` in v27 for clarity.

---

## 5. `sales` vs `sale_items` vs `products`

```
products (1) ←── (M) sale_items (M) ──→ (1) sales
```

| Table            | Purpose                                | Key Columns                                                                                           |
| ---------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **`products`**   | Catalog/Inventory (physical items)     | `barcode`, `name`, `cost_price_usd`, `selling_price_usd`, `stock_quantity`, `imei`                    |
| **`sales`**      | Transaction header (who, when, totals) | `client_id`, `total_amount_usd`, `discount_usd`, `paid_usd/lbp`, `change_given`, `status`             |
| **`sale_items`** | Line items (what was sold)             | `sale_id` FK, `product_id` FK, `quantity`, `sold_price_usd`, `cost_price_snapshot_usd`, `is_refunded` |

- Each sale has multiple items; each item references a product + snapshots cost price at time of sale
- `stock_quantity` decremented atomically during `processSale()`
- `is_refunded` on `sale_items` allows individual item returns

**Anomaly (WILL BE FIXED)**: `RechargeRepository` currently creates `sales` rows (with `status='completed'`) but no `sale_items` — recharges appear alongside POS sales. This will be fixed by migrating MTC/Alfa to write to the `recharges` table instead, keeping `sales` exclusively for POS sales.

---

## 6. Identified Inconsistencies & Decisions

### Database Side

| #   | Issue                                                                                | Decision                                                         |
| --- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| D1  | `recharges` table exists but is never used                                           | **KEEP** — will be properly used for MTC/Alfa instead of `sales` |
| D2  | `binance_transactions` is a separate table duplicating `financial_services` patterns | **MERGE** into `financial_services` as `BINANCE` provider        |
| D3  | Column naming: `financial_services.currency` vs `payments.currency_code`             | **STANDARDIZE** to `currency_code` everywhere                    |
| D4  | `sales.drawer_name` defaults to `'General_Drawer_B'` — no such drawer exists         | **FIX** default to `'General'`                                   |
| D5  | MTC/Alfa recharges write to `sales` table                                            | **FIX** — use `recharges` table, `sales` for POS only            |
| D6  | Binance has no `client_id` FK                                                        | **RESOLVED** by merging into `financial_services`                |
| D7  | `recharges` table indexes exist for unused table                                     | **KEEP** — indexes will be needed when table is properly used    |

### Frontend/Code Side

| #   | Issue                                                                | Decision                                               |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------ |
| F1  | Orphaned `IKWServices/index.tsx` (638 lines) and `Binance/index.tsx` | **DELETE** dead code                                   |
| F2  | Recharge page is 2258 lines — monolith                               | **DECOMPOSE** into sub-components                      |
| F3  | API methods named `api.getOMTHistory()` used for non-OMT providers   | **RENAME** to `api.getFinancialServiceHistory()` etc.  |
| F4  | "Mobile Recharge" sidebar label for mixed content                    | **KEEP AS IS**                                         |
| F5  | OMT App grouped under `ipec_katch` module                            | **KEEP AS IS** (intentional — different business flow) |
| F6  | SEND/RECEIVE labels in UI                                            | **DONE** — Renamed to Money In / Money Out             |

---

## 7. Implementation Plan

### Phase 1: Quick Fixes (✅ DONE)

| #   | Task                                                                         | Status  |
| --- | ---------------------------------------------------------------------------- | ------- |
| 1.1 | **Fix `sales.drawer_name` default** from `'General_Drawer_B'` to `'General'` | ✅ Done |
| 1.2 | **Delete orphaned pages**: `IKWServices/index.tsx`, `Binance/index.tsx`      | ✅ Done |
| 1.3 | **Rename SEND/RECEIVE → Money In/Money Out** in all service UI labels        | ✅ Done |

### Phase 2: MTC/Alfa → `recharges` table (data integrity)

| #   | Task                                                                                                                                                                                                         | Effort |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 2.1 | **Expand `recharges` table schema** — add columns needed for full workflow: `recharge_type` (CREDIT_TRANSFER/VOUCHER/DAYS/TOP_UP), `price_usd`, `paid_by`, `client_id` FK, `created_by`, `transaction_id` FK | Medium |
| 2.2 | **Update `RechargeRepository`** to write to `recharges` instead of `sales`                                                                                                                                   | Medium |
| 2.3 | **Update drawer/payment logic** — ensure MTC/Alfa transactions still hit correct drawers via `payments` table                                                                                                | Medium |
| 2.4 | **Add migration** to move existing recharge-type `sales` rows into `recharges` (data backfill)                                                                                                               | Medium |

### Phase 3: Merge Binance into `financial_services`

| #   | Task                                                                                                                                       | Effort  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| 3.1 | **Add `BINANCE` to `financial_services.provider` CHECK** constraint                                                                        | Trivial |
| 3.2 | **Add migration** to copy `binance_transactions` data into `financial_services` (map `description` → `note`, `currency_code` → `currency`) | Medium  |
| 3.3 | **Update Recharge page** crypto form to call `api.addFinancialServiceTransaction()` instead of `api.addBinanceTransaction()`               | Low     |
| 3.4 | **Remove** `BinanceRepository`, `BinanceService`, `binanceHandlers.ts`, `backend/src/api/binance.ts`                                       | Medium  |
| 3.5 | **Drop `binance_transactions` table** after data migration confirmed                                                                       | Low     |

### Phase 4: Multi-Payment Support

| #   | Task                                                                                                                                                                                                                                                                                                 | Effort   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 4.1 | **Audit multi-payment support** across all transaction types. POS (`sales`) already supports `payments[]` array via `processSale()`. Other modules (`financial_services`, `recharges`, `maintenance`, `expenses`, `exchange_transactions`, `custom_services`) currently use single `paid_by` column. | Research |
| 4.2 | **Ensure DB schema supports multi-payment** — the `payments` table already links to `transactions` via `transaction_id`, and all modules create `transactions` rows. Multi-payment is a repository/frontend concern, not a schema one.                                                               | Verify   |
| 4.3 | **Update `FinancialServiceRepository.createTransaction()`** to accept `payments[]` array instead of single `paidByMethod`                                                                                                                                                                            | Medium   |
| 4.4 | **Update `RechargeRepository.processRecharge()`** to accept `payments[]` array                                                                                                                                                                                                                       | Medium   |
| 4.5 | **Update frontend forms** in Services page and Recharge page to support multi-payment selection (like POS CheckoutModal)                                                                                                                                                                             | High     |
| 4.6 | **Update remaining modules** (maintenance, expenses, exchange, custom_services) to accept multi-payment where applicable                                                                                                                                                                             | Medium   |

### Phase 5: Code Cleanup & Renaming

| #   | Task                                                                                                                                                       | Effort |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 5.1 | **Rename API methods**: `api.getOMTHistory()` → `api.getFinancialServiceHistory()`, `api.addOMTTransaction()` → `api.addFinancialServiceTransaction()`     | Low    |
| 5.2 | **Standardize `currency_code`** column naming — rename `financial_services.currency` and `item_costs.currency` to `currency_code`                          | Medium |
| 5.3 | **Decompose Recharge monolith** (2258 lines) into: `TelecomForm.tsx`, `FinancialForm.tsx`, `CryptoForm.tsx`, `ProviderStats.tsx`, `TransactionHistory.tsx` | Medium |

---

## 8. Multi-Payment Architecture Note

The POS module already supports multi-payment via a `payments[]` array passed to `SalesRepository.processSale()`, where each payment has `{ method, drawerName, currencyCode, amount }`. Each payment creates a separate `payments` row linked to the same `transaction_id`.

The `payments` table already supports this for **any** transaction type:

```sql
CREATE TABLE payments (
  transaction_id INTEGER FK→transactions,  -- links to unified journal
  method TEXT,           -- e.g. 'CASH', 'OMT', 'WHISH'
  drawer_name TEXT,      -- which drawer to affect
  currency_code TEXT,    -- USD, LBP, etc.
  amount REAL,           -- amount for this payment leg
  ...
);
```

The gap is not in the DB schema but in the **repository layer** and **frontend forms** — most non-POS modules only pass a single `paidByMethod` string instead of a `payments[]` array. The fix is to:

1. Accept `payments[]` in each repository's create method
2. Insert one `payments` row per element
3. Update the frontend forms to allow split-payment selection

---

## 9. Validation Checklist

After implementing each phase, run the full validation suite and fix any errors before proceeding:

```bash
# TypeScript compilation (zero errors expected)
yarn typecheck

# Frontend + Backend build
yarn build

# Lint (zero errors expected, warnings acceptable)
cd frontend && npx eslint src/ --no-warn-ignored

# Tests
yarn test:frontend    # 81+ tests
yarn test:backend     # 291+ tests

# Code formatting
npx prettier --write "frontend/src/**/*.{ts,tsx}" "packages/core/src/**/*.ts" "backend/src/**/*.ts" "electron-app/**/*.ts"
```

All phases must pass all checks before merging.
