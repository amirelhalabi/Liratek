# LiraTek POS — Urgent Sprint Backlog

> **Sprint Goal:** Fix all critical blockers and deliver high-priority features  
> **Created:** 2026-04-23  
> **Last Updated:** 2026-05-11 (LIRA-041 completed, all actionable tickets done)  
> **Status Legend:** `TODO` | `IN PROGRESS` | `PARTIAL` | `DONE` | `BLOCKED` | `TBD`

---

## Epic 5: Customer Sessions Overhaul

> Shared sessions across network, improved lifecycle UI, and walk-in checkout flow.

---

### LIRA-041: Binance Receive Layout & Session Integration

| Field               | Value                               |
| ------------------- | ----------------------------------- |
| **Epic**            | Customer Sessions Overhaul          |
| **Type**            | Bug / Feature                       |
| **Priority**        | Medium                              |
| **Status**          | DONE                                |
| **Affected Module** | Mobile Recharge > Binance, Sessions |
| **Assigned To**     | —                                   |

**Description:**  
Binance Receive (customer sends crypto to shop, cashes out) may not be properly handled in the current layout. The shop increases its Binance drawer and decreases general drawer by the same amount, then gets paid the fee. When in a customer session, the receive amount minus fee should appear as a negative cart item (shop pays out to customer). Needs review and testing.

**Notes:**

- SEND: customer pays amount + fee (positive in cart)
- RECEIVE: customer receives amount - fee (negative in cart)
- Verify drawer logic is correct for both directions

---

## Epic 12: Reverse Debt / Customer Credit _(Needs Discussion)_

---

### LIRA-030: Customer Credit System (Reverse Debt)

| Field                | Value                               |
| -------------------- | ----------------------------------- |
| **Epic**             | Reverse Debt                        |
| **Type**             | Feature                             |
| **Priority**         | High                                |
| **Status**           | TODO — Design Phase                 |
| **Affected Modules** | Debts, POS, All transaction screens |
| **Assigned To**      | —                                   |

**Description:**  
Support scenarios where the shop owes money to a customer (reverse debt / customer credit). This happens when:

- Customer overpays
- Customer leaves money at the shop intentionally (deposit)
- Customer returns an item for store credit

The customer can later spend their credit on purchases or services. These credit-spend transactions appear in the debt page.

---

#### Part 1: Cashout Methods (Shop → Customer Payments)

**Current state:** The shop only _receives_ payments from customers (via Cash, Whish wallet, debt, etc.). When the shop _pays out_ to a customer (OMT/Whish RECEIVE, Binance RECEIVE, Loto prize cashout), the payout is always implicit — it comes from cash in the General drawer, but this is not explicitly tracked as a "cashout method" in the code.

**What needs to change:**

- Introduce **Cashout Methods** — the reverse of Payment Methods. These represent _how the shop pays the customer_:
  - Cash (from General drawer) — default, most common
  - Whish wallet transfer (shop sends via Whish)
  - OMT wallet transfer (shop sends via OMT)
  - Customer Credit (add to customer's account balance — see Part 3)
  - Bank transfer (future)

- All RECEIVE/cashout transactions must explicitly record the cashout method used:
  - OMT System RECEIVE → cashout method (default: Cash)
  - Whish System RECEIVE → cashout method (default: Cash)
  - OMT App RECEIVE → cashout method (default: Cash)
  - Whish App RECEIVE → cashout method (default: Cash)
  - Binance RECEIVE → cashout method (default: Cash)
  - Loto prize cashout → cashout method (default: Cash)
  - Refund/void payback → cashout method (default: Cash)

- The cashout method determines which drawer is debited:
  - Cash → General drawer −amount
  - Whish wallet → Whish drawer −amount
  - Customer Credit → No drawer movement, just a credit entry in customer account

- **Database:** Add `cashout_method` column to relevant tables, or use the existing `paid_by` field with a flag indicating direction.

---

#### Part 2: Reverse Debt / Credit Payback

**Current state:** The debt system only tracks one direction — customer owes the shop (positive balance). When the customer pays, the debt decreases.

**What needs to change:**

- Support **negative debt entries** — shop owes customer (credit balance)
- A customer with credit can use it to pay for future purchases/services ("Pay with Credit" as a payment method)
- The same payment methods that exist today should work in reverse for paying back:
  - If a customer has credit, the shop can pay them back in Cash, Whish, OMT, etc.
  - Each payback uses a cashout method (Part 1)

- **Debt page changes:**
  - Show net balance per client: positive = customer owes shop, negative = shop owes customer
  - Visual distinction between debts (red) and credits (green)
  - Credit transactions labeled clearly ("Customer Credit", "Credit Used", etc.)
  - History shows both debt and credit entries

- **Checkpoint integration:** Customer credit deposits should NOT be flagged as "extra money" in checkpoints (LIRA-006)

---

#### Part 3: Customer Accounts

**Key insight:** Since we are now paying customers back and tracking credit balances, each customer effectively has an **account** with the shop. This account tracks:

- Current balance (positive = owes shop, negative = shop owes them)
- Full transaction history (all debts, credits, payments, paybacks)
- Contact info (name, phone — already in clients table)

**What a Customer Account provides:**

1. **Unified view:** See all interactions with a customer in one place — their debts, credits, purchases, services, sessions
2. **Balance tracking:** Net balance across all transaction types
3. **Credit spending:** When customer has credit, show available balance on all payment forms as a payment option
4. **Partial usage:** Customer has $40 credit, buys $25 worth → $15 credit remains
5. **Identification:** Link transactions to customer accounts for audit trail

**Relationship to existing data:**

- The `clients` table already exists with name, phone, etc.
- The `debt_ledger` already links to `client_id`
- Customer sessions already link to clients
- This feature formalizes the "account" concept by adding a balance ledger view

**Design Decisions Needed:**

- Should credit expire? (Recommendation: No)
- Should there be admin approval for creating credits? (Recommendation: No, but audit log tracks who created it)
- Maximum credit limit per customer? (Recommendation: No limit, trust-based)
- Can a customer have both debt AND credit simultaneously? (Recommendation: No — net balance only. If they owe $50 and get $30 credit, they now owe $20)

---

#### Part 4: Customer Account as a Payment Method — Scenarios

**Key concept:** "Customer Account" becomes a payment method, just like Cash, Whish wallet, or Debt. When selected, it draws from (or adds to) the customer's account balance. This unifies all the scenarios below.

**Account balance convention:** Positive = shop owes customer (customer has credit). Negative = customer owes shop (customer has debt).

##### Scenarios where account balance DECREASES (customer spends credit):

| #   | Scenario                                | Example                                                              | Effect                                         |
| --- | --------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | **Customer buys a product (POS)**       | Customer has $50 credit, buys $30 item, pays via "Customer Account"  | Account: $50 → $20                             |
| 2   | **Customer buys a recharge card**       | Customer calls, wants MTC $77 card. Pays $50 from account + $27 debt | Account: $50 → $0, Debt: $0 → $27              |
| 3   | **Customer pays for financial service** | OMT SEND $100, customer pays from account                            | Account decreases by $100 + fees               |
| 4   | **Customer pays for maintenance job**   | Phone repair $40, paid via account                                   | Account: −$40                                  |
| 5   | **Customer pays for custom service**    | Any custom service paid from account                                 | Account decreases                              |
| 6   | **Customer pays existing debt**         | Customer owes $80, pays $50 from new deposit → nets to $30 owed      | Same as today's debt payment, but from account |

##### Scenarios where account balance INCREASES (customer gains credit):

| #   | Scenario                                    | Example                                                              | Effect                                |
| --- | ------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------- |
| 7   | **Customer tops up account (cash deposit)** | Customer leaves $100 at shop "keep it for me"                        | Account: +$100, General drawer: +$100 |
| 8   | **OMT/Whish RECEIVE cashout**               | Customer cashes out $200 OMT, takes $150 cash, leaves $50 in account | Account: +$50, General drawer: −$150  |
| 9   | **Binance RECEIVE cashout**                 | Customer sells crypto, chooses partial account credit                | Account increases by credited portion |
| 10  | **Loto prize cashout**                      | Customer wins $500, takes $400 cash, leaves $100 in account          | Account: +$100                        |
| 11  | **Refund / void**                           | Shop refunds customer, credits to account instead of cash            | Account increases                     |
| 12  | **Overpayment**                             | Customer pays $100 for $85 service, $15 goes to account              | Account: +$15                         |

##### Mixed scenarios (split payment):

| #   | Scenario                             | Example                                                  | Effect                                           |
| --- | ------------------------------------ | -------------------------------------------------------- | ------------------------------------------------ |
| 13  | **Part account, part cash**          | $77 recharge: $50 from account + $27 cash                | Account: −$50, General drawer: +$27              |
| 14  | **Part account, part debt**          | $77 recharge: $50 from account + $27 new debt            | Account: −$50, Debt: +$27 (account goes to −$27) |
| 15  | **RECEIVE: part cash, part account** | $200 OMT RECEIVE: $150 cash payout + $50 to account      | General: −$150, Account: +$50                    |
| 16  | **Multi-leg split with account**     | $200 purchase: $80 account + $70 cash + $50 Whish wallet | Account: −$80, General: +$70, Whish drawer: +$50 |

##### Edge cases:

| #   | Scenario                                      | Handling                                                                          |
| --- | --------------------------------------------- | --------------------------------------------------------------------------------- |
| 17  | **Account balance insufficient**              | Show remaining balance, allow split with other methods (cash, debt)               |
| 18  | **Customer has debt, wants to use "account"** | Account balance is negative — cannot pay with account. Must pay cash/other first  |
| 19  | **Customer has credit AND debt**              | Not possible — net balance only. Credit and debt are the same ledger              |
| 20  | **Customer not identified**                   | "Customer Account" payment method only available when a client is selected/linked |

---

#### Implementation Order (Suggested)

| Phase       | What                                                                                                                                   | Depends On |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **Phase 1** | Cashout Methods — add explicit cashout method tracking to RECEIVE transactions, debit correct drawers                                  | Nothing    |
| **Phase 2** | Reverse Debt — support negative debt entries, credit creation, credit payback                                                          | Phase 1    |
| **Phase 3** | Customer Accounts — unified customer view, balance ledger, "Pay with Credit" as payment method                                         | Phase 2    |
| **Phase 4** | Integration — update all RECEIVE forms to show cashout method picker, update Binance RECEIVE (LIRA-041), update checkpoints (LIRA-006) | Phase 1-3  |

---

**Acceptance Criteria:**

- [ ] Cashout methods defined and selectable on RECEIVE transactions
- [ ] General drawer debited on cash payouts
- [ ] Negative debt entries supported in `debt_ledger`
- [ ] "Add Customer Credit" action available (from POS refund, manual entry, overpayment)
- [ ] "Pay with Credit" option in payment methods when customer has positive credit balance
- [ ] Debt page shows net balance per client (positive = they owe, negative = we owe)
- [ ] Credit transactions appear in debt history with clear labeling
- [ ] Partial credit usage works (credit $40, purchase $25 → remaining $15)
- [ ] Customer account page shows unified balance and history
- [ ] Checkpoint system excludes customer credit from variance alerts

**Files to Modify:**

- `packages/core/src/services/DebtService.ts`
- `packages/core/src/repositories/DebtRepository.ts`
- `packages/core/src/repositories/FinancialServiceRepository.ts` (drawer debit on RECEIVE)
- `frontend/src/features/debts/`
- All payment forms (add credit option)
- All RECEIVE forms (add cashout method picker)
- `packages/core/src/services/ClosingService.ts` (checkpoint exclusion)
- New: Customer Account page/component

---

## Epic 18: Cashout Method Parity

---

### LIRA-044: Full Cashout Method Parity with Payment Methods

| Field               | Value                                                        |
| ------------------- | ------------------------------------------------------------ |
| **Epic**            | Cashout Method Parity                                        |
| **Type**            | Feature                                                      |
| **Priority**        | High                                                         |
| **Status**          | TODO                                                         |
| **Affected Modules** | OMT, Whish, Binance, Loto, Refunds, Sessions, Checkpoints  |
| **Assigned To**     | —                                                            |
| **Depends On**      | LIRA-030 (DONE)                                              |

**Description:**  
Currently, when the shop pays out to a customer (RECEIVE transactions, Loto prizes, refunds), the only cashout options are **Cash** (debit General drawer) or **Client Account** (credit client's balance). In reality, the shop can also pay a customer via OMT wallet, Whish wallet, or Binance transfer — but these are not supported as cashout methods today.

Cashout methods should mirror payment methods. Every way a customer can pay the shop, the shop should be able to pay back the customer — with the correct drawer debited.

**Terminology:**
- **Customer** = random passer to the shop, not saved
- **Client** = a customer whose details are saved in the DB (`clients` table). Only clients can have a ± balance (debt/credit)
- The payment method is **"Client Account"** (not "Customer Account"), since only saved clients can have account balances

**Current State:**

| Cashout Method | Supported? | Drawer Debited |
|---|---|---|
| Cash | ✅ Yes | General |
| Client Account | ✅ Yes | None (credit in `debt_ledger`) |
| OMT Wallet | ❌ No | Should debit OMT_App |
| Whish Wallet | ❌ No | Should debit Whish_App |
| Binance | ❌ No | Should debit Binance |

**Target State:**

| Cashout Method | Drawer Debited | Notes |
|---|---|---|
| `CASH` | General | Default, most common |
| `CLIENT_ACCOUNT` | None | Creates credit in `debt_ledger`. Requires client to be selected. |
| `OMT` | OMT_App | Shop sends OMT transfer to customer's phone |
| `WHISH` | Whish_App | Shop sends Whish transfer to customer's phone |
| `BINANCE` | Binance | Shop sends crypto to customer's wallet |

**Implementation Plan:**

#### Phase 1: Backend — Expand Cashout Method Enum & Drawer Logic

- [ ] Update `packages/core/src/validators/financial.ts` — expand `cashoutMethod` enum from `["CASH", "CUSTOMER_ACCOUNT"]` to `["CASH", "CLIENT_ACCOUNT", "OMT", "WHISH", "BINANCE"]`
- [ ] Rename `CUSTOMER_ACCOUNT` → `CLIENT_ACCOUNT` everywhere (aligns with app terminology)
- [ ] Update `FinancialServiceRepository.ts` RECEIVE branches — each cashout method debits its corresponding drawer:
  - `CASH` → General drawer `-(payoutAmount)`
  - `CLIENT_ACCOUNT` → no drawer debit, call `debtService.addCredit()`
  - `OMT` → OMT_App drawer `-(payoutAmount)`
  - `WHISH` → Whish_App drawer `-(payoutAmount)`
  - `BINANCE` → Binance drawer `-(payoutAmount)`
- [ ] Update Loto prize cashout to support same cashout methods
- [ ] Update refund/void cashout to support same cashout methods
- [ ] Add migration if `cashout_method` column needs expanded values or rename

#### Phase 2: Frontend — Cashout Method Picker on All RECEIVE Forms

- [ ] Create a reusable `CashoutMethodPicker` component (similar to payment method selector but for outbound payments)
- [ ] Add cashout method picker to:
  - OMT System/App RECEIVE forms
  - Whish System/App RECEIVE forms
  - Binance RECEIVE form (`CryptoForm.tsx`)
  - Loto prize cashout
  - Refund/void confirmation
- [ ] Default to `CASH`, show `CLIENT_ACCOUNT` only when a client is selected
- [ ] Pass selected cashout method through to the IPC call

#### Phase 3: Rename CUSTOMER_ACCOUNT → CLIENT_ACCOUNT

- [ ] Migration to update `payment_methods` table: rename code `CUSTOMER_ACCOUNT` → `CLIENT_ACCOUNT`, label → "Client Account"
- [ ] Update `debt_ledger` entries referencing `CUSTOMER_ACCOUNT`
- [ ] Update all backend code referencing `CUSTOMER_ACCOUNT`
- [ ] Update all frontend code referencing `CUSTOMER_ACCOUNT`
- [ ] Update `create_db.sql` seed data
- [ ] Update `electron.d.ts` types

#### Phase 4: Checkpoint & Closing Integration

- [ ] Ensure new cashout methods are properly reflected in drawer balances at checkpoint
- [ ] `ClosingRepository` should account for cashout-driven drawer debits
- [ ] Verify checkpoint variance alerts work correctly with new drawer movements

**Acceptance Criteria:**

- [ ] All 5 cashout methods available on all RECEIVE transaction forms
- [ ] Each cashout method debits the correct drawer
- [ ] `CLIENT_ACCOUNT` cashout only available when a client is selected
- [ ] `CLIENT_ACCOUNT` creates proper credit entry in `debt_ledger`
- [ ] Drawer balances at checkpoint reflect cashout-driven debits
- [ ] Existing transactions with `CUSTOMER_ACCOUNT` migrated to `CLIENT_ACCOUNT`
- [ ] All tests pass, typecheck clean, build succeeds

**Files to Modify:**

- `packages/core/src/validators/financial.ts` — cashout enum expansion
- `packages/core/src/repositories/FinancialServiceRepository.ts` — drawer debit logic per cashout method
- `packages/core/src/services/FinancialService.ts` — pass cashout method through
- `packages/core/src/repositories/ClosingRepository.ts` — checkpoint drawer calculations
- `packages/core/src/db/migrations/index.ts` — rename migration
- `electron-app/create_db.sql` — seed data update
- `electron-app/handlers/financialHandlers.ts` — pass cashout method
- `electron-app/preload.ts` — types if needed
- `frontend/src/features/recharge/components/CryptoForm.tsx` — cashout picker
- `frontend/src/features/recharge/components/FinancialForm.tsx` — cashout picker
- `frontend/src/features/recharge/components/KatchForm.tsx` — cashout picker
- `frontend/src/features/recharge/components/OmtWhishAppTransferForm.tsx` — cashout picker
- `frontend/src/features/recharge/pages/Recharge/index.tsx` — wire cashout method
- `frontend/src/types/electron.d.ts` — type updates

---

## Epic 17: Partner System (formerly "As Samer")

---

### LIRA-037: Partner System — Multi-Partner Transaction & Settlement

| Field                | Value                                                              |
| -------------------- | ------------------------------------------------------------------ |
| **Epic**             | Partner System                                                     |
| **Type**             | Feature                                                            |
| **Priority**         | High                                                               |
| **Status**           | TODO — Design Finalized                                            |
| **Affected Modules** | OMT, Whish, Custom Services, Settings, Checkpoints                |
| **Assigned To**      | —                                                                  |
| **Depends On**       | LIRA-044 (cashout method parity — for settlement cashout methods)  |

**Description:**  
A **Partner** is an external shop/business that collaborates with the user's shop. Partners typically don't have their own OMT/Whish systems, so the user performs transactions on their behalf. Each "As [Partner]" transaction creates a ledger entry tracking who owes whom. Settlement is partial — partners can pay or be paid any amount, not necessarily zeroing the balance.

**Terminology:**
- **Partner** = external business entity (e.g., Samer, Ahmad). NOT a client/customer.
- **Client** = a saved customer in the DB with ± balance (debt/credit)
- **Customer** = random passer to the shop, not saved

**Background (from design discussion):**
- LiraTek is for OMT-based shops. OMT shops are exclusively OMT (not Whish), because OMT and Whish are competitors — you work with one, not both.
- Whish System transactions are currently all done via partners (e.g., Samer has the Whish system).
- Partners contact the shop to perform transactions on their behalf. The money physically flows through the shop's drawers, and settlement happens later.
- Multiple partners are supported. Any cashier can perform "As Partner" transactions.
- This is internal bookkeeping — customers don't know/care about partner involvement.

---

#### Data Model

**`partners` table:**

| Column       | Type    | Notes                                    |
|-------------|---------|------------------------------------------|
| `id`        | INTEGER | PK, autoincrement                        |
| `name`      | TEXT    | Required, unique                         |
| `phone`     | TEXT    | Optional                                 |
| `notes`     | TEXT    | Optional                                 |
| `is_active` | INTEGER | Default 1                                |
| `created_at`| TEXT    | CURRENT_TIMESTAMP                        |
| `updated_at`| TEXT    | CURRENT_TIMESTAMP                        |

**`partner_ledger` table:**

| Column             | Type    | Notes                                                        |
|-------------------|---------|--------------------------------------------------------------|
| `id`              | INTEGER | PK, autoincrement                                            |
| `partner_id`      | INTEGER | FK → partners.id                                             |
| `transaction_type`| TEXT    | OMT_SEND, OMT_RECEIVE, WHISH_SEND, WHISH_RECEIVE, CUSTOM_SERVICE, SETTLEMENT, ADJUSTMENT |
| `reference_table`  | TEXT    | Source table: `financial_services`, `custom_services`, or NULL (for settlement/adjustment) |
| `reference_id`    | INTEGER | FK → source table row, or NULL                               |
| `amount`          | REAL    | Always positive                                              |
| `currency`        | TEXT    | USD or LBP                                                   |
| `direction`       | TEXT    | DEBIT (partner owes us) or CREDIT (we owe partner)           |
| `notes`           | TEXT    | Optional                                                     |
| `user_id`         | INTEGER | FK → users.id (who recorded it)                              |
| `settlement_method` | TEXT  | For SETTLEMENT type only: CASH, OMT, WHISH, BINANCE, CLIENT_ACCOUNT |
| `created_at`      | TEXT    | CURRENT_TIMESTAMP                                            |

**Balance convention:** `SUM(DEBIT) - SUM(CREDIT)` → Positive = partner owes us, Negative = we owe partner. Same convention as client balance.

**`financial_services` table change:** Add nullable `partner_id` column. When set, the transaction was done "As [Partner]".

---

#### Transaction Flows

| Scenario | Drawer Effect | Partner Ledger | Example |
|---|---|---|---|
| **OMT SEND as Partner** | OMT_System debited (you sent the transfer) | DEBIT — partner owes you (amount + fee paid to OMT) | Samer's customer needs to send $100. You send from your OMT system. Samer owes you $100 + fee. |
| **OMT RECEIVE as Partner** | OMT_System credited (you received the transfer) | CREDIT — you owe partner (payout amount) | Samer's customer has incoming $200. You record receive in your OMT system. You owe Samer $200 (he pays his own customer). |
| **Whish SEND as Partner** | Whish_System debited | DEBIT — partner owes you | Same as OMT SEND but via Whish system. |
| **Whish RECEIVE as Partner** | Whish_System credited | CREDIT — you owe partner | Same as OMT RECEIVE but via Whish system. |
| **Buy service FROM Partner** | No drawer effect | CREDIT — you owe partner (purchase cost) | Buy Netflix account from Samer for $10. Record immediately at purchase time. |
| **Settlement: partner pays us** | Depends on method (Cash → General credited, etc.) | DEBIT entry — reduces partner's debt to us | Samer gives you $150 cash. General drawer +$150, partner balance decreases. |
| **Settlement: we pay partner** | Depends on method (Cash → General debited, etc.) | CREDIT entry — reduces what we owe partner | You give Samer $200 cash. General drawer -$200, partner balance decreases. |

**Key:** No customer visits the shop for partner transactions. General drawer is NOT affected by the transaction itself — only by settlement. Commission from OMT/Whish is the shop's to keep, not tracked in partner ledger.

---

#### Implementation Plan

##### Phase 1: Database — Partners & Ledger

- [ ] Create `partners` table
- [ ] Create `partner_ledger` table
- [ ] Add `partner_id` (nullable) to `financial_services` table
- [ ] Migration version increment
- [ ] Update `create_db.sql` with new tables
- [ ] Update `schema_migrations` seed block

##### Phase 2: Backend — Repository & Service

- [ ] Create `PartnerRepository` with:
  - `create()`, `getById()`, `getAll()`, `update()`, `deactivate()`
  - `addLedgerEntry()`, `getLedgerEntries(partnerId, filters)`
  - `getBalance(partnerId)` → returns `{ usd: number, lbp: number }`
  - `getAllBalances()` → summary for all partners
- [ ] Create `PartnerService` with:
  - CRUD operations with validation
  - `recordPartnerTransaction(partnerId, transactionType, referenceId, amount, currency, direction)`
  - `settle(partnerId, amount, currency, settlementMethod)` — creates SETTLEMENT ledger entry + drawer effect via cashout method
  - `getPartnerStatement(partnerId, dateRange?)` — full transaction history
- [ ] Singleton pattern, logger, exports in index files
- [ ] Update `FinancialServiceRepository.ts`:
  - When `partner_id` is set on a SEND: debit system drawer, skip General drawer credit (no cash received by shop)
  - When `partner_id` is set on a RECEIVE: credit system drawer, skip General drawer debit (no cash paid out by shop)
  - Auto-create `partner_ledger` entry for each partner transaction
- [ ] Update `FinancialService.ts` to accept and pass `partnerId`

##### Phase 3: Electron — IPC Handlers & Preload

- [ ] Create `partnerHandlers.ts`:
  - `partner:create`, `partner:update`, `partner:deactivate`
  - `partner:get-all`, `partner:get-by-id`
  - `partner:get-balance`, `partner:get-all-balances`
  - `partner:get-ledger`, `partner:get-statement`
  - `partner:settle`
- [ ] Register in `main.ts`
- [ ] Add preload bindings in `preload.ts` under `window.api.partners.*`
- [ ] Add TypeScript types to `electron.d.ts`

##### Phase 4: Frontend — Partner Management

- [ ] **Settings > Partners page**: list all partners, add/edit/deactivate
- [ ] **Partner Detail page**: balance (USD + LBP), full transaction history with details (date, type, amount, customer name, notes), settlement button
- [ ] **Settlement Modal**: amount field (partial settlement), currency selector, cashout method picker (reuse from LIRA-044), confirm button
- [ ] Add route in `App.tsx`

##### Phase 5: Frontend — "As Partner" on Transaction Forms

- [ ] Create reusable `PartnerSelector` component — dropdown of active partners, shown on applicable forms
- [ ] Add partner selector to:
  - OMT System Send/Receive forms
  - Whish System Send/Receive forms
  - Custom Services form (for sourcing from partner)
- [ ] When a partner is selected:
  - Pass `partnerId` to the IPC call
  - Visual indicator on the form ("As Samer" badge)
  - No customer payment method needed for partner transactions (the partner handles their customer)
- [ ] In session cart: partner transactions should show partner name in the label

##### Phase 6: Testing & Verification

- [ ] Unit tests for `PartnerRepository` and `PartnerService`
- [ ] Integration tests: partner transaction → ledger entry → balance calculation
- [ ] Test settlement with various cashout methods
- [ ] Test OMT SEND/RECEIVE as partner → verify correct drawer effects (no General drawer movement)
- [ ] Typecheck, lint, build verification

---

#### Acceptance Criteria

- [ ] Multiple partners can be created and managed (CRUD)
- [ ] Partner selector dropdown on OMT Send/Receive, Whish System Send/Receive, Custom Services
- [ ] "As Partner" transactions affect system drawers (OMT/Whish) but NOT General drawer
- [ ] Partner ledger auto-created for each "As Partner" transaction with correct direction
- [ ] Partner balance calculated as net of all ledger entries (per currency: USD + LBP)
- [ ] Positive balance = partner owes shop, negative = shop owes partner
- [ ] Partner detail page shows full transaction history with details
- [ ] Partial settlement supported — amount field, not forced to zero
- [ ] Settlement uses cashout methods (CASH, OMT, WHISH, BINANCE, CLIENT_ACCOUNT) with correct drawer effects
- [ ] Buying services from a partner records CREDIT ledger entry at purchase time
- [ ] Commission from OMT/Whish is NOT tracked in partner ledger (shop keeps it)
- [ ] Any cashier can perform "As Partner" transactions
- [ ] Fresh start — no migration of existing Whish System/supplier data
- [ ] All tests pass, typecheck clean, build succeeds

---

#### Files to Create

- `packages/core/src/repositories/PartnerRepository.ts`
- `packages/core/src/services/PartnerService.ts`
- `electron-app/handlers/partnerHandlers.ts`
- `frontend/src/features/partners/pages/Partners/index.tsx`
- `frontend/src/features/partners/pages/PartnerDetail/index.tsx`
- `frontend/src/features/partners/components/PartnerSelector.tsx`
- `frontend/src/features/partners/components/SettlementModal.tsx`
- `packages/core/src/repositories/__tests__/PartnerRepository.test.ts`
- `packages/core/src/services/__tests__/PartnerService.test.ts`

#### Files to Modify

- `packages/core/src/db/migrations/index.ts` — new migration
- `electron-app/create_db.sql` — new tables + schema_migrations
- `packages/core/src/repositories/index.ts` — export PartnerRepository
- `packages/core/src/services/index.ts` — export PartnerService
- `packages/core/src/repositories/FinancialServiceRepository.ts` — partner_id handling, skip General drawer for partner txns
- `packages/core/src/services/FinancialService.ts` — accept partnerId
- `electron-app/main.ts` — register partner handlers
- `electron-app/preload.ts` — partner API bindings
- `frontend/src/types/electron.d.ts` — partner types
- `frontend/src/app/App.tsx` — partner routes
- `frontend/src/features/recharge/components/FinancialForm.tsx` — partner selector
- `frontend/src/features/recharge/components/OmtWhishAppTransferForm.tsx` — partner selector (if applicable)
- `frontend/src/features/services/pages/Services/index.tsx` — partner selector for sourcing

---

---

## Known Tech Debt

- [ ] **Re-enable negative amount validation** in `useDrawerAmounts.ts` — currently disabled to allow negative drawer balances during checkpoint. Restore the `value < 0` check and unskip the test in `useDrawerAmounts.test.ts` once the opening-balance workflow guarantees non-negative starting values. _(from LIRA-006)_
- [x] **~~Fix `getLastCheckpointActuals()` dropping negative balances~~** — Fixed: `WHERE physical_amount > 0` → `WHERE physical_amount IS NOT NULL`. _(from LIRA-008)_
- [x] **~~Fix checkpoint timestamp ordering~~** — Fixed: `ORDER BY created_at DESC` → `ORDER BY id DESC`. _(from LIRA-008)_

---

## Summary Table

| ID       | Title                             | Epic              | Priority | Status |
| -------- | --------------------------------- | ----------------- | -------- | ------ |
|          | **Sessions Overhaul**             |                   |          |        |
| LIRA-041 | Binance Receive Layout & Sessions | Sessions Overhaul | Medium   | DONE   |
|          | **Reverse Debt**                  |                   |          |        |
| LIRA-030 | Customer Credit / Reverse Debt    | Reverse Debt      | High     | DONE   |
|          | **Partner System**                  |                    |          |                               |
| LIRA-037 | Partner System (Multi-Partner)      | Partner System     | High     | TODO — Design Finalized       |
|          | **Cashout Parity**                  |                    |          |                               |
| LIRA-044 | Full Cashout Method Parity          | Cashout Parity     | High     | TODO                          |
