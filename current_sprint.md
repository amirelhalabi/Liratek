# LiraTek POS — Current Sprint

> **Sprint Focus:** Exchange Rate System, OMT/Whish fixes, Sell Prices, Cashout Parity & Base System  
> **Created:** 2026-04-23  
> **Last Updated:** 2026-05-16  
> **Status Legend:** `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED`

---

## LIRA-047: Reverse Partner Flow — Partner Requests Transactions Through Our System (Highest Priority)

| Field                | Value                                                          |
| -------------------- | -------------------------------------------------------------- |
| **Epic**             | Partner System                                                 |
| **Type**             | Feature                                                        |
| **Priority**         | Highest                                                        |
| **Status**           | TODO                                                           |
| **Affected Modules** | OMT/Whish Services, Partners, Partner Ledger, Settings         |
| **Assigned To**      | —                                                              |
| **Depends On**       | LIRA-037 (DONE), LIRA-045 (DONE), LIRA-046 (DONE)             |

---

### Summary

Allow partners to request transactions through **our** system. Currently partners are only used when **we** do transactions through **their** system ("through partner"). The new flow is the reverse: partner calls us to do a txn on our system on their behalf ("for partner").

**Analogy:** This is like CUSTOMER_ACCOUNT payment/cashout — instead of affecting a cash drawer, we debit/credit the partner's balance.

---

### Context & Business Logic

| Shop base  | Our system | Partner's system | Existing flow ("through partner")     | New flow ("for partner")                   |
| ---------- | ---------- | ---------------- | ------------------------------------- | ------------------------------------------ |
| OMT shop   | OMT        | WHISH            | We do WHISH txns through partner      | Partner does OMT txns through us           |
| WHISH shop | WHISH      | OMT              | We do OMT txns through partner        | Partner does WHISH txns through us         |

**Example — OMT shop, partner has Whish system:**

- Partner's customer needs to send $50 via OMT. Partner calls us.
- We execute the OMT SEND on our system.
- Partner owes us $50 (total incl fees) — recorded as DEBIT in partner ledger.
- OMT_System drawer is credited (we owe OMT) — normal supplier tracking continues.
- NO cash enters our General drawer (partner collected from their customer).

- Partner's customer has incoming $100 OMT receive. Partner calls us.
- We execute the OMT RECEIVE on our system.
- We owe the partner $100 (payout amount) — recorded as CREDIT in partner ledger.
- OMT_System drawer is debited (OMT owes us $100 + commission) — normal supplier tracking continues.
- NO cash leaves our drawers (partner pays out their own customer).
- Commission is OURS to keep (not owed to partner).

---

### Two Partner Modes — Key Distinction

| Mode                         | Who owns the system | Detection                           | System drawer        | Cash/General drawer | Partner ledger                      |
| ---------------------------- | ------------------- | ----------------------------------- | -------------------- | ------------------- | ----------------------------------- |
| **"Through partner"** (existing) | Partner owns it     | `provider === partnerSystem`        | Not affected (not ours) | Not affected        | DEBIT (SEND) / CREDIT (RECEIVE)    |
| **"For partner"** (NEW)         | WE own it           | `provider === baseSystem && partnerId` | IS affected (it's ours) | NOT affected (partner handles cash) | DEBIT (SEND) / CREDIT (RECEIVE)    |

**Detection logic:** Compare `data.provider` against shop's `baseSystem` setting:
- `provider === baseSystem` + `partnerId` → **"For partner"** (they're using our system)
- `provider === partnerSystem` + `partnerId` → **"Through partner"** (we're using theirs)

---

### Current Backend Behavior vs Required (Bug Analysis)

The existing partner logic in `FinancialServiceRepository.ts` was built for "through partner" only. Here's what's wrong for the "for partner" case:

#### SEND

| Step | Current behavior with `partnerId` | Correct for "through partner" | Correct for "for partner" |
| ---- | --------------------------------- | ----------------------------- | ------------------------- |
| General drawer credit | Skipped ✅ | ✅ Skip (not our system) | ✅ Skip (partner has cash) |
| RESERVE from General | Skipped ✅ | ✅ Skip | ✅ Skip |
| System drawer credit | +totalCollected (always runs) | ❌ Should skip (not our drawer) | ✅ Keep (we owe OMT) |

**Issue:** For "through partner" SEND, the system drawer (e.g., Whish_System) should NOT be credited either — but currently it is. This may already be handled correctly if `useSystemDrawerFlow` accounts for it. **Needs verification.**

#### RECEIVE ⚠️ MAIN BUG

| Step | Current behavior with `partnerId` | Correct for "through partner" | Correct for "for partner" |
| ---- | --------------------------------- | ----------------------------- | ------------------------- |
| System drawer debit | Skipped (line 1361-1374) | ✅ Skip (not our system) | ❌ **SHOULD debit** (OMT owes us!) |
| Cashout drawer debit | Skipped (line 1394-1397) | ✅ Skip | ✅ Skip (partner pays out) |

**Fix needed:** When `provider === baseSystem && partnerId` (for partner), the system drawer MUST be debited. Only skip it for "through partner".

#### Partner Ledger Amounts

| Scenario | Current amount | Correct amount |
| -------- | -------------- | -------------- |
| SEND (for partner) | `data.amount` | `totalCollected` (amount + omtFee) — partner owes us everything |
| RECEIVE (for partner) | `data.amount` | `receiveAmount` (just the payout) — we owe partner what they pay their customer, NOT our commission |

---

### Implementation Plan

#### Phase 1: Backend — Fix Partner Mode Detection & Drawer Logic

- [ ] **Read `shop_base_system` from settings** inside `FinancialServiceRepository.addTransaction()` (or accept as param)
- [ ] **Add `isForPartner` / `isThroughPartner` helper logic:**
  ```
  const shopBaseSystem = getShopBaseSystem(); // "OMT" or "WHISH"
  const isForPartner = !!data.partnerId && data.provider === shopBaseSystem;
  const isThroughPartner = !!data.partnerId && data.provider !== shopBaseSystem;
  ```
- [ ] **Fix RECEIVE system drawer logic (line 1361-1374):**
  - `isThroughPartner` → skip system drawer debit (existing behavior, correct)
  - `isForPartner` → DO debit system drawer (OMT/Whish owes us)
  - No partner → DO debit system drawer (normal flow)
- [ ] **Fix partner ledger amount (line 1492-1517):**
  - SEND: use `totalCollected` (amount + fees) instead of `data.amount`
  - RECEIVE: use `receiveAmount` instead of `data.amount` (exclude commission — that's ours)
- [ ] **Add `mode` field to partner ledger insert:** `"for_partner"` or `"through_partner"` — useful for filtering/display later

#### Phase 2: Database — Migration for `partner_ledger.mode`

- [ ] Migration v81 (or next): Add `mode TEXT` column to `partner_ledger` (nullable for existing rows)
- [ ] Update `create_db.sql` with new column
- [ ] Values: `"for_partner"` | `"through_partner"` | NULL (legacy/manual entries)

#### Phase 3: Frontend — Show PartnerSelector on Base System Transactions

- [ ] In `Services/index.tsx`: show `PartnerSelector` for ALL providers, not just `partnerSystem`
  - `partnerSystem` provider: **required** (existing behavior)
  - `baseSystem` provider: **optional** — when selected, means "doing this for a partner"
- [ ] **System filter for partner dropdown:** Show partners with `system_association = partnerSystem` (they have the other system, that's why they're asking us)
- [ ] **Visual indicator:** When partner selected on baseSystem txn, show banner: "Executing for partner: [name] — no cash exchange at counter"
- [ ] **No payment method needed** for "for partner" txns (partner handles their customer's cash) — same as existing "through partner" behavior

#### Phase 4: Frontend — Partners Page Enhanced View (Similar to Debts Page)

- [ ] **Enrich ledger entries with transaction details:**
  - Backend: JOIN `partner_ledger` with `financial_services` when `reference_table = 'financial_services'`
  - Return: provider, serviceType, omtServiceType, recipient name/phone, amount, fees, commission, cashout method
  - New API or enrich existing `partners:getLedger` response

- [ ] **Enhanced ledger row display:**
  - Show transaction details inline (not just "OMT SEND" — show "OMT SEND INTRA $50 to [recipient]")
  - Show mode badge: "For partner" (green) vs "Through partner" (blue) vs "Settlement" (yellow)
  - Show fees/commission breakdown on hover or expand
  - Clickable to view full transaction details

- [ ] **Balance summary card — enhanced:**
  - Net balance (they owe us / we owe them) per currency
  - Breakdown by mode: "For partner: +$150 | Through partner: -$80"
  - Breakdown by provider: "OMT: +$200 | WHISH: -$130"

- [ ] **Filters (similar to debts page):**
  - By mode: All | For partner | Through partner
  - By provider: OMT | WHISH | ALL
  - By direction: DEBIT | CREDIT | ALL
  - Date range (already exists)

- [ ] **Settlement improvements:**
  - Show clear breakdown of what's owed and why before settling
  - Mark individual ledger entries as settled (track which entries were covered)

- [ ] **Transaction linking:**
  - Ledger entries with `reference_table = 'financial_services'` link to original txn
  - Show inline preview with key details
  - "View original transaction" link to history

#### Phase 5: Testing & Verification

- [ ] Unit tests for new "for partner" flow in `FinancialServiceRepository`
- [ ] Test OMT SEND for partner → system drawer +totalCollected, partner DEBIT totalCollected, no General movement
- [ ] Test OMT RECEIVE for partner → system drawer -totalOwed, partner CREDIT receiveAmount, no cashout movement
- [ ] Test WHISH SEND/RECEIVE for partner (when shop is WHISH-base)
- [ ] Test existing "through partner" flow unchanged
- [ ] Test partner page shows enriched ledger with mode badges
- [ ] Typecheck, lint, build pass

---

### Acceptance Criteria

- [ ] PartnerSelector appears on baseSystem SEND/RECEIVE (optional)
- [ ] "For partner" OMT SEND: partner DEBIT'd `totalCollected`, OMT_System +totalCollected, no General movement
- [ ] "For partner" OMT RECEIVE: partner CREDIT'd `receiveAmount`, OMT_System -totalOwed, no cashout drawer movement
- [ ] Commission on RECEIVE is kept by shop (NOT included in partner CREDIT)
- [ ] Works bidirectionally: OMT-base shop doing OMT for partner, WHISH-base shop doing WHISH for partner
- [ ] Supplier ledger still records normally in all cases (we interact with provider regardless)
- [ ] Existing "through partner" flow completely unchanged
- [ ] Normal (no partner) transactions unaffected
- [ ] Partners page shows enriched transaction view with mode badges and details
- [ ] Partners page filters by mode, provider, direction, date
- [ ] Partners page balance breakdown by mode and provider
- [ ] Partner ledger entries link to original financial_services transaction
- [ ] All tests pass, typecheck clean, build succeeds

---

### Estimated Effort

Medium-Large — ~6-8 hours total:
- Backend logic fix: ~2 hours
- Migration: ~30 min
- Frontend PartnerSelector on base system: ~1 hour
- Partners page enhanced view: ~3-4 hours
- Testing: ~1 hour

---

### Files to Modify

| Layer | File | Change |
|-------|------|--------|
| Backend | `packages/core/src/repositories/FinancialServiceRepository.ts` | Fix RECEIVE system drawer for "for partner", fix ledger amounts, add mode |
| Backend | `packages/core/src/repositories/PartnerRepository.ts` | Enrich `getLedger()` to JOIN financial_services details |
| Backend | `packages/core/src/services/PartnerService.ts` | Expose enriched ledger |
| Database | `packages/core/src/db/migrations/index.ts` | Migration: add `mode` to `partner_ledger` |
| Database | `electron-app/create_db.sql` | Update schema |
| Frontend | `frontend/src/features/services/pages/Services/index.tsx` | Show optional PartnerSelector for baseSystem |
| Frontend | `frontend/src/features/partners/pages/Partners/index.tsx` | Enhanced ledger view, filters, mode badges, balance breakdown |
| Frontend | `frontend/src/features/partners/components/PartnerSelector.tsx` | Ensure filter works for both modes |
| Electron | `electron-app/handlers/partnerHandlers.ts` | Expose enriched ledger endpoint |
| Types | `frontend/src/types/electron.d.ts` | Update PartnerLedgerEntry with mode, txn details |

---

## Exchange Rate System & OMT/Whish (High Priority)

| ID     | Task                                 | Status | Notes                                                                       |
| ------ | ------------------------------------ | ------ | --------------------------------------------------------------------------- |
| CS-001 | Whish App SEND/RECEIVE toggle        | DONE   | ✅ Toggle implemented in Services/index.tsx and OmtWhishAppTransferForm.tsx |
| CS-002 | OMT System Rate settings UI          | DONE   | ✅ Settings UI exists, rates loaded dynamically from DB (migration v48)     |
| CS-003 | Whish System Rate settings UI        | DONE   | ✅ Settings UI exists, rates loaded dynamically from DB (migration v48)     |
| CS-004 | All rates dynamically loaded from DB | DONE   | ✅ Rates stored in `exchange_rates` table, loaded via hooks/API calls       |

---

## Cashout Method Parity (High Priority)

| ID       | Task                       | Status | Notes                                                                                                       |
| -------- | -------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| LIRA-044 | Full Cashout Method Parity | DONE   | ✅ All cashout methods (CASH, CUSTOMER_ACCOUNT, OMT, WHISH, BINANCE) implemented with correct drawer debits |

**Summary:** Currently RECEIVE transactions only support Cash or Client Account cashout. Need to add OMT wallet, Whish wallet, and Binance as cashout options — each debiting the correct drawer.

**Phases:**

1. Backend — Expand cashout enum & drawer logic per method
2. Frontend — Reusable `CashoutMethodPicker` on all RECEIVE forms
3. Rename `CUSTOMER_ACCOUNT` → `CLIENT_ACCOUNT` everywhere
4. Checkpoint & Closing integration

---

## Configurable Shop Base System (Medium Priority)

| ID       | Task                                              | Status | Notes                                                                                                                                                    |
| -------- | ------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LIRA-046 | Configurable Base System (OMT-Base vs Whish-Base) | DONE   | ✅ Migration v80 adds shop_base_system setting. Setup wizard step, useShopBase hook, dynamic partner logic in Services page, checkpoint inactive drawer. |

**Summary:** After LIRA-045 hardcoded OMT-base behavior, this ticket makes it dynamic — shop chooses base system during setup, partner-routing logic adapts accordingly.

**Implementation (completed 2026-05-15):**

- Migration v80: `shop_base_system` setting (default OMT for existing shops)
- Setup wizard: new Step 2 with OMT/Whish card selection
- `useShopBase()` hook: globally cached, returns `{ baseSystem, partnerSystem }`
- Services page: dynamic partner requirement based on `partnerSystem`
- Checkpoint: partner-system drawer greyed out when no active partner
- Setup handler: saves base system + deactivates partner supplier

---

## Sell Prices & Dev Mode Testing (Medium Priority)

| ID     | Task                              | Status | Notes                                                    |
| ------ | --------------------------------- | ------ | -------------------------------------------------------- |
| CS-005 | Update remaining sell prices      | TODO   | ~48% done — 199 items still have sell price "0"          |
| CS-006 | Dev mode full transaction testing | TODO   | End-to-end test of all transaction types in dev mode     |
| CS-007 | Price validation (cost < sell)    | TODO   | Validate that selling price > cost price on product save |

---

## Summary

| Priority    | Total  | Done  | Remaining |
| ----------- | ------ | ----- | --------- |
| Highest     | 1      | 0     | 1         |
| High        | 5      | 5     | 0         |
| Medium      | 4      | 1     | 3         |
| **Total**   | **10** | **6** | **4**     |

---

> **Recommendation:** Start with LIRA-044 (Cashout Method Parity) — high impact, unblocks LIRA-046 and improves all RECEIVE transaction flows.

---

## Completed Tickets (Reference)

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

### LIRA-037: Partner System — Multi-Partner Transaction & Settlement

| Field                | Value                                                             |
| -------------------- | ----------------------------------------------------------------- |
| **Epic**             | Partner System                                                    |
| **Type**             | Feature                                                           |
| **Priority**         | High                                                              |
| **Status**           | ✅ DONE                                                           |
| **Affected Modules** | OMT, Whish, Custom Services, Settings, Checkpoints                |
| **Assigned To**      | —                                                                 |
| **Depends On**       | LIRA-044 (cashout method parity — for settlement cashout methods) |

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

| Column       | Type    | Notes             |
| ------------ | ------- | ----------------- |
| `id`         | INTEGER | PK, autoincrement |
| `name`       | TEXT    | Required, unique  |
| `phone`      | TEXT    | Optional          |
| `notes`      | TEXT    | Optional          |
| `is_active`  | INTEGER | Default 1         |
| `created_at` | TEXT    | CURRENT_TIMESTAMP |
| `updated_at` | TEXT    | CURRENT_TIMESTAMP |

**`partner_ledger` table:**

| Column              | Type    | Notes                                                                                      |
| ------------------- | ------- | ------------------------------------------------------------------------------------------ |
| `id`                | INTEGER | PK, autoincrement                                                                          |
| `partner_id`        | INTEGER | FK → partners.id                                                                           |
| `transaction_type`  | TEXT    | OMT_SEND, OMT_RECEIVE, WHISH_SEND, WHISH_RECEIVE, CUSTOM_SERVICE, SETTLEMENT, ADJUSTMENT   |
| `reference_table`   | TEXT    | Source table: `financial_services`, `custom_services`, or NULL (for settlement/adjustment) |
| `reference_id`      | INTEGER | FK → source table row, or NULL                                                             |
| `amount`            | REAL    | Always positive                                                                            |
| `currency`          | TEXT    | USD or LBP                                                                                 |
| `direction`         | TEXT    | DEBIT (partner owes us) or CREDIT (we owe partner)                                         |
| `notes`             | TEXT    | Optional                                                                                   |
| `user_id`           | INTEGER | FK → users.id (who recorded it)                                                            |
| `settlement_method` | TEXT    | For SETTLEMENT type only: CASH, OMT, WHISH, BINANCE, CLIENT_ACCOUNT                        |
| `created_at`        | TEXT    | CURRENT_TIMESTAMP                                                                          |

**Balance convention:** `SUM(DEBIT) - SUM(CREDIT)` → Positive = partner owes us, Negative = we owe partner. Same convention as client balance.

**`financial_services` table change:** Add nullable `partner_id` column. When set, the transaction was done "As [Partner]".

---

#### Transaction Flows

| Scenario                        | Drawer Effect                                     | Partner Ledger                                      | Example                                                                                                                   |
| ------------------------------- | ------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **OMT SEND as Partner**         | OMT_System debited (you sent the transfer)        | DEBIT — partner owes you (amount + fee paid to OMT) | Samer's customer needs to send $100. You send from your OMT system. Samer owes you $100 + fee.                            |
| **OMT RECEIVE as Partner**      | OMT_System credited (you received the transfer)   | CREDIT — you owe partner (payout amount)            | Samer's customer has incoming $200. You record receive in your OMT system. You owe Samer $200 (he pays his own customer). |
| **Whish SEND as Partner**       | Whish_System debited                              | DEBIT — partner owes you                            | Same as OMT SEND but via Whish system.                                                                                    |
| **Whish RECEIVE as Partner**    | Whish_System credited                             | CREDIT — you owe partner                            | Same as OMT RECEIVE but via Whish system.                                                                                 |
| **Buy service FROM Partner**    | No drawer effect                                  | CREDIT — you owe partner (purchase cost)            | Buy Netflix account from Samer for $10. Record immediately at purchase time.                                              |
| **Settlement: partner pays us** | Depends on method (Cash → General credited, etc.) | DEBIT entry — reduces partner's debt to us          | Samer gives you $150 cash. General drawer +$150, partner balance decreases.                                               |
| **Settlement: we pay partner**  | Depends on method (Cash → General debited, etc.)  | CREDIT entry — reduces what we owe partner          | You give Samer $200 cash. General drawer -$200, partner balance decreases.                                                |

**Key:** No customer visits the shop for partner transactions. General drawer is NOT affected by the transaction itself — only by settlement. Commission from OMT/Whish is the shop's to keep, not tracked in partner ledger.

---

#### Implementation Plan

##### Phase 1: Database — Partners & Ledger

- [x] Create `partners` table
- [x] Create `partner_ledger` table
- [x] Add `partner_id` (nullable) to `financial_services` table
- [x] Migration version increment
- [x] Update `create_db.sql` with new tables
- [x] Update `schema_migrations` seed block

##### Phase 2: Backend — Repository & Service

- [x] Create `PartnerRepository` with:
  - `create()`, `getById()`, `getAll()`, `update()`, `deactivate()`
  - `addLedgerEntry()`, `getLedgerEntries(partnerId, filters)`
  - `getBalance(partnerId)` → returns `{ usd: number, lbp: number }`
  - `getAllBalances()` → summary for all partners
- [x] Create `PartnerService` with:
  - CRUD operations with validation
  - `recordPartnerTransaction(partnerId, transactionType, referenceId, amount, currency, direction)`
  - `settle(partnerId, amount, currency, settlementMethod)` — creates SETTLEMENT ledger entry + drawer effect via cashout method
  - `getPartnerStatement(partnerId, dateRange?)` — full transaction history
- [x] Singleton pattern, logger, exports in index files
- [x] Update `FinancialServiceRepository.ts`:
  - When `partner_id` is set on a SEND: debit system drawer, skip General drawer credit (no cash received by shop)
  - When `partner_id` is set on a RECEIVE: credit system drawer, skip General drawer debit (no cash paid out by shop)
  - Auto-create `partner_ledger` entry for each partner transaction
- [x] Update `FinancialService.ts` to accept and pass `partnerId`

##### Phase 3: Electron — IPC Handlers & Preload

- [x] Create `partnerHandlers.ts`:
  - `partner:create`, `partner:update`, `partner:deactivate`
  - `partner:get-all`, `partner:get-by-id`
  - `partner:get-balance`, `partner:get-all-balances`
  - `partner:get-ledger`, `partner:get-statement`
  - `partner:settle`
- [x] Register in `main.ts`
- [x] Add preload bindings in `preload.ts` under `window.api.partners.*`
- [x] Add TypeScript types to `electron.d.ts`

##### Phase 4: Frontend — Partner Management

- [x] **Settings > Partners page**: list all partners, add/edit/deactivate
- [x] **Partner Detail page**: balance (USD + LBP), full transaction history with details (date, type, amount, customer name, notes), settlement button
- [x] **Settlement Modal**: amount field (partial settlement), currency selector, cashout method picker (reuse from LIRA-044), confirm button
- [x] Add route in `App.tsx`

##### Phase 5: Frontend — "As Partner" on Transaction Forms

- [x] Create reusable `PartnerSelector` component — dropdown of active partners, shown on applicable forms
- [x] Add partner selector to:
  - OMT System Send/Receive forms
  - Whish System Send/Receive forms
  - Custom Services form (for sourcing from partner)
- [x] When a partner is selected:
  - Pass `partnerId` to the IPC call
  - Visual indicator on the form ("As Samer" badge)
  - No customer payment method needed for partner transactions (the partner handles their customer)
- [x] In session cart: partner transactions should show partner name in the label

##### Phase 6: Testing & Verification

- [ ] Unit tests for `PartnerRepository` and `PartnerService`
- [ ] Integration tests: partner transaction → ledger entry → balance calculation
- [ ] Test settlement with various cashout methods
- [ ] Test OMT SEND/RECEIVE as partner → verify correct drawer effects (no General drawer movement)
- [x] Typecheck, lint, build verification

---

#### Acceptance Criteria

- [x] Multiple partners can be created and managed (CRUD)
- [x] Partner selector dropdown on OMT Send/Receive, Whish System Send/Receive, Custom Services
- [x] "As Partner" transactions affect system drawers (OMT/Whish) but NOT General drawer
- [x] Partner ledger auto-created for each "As Partner" transaction with correct direction
- [x] Partner balance calculated as net of all ledger entries (per currency: USD + LBP)
- [x] Positive balance = partner owes shop, negative = shop owes partner
- [x] Partner detail page shows full transaction history with details
- [x] Partial settlement supported — amount field, not forced to zero
- [x] Settlement uses cashout methods (CASH, OMT, WHISH, BINANCE, CLIENT_ACCOUNT) with correct drawer effects
- [x] Buying services from a partner records CREDIT ledger entry at purchase time
- [x] Commission from OMT/Whish is NOT tracked in partner ledger (shop keeps it)
- [x] Any cashier can perform "As Partner" transactions
- [x] Fresh start — no migration of existing Whish System/supplier data
- [x] All tests pass, typecheck clean, build succeeds

---

### LIRA-045: OMT-Base Shop — Whish System via Partner

| Field                | Value                                           |
| -------------------- | ----------------------------------------------- |
| **Epic**             | Shop Base System & Partner Provider Routing     |
| **Type**             | Feature / Refactor                              |
| **Priority**         | High                                            |
| **Status**           | ✅ DONE                                         |
| **Affected Modules** | OMT/Whish, Partners, Suppliers, Setup, Settings |
| **Assigned To**      | —                                               |
| **Depends On**       | LIRA-037 (DONE)                                 |

**Description:**  
Currently the app assumes the shop owns both OMT and Whish systems. In reality, OMT-based shops don't own a Whish system — all Whish System transactions are done through a partner (e.g., Samer who owns the Whish system). This ticket formalizes that:

- The shop's **base system** is OMT (the shop owns the OMT system)
- **Whish System** transactions must go through a partner — the `PartnerSelector` becomes **required** (not optional) for Whish System SEND/RECEIVE
- The WHISH supplier in Settings → Supplier Ledger is **deactivated** (replaced by partner ledger)
- Whish System drawer movements remain the same, but General drawer is skipped for partner transactions (already implemented in LIRA-037)

**Implementation Plan:**

#### Phase 1: Make PartnerSelector Required for Whish System

- [x] On the OMT/Whish services page, when provider is `WHISH` (System), enforce partner selection — block submission if no partner is selected
- [x] Show a clear message: "Whish System transactions require a partner"
- [x] PartnerSelector should auto-select if only one active partner exists

#### Phase 2: Deactivate WHISH Supplier

- [x] Deactivate the `WHISH` supplier in the `suppliers` table (don't delete — preserve history)
- [x] Hide or disable Whish System in Supplier Ledger when shop base is OMT
- [x] Add a migration or seed to mark existing WHISH supplier as inactive for OMT-base shops

#### Phase 3: Settlement Flow Migration

- [x] Settlement for Whish System transactions now happens on the Partners page, not Supplier Ledger
- [x] Update dashboard/profits references that point to "Settings → Supplier Ledger" for Whish
- [x] Ensure checkpoint/closing correctly handles partner-driven Whish System drawer balances

**Acceptance Criteria:**

- [x] Whish System SEND/RECEIVE requires a partner to be selected
- [x] WHISH supplier deactivated in Supplier Ledger
- [x] Whish System settlement happens via Partners page
- [x] Existing historical supplier ledger data preserved (read-only)
- [x] No impact on OMT System transactions (shop's own system, no partner needed)
- [x] Typecheck, lint, build pass

---

### LIRA-030: Customer Credit System (Reverse Debt)

| Field                | Value                               |
| -------------------- | ----------------------------------- |
| **Epic**             | Reverse Debt                        |
| **Type**             | Feature                             |
| **Priority**         | High                                |
| **Status**           | DONE                                |
| **Affected Modules** | Debts, POS, All transaction screens |
| **Assigned To**      | —                                   |

---

## Known Tech Debt

- [ ] **Re-enable negative amount validation** in `useDrawerAmounts.ts` — currently disabled to allow negative drawer balances during checkpoint. Restore the `value < 0` check and unskip the test in `useDrawerAmounts.test.ts` once the opening-balance workflow guarantees non-negative starting values. As part of this, create an e2e test that runs immediately after setup and tops up the general drawer — this way any transaction that debits any drawer won't result in negative amounts. _(from LIRA-006)_
- [x] **~~Fix `getLastCheckpointActuals()` dropping negative balances~~** — Fixed: `WHERE physical_amount > 0` → `WHERE physical_amount IS NOT NULL`. _(from LIRA-008)_
- [x] **~~Fix checkpoint timestamp ordering~~** — Fixed: `ORDER BY created_at DESC` → `ORDER BY id DESC`. _(from LIRA-008)_
