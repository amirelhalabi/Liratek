// Shared audit/transaction constants.
//
// These live in a non-component module so they can be imported by both the
// AuditLogViewer/TransactionsViewer pages and AuditPage without tripping the
// react-refresh/only-export-components lint rule (which forbids a component
// file from also exporting non-component values).

import { isAutoRow, type PaidViaDrawer } from "@liratek/core";

export const ACTION_OPTIONS = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "LOGIN",
  "LOGOUT",
  "VOID",
  "REFUND",
  "PROCESS",
  "SETTINGS_CHANGE",
  "IMPORT",
  "EXPORT",
  "BACKUP",
  "RESTORE",
  "SEED",
];

export const ENTITY_TYPE_OPTIONS = [
  "user",
  "product",
  "sale",
  "client",
  "debt",
  "financial_service",
  "recharge",
  "exchange",
  "loto_ticket",
  "loto_settings",
  "expense",
  "maintenance",
  "supplier",
  "rate",
  "currency",
  "module",
  "payment_method",
  "mobile_service_item",
  "settings",
  "backup",
  "session",
  "item_cost",
  "custom_service",
];

export type FilterOption = {
  label: string;
  /** Unified transaction type — omitted for client-side-only filters. */
  type?: string;
  provider?: string;
  service_type?: string;
  has_item_key?: boolean;
  /** B6: keep only transactions with a physical-cash (CASH) payment leg. */
  cash_only?: boolean;
  /** Keep only the is_credit SUPPLIER_PAYMENT rows (see TransactionsViewer). */
  supplier_credit_only?: boolean;
  /**
   * LIRA-323 — set on EVERY option of a wallet (OMT App / Whish App /
   * Binance) to that wallet's drawer: the option ALSO shows rows of other
   * types whose payment detail moved money through this drawer (a repair
   * paid with OMT Wallet, a refund paid out by it). Rows of the wallet's own
   * options are never added this way. Core's PAID_VIA_DRAWER_OWN_TUPLES is
   * the definition of "own"; paidViaDrawerOptions.guard.test.ts keeps these
   * tags and that list identical.
   */
  paid_via_drawer?: PaidViaDrawer;
  /**
   * Set on EVERY option of the Debts group: the option ALSO shows rows of
   * other types linked to a customer account (a sale charged to the
   * account, change kept as credit). Core's PAID_VIA_ACCOUNT_OWN_TUPLES is
   * the definition of "own"; paidViaDrawerOptions.guard.test.ts keeps the
   * tagged options and that list identical.
   */
  paid_via_account?: boolean;
  /**
   * Set on EVERY option of the Vouchers group (LIRA-339): the option ALSO
   * shows rows of other types paid with a voucher. Core's
   * PAID_VIA_VOUCHER_OWN_TUPLES is the definition of "own";
   * paidViaDrawerOptions.guard.test.ts keeps both identical.
   */
  paid_via_voucher?: boolean;
};

// ---------------------------------------------------------------------------
// D2 — SUPPLIER_PAYMENT default-view visibility
// ---------------------------------------------------------------------------
//
// Manual supplier payments (Suppliers page Pay/Receive, a real drawer_name
// entry) are first-class citizens of the Transactions page by default.
// Auto-generated sibling rows — the supplier debt/credit ledger writes every
// other module (recharge top-ups, financial-service SEND/RECEIVE, loto, …)
// books automatically — carry `metadata.is_auto === true` and stay hidden
// UNLESS the operator explicitly selects a SUPPLIER_PAYMENT-targeted filter
// (see FILTER_GROUPS' "Suppliers" group), which always wins over the
// default hide. Extracted as pure, dependency-free helpers so the rule is
// unit-testable without rendering TransactionsViewer.

export function parseMetaSafe(
  metaJson: string | null | undefined,
): Record<string, unknown> {
  if (!metaJson) return {};
  try {
    return JSON.parse(metaJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** True only when the row's metadata explicitly flags it auto-generated.
 *  Defined once in core (shared with the phone's Activity tab); re-exported
 *  so the existing call sites and tests keep their import. */
export { isAutoRow };

/** @deprecated alias of `isAutoRow` kept for the SUPPLIER_PAYMENT call sites
 *  below — behavior is byte-identical to before this was extracted. */
export function isAutoSupplierPayment(
  metaJson: string | null | undefined,
): boolean {
  return isAutoRow(metaJson);
}

/**
 * LIRA-232 round-2 review (finding 2) — true only for a REFUND row that
 * `TransactionRepository.refundSessionBasketItem` itself wrote (it stamps
 * `metadata_json.refundType = "sessionItem"` on every REFUND row it
 * creates, both the SALE-line branch and the generic item branch). Used to
 * hide "Void basket" once a session has ANY per-item refund: `voidSessionBasket`
 * hard-refuses a basket that has been touched by an item refund (nothing
 * left to cleanly void — only "Refund basket", which reverses just what's
 * left, remains valid), so offering the button at all just surfaces that
 * error on click. Absent/unparsable metadata (or a whole-basket void/refund
 * REFUND row, which carries no `refundType`) reads as `false` — the safe
 * default here is "don't hide a button that might still work".
 */
export function isSessionItemRefundRow(
  type: string,
  metaJson: string | null | undefined,
): boolean {
  return (
    type === "REFUND" && parseMetaSafe(metaJson).refundType === "sessionItem"
  );
}

/**
 * Whether a SUPPLIER_PAYMENT row should be visible under the given filter
 * state (D2). `activeOption` is the currently selected FILTER_GROUPS entry,
 * or undefined for "All types".
 *
 *   - No filter, or any filter NOT targeting SUPPLIER_PAYMENT: manual rows
 *     show, auto rows stay hidden (the default-view rule).
 *   - An explicit SUPPLIER_PAYMENT filter overrides the default hide:
 *     - "Supplier Credit" (`supplier_credit_only`) narrows to just the
 *       is_credit rows, auto or not — unchanged from the pre-D2 behaviour.
 *     - Any other SUPPLIER_PAYMENT filter (e.g. "Supplier Payment") reveals
 *       every row, including the auto ones.
 */
export function isSupplierPaymentVisible(
  metaJson: string | null | undefined,
  activeOption: Pick<FilterOption, "type" | "supplier_credit_only"> | undefined,
): boolean {
  if (activeOption?.type === "SUPPLIER_PAYMENT") {
    if (activeOption.supplier_credit_only) {
      return parseMetaSafe(metaJson).is_credit === true;
    }
    return true;
  }
  return !isAutoSupplierPayment(metaJson);
}

// ---------------------------------------------------------------------------
// EXPENSE default-view visibility (SMS_Transfer_Fee auto-expense clutter)
// ---------------------------------------------------------------------------
//
// Five auto-expense writers (recharge SMS transfer fee among them) book an
// EXPENSE row via ExpenseRepository.createExpense whenever they pass a
// `source_ref_table`; that repository now stamps metadata.is_auto = true on
// those rows (core-side fix, already shipped — see ticket). Mirrors the D2
// SUPPLIER_PAYMENT rule above: a manual expense (Expenses page entry) is a
// first-class visible Transactions row by default, and only the
// auto-generated siblings stay hidden until the operator explicitly filters
// for EXPENSE (FILTER_GROUPS "Other" group, "Expense" option).
//
// Rule 17 (CLAUDE.md): prove this fails first — comment out the
// `r.type === "EXPENSE"` branch in useTransactionRows.ts's filterVisible
// (so it falls through to `return true` unconditionally) and confirm the
// "auto EXPENSE row hidden under All types" test in
// useTransactionRows.test.ts fails, then restore the branch.

/**
 * Whether an EXPENSE row should be visible under the given filter state.
 * `activeOption` is the currently selected FILTER_GROUPS entry, or undefined
 * for "All types".
 *
 *   - The "Expense" filter (`type: "EXPENSE"`) always reveals the row,
 *     auto-generated or not.
 *   - Any other filter (including "All types"): manual rows show, auto rows
 *     (metadata.is_auto === true) stay hidden.
 *
 * A manual expense (no `is_auto` key, or unparsable/absent metadata) always
 * reads as visible — `isAutoRow` returning `false` on parse failure is
 * already the safe default, so no extra guard is added here.
 */
export function isExpenseVisible(
  metaJson: string | null | undefined,
  activeOption: Pick<FilterOption, "type"> | undefined,
): boolean {
  if (activeOption?.type === "EXPENSE") return true;
  return !isAutoRow(metaJson);
}

/**
 * LIRA-296 (rule 26) — a WARRANTY_COST row is a system-written sibling of an
 * operator's warranty claim (`metadata.is_auto = true`): hidden by default,
 * revealed by the "Warranty Cost" type filter. Same rule as EXPENSE above;
 * absent/unparsable metadata reads as visible.
 */
export function isWarrantyCostVisible(
  metaJson: string | null | undefined,
  activeOption: Pick<FilterOption, "type"> | undefined,
): boolean {
  if (activeOption?.type === "WARRANTY_COST") return true;
  return !isAutoRow(metaJson);
}

export const FILTER_GROUPS: { group: string; options: FilterOption[] }[] = [
  {
    group: "Cash",
    options: [
      // B6: "what touched the till?" — transactions with a CASH payment leg.
      // Method-based filter, applied client-side (isCashTransaction) — stays
      // correct as-is under the Primary Cash Drawer model even though a CASH
      // leg no longer always posts to the General drawer: a primary-system
      // SEND/RECEIVE CASH leg now resolves to the PCD (OMT_System/
      // Whish_System) instead (plan §1/§2 #4).
      { label: "Cash only (till)", cash_only: true }, // i18n-exempt: filter key (option value, test id)
    ],
  },
  {
    group: "Financial — System",
    options: [
      { label: "OMT System", type: "FINANCIAL_SERVICE", provider: "OMT" }, // i18n-exempt: filter key (option value, test id)
      { label: "Whish System", type: "FINANCIAL_SERVICE", provider: "WHISH" }, // i18n-exempt: filter key (option value, test id)
    ],
  },
  {
    group: "OMT App",
    options: [
      {
        label: "OMT App Send", // i18n-exempt: filter key (option value, test id)
        type: "FINANCIAL_SERVICE",
        provider: "OMT_APP",
        service_type: "SEND",
        paid_via_drawer: "OMT_App",
      },
      {
        label: "OMT App Recv", // i18n-exempt: filter key (option value, test id)
        type: "FINANCIAL_SERVICE",
        provider: "OMT_APP",
        service_type: "RECEIVE",
        paid_via_drawer: "OMT_App",
      },
    ],
  },
  {
    group: "Whish App",
    options: [
      {
        label: "Whish App Send", // i18n-exempt: filter key (option value, test id)
        type: "FINANCIAL_SERVICE",
        provider: "WHISH_APP",
        service_type: "SEND",
        has_item_key: false,
        paid_via_drawer: "Whish_App",
      },
      {
        label: "Whish App Recv", // i18n-exempt: filter key (option value, test id)
        type: "FINANCIAL_SERVICE",
        provider: "WHISH_APP",
        service_type: "RECEIVE",
        has_item_key: false,
        paid_via_drawer: "Whish_App",
      },
      {
        label: "Whish App Bills", // i18n-exempt: filter key (option value, test id)
        type: "FINANCIAL_SERVICE",
        provider: "WHISH_APP",
        has_item_key: true,
        paid_via_drawer: "Whish_App",
      },
    ],
  },
  // One-option groups show as a plain item (no header) in the filter list.
  {
    group: "iPick",
    options: [{ label: "iPick", type: "FINANCIAL_SERVICE", provider: "iPick" }],
  },
  {
    group: "Katsh",
    options: [{ label: "Katsh", type: "FINANCIAL_SERVICE", provider: "Katsh" }],
  },
  {
    group: "Binance",
    options: [
      {
        label: "Binance Send", // i18n-exempt: filter key (option value, test id)
        type: "FINANCIAL_SERVICE",
        provider: "BINANCE",
        service_type: "SEND",
        paid_via_drawer: "Binance",
      },
      {
        label: "Binance Recv", // i18n-exempt: filter key (option value, test id)
        type: "FINANCIAL_SERVICE",
        provider: "BINANCE",
        service_type: "RECEIVE",
        paid_via_drawer: "Binance",
      },
    ],
  },
  {
    group: "Recharge",
    options: [
      { label: "MTC", type: "RECHARGE", provider: "MTC" },
      { label: "Alfa", type: "RECHARGE", provider: "Alfa" },
      // CARRIER_LINES_VALIDITY_PLAN.md Phase 6: the reverse-direction
      // buy-back — a customer hands the shop credits, the shop pays cash
      // out (cashFlow.ts red ↑, the opposite of the two rows above).
      {
        label: "MTC Buy-back", // i18n-exempt: filter key (option value, test id)
        type: "TELECOM_CREDIT_BUYBACK",
        provider: "MTC",
      },
      {
        label: "Alfa Buy-back", // i18n-exempt: filter key (option value, test id)
        type: "TELECOM_CREDIT_BUYBACK",
        provider: "Alfa",
      },
      // LIRA-252 wave 2: a manual SIM-line hand-edit from Settings → Carrier
      // Lines or the Recharge-tab inline balance update. One option for
      // both carriers (no `provider` narrowing — the row's own `summary`
      // already names MTC vs Alfa), matching the single-option granularity
      // of "Discount"/"Checkpoint" below.
      { label: "Line Adjustment", type: "CARRIER_LINE_ADJUSTMENT" }, // i18n-exempt: filter key (option value, test id)
      // LIRA-312 — credits sent back after a wrong-number card recharge.
      { label: "Credits recovered", type: "WRONG_NUMBER_CREDITS" }, // i18n-exempt: filter key (option value, test id)
    ],
  },
  {
    group: "Drawer & Top-ups",
    options: [
      { label: "MTC Top-up", type: "MTC_TOPUP" }, // i18n-exempt: filter key (option value, test id)
      { label: "Alfa Top-up", type: "ALFA_TOPUP" }, // i18n-exempt: filter key (option value, test id)
      { label: "iPick Top-up", type: "RECHARGE_TOPUP", provider: "iPick" }, // i18n-exempt: filter key (option value, test id)
      { label: "Katsh Top-up", type: "RECHARGE_TOPUP", provider: "Katsh" }, // i18n-exempt: filter key (option value, test id)
      {
        label: "Whish App Top-up", // i18n-exempt: filter key (option value, test id)
        type: "RECHARGE_TOPUP",
        provider: "WHISH_APP",
        paid_via_drawer: "Whish_App",
      },
      {
        label: "OMT App Top-up", // i18n-exempt: filter key (option value, test id)
        type: "RECHARGE_TOPUP",
        provider: "OMT_APP",
        paid_via_drawer: "OMT_App",
      },
      {
        // Primary Cash Drawer plan §1 — OMT_System is the physical cash
        // drawer, not a provider system balance; label follows suit.
        label: "OMT Cash Drawer Top-up", // i18n-exempt: filter key (option value, test id)
        type: "RECHARGE_TOPUP",
        provider: "OMT_SYSTEM",
      },
      {
        label: "Whish Cash Drawer Top-up", // i18n-exempt: filter key (option value, test id)
        type: "RECHARGE_TOPUP",
        provider: "WHISH_SYSTEM",
      },
      { label: "General Top-up", type: "DRAWER_TOPUP" }, // i18n-exempt: filter key (option value, test id)
      { label: "General Cash-Out", type: "DRAWER_CASHOUT" }, // i18n-exempt: filter key (option value, test id)
      // LIRA-192: the OMT App wallet's own cash-out (mirror of the OMT App
      // Top-up row above), grouped with the other drawer/top-up types.
      {
        label: "OMT App Cash-Out", // i18n-exempt: filter key (option value, test id)
        type: "WALLET_CASHOUT",
        paid_via_drawer: "OMT_App",
      },
    ],
  },
  {
    group: "Loto",
    options: [
      { label: "Loto", type: "LOTO" }, // i18n-exempt: filter key (option value, test id)
      { label: "Loto Prize", type: "LOTO_CASH_PRIZE" }, // i18n-exempt: filter key (option value, test id)
      { label: "Loto Monthly Fee", type: "LOTO_MONTHLY_FEE" }, // i18n-exempt: filter key (option value, test id)
      { label: "Loto Settlement", type: "LOTO_SETTLEMENT" }, // i18n-exempt: filter key (option value, test id)
    ],
  },
  {
    // Suppliers are first-class citizens of the Transactions page (CQ-8).
    // CLIENT_CREATED stays blanket-hidden by default (see
    // HIDDEN_TRANSACTION_TYPES in TransactionsViewer); SUPPLIER_PAYMENT is
    // NOT — D2 shows manual payments by default and only hides the
    // auto-generated ledger siblings (metadata.is_auto). "Supplier Payment"
    // and "Supplier Credit" below are both explicit-filter escape hatches
    // that reveal the auto rows too — see isSupplierPaymentVisible.
    group: "Suppliers",
    options: [
      { label: "Supplier Settlement", type: "SUPPLIER_SETTLEMENT" }, // i18n-exempt: filter key (option value, test id)
      { label: "Supplier Payment", type: "SUPPLIER_PAYMENT" }, // i18n-exempt: filter key (option value, test id)
      {
        label: "Supplier Credit", // i18n-exempt: filter key (option value, test id)
        type: "SUPPLIER_PAYMENT",
        supplier_credit_only: true,
      },
      // LIRA-080: the paper (no-cash) "Add Credit / Debt" entry — manual, so
      // visible by default (no is_auto flag involved), same as Partner
      // Adjustment.
      { label: "Supplier Adjustment", type: "SUPPLIER_ADJUSTMENT" }, // i18n-exempt: filter key (option value, test id)
      // SUPPLIER_STOCK_INTAKE_PLAN.md — receiving stock on credit; manual
      // (operator-triggered from Inventory), so visible by default too.
      { label: "Stock Received", type: "SUPPLIER_STOCK_INTAKE" }, // i18n-exempt: filter key (option value, test id)
      // LIRA-087 (migration v189) — a debt recorded before the products that
      // earned it arrive; manual (operator-triggered from Suppliers), so
      // visible by default too.
      { label: "Supplier Debt Recorded", type: "SUPPLIER_RECORDED_DEBT" }, // i18n-exempt: filter key (option value, test id)
    ],
  },
  {
    // PARTNER_SETTLEMENT / PARTNER_PAYMENT (CQ-8) — always visible by
    // default, same as any other counterparty transaction; these
    // type-only filters just let the operator narrow to them.
    // PARTNER_ADJUSTMENT (LIRA-066) — the paper (no-cash) "Record Tx" entry;
    // manual, so it's visible by default too (no is_auto flag involved).
    group: "Partners",
    options: [
      { label: "Partner Settlement", type: "PARTNER_SETTLEMENT" }, // i18n-exempt: filter key (option value, test id)
      { label: "Partner Payment", type: "PARTNER_PAYMENT" }, // i18n-exempt: filter key (option value, test id)
      { label: "Partner Adjustment", type: "PARTNER_ADJUSTMENT" }, // i18n-exempt: filter key (option value, test id)
    ],
  },
  {
    // Everything on a customer account. Like the wallet groups, each option
    // also shows rows of other types charged to or credited on an account
    // (paid_via_account — see core's constants/paidViaAccount.ts).
    group: "Debts",
    options: [
      {
        label: "Debt Repayment", // i18n-exempt: filter key (option value, test id)
        type: "DEBT_REPAYMENT",
        paid_via_account: true,
      },
      // LIRA-080: the paper (no-cash) Accounts-page "Add Credit / Debt" entry.
      {
        label: "Account Adjustment", // i18n-exempt: filter key (option value, test id)
        type: "ACCOUNT_ADJUSTMENT",
        paid_via_account: true,
      },
      // The cash-moved siblings of Account Adjustment.
      {
        label: "Account Credit", // i18n-exempt: filter key (option value, test id)
        type: "CREDIT_CASH_IN",
        paid_via_account: true,
      },
      { label: "Cash Advance", type: "DEBT_CASH_OUT", paid_via_account: true }, // i18n-exempt: filter key (option value, test id)
      {
        label: "Credit Cash Out", // i18n-exempt: filter key (option value, test id)
        type: "CREDIT_CASH_OUT",
        paid_via_account: true,
      },
    ],
  },
  {
    // LIRA-339: gift cards sold and cancelled. Each option also shows rows of
    // other types paid with a voucher (paid_via_voucher — see core's
    // constants/paidViaVoucher.ts).
    group: "Vouchers",
    options: [
      // Filter key; the row's own label is "Voucher sold".
      { label: "Voucher Sold", type: "VOUCHER_SALE", paid_via_voucher: true }, // i18n-exempt: filter key (option value, test id)
      {
        label: "Voucher Cancelled", // i18n-exempt: filter key (option value, test id)
        type: "VOUCHER_CANCEL",
        paid_via_voucher: true,
      },
    ],
  },
  {
    group: "Expenses",
    options: [
      { label: "Expense", type: "EXPENSE" }, // i18n-exempt: filter key (option value, test id)
      // LIRA-262 — "the shop used its own stock" expenses, one type per
      // source. Manual (never is_auto), so visible by default too.
      { label: "Expense · Stock", type: "EXPENSE_INVENTORY" }, // i18n-exempt: filter key (option value, test id)
      { label: "Expense · Katsh", type: "EXPENSE_KATSH" }, // i18n-exempt: filter key (option value, test id)
      { label: "Expense · iPick", type: "EXPENSE_IPICK" }, // i18n-exempt: filter key (option value, test id)
      { label: "Expense · Whish App", type: "EXPENSE_WHISH_APP" }, // i18n-exempt: filter key (option value, test id)
      // LIRA-296 — reveals the auto WARRANTY_COST rows (hidden by default).
      { label: "Warranty Cost", type: "WARRANTY_COST" }, // i18n-exempt: filter key (option value, test id)
    ],
  },
  {
    group: "Other",
    options: [
      { label: "Sale", type: "SALE" }, // i18n-exempt: filter key (option value, test id)
      { label: "Exchange", type: "EXCHANGE" }, // i18n-exempt: filter key (option value, test id)
      { label: "Custom Service", type: "CUSTOM_SERVICE" }, // i18n-exempt: filter key (option value, test id)
      { label: "Maintenance", type: "MAINTENANCE" }, // i18n-exempt: filter key (option value, test id)
      // CQ-10: one type spans all three counterparty kinds (debt/supplier/
      // partner) — amounts are always 0 (the value lives in signed
      // profit_usd/lbp), no dedicated group needed for a single filter.
      { label: "Discount", type: "COUNTERPARTY_DISCOUNT" }, // i18n-exempt: filter key (option value, test id)
      { label: "Checkpoint", type: "CHECKPOINT" }, // i18n-exempt: filter key (option value, test id)
      { label: "Refund", type: "REFUND" }, // i18n-exempt: filter key (option value, test id)
      { label: "Client Updated", type: "CLIENT_UPDATED" }, // i18n-exempt: filter key (option value, test id)
      { label: "Client Deleted", type: "CLIENT_DELETED" }, // i18n-exempt: filter key (option value, test id)
    ],
  },
];

// ---------------------------------------------------------------------------
// Transactions-table action gating (Void / Refund / Print)
// ---------------------------------------------------------------------------

/**
 * Types whose rows get Void + Refund buttons in the transactions table.
 * Must stay the exact complement of core's NON_REVERSIBLE_TRANSACTION_TYPES —
 * the backend's _assertReversible is the real gate; this set only controls
 * visibility. The actionGating guard test enforces the partition.
 */
export const ACTIONABLE_TYPES: ReadonlySet<string> = new Set([
  "SALE",
  "FINANCIAL_SERVICE",
  "EXCHANGE",
  // Same shape as EXCHANGE — two payment legs + two drawer deltas, no
  // orphaned side-table state (wallet_exchanges has is_refunded/refunded_at
  // and is in TransactionRepository's _markSourceRefunded supported list) —
  // reversible via the generic path, not in NON_REVERSIBLE_TRANSACTION_TYPES.
  "WALLET_EXCHANGE",
  // Same reversal shape as WALLET_EXCHANGE — two payment legs + two drawer
  // deltas, own side table (drawer_transfers, renamed from
  // system_float_topups — Primary Cash Drawer plan §8.6) with
  // is_refunded/refunded_at and in TransactionRepository's
  // _markSourceRefunded supported list — reversible via the generic path,
  // not in NON_REVERSIBLE_TRANSACTION_TYPES. Renamed from
  // `SYSTEM_FLOAT_TOPUP` alongside `TRANSACTION_TYPES.DRAWER_TRANSFER`
  // (plan §8.6) — this is now a generic General <-> primary-cash-drawer
  // cash transfer, not a provider float top-up.
  "DRAWER_TRANSFER",
  "RECHARGE",
  "CUSTOM_SERVICE",
  "MAINTENANCE",
  "EXPENSE",
  // LIRA-262 — reversible via the generic void/refund (provider leg via
  // _reversePayments, expense soft-void, inventory restoreExpenseStock).
  "EXPENSE_INVENTORY",
  "EXPENSE_KATSH",
  "EXPENSE_IPICK",
  "EXPENSE_WHISH_APP",
  "DEBT_REPAYMENT",
  "SUPPLIER_PAYMENT",
  // LIRA-085: PARTNER_SETTLEMENT/PARTNER_PAYMENT/SUPPLIER_SETTLEMENT moved
  // out of core's NON_REVERSIBLE_TRANSACTION_TYPES — TransactionRepository
  // now owns their reversal (_reversePartnerSettlementLedger /
  // _reverseSupplierSettlement). Must stay in lockstep with that set — see
  // actionGating.guard.test.ts.
  "PARTNER_SETTLEMENT",
  "PARTNER_PAYMENT",
  "SUPPLIER_SETTLEMENT",
  // Ticket sale (LOTO): reversible until its checkpoint is settled —
  // TransactionRepository now owns a dedicated guard/reversal pair
  // (_assertLotoTicketVoidable / _reverseLotoSupplierLedger) that blocks a
  // settled-checkpoint ticket with a named-settlement error and, for an
  // unsettled/uncheckpointed ticket, soft-voids the link-mode supplier_ledger
  // TOP_UP row and delta-adjusts the checkpoint's frozen totals. That
  // repository guard is the real gate; this entry only controls button
  // visibility. LOTO_CASH_PRIZE and LOTO_SETTLEMENT stay OUT of scope (no
  // reversal owner exists for either) — see core's
  // NON_REVERSIBLE_TRANSACTION_TYPES.
  "LOTO",
  // TELECOM_SELF_CHARGE (LIRA-090): a self-charge of a telecom item to the
  // shop's own carrier line — reversible via the generic path. The generic
  // _reversePayments unwinds the payment legs; the carrier_line movement log
  // has its own void hook in TransactionRepository (rules §11/§20). Absent
  // from NON_REVERSIBLE_TRANSACTION_TYPES per the LIRA-090 handoff spec.
  "TELECOM_SELF_CHARGE",
  // LIRA-309 — internal recharge of a line held for sale; reversible via the
  // generic path plus _reverseResaleLineRecharge (newest first, not once sold).
  "LINE_RECHARGE",
  // LIRA-337 — credit given back from a line held for sale; reversible via
  // the generic path plus _reverseResaleLineGiveBack (newest first, not once sold).
  "LINE_CREDIT_GIVE_BACK",
  // TELECOM_CREDIT_BUYBACK (CARRIER_LINES_VALIDITY_PLAN.md Phase 6, D8): a
  // shop-line credit buy-back — reversible via the generic path (the
  // generic _reversePayments unwinds the drawer-delta leg and every payout
  // leg; _reverseCarrierLineMovements unwinds the credits gain). Absent
  // from core's NON_REVERSIBLE_TRANSACTION_TYPES.
  "TELECOM_CREDIT_BUYBACK",
  // LIRA-312 — credits received for a wrong-number card; reversible via the
  // generic path (_reversePayments + _reverseCarrierLineMovements). Absent
  // from core's NON_REVERSIBLE_TRANSACTION_TYPES.
  "WRONG_NUMBER_CREDITS",
  // SUPPLIER_STOCK_INTAKE_PLAN.md rule 20 — voiding this transaction is the
  // named reversal owner for the supplier_ledger STOCK_INTAKE row AND the
  // cost batch it created (TransactionRepository soft-voids the ledger row
  // and deletes the batch). Reversible so the owner can undo a mistaken
  // delivery — REST/IPC `_assertReversible` still refuses it once any unit
  // of the batch has been sold (StockBatchRepository.deleteBatchForVoid
  // returns false, not this set's visibility gate).
  "SUPPLIER_STOCK_INTAKE",
  // LIRA-087 (migration v189) rule 20 — voiding this transaction reuses the
  // SAME reversal owner as SUPPLIER_STOCK_INTAKE
  // (TransactionRepository._reverseSupplierStockIntake, type-widened): a
  // no-op while the recorded debt is still unattached (ledger row just
  // soft-voids), refused once an attached batch has already sold units.
  "SUPPLIER_RECORDED_DEBT",
  // LIRA-192 (OMT open-credit account, §8.7): the OMT App wallet cash-out.
  // The cashout's wallet leg is written as a real `payments` row (so the
  // generic `_reversePayments` restores the OMT_App drawer) and the
  // supplier_ledger row is back-linked via source_ref_table/source_ref_id
  // (so the existing cascade-void finds and negates it) — core's
  // TransactionRepository owns proving that nets to 0 (see
  // TransactionRepository.walletCashoutVoid.test.ts). Deliberately absent
  // from core's NON_REVERSIBLE_TRANSACTION_TYPES. The actionGating.guard
  // test enforces this entry stays in lockstep with that set.
  "WALLET_CASHOUT",
  // LIRA-194 (2026-09-20): every top-up writer (topUpApp, topUpFromSupplier,
  // topUpFromPartner, topUpFromClient — iPick/Katsh/OMT App/MTC/Alfa/Whish
  // App) now posts its drawer leg(s) as real `payments` rows, and the one
  // link-mode `supplier_ledger` row (topUpFromSupplier) has a dedicated
  // reversal owner (`TransactionRepository._reverseSupplierLedgerByTransactionLink`).
  // Moved OUT of core's NON_REVERSIBLE_TRANSACTION_TYPES — see that
  // constant's own RECHARGE_TOPUP doc comment for the full per-writer
  // breakdown. The actionGating.guard test enforces this entry stays in
  // lockstep with that set.
  "RECHARGE_TOPUP",
]);

/** Every FILTER_GROUPS option, flattened — the multi-select Type filter's
 *  full option list, and what `useTransactionRows.ts` matches the operator's
 *  selected labels against. Defined once here (rule 14) so the flat list
 *  used by the UI and the lookup used by the fetch/filter hook can never
 *  drift out of sync. */
export const ALL_FILTER_OPTIONS: FilterOption[] = FILTER_GROUPS.flatMap(
  (g) => g.options,
);

/** Service transactions that can (re)print a detailed receipt (RCP-3). POS
 *  sales reprint from Sale Detail; these are the service modules (T8). */
export const RECEIPTABLE_TYPES: ReadonlySet<string> = new Set([
  "FINANCIAL_SERVICE",
  "RECHARGE",
  "MAINTENANCE",
  "CUSTOM_SERVICE",
  "LOTO",
  // TELECOM_CREDIT_BUYBACK (Phase 6): the shop hands a customer cash — a
  // payout slip is as reasonable here as it is for the (already
  // receiptable) forward RECHARGE sale.
  "TELECOM_CREDIT_BUYBACK",
]);
