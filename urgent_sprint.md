# LiraTek POS — Urgent Sprint Backlog

> **Sprint Goal:** Fix all critical blockers and deliver high-priority features  
> **Created:** 2026-04-23  
> **Last Updated:** 2026-05-07  
> **Status Legend:** `TODO` | `IN PROGRESS` | `PARTIAL` | `DONE` | `BLOCKED` | `TBD`

---

## Epic 2: Unified Checkpoint System (formerly Opening/Closing)

> Merge Opening and Closing into a single "Checkpoint" that can be done at any time. Fix the dashboard reset bug. Add variance alerting. This is a major architectural change to the daily operations flow.

---

### LIRA-006: Checkpoint Variance Alert Icons

| Field               | Value                                 |
| ------------------- | ------------------------------------- |
| **Epic**            | Unified Checkpoint System             |
| **Type**            | Feature                               |
| **Priority**        | Medium                                |
| **Status**          | TODO                                  |
| **Affected Module** | Checkpoint Timeline, Checkpoint Modal |
| **Assigned To**     | —                                     |

**Description:**  
When a checkpoint has a discrepancy (actual ≠ expected), display a visual alert icon (e.g., warning triangle) on that checkpoint entry. This helps the user quickly identify which checkpoint had a variance and by how much.

Additionally, customer credit deposits (reverse debts — see LIRA-020) must be excluded from being flagged as "extra" money. For example, if a customer leaves $40 at the shop as credit, that $40 should not trigger a variance alert because the system knows it belongs to client X.

**Acceptance Criteria:**

- [ ] Alert icon displayed on checkpoint entries where actual ≠ expected for any drawer/currency
- [ ] Icon shows on the `CheckpointTimeline` list view
- [ ] Clicking the icon shows a breakdown of which drawers have variance
- [ ] Customer credit deposits are subtracted from "extra" before determining if alert is needed
- [ ] Tooltip or detail shows the variance amount

**Dependencies:**

- LIRA-030 (Reverse Debt / Customer Credit — for exclusion logic)

**Files to Modify:**

- `frontend/src/features/closing/components/CheckpointTimeline/index.tsx`
- `frontend/src/features/closing/components/VarianceCard.tsx`
- `packages/core/src/services/ClosingService.ts`

---

### LIRA-008: Checkpoint Stress Test & Acceptance Validation

| Field           | Value                     |
| --------------- | ------------------------- |
| **Epic**        | Unified Checkpoint System |
| **Type**        | QA / Testing              |
| **Priority**    | High                      |
| **Status**      | TODO                      |
| **Depends On**  | LIRA-006                  |
| **Assigned To** | —                         |

**Description:**  
End-to-end acceptance test that replicates the real shop flow:

**Test Scenario:**

1. Start fresh — no checkpoints exist
2. Create transactions across multiple modules (POS sale, exchange, OMT send, MTC recharge, expense)
3. Do Checkpoint #1 — verify expected amounts match the sum of transactions
4. Enter actual amounts (some matching, some with variance)
5. Save checkpoint — verify it records correctly
6. Create more transactions
7. Do Checkpoint #2 — verify baseline = Checkpoint #1 actuals, and expected = baseline + new transactions
8. Verify dashboard values are NOT affected by either checkpoint
9. Verify variance alert icons appear where actual ≠ expected
10. Verify `CheckpointTimeline` shows both checkpoints correctly

**Acceptance Criteria:**

- [ ] Full flow above passes without errors
- [ ] Expected amounts are mathematically correct across all drawers
- [ ] Dashboard unaffected
- [ ] Timeline displays correctly
- [ ] Variance alerts work
- [ ] Multi-currency amounts correct (USD, LBP, EUR if active)

---

## Epic 4: Transaction Timestamp Override

> Allow users to enter a transaction at a specific past time if they missed recording it.

---

### LIRA-011: Optional Time Field on All Transaction Forms

| Field                | Value                          |
| -------------------- | ------------------------------ |
| **Epic**             | Transaction Timestamp Override |
| **Type**             | Feature                        |
| **Priority**         | Medium                         |
| **Status**           | TODO                           |
| **Affected Modules** | All transaction forms          |
| **Assigned To**      | —                              |

**Description:**  
Add an optional datetime picker to all transaction creation forms. If the user missed recording a transaction at 10:00 AM, they can enter it later and set the time to 10:00 AM. If not specified, defaults to current time.

**Acceptance Criteria:**

- [ ] Optional datetime picker available on all transaction forms
- [ ] Defaults to current date/time if not used
- [ ] Selected time is used as the transaction's `created_at`
- [ ] Time cannot be set in the future (validation)
- [ ] Time cannot be set before the last checkpoint (validation — prevents backdating past a reconciled period)
- [ ] Transaction appears in correct chronological position in history views
- [ ] Dashboard and checkpoint calculations use the overridden time correctly

**Technical Notes:**

- Add `transaction_time?: string` parameter to all create methods in services
- Use `COALESCE(?, CURRENT_TIMESTAMP)` in SQL INSERT statements
- Frontend: use a time picker component (consider `input type="datetime-local"`)
- Collapsed by default, expandable via "Set custom time" link to keep forms clean

**Files to Modify:**

- All service `create()` methods
- All repository `create()` methods
- All IPC handlers (accept optional `transaction_time`)
- All frontend transaction forms (add datetime picker)

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
| **Status**          | PARTIAL — Blocked by LIRA-030       |
| **Affected Module** | Mobile Recharge > Binance, Sessions |
| **Assigned To**     | —                                   |

**Description:**  
Binance Receive (customer sends crypto to shop, cashes out) may not be properly handled in the current layout. The shop increases its Binance drawer and decreases general drawer by the same amount, then gets paid the fee. When in a customer session, the receive amount minus fee should appear as a negative cart item (shop pays out to customer). Needs review and testing.

**Notes:**

- SEND: customer pays amount + fee (positive in cart)
- RECEIVE: customer receives amount - fee (negative in cart)
- Verify drawer logic is correct for both directions

---

## Epic 8: MTC/Alfa Recharge Improvements

> Beyond the critical fix in LIRA-003, additional improvements needed.

---

### LIRA-022: Margin Alert in Recharge History

| Field               | Value                     |
| ------------------- | ------------------------- |
| **Epic**            | MTC/Alfa Improvements     |
| **Type**            | Feature                   |
| **Priority**        | Medium                    |
| **Status**          | TODO                      |
| **Affected Module** | Mobile Recharge > History |
| **Assigned To**     | —                         |

**Description:**  
Show a visual alert/badge on history entries where the price-to-client was manually changed from the auto-calculated default and the margin exceeds 100,000 LBP. This is a theft detection mechanism — exposes users who overcharge customers and pocket the difference.

**Acceptance Criteria:**

- [ ] History entries show an alert icon (e.g., red warning) when margin > 100,000 LBP
- [ ] Tooltip shows: "Price to client was modified — margin: X LBP"
- [ ] Alert only triggers when price was manually overridden (not when default price naturally exceeds threshold)
- [ ] Works for both MTC and Alfa

**Technical Notes:**

- Need to store `default_price_to_client` alongside `price_to_client` to detect manual changes
- Or calculate expected price at display time using the rate that was active at transaction creation

**Files to Modify:**

- `frontend/src/features/recharge/components/HistoryModal.tsx`
- `packages/core/src/repositories/RechargeRepository.ts` (store default price or rate snapshot)

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

## Epic 14: Custom Services & Item Selector

---

### LIRA-033: Netflix / Account Selling in Services

| Field               | Value           |
| ------------------- | --------------- |
| **Epic**            | Custom Services |
| **Type**            | Feature         |
| **Priority**        | Low             |
| **Status**          | TODO            |
| **Affected Module** | Custom Services |
| **Assigned To**     | —               |

**Description:**  
Ensure custom services can handle selling digital accounts (Netflix, Spotify, etc.) as a transaction. This is a straightforward service sale — no inventory tracking of how many accounts are available. The shop records the selling transaction with cost and price.

When accounts are sourced from "Samer" (external entity), the "As Samer" button should be available to flag the transaction for settlement.

**Acceptance Criteria:**

- [ ] Custom service form can record Netflix/Spotify/etc. account sales
- [ ] Cost and price recorded, profit calculated
- [ ] "As Samer" flag available (depends on Epic 17)
- [ ] No stock tracking needed — just transaction recording

**Dependencies:** Epic 17 (As Samer) for the external entity flag

---

## Epic 17: "As Samer" — External Entity System _(TBD — Large Feature)_

---

### LIRA-037: External Entity ("As Samer") System Design

| Field                | Value                                                  |
| -------------------- | ------------------------------------------------------ |
| **Epic**             | As Samer                                               |
| **Type**             | Feature                                                |
| **Priority**         | High                                                   |
| **Status**           | TBD — Needs Design Discussion                          |
| **Affected Modules** | Services, Custom Services, Debts, Settings > Suppliers |
| **Assigned To**      | —                                                      |

**Description:**  
"Samer" represents an external shop/partner that the user does business with. Currently, Samer is loosely associated with the Whish System drawer and supplier settlement. This needs to be formalized into a proper external entity system.

**Core Concept:**

- Samer is a foreign entity (external shop) the user collaborates with
- Some OMT/Whish transactions are done "as Samer" (on his behalf or through his system)
- Debts flow both ways between the shop and Samer
- Settlement happens periodically via Settings > Suppliers
- Services (Netflix accounts, etc.) can be sourced from Samer

**Planned Capabilities:**

- "As Samer" toggle button on: OMT Send, OMT Receive, Whish System Send/Receive, Custom Services
- Transactions flagged "As Samer" are tracked in a dedicated settlement ledger
- Settlement page showing: all Samer transactions, mutual debts, net balance, settlement history
- Services purchased from Samer create a debt entry (shop owes Samer)

**Acceptance Criteria:**

- [ ] TBD — requires design session
- [ ] Should support multiple external entities (not just Samer) for future extensibility
- [ ] Settlement flow clearly shows who owes whom and how much

**Design Questions to Resolve:**

1. Is this a generic "External Entity" system or hardcoded for Samer only?
2. How does Samer's settlement relate to the existing supplier ledger?
3. Should Samer have his own "drawer" for tracking purposes?
4. How do Samer debts interact with the reverse debt system (LIRA-030)?
5. What reports does the user need for Samer reconciliation?

**Current State:**

- Samer is currently the Whish System supplier
- Settlement happens via `Settings > Suppliers > Supplier Ledger`
- `supplier_ledger` table tracks TOP_UP, PAYMENT, ADJUSTMENT, SETTLEMENT entries

---

## Epic 19: Opening/Closing & OMT Fix Verification

---

### LIRA-038: Verify Opening/Closing Works After Checkpoint Refactor

| Field           | Value        |
| --------------- | ------------ |
| **Epic**        | Verification |
| **Type**        | QA           |
| **Priority**    | High         |
| **Status**      | TODO         |
| **Depends On**  | LIRA-006     |
| **Assigned To** | —            |

**Description:**  
After implementing the checkpoint refactor and OMT fix, perform a comprehensive verification:

1. Create transactions in all modules
2. Perform a checkpoint — verify all drawer amounts are correct
3. Create an OMT transaction — verify it saves and records correctly
4. Perform another checkpoint — verify OMT transaction is reflected
5. Verify dashboard is not affected

**Acceptance Criteria:**

- [ ] All module transactions save correctly
- [ ] Checkpoint expected amounts are accurate
- [ ] OMT transactions save without error
- [ ] Dashboard values independent of checkpoints
- [ ] No regressions in existing functionality

---

## Summary Table

| ID       | Title                               | Epic               | Priority | Status                        |
| -------- | ----------------------------------- | ------------------ | -------- | ----------------------------- |
|          | **Checkpoint System**               |                    |          |                               |
| LIRA-006 | Checkpoint Variance Alerts          | Checkpoint System  | Medium   | TODO                          |
| LIRA-008 | Checkpoint Stress Test              | Checkpoint System  | High     | TODO                          |
|          | **Timestamp Override**              |                    |          |                               |
| LIRA-011 | Optional Time Field on Transactions | Timestamp Override | Medium   | TODO                          |
|          | **Sessions Overhaul**               |                    |          |                               |
| LIRA-041 | Binance Receive Layout & Sessions   | Sessions Overhaul  | Medium   | PARTIAL (blocked by LIRA-030) |
|          | **MTC/Alfa**                        |                    |          |                               |
| LIRA-022 | Margin Alert in Recharge History    | MTC/Alfa           | Medium   | TODO                          |
|          | **Reverse Debt**                    |                    |          |                               |
| LIRA-030 | Customer Credit / Reverse Debt      | Reverse Debt       | High     | TBD                           |
|          | **Custom Services**                 |                    |          |                               |
| LIRA-033 | Netflix Account Selling             | Custom Services    | Low      | TODO                          |
|          | **As Samer**                        |                    |          |                               |
| LIRA-037 | "As Samer" External Entity System   | As Samer           | High     | TBD                           |
|          | **Verification**                    |                    |          |                               |
| LIRA-038 | Post-Refactor Verification          | Verification       | High     | TODO                          |
