# Research: Debt Repayment Item Picking and Primary-System Drawer Routing (LIRA-304)

All paths are relative to the repo root; `core/` = `packages/core/src/`. Facts below were read from the working
tree on 2026-10-10 (three read-only research passes) and from a live run on the test shop the same day.

## Findings that shape the design

| # | Fact | Where |
|---|------|-------|
| F1 | A basket checked out on CUSTOMER_ACCOUNT writes ONE `debt_ledger` row, type `'Session Debt'`, `transaction_id = NULL`, `session_id` set, `covered_*` pre-filled with gift-card + sales-first pre-cover. Members are linked by `customer_session_transactions` (`unified_transaction_id`, signed `amount_*`). Members write no debt of their own (`deferPayment`). | `SessionPaymentService.ts:743-757`, `SessionPaymentRepository.insertBasketDebt` :187-206, `CustomerSessionRepository.ts:283-308` |
| F2 | **No per-member coverage exists.** Coverage lives only on the basket row (`debt_ledger.covered_*`) and, for sales, on `sales.paid_usd`. | `create_db.sql:735-755` |
| F3 | A standalone module charge on account writes one `'<Module> Debt'` row with `transaction_id` = the originating transaction (`bookClientDebtCharge`). Coverable types: Recharge, Service, Custom Service, Loto, Maintenance, Session Debt. **`'Sale Debt'` and `'Manual Debt'` are NOT coverable** — sales are covered on `sales.paid_usd` by `_markSalesPaidFIFO`, which never reads the ledger; Manual Debt is never covered. | `constants/transactionTypes.ts:657-732`, `moneyPosting.ts:542-561`, `DebtRepository.ts:1016-1162` |
| F4 | Repayment coverage = `_markSalesPaidFIFO` (USD, oldest sale first) then `_coverServiceDebtsFIFO` (per currency, `created_at, id`), recorded in `metadata_json.coverage_applied {sales, charges}`; a void reads it back in `_restoreRepaymentDebt`. `_postDebtDiscount` uses the same helpers but records nothing. | `DebtRepository.ts:850-886, 905-973`, `TransactionRepository.ts:7133-7235` |
| F5 | Today's routing: only `'Service Debt'`/`'Refund Reversal'` rows joined to `financial_services.provider IN ('OMT','WHISH')`; outstanding = owed − Σ positive `payments` on `OMT_System`/`Whish_System` of ACTIVE repayments; strictly per currency; any drawer-affecting leg; hardcoded drawer per provider, **never reads `shop_base_system`**; writes a `RESERVE` −X / provider +X pair. Session Debt is never routed. | `DebtRepository.ts:652-800` |
| F6 | Checkout split today: `ratioForCurrency` = primary-system charge / charge total; `splitCashLegByItemShare` writes up to two `payments` rows per cash leg (PCD share + General share). Sales-first pre-cover = `allocateBasketAccountDebt` + `backfillSaleSettlement`. | `SessionPaymentService.ts:358-456, 819-888`, `SessionPaymentRepository.getSessionCashSplitContext` :302-430 |
| F7 | Profit hold for non-sale basket members is **all-or-nothing per basket** (`notDebtPending` second arm). Sales are held per sale via `sales.paid_usd`. | `ProfitRepository.ts:1035-1065` |
| F8 | Single-item refund never updates the basket row; openness drops via `coverageOutstandingSql`'s refund netting (non-SALE members only). Whole-basket void writes a `'Refund Reversal'` per Session Debt row, making it non-coverable. | `TransactionRepository.ts:3933-4925, 2140-2849`, `sessionDebtCoverage.ts:76-122` |
| F9 | Refund with override legs swaps only *overridable* legs; internal RESERVE/provider legs are always mirrored; for a `debt_ledger` source the override resolves through plain `paymentMethodToDrawerName` (General). | `TransactionRepository.ts:7707-7826, 7659-7705` |
| F10 | Transactions-page detail lines are built per leg in `buildLegDetailTr`; legs carry `drawer_name` from `payments`; internal legs are dropped by `isInternalLegJs`; the "Out — Customer Account" line is the negative `'Repayment'` ledger row rebuilt by `debtToAccountLegs`. | `TransactionsViewer.tsx:738-793`, `transactionDisplay.ts:381-434`, `TransactionRepository.ts:1640-1920` |
| F11 | `shop_base_system` is read by `SettingsService.getShopBaseSystem()` plus four inline SQL copies (FinancialService, Transaction, Sales, SessionPayment repositories). `primaryCashDrawerName`, `resolveServiceCashDrawer`, `isWalletProvider` exist. | `SettingsService.ts:148-160`, `constants/systemFloatDrawers.ts:33-37`, `utils/payments.ts:193-204`, `constants/walletProviders.ts` |
| F12 | The Debts page "eye" on a Session Debt row shows `customer_session_transactions` rows (cart is cleared after checkout) via `getSessionDetails`; no coverage data is returned. The repayment modal is the shared `CounterpartySettleModal` → `MultiPaymentInput`. | `Debts/index.tsx:572, 1767-1796, 2102-2304`, `SessionDebtDetailModal.tsx` |
| F13 | Checkpoint compares per drawer, per currency with `getVarianceStatus` (±0.01); `useSellRate` is already on the page. | `closing/utils/variance.ts:22-31`, `hooks/useDrawerCheckpoint.ts:98, 281-294` |
| F14 | Four comments claim Session Debt rows never receive FIFO `covered_*`; the code disagrees (it is coverable and pre-covered). | `TransactionRepository.ts:90-93, 2734-2737, 3304-3310, 4258-4260` |
| F15 | Latest migration: **v208**. | `core/db/migrations/index.ts:14338` |

## Decisions

### D1 — Per-member amounts on the basket link row, basket row stays the sum
- **Decision**: add `owed_usd, owed_lbp, covered_usd, covered_lbp` to `customer_session_transactions` (migration v209). `owed_*` = the member's share of the on-account portion, fixed at checkout. `covered_*` = how much of that share repayments/discounts have paid. The `'Session Debt'` row keeps its `amount_*`/`covered_*` and stays the authority every existing query reads; its `covered_*` must always equal gift-card + sale pre-cover + Σ non-sale member `covered_*` (invariant **I1**).
- **Rationale**: every existing consumer (coverage FIFO, item refund, whole-basket void, `coverageOutstandingSql`) keeps working unchanged; per-item picking only needs the member split. One-row-per-basket is preserved (owner chose Option 2).
- **Alternatives**: split baskets into per-item debt rows (owner rejected Option 3; rewrites refund/void/profit hold); a separate `debt_item_coverage` table (same data, extra join, no gain).

### D2 — One member-aware coverage writer
- **Decision**: a single repository method `applyCoverage(plan)` (in `DebtRepository`) writes `sales.paid_usd`, charge-row `covered_*`, and member `covered_*` + the basket row together, and returns the record. Checkout pre-cover, repayment and `_postDebtDiscount` all go through it. The repayment's `coverage_applied` gains `members: [{id, usd, lbp}]`; the discount path starts recording its coverage too (on its own COUNTERPARTY_DISCOUNT metadata, for audit — discounts stay non-reversible).
- **Rationale**: three writers today (F4, F6); invariant I1 survives only if one function writes it.

### D3 — Routing is tracked separately from coverage (blocking item)
- **Decision**: routing follows this rule (owner decisions 2026-10-10, corrected after `/speckit-analyze`):
  1. **Ticked items first**: the cash applied to a ticked primary-system transfer goes to the primary cash drawer; the cash applied to a ticked item of any other kind stays in the payment method's drawer (General for cash).
  2. **Remainder, or everything when nothing is ticked**: "OMT drawer first" — routed up to the cap.
  3. **Cap, always**: per transfer, the drawer never receives more than the transfer's amount minus what earlier repayments already routed for it.
  "Already routed" is stored per repayment **in each transfer's own currency**, as a value fixed at repayment time (`metadata_json.routed.by_transfer`), and the cap is compared per transfer currency — a USD transfer against USD values, an LBP transfer against LBP values. No conversion at today's rate ever enters the cap.
- **Rationale**: coverage stays in today's order (sales first) while the drawer fills OMT first; tying routing to coverage would over-route when the OMT item is later ticked. Cross-currency routing (LBP for a USD OMT debt goes in as LBP) needs a value fixed at the repayment's own rate. A single USD valuation would drift again for transfers made in LBP.
- **Consequence the owner should know**: nothing ticked, $50 paid → OMT drawer +$50 while the cable is marked paid; later ticking OMT and paying $65 → OMT drawer +$51 (cap), General +$14. The OMT drawer ends with exactly the transfer's $101.
- **Test (failing-first)**: `DebtRepository.routingCap.test.ts` — the case above; tick cable, pay $14 → General +$14, OMT drawer 0; tick cable, pay $60 → General +$14, OMT drawer +$46; 8,989,000 LBP for a USD $101 send at 89,000 → LBP into the OMT drawer, routed value $101; an OMT send of 9,000,000 LBP, $50 cash at 90,000 → OMT drawer +$50, routed value 4,500,000 LBP, cap unchanged after the rate moves to 95,000.

### D4 — Routed share keeps a non-overridable shape (blocking item)
- **Decision**: keep the internal two-row shape for the routed share (an internal leg on the paying drawer, −X, and the system-drawer leg, +X), both marked internal so refund-with-override always mirrors them (F9). The Transactions page **folds** them for display (D9): the paying leg and its internal move are shown as one `In — Cash` line with a per-drawer breakdown.
- **Rationale**: a plain CASH row on `OMT_System` would be swapped out by an override refund, paying back from General and stranding the routed cash in the OMT drawer.
- **Test (failing-first)**: `TransactionRepository.refundRoutedRepayment.test.ts` — refund a routed repayment with `refundLegs` overriding the method; every drawer nets to 0 per currency.

### D5 — Reversed repayments stop counting as routed (blocking item)
- **Decision**: "already routed" excludes repayments that are VOIDED **or** reversed by a refund (a reversal row pointing at them via `reverses_id`), not only `status = 'ACTIVE'`.
- **Rationale**: the generic refund may leave the original ACTIVE; its +X system-drawer rows would keep counting while the reversal's −X rows are filtered out by `amount > 0`, so later repayments would route too little.
- **Test**: `DebtRepository.routingAfterRefund.test.ts` — route, refund the repayment, repay again; the second repayment routes the full amount again. Settled by running, not by reading (rule 28).

### D6 — Primary system only, cash only, one helper
- **Decision**: route only debts whose transfer has `provider === shop_base_system` (OMT or WHISH system; never `OMT_APP`/`WHISH_APP`/`BINANCE`, never the secondary system), and only legs that `resolveServiceCashDrawer({provider: base, baseSystem: base})` would send to the primary drawer (drawer-affecting, maps to General, not GIFT_CARD). Cross-currency legs are routed in their own currency (owner decision). Add ONE exported repository helper `readShopBaseSystem(db)` (core/repositories/settingsSql.ts or similar) and use it in the new code; the four existing inline copies are noted, not refactored (out of scope).
- **Rationale**: owner decisions (2), cash-only, LBP-for-USD; fixes the secondary-system bug (F5); rule 14 forbids a fifth copy.

### D7 — Pick targets are three kinds
- **Decision**: a repayment may carry `targets: Array<{kind: "sale", id} | {kind: "charge", id} | {kind: "member", id}>` — `sale` = a `sales.id` with an unpaid balance (standalone or basket), `charge` = a coverable `debt_ledger` row (non-session module debt), `member` = a non-sale `customer_session_transactions` row of an open basket. `'Manual Debt'` is listed on the Accounts page as today but is **not pickable** (it is never covered; it is cleared by the balance only).
- **Rationale**: F3 — sales are covered on `sales`, not on a ledger row; Manual Debt has no coverage to apply.
- **Spec impact**: FR-006 reads "every open debt item"; Manual Debt is shown but not tickable — recorded as an assumption in the spec.

### D8 — Allocation order
- **Decision**: one pure function `allocateRepayment({openItems, targets, budget, cashLegs, rate, baseSystem, routedSoFar})` in `core/utils/debtRepaymentAllocation.ts` (Node-free leaf, reachable from `browser.ts`, rule 29). Coverage: ticked items oldest-first, then today's default (sales first, then charges/members `created_at, id`). Routing: D3 (ticked items first, then OMT drawer first, capped per transfer currency). Returns `{coverage, routing, drawerPreview}`. The repayment modal calls it for the preview (FR-010) and `DebtRepository.addRepayment` calls it authoritatively with server-read data (FR-012).
- **Rationale**: preview and posting can never disagree; the server never trusts client amounts.

### D9 — Payment-detail display
- **Decision**: in the Transactions page, group a row's legs by `(method, direction)` into one line with all currencies (`$115 + 200,000 LBP`); when the line's money touched more than one drawer (including folded internal routing pairs, D4, and checkout splits, F6), append `{amount drawer · amount drawer}` using drawer display names. Applies to every transaction (shared display). Pure helper in `features/audit/` with unit tests.
- **Rationale**: owner request; `drawer_name` is already on the legs (F10).

### D10 — Profit hold per member
- **Decision**: change `notDebtPending`'s second arm from "basket row open" to "this member's `owed − covered − its refund credit` open". Sales unchanged.
- **Rationale**: FR-015. **Risk**: historical Profits totals can move for baskets that were partly repaid. Measure before/after on a DB copy (Python `sqlite3`) during implementation and report; add a release-note line if visible.

### D11 — Checkout cash split: OMT first
- **Decision**: replace the charge-side ratio with an allocation: a cash leg pays primary-system members first (up to their charge), then the rest; member `owed_*` = charge − cash allocated. Payout side unchanged (SYSTEM payouts already 100% to the PCD). The new SQL lives in `SessionPaymentRepository`, not the service (rule 13).
- **Rationale**: owner decision 2026-10-10. Sales-first debt attribution is unchanged (cash covers non-sales first, so debt lands on sales first — consistent).

### D12 — Backfill for existing baskets (migration v209)
- **Decision**: for each existing `'Session Debt'` row (`transaction_id IS NULL`), derive members' `owed_*` from the same rule the checkout used at the time — the **by-share** split (not OMT first): non-sale members share the row's non-sale debt (`amount − sale pre-cover − gift card`) in proportion to their `amount_*`, per currency, remainder to the last member. Distribute the row's existing non-sale `covered_*` across members oldest-first (`cst.id`). Assert I1 after backfill.
- **Rationale**: honest about how old baskets were actually split; oldest-first matches how FIFO covered them.
- **Alternatives**: OMT-first backfill (would misstate old baskets).

### D13 — Checkpoint info total
- **Decision**: `DrawerCard` gets an optional `usdTotal {expected, counted}` computed in `useDrawerCheckpoint` with the page's existing `sellRate`, shown only when a drawer holds more than one non-zero currency; never fed into `getVarianceStatus`.

### D14 — Stale comments
- **Decision**: fix the four comments in F14 in the same change, since this feature makes them more misleading.

## Open risks carried into tasks
- I1 drift — guarded by `sessionMemberCoverage.invariant.test.ts` (checkout → partial repayment → discount → item refund → void; Σ member outstanding = row outstanding).
- Profit totals change (D10) — measured, reported.
- Desktop e2e cannot run on this Mac (owner rule); desktop parity relies on CI's desktop job plus core jest; web proven by a new `lira-web-0xx` spec.
