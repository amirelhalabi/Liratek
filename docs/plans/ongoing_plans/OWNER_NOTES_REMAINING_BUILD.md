# Remaining owner notes — build plan (2026-09-24)

**Source notes:** `docs/plans/todo_plans/OWNER_NOTES_2026-09-21.md` (verbatim in its Appendix A).
**Status:** implemented and verified 2026-09-25 (unit/typecheck/lint green; e2e re-run of 6 fixed
specs pending with the owner); not yet committed at the time of writing.

**Process — the owner's rule for this batch (memory `feedback_check_cadence`):**
- Implement every note first.
- Run NO jest, lint or e2e during the build.
- A typecheck of the affected workspace is allowed once a whole module area is finished, and only if needed.
- All tests, the rule-17 proofs and the gates run ONCE at the end; whatever they find is then fixed.
- Write the tests as normal, but mark them as NOT RUN until then. Commit granularity doesn't matter to the owner.

**Out of this batch:**
- **#17** — PARKED. The owner is not sure whether the "15%" is the payment-form rate band
  (`TENDER_RATE_BAND_PCT = 0.15`, `packages/core/src/repositories/moneyPosting.ts:171`) or a selling
  price. Build nothing; revisit with the owner.
- **#1, #25** — waiting for the customer to confirm.
- **#5** — waiting for the voice note.
- **#14 slice 3** — later, as its own ticket (see #14b).

## OWNER ANSWERS — these override the scout proposals below

### #11 — loto / payouts inside a customer session (LIRA-201, split in three)
- **A. Netted checkout.**
  - Cash payouts paid from the GENERAL drawer are netted against what the customer buys:
    loto prizes, wallet and Binance cash-outs. Change is computed on the net, and only the
    physical legs are recorded.
    - The owner's case: 50$ in, 40$ + 10,000 LBP back, which removes today's 390,000 LBP gap.
  - **OMT/Whish SYSTEM payouts (from the money-transfer box) keep the two boxes SEPARATE.**
    - Example: a $100 OMT payout plus a $20 phone case gives OMT box −$100 and General +$20.
      The cashier takes $100 from the OMT box, puts $20 in General and hands over $80.
    - The screen may show the customer "You get $80", but the books record the two boxes
      separately.
  - Non-cash payouts (to the customer's account or a wallet) stay gross.
  - The two change-return fields must stop overwriting each other, so "40$ + 10,000 LBP" can be
    entered.
- **B. Session group display.**
  - The pooled in/out and payment detail shows ONCE, on the session group, and each member row
    shows only its own amount and legs.
  - It must survive sorting, paging, type filters and export.
- **C. Whole-basket reversal, wired on BOTH transports** (service, schema, IPC, REST, adapter,
  button). It replaces the "basket item - see admin to reverse" dead end. Single-item reversal
  from a basket becomes a LATER ticket.
  - **Kept change goes back to the customer** on reversal: the drawer returns everything he
    handed over and the kept-change profit is cancelled.
  - **Loto prize inside a basket:** needs a reversal owner that runs for basket members only. It
    soft-voids the CASH_PRIZE supplier_ledger row and marks the prize voided (migration, rule 10:
    `index.ts` + `create_db.sql`). Prize totals and checkpoints must exclude voided prizes.
    **Block with a clear message** when the prize is already reimbursed or its loto checkpoint is
    settled: "This prize was already settled with Loto on <date>. Fix it from the Loto page."
  - **Session-scoped CREDIT_DEPOSIT** rows (a payout or change sent to the customer's account in
    a basket) must be reversed too (rule 20 gap). Prove create + reverse nets to 0 per ledger and
    per currency.
- **Side fixes:**
  - the prize transaction gets the session client's `client_id` (rule 11);
  - correct the stale docs (FEATURE_GUIDE §11, `LotoCashPrizeRepository` comment).

### #19 — account debit vs the open session (LIRA-212): **Tier A only**
- The session's account-balance badge shows on BOTH transports: `TopBar` moves off raw
  `window.api` onto `useApi()`, read through a ref (rule 25).
- It updates LIVE after every account write: Debts-page entries, repayments, cash-outs,
  write-offs, credits, and session checkout.
- Display only. No money change, and no linking of account entries to the session.

### #20 — Exchange "customer gets" (LIRA-213, Part A only)
- "Customer gets" is typeable ONLY for the currency actually handed over. The dimmed "≈" boxes
  stay display-only.
- The reverse calculation answers "he wants 50 EUR, how much USD?". Use one pure core helper
  (`calculateAmountInForTarget`), with reverse(forward(x)) = x tests, and honour rate overrides.
- **NO rounding**: show the exact figure. No leftover booking is needed.

### #21 — MTC/Alfa shop-line checkbox (LIRA-088)
- The checkbox appears when the typed phone number is ANY of the shop's active lines for that
  carrier. It defaults to ON.
  - **ON** = case 1, buy credits back from the customer (payment OUT). This is the existing
    buy-back.
  - **OFF** = case 2, a customer used the shop line for a call (payment IN).
- **The credits move on the line SELECTED on the MTC/Alfa page**, for BOTH cases. The owner has
  several lines and always has one selected.
- **Case 2 input:** credits used + price. The price is pre-filled at the normal credit selling
  rate and is editable (the same two boxes as a credit sale).
- **Case 2 profit:** the same as a credit sale, i.e. price − credits used × the credit cost rate.
  It shows under MTC/Alfa on the Profits page.
- **No SMS fee in either case.** Case 2 is allowed inside a session; buy-back stays blocked in
  sessions, as today.

### #24 — payment form on Hold Money (LIRA-214)
- Only Hold Money is missing it; every other services tab already has the payment form. The form
  goes on BOTH drop-off and pickup.
- **Partial pickup is allowed.** The screen and the Dashboard card show the remaining held amount.
  This needs a balance model and a migration (rule 10).
- **A currency switch is allowed at the day's Buy rate**, editable on the form. No profit is booked.
- **Methods:** cash from any drawer, plus the shop's wallets (Whish / OMT / Binance). Customer
  account and gift card are excluded.
- Rules 16 (IN legs vs the shared OUT loop), 19 and 20 (a pickup reversal owner) apply.

### #28 — seamless cross-period telecom days sale (LIRA-218)
- A line shows its **real days plus a separate "sold ahead" count** (for example
  `0 days left · 210 days sold ahead`).
  - A recharge pays the owed days first, then stacks, then the 365 cap applies.
  - A line is never marked burned because of days sold ahead.
  - This needs a migration (rule 10), and the `carrierLineValidity` rule stays the one shared rule
    (rule 14).
- A **"days still to send" list**: the sale is recorded once for the full period, the customer is
  listed with the days still owed, and a "Mark sent" button records the later delivery.
  Delivering never makes a second sale or a second charge.
- **Warn at the sale AND on the dashboard.** For example: "Your line only has 150 days, so 210
  will be sold ahead. Recharge within 5 days." A red dashboard countdown stays until the line is
  recharged. The sale is never blocked.

### #13 — buy and resell phone lines (LIRA-207)
- The lines come from a dealer, paid later, which already works through stock intake with the
  dealer as supplier.
- **Each number is its own inventory item with its own price.** No per-number price override at
  the till, and no expiry tracking.
- Build only what makes this comfortable, with no new money code:
  - one leaf core normaliser for phone numbers (strip spaces, dashes and the +961/00961 prefix;
    keep the leading 0), usable from browser.ts (rule 29);
  - apply it on item create/search so the same number can't be listed twice;
  - where it fits, label the field "Number" for a lines category.

### #16 — Syria transfer OUT
- **Route A:**
  - a "Pay out" direction on Custom Services → Via Partner, on the Services page, next to the
    existing Syria IN;
  - use a direction field, not negative prices;
  - migration (rule 10).
- **A partner is always required.** The payout books "the partner owes us" on the partner ledger,
  settled on the existing Partners page.
- **Commission comes out of the payout and is counted as profit the same day.** Example: $100
  arrives, the customer gets $97, and $3 is profit.
- **Cash goes through the General drawer.** Syria never touches the Whish system drawer.
- The payout is an OUT leg posted by the shared loop (rule 16), and the IN/OUT badge must say OUT.
- Both transports (rules 19, 21–24, 27). A void test proves create + void nets to 0 on the drawer
  and the partner ledger (rule 20).

### #14 slice 2 — Profits per-module drill-down: Recharges + Product Sales (slice 3 = later ticket)
- **Counted rows add up EXACTLY to the module's row.** Below them is a greyed "not counted yet"
  section with a reason per sale (e.g. customer still owes / partner share / not settled).
- **Auto-booked fees are shown next to the sale, not subtracted.** For example:
  `+90,000 LBP profit · SMS fee −0.32$ (booked in expenses)`.
- Read-only reporting, behind the Profits gate, on both transports. Share the SQL with the totals
  (rule 14) so the details cannot drift from the row.
- **Must run AFTER the post-run follow-ups finish.** They re-shape the shared sale revenue
  fragment in `ProfitRepository`.

### lira-141 — TopUpModal scroll bug
- Apply the existing scrollable-modal pattern (as in `CashReportModal`):
  - the panel gets a max height;
  - header and footer are fixed, the body scrolls;
  - Cancel and Confirm are always visible.
- Optionally do the same for `DrawerTopUpModal`.

<!--SCOUTS-->

## #11 — scout findings (read-only, 2026-09-24)
**Size:** L. Three independent builds: netting (M, money, changes drawer postings), group display (M, UI with sort/limit/export edge cases), and basket reversal (M-L: new transport end to end, a migration, two missing reversal owners, and per-ledger net-zero proofs). Recommend splitting into LIRA-201a/b/c.  
**Touches money:** True  
**Rules:** 11 — the prize transaction drops the session customer's client_id, 16 — netting changes which OUT legs exist; the recorder must still post each physical leg once and never re-iterate change legs, 17 — failing-first tests: the 390,000 LBP gap, the basket reversal throw on LOTO_CASH_PRIZE/KEPT_CHANGE, the leftover session CREDIT_DEPOSIT, 18 — FEATURE_GUIDE §13 checklist; §11 text is stale and must be rewritten, 19 — basket void/refund needs IPC + REST + adapter + web e2e, 20 — missing reversal owners: LOTO_CASH_PRIZE inside a basket, KEPT_CHANGE, session CREDIT_DEPOSIT, 21 — the adapter payload type must come from the new core schema, 10 — the migration for the prize void column must update both index.ts and create_db.sql, 13/14 — reuse _assertLotoTicketVoidable's pattern and sessionBasketNotReversedSql, no copied predicates

### Current behaviour

(1) THE DUPLICATE SUMMARY. The Transactions table has no session group row. Each row is drawn flat with a per-session colour (TransactionsViewer.tsx:591-594 renderRow → buildTr(row, row.session_id); colour from transactionDisplay.ts:639-646 sessionHue). Basket legs are stored with transaction_id NULL and session_id set. Any session member with no customer-facing legs of its own gets the whole basket's legs (TransactionRepository.ts:997-1097, `row.payments = basketLegsBySession.get(row.session_id)` at :1093-1094) and the whole basket's account legs (:1098-1101). So the -400,000 prize row and the 1,280,000 ticket row both print the same pooled in/out. Anything else read from row.payments also comes from the whole basket: the method column, the IN/OUT badge, and saleTenderTotals (rowDerived.ts:42). The kept-change row is a session member too (SessionCheckoutService.ts:627-636), so it also inherits the pooled legs.

(2) THE MISSING 10,000 LBP AND THE 390,000 LBP DRAWER GAP. Checkout is GROSS today, not netted. splitBasketCashSides puts the prize (cart amount -400,000 LBP, Loto/index.tsx:416) in the payout bucket (binanceCart.ts:61-106). MultiPaymentInput is given only the gross charge, 1,280,000 LBP (SessionCheckoutModal.tsx:429-434 and 971-979). The prize is then sent as a separate OUT leg with kind PAYOUT (:492-509). The modal does not pass smartSplitOverpay, which defaults to false (MultiPaymentInput.tsx:261). So change is suggested as one USD figure worked out against the GROSS charge. At a buy rate of 89,000 that is 50 - 14.38 = 35.62$.
The two return fields overwrite each other (MultiPaymentInput.tsx:1025-1053). Typing 40$ clears the LBP field because nothing is left over. Typing 10,000 LBP rewrites USD to 35.51. So '40$ + 10,000 LBP' cannot be entered today.
What got recorded: IN 50$, OUT change 40$, OUT payout 400,000 LBP. That matches the owner's 'in 50$, out 40$ + 400,000LBP'. SessionPaymentService.ts:303-475 posts each leg to its drawer once. Drawer: +10$ and -400,000 LBP. Physically: +10$ and -10,000 LBP. So the books are 390,000 LBP below the cash, which is exactly the tenant-5 gap in §2b.

(3) REFUND. The UI dead end is TransactionCells.tsx:350-368. Its own comment at :361-362 says voidSessionBasket/refundSessionBasket are 'not yet exposed via IPC/REST'. The only callers are core tests. The prize row shows '—' because LOTO_CASH_PRIZE is in NON_REVERSIBLE_TRANSACTION_TYPES (transactionTypes.ts:305-307), and isReversibleRow drops it (actionGating.ts:47-55).
Even at the repository level, voidSessionBasket/refundSessionBasket (TransactionRepository.ts:1295-1401) loop every linked member through _void/_refundTransactionInternal. That calls _assertReversible, whose NON_REVERSIBLE check (:2011-2016) runs BEFORE the allowSessionMember bypass (:2059). So any basket containing a LOTO_CASH_PRIZE, or a KEPT_CHANGE row (also NON_REVERSIBLE, :311-316), throws and rolls back the whole reversal.
Nothing exists that could reverse a prize. It writes three things (LotoCashPrizeRepository.ts:57-167): a loto_cash_prizes row with no void column (create_db.sql:1914-1928, and getTotalCashPrizes/getTotalUnreimbursedCashPrizes do not filter one), a LOTO_CASH_PRIZE transaction, and a supplier_ledger CASH_PRIZE row (Loto owes us) linked by transaction_id. _reverseLotoSupplierLedger only handles LOTO ticket TOP_UP rows (:4413-4420).
A second rule-20 gap inside LIRA-115: a basket payout or change sent to CUSTOMER_ACCOUNT books a debt_ledger CREDIT_DEPOSIT with session_id set and transaction_id NULL (SessionPaymentService.ts:355-362 → DebtRepository.ts:1014-1016). _cancelSessionDebt only reverses 'Session Debt' (:1507-1519). _cancelDebt only matches rows with a real transaction_id (:3428-3440). So even a basket with no loto in it leaves the customer's credit behind when refunded.

(4) SIDE FINDINGS. Rule 11: the prize transaction is created without client_id (LotoCashPrizeRepository.ts:79-93; LotoService.recordCashPrize :994-1005 takes no clientId). The session customer that checkout adds to formData.clientId (SessionCheckoutService.ts:429-431) is dropped, so the prize row shows no client. Two stale docs: FEATURE_GUIDE §11 (:622-625) and LotoCashPrizeRepository.ts:96-99 both say checkout 'emits ONE net cash-OUT leg' for a loto prize, but since Phase F the code emits the GROSS payout.

### What to build (scout's proposal — the OWNER ANSWERS at the top of this file override it)

Three separable pieces, best shipped in this order.

A. NETTED CHECKOUT (money). In SessionCheckoutModal, give MultiPaymentInput a cash payout paid by CASH as tender the customer already hands over, not as a separate OUT leg. The engine rejects negative totals (allocate.ts:36-47), so the prize has to enter as a pseudo-payment, not as a negative total. The engine's native pass plus spillover then nets same- and cross-currency at the BUY rate, which follows the existing 2026-07-06 decision that session payments convert at buy (SessionCheckoutModal.tsx:981-983). Change is worked out on the net, and only physical legs are emitted. For the owner's case: 4,450,000 - 880,000 = 3,570,000 LBP = 40$ + 10,000 LBP, exactly what he handed back (at 89,000). If the payout is bigger than the charges, only the excess becomes a PAYOUT OUT leg. Non-cash payout methods (account or wallet) keep today's gross path, as the owner answered in §2b. Also:
- turn on smartSplitOverpay, or stop the two return fields overwriting each other;
- update the receipt legs, FEATURE_GUIDE §11 and the stale repository comment;
- write a failing-first test that reproduces the 390,000 LBP gap (rule 17).
The recorder (recordBasketPayment) needs no change for loto-only baskets. It does for primary-system payouts (see Q1).

B. SESSION GROUP DISPLAY (UI plus a small core change). In _attachPaymentLegs, return the pooled legs as a separate field, e.g. session_payments / session_account_payments, instead of copying them into every member's `payments`. Render one group header row per session (session number, customer, in/out and payment detail once, with the basket void/refund action on it). Member rows show only their own amount and their own legs. Grouping must survive column sorting, the LIMIT page edge, type filters that show only some members, and Excel/PDF export (exportRow). Check that the IN/OUT badge and sale-tender logic that read row.payments still behave.

C. BASKET VOID/REFUND WIRING PLUS MISSING REVERSAL OWNERS (money, rule 20). Follow the voidCheckoutGroup precedent: TransactionService method, core Zod schema, IPC handler with requireRole, a REST route in backend/src/api/transactions.ts, a backendApi.ts ipcOrHttp function, ElectronApiAdapter, ApiAdapter type derived from the schema (rule 21), and the button in place of the dead-end span. In the repository:
- a LOTO_CASH_PRIZE reversal owner that runs for basket members only (the solo type can stay NON_REVERSIBLE). It soft-voids the CASH_PRIZE supplier_ledger row, marks the prize voided (a migration adds a column; update BOTH index.ts and create_db.sql, rule 10), filters voided prizes out of prize totals and checkpoint gathering, and blocks when is_reimbursed=1 or the checkpoint is settled (mirrors _assertLotoTicketVoidable);
- KEPT_CHANGE handling during basket reversal: negate the profit rather than throwing;
- reversal of session-scoped CREDIT_DEPOSIT rows in _cancelSessionDebt.
Prove create + reverse nets to 0 on every ledger touched, per currency: drawers, supplier_ledger, debt_ledger, profit, loto totals. Also add a web e2e (rule 19d).

D. SMALL: pass clientId through recordCashPrize so the prize row carries the session customer (rule 11).

### Evidence

- frontend/src/features/audit/pages/TransactionsViewer.tsx:591-594 — flat rows with a session colour only, no group row; :258 session rows skip the refund-method modal
- packages/core/src/repositories/TransactionRepository.ts:997-1097 — members with no legs of their own inherit the whole basket's payments and account legs
- frontend/src/features/sessions/components/SessionCheckoutModal.tsx:361-364, 429-434, 476-509, 964-993 — gross charge into MultiPaymentInput, prize as a separate PAYOUT OUT leg, smartSplitOverpay not passed
- packages/ui/src/components/ui/MultiPaymentInput.tsx:261 (smartSplitOverpay=false), :1025-1053 (return fields overwrite each other, so 40$+10,000 LBP cannot be entered)
- packages/ui/src/money/allocate.ts:36-47 — allocatePayments throws on a negative total, so netting must feed the prize in as tender
- packages/core/src/services/SessionPaymentService.ts:303-475 — every leg posted to its drawer once; :355-362 account payout becomes a session CREDIT_DEPOSIT
- frontend/src/features/audit/components/TransactionCells.tsx:350-368 — the 'Basket item — see admin to reverse' span; comment says basket reversal is not exposed via IPC/REST
- grep: voidSessionBasket/refundSessionBasket are referenced only in TransactionRepository.ts and core tests — no service, handler, route or adapter
- packages/core/src/repositories/TransactionRepository.ts:2011-2016 vs :2059 — NON_REVERSIBLE check runs before the session-member bypass, so a basket with LOTO_CASH_PRIZE or KEPT_CHANGE throws
- packages/core/src/constants/transactionTypes.ts:305-316 — LOTO_CASH_PRIZE and KEPT_CHANGE are non-reversible
- packages/core/src/services/SessionCheckoutService.ts:602-637 — the KEPT_CHANGE row is linked into the session basket
- packages/core/src/repositories/LotoCashPrizeRepository.ts:57-167 — prize row, transaction with no client_id, supplier_ledger CASH_PRIZE; drawer post skipped under deferPayment; stale 'net leg' comment :96-99
- electron-app/create_db.sql:1914-1928 — loto_cash_prizes has no void column
- packages/core/src/repositories/TransactionRepository.ts:1507-1537 (_cancelSessionDebt reverses only 'Session Debt') and :3428-3440 (_cancelDebt needs a real transaction_id), so a session CREDIT_DEPOSIT is never reversed
- docs/FEATURE_GUIDE.md:622-625 — says the loto prize emits ONE net cash-OUT leg; the code is gross since Phase F
- Arithmetic (assumes a buy rate of 89,000): gross recorded -400,000 LBP vs physical -10,000 LBP gives the 390,000 gap; netted change 50*89,000 - 880,000 = 3,570,000 = 40$ + 10,000 LBP

### Risks

- Netting changes drawer postings for every session basket with a cash payout. Pin today's gross behaviour for non-cash payouts and for primary-system (OMT/Whish system) items with characterization tests first (rules 16, 17).
- The receipt (sessionReceipt.ts) and the Debts basket breakdown read the legs. With netting the PAYOUT leg disappears, so check they still show the prize.
- Group display: sorting, the LIMIT page edge and type filters can split or partly hide a basket. The header must still show the whole basket's money.
- Loto prize reversal needs a migration (new void column) plus every prize-total query updated (checkpoint gathering, unreimbursed total). Missing one leaves a voided prize still claimed from Loto.
- The session CREDIT_DEPOSIT reversal gap already exists today for any basket whose payout or change went to the customer's account, loto or not.
- Rule 19: the new basket void/refund needs the full IPC + REST + adapter chain and a web e2e.
- Rule 27: no new clock or timezone hazard found on this path (prize_date already uses clientDay()).
- Unverified: the tenant-5 buy rate. The 390,000 match and the exact 40$ + 10,000 LBP figure assume 89,000, the tenant-1 figure from §2b.
- Unverified: that the operator actually typed 40$ over the suggested 35.62$. It is inferred from the recorded 'out 40$' and the field-coupling code.

## #19 — scout findings (read-only, 2026-09-24)
**Size:** Tier A: S. It is one component (TopBar) moved onto the existing dual-mode API, plus an event emit on the Debts page and 2-3 frontend tests, with no backend or money changes. Tier B: M. It needs a session-to-client link (probably a migration), a Debts-page session hook on both transports, and a change to the basket void/refund path plus a rule-20 net-zero test. Tier C: L. It is a new money flow inside session checkout (repayment legs, reversal owner, §13 checklist, both e2e suites).  
**Touches money:** True  
**Rules:** 19: TopBar's raw window.api call is the direct cause on web; any link from the Debts page to a session must go through the dual-mode adapter, 20: required if Tier B or C: basket void/refund needs a named reversal owner for linked account entries (today they are NON_REVERSIBLE), 11: sessions carry no client_id; every tier depends on resolving and propagating the right client, 16: Tier C only: checkout repayment legs must build from IN legs only, 18: Tier B/C touch debt_ledger and payments, so read FEATURE_GUIDE §13 first, 17: each guard must be shown failing first (e.g. a web-mode TopBar test with no window.api), 25: moving TopBar to useApi() must read api through a ref, 10: if customer_sessions.client_id is added, update both migrations/index.ts and create_db.sql, 26 and 27: not implicated (no auto sibling rows and no server clock on this path)

### Current behaviour

Verified by reading the code. None of it was executed.

1. A session does not know its client_id. `customer_sessions` has only customer_name and customer_phone, with no client_id column (electron-app/create_db.sql:475-495, and no migration adds one). Every consumer re-derives the client from the phone number, and each does it differently:
- TopBar uses `arePhoneNumbersEqual` against a client list it loads once on mount (frontend/src/shared/components/layouts/TopBar.tsx:108-127).
- SessionCheckoutModal does an exact trimmed-phone match (SessionCheckoutModal.tsx:263-291).
- SessionPaymentService.resolveSessionClientId matches phone first, then name (packages/core/src/services/SessionPaymentService.ts:508-525).
- CustomerSessionService.autoRegisterClient creates or finds the client at session start and throws the id away (CustomerSessionService.ts:21-49).

2. The Accounts page never looks at sessions. The "Add Debt" / "Add Credit" modal calls `api.addAccountEntry({direction, clientId, amountUSD, amountLBP, note, moveCash})` (frontend/src/features/debts/pages/Debts/index.tsx ~2531-2566). The Debts page has no useSession, no linkTransaction and no session_id. On success it emits only "notification:show".
- The repository side is DebtRepository.addAccountCashEntry (packages/core/src/repositories/DebtRepository.ts:1255-1384). For direction "debt" it writes a debt_ledger row of type 'Manual Debt' (+amount), a DEBT_CASH_OUT transaction (a drawer OUT cash advance) or ACCOUNT_ADJUSTMENT when "Cash moved" is unticked, and CASH payment legs. It never sets session_id, even though debt_ledger has that column (v121). No customer_session_transactions row is written either.
- So the entry never appears in the session's "Completed" list (SessionFloatingWindow.tsx:237-275, fed by customer_session_transactions), in its receipt, or in its checkout.

3. The balance badge is the one place a session shows the account, and it is broken twice over.
- (a) Web (rule 19 violation): TopBar.tsx:138 calls raw `window.api.debt.getClientBalance(...)`. In the browser `window.api` is undefined, so it throws a TypeError, the try/catch at :137-143 swallows it, and the badge never renders on web at all. A dual-mode `getClientBalance` already exists (backendApi.ts:1256-1266, ElectronApiAdapter.ts:151, REST route backend/src/api/debts.ts:65 gated admin+staff); TopBar just does not use it. The owner's notes came from the web app (OWNER_NOTES header), so on web they have likely never seen a balance on a session.
- (b) Desktop: the badge refreshes only on the "sale:completed" and "debt:repayment" events (TopBar.tsx:147-151). Nothing in frontend/src emits "debt:repayment". "sale:completed" is emitted only by POS and SaleDetailModal. So after an Accounts-page Add Debt, the badge stays stale until the session is switched or the app reloads. The badge also does not subscribe to the pushed invalidation that the notifications poller in the same file uses (:225-231).
- Minor: the client list is loaded once, so a client auto-created at session start never matches until reload.

4. Checkout ignores the existing account. The checkout total comes from the cart items only (SessionFloatingWindow.tsx:283-301). SessionCheckoutModal shows no existing account balance and has no way to pay it off. The only account effect of a checkout is the ONE 'Session Debt' row it books for any on-account part of this basket (FEATURE_GUIDE §11).

5. The reversal machinery would reject a naive link. voidSessionBasket and refundSessionBasket (TransactionRepository.ts:1295-1400) reverse every transaction listed in customer_session_transactions through _voidTransactionInternal / _refundTransactionInternal. Those call _assertReversible, which throws for any NON_REVERSIBLE type (TransactionRepository.ts:2004-2016). DEBT_CASH_OUT, CREDIT_CASH_IN and ACCOUNT_ADJUSTMENT are all in NON_REVERSIBLE_TRANSACTION_TYPES (packages/core/src/constants/transactionTypes.ts:305-338). The documented rule-20 owner for these types is "an opposite manual entry on the Accounts page". _cancelSessionDebt only cancels transaction_type = 'Session Debt' rows (TransactionRepository.ts:1507-1537), so a 'Manual Debt' row stamped with session_id would be left alone.
- Likely, based on those lines: if an account entry were linked into a session, the throw would roll back the whole db transaction, and that visit could then never be voided or refunded.

### What to build (scout's proposal — the OWNER ANSWERS at the top of this file override it)

The build depends on Q1. There are three tiers, and Tier A is needed whatever the answer.

TIER A: show the account on the session, correctly and live. Display only, no money.
- TopBar.tsx: replace `window.api.debt.getClientBalance` with `api.getClientBalance` from useApi(), reading `api` through a ref per rule 25.
- Refresh the badge after every account write. Emit a single app event (e.g. "debt:changed") from every Debts-page write (addAccountEntry, repayment, cash-out, write-off, credit) and from session checkout. Also subscribe to the pushed invalidation the same file already uses for notifications. The "debt:repayment" listener has no emitter, so delete it or give it one.
- Re-fetch the client list when the active session changes, or better, resolve the client_id through the session.
- Optional: show the same balance inside SessionCheckoutModal and the floating window.
- Tests: a TopBar test in web mode (no window.api) that asserts the badge renders, plus a refresh-after-account-entry test. Each must be shown failing first (rule 17).

TIER B: record the account entry as part of the open visit. Money-adjacent.
- When a session is active and its client is the selected client, the Debts page asks, or does it automatically depending on Q2's answer. It then stamps debt_ledger.session_id and writes a customer_session_transactions row via linkTransaction, the way Exchange does (Exchange/index.tsx ~975-1000). The link goes on BOTH transports through the existing dual-mode linkTransactionToSession (rule 19).
- It needs a canonical way to resolve the session's client: either a customer_sessions.client_id column (migration plus create_db.sql, rule 10, stamped at session start) or one shared phone-then-name resolver. Today there are three that drift (rule 14).
- Rule 20 applies because this extends an existing capability to a new module. voidSessionBasket and refundSessionBasket must explicitly skip or handle these linked, non-reversible types, otherwise linking one makes the visit unvoidable. A failing-first test must prove that create plus basket void/refund nets to 0 per currency on debt_ledger, payments and drawers under the chosen policy.
- The session receipt, the history view and the LIRA-201 session-group summary must show the row with the right IN/OUT direction. A cash advance is OUT.

TIER C: let checkout collect or settle the existing account balance. Money, large.
- Add an optional "also pay account balance" line to SessionCheckoutModal. It must post a real repayment through DebtRepository.addRepayment inside the checkout's single IPC call (rule 16: build from IN legs only; the shared OUT loop handles change).
- Propagate client_id (rule 11). Keep the leg guard and the posting loop in agreement (the payment-leg reconciliation bug class).
- Decide the reversal owner when the basket is voided (rule 20), and work through the FEATURE_GUIDE §13 checklist (rule 18). Web e2e plus desktop e2e.

### Evidence

- electron-app/create_db.sql:475-495: customer_sessions has customer_name/customer_phone and no client_id
- electron-app/create_db.sql:446-470 + migrations/index.ts v121 (~5108-5130): debt_ledger.session_id exists, added for 'Session Debt' rows only
- packages/core/src/repositories/DebtRepository.ts:1255-1384: addAccountCashEntry writes 'Manual Debt'/CREDIT_DEPOSIT plus DEBT_CASH_OUT/CREDIT_CASH_IN/ACCOUNT_ADJUSTMENT with no session_id and no customer_session_transactions row
- frontend/src/features/debts/pages/Debts/index.tsx ~2531-2566: api.addAccountEntry payload has no session; the page has no useSession/linkTransaction; success emits only notification:show
- frontend/src/shared/components/layouts/TopBar.tsx:138: raw window.api.debt.getClientBalance, which throws on web and is swallowed by the try/catch at :137-143 (rule 19)
- frontend/src/shared/components/layouts/TopBar.tsx:147-151: refreshes only on sale:completed / debt:repayment; grep finds no emitter of debt:repayment anywhere in frontend/src
- frontend/src/shared/components/layouts/TopBar.tsx:108-127: client list loaded once, client matched by phone
- frontend/src/api/backendApi.ts:1256-1266 + ElectronApiAdapter.ts:151 + backend/src/api/debts.ts:65: a dual-mode getClientBalance already exists and is unused by TopBar
- frontend/src/features/sessions/components/SessionCheckoutModal.tsx:263-291: client resolved by exact phone match; no account-balance display
- packages/core/src/services/SessionPaymentService.ts:508-525: third client resolver (phone, then name)
- packages/core/src/repositories/TransactionRepository.ts:1295-1400: basket void/refund iterates every customer_session_transactions member
- packages/core/src/repositories/TransactionRepository.ts:2004-2016: _assertReversible throws on NON_REVERSIBLE types
- packages/core/src/constants/transactionTypes.ts:305-338: CREDIT_CASH_IN, DEBT_CASH_OUT, ACCOUNT_ADJUSTMENT are NON_REVERSIBLE; documented reversal owner is an opposite manual entry
- packages/core/src/repositories/TransactionRepository.ts:1507-1537: _cancelSessionDebt only cancels transaction_type='Session Debt'
- frontend/src/features/sessions/components/SessionFloatingWindow.tsx:237-301: session shows cart plus linked transactions; cart total is from cart items only

### Risks

- Tier B done naively (linkTransaction on a DEBT_CASH_OUT) makes the whole visit impossible to void or refund. _assertReversible throws on the NON_REVERSIBLE type and rolls back the entire basket reversal. This is likely, based on TransactionRepository.ts:1295-1340 and :2004-2016; it has not been run.
- Three different phone-to-client resolvers (TopBar: arePhoneNumbersEqual; checkout modal: exact trim; SessionPaymentService: phone then name) can pick different clients for the same session. Any tier that ties an account to a session should resolve the client in one place (rule 14).
- Rule 20: extending session membership to account entries is the extend-to-more-modules trap. Whatever policy Q2 picks needs a failing-first net-zero test across debt_ledger, payments and drawers per currency.
- Tier C adds a new payments[] flow inside checkout. That brings the rule 16 double-debit risk and the known guard-vs-posting-loop reconciliation bug class.
- Rule 25: moving TopBar onto useApi() and putting `api` in the effect's dependency list can loop. Read it through a ref, and give the test mock a stable reference.
- Unverified: whether the owner used desktop or web when hitting this. The notes are stated to be from the web app, where the badge never renders; on desktop the symptom is a stale badge instead.
- Unverified: that no other session surface (e.g. the CustomerSessions history page) shows an account balance. I grepped it for balance/debt and found nothing, but did not read the page fully.

## #20 — scout findings (read-only, 2026-09-24)
**Size:** M. It is frontend plus one pure core function, but the page's intertwined effects all consume `amountOut` and each needs care: the `amountOut` sync effect, rate overrides, the lot preview, the payout sheet, swap and the profit guard. The rounding leftover has to be booked into profit, and five test mocks need updating.  
**Touches money:** True  
**Rules:** 18: this writes money (drawers and `profit_usd`). Read the FEATURE_GUIDE §10 profit rules and work through the §13 checklist; the profit-stamping line is the one that bites., 14: the reverse math must be defined once, in core `currencyConverter.ts`, next to `calculateExchange`. It must not be a third local copy in the page; `applyCustomRates` already re-derives the rate math locally., 17: the leftover-into-profit guard must be shown to fail on the version that books only the spread., 19: the same page and payload serve both transports, so nothing new is needed server-side. It still has to be proven in web mode (19d)., 22: build one payload. Reverse mode must not build a second submit object., 29: the new core function must stay browser-safe (`currencyConverter.ts` is already reachable from `browser.ts`)., 16: the payout legs are unchanged. The legs stay IN-only and are reconciled against `amountOut`, which must now be the typed target., Not engaged: 11 (the exchange carries only `clientName`, no `client_id` field), 20 and 26 (no new ledger or sibling rows), 27 (no clock or server environment involved).

### Current behaviour

WORKING TREE = HEAD for every file involved.

1. All three "Customer Gets" boxes are read-only text inputs that only show results.
   - Exotic payout box (EUR etc.): `readOnly` at `frontend/src/features/exchange/pages/Exchange/index.tsx:1476`. It only renders when `exoticIsPayout` (:1456).
   - USD box: `readOnly` at :1515.
   - LBP box: `readOnly` at :1545.
   - For an EUR target, the USD and LBP boxes are dimmed "≈" equivalents (:1045-1047, :1506, :1542).
   - The only editable amount is "You Receive" (`DecimalInput`, :1422-1428, state `amountIn`).

2. The calculation only runs forward: amount in → amount out.
   - `recalculate()` (:666-735) calls core `calculateExchange(from, to, amountIn, rates)` (`packages/core/src/utils/currencyConverter.ts:272-366`).
   - Operator rate overrides are applied on top by `applyCustomRates` (:450-556).
   - An effect copies the result into the `amountOut` string on every change (:658-663). If "Customer gets" were simply made editable, this effect would overwrite what the cashier types.
   - There is no reverse (target → amount-in) function anywhere in core. `grep` for reverse/inverse exports in `packages/core/src` found none.

3. Which rate applies. `computeRate` (currencyConverter.ts:84-91) picks the rate that favours the shop, by direction:
   - Customer gives USD, gets LBP: LBP `buy_rate` (e.g. 89,000).
   - Customer gives LBP, gets USD: LBP `sell_rate` (90,000).
   - Customer gives USD, gets EUR: EUR `sell_rate` (fewer EUR per dollar).
   - Customer gives EUR, gets USD: EUR `buy_rate`.
   - Cross pairs (neither side USD) are two legs through USD (:329-365).
   - Every step is plain multiplication or division, so amount-in and amount-out are strictly proportional. A reverse is therefore exact: amount-in = target ÷ (amount out for 1 unit in). Overrides are also linear, so they reverse the same way.

4. Rounding today is to the currency's decimals only, never up.
   - `getDecimals` reads `currencies.decimal_places` (CurrencyContext.tsx:120-126; `create_db.sql:205-208`: USD 2, LBP 0, EUR 2).
   - `amountOut` uses `.toFixed(decimals)` (:661, :687). The payout sheet total uses `roundForCurrency` (`packages/ui/src/money/registry.ts:24-39`), which rounds to nearest, not up.
   - A round-up helper already exists and is not used here: `roundUpForCurrency` / `roundLBPUp` / `roundUSDUp` in `packages/ui/src/config/denominations.ts:28-82` (LBP up to the next 5,000, USD up to the next $1, anything else up to the next whole unit). `MultiPaymentInput.tsx:1010` and `CurrencyQuickFill.tsx:58` use it. `frontend/src/constants/checkout.ts:18` has `LBP_ROUNDING_INCREMENT = 5000`.

5. The server trusts the client's numbers.
   - `exchangeSubmitSchema` (`packages/core/src/validators/exchange.ts:78-156`) takes `amountIn`, `amountOut`, the leg rates and `totalProfitUsd` from the client.
   - `ExchangeRepository.createTransaction` never checks `amountOut` against `amountIn × rate`. It books:
     - the drawer in (+amountIn, fromCurrency, :486-508);
     - the drawer out (−amountOut, or the split legs reconciled against amountOut, :512-608);
     - profit = the client's `totalProfitUsd`, except where a FIFO lot leg overrides it (:471, :756-800).
   - So if the cash taken (a rounded amount-in) and the profit (the spread on the exact amount) disagree, the drawer will show more money than profits explain. Nothing will flag it.

6. Split payout. For a USD or LBP target, "Proceed to Payout" opens the PaymentSheet, with `totalAmount` = the rounded `totalAmountOut` (:1696-1746, :1723-1730). An EUR target submits directly (:1618-1639).

### What to build (scout's proposal — the OWNER ANSWERS at the top of this file override it)

Frontend only, plus one pure core helper. No schema, IPC, REST, migration or repository change, because the submit payload keeps the same shape.

1. **Core** (`packages/core/src/utils/currencyConverter.ts`): add one reverse function, e.g. `calculateAmountInForTarget(from, to, targetOut, rates)`.
   - It returns the exact amount-in for a wanted amount-out, through the same `computeRate` directions: divide where forward multiplies, and two legs through USD for cross pairs.
   - It is exported automatically through both entries (`index.ts:21` and `browser.ts:12` both `export *` from this file). It stays a leaf module (rule 29: it only imports `lotMarketRate`).
   - Unit tests must check reverse(forward(x)) = x for all four directions plus a cross pair.
   - Rate overrides: either pass the overridden leg rates in, or derive the ratio from `applyCustomRates(calculateExchange(from, to, 1))`. Do not write a third copy of the rate math in the page (rule 14).

2. **Page** (`Exchange/index.tsx`):
   - Add a "which box is driving" state: `in` or `out`.
   - Make the payout box for the selected To currency an editable `DecimalInput`: the EUR/exotic box at :1461-1479, the USD box when To = USD, the LBP box when To = LBP.
   - When the cashier types there, compute amount-in with the core helper, round it per the owner's Q1, write it into "You Receive", and stop the :658-663 sync effect from overwriting the typed target.
   - Typing in "You Receive" switches back to forward mode. If the cashier edits a rate while in reverse mode, the typed target stays fixed and amount-in is recalculated.
   - Every place that reads `amountOut` must get the typed target, not a recomputed forward value: the payout sheet `totalAmount` (:1723), the lot-preview `qty` (:842), `handleSwap` (:916) and the submit (:921).

3. **Profit when amount-in is rounded up** (depends on Q2). If the shop keeps the leftover, add its USD value to the in-side leg's `profitUsd`, so that `totalProfitUsd` (:951) matches the cash that went into the drawer. The stamped rate stays the configured one, which keeps History readable.
   - A lot-tracked EUR buy needs no extra step: its cost basis is derived server-side from the actual amounts (:756-791).

4. **Tests**:
   - Unit tests for the core function.
   - A page test that types 50 EUR and checks the USD shown and sent.
   - A failing-first guard (rule 17) that rounded-up cash equals booked profit plus spread.
   - Update the five existing Exchange page tests: their `jest.mock("@liratek/core")` factories list exports explicitly (e.g. `Exchange.payoutRounding.test.tsx:31-60`), so a new core function the page calls on every render would crash them during setup.
   - A desktop e2e spec plus the same over the web shim (rule 19d).

Worked examples. The LBP rates are tenant 1's (buy 89,000 / sell 90,000, from OWNER_NOTES :538-540). The EUR rates are illustrative.
- **Customer wants 50 EUR and pays USD**, EUR sell 1.20: 50 × 1.20 = $60.00, and forward from $60.00 gives exactly 50 EUR.
- **Customer wants 5,000,000 LBP and pays USD** (buy 89,000): 5,000,000 ÷ 89,000 = $56.1798.
  - Up to the cent: $56.18. The leftover is 0.0202 × 89,000 ≈ 1,798 LBP.
  - Up to the dollar: $57, a leftover of $0.82.
- **Customer wants 50 EUR and pays LBP**, EUR sell 1.1634 (illustrative): 50 × 1.1634 = $58.17, × 90,000 = 5,235,300 LBP. Up to the next 5,000 that is 5,240,000, a leftover of 4,700 LBP ≈ $0.05.

### Evidence

- frontend/src/features/exchange/pages/Exchange/index.tsx:1476, :1515, :1545: all three 'Customer Gets' inputs are `readOnly`; the only editable amount is 'You Receive' (`DecimalInput`, :1422-1428)
- index.tsx:658-663: an effect rewrites `amountOut` from `effectiveResult` on every change (it would overwrite a typed target)
- index.tsx:666-735: `recalculate()` only runs forward, `calculateExchange(from, to, amountIn, rates)`
- index.tsx:450-556: `applyCustomRates`, operator rate overrides (linear, so a reverse is exact)
- index.tsx:842 (lot-preview qty), :916 (swap), :921 (submit), :1723-1730 (payout sheet total): everything that consumes `amountOut`
- packages/core/src/utils/currencyConverter.ts:84-91: `computeRate` picks the buy or sell rate by direction; :272-366 is `calculateExchange`. No reverse function exists in core
- packages/core/src/index.ts:21 and browser.ts:12: `export *` from currencyConverter (a new function is reachable from both entries)
- packages/core/src/validators/exchange.ts:78-156: `exchangeSubmitSchema` takes amounts, leg rates and `totalProfitUsd` from the client
- packages/core/src/repositories/ExchangeRepository.ts:471 (profit = client total), :486-508 (drawer +amountIn), :512-608 (drawer −amountOut or legs reconciled against amountOut): no check of amountIn against amountOut
- packages/ui/src/config/denominations.ts:28-82: `roundUpForCurrency` / `roundLBPUp` (5,000) / `roundUSDUp` ($1) already exist; frontend/src/constants/checkout.ts:18 `LBP_ROUNDING_INCREMENT = 5000`
- packages/ui/src/money/registry.ts:24-39: `roundForCurrency` rounds to the nearest cent or lira, not up
- electron-app/create_db.sql:205-208: decimal_places USD 2, LBP 0, EUR 2
- frontend/src/features/exchange/pages/Exchange/__tests__/Exchange.payoutRounding.test.tsx:31-60: an explicit `@liratek/core` mock factory (the same pattern in 5 page tests)
- docs/plans/todo_plans/OWNER_NOTES_2026-09-21.md:550-553: owner answer, Part A only, all currencies incl. EUR, Part B dropped; :1166-1167 is the verbatim note
- git status: no change under frontend/src/features/exchange/pages/Exchange/ (working tree = HEAD for this note)

### Risks

- Drawer vs profit gap: if the amount the customer pays is rounded up but `totalProfitUsd` stays the spread on the exact amount, the drawer holds more than profits explain. The server does not cross-check the two (`ExchangeRepository.ts:471`, `:486-608`), so it will not flag the gap and it only shows up at closing.
- Render fight or loop: the :658-663 effect rewrites `amountOut` from `effectiveResult` on every change. A typed target plus a computed amount-in feeding back into `recalculate()` can oscillate unless one box is clearly the driver (the rule-25 family).
- Lot-tracked EUR target: the lot preview uses `parseFloat(amountOut)` as `qty` (:842). If that becomes a recomputed forward value instead of the typed 50, the FIFO profit preview and the booked lot quantity drift from the EUR actually handed over.
- Payout sheet for a USD/LBP target reconciles the legs hard-reject against `amountOut` (repository :554-566). It must receive the typed target, or a correct split will be refused.
- Five Exchange page tests mock `@liratek/core` with explicit export lists. A new core function the page calls on every render makes them fail during setup, before the component renders (rule 28a: a fast failure looks like a test result).
- The profit sanity guard uses a hardcoded 89,500 fallback (:712, :786). This predates the note and is left untouched, but a round-up to a whole $1 on a small exchange could push past the 10% warning and disable Confirm (:1643).

## #21 — scout findings (read-only, 2026-09-24)
**Size:** M. Backend logic is small because it reuses the credit-sale body, but it needs a CHECK-widening table-rebuild migration (plus create_db.sql), the type added on both transports, a UI branch, and desktop + web e2e.  
**Touches money:** True  
**Rules:** Rule 11: client propagation must reach processRecharge on case 2 (it does today for the sale path, via clientId), Rule 16: case 2 reuses the sale body's IN/OUT leg split. Buy-back keeps the payout-legs-only rule, Rule 18: FEATURE_GUIDE §13 items 2, 3, 4, 9, 10, 11 apply (new recharge_type, badge, legs, void, profit, session branch), Rule 19: validator enum plus both transports plus web e2e, Rule 20: no new ledger row; the generic reversal covers it, proven by a create+void net-zero test, Rule 26: no auto sibling row is written (no SMS expense), so no is_auto work, Rule 27: client_day is already sent (Recharge/index.tsx:637) and used for the line movement; no new server-clock read, Rule 10: migration plus create_db.sql for the CHECK widening, Rules 21/23: the new type is derived from the schema; key-set diff before relying on it, Rule 17: failing-first proofs

### Current behaviour

WORKING TREE (uncommitted batch included):
- Detection. The Recharge page loads the carrier's PRIMARY line and compares the typed phone against it (frontend/src/features/recharge/pages/Recharge/index.tsx:183-186, isShopLineMatch). Only the Credit tab has a phone field (TelecomForm.tsx:522-558). Days and Alfa Gift show a block-and-redirect notice on a shop-line match (TelecomForm.tsx:468-516).
- Case 1 is forced; there is no choice. On the Credit tab, a match ALWAYS becomes a buy-back: TelecomForm.tsx:328 (isCreditBuyback = CREDIT_TRANSFER && isShopLineMatch) and Recharge/index.tsx:508/599 (type sent as "CREDIT_BUYBACK"). The UI shows the fixed notice 'This is the shop's own line — this will be recorded as a credit buy-back' (TelecomForm.tsx:531-539), the sheet title 'Credit Buy-back', the label 'Confirm Cashout', and only buy-back payment methods (TelecomForm.tsx:870-894). Automatic debt for any unpaid remainder is hard off (:926-928). Profit preview is hidden (:799). Blocked inside an open customer session (Recharge/index.tsx:508-516, TelecomForm.tsx:334).
- Case 1 backend: RechargeRepository.processCreditBuyback (RechargeRepository.ts:1398-1701), dispatched at :681-683. Writes a recharges row with recharge_type 'CREDIT_BUYBACK' (:1489-1508) and a transaction of type TELECOM_CREDIT_BUYBACK with profit_usd = credits − payoutUsd (:1517-1543). Cash is paid out through postPayoutLegs, IN legs only (:1548-1576). The PRIMARY line gains credits and validity does not move (D9, owner-confirmed; :1588-1600). The provider drawer gains +credits, plus a separate drift-correction leg (:1632-1677). NO SMS fee is written anywhere in this method, so 'no SMS fee' already holds for case 1. It is voidable through the generic reversal (doc :1392-1396). The IN/OUT badge is 'out' (frontend/src/features/audit/transactionPresentation.ts:95-99).
- Case 2 does not exist. A shop-line number cannot be sold to on the Credit tab, because it is always flipped to buy-back. The nearest flows: LIRA-145 CarrierLineRepository.recordUsage (CarrierLineRepository.ts:879-979) books the shop's own consumption as a Line_Usage EXPENSE at $1 per credit, with no customer, no cash IN and no price. selfChargeTelecomItem (FinancialServiceRepository.ts:4402, TELECOM_SELF_CHARGE) is iPick/Katsh item self-charging, not relevant here.
- Ordinary credit sale (processRecharge, RechargeRepository.ts:673-1322). Profit is price − cost in LBP (:748, :780-785), where cost = credits × alfa_credit_cost_lbp (85,000 fallback; frontend Recharge/index.tsx:524-526). The MTC/Alfa drawer gets −credits USD (telecomStockLeg :369-408, applied :1020-1031). The SMS fee is booked ONLY when type === 'CREDIT_TRANSFER' (:754-758, :1179-1203), as an SMS_Transfer_Fee expense from the provider drawer (LIRA-181). Type is RECHARGE, so the badge is 'in' (transactionPresentation.ts:103).
- DIFFERENCES FROM HEAD (both in the uncommitted batch): (a) note #22 fix: a credit sale (CREDIT_TRANSFER/VOUCHER/TOP_UP/ALFA_GIFT) now also takes the credits off the PRIMARY line's carrier_lines.credits (RechargeRepository.ts:1097-1163). At HEAD only the drawer moved. Case 2 would inherit this directly. (b) note #10 fix: a buy-back now posts exactly +credits plus a separately labelled `<drawer>_LINE_DRIFT` leg, where HEAD posted one leg for the whole gap (:1632-1677).

### What to build (scout's proposal — the OWNER ANSWERS at the top of this file override it)

1. Frontend checkbox (TelecomForm.tsx, Credit tab only). Shown only when isShopLineMatch; default ON.
   - ON: today's buy-back UI, unchanged.
   - OFF: the normal credit-sale UI (full payment methods, profit preview, debt remainder allowed, allowed inside a session). The amber notice becomes 'Customer is using the shop line — this will be charged to the customer.'
   - Recharge/index.tsx:508/599 picks the type from the checkbox, not from isShopLineMatch alone. The session-cart branch (:558-577) sends the new type too. Only the buy-back stays blocked in sessions.
   - Reset the checkbox to ON when the phone or tab changes.
2. New recharge type, e.g. 'SHOP_LINE_USE' (name TBD), routed through processRecharge's ordinary sale body:
   - add an arm to the exhaustive telecomStockLeg that returns −credits USD from the MTC/Alfa drawer;
   - the #22 line decrement then fires automatically;
   - no SMS fee comes for free, because the fee is gated on CREDIT_TRANSFER;
   - transaction type stays RECHARGE, so the badge is IN and it counts as a telecom sale on Dashboard/Profits (SalesRepository.ts:2024-2034 joins on type = 'RECHARGE');
   - add a backend re-check that the phone really is a shop line, mirroring processCreditBuyback :1444-1452. Otherwise a direct REST caller could sell credits with no SMS fee.
   Alternative that avoids the migration: keep CREDIT_TRANSFER and add a metadata flag that skips the SMS fee. Not recommended: history would read 'Credits', and the fee-skip would hang on a flag the client controls.
3. Migration v181 (last entry in the working tree is v180, migrations/index.ts:12104; confirm nothing else in the batch claims v181). Widen the recharges.recharge_type CHECK with a table rebuild, copying v149 (migrations/index.ts ~7877-8011) including down(), plus electron-app/create_db.sql:739 (rule 10).
4. Contract plumbing on both transports:
   - validators/recharge.ts:39-45 enum (REST and IPC share it);
   - RechargeData.type (:98-104);
   - RECHARGE_TYPE_LABELS (:219-226), frontend/src/shared/utils/rechargeLabels.ts and serviceReceipt.ts labels;
   - frontend/src/types/electron.d.ts:1518 and the preload/ApiAdapter types (rule 21/23: derive, don't hand-copy).
5. Tests:
   - core, failing-first: no SMS expense for the new type; drawer −credits and line −credits; cash IN legs; void nets drawer, line, debt and profit to 0 per currency; a phone that is not a shop line is rejected;
   - frontend unit: checkbox visibility, default ON, the type sent each way;
   - desktop e2e plus web e2e (extend lira-133 / lira-web-019).

### Evidence

- RechargeRepository.ts:681-683 — CREDIT_BUYBACK is sent to processCreditBuyback before the sale body runs
- RechargeRepository.ts:1398-1701 — processCreditBuyback: payout legs, PRIMARY line +credits (:1588-1600), drawer +credits plus a drift leg (:1632-1677), no SMS expense
- RechargeRepository.ts:1444-1452 — backend re-checks that the phone matches the primary shop line (the pattern for case 2 to copy)
- RechargeRepository.ts:754-758, 1179-1203 — SMS_Transfer_Fee expense only when type === 'CREDIT_TRANSFER'
- RechargeRepository.ts:369-408 — telecomStockLeg is an exhaustive switch; a new type needs its own arm
- RechargeRepository.ts:1097-1163 — UNCOMMITTED #22 fix: credit sale takes credits off the primary line (not at HEAD)
- RechargeRepository.ts:487 — Math.abs is inside topUpApp (drawer-to-drawer top-up), not the MTC/Alfa sale path; the triage citation is misattributed
- frontend/src/features/recharge/pages/Recharge/index.tsx:183-186 — isShopLineMatch compares against the PRIMARY line only
- frontend/src/features/recharge/pages/Recharge/index.tsx:508-516, 599 — a shop-line match always becomes CREDIT_BUYBACK; blocked in sessions
- frontend/src/features/recharge/components/TelecomForm.tsx:328, 531-539, 870-938 — buy-back UI flip, fixed notice, filtered payment methods, debt remainder off
- frontend/src/features/audit/transactionPresentation.ts:95-99, 103 — TELECOM_CREDIT_BUYBACK badge 'out', RECHARGE badge 'in'
- CarrierLineRepository.ts:879-979 — LIRA-145 recordUsage: Line_Usage expense at $1 per credit, no customer; covers the shop's own use
- packages/core/src/validators/recharge.ts:39-45 — client-submittable type enum shared by REST and IPC
- electron-app/create_db.sql:739 and migrations/index.ts:7899 (v149) — recharge_type CHECK; a new value needs a table-rebuild migration
- migrations/index.ts:12104 — v180 is the last migration in the working tree
- SalesRepository.ts:2024-2034 — Dashboard 'sales' counts recharges joined on transactions.type = 'RECHARGE', so a new RECHARGE-typed charge counts automatically
- SessionCheckoutService.ts:141-155 — the session basket passes recharge formData through generically

### Risks

- The #22 line-decrement fix is UNCOMMITTED. Case 2 relies on it to move the shop line; if it is reverted or changed, case 2 would move only the drawer.
- Pre-existing drawer/line drift: the SMS fee takes money out of the MTC/Alfa drawer but never out of carrier_lines.credits (the #22 comment, RechargeRepository.ts:1128-1136 says so outright). So the drawer and the line sum drift apart with every credit sale. The next buy-back's drift leg soaks it up. Not caused by case 2, but the owner may notice it.
- Multi-line: detection and buy-back only look at the primary line. If the shop has a second active line, typing its number is treated as an ordinary customer sale, SMS fee included (question 3).
- Rule 20/26: case 2 writes no new side-effect row. Payments, the carrier_line_movement and the optional Recharge Debt all reverse through the existing generic path. This must be proven net-zero failing-first (rule 17) and not assumed.
- Rule 19: the schema enum, both transports and web e2e must all move together. The REST route is directly callable, hence the backend shop-line re-check.
- Rule 10/migration: the CHECK can only be widened by rebuilding the recharges table. Copy v149's rebuild and down() exactly, and check that no other uncommitted work claims v181 (unverified).
- Session basket carrying the new type: SessionCheckoutService passes formData through as `data as never`. Unverified whether that path runs the Zod enum, so the new type could slip past validation there.
- Profits bucket: likely, based on SalesRepository.ts:2024-2034 and its reference to ProfitRepository.getRechargesByCurrency, a RECHARGE-typed charge lands in the Recharge profit bucket automatically. ProfitRepository was not read line by line (unverified).

## #24 — scout findings (read-only, 2026-09-24)
**Size:** M if pickup stays all-at-once (payment form on both ends plus the client_id migration, one repository, both transports). L if partial pickup is allowed (a new balance model, a migration, and the Dashboard, Active Holds list and history all changing together).  
**Touches money:** True  
**Rules:** 11 (client_id is dropped today), 16 (IN legs vs OUT change legs, one shared loop), 18 (§13 items 4, 5, 6, 9, 11, 15), 19 (both transports, collect needs a REST body), 20 (reversal owner for pickup and partial rows), 21 (derive adapter types from schema), 22 (one payload for both transports), 23 (new collect schema in front of an existing handler), 27 (server timestamps and locale in the hold repository), 10 (migration in both files if client_id or partial pickup is added), 17/15 (failing-first core tests plus delta/identity e2e on desktop and web)

### Current behaviour

WHERE "SERVICES" IS. Sidebar "Services" is the custom_services module at /custom-services (create_db.sql:1608). Its tabs are category chips: All, Digital Account, Repair, Activation, Other, Hold Money, Insurance (CustomServices/index.tsx:78-98). The OMT/Whish page is /omt-whish (create_db.sql:1602) and MTC/Alfa is /recharge, whose provider tabs are MTC, Alfa, iPick, Katsh, Whish App, OMT App and Binance (features/recharge/types/index.ts:90-195).

INVENTORY OF PAYMENT ENTRY POINTS. MPI = MultiPaymentInput, the shared payment form.

Services page (/custom-services):
- Every category except Hold Money uses MPI, including the return/change legs and keep-change. Evidence: CustomServices/index.tsx:1179-1221 (onReturnChange=setReturnLegs :1201, onKeptChange :1202), with the legs sent as `payments` at :393-395.
- Insurance is the ordinary submit path and uses the same MPI (:87-97).
- Hold Money does NOT use MPI. Choosing the chip swaps in HoldMoneySection (:601, :666-669), which has:
  - two bare DecimalInputs, USD and LBP (HoldMoneySection.tsx:233-278);
  - a Hold button (:281-297);
  - a one-click Collect per row (:356-368 → handleCollect :146-174 → api.holdMoney.collect(id)).
- A second one-click Collect sits on the Dashboard hold cards (Dashboard.tsx:626-649).
- HistoryModal's only write is advanceCustomServiceFulfillment, a status change with no money (validators/customService.ts:139-142).

OMT/Whish page (/omt-whish): MPI for SEND and RECEIVE across all OMT sub-types (Services/index.tsx:2308-2477), including return legs (:2448) and the Whish fee counter-flow (:2459-2476). Exceptions:
- For-Partner RECEIVE has no payout by design; it shows a notice only (:2296-2305).
- The "Payment Method Fee" box (:2498-2530) and the Binance-fee fields (:2533+) are fee amounts, not payments.

MTC/Alfa page (/recharge):
- MPI directly or through PaymentSheet in TelecomForm, KatchForm (iPick/Katsh), FinancialForm (incl. Whish App Bills), OmtWhishAppTransferForm (OMT App / Whish App transfer) and CryptoForm (Binance). CardGridPayView goes through PaymentSheet.
- TopUpModal's client mode uses MPI (packages/ui/.../TopUpModal.tsx:645). Its supplier/partner modes use a source-drawer select (:796), but that is the shop moving its own money.
- OmtAppCashoutModal (amount + currency select), WalletExchangePanel (FX inside a wallet) and CarrierLinesPanel (shop-line admin) are internal shop moves, not customer payments.
- BOB has no page or tab of its own. It is only a seeded provider (ServiceProvidersManager.tsx:14). Unverified that it has no payment UI somewhere else.

So the only customer-money entry points without MPI on the services pages are Hold Money create, Hold Money Collect, and the Dashboard Collect.

HOLD MONEY FLOW (LIRA-060):
- Schema: holdMoneyCreateSchema accepts only client_name, phone_number, usd_amount, lbp_amount, notes and transaction_time. It has no payments[] (validators/holdMoney.ts:9-23).
- Create (HoldMoneyRepository.createHold :76-172):
  - inserts hold_money as 'held';
  - writes a HOLD_MONEY transaction with 0 profit;
  - posts one CASH leg per currency, +amount, to the **General** drawer only (postLegs :322-353, GENERAL_DRAWER :55).
- Collect (collectHold :178-274) takes only an id. IPC 'hold-money:collect' takes (id) (holdMoneyHandlers.ts:91-110); REST POST /api/hold-money/:id/collect has no body (backend/src/api/holdMoney.ts). It then:
  - writes a HOLD_MONEY_COLLECT transaction;
  - posts −usd / −lbp CASH legs on General for the FULL held amounts;
  - flips status to 'collected' (all or nothing: the CHECK constraint allows only 'held' and 'collected', create_db.sql:1990);
  - inserts a custom_services history row with paid_by hardcoded to 'CASH' (:249-262).
- Both types are in NON_REVERSIBLE_TRANSACTION_TYPES. Their rule-20 owner is "the Hold Money page's own lifecycle" (transactionTypes.ts:386-391), and that page has no cancel/void action.
- Rule-11 breach today: the customer autocomplete's onClientSelect keeps name and phone but drops client.id (HoldMoneySection.tsx:80-83), and the hold_money table has no client_id column (create_db.sql:1983-1997).
- There is no session integration: HoldMoneySection never calls useSession.
- The adapter payload type is written by hand (backendApi.ts:4567-4574), which breaks rule 21.

WHAT "RETURNED AMOUNT" MEANS. In the payment form's own language, "returned" is the change-returned OUT legs (MPI "Return / change (shop → customer)", MultiPaymentInput.tsx:311, :1083-1121). The Hold Money UI calls collecting "Returned hold to X" (HoldMoneySection.tsx:154) and posts legs noted "(returned)" (Repository :223). Likely, based on the wording "amounts" and the collect UI's own vocabulary: the owner means the pickup, i.e. recording what was handed back and how (currency, method, drawer, possibly part of it). Change at drop-off would also come for free with the form. This is unconfirmed: see Q1.

### What to build (scout's proposal — the OWNER ANSWERS at the top of this file override it)

Scope: Hold Money only. Every other services tab already has the payment form.

1. Drop-off. Replace the two bare boxes in HoldMoneySection with MultiPaymentInput. Keep an "Amount to hold" figure (USD and/or LBP) as the form's total. The form's payments[] plus change (OUT) legs go in ONE call.
   - Core: add payments[] (and exchange_rate) to holdMoneyCreateSchema.
   - createHold reconciles the legs against the held amount with the existing moneyPosting helpers (reconcileLegs / expectedTotalIn / sumLegsByCurrency, moneyPosting.ts:267-356).
   - It posts IN legs to each leg's own drawer, and OUT change legs through one shared end-of-transaction loop, the way CustomServiceRepository.ts:445-494 already does ("Change returned").
   - It stops hardwiring General.
   - What the hold record stores as "owed back" depends on Q3.
   - Keep-change must be off (or mean "add to the hold"). A kept change is not profit on a hold (FEATURE_GUIDE: Hold Money books zero profit).
2. Pickup. Replace the one-click Collect in HoldMoneySection and on the Dashboard with ONE shared "Return hold" sheet that uses MPI as a payout (the direction the RECEIVE payout forms already use; postPayoutLegs, moneyPosting.ts:878).
   - Add a new core collect schema: id, payments[], and, if partial is allowed (Q2), the amounts being returned.
   - Change the IPC channel to take a payload, and give the REST route a validated body. Same schema on both transports, userId taken from the JWT.
   - The custom_services history row takes its paid_by from the real legs instead of 'CASH'.
3. Partial pickup (only if Q2 says yes). A migration in BOTH migrations/index.ts and create_db.sql adds returned-so-far columns (or a hold_money_movements table) plus a remaining-balance read. Active Holds and the Dashboard cards show what is left, and status goes to 'collected' only at zero.
4. Rule-11 fix. Add a client_id column (same migration), and propagate it UI → IPC/REST → repository → createTransaction({client_id}) on both the hold and the pickup.
5. Adapter. Type holdMoneyCreate/holdMoneyCollect from z.input of the core schemas (rule 21), and update the preload binding, electron.d.ts and ApiAdapter.
6. Tests.
   - Core repository tests that show hold then full return nets 0 per drawer per currency, including a split-currency tender with change, a wallet leg and a partial pickup. Each test must first be shown to fail (rule 17).
   - Extend lira-060 (desktop) and lira-web-003 (web) to drive the real sheet, with delta and identity assertions (rule 15).
7. Write down the session decision (default: holds stay outside a customer session) and the void owner (default: still NON_REVERSIBLE, owned by the Hold Money page). Optionally add a "cancel hold" action.

### Evidence

- frontend/src/features/custom-services/components/HoldMoneySection.tsx:233-278: two bare DecimalInputs (USD, LBP), no MultiPaymentInput
- HoldMoneySection.tsx:146-174 and :356-368: Collect is one click, api.holdMoney.collect(hold.id), with no amount or method
- HoldMoneySection.tsx:80-83: selectClient keeps name and phone and drops client.id (rule 11)
- frontend/src/features/dashboard/pages/Dashboard.tsx:626-649: second one-click Collect on the Dashboard hold cards
- packages/core/src/repositories/HoldMoneyRepository.ts:55 and :322-353: every leg is CASH on the General drawer; :190-225 collect always returns the full usd/lbp; :252 the history row hardcodes paid_by 'CASH'
- packages/core/src/validators/holdMoney.ts:9-23: create schema has no payments[]; collect has no schema at all
- electron-app/handlers/holdMoneyHandlers.ts:91-110 and backend/src/api/holdMoney.ts (POST /:id/collect): collect takes an id only
- electron-app/create_db.sql:1983-1997: hold_money has no client_id and no returned-so-far column; status CHECK allows only 'held'/'collected'
- packages/core/src/constants/transactionTypes.ts:386-391: HOLD_MONEY and HOLD_MONEY_COLLECT are NON_REVERSIBLE, owned by the Hold Money page
- frontend/src/api/backendApi.ts:4567-4574: holdMoneyCreate payload type is written by hand (rule 21)
- frontend/src/features/custom-services/pages/CustomServices/index.tsx:1179-1221: every other Services category already uses MultiPaymentInput with return and keep-change legs (:393-395 sends payments)
- frontend/src/features/services/pages/Services/index.tsx:2308-2477: OMT/Whish already use MultiPaymentInput (For-Partner RECEIVE deliberately has no payout, :2296-2305)
- packages/ui/src/components/ui/TopUpModal.tsx:645: wallet top-up client mode already uses MultiPaymentInput; :796 source-drawer select is the shop moving its own money
- packages/core/src/repositories/CustomServiceRepository.ts:445-494: an existing shared change-returned loop to copy; moneyPosting.ts:267-356 and :878 provide reconcile and payout helpers
- git: no HoldMoney* file or hold-money spec is in the uncommitted batch; MultiPaymentInput.tsx's onKeptChange signature changed in the staged diff (adds exactUsd/exactLbp)

### Risks

- Rule 16/§13 item 15: build the hold's IN set from IN legs only and let one shared loop debit the OUT change legs once. The guard and the posting loop must agree on which legs count, or money leaks (the LIRA-193 bug class).
- Rule 20: pickup rows, especially partial ones, need a named reversal owner. Today it is 'the Hold Money page', which has no cancel/void action, so a wrong hold can only be fixed with an opposite hold. Decide whether to add a 'cancel hold' action.
- Rule 19/21/23: the collect channel changes from (id) to a payload on BOTH transports. Derive the adapter types from the new core schema, and when adding it do the three-way key diff (schema, preload binding, handler) so Zod does not silently drop a field.
- Rule 11: a client_id column and full propagation are needed. The migration goes in BOTH migrations/index.ts and create_db.sql, and the per-tenant seed or schema paths may need checking (unverified).
- Rule 27 (minor, existing): collectHold stamps collected_at and the history row with the server's CURRENT_TIMESTAMP (:232, :252), and createHold formats the summary with toLocaleString on the server (:105-106). On web both run on the UTC Fly server. Pass the client time or day in if touching these.
- Keep-change on a hold must not become profit. Disable it, or define it as 'added to the hold'. The uncommitted batch changes MPI's onKeptChange signature, so build on top of that batch.
- Sessions (§13 item 11): holds are currently outside customer sessions. Keep that and document why, or the build grows a basket branch.
- If Q3 = B, a dollars-in, lira-out hold is effectively an exchange with no profit booked, so the USD and LBP drawers move in opposite directions. The drawers stay correct but the rate spread goes unrecorded (Likely acceptable, based on the other payment forms converting tender at the Buy rate without booking exchange profit).
- Unverified: whether BOB or any Loto entry point has a bare payment field. No BOB page exists, and Loto was not inventoried because it is not a services page.

## #28 — scout findings (read-only, 2026-09-24)
**Size:** M. The price, cost and profit already post correctly, so the work is a validity-model change: one migration column, the shared rule, the display, one reversal fix and tests. It becomes L if the owner wants the per-customer "days still to send" list (Q2), which adds a new entity plus IPC and REST endpoints.  
**Touches money:** True  
**Rules:** Rule 18: the change edits the DAYS sale path (RechargeRepository) and the self-charge path (FinancialServiceRepository), both of which write transactions and drawer legs. Work through the FEATURE_GUIDE §13 checklist even though no new money posting is planned., Rule 20: a new days_owed state and the day-sale refund fix each need a named reversal owner and a failing-first create-plus-reverse net-zero test., Rule 14: the sold-ahead classification and the 'pay off owed days first' charge rule go into carrierLineValidity.ts only. The panel, the dashboard, KatchForm and the server keep importing it rather than re-deriving it., Rule 27: 'today' for sold-ahead or burn deadlines comes from client_day or X-Client-Day, with localDay() as fallback. Keep carrierLineValidity.ts browser-safe (rule 29): never call clientDay() inside it., Rule 19: if Q2 = A, the 'mark days sent' action needs an IPC handler plus a mirroring REST route sharing one core schema, and web e2e proof., Rule 11: if Q2 = A, the owed-days record needs the DAYS sale's clientId carried through (the recharge payload already sends clientId)., Rule 10: a days_owed column means updating both migrations/index.ts (increment from the last entry) and create_db.sql., Rule 17: prove the new tests fail on today's rule: a sold-ahead line is refused as burned, and a refund after recharge wipes the recharge., Rules 16 and 26 do not apply unless new payment legs or auto sibling rows are added; none are planned.

### Current behaviour

Worked example: the shop's MTC line expires in 150 days and the operator sells a customer 360 days (the largest Quick Days button). Typing 365 rounds up to 370, because days go in 10-day SMS blocks (frontend/src/features/recharge/utils/validityDays.ts:35-41).

1. The sale goes through with no warning. handleTelecomSubmit (frontend/src/features/recharge/pages/Recharge/index.tsx:494-638) only checks that the cost and price fields are filled. It never compares the days sold with what the line holds, even though the page already loads the shop line (index.tsx:159-182). I found no maximum on DAYS in packages/core/src/validators/recharge.ts. Server side, RechargeRepository.ts:1075-1090 applies validityDaysDelta = -360 with today = client_day. projectValidityExpiry's sell branch (packages/core/src/utils/carrierLineValidity.ts:194-197) subtracts from the line's own expiry and never refuses, so the stored expiry becomes today - 210. Price, credit cost and profit are all booked in full on the sale day (the stock leg is at RechargeRepository.ts:999-1031). None of that is wrong.

2. The line then shows as dead. classifyLineValidity (carrierLineValidity.ts:120-137) treats any expiry more than 5 days past today as BURNED, and nothing lets it tell "sold ahead" from "really lapsed". The Recharge tab chip reads "expired 210d ago" in red, with a red "burned" badge (CarrierLinesPanel.tsx:434-439, 569-590). The Dashboard banner reads "MTC — <line> expired 210d ago" (frontend/src/features/dashboard/utils/carrierLineAlerts.ts:52-62, 72-78).

3. The recharge-later step is blocked. In the iPick/Katsh self-charge dialog (KatchForm.tsx:1118-1137, 1156), projectValidityExpiry returns burned=true (carrierLineValidity.ts:199-201). The dialog strikes through "+N days", shows "This line expired 210 days ago and is burned — it can no longer be revived by a charge. Register a new line" (KatchForm.tsx:2568-2577) and disables Confirm Charge (KatchForm.tsx:2609-2613). The server refuses the same charge: computeAppliedState throws burnedLineMessage (CarrierLineRepository.ts:1033-1039), and the self-charge passes the message through unchanged (FinancialServiceRepository.ts:4528-4546).

4. If the overshoot is 5 days or less, the charge is accepted but the owed days disappear. A GRACE line bases the charge on today, not on the negative expiry (carrierLineValidity.ts:205). Example: line at -5, +30 card, result today+30. In reality the shop still has to send those 5 days after recharging, so the true figure is today+25. The dialog even says "the lapsed days are not recovered" (KatchForm.tsx:2591-2601).

5. The only ways out today are manual and do not move any money. The operator can overwrite the expiry with the quick edit on the line chip (CarrierLinesPanel.tsx:277-299). That calls updateBalance and logs a "manual" movement with transaction_id null (CarrierLineRepository.ts:481-517). The operator can also record a counted date at the checkpoint, which skips the burned check (CarrierLineRepository.ts:1018-1024).

6. The system does not record that the customer is still owed 210 days, and a second DAYS sale for the remaining 7 months would charge the customer and cut the line a second time.

Working tree vs HEAD: the uncommitted RechargeRepository.ts and FinancialServiceRepository.ts diffs add a line-credits decrement for credit sales and a buy-back drift correction. They do not change the DAYS validity path, the self-charge validity path or carrierLineValidity.ts, so everything above holds on both.

### What to build (scout's proposal — the OWNER ANSWERS at the top of this file override it)

Remaining build (LIRA-218), assuming the recommended answers below:

(1) A line state for "sold ahead", separate from "really lapsed". Recommended: a new days_owed column on carrier_lines (migration in both migrations/index.ts and create_db.sql, rule 10). A DAYS sale uses up the line's real days first and puts the rest into days_owed; the real expiry stops at the day the line ran out. The alternative is to keep a single negative expiry and mark the line as sold ahead. The classification in carrierLineValidity.ts must stay the one shared rule (rule 14), so the panel, the dashboard and the server all read the same state.

(2) Change the charge rule in projectValidityExpiry: a charge on a line with days owed pays those off first, then stacks, then applies the 365 ceiling. It must never be refused as burned for owed days, and never forgive them through the grace rule. Example: owed 210 days, +365 card, lands at today+155.

(3) Display: the chip and the dashboard banner say "210 days sold ahead, recharge the line" instead of "expired / burned". The self-charge dialog shows "210 of these 365 days go to what you already sold, 155 stay on the line".

(4) A pre-sale notice on the Days tab when the days sold exceed the line's remaining days. It warns and never blocks, per LIRA-157's "sell: never refused". It can use the primaryLine the page already loads.

(5) Optional (Q2): a per-customer "days still to send" list with a "mark sent" action, so the later 7 months are delivered without recording a second sale. This needs an IPC handler plus a mirroring REST route (rule 19) and client_id propagation (rule 11).

(6) Required fix, whichever option is chosen: make the day-sale refund arithmetic, so it gives back exactly the days sold. The sell branch loses nothing, so adding back abs(delta) is exact. Snapshot restore stays for charges, which can lose days to the grace rule or the ceiling (see risks). Also restore days_owed.

(7) Tests: prove against the current code first (rule 17) that sell 360 on a 150-day line, charge 365, gives today+155; that refund after recharge keeps the recharge; and that create plus reverse nets to zero on validity and days_owed (rule 20). Add or extend the lira-149 desktop spec and a web spec (rule 19d).

### Evidence

- packages/core/src/utils/carrierLineValidity.ts:194-197 — a day sale subtracts from the line's own expiry and is never refused (expiry ?? today) + daysDelta.
- packages/core/src/utils/carrierLineValidity.ts:120-137 — any expiry more than 5 days past today is BURNED; nothing distinguishes sold-ahead from lapsed.
- packages/core/src/utils/carrierLineValidity.ts:199-201 — a charge on a BURNED line returns burned:true; :205 — a GRACE line bases the charge on today, so owed days are forgiven.
- packages/core/src/repositories/CarrierLineRepository.ts:1033-1039 — computeAppliedState throws burnedLineMessage when the projection is burned (the server-side refusal).
- packages/core/src/repositories/RechargeRepository.ts:1075-1090 — DAYS sale applies validityDaysDelta = -abs(amount) with today = client_day on the primary line.
- packages/core/src/repositories/FinancialServiceRepository.ts:4528-4546 — the self-charge applies +validityDays; the burned refusal message reaches the operator unchanged.
- frontend/src/features/recharge/components/KatchForm.tsx:1118-1137, 1156, 2568-2577, 2609-2613 — the self-charge dialog shows the burned message and disables Confirm Charge; :2591-2601 — grace warning says lapsed days are not recovered.
- frontend/src/features/recharge/components/CarrierLinesPanel.tsx:434-439, 569-590 — chip shows 'expired Nd ago' plus a 'burned' badge.
- frontend/src/features/dashboard/utils/carrierLineAlerts.ts:52-62, 72-78 — dashboard banner 'expired Nd ago' for any line at 7 days or fewer.
- frontend/src/features/recharge/pages/Recharge/index.tsx:494-500 — the DAYS submit only checks that cost and price are filled; it never compares the days sold with the loaded primaryLine (:159-182).
- frontend/src/features/recharge/components/CarrierLinesPanel.tsx:277-299 and CarrierLineRepository.ts:481-517 — the manual workaround: quick edit overwrites the expiry and logs a 'manual' movement with transaction_id null.
- packages/core/src/repositories/CarrierLineRepository.ts:803-806 — reverseMovement restores previous_validity_expires_at verbatim, even when later movements exist.
- frontend/src/features/recharge/utils/validityDays.ts:35-41 — days snap up to 10-day SMS blocks (365 becomes 370; the largest Quick Days button is 360).
- git diff HEAD on RechargeRepository.ts and FinancialServiceRepository.ts: the uncommitted changes touch the credit-sale line-credits decrement and the buy-back drift correction, not the DAYS validity or self-charge validity code.

### Risks

- Existing problem, and this workflow makes it likelier: refunding a day sale after the line has been recharged restores the pre-sale expiry snapshot (CarrierLineRepository.ts:803-806), which erases the recharge's days. Example: 150 left, sell 360, recharge +365, then refund the sale; the line reads today+150 instead of today+515 (capped at 365). The build must switch day-sale refunds to arithmetic (safe because the sell branch loses nothing) and keep snapshot restore only for charges (rule 20).
- A days_owed column (or sold-ahead flag) is a new side-effect state tied to a transaction. It must be snapshotted on the movement row and restored by _reverseCarrierLineMovements in the same change (rule 20), with a test proving create plus reverse nets to zero.
- Rule 27: any new 'sold ahead' or '5 days to recharge' calculation must use the client's day (client_day, which already flows into applyMovement), never the server's, or web will misclassify for about 3 hours each night.
- Likely, based on RechargeRepository.ts:1075-1097 (the DAYS arm has no creditsDelta, and the new credits decrement sits in the `else if (stockLeg)` branch): the SMS credit cost of a DAYS sale leaves the MTC/Alfa credit drawer but not carrier_lines.credits. That would break the drawer-equals-sum-of-line-credits invariant, in the same family as owner note #22. I did not trace telecomStockLeg for DAYS; confirm before relying on it.
- Unverified: that MTC/Alfa physically refuse to transfer days beyond the shop line's own validity. The note ('after selling 5 months, recharge, then sell the 7 remaining') implies they do, and the recommended model rests on that.
- Unverified: that the iPick/Katsh self-charge is the only way the shop recharges its own line. If the owner also buys cards outside the catalogue, the charge path in (2) needs another way in, or the manual edit has to pay off owed days too.
- Money scope is limited: price, credit cost and profit for the full year already post correctly on the sale day and should not change. The risk sits in the validity bookkeeping and the refund path, not in drawers or profit.

## #13 — scout findings (read-only, 2026-09-24)
**Size:** S for the core model: the category, relabelling and number normalisation reuse the existing inventory, sale, refund and FIFO paths with no new money code. M for per-number pricing through a POS price override. M to L if walk-in cash purchases are needed, because that is a new drawer-paying intake with legs, a void path and tests on both transports.  
**Touches money:** True  
**Rules:** Rule 18 / FEATURE_GUIDE §13 only bites if (f) is built: a cash purchase is a new flow that writes payments and drawers. Work through items 2 (transaction row), 3 (IN/OUT badge, OUT), 4 (payment legs), 5 (drawer per leg and currency), 8 (supplier ledger, or none), 9 (void path) and 13 (e2e with deltas). The core model (a)-(d) writes no new money rows; it reuses SALE and SUPPLIER_STOCK_INTAKE., Rule 20: a cash intake writes a drawer leg, a FIFO batch and a product_units row tied to one transaction, so all three need a named reversal owner in the same change, and a test must show create + void nets to 0 on the drawer, the stock count and the unit status. Today's intake void deletes the batch (TransactionRepository.ts:4031-4065). Unverified: whether it also lowers stock_quantity or removes registered units., Rule 16: a paid-now intake must pay out from the IN legs through the repo's single payment loop, with no second pass over OUT legs., Rule 11: if the seller is a known customer, their client_id must be carried from the form all the way to createTransaction., Rule 19: every inventory and unit path already exists on both IPC and REST. Any new pay-now intake needs both a handler and a REST route sharing one core schema, plus a web e2e., Rule 14 + 29: one phone-number normaliser in packages/core, pure and reachable from browser.ts, reused by unit registration and by lookup., Rule 26: only relevant if a paid-now intake also writes an automatic SUPPLIER_PAYMENT sibling. That sibling must carry is_auto and have its reversal tied to its parent., Rule 27: only relevant if in-stock line expiry is tracked (Q3). Compute the day from the client's value, with the server day as fallback only., Rule 10: only if the category is seeded by migration.

### Current behaviour

No phone-line or SIM product flow exists anywhere. I found no SIM_SALE type, no line category in the mobile catalog (mobile_service_items, create_db.sql:1116-1150), and no trade-in or buy-from-customer flow. Here is what already exists and could carry it.

(1) Per-unit inventory, LIRA-143 v157. A category flag, product_categories.tracks_imei_units (create_db.sql:328-340), is seeded on only for "Phones" (:342-348), and the owner can switch it on for any category in Settings (CategoriesManager.tsx:130-135, :388-407; REST PUT /api/inventory/categories/:id, backend/src/api/inventory.ts:723-746). Units are stored in product_units(imei TEXT NOT NULL, status IN_STOCK|SOLD, sale_item_id) (create_db.sql:371-382). An IMEI can only be in stock once per shop (idx_product_units_active_imei, :388). The IMEI is never format-checked: the schema only requires it to be non-blank (validators/productUnit.ts:18), and ProductUnitRepository.addUnits only trims it and rejects duplicates (:324-364). So an 8-digit Lebanese number like 03123456 registers fine today. The walk-in lookup heuristic is /^\d{6,}$/ (frontend/src/features/inventory/productUnitsLogic.ts:45-48), so a number typed with spaces or +961 would not trigger it. Every label says IMEI: the placeholder "356938035643809" (ProductUnitsSection.tsx:153), "Scan or type an IMEI" (ImeiAddRow.tsx:39), and the Phone Units page (PhoneUnits/index.tsx:317-362). Both transports are covered: backend/src/api/productUnits.ts registers, lists, looks up and deletes units.

(2) Buying stock. InventoryService/ProductRepository.receiveStock (ProductRepository.ts:674-730) raises stock_quantity, sets the product's cost to the newest price, and calls bookIntakeAndBatch (:600-663). That always creates a FIFO cost batch, and books a SUPPLIER_STOCK_INTAKE supplier_ledger debt only when a supplier is set and "old stock" is unticked (:576-581). It moves no drawer and has no payment legs; the schema is product_id, quantity, unit_cost_usd, supplier, is_old_stock, reason, all USD (validators/inventory.ts:52-59). The Adjust Stock modal always sends the product's own supplier (AdjustStockModal.tsx:168), so you cannot choose who you bought from per delivery. When a category tracks units, it then offers an IMEI step, which is a SEPARATE follow-up call rather than part of the same save (:200-204, :214-216). The intake can be voided: the generic void soft-voids the ledger row and deletes the batch, and refuses if any unit has already been sold (constants/transactionTypes.ts:231-249; TransactionRepository.ts:1665, :4031-4065).

(3) Selling. The POS sale is the existing SALE flow. A unit-tracked product must have its unit chosen, one unit per cart line (SalesRepository.ts:626-685). The unit is marked SOLD against the sale item (:710-715). The cost comes from consuming FIFO batches PER PRODUCT, not per unit (:771-784). Refunds put the unit back in stock and restore the batch (:1620-1623; ProductUnitRepository.markInStock :693). The POS sends the product's list price (POS/index.tsx:290 `price: item.retail_price`), and no per-line price edit showed up in the cart components.

(4) carrier_lines (create_db.sql:1155-1181) is the shop's OWN working MTC/Alfa lines. It holds credits, validity, and the primary line per carrier. Closing checkpoints count it (ClosingRepository.ts:408), and credit buy-back matches phone numbers against it (RechargeRepository.ts:1450). It is the wrong home for lines kept for resale.

### What to build (scout's proposal — the OWNER ANSWERS at the top of this file override it)

Smallest model: a "Phone Lines" inventory category with tracks_imei_units ON, one product per carrier (e.g. "MTC prepaid line", "Alfa prepaid line"), and each phone number registered as that product's unit serial. Buying, stock, the POS sale, refunds, FIFO cost, supplier debt and both transports already work this way. What to build:

(a) Show "Number" instead of "IMEI" in the unit add row, the Phone Units page, the POS unit picker and the receipt when the category is a lines category. Either key it off a small category attribute or pass a label prop. Frontend only; S.

(b) One core normaliser for phone numbers: strip spaces, dashes and the +961/00961 prefix, and keep the leading 0. It must be a leaf module that browser.ts can import (rule 29). Use it at unit registration and at lookup (rule 14), so "03 123 456" and "03123456" can never both sit in stock, and so the walk-in lookup finds them.

(c) Optional: create the category, either with a migration seed (rule 10: both migrations/index.ts and create_db.sql, and TenantRepository seed parity for new tenants) or by telling the owner to create it in Settings. The second needs no code.

(d) Leave warranty_months empty for line products, and keep lines out of carrier_lines.

Only if the owner's answers require it:
(e) If each number has its own price, either make one item per number (stock 1, barcode = the number; zero code, but it clutters the product list) or build a per-line price override in POS. The override overlaps note #17 / LIRA-210.
(f) If lines are bought from walk-in customers for cash, build a "paid now" option at intake. It needs payment legs out of a chosen drawer, recorded in the SAME atomic action as the batch and unit rows, and a reversal owner that returns the drawer cash, deletes the batch and removes the unit. Possibly a seller client_id too. This is the only part that is genuinely new money code.

### Evidence

- docs/plans/todo_plans/OWNER_NOTES_2026-09-21.md:422, :657, :718 (triage rows), :1140 (verbatim note). No owner answer recorded in §2b.
- electron-app/create_db.sql:328-348 product_categories.tracks_imei_units, seeded on only for Phones
- electron-app/create_db.sql:371-394 product_units + idx_product_units_active_imei (unique while IN_STOCK)
- packages/core/src/validators/productUnit.ts:18 imeis only need to be non-blank, no format check
- packages/core/src/repositories/ProductUnitRepository.ts:324-364 addUnits (trim + duplicate check only)
- frontend/src/features/inventory/productUnitsLogic.ts:45-48 looksLikeImei /^\d{6,}$/
- frontend/src/features/inventory/components/ProductUnitsSection.tsx:153, ImeiAddRow.tsx:39, pages/PhoneUnits/index.tsx:317-362 (IMEI labels hardcoded)
- frontend/src/features/settings/pages/Settings/CategoriesManager.tsx:130-135, :388-407 owner-editable IMEI toggle; backend/src/api/inventory.ts:723-746 REST mirror
- backend/src/api/productUnits.ts:48-156 unit routes (dual transport)
- packages/core/src/repositories/ProductRepository.ts:576-581 shouldBookIntakeDebt, :600-663 bookIntakeAndBatch, :674-730 receiveStock (no drawer, no legs)
- packages/core/src/validators/inventory.ts:52-59 receiveStockSchema (USD, no payment fields)
- frontend/src/features/inventory/components/AdjustStockModal.tsx:164-171 (supplier = product.supplier), :200-216 IMEI step is a separate call
- packages/core/src/constants/transactionTypes.ts:231-249 SUPPLIER_STOCK_INTAKE can be voided, batch deleted, void refused once units are consumed
- packages/core/src/repositories/SalesRepository.ts:626-685 unit must be chosen, one per line; :710-715 markSold; :771-784 FIFO consume per product_id; :1620-1623 restore on refund
- frontend/src/features/sales/pages/POS/index.tsx:290 price = item.retail_price (no per-line override found)
- electron-app/create_db.sql:1155-1181 carrier_lines = shop's own working lines; ClosingRepository.ts:408 checkpoint SIM count; RechargeRepository.ts:1450 buy-back matches against the shop's own line
- git diff (working tree + index): no changes to ProductRepository/ProductUnitRepository/StockBatchRepository/CarrierLineRepository

### Risks

- FIFO cost is kept per product, not per unit (SalesRepository.ts:771-784). If numbers under one product cost different amounts, each sale's profit uses the oldest batch's cost, not the price paid for that exact number. This only matters if prices differ (Q2).
- The POS sells at the list price (POS/index.tsx:290). Unverified: whether a sale-level discount is the only price lever. Different prices per number are impossible without one item per number or a new override.
- Without normalisation, the same number typed two ways ('03 123 456' vs '03123456') registers twice. The walk-in lookup regex /^\d{6,}$/ misses spaced or +961 input (productUnitsLogic.ts:45-48).
- Registering units is a separate call after receiveStock (AdjustStockModal.tsx:200-216), so stock and registered numbers can drift; the code only warns and never blocks. This is harmless for phones and equally harmless for lines.
- Intake always uses the product's single supplier (AdjustStockModal.tsx:168). Lines bought from different dealers under one product all book debt to the same supplier.
- Putting resale lines into carrier_lines would corrupt closing SIM counts (ClosingRepository.ts:408), primary-line selection and buy-back number matching (RechargeRepository.ts:1450). Keep them apart.
- Carried from memory, not re-checked in this pass: LIRA-143 has an open owner item, a payment-side double-debit on a full refund after a partial refund, and it would equally affect line sales.
- Assumption (unverified): the carrier's ownership transfer of a line (ID paperwork at MTC/Alfa) stays outside the POS.

## #16 — scout findings (read-only, 2026-09-24)
**Size:** L if Route B (the plan as written): a migration, repository re-gating around fragile OMT/Whish code, widening the provider type everywhere, rewriting a deliberately guarded invariant test, and dual-transport e2e. M if Route A (Custom Services "Pay out"): one new direction on an existing, already-reversible Via Partner flow, with no provider widening.  
**Touches money:** True  
**Rules:** 10 — migration in both index.ts and create_db.sql (a service_providers column for Route B, a custom_services direction column for Route A), 11 — client name/phone on the payout form must carry client_id all the way through, 13/14 — the payout rule lives in a repository, with the capability predicate defined once, 15 — e2e asserts by identity + deltas: a partner-linked payout writes a transaction row plus a partner_ledger row, 16 — the payout is an OUT leg posted once by the shared end-of-transaction loop, and flow branches consume IN legs only, 17 — the regression test must fail on today's code (a Syria RECEIVE currently credits the drawer, or cannot be expressed at all), 18 — read FEATURE_GUIDE §13 before building (money flow), 19/21-24 — REST route + shared Zod schema + adapter types derived from the schema, and a three-way key-set diff before adding validation, 20 — the partner DEBIT + drawer debit must reverse to 0 per currency. The generic partner_ledger reversal exists; prove it covers the new type, 26 — only applies if an auto supplier-ledger sibling is added; otherwise none, 27 — transfer day supplied by the client, server day as fallback only

### Current behaviour

WHAT "IN" IS TODAY. Likely, based on the plan's §7 and the ticket history (not confirmed with the owner): the owner books Syria IN (the customer hands over cash to send to Syria) in Custom Services, labelled "Services" in the app, using "Via Partner" (LIRA-154):
- The customer's price comes into the drawer through the normal payment legs.
- The cost is booked as a THROUGH_CUSTOM_SERVICE partner_ledger CREDIT, meaning we owe the partner (CustomServiceRepository.ts:265-267, :618-645).
- Profit is price minus cost, and it counts immediately.
The alternative "For Partner" mode books the full price as a FOR_CUSTOM_SERVICE DEBIT with no drawer movement (:364-428). The owner's earlier "7welet syria 100$" row, cost $100 / price $110, was booked that way (current_sprint.md:620-625).

WHY "OUT" IS IMPOSSIBLE TODAY.
(1) Custom Services cannot express a payout. cost_usd, cost_lbp, price_usd and price_lbp are all .min(0) (packages/core/src/validators/customService.ts:12-15).
(2) The OMT/Whish page (route /services) only offers two providers: `type Provider = "OMT" | "WHISH"` (frontend/src/features/services/pages/Services/index.tsx:42) and `PROVIDERS = ["OMT","WHISH"]` (:182). A SYRIA provider row, which Settings → Service Providers can already create, is unreachable from the UI.
(3) If a non-OMT/Whish RECEIVE did reach the repository, it would move money the wrong way. `useSystemDrawerFlow = isOMT || isWHISH` (FinancialServiceRepository.ts:3069). The `if (!useSystemDrawerFlow)` branch CREDITS +receiveAmount to the drawer (:3972-3990). Both payout debits are gated on useSystemDrawerFlow (:4008-4011 wallet, :4036-4039 cash), so the customer's payout is never debited. On a payout the drawer goes UP.
(4) The FOR-partner arms throw for any provider outside the mapped set: "FOR-partner is not supported for provider ..." (:2663, :2763, :2809).
(5) THROUGH_PROVIDER_LEDGER_KEY (:143-151) has no SYRIA key and throws on an unmapped provider (:4311-4314).
(6) New providers are hard-coded to drawer 'General' (ServiceProviderService.ts:121).
(7) The IN/OUT badge treats a FINANCIAL_SERVICE RECEIVE as OUT unconditionally (frontend/src/features/audit/cashFlow.ts:77-88). It has no CUSTOM_SERVICE rule; Likely it defaults to "in" (unverified).

WHAT THE OWNER CAN DO TODAY (plan §7). Book the payout as a manual partner DEBIT with "Cash moved" ticked on the Partners page. That gets the money right, but there is no customer name, no commission and no service row.

REVERSAL. The generic void/refund already reverses partner_ledger rows by reference (TransactionRepository.ts:1636, :1914, :3465). Verified by reading, not by running.

### What to build (scout's proposal — the OWNER ANSWERS at the top of this file override it)

It depends on D6. Two builds.

ROUTE A: Syria lives in Custom Services, where the owner already books IN (smaller).
- Add a "Pay out" direction to Via Partner mode. The drawer is debited for the payout amount through the IN/OUT payment legs: the payout is an OUT leg posted once by the shared loop, never a second loop (rule 16). The partner ledger gets a DEBIT (they owe us).
- Commission is booked as profit per D2/D3.
- Needs:
  - a direction field on the custom-service schema, instead of allowing negative prices, so .min(0) stays;
  - a migration (probably a column on custom_services) mirrored into create_db.sql (rule 10);
  - repository branch plus unit tests proven failing-first (rule 17);
  - a CUSTOM_SERVICE payout rule in cashFlow.ts so the badge says OUT;
  - REST route/schema parity (rules 19, 21-24, and 27 for the day);
  - void test proving create + void nets to 0 on drawer and partner ledger, per currency (rule 20);
  - desktop and web e2e with identity + deltas (rule 15).

ROUTE B: the plan as written, Syria becomes a provider on the OMT/Whish page (larger).
- Phase 1: migration adds service_providers.supports_remittance, backfills OMT/WHISH to 1, mirrored in create_db.sql.
- Phase 2: a new `canPayOut` gate in FinancialServiceRepository, re-gating :3972/:4011/:4039.
  - THROUGH_PROVIDER_LEDGER_KEY derived from the provider code.
  - Four generic ledger types (THROUGH/FOR_REMITTANCE_SEND/RECEIVE) plus a partnerLedgerTypes guard update.
  - FOR-mode handling per D1.
  - First check the live DB for BOB/OTHER RECEIVE rows before touching the generic branch.
- Phase 3: schema first, then:
  - Services page provider list fetched from the table;
  - FinancialServiceEntity.provider widened to string, with switch fallout;
  - Services.throughPartnerInvariant.test.tsx rewritten (plan §4b), not deleted.
  - BaseSystem, base_system and the setup wizard stay OMT/Whish only.
- Phase 4: reversal proof (rule 20).
- Phase 5: REST parity plus desktop and web e2e.

Both routes: commission and profit stamping per D2/D3, client_id propagation (rule 11), and no is_auto siblings unless a supplier-ledger sibling is added (rule 26).

### Evidence

- docs/plans/todo_plans/SYRIA_REMITTANCE_PLAN.md:249-262 — D1-D6 as written. D1: always a partner, or walk-in? D2: RECEIVE commission deducted from payout, or on top? D3: profit deferred until the partner settles, or immediate? D4: General, or its own drawer? D5: one corridor or several (written recommendation: build it generic)? D6: this plan reverses the 'Syria in Custom Services' position, still want it?
- docs/plans/todo_plans/OWNER_NOTES_2026-09-21.md:430, :517, :526, :641, :719 — every entry says 'blocked on D1-D6'. No owner answer recorded. Owner's verbatim note is at :1154
- current_sprint.md:689 — 2026-08-10 decision log: 'Syria partners are served through Custom Services'
- frontend/src/features/services/pages/Services/index.tsx:42 and :182 — provider list closed to OMT/WHISH
- packages/core/src/repositories/FinancialServiceRepository.ts:3069 — useSystemDrawerFlow = isOMT || isWHISH
- FinancialServiceRepository.ts:3972-3990 — the non-OMT/Whish RECEIVE CREDITS +receiveAmount to the drawer (wrong direction)
- FinancialServiceRepository.ts:4008-4011 and :4036-4039 — both payout debits require useSystemDrawerFlow
- FinancialServiceRepository.ts:2663, :2763, :2809 — FOR-partner throws for unmapped providers
- FinancialServiceRepository.ts:143-151 and :4311-4314 — closed THROUGH_PROVIDER_LEDGER_KEY that throws
- packages/core/src/validators/customService.ts:12-15 — cost/price min(0)
- packages/core/src/repositories/CustomServiceRepository.ts:265-267 and :618-645 — Via Partner: price in through payment legs, cost booked as a THROUGH_CUSTOM_SERVICE CREDIT
- CustomServiceRepository.ts:364-428 — For Partner: full price booked as a FOR_CUSTOM_SERVICE DEBIT, no drawer movement
- frontend/src/features/custom-services/pages/CustomServices/index.tsx:177, :650 — UI has none/FOR/VIA partner modes
- packages/core/src/services/ServiceProviderService.ts:121 — new providers hard-coded to drawer_name 'General'
- packages/core/src/repositories/TransactionRepository.ts:1636, :1914, :3465 — the generic void/refund reverses partner_ledger rows by reference
- frontend/src/features/audit/cashFlow.ts:77-88 — RECEIVE badge rule. No CUSTOM_SERVICE rule found
- git diff HEAD hunk list for FinancialServiceRepository.ts — the uncommitted batch is the OMT/Whish RECEIVE fee cutover, not the non-OMT/Whish RECEIVE branch

### Risks

- Route B re-gates the non-OMT/Whish RECEIVE branch, which also changes behaviour for BOB/OTHER. They're believed unreachable, but the live DB has not been checked. Query a copy of ~/Documents/LiraTek/liratek.db with Python sqlite3 first (unverified).
- Route B breaks the guarded THROUGH-partner invariant: Services.throughPartnerInvariant.test.tsx uses 'SYRIA' as its counter-example. It must be rewritten failing-first, not deleted (rules 17, 24), and the plan says Phase 3 cannot ship without it.
- Route B widens FinancialServiceEntity.provider to string, with switch fallout. Widening BaseSystem, base_system or the setup wizard by mistake would drag Syria into primary-cash-drawer routing (plan §4a).
- Route B lands next to the uncommitted OMT/Whish RECEIVE fee cutover in the same file, so there is merge and regression risk to OMT/Whish postings. Any OMT/Whish e2e diff counts as a bug.
- Either route: the partnerLedgerTypes guard test is bidirectional, so new ledger type strings need their union members and the wiring in the same commit.
- Either route: the IN/OUT badge must say OUT for a payout. Custom Services has no payout badge rule today, so without one the badge silently contradicts the drawer (the LIRA-129 class of bug).
- Either route: the transfer day must come from the client (rule 27). The web server runs in UTC.
- Assumption (unverified): the owner's current Syria IN is booked through Custom Services 'Via Partner'. It could instead be 'For Partner' (the 2026-08-10 '7welet syria 100$' row used For Partner), which would change which mode the payout should mirror.
- Assumption (unverified): Syria never becomes the shop's base system (plan §4a). If it can, Route B roughly doubles.
- Assumption (unverified): no currency exchange is involved. The plan puts FX out of scope.

## #14b — scout findings (read-only, 2026-09-24)
**Size:** L overall, and it should be built as two tickets. Slice 2 (Recharges + Product Sales) is M: two detail queries that share SQL with the totals, one new gated read wired through ~8 transport files, reconciliation and gate tests, and a web e2e. Slice 3 is M-L on its own: 6+ more detail queries, each with its own counting rule. The FS settlement-allocation arm (commission allocated at settlement, count 0), loto's partner proportional share and exchange lots are the hard ones.  
**Touches money:** True  
**Rules:** 13: the detail SQL belongs in ProfitRepository, and the service only dispatches and assembles, 14: detail queries must share FROM/WHERE and weighting fragments with the totals (partnerCoverageRatio :549, notDebtPending :574, saleRecognitionWeight :785), 18: reporting-only, so the FEATURE_GUIDE §13 write-path checklist mostly does not apply, but its profit-stamping section defines what each row's counted profit means, 19: a new read on both transports behind the Profits gate (IPC requireProfitsGate, REST requireProfitsUnlock), a shared validator, and a web e2e, 21: the adapter payload type is derived from the new validator, 25: the lazy-loaded list reads api through a ref, and the test mock returns a stable reference, 26: an 'attributed expense' line shows is_auto rows, and must never net or skip them, 27: inherits the LIRA-196 day-boundary issue on web, 28/17: the reconciliation and gate tests must be run and shown to fail on the buggy variant, 29: a validator reachable from browser.ts must stay Node-free, Not biting (no writes): 11, 16, 20

### Current behaviour

WORKING TREE (uncommitted), slice 1 is built:
- By Module rows expand on click. Button at frontend/src/features/profits/pages/Profits.tsx:2505-2527, state at :624, detail row at :2593-2780. Each row shows "Revenue − Cost = Profit" per currency (or "Commission:" / "Profit:" depending on classifyProfitModuleRow, :2486).
- Product Sales adds a "kept change" / "unexplained difference" term.
- Maintenance shows the parts/labour split (:2738-2770).
- Cost USD/LBP columns are shown (:2536-2546) and there is a TOTAL footer (:2223, testid by-module-total-row :2343).
- At HEAD none of this exists: `git show HEAD:…/Profits.tsx | grep -c by-module-expand` returns 0.

The expanded row is still made of module totals only. There is NO transaction list anywhere: no "what was sold" rows, no per-transaction profit, and no reason shown for why a transaction counts in full, in part or not at all. Grep for module-detail/getModuleDetail in core, electron-app, backend and frontend finds only the slice-1 testids.

Data source:
- ProfitService.getByModule (packages/core/src/services/ProfitService.ts:1038-1380 in the working tree; :542-706 at HEAD) assembles 13 row kinds: SALE, FINANCIAL_SERVICE_<provider>, CUSTOM_SERVICE, RECHARGE_<carrier>, MAINTENANCE, LOTO, PM_FEE, EXCHANGE, KEPT_CHANGE, COUNTERPARTY_DISCOUNT, SUPPLIER_COMMISSION, TOPUP_BUYBACK.
- Each row comes from one aggregate ProfitRepository query: getSalesRevCost :2802, getSalesProfit :2878, getFinancialSettledByProvider :4045 (which has a UNION ALL settlement-allocation arm with no per-transaction revenue), getRechargesByCarrier :4163, getMaintenanceTotals :3666, getLotoTotals :3704, getExchangeTotals :3772, and so on.
- Each query applies the Profits counting rules through shared SQL fragments that are already exported: partnerCoverageRatio :549, notDebtPending :574, saleRecognitionWeight :785.

Gate: all Profits data reads are password-gated on both transports.
- IPC: requireProfitsGate at electron-app/handlers/profitHandlers.ts:33-36, used by profits:by-module at :43.
- REST: router.use(requireProfitsUnlock) at backend/src/api/profits.ts:155, above /by-module at :173.
- Transport chain for by-module: packages/ui/src/api/types.ts:2458 → frontend/src/api/backendApi.ts:3446 → ElectronApiAdapter.ts:522 → electron-app/preload.ts:1341.

The Transactions page cannot stand in for the drill-down: getRecent does not apply the partner, waiting-for-repayment or settlement rules, so its rows would not add up to the module total. It also has no deep-link or filter-by-URL support (grep for /transactions? and searchParams in frontend features finds nothing).

Auto-expense links already exist, so an "attributed expense" line is possible without a migration:
- the SMS fee and Line_Usage expenses carry source_ref_table='recharges' (RechargeRepository.ts:1193, :2020);
- FS fee expenses carry 'financial_services' (FinancialServiceRepository.ts:2864, :4247, :4290).

### What to build (scout's proposal — the OWNER ANSWERS at the top of this file override it)

Read-only reporting. No postings change.

1. CORE REPO (rules 13, 14). In ProfitRepository, pull each module's FROM/WHERE clause and weighting expression out into a private fragment builder shared by the existing total query and a new detail query. The detail rows must then add up to the total exactly.
   - Slice 2 queries:
     - getRechargeDetail(carrier, fromDt, toDt): time, phone/amount, price, cost, stamped profit, coverage ratio, counted profit, currency, plus linked auto-expense(s) via expenses.source_ref_table='recharges'.
     - getSalesDetail(fromDt, toDt): sale id, date, client, item/product, quantity (net of refunded_quantity), sold price, cost snapshot, discount share, recognition weight, counted profit, and the per-sale kept-change residual.
   - Slice 3 adds detail queries for:
     - FS by provider: per-transaction for settled or model-1 rows; per-allocation for the settlement arm, because commission there arrives at settlement rather than per transaction;
     - custom services;
     - maintenance: per job, with the parts/labour split;
     - loto: per ticket, including the partner proportional share;
     - exchange: per leg or lot;
     - PM fees.
   - KEPT_CHANGE, COUNTERPARTY_DISCOUNT, SUPPLIER_COMMISSION and TOPUP_BUYBACK are profit-only rows. Each can get a simple list.
2. SERVICE. Add ProfitService.getModuleDetail(moduleKey, from, to). It dispatches on the row's module key and throws on an unknown key. Rows should be paged or capped, because a long range can mean thousands of sales.
3. VALIDATOR in packages/core/src/validators/profits.ts: module key plus from/to, shared by both transports (rule 19b). Export it from both index.ts and browser.ts. It must stay Node-free (rule 29).
4. TRANSPORT (rule 19):
   - IPC profits:module-detail with requireProfitsGate(e) in profitHandlers.ts;
   - preload binding next to :1341, with the electron.d.ts type;
   - REST GET /api/profits/module-detail?module=&from=&to=, mounted after profits.ts:155 so it inherits requireProfitsUnlock;
   - backendApi.ts through ipcOrHttp, ElectronApiAdapter.ts, and ApiAdapter in packages/ui types.ts;
   - the payload type is derived from the validator (rule 21).
5. UI. In the existing expanded By Module row (Profits.tsx:2593+), add a "Show transactions" list: loaded lazily, read through useApi(), with the api kept in a ref (rule 25). It shows the counted rows, a "counted X%" tag for partner or partially paid rows, and the owner-chosen treatment of rows not counted yet and of linked auto-expenses.
6. TESTS (rule 17, each proven failing first):
   - core reconciliation test: Σ detail == the By Module row per currency, including a 50% partner row and an excluded waiting-for-repayment row; drop the coverage fragment and watch it fail;
   - backend gate test (403 "Profits locked" before unlock, 200 after, following backend/src/api/__tests__/profitsGate.api.test.ts:209);
   - IPC gate test;
   - dual-mode adapter test;
   - frontend test;
   - one lira-web-* e2e reusing lira-web-025's unlock helper (rule 19d).

### Evidence

- OWNER_NOTES_2026-09-21.md:1142-1143 verbatim note; :423 and :659 LIRA-209 not filed; :936 PA-4.23 = slice 1; :944 §6.7 excludes slices 2-3
- Slice 2/3 definitions and the open 'attributed expenses' question: only in this session's design output (e747a4ab transcript, '## #14: per-module detail'), not in any file on disk
- Profits.tsx:624, :2456, :2505-2527, :2593-2780 expandable rows (working tree); HEAD has no by-module-expand
- Profits.tsx:2223, :2343 TOTAL footer
- ProfitService.ts:1038-1380 getByModule, 13 row kinds
- ProfitRepository.ts:2802 getSalesRevCost, :2878 getSalesProfit, :4045 getFinancialSettledByProvider (allocation arm), :4163 getRechargesByCarrier
- ProfitRepository.ts:549/:574/:785 exported fragments
- profitHandlers.ts:33-36 requireProfitsGate; profits.ts:155 router.use(requireProfitsUnlock), :173 /by-module
- types.ts:2458, backendApi.ts:3446, ElectronApiAdapter.ts:522, preload.ts:1341 by-module chain
- RechargeRepository.ts:1193, :2020 and FinancialServiceRepository.ts:2864, :4247, :4290 expense source_ref links
- backend/src/api/__tests__/profitsGate.api.test.ts:209 gate test pattern

### Risks

- It builds on an unverified, uncommitted base. ProfitRepository.ts carries +4131 lines of uncommitted changes and ProfitService.ts +900 (git diff HEAD --stat). §6.9 records parts of that batch as reviewed by reading only, and the LO lane's review was cut off. The detail queries must reuse the same fragments, so slices 2-3 should not start until that batch is proven green and committed. Otherwise both move at once.
- Drift between totals and detail (rule 14) is the main correctness risk. A detail query written as a copy instead of from a shared fragment will sooner or later disagree with the By Module row. The reconciliation test (Σ detail == row, per currency) is the guard and must be proven failing-first (rule 17).
- The FS settlement-allocation arm has no per-transaction revenue and reports count 0 (getFinancialSettledByProvider :4045). Its drill-down has to list allocations or settlements, not transfers. The owner may expect transfers there, so the label should explain it.
- The per-sale kept-change residual is derived (stamped profit − margin), not stored (ProfitService.ts:1051-1075 comments). Per sale it can be negative and read as an 'unexplained difference', which will look alarming in a row list.
- Maintenance labour profit is an approximation: kept change is attributed to labour (ProfitService.ts:1162-1167). A per-job list makes that visible.
- Rule 27 / LIRA-196: from/to come from the client, but created_at comparisons are still made against server-stamped times. On web, sales between 00:00 and 02:59 Beirut time can land on the previous day's list, the same as By Date. Unverified for the new queries, which inherit the existing mechanism.
- Cost prices per item become visible to anyone who unlocks Profits. That is the same gate as today (profitHandlers.ts:33, profits.ts:155) and needs no new decision, but the new route must be mounted below :155 or it bypasses the lock.
- Performance on long ranges (thousands of sale lines) without paging. Unverified: no measurement was taken.

## lira-141 — scout findings (read-only, 2026-09-24)
**Size:** S: about 4 className edits plus moving one JSX block in a single file (about 10 lines), with an optional identical edit to DrawerTopUpModal. No logic, schema, IPC or REST change.  
**Touches money:** False  
**Rules:** 17: any jest guard added must be shown failing on today's markup first, 19: shared @liratek/ui component, so the fix applies to desktop and web alike; the proof is the desktop lira-141 e2e

### Current behaviour

The modal is packages/ui/src/components/ui/TopUpModal.tsx. It is shared by the Recharge page (frontend/src/features/recharge/pages/Recharge/index.tsx:40 imports it from @liratek/ui) and renders the same way on desktop and web.

How the layout breaks:
- :382 the overlay is `fixed inset-0 z-50 flex items-center justify-center p-4`. It has no overflow-y-auto.
- :386 the panel is `relative w-full max-w-lg ... flex flex-col`. It has no max-h.
- :405 the body is `p-6 space-y-5`. It has no overflow either.
- :839-879 the footer (Cancel and the confirm button) sits INSIDE that body div, at the very bottom.

So when the content is taller than the window, the flex centering pushes it past both the top and bottom edges. Nothing can scroll, because a fixed element does not scroll the page and the overlay has no overflow of its own. The header with its X and the confirm button both end up unreachable.

What made it tall enough to break: before 9c0194cd the Whish App "From Client" mode had no MultiPaymentInput (git show 40a184c8 has none). 9c0194cd and 79f90dca added a client picker (:622-627) and a full MultiPaymentInput "Pay Out" block (:635-664) on top of the fee breakdown (:523-616). With the mode toggle, currency, amount, fee box, client picker, payout, info box and footer stacked up, the modal outgrew the e2e window. That window is BrowserWindow 1400x900 (electron-app/main.ts:124-125), a bit less after the title bar.

Why only this e2e caught it: lira-141 Case B (spec :917-941) is the only UI-driven e2e for "From Client". lira-057 has From Client scenarios but, likely from its header, drives the IPC call directly (unverified). The OMT App, Katsh and iPick modes are short and still fit. That is why the rest of lira-141 and lira-190 get further.

Operator impact (unverified in the real app, but it follows from the CSS): on a typical shop screen of 1366x768, or any window shorter than about 900px, a cashier in Whish App > Top-Up > From Client cannot reach "Buy Credits from Client" without zooming the page out. Mouse-wheel scrolling does nothing. The same applies on web in a short browser window.

Sibling with the same pattern: frontend/src/features/dashboard/components/DrawerTopUpModal.tsx:467-468 (overlay with no overflow, panel with no max-h). It is not failing today (lira-141 Cases D/E and lira-147 exercise it), but it has the same latent risk.

### What to build (scout's proposal — the OWNER ANSWERS at the top of this file override it)

Apply the codebase's existing scrollable-modal pattern to TopUpModal. The same shape is already used in CashReportModal.tsx:108/139, InitialDrawerAmountsModal.tsx:172/197 and ImportCleanupModal.tsx:233/291.
1. Panel (:386): add `max-h-[90vh]`, or `max-h-[calc(100vh-2rem)]` to match the overlay's p-4, and keep `flex flex-col`.
2. Header (:390): add `shrink-0`.
3. Body (:405): `p-6 space-y-5` becomes `flex-1 min-h-0 overflow-y-auto p-6 space-y-5`.
4. Move the Footer Actions block (:839-879) OUT of the body into its own `shrink-0 px-6 py-4 border-t border-slate-700/60` footer after the body div. That way Cancel and confirm are always on screen and never need scrolling. The Info alert (:821-837) can stay in the scrolling body.
No logic, props or payload changes.

Optional, same PR: apply the same four-line treatment to DrawerTopUpModal.tsx:467-468 so it doesn't become the next occurrence.

Proof:
- (a) Re-run lira-141 unchanged: `node scripts/run-e2e.mjs electron -g "LIRA-141"`, or the npx playwright fallback from CLAUDE.md. Case B should now click through, because Playwright scrolls the button into view inside the scroll container, and it is always visible once it sits in a fixed footer. The owner runs this (memory: owner runs e2e).
- (b) Optionally, a lightweight jest guard in the existing frontend/src/features/recharge/components/__tests__/TopUpModal.*.test.tsx family. It would check that the confirm button is NOT a descendant of the overflow-y-auto body and that the body carries overflow-y-auto. jsdom has no layout, so this only pins the structure; the e2e is the real proof. Per rule 17 it would need to be shown failing on today's markup.
- (c) After the packages/ui edit, no core rebuild is needed (@liratek/ui is a symlink), but the e2e needs the usual `yarn dev` → stop → e2e cycle.

### Evidence

- The trace (frontend/test-results/lira-141-settlement-modes--942cf--follow-what-actually-moved/trace.zip, test.trace) shows: `TimeoutError: locator.click: Timeout 30000ms exceeded` on getByRole('button', { name: 'Buy Credits from Client' }), and 58 retries of 'element is visible, enabled and stable / scrolling into view if needed / done scrolling / element is outside of the viewport'
- packages/ui/src/components/ui/TopUpModal.tsx:382: overlay `fixed inset-0 z-50 flex items-center justify-center p-4`, no overflow
- TopUpModal.tsx:386: panel `relative w-full max-w-lg ... flex flex-col`, no max-h
- TopUpModal.tsx:405: body `p-6 space-y-5`, no overflow; the footer buttons (:839-879) sit inside it
- TopUpModal.tsx:622-664: the client picker and MultiPaymentInput Pay Out block, added in 9c0194cd/79f90dca (absent at 40a184c8)
- frontend/tests/e2e-electron/lira-141-settlement-modes-and-topup-arrows.spec.ts:917-941: Case B, the From Client UI path; its helpers at :352-402 scope to div.fixed.inset-0
- electron-app/main.ts:124-125: window is 1400x900
- `git diff HEAD -- packages/ui/src/components/ui/TopUpModal.tsx` is empty, so the working tree matches HEAD
- Existing pattern to copy: frontend/src/features/audit/components/CashReportModal.tsx:108 (`max-h-[85vh] flex flex-col`) and :139 (`flex-1 min-h-0 overflow-y-auto`); also InitialDrawerAmountsModal.tsx:172/197
- Same latent pattern in frontend/src/features/dashboard/components/DrawerTopUpModal.tsx:467-468

### Risks

- ClientAutocompleteInput's suggestion list is `absolute z-50 top-full ... max-h-48` (frontend/src/shared/components/ClientAutocompleteInput.tsx:202). Inside an overflow-y-auto body it will extend the scroll area instead of floating over the footer. It stays usable, but the list may need a scroll to see its last rows. Check by eye or with the e2e. MultiPaymentInput uses native <select>s, which the overflow does not clip.
- Rules do not bite beyond 17 and 19. No money moves (rules 11/16/18/20/26/27 do not apply). The component is shared by desktop and web, so one fix covers both transports (rule 19).
- A jsdom guard can only pin CSS structure, not real layout. The only true proof is the lira-141 e2e re-run, which the owner runs.
- Unverified: the exact rendered height of the From Client modal and the minimum window height at which it breaks. It is inferred from the trace plus the 900px window.
- Unverified: whether lira-057's From Client scenarios drive the UI. From its header they appear to call IPC directly, so they would not catch this.

## #17 — scout findings (read-only, 2026-09-24)
**Size:** M: one core rule plus ~12 call sites that must stamp the same flag, the stamped-rate alignment, one UI badge, and flipping 4 existing test suites. No migration and no new route.  
**Touches money:** True  
**Rules:** 18: this is money-path code (payment-leg reconciliation), so read FEATURE_GUIDE §13 before building, 14: one threshold constant and one shared assess/stamp helper, never a per-call-site copy of the deviation math or the metadata shape, 16: the change is to the rate the IN/OUT legs reconcile at, not to leg iteration. Do not touch the shared end-of-transaction OUT loop, 17: the four existing 'REJECTS outside ±15%' tests must be flipped and the new accept+flag tests shown failing on today's code, 19: satisfied structurally. Core-only change plus shared frontend, no new IPC/REST route. Still prove in web e2e, 26 (invariant, by analogy): the new metadata_json.rate_alert must read as 'no alert' when absent or malformed, and must be written from one shared writer, 27: the anchor rate is the server-side tenant rate. It is correct only with the uncommitted tenant_id fix in utils/exchangeRate.ts. At HEAD, web compared against an arbitrary tenant's rate, 20: not triggered, no new ledger or side-effect rows (a metadata flag only), 11: not triggered

### Current behaviour

WHERE THE 15% REFUSAL LIVES (Certain, read in code; moneyPosting.ts is unchanged between HEAD and the working tree):
- The rate box is packages/ui/src/components/ui/MultiPaymentInput.tsx:1364-1382 (`data-testid="payment-exchange-rate"`). It is freely editable with no client-side check. Each page forwards the edited rate as `tender_exchange_rate`. The schemas only require it to be positive (validators/financial.ts:213, exchange.ts:46/126, recharge.ts:121, debt.ts:56/110, electron-app/schemas/index.ts:671). No zod max and no percentage limit exist anywhere in packages/ui or frontend (grepped for deviation / rate warning / band: none).
- The server compares that rate with the tenant's configured sell rate (`getUsdLbpSellRate`, utils/exchangeRate.ts:64-86, falling back to 89,500). If it is more than 15% off in EITHER direction, `reconcileLegs` (moneyPosting.ts:300-316) throws inside the DB transaction and the whole save rolls back. The page gets {success:false, error}.

FLOWS THAT ARE BLOCKED TODAY (every reconcileLegs / postPayoutLegs caller that passes a tender rate):
- Exchange split payout: ExchangeRepository.ts:554-566.
- OMT / Whish / other financial services: FinancialServiceRepository.ts:2375 (checkout), :2937 (provider checkout), :3144 and :3532 (SEND), :3369 and :4093 (RECEIVE cashout).
- Recharge: RechargeRepository.ts:925 (MTC/Alfa/etc. recharge), :1548 (credit buy-back), :2390 (client top-up payout).

FLOWS THAT ARE NOT BLOCKED:
- POS sales: SalesRepository has no band.
- Custom services, maintenance and loto: no band call found.
- Customer-session baskets and for-partner branches skip reconciliation (moneyPosting.ts:211-214).
- Debt repayments are not refused, but `resolveStampedExchangeRate` (moneyPosting.ts:216-224, used at DebtRepository.ts:356/1126, FSR:1247, Recharge:766/1465/2368) SILENTLY replaces an out-of-band rate with the server rate in `transactions.exchange_rate`. The stored rate then differs from what the cashier typed, and nobody is told.

WHERE THE WORKING TREE DIFFERS FROM HEAD:
- packages/core/src/utils/exchangeRate.ts is modified (staged). The working tree adds the `tenant_id = ?` filter to `getUsdLbpSellRate` (:69-76). At HEAD it had no tenant filter, so on web the 15% was measured against possibly ANOTHER tenant's rate. That could itself explain spurious blocks the owner saw on web (Likely, not reproduced).
- The comment block in moneyPosting.ts:155-169 still calls that a "KNOWN OPEN ISSUE", and OWNER_NOTES §2b (#3) repeats it. Both are stale against the working tree.

WHAT THE CURRENT TESTS ASSERT (they pin the blocking behaviour): moneyPosting.test.ts:253 (REJECTS just outside +15%), FinancialServiceRepository.legReconciliation.test.ts:515, RechargeRepository.legReconciliation.test.ts:406, RechargeRepository.stampedExchangeRate.test.ts.

EXISTING ALERT MACHINERY:
- The only alert is recharge's margin alert, computed client-side in HistoryModal.tsx:305-349 against `recharge_margin_alert_threshold` (Settings > ShopConfig.tsx:70/216, default 100,000 LBP). It never blocks.
- LIRA-068 ("amount changed" badge, current_sprint.md:1661-1690) is unbuilt and asks to be reconciled with that margin alert.
- `transactions.metadata_json` exists (create_db.sql:169) and already reaches the Transactions table (frontend/src/features/audit/rowDerived.ts:40-43). No migration is needed to carry a flag.

### What to build (scout's proposal — the OWNER ANSWERS at the top of this file override it)

Build this if the owner confirms the rate box (Q1).

1. Core, one place (moneyPosting.ts, rule 14):
   - Split the band into two thresholds: an ALERT band (keep 0.15 as a named constant) and, if the owner wants one (Q2), a far HARD wall for typos (e.g. 0.50).
   - `resolveReconciliationRate` stops throwing inside the alert band. It returns `{ rate, alert: { tender_rate, server_rate, deviation_pct } | null }`, and throws only past the hard wall.
   - `resolveStampedExchangeRate` must return the SAME accepted tender rate (not silently fall back). Otherwise `transactions.exchange_rate` disagrees with the rate the legs were reconciled at, and USD-equivalent profit/report figures drift. Both functions should share one `assessTenderRate()` helper.

2. Stamp the flag at the writers:
   - Every blocked caller (Exchange :554, FSR :2375/:2937/:3144/:3369/:3532/:4093, Recharge :925/:1548/:2390) and the silent-fallback stamp sites (Debt :356/:1126) put `metadata_json.rate_alert = {tender_rate, server_rate, deviation_pct}` on the transaction row they write.
   - Use one shared helper that merges into existing metadata. Never hand-write the shape per call site (rule 14/26 pattern). Absent or malformed metadata reads as "no alert".

3. UI:
   - A non-blocking "Rate" alert badge with a tooltip ("typed 105,000 vs day rate 90,000, +16.7%") in the Transactions table (TransactionCells / rowDerived).
   - Optionally the same badge in the module history modals.
   - Optionally a yellow, non-blocking hint under MultiPaymentInput's rate box when the typed rate is past the alert band (Q3).
   - Build the badge so LIRA-068 can reuse it.

4. Tests (rule 17): flip the four suites above from "rejects" to "accepts + stamps rate_alert". Add one per family (Exchange, FSR SEND/RECEIVE, Recharge, Debt) proving the flag is written and the stamped `exchange_rate` equals the tender rate. Add a hard-wall test if Q2 keeps one. Each must be shown failing on today's code.

5. Both transports come for free: the change is entirely in @liratek/core plus the shared frontend. There is no new IPC/REST route and no schema field change. `tender_exchange_rate` is already carried on both transports.

6. Housekeeping: fix the stale "KNOWN OPEN ISSUE" comment (moneyPosting.ts:155-169) and the §2b #3 remark once the uncommitted tenant fix ships.

### Evidence

- packages/core/src/repositories/moneyPosting.ts:171 — `export const TENDER_RATE_BAND_PCT = 0.15;` (unchanged vs HEAD)
- packages/core/src/repositories/moneyPosting.ts:190-196 — `if (deviation > TENDER_RATE_BAND_PCT) throw new Error(`${context}: tender exchange rate ... outside the accepted ±15% band ...`)`
- packages/core/src/repositories/moneyPosting.ts:216-224 — resolveStampedExchangeRate silently falls back to the server rate when out of band (used by Debt :356/:1126, FSR :1247, Recharge :766/:1465/:2368)
- git log -S: band widened ±10%→±15% in bce00853 (2026-09-12, cornertech WHISH_APP RECEIVE report)
- Throwing call sites: ExchangeRepository.ts:554-566; FinancialServiceRepository.ts:2375, 2937, 3144, 3369, 3532, 4093; RechargeRepository.ts:925, 1548, 2390
- packages/ui/src/components/ui/MultiPaymentInput.tsx:1364-1382 — the editable '1 USD = ___ LBP' input, no client-side limit
- packages/core/src/utils/exchangeRate.ts:64-86 — working tree adds tenant_id filter to getUsdLbpSellRate (staged 'M'); at HEAD it was unscoped
- electron-app/schemas/index.ts:244-302 + packages/core/src/services/InventoryService.ts:331,449 — only other price guard: 'Selling price must be greater than cost price' (not a %)
- frontend/src/features/recharge/components/HistoryModal.tsx:305-349 — margin alert, fixed LBP threshold, display-only
- Tests asserting the block: packages/core/src/repositories/__tests__/moneyPosting.test.ts:253; FinancialServiceRepository.legReconciliation.test.ts:515; RechargeRepository.legReconciliation.test.ts:406; RechargeRepository.stampedExchangeRate.test.ts
- Searches with no blocking hit: 1.15/0.15/115/15% (only the band + unrelated test data), markup/max_markup/priceAdjust/maxIncrease/MAX_PRICE, price override/min_price/max_price/above cost, .refine() on price fields in core validators and electron schemas, throw/error messages mentioning price/margin/markup

### Risks

- Removing the block entirely lets a typo'd rate (9,000 vs 90,000) reconcile. The LBP the customer is asked for is computed at that rate, so the shop under-collects real cash. Hence Q2's far wall.
- Must also align resolveStampedExchangeRate. Accepting the tender rate for reconciliation while stamping the server rate would make transactions.exchange_rate disagree with the legs, drifting USD-equivalent profit/report figures. Likely, based on how the stamp feeds conversions; not traced per report.
- Debt repayments today silently overwrite an out-of-band rate with the server rate, a quiet data change the owner may not know about. The build should flag it the same way.
- The HEAD-vs-working-tree tenant fix in getUsdLbpSellRate may be the real cause of some web blocks. Until that batch is committed and deployed, web users can still be refused against another tenant's rate.
- Unverified: which exact screen and message the owner saw. The match rests on the 15% number and the note's placement among the OMT notes.
- Unverified: how the {success:false,error} message is displayed per page (toast vs inline). Not traced.
