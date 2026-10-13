# Research: Extra charges (LIRA-319)

Findings from reading `main` at 8c8b4523 (three research passes, 2026-10-13). Every decision below cites the code it rests on. "SR" = `packages/core/src/repositories/SalesRepository.ts`, "TR" = `TransactionRepository.ts`, "MPI" = `packages/ui/src/components/ui/MultiPaymentInput.tsx`.

## R1 — Where the extra is stored

- **Decision**: two new columns on the unified `transactions` table, `extra_usd REAL NOT NULL DEFAULT 0` and `extra_lbp REAL NOT NULL DEFAULT 0` (migration v212, plus `electron-app/create_db.sql`). The extra is written on the module's own transaction row (SALE, MAINTENANCE, CUSTOM_SERVICE, LOTO, RECHARGE, FINANCIAL_SERVICE) and, for a session basket, on one basket-level row (R6).
- **Rationale**: `transactions` has no discount/fee column today (create_db.sql:371-395); each module stores its discount differently (sales.discount_usd, maintenance.discount_usd, recharge/loto metadata, financial-service fee columns). One column pair on the shared table gives every module one field and one reporting query (rule 14) and lets the generic void/refund see it. Last migration is v211 (`migrations/index.ts:14599`); create_db.sql's marker list stops at v207 — check v208–211 markers before adding v212.
- **Alternatives**: `metadata_json` keys (no schema change, but every report would parse JSON per row and profit SQL gets slower and harder to share); per-module columns (six migrations, six queries — rejected by rule 14).

## R2 — How the extra flows through amount and profit

- **Decision**: the transaction's `amount_usd/lbp` INCLUDES the extra (it is what the customer owes and pays); the transaction's `profit_usd/lbp` EXCLUDES it (item / service margin stays honest); the extra is reported from `extra_usd/lbp` as its own profit.
- **Rationale**:
  - Payments, drawers and client debt are driven by legs and the amount, so including the extra in the amount makes `_reversePayments` (TR:7851) and `_cancelDebt` (TR:5456) reverse it with no new code, and debt residuals (SR:1506-1529, Maintenance :1020-1052) include it.
  - Keeping it out of `profit_*` avoids the SALE row's derived `sale_kept_change = profit − (revenue − cost)` (ProfitService.ts:~1290-1330) reading the extra as kept change, and keeps every module margin unchanged (SC-005).
- **Consequence**: every place that sums profit stamps as "total profit" must add `extra_usd/lbp` through ONE named SQL fragment (`EXTRA_CHARGE_PROFIT_*`, rule 14): `ProfitService.getSummary` gross total, `getByDate` (:6627), `getByUser` (:8039), `getByClient` (:8758), `getPaymentMethodRows` (:7418), and CustomerSessionRepository session profit sums (:415, :480). Module revenue figures (dashboard `SUM(final_amount_usd)` SalesRepository :3625, ClosingRepository :812) stay item revenue; cash-collected figures include the extra automatically because they read payments.
- **Alternatives**: extra inside each module's profit stamp and subtracted per module in SQL (Option A — touches every module query and the kept-change derivation); standalone profit-only EXTRA_CHARGE row per sale like `KEPT_CHANGE` (Option B — needs its own reversal owner and pro-rata refund logic for every module). Option B is used only for the session basket (R6), where it is the existing pattern.

## R3 — Profits page category "Extra charges"

- **Decision**: a new `ProfitByModule` row `{ module: "EXTRA_CHARGE", label: "Extra charges", revenue = extra, cost = 0, profit = extra }` per currency, from `SUM(extra_usd)`, `SUM(extra_lbp)` over rows that count as profit (`status = 'ACTIVE'`, REFUND rows carry the negated share). Added to `PROFIT_ONLY_MODULES` (`constants/profitRowClass.ts:70`) and module-detail support (`constants/profitModuleDetailSupport.ts:26`) with a detail query modelled on `getKeptChangeDetail` (ProfitRepository.ts:6426). Overview gets an "Extra charges" figure next to Kept Change.
- **Rationale**: the Profits "categories" are the By Module rows (`ProfitService.getByModule` :1260, `ProfitByModule` :153); Kept Change is the precedent for a profit-only row (:1510-1530).

## R4 — Server validation and reconciliation

- **Decision**: each write schema gets `extra_usd` and `extra_lbp` as `z.number().nonnegative().optional()` with **no `.default()`**; each repository adds the extra to the total it reconciles and books debt against; the server — not the client — enforces: no extra with a discount (> 0 both), no extra on a for-partner sale, on a payout, or on a deferred (session-basket) item; extra ≤ the pre-extra total (FR-006 default cap).
- **Rationale**: offline replay refuses an event when the server schema has a key the event lacks unless it is optional with no default (`offline/schemaShape.ts`, ReplayEngine.ts:189-221). Reconciliation points: POS `resolveKeptChange` expected `final_amount` (SR:669, gated :636) and debt residual (SR:1506-1529); Maintenance kept-change expected `finalAmount + partsPriceUsd` (:763-765) and residual (:1020-1052); Custom Services `customerAmountDue` (CustomServiceRepository.ts:68); Loto expected `sale_amount` (:338-364); Recharge `reconcileLegs` against `data.price` (:1248-1255); financial services `checkoutTotal` (:3245, crypto :3491, SEND :3873-3918).
- **Alternatives**: one generic `extra` field the client folds into price (rejected — loses the separate amount the owner wants to see); trusting the client's `final_amount` (rejected — rule: server computes money).

## R5 — Pages and UI

- **Decision**:
  - `DiscountLine` gains a "− Discount | + Extra" segmented switch (one field, active mode). MPI's built-in discount gets an opt-in extra mode (`onExtraChange`, `maxExtra`); in extra mode it ADDS to `effectiveTotals` and shows "After Extra". Pages with their own `discountRow` (POS / Maintenance checkout) add the switch to their line.
  - Pages whose discount is folded into the price on the client (Katsh, FinancialForm, Crypto SEND, OMT/Whish app transfer — KatshForm.tsx:1683-1730, FinancialForm :422-484, CryptoForm :205-211, OmtWhishAppTransferForm :255-386) send the extra as its own field, never folded.
  - OMT/Whish send (Services page, `showDiscount={false}` :2412) gets the line in extra-only mode.
  - Not offered: payouts, refunds, Debts / Supplier / Partner settles (owner), Exchange, Expenses, Hold Money, for-partner sales, items added to a session basket (FR-010).
- **Rationale**: LIRA-318 put one Discount line in every payment box (DiscountLine.tsx:45; MPI `discountRow` :247-251); the switch reuses it, so no new control.

## R6 — Session basket

- **Decision**: the extra is set once on the session checkout and recorded as one profit-carrying basket row of type `EXTRA_CHARGE` (amount = extra, profit 0, `extra_usd/lbp` = extra), linked to the session with a positive amount via `linkTransaction` — the same pattern as `KEPT_CHANGE` (SessionCheckoutService.ts:789-797) and `WAIVED_SHORTFALL` (:850-884). Because the basket charge is the sum of positive linked amounts (SessionPaymentRepository.ts:405-497), the extra raises the charge the basket payment is checked against. Basket void/refund reverses it with the basket (same owner as KEPT_CHANGE). An item refunded out of a basket gives back its share of the basket extra by the item's share of the basket charge.
- **Rationale**: items in a basket carry `deferPayment` and post no payment (SessionCheckoutService.ts:139-144); the basket owns payment, kept change and waive.
- **Open for tasks**: the session receipt has no basket-level discount line today (sessionReceipt.ts:157-179); add an "Extra" line.

## R7 — Void, refund, partial refund, undo

- **Decision**:
  - Void: nothing extra — the original goes VOIDED and leaves every profit query (ACTIVE filter); `_reversePayments` returns the money.
  - Full refund: `_createRefundRow` (TR:5927-6004) writes `extra_usd/lbp = −original.extra_*`.
  - Partial item refund (sales only — no other module has line refunds): `_computeSaleItemRefundAmounts` (SR:3000-3032) adds `extraShare = sale_txn.extra_* × lineShareOfSale` to the refund amount, and the REFUND row (SR:2210-2225) writes `extra_usd/lbp = −extraShare`. Drawer and debt follow automatically (`_applySaleItemMoneyBack` SR:3195 scales payments by the line share; Sale-Debt cancel SR:3156). The preview (`getItemRefundPreview` SR:1903) already scales legs, so RefundMethodModal pre-fills price + share.
  - Undo of an item refund (`undoSaleItemRefund` SR:2588, row :2787-2808) and the session undo (TR:5048, row ~:5229) write `extra_* = −refund.extra_*`.
  - Session basket item refund (`refundSessionBasketItem` TR:4684, `_reverseRemainingSaleLines` TR:2403-2460) returns the item's share of the basket EXTRA_CHARGE row.
- **Rationale**: rule 20 — every amount needs a named reversal owner and create + reverse must net to 0 per currency.

## R8 — Receipts and Transactions view

- **Decision**: "Extra +$X" line after the discount slot in `receiptFormatter.ts` (58 mm :185-189, 80 mm :333-338, JSON :399-401), `serviceReceipt.ts` (:141-142, :228-231), `sessionReceipt.ts`, SaleDetailModal (:915); Transactions list appends "extra +$X" in `cashMovementLine` (`utils/transactionRowDisplay.ts:155-174`) and a line in the leg detail row (`buildLegDetailTr`, TransactionsViewer.tsx:738-800).

## R9 — Docs

- **Decision**: FEATURE_GUIDE §2 (stamped fields), §9 (void/refund + pro-rata extra), §10 (Extra charges category), §13 checklist; POSTING_MAP §4.1, §4.3–4.6 and §5 reversal owners.

## T055 — rule-23 key diff: `recharge:process` / `POST /api/recharge/process`

- Schema `createRechargeSchema` now declares `extra_usd`, `extra_lbp` (optional, no default).
- Preload `recharge.process` and `electron.d.ts` are typed as `CreateRechargePayload` (`z.input` of the schema), so (b) = (a) by construction.
- The IPC handler forwards `{ ...v.data, userId }` and the REST route `{ ...req.body, userId }` (the parsed body), so (c) = (a). No key is dropped.
