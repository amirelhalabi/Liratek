/**
 * Unified Transaction Type Constants
 *
 * These map 1:1 to the `type` column in the `transactions` table.
 * Under the accounting journal pattern, deletions create a new transaction
 * with `reverses_id` pointing to the original and negated amounts — no
 * separate "DELETED" types needed.
 */

export const TRANSACTION_TYPES = {
  // Revenue modules
  SALE: "SALE",
  FINANCIAL_SERVICE: "FINANCIAL_SERVICE",
  EXCHANGE: "EXCHANGE",
  RECHARGE: "RECHARGE",
  RECHARGE_TOPUP: "RECHARGE_TOPUP",
  MTC_TOPUP: "MTC_TOPUP",
  ALFA_TOPUP: "ALFA_TOPUP",
  CUSTOM_SERVICE: "CUSTOM_SERVICE",
  MAINTENANCE: "MAINTENANCE",

  // Loto
  LOTO: "LOTO",
  LOTO_CASH_PRIZE: "LOTO_CASH_PRIZE",
  LOTO_SETTLEMENT: "LOTO_SETTLEMENT",
  LOTO_MONTHLY_FEE: "LOTO_MONTHLY_FEE",

  // Outflows
  EXPENSE: "EXPENSE",

  // Drawer adjustments
  DRAWER_TOPUP: "DRAWER_TOPUP",
  /** Cash Out: the owner pulls physical cash OUT of the General drawer for a
   *  reason that is neither a business expense (EXPENSE, which reduces
   *  net_profit) nor a drawer-to-drawer transfer (DRAWER_TOPUP's
   *  from-drawer mode). Mirrors DRAWER_TOPUP with the sign flipped. */
  DRAWER_CASHOUT: "DRAWER_CASHOUT",

  // Hold Money (cash held on behalf of a client, returned on collection)
  HOLD_MONEY: "HOLD_MONEY",
  HOLD_MONEY_COLLECT: "HOLD_MONEY_COLLECT",

  // Debt & supplier
  DEBT_REPAYMENT: "DEBT_REPAYMENT",
  CREDIT_CASH_OUT: "CREDIT_CASH_OUT",
  // Manual, till-moving account entries from the Accounts (Debts) page:
  // CREDIT_CASH_IN — customer hands the shop cash to hold as credit (drawer IN);
  // DEBT_CASH_OUT — shop gives the customer cash as an advance/loan (drawer OUT).
  CREDIT_CASH_IN: "CREDIT_CASH_IN",
  DEBT_CASH_OUT: "DEBT_CASH_OUT",
  /** T3 keep-change on a session basket: a standalone profit-only row
   *  (amount 0 — the tender is booked by the basket's payment legs). */
  KEPT_CHANGE: "KEPT_CHANGE",
  SUPPLIER_PAYMENT: "SUPPLIER_PAYMENT",
  SUPPLIER_SETTLEMENT: "SUPPLIER_SETTLEMENT",
  /** PFT-6b: a Partners-page settlement's money movement — the drawer leg
   *  (CASH→General etc.) that squares the partner's balance. */
  PARTNER_SETTLEMENT: "PARTNER_SETTLEMENT",
  /** PFT-7b: a manual partner Add-credit/debt entry WITH "cash moved" — the
   *  Accounts-page CREDIT_CASH_IN/DEBT_CASH_OUT analog (add debt = cash OUT
   *  to the partner, add credit = cash IN from the partner). */
  PARTNER_PAYMENT: "PARTNER_PAYMENT",
  /** LIRA-066: the general Partners-page "Record Tx" entry with "Cash moved"
   *  OFF — a paper (no-cash) partner_ledger correction. Previously this wrote
   *  ONLY partner_ledger with no unified-transaction visibility at all; this
   *  type exists so the owner can see it on the Transactions page. Posts NO
   *  payments row / drawer delta (that's the entire distinction from
   *  PARTNER_PAYMENT) — amount_usd/amount_lbp carry the signed ledger value
   *  for report-readability, but the Transactions viewer badge is
   *  deliberately blank (getCashFlowDirection) since no cash moved. */
  PARTNER_ADJUSTMENT: "PARTNER_ADJUSTMENT",
  /** CQ-10 — a counterparty (client/supplier/partner) forgives part of a
   *  balance, or the shop forgives part of what a counterparty owes. Posted
   *  once per discount (bundled with a settlement or standalone), on top of
   *  the kind-specific ledger row ('Debt Discount' / 'DISCOUNT' /
   *  'DISCOUNT'). amount_usd/amount_lbp are always 0 (no cash moves);
   *  profit_usd/profit_lbp carry the SIGNED discount (D1). */
  COUNTERPARTY_DISCOUNT: "COUNTERPARTY_DISCOUNT",
  /** LIRA-080: the Accounts (Debts) page's "Add Credit / Debt" entry with
   *  "Cash moved" OFF — a paper (no-cash) debt_ledger correction, the
   *  client-side sibling of PARTNER_ADJUSTMENT. Posts NO payments row /
   *  drawer delta (that's the entire distinction from CREDIT_CASH_IN/
   *  DEBT_CASH_OUT). amount_usd/amount_lbp carry the SIGNED debt_ledger
   *  value (same sign convention as the CREDIT_DEPOSIT/Manual Debt row it
   *  wraps) for report-readability; the Transactions viewer badge is
   *  deliberately blank (getCashFlowDirection) since no cash moved. */
  ACCOUNT_ADJUSTMENT: "ACCOUNT_ADJUSTMENT",
  /** LIRA-080: the Suppliers page's "Add Credit / Debt" entry with "Cash
   *  moved" OFF — a paper (no-cash) supplier_ledger correction, the
   *  supplier-side sibling of PARTNER_ADJUSTMENT/ACCOUNT_ADJUSTMENT. Written by
   *  SupplierRepository.addLedgerEntry's no-drawer ADJUSTMENT branch (distinct
   *  from the cash-moved path, which reuses recordSupplierCashflow →
   *  SUPPLIER_PAYMENT). Posts NO payments row / drawer delta; amount_usd/
   *  amount_lbp carry the SIGNED supplier_ledger value (CREDIT +, "shop owes
   *  supplier more"; DEBIT −) for report-readability, and the Transactions
   *  viewer badge is deliberately blank (getCashFlowDirection) since no cash
   *  moved. NOTE this is the unified-transaction TYPE only — the
   *  supplier_ledger.entry_type stays the pre-existing 'ADJUSTMENT' enum value
   *  (no migration). */
  SUPPLIER_ADJUSTMENT: "SUPPLIER_ADJUSTMENT",

  // Closing / Checkpoint
  CHECKPOINT: "CHECKPOINT",

  // Reversal
  REFUND: "REFUND",

  // Non-financial entity events
  CLIENT_CREATED: "CLIENT_CREATED",
  CLIENT_UPDATED: "CLIENT_UPDATED",
  CLIENT_DELETED: "CLIENT_DELETED",
} as const;

export type TransactionType =
  (typeof TRANSACTION_TYPES)[keyof typeof TRANSACTION_TYPES];

/**
 * Types that voidTransaction/refundTransaction must REFUSE (enforced in the
 * repository so no IPC caller can bypass it). Each would leave side effects
 * the generic reversal cannot undo — blocking beats corrupting:
 * - LOTO / LOTO_CASH_PRIZE: their supplier_ledger rows (ticket TOP_UP carries
 *   no transaction link) and checkpoint totals are never reversed, so the
 *   loto settle-to-zero reconciliation would break.
 * - LOTO_SETTLEMENT: checkpoint is_settled stamps stay in place, and the
 *   commission credit to General has no payments row to reverse.
 *   (SUPPLIER_SETTLEMENT used to share this rationale — LIRA-085,
 *   2026-07-21, moved it OUT of this set: both gaps are addressable —
 *   TransactionRepository._reverseSupplierSettlement reverses the commission
 *   drawer legs directly from the transaction's own stamped metadata and
 *   un-stamps financial_services.settlement_id/is_settled precisely, see its
 *   doc comment.)
 * - RECHARGE_TOPUP: the provider-drawer credit has no payments row either.
 * - REFUND: reversing a reversal double-moves the drawers.
 * - CREDIT_CASH_OUT: the generic reversal does not restore the CREDIT_USED
 *   debt_ledger row, so voiding would return the cash without restoring the
 *   client's credit.
 * - CREDIT_CASH_IN / DEBT_CASH_OUT: the generic reversal moves the drawer back
 *   but does NOT undo the debt_ledger row, so voiding would correct the till
 *   while leaving the client balance wrong. Reverse via the opposite manual
 *   entry (Add Debt cancels an Add Credit and vice versa) — which also corrects
 *   the till.
 */
export const NON_REVERSIBLE_TRANSACTION_TYPES: ReadonlySet<TransactionType> =
  new Set<TransactionType>([
    TRANSACTION_TYPES.LOTO,
    TRANSACTION_TYPES.LOTO_CASH_PRIZE,
    TRANSACTION_TYPES.LOTO_SETTLEMENT,
    TRANSACTION_TYPES.RECHARGE_TOPUP,
    TRANSACTION_TYPES.REFUND,
    TRANSACTION_TYPES.CREDIT_CASH_OUT,
    TRANSACTION_TYPES.CREDIT_CASH_IN,
    TRANSACTION_TYPES.DEBT_CASH_OUT,
    // KEPT_CHANGE (T3): profit-only row with no money movement of its own —
    // the tender lives in the basket's payment legs on the item rows, so a
    // standalone void would desync profit from money. Rule-20 reversal owner:
    // none needed (the kept cash physically stays in the drawer regardless).
    TRANSACTION_TYPES.KEPT_CHANGE,
    // PARTNER_ADJUSTMENT (LIRA-066): a paper (no-cash) manual partner_ledger
    // entry — no payments row exists to reverse. LIRA-085 re-verified
    // (2026-07-21): a partner_ledger own-row reversal mechanism now EXISTS
    // (TransactionRepository._reversePartnerSettlementLedger, built for
    // PARTNER_SETTLEMENT/PARTNER_PAYMENT below) and could mechanically cover
    // this type too (no drawer, no coverage stamps to unwind) — but the
    // owner's actual complaint (notes 25/26) was scoped to settlements/
    // payments, so wiring ADJUSTMENT in is left as a low-risk follow-up, not
    // done here. Rule-20 owner: correct with an opposite manual Record Tx
    // entry on the Partners page.
    TRANSACTION_TYPES.PARTNER_ADJUSTMENT,
    // ACCOUNT_ADJUSTMENT (LIRA-080): a paper (no-cash) manual debt_ledger
    // entry — no payments row exists to reverse, and the generic path has no
    // debt_ledger reversal owner for CREDIT_DEPOSIT/Manual Debt rows either
    // (the exact same gap that already makes this type's cash-moved siblings,
    // CREDIT_CASH_IN/DEBT_CASH_OUT, non-reversible above). LIRA-085
    // re-verified (2026-07-21): rationale still holds — out of this ticket's
    // scope (owner's complaint was settlements/payments, not paper entries).
    // Rule-20 owner: correct with an opposite manual Add Credit/Debt entry on
    // the Accounts page — same story as CREDIT_CASH_IN/DEBT_CASH_OUT.
    TRANSACTION_TYPES.ACCOUNT_ADJUSTMENT,
    // SUPPLIER_ADJUSTMENT (LIRA-080): a paper (no-cash) manual supplier_ledger
    // entry — no payments row exists to reverse, and the generic path has no
    // supplier_ledger reversal owner for a bare ADJUSTMENT row. Its cash-moved
    // counterpart takes the DIFFERENT type SUPPLIER_PAYMENT (via
    // recordSupplierCashflow) which STAYS generically reversible (soft-void +
    // drawer reversal) — only the paper variant is non-reversible. LIRA-085
    // re-verified (2026-07-21): rationale still holds, out of scope (see
    // ACCOUNT_ADJUSTMENT). Rule-20 owner: correct with an opposite manual Add
    // Credit/Debt entry on the Suppliers page.
    TRANSACTION_TYPES.SUPPLIER_ADJUSTMENT,
    // COUNTERPARTY_DISCOUNT (CQ-10): no drawer/legs to reverse (amount_usd/lbp
    // are always 0) and the FIFO coverage it applied (sales.paid_usd /
    // debt_ledger.covered_* / partner_ledger.covered_amount /
    // supplier_purchases.paid_usd) cannot be un-applied generically as a
    // STANDALONE reversal target. LIRA-085 (2026-07-21) re-verified this
    // holds for a standalone discount (writeOff) — correction stays an
    // OPPOSITE discount. A discount BUNDLED inside a PARTNER_SETTLEMENT is a
    // different story: its own transaction_id stays out of
    // ACTIONABLE_TYPES/never directly voidable, but reversing the SETTLEMENT
    // it rode with now sweeps it too (see
    // TransactionRepository._reversePartnerSettlementLedger) — its ledger
    // row/profit stamp are negated by a dedicated compensating pair, not by
    // removing this type from NON_REVERSIBLE (nothing changes about what a
    // caller can do to a COUNTERPARTY_DISCOUNT row directly).
    TRANSACTION_TYPES.COUNTERPARTY_DISCOUNT,
    // MTC_TOPUP / ALFA_TOPUP (topUpFromCustomer): moves General AND the
    // provider drawer directly with NO payments legs — the generic reversal
    // touches neither drawer. Rule-20 owner: correct with an opposite manual
    // top-up from the Recharge page.
    TRANSACTION_TYPES.MTC_TOPUP,
    TRANSACTION_TYPES.ALFA_TOPUP,
    // DRAWER_TOPUP (createTopUpFromDrawer): two drawer movements but only the
    // General-side payments leg — a void would restore General and strand the
    // source drawer's deduction. Rule-20 owner: an opposite transfer.
    TRANSACTION_TYPES.DRAWER_TOPUP,
    // DRAWER_CASHOUT: _reversePayments could mechanically restore General (it's
    // a single-drawer negative leg, no stranded second drawer like topup's
    // from-drawer mode), but drawer_cashouts has no is_refunded soft-void column
    // and isn't in _markSourceRefunded — and a shrinkage-sensitive cash
    // withdrawal should be corrected append-only for audit-trail reasons anyway.
    // Rule-20 owner: an opposite external Drawer Top-Up from the Dashboard.
    TRANSACTION_TYPES.DRAWER_CASHOUT,
    // HOLD_MONEY / HOLD_MONEY_COLLECT: hold_money.status ('held'/'collected')
    // is not reset by the generic reversal (hold_money is not in
    // _markSourceRefunded) — voiding a hold then collecting it pays out twice.
    // Rule-20 owner: the Hold Money page's own lifecycle.
    TRANSACTION_TYPES.HOLD_MONEY,
    TRANSACTION_TYPES.HOLD_MONEY_COLLECT,
    // LOTO_MONTHLY_FEE: loto_monthly_fees.is_paid stays 1 on a voided payment
    // (table not in _markSourceRefunded) — the month would show paid with the
    // cash reversed. Rule-20 owner: the Loto monthly-fee page.
    TRANSACTION_TYPES.LOTO_MONTHLY_FEE,
    // CHECKPOINT: a physical-count reconciliation anchor — reversing its
    // adjustment legs shifts live balances away from counted reality and
    // orphans the daily_closings snapshot. Correct with a new checkpoint.
    TRANSACTION_TYPES.CHECKPOINT,
    // CLIENT_* rows are non-financial audit markers; a reversal row is
    // meaningless noise.
    TRANSACTION_TYPES.CLIENT_CREATED,
    TRANSACTION_TYPES.CLIENT_UPDATED,
    TRANSACTION_TYPES.CLIENT_DELETED,
  ]);

/**
 * debt_ledger.transaction_type values that book a MODULE CHARGE against a
 * client's account (CUSTOMER_ACCOUNT / partial-payment shortfall), linked to
 * the unified transaction via debt_ledger.transaction_id = transactions.id.
 *
 * This is the exact set the generic void/refund path must reverse
 * (TransactionRepository._cancelDebt) — and nothing else. It must stay a
 * whitelist: 'Repayment' rows also carry a transaction_id (back-linked to
 * their DEBT_REPAYMENT transaction) and negating one would un-pay a debt;
 * 'CREDIT_DEPOSIT'/'CREDIT_USED'/'Manual Debt' rows are manual-ledger entries
 * with no transaction linkage. 'Session Debt' is deliberately absent: it
 * links via session_id (transaction_id NULL) and is reversed by the session
 * flow, not the generic path.
 */
export const MODULE_DEBT_TRANSACTION_TYPES: readonly string[] = [
  "Sale Debt",
  "Recharge Debt",
  "Service Debt",
  "Custom Service Debt",
  "Loto Debt",
  "Maintenance Debt",
];

export const TRANSACTION_STATUS = {
  ACTIVE: "ACTIVE",
  VOIDED: "VOIDED",
} as const;

export type TransactionStatus =
  (typeof TRANSACTION_STATUS)[keyof typeof TRANSACTION_STATUS];
