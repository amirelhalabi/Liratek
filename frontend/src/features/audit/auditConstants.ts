// Shared audit/transaction constants.
//
// These live in a non-component module so they can be imported by both the
// AuditLogViewer/TransactionsViewer pages and AuditPage without tripping the
// react-refresh/only-export-components lint rule (which forbids a component
// file from also exporting non-component values).

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
 *  Manual rows (no key at all) and unparsable/missing metadata read as
 *  `false` — the safe default is "visible", not "hidden". */
export function isAutoSupplierPayment(
  metaJson: string | null | undefined,
): boolean {
  return parseMetaSafe(metaJson).is_auto === true;
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

export const FILTER_GROUPS: { group: string; options: FilterOption[] }[] = [
  {
    group: "Cash",
    options: [
      // B6: "what touched the till?" — transactions with a CASH payment leg
      // (CASH legs post to the General drawer). Filtered client-side.
      { label: "Cash only (till)", cash_only: true },
    ],
  },
  {
    group: "Financial — System",
    options: [
      { label: "OMT System", type: "FINANCIAL_SERVICE", provider: "OMT" },
      { label: "Whish System", type: "FINANCIAL_SERVICE", provider: "WHISH" },
    ],
  },
  {
    group: "Financial — App",
    options: [
      {
        label: "OMT App Send",
        type: "FINANCIAL_SERVICE",
        provider: "OMT_APP",
        service_type: "SEND",
      },
      {
        label: "OMT App Recv",
        type: "FINANCIAL_SERVICE",
        provider: "OMT_APP",
        service_type: "RECEIVE",
      },
      {
        label: "Whish App Send",
        type: "FINANCIAL_SERVICE",
        provider: "WHISH_APP",
        service_type: "SEND",
        has_item_key: false,
      },
      {
        label: "Whish App Recv",
        type: "FINANCIAL_SERVICE",
        provider: "WHISH_APP",
        service_type: "RECEIVE",
        has_item_key: false,
      },
      {
        label: "Whish App Bills",
        type: "FINANCIAL_SERVICE",
        provider: "WHISH_APP",
        has_item_key: true,
      },
      { label: "iPick", type: "FINANCIAL_SERVICE", provider: "iPick" },
      { label: "Katsh", type: "FINANCIAL_SERVICE", provider: "Katsh" },
      {
        label: "Binance Send",
        type: "FINANCIAL_SERVICE",
        provider: "BINANCE",
        service_type: "SEND",
      },
      {
        label: "Binance Recv",
        type: "FINANCIAL_SERVICE",
        provider: "BINANCE",
        service_type: "RECEIVE",
      },
    ],
  },
  {
    group: "Recharge",
    options: [
      { label: "MTC", type: "RECHARGE", provider: "MTC" },
      { label: "Alfa", type: "RECHARGE", provider: "Alfa" },
    ],
  },
  {
    group: "Top-ups",
    options: [
      { label: "MTC Top-up", type: "MTC_TOPUP" },
      { label: "Alfa Top-up", type: "ALFA_TOPUP" },
      { label: "iPick Top-up", type: "RECHARGE_TOPUP", provider: "iPick" },
      { label: "Katsh Top-up", type: "RECHARGE_TOPUP", provider: "Katsh" },
      {
        label: "Whish App Top-up",
        type: "RECHARGE_TOPUP",
        provider: "WHISH_APP",
      },
      { label: "OMT App Top-up", type: "RECHARGE_TOPUP", provider: "OMT_APP" },
      {
        label: "OMT System Top-up",
        type: "RECHARGE_TOPUP",
        provider: "OMT_SYSTEM",
      },
      {
        label: "Whish System Top-up",
        type: "RECHARGE_TOPUP",
        provider: "WHISH_SYSTEM",
      },
      { label: "General Top-up", type: "DRAWER_TOPUP" },
    ],
  },
  {
    group: "Loto",
    options: [
      { label: "Loto", type: "LOTO" },
      { label: "Loto Prize", type: "LOTO_CASH_PRIZE" },
      { label: "Loto Monthly Fee", type: "LOTO_MONTHLY_FEE" },
      { label: "Loto Settlement", type: "LOTO_SETTLEMENT" },
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
      { label: "Supplier Settlement", type: "SUPPLIER_SETTLEMENT" },
      { label: "Supplier Payment", type: "SUPPLIER_PAYMENT" },
      {
        label: "Supplier Credit",
        type: "SUPPLIER_PAYMENT",
        supplier_credit_only: true,
      },
      // LIRA-080: the paper (no-cash) "Add Credit / Debt" entry — manual, so
      // visible by default (no is_auto flag involved), same as Partner
      // Adjustment.
      { label: "Supplier Adjustment", type: "SUPPLIER_ADJUSTMENT" },
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
      { label: "Partner Settlement", type: "PARTNER_SETTLEMENT" },
      { label: "Partner Payment", type: "PARTNER_PAYMENT" },
      { label: "Partner Adjustment", type: "PARTNER_ADJUSTMENT" },
    ],
  },
  {
    group: "Other",
    options: [
      { label: "Sale", type: "SALE" },
      { label: "Exchange", type: "EXCHANGE" },
      { label: "Custom Service", type: "CUSTOM_SERVICE" },
      { label: "Maintenance", type: "MAINTENANCE" },
      { label: "Expense", type: "EXPENSE" },
      { label: "Debt Repayment", type: "DEBT_REPAYMENT" },
      // LIRA-080: the paper (no-cash) Accounts-page "Add Credit / Debt" entry.
      // Its cash-moved siblings (CREDIT_CASH_IN/DEBT_CASH_OUT) have no filter
      // entry; the paper rows are the ones an operator most needs to find.
      { label: "Account Adjustment", type: "ACCOUNT_ADJUSTMENT" },
      // CQ-10: one type spans all three counterparty kinds (debt/supplier/
      // partner) — amounts are always 0 (the value lives in signed
      // profit_usd/lbp), no dedicated group needed for a single filter.
      { label: "Discount", type: "COUNTERPARTY_DISCOUNT" },
      { label: "Checkpoint", type: "CHECKPOINT" },
      { label: "Refund", type: "REFUND" },
      { label: "Client Updated", type: "CLIENT_UPDATED" },
      { label: "Client Deleted", type: "CLIENT_DELETED" },
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
  "RECHARGE",
  "CUSTOM_SERVICE",
  "MAINTENANCE",
  "EXPENSE",
  "DEBT_REPAYMENT",
  "SUPPLIER_PAYMENT",
]);

/** Service transactions that can (re)print a detailed receipt (RCP-3). POS
 *  sales reprint from Sale Detail; these are the service modules (T8). */
export const RECEIPTABLE_TYPES: ReadonlySet<string> = new Set([
  "FINANCIAL_SERVICE",
  "RECHARGE",
  "MAINTENANCE",
  "CUSTOM_SERVICE",
  "LOTO",
]);
