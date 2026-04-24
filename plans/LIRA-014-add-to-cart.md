# LIRA-014: Add to Cart / Batch Checkout — Implementation Plan

> **Ticket:** LIRA-014 (Walk-In Session with Batch Checkout)  
> **Created:** 2026-04-24  
> **Status:** Design Complete — Ready for Implementation  
> **Related Tickets:** LIRA-040 (Exchange deferred), LIRA-041 (Binance Receive review)

---

## Overview

When a customer session is active (`activeSession`), all module "Submit" / "Proceed to Checkout" buttons become "Add to Cart". Transactions are stored **in memory only** (no DB writes) until the user clicks "Checkout All" on the session floating window. On successful checkout, all transactions are created in the DB in a single batch, and the payment is recorded at the session level.

---

## Design Decisions

| Decision                                     | Choice                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| When are transactions saved to DB?           | **Only after successful checkout** (deferred / Option B)                                              |
| Where are cart items stored before checkout? | **In memory** — SessionContext state                                                                  |
| What replaces Submit buttons?                | "Add to Cart" — only when `activeSession` exists                                                      |
| What happens when no session is active?      | Normal "Submit" behavior, unchanged                                                                   |
| Payment method on individual transactions?   | **Each transaction gets a real payment method** (Option X — call existing services as-is at checkout) |
| Multi-payment at checkout?                   | **Yes** — distributed across cart items, each service handles its own drawer ops                      |
| Partial payment?                             | Remainder becomes **debt** (linked to individual transactions as normal)                              |
| Exchange transactions?                       | **Excluded** from initial implementation (LIRA-040)                                                   |
| Binance Receive in session?                  | **Needs review** (LIRA-041)                                                                           |

---

## Cart Item Shape

```typescript
interface CartItem {
  id: string; // UUID for React keys & removal
  module: string; // 'pos' | 'recharge_mtc' | 'recharge_alfa' | 'omt_app' | 'whish_app' | 'ipick' | 'katsh' | 'binance_send' | 'binance_receive' | 'omt_system' | 'whish_system' | 'loto_ticket' | 'loto_prize' | 'custom_service' | 'maintenance'
  label: string; // Human-readable: "MTC Recharge - 03123456 - $50"
  amount: number; // Signed: positive = customer pays, negative = shop pays out
  currency: string; // 'USD' | 'LBP' | 'USDT'
  formData: Record<string, any>; // Exact payload for the IPC handler (to replay at checkout)
  ipcChannel: string; // e.g. 'recharge:create', 'financial-service:create', 'sales:create'
  drawerOperations: DrawerOp[]; // Pre-calculated Side A drawer movements
}

interface DrawerOp {
  drawer: string; // 'MTC' | 'Alfa' | 'OMT_App' | 'Binance' | 'General' | 'Loto' | etc.
  amount: number; // Signed: positive = credit, negative = debit
  currency: string;
}
```

---

## Cart Item Amounts by Module

| Module                   | Direction | Cart Amount (what customer owes/receives) | Side A Drawer Ops                                |
| ------------------------ | --------- | ----------------------------------------- | ------------------------------------------------ |
| **POS**                  | —         | +totalAmount                              | Inventory deduction only                         |
| **MTC Recharge**         | —         | +amount                                   | MTC drawer: -amount                              |
| **Alfa Recharge**        | —         | +amount                                   | Alfa drawer: -amount                             |
| **OMT App Send**         | Send      | +(amount + fee)                           | OMT_App drawer: -amount                          |
| **OMT App Receive**      | Receive   | -(amount - fee)                           | OMT_App drawer: +amount                          |
| **Whish App Send**       | Send      | +(amount + fee)                           | Whish_App drawer: -amount                        |
| **Whish App Receive**    | Receive   | -(amount - fee)                           | Whish_App drawer: +amount                        |
| **iPick**                | —         | +amount                                   | iPick drawer: -amount                            |
| **Katsh**                | —         | +amount                                   | Katsh drawer: -amount                            |
| **Binance Send**         | Send      | +(amount + fee)                           | Binance drawer: -amount                          |
| **Binance Receive**      | Receive   | -(amount - fee)                           | Binance drawer: +amount, General drawer: -amount |
| **OMT System Send**      | Send      | +(amount + fee)                           | OMT_System drawer: -amount                       |
| **OMT System Receive**   | Receive   | -(amount - fee)                           | OMT_System drawer: +amount                       |
| **Whish System Send**    | Send      | +(amount + fee)                           | Whish_System drawer: -amount                     |
| **Whish System Receive** | Receive   | -(amount - fee)                           | Whish_System drawer: +amount                     |
| **Loto Ticket**          | —         | +amount                                   | Loto drawer: -amount (verify)                    |
| **Loto Cash Prize**      | —         | -amount                                   | Loto drawer: +amount (verify)                    |
| **Custom Service**       | —         | +price                                    | (depends on service)                             |
| **Maintenance**          | —         | +price                                    | (none, or General)                               |

> **Note:** Verify Loto drawer operations by checking LotoService/LotoRepository.

---

## Pre-requisites (fix before starting)

- **LIRA-042:** Fix OmtWhishAppTransferForm snake_case payment fields (`payment_method` → `paidByMethod`, `payment_lines` → `payments`)
- **LIRA-043:** Add `linkTransaction` to FinancialForm & KatchForm if missing

---

## Architecture Decision: Option X (Confirmed)

**Problem:** Our original plan (Option C) assumed we could separate "Side A" (module drawer ops) from "Side B" (payment drawer ops) and handle payments at the session level. However, **all repositories bake both sides together** — `RechargeRepository.processRecharge()`, `SalesRepository.processSale()`, etc. all handle payments + drawer balance updates internally.

**Decision:** Use **Option X** — at checkout, call each service's existing create method with the payment info from the checkout modal. Each service handles its own drawer operations as usual. No `session_payments` table needed.

**Benefits:**

- No repository refactoring needed
- Profits by payment method works as-is
- Checkpoint/closing works as-is (reads `drawer_balances`, maintained by existing payment logic)
- Refunds work as-is (each transaction has its own payment record)
- Debt works as-is (per-transaction)

**Payment distribution at checkout:**

- User picks multi-payment for the total (e.g., $30 cash + $20 LBP)
- Each cart item is assigned a payment method (proportionally or primary method)
- Each service call includes the assigned payment info
- TBD: exact distribution strategy (proportional vs primary vs user-assigned per item)

---

## Database Changes

### ~~New Table: `session_payments`~~ — NOT NEEDED (Option X)

### ~~New Table: `session_transactions`~~ — ALREADY EXISTS as `customer_session_transactions`

### Alter `customer_sessions`

```sql
ALTER TABLE customer_sessions ADD COLUMN checkout_at TEXT;
ALTER TABLE customer_sessions ADD COLUMN checkout_total REAL;
ALTER TABLE customer_sessions ADD COLUMN checkout_currency TEXT DEFAULT 'USD';
```

### Migration

- Version: v61 (next after v60)
- Idempotent as always (PRAGMA table_info checks)
- Update `create_db.sql` with new tables and columns

---

## Implementation Phases

### Phase 1: SessionContext Cart State

**Files:** `frontend/src/features/sessions/context/SessionContext.tsx`

1. Add `cartItems: CartItem[]` to session state
2. Add `addToCart(item: CartItem): void`
3. Add `removeFromCart(itemId: string): void`
4. Add `clearCart(): void`
5. Add `getCartTotal(currency?: string): number`
6. Cart is per-session — switching sessions switches cart
7. Cart lives in React state only (lost on page refresh — acceptable for now)

### Phase 2: "Add to Cart" Button Logic — Per Module

For each module, when `activeSession` exists, replace the submit button and intercept form submission to call `addToCart()` instead of the IPC handler.

#### 2a. POS (`frontend/src/features/pos/`)

- "Proceed to Checkout" button → "Add to Cart" when activeSession
- Captures: all POS items, total amount, as one cart entry
- Form resets after adding to cart
- **File:** Identify the POS page/checkout trigger component

#### 2b. MTC / Alfa (`frontend/src/features/recharge/pages/Recharge/index.tsx`)

- In `handleTelecomSubmit`: if activeSession → addToCart instead of `window.api.recharge.create()`
- Label: "MTC Recharge - {phone} - ${amount}" or "Alfa Recharge - {phone} - ${amount}"
- **File:** `Recharge/index.tsx`

#### 2c. OMT App / Whish App (`frontend/src/features/recharge/components/OmtWhishAppTransferForm.tsx`)

- If activeSession → addToCart instead of submit
- Label: "OMT App Send - ${amount}" / "Whish App Receive - ${amount}"
- **File:** `OmtWhishAppTransferForm.tsx`

#### 2d. iPick / Katsh (`frontend/src/features/recharge/components/KatchForm.tsx`)

- If activeSession → addToCart instead of submit
- Label: "iPick - {card} - ${amount}" / "Katsh - {card} - ${amount}"
- **File:** `KatchForm.tsx`

#### 2e. Binance (`frontend/src/features/recharge/components/CryptoForm.tsx`)

- If activeSession → addToCart instead of submit
- Send: positive (amount + fee), Receive: negative (amount - fee)
- Label: "Binance Send - ${amount}" / "Binance Receive - ${amount}"
- **File:** `CryptoForm.tsx`

#### 2f. OMT / Whish System Services (`frontend/src/features/services/`)

- If activeSession → addToCart instead of submit
- Label: "OMT Send - {client} - ${amount}"
- **File:** Identify the services form component

#### 2g. Loto (`frontend/src/features/loto/`)

- "Sell Ticket" → "Add to Cart" (positive amount)
- "Record Cash Prize" → "Add to Cart" (negative amount)
- **File:** Identify loto page components

#### 2h. Custom Services (`frontend/src/features/custom-services/`)

- If activeSession → addToCart instead of submit
- **File:** Identify custom services form

#### 2i. Maintenance (`frontend/src/features/maintenance/`)

- If activeSession → addToCart on checkout
- **File:** `Maintenance/index.tsx`

### Phase 3: Floating Window Cart Display

**File:** `frontend/src/features/sessions/components/SessionFloatingWindow.tsx`

1. Show cart items list with: label, signed amount, remove button (X)
2. Show running total at bottom (convert all to USD at sell rate for display)
3. Negative items shown in red/green to distinguish
4. "Checkout All" button opens CheckoutModal with the total
5. Empty state: "No items in cart"

### Phase 4: Checkout Flow

**Files:** SessionFloatingWindow.tsx, new `SessionCheckoutModal.tsx` or reuse CheckoutModal

1. "Checkout All" opens checkout modal
2. Modal shows:
   - List of all cart items (module, label, amount, currency)
   - POS entries expanded to show individual product items
   - Subtotals per currency if mixed
   - Grand total in USD (converted at sell rate)
3. MultiPaymentInput for payment
4. "Confirm Checkout" button

### Phase 5: Backend — Batch Transaction Creation

**Files:**

- `packages/core/src/services/CustomerSessionService.ts` — new `checkout()` method
- `packages/core/src/repositories/CustomerSessionRepository.ts` — new methods
- `electron-app/handlers/sessionHandlers.ts` — new `session:checkout` IPC handler
- `electron-app/preload.ts` — add `checkout` binding
- `frontend/src/types/electron.d.ts` — add type

**Checkout logic:**

1. Receive: `{ sessionId, cartItems: CartItem[], payments: Payment[] }`
2. Distribute payment across cart items (proportional or primary method)
3. Begin DB transaction (BEGIN)
4. For each cart item:
   - Call the appropriate service's existing create method using `formData` + assigned payment info
   - The service handles ALL drawer operations (module-side + payment-side) as usual
   - Link the created transaction to the session via `customer_session_transactions`
5. If total payments < cart total:
   - Debt is handled per-transaction by the existing service logic (pass `DEBT` as payment method for remaining items)
   - Customer must be identified (require client selection if debt)
6. Update `customer_sessions`: set `checkout_at`, `checkout_total`
7. COMMIT
8. If any step fails → ROLLBACK, return error

### Phase 6: ~~Checkpoint Integration~~ — NOT NEEDED

Closing system reads `drawer_balances` which is maintained by the `payments` table. Since each service call at checkout inserts payments and updates drawer_balances as usual, **checkpoint integration is automatic**. No changes to `ClosingService` needed.

### Phase 7: Debt Integration

**Files:**

- `packages/core/src/services/DebtService.ts`
- `frontend/src/features/debts/` — debt history components

- Debt entry from session checkout references session_id
- Debt history eye icon shows session details: list of transactions + amounts
- Adapt the existing eye icon detail view to handle session transactions (not just POS items)

---

## Risks & Mitigations

| Risk                                   | Impact                                | Mitigation                                                                    |
| -------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------- |
| Cart lost on page refresh              | User loses unsaved cart items         | Accept for now; later persist to localStorage or DB                           |
| Checkout fails mid-batch               | Partial DB writes                     | Use SQLite transaction (BEGIN/ROLLBACK) for atomicity                         |
| Payment distribution across cart items | Complex logic for multi-payment split | Start with primary payment method for all; iterate later                      |
| Refund of session transaction          | Works as normal                       | Each transaction has its own payment record (Option X benefit)                |
| Mixed currencies in cart               | Complex total calculation             | Convert all to USD at sell rate for display; store original currency per item |
| Large cart with many transactions      | Slow checkout                         | SQLite transaction batching should handle this; unlikely to have 50+ items    |

---

## Excluded from Initial Implementation

- **Exchange transactions** (LIRA-040) — complex two-way currency flow
- **Binance Receive** (LIRA-041) — needs layout review
- **Cart persistence** (localStorage/DB) — accept in-memory for now
- **Cart editing** (modify quantity/amount of cart item) — remove and re-add instead

---

## Testing Plan

1. **Unit tests:** SessionContext cart operations (add, remove, clear, total calculation)
2. **Unit tests:** Checkout service — batch creation, rollback on failure
3. **Integration:** Add items from 3+ modules, checkout, verify all DB records created
4. **Integration:** Partial payment → verify debt created with session reference
5. **Integration:** Checkpoint after session checkout → verify drawer amounts correct
6. **Manual:** Full flow across MTC, POS, Loto, Binance Send
7. **Edge cases:** Empty cart checkout (disabled), single item, all negative items, mixed currencies

---

## Implementation Order

0. **Pre-req** — Fix LIRA-042 (OmtWhish snake_case) and LIRA-043 (linkTransaction in FinancialForm/KatchForm)
1. **Database migration** — Add checkout columns to `customer_sessions`
2. **Phase 1** — SessionContext cart state (foundation, no UI changes yet)
3. **Phase 3** — Floating window cart display (see items as we add them)
4. **Phase 2a** — POS "Add to Cart" (most important module)
5. **Phase 2b** — MTC/Alfa (simple, good second module)
6. **Phase 2c-2i** — Remaining modules one by one
7. **Phase 5** — Backend batch checkout (needed before checkout works)
8. **Phase 4** — Checkout modal UI
9. **Phase 7** — Debt history adaptation (show session transactions in eye icon)

---

## Files Summary

### New Files

- `frontend/src/features/sessions/components/SessionCheckoutModal.tsx` (or reuse CheckoutModal)
- `frontend/src/features/sessions/types/cart.ts` (CartItem, DrawerOp interfaces)

### Modified Files

- `frontend/src/features/sessions/context/SessionContext.tsx` — cart state
- `frontend/src/features/sessions/components/SessionFloatingWindow.tsx` — cart display
- `frontend/src/features/pos/` — Add to Cart button
- `frontend/src/features/recharge/pages/Recharge/index.tsx` — MTC/Alfa Add to Cart
- `frontend/src/features/recharge/components/OmtWhishAppTransferForm.tsx` — OMT/Whish App
- `frontend/src/features/recharge/components/KatchForm.tsx` — iPick/Katsh
- `frontend/src/features/recharge/components/CryptoForm.tsx` — Binance
- `frontend/src/features/services/` — OMT/Whish System
- `frontend/src/features/loto/` — Loto
- `frontend/src/features/custom-services/` — Custom Services
- `frontend/src/features/maintenance/` — Maintenance
- `packages/core/src/services/CustomerSessionService.ts` — checkout method
- `packages/core/src/repositories/CustomerSessionRepository.ts` — new queries
- `packages/core/src/db/migrations/index.ts` — v61 migration
- `electron-app/create_db.sql` — new tables
- `electron-app/handlers/sessionHandlers.ts` — session:checkout handler
- `electron-app/preload.ts` — checkout binding
- `frontend/src/types/electron.d.ts` — checkout types
- `packages/core/src/services/ClosingService.ts` — ~~checkpoint integration~~ NOT NEEDED
- `packages/core/src/services/DebtService.ts` — ~~session debt~~ NOT NEEDED (existing debt logic works per-transaction)
- `frontend/src/features/debts/` — debt history adaptation (show session transactions in eye icon)
