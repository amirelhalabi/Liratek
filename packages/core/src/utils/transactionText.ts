/**
 * LIRA-301 — how a transaction is DESCRIBED in words, shared by every screen
 * that lists transactions: the web/desktop Transactions table and the phone
 * app's Activity and "since the last count" lists. One copy (rule 14), so a
 * row reads the same everywhere and a new provider or transaction type is
 * one entry here, not one per app.
 *
 * Pure and dependency-free apart from a type import, so it is safe in the
 * browser bundle and on the phone (rule 29). Colours and styling stay with
 * each app; only text lives here.
 *
 * The stored `transactions.summary` stays the audit text written at booking
 * time. Titles are worked out from the row's `type` and metadata on display,
 * so renaming a provider reaches every past row too.
 */
import type { TransactionType } from "../constants/transactionTypes.js";

/** The fields of a transaction row the wording reads. */
export interface TransactionTextRow {
  type: string;
  summary: string | null;
  metadata_json: string | null;
  amount_usd: number;
  amount_lbp: number;
}

/**
 * Provider code → name shown to shop staff. A new service (a wallet, a
 * voucher provider) is added here once and every list names it correctly.
 */
export const PROVIDER_LABELS: Record<string, string> = {
  // OMT / WHISH: the classic FINANCIAL_SERVICE provider (SEND/RECEIVE run on
  // that system), as opposed to the app wallet below — unaffected by the
  // Primary Cash Drawer relabel.
  OMT: "OMT System",
  WHISH: "Whish System",
  OMT_APP: "OMT App",
  WHISH_APP: "Whish App",
  // OMT_SYSTEM / WHISH_SYSTEM: the RECHARGE_TOPUP provider that tops up the
  // OMT_System/Whish_System drawer — under the Primary Cash Drawer model that
  // drawer is the physical cash till, so the label follows the "Cash Drawer"
  // wording used elsewhere.
  OMT_SYSTEM: "OMT Cash Drawer",
  WHISH_SYSTEM: "Whish Cash Drawer",
  iPick: "iPick",
  Katsh: "Katsh",
  BINANCE: "Binance",
  MTC: "MTC",
  Alfa: "Alfa",
};

/** Recharge subtype → label ("Credits", "Days", …). */
export const RECHARGE_SUBTYPE_LABELS: Record<string, string> = {
  CREDIT_TRANSFER: "Credits",
  VOUCHER: "Voucher",
  DAYS: "Days",
  TOP_UP: "Top-up",
  ALFA_GIFT: "Gift",
  CREDIT_BUYBACK: "Credit Buy-back",
  // Owner note #21, case 2 (migration v182): shop-line checkbox unticked —
  // the customer used the shop's own line for a call.
  SHOP_LINE_USE: "Shop Line Use",
};

/**
 * Fixed title per transaction type. `null` = no fixed title: it is derived
 * from the row's metadata (see transactionTitle) or falls back to the
 * humanised type ("DEBT_REPAYMENT" → "DEBT REPAYMENT"). Typed against core's
 * own union, so a new type is a compile error until it is decided here.
 */
export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string | null> = {
  SALE: null,
  FINANCIAL_SERVICE: null,
  EXCHANGE: null,
  WALLET_EXCHANGE: null,
  TELECOM_SELF_CHARGE: null,
  TELECOM_CREDIT_BUYBACK: null,
  DRAWER_TRANSFER: null,
  RECHARGE: null,
  CARRIER_LINE_ADJUSTMENT: "Line Adjustment",
  RECHARGE_TOPUP: null,
  WALLET_CASHOUT: "OMT App Cash-Out",
  MTC_TOPUP: "MTC Top-up",
  ALFA_TOPUP: "Alfa Top-up",
  CUSTOM_SERVICE: null,
  MAINTENANCE: null,
  LOTO: "Loto",
  LOTO_CASH_PRIZE: "Loto Prize",
  LOTO_SETTLEMENT: "Loto Settlement",
  LOTO_MONTHLY_FEE: "Loto Monthly Fee",
  EXPENSE: null,
  EXPENSE_INVENTORY: "Expense · Stock",
  EXPENSE_KATSH: "Expense · Katsh",
  EXPENSE_IPICK: "Expense · iPick",
  EXPENSE_WHISH_APP: "Expense · Whish App",
  DRAWER_TOPUP: "General Top-up",
  DRAWER_CASHOUT: "General Cash-Out",
  HOLD_MONEY: "Money Held",
  HOLD_MONEY_COLLECT: "Hold Returned",
  HOLD_MONEY_COLLECT_VOID: "Hold Pickup Voided",
  DEBT_REPAYMENT: null,
  CREDIT_CASH_OUT: null,
  CREDIT_CASH_IN: "Account Credit",
  DEBT_CASH_OUT: "Cash Advance",
  KEPT_CHANGE: null,
  WARRANTY_COST: "Warranty Cost",
  SUPPLIER_PAYMENT: null,
  SUPPLIER_SETTLEMENT: "Supplier Settlement",
  PARTNER_SETTLEMENT: "Partner Settlement",
  PARTNER_PAYMENT: "Partner Payment",
  PARTNER_ADJUSTMENT: "Partner Adjustment",
  ACCOUNT_ADJUSTMENT: "Account Adjustment",
  SUPPLIER_ADJUSTMENT: "Supplier Adjustment",
  SUPPLIER_STOCK_INTAKE: "Stock Received",
  SUPPLIER_RECORDED_DEBT: "Supplier Debt Recorded",
  COUNTERPARTY_DISCOUNT: "Discount",
  CHECKPOINT: "Checkpoint",
  REFUND: null,
  REFUND_UNDO: "Undo Refund",
  CLIENT_CREATED: null,
  CLIENT_UPDATED: null,
  CLIENT_DELETED: null,
};

/** Row metadata; `null` when it is not valid JSON or is JSON `null` (then only the per-type label applies). */
function parseMeta(json: string | null): Record<string, unknown> | null {
  try {
    const m: unknown = JSON.parse(json ?? "{}");
    // A JSON `null` has no fields to read: treated like unparsable metadata.
    if (m === null) return null;
    return typeof m === "object" ? (m as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

/** The title of a row: "Whish App Send", "Katsh Bill", "MTC Credits", "Loto"… */
export function transactionTitle(row: Pick<TransactionTextRow, "type" | "metadata_json">): string {
  const meta = parseMeta(row.metadata_json);
  if (meta) {
    const derived = titleFromMetadata(row.type, meta);
    if (derived) return derived;
  }
  return (
    (TRANSACTION_TYPE_LABELS as Record<string, string | null>)[row.type] ?? row.type.replace(/_/g, " ")
  );
}

/** Titles that depend on the row's provider / service type / drawer; `null` = no metadata-derived title. */
function titleFromMetadata(type: string, meta: Record<string, unknown>): string | null {
  const p = meta.provider as string | undefined;
  const st = meta.service_type as string | undefined;
  const ik = meta.item_key;

  if (type === "FINANCIAL_SERVICE") {
    const base = (p && PROVIDER_LABELS[p]) ?? "Financial Service";
    if (p === "OMT_APP" || p === "BINANCE" || (p === "WHISH_APP" && !ik)) {
      if (st === "SEND") return `${base} Send`;
      if (st === "RECEIVE") return `${base} Recv`;
    }
    if (p === "WHISH_APP" && ik) return "Whish App Bills";
    if ((p === "iPick" || p === "Katsh") && st === "BILL") return `${base} Bill`;
    return base;
  }

  if (type === "RECHARGE") {
    const provLabel = (p && PROVIDER_LABELS[p]) ?? p ?? "Recharge";
    const subLabel = (meta.type && RECHARGE_SUBTYPE_LABELS[meta.type as string]) ?? "";
    return subLabel ? `${provLabel} ${subLabel}` : provLabel;
  }

  if (type === "RECHARGE_TOPUP") {
    const provLabel = (p && PROVIDER_LABELS[p]) ?? p ?? "Recharge";
    return `${provLabel} Top-up`;
  }

  if (type === "WALLET_EXCHANGE") {
    const drawerName = meta.drawer_name as string | undefined;
    const drawerLabel = drawerName === "Whish_App" ? "Whish App" : drawerName === "OMT_App" ? "OMT App" : "Wallet";
    return `${drawerLabel} Exchange`;
  }

  // A cashless supplier credit (e.g. bill commission) — distinct from a real
  // "Supplier Payment" (cash we pay them / they pay us).
  if (type === "SUPPLIER_PAYMENT" && meta.is_credit === true) return "Supplier Credit";

  if (type === "CHECKPOINT") {
    const notes = meta.notes as string | undefined;
    if (notes && (notes.toLowerCase().includes("initial") || notes.toLowerCase().includes("setup"))) {
      return "Initial Setup";
    }
  }
  return null;
}

/** "$5.00" / "450,000 LBP" — two decimals for USD so cents read as cents. */
export function formatCashMoney(amount: number, currency: string): string {
  return currency === "USD"
    ? `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${amount.toLocaleString()} ${currency}`;
}

/** Summary prefixes the void/refund paths prepend — kept when a summary is re-worded for display. */
const REVERSAL_SUMMARY_PREFIXES = ["VOID: ", "REFUND: "] as const;

/**
 * The summary line to SHOW for a row — the stored summary, except for a
 * supplier TOP_UP ledger row, which is stored with the raw entry code
 * ("Supplier TOP_UP: $-100 + 0 LBP"). The sign is the meaning ("+" = the shop
 * owes the supplier more, "−" = less), so it reads "Owed to OMT reduced by
 * $100.00". Display only — the stored summary, and search over it, are
 * unchanged.
 */
export function transactionSummary(row: TransactionTextRow): string | null {
  if (row.type !== "SUPPLIER_PAYMENT" || !row.metadata_json) return row.summary;
  try {
    const m = JSON.parse(row.metadata_json) as {
      entry_type?: unknown;
      is_credit?: unknown;
      counterparty?: { name?: unknown } | null;
    };
    if (m.entry_type !== "TOP_UP" || m.is_credit === true) return row.summary;
    const signed = row.amount_usd || row.amount_lbp;
    if (!signed) return row.summary;
    const name = typeof m.counterparty?.name === "string" && m.counterparty.name ? m.counterparty.name : "supplier";
    const amounts: string[] = [];
    if (row.amount_usd) amounts.push(formatCashMoney(Math.abs(row.amount_usd), "USD"));
    if (row.amount_lbp) amounts.push(formatCashMoney(Math.abs(row.amount_lbp), "LBP"));
    const prefix = REVERSAL_SUMMARY_PREFIXES.find((p) => row.summary?.startsWith(p)) ?? "";
    return `${prefix}Owed to ${name} ${signed > 0 ? "increased" : "reduced"} by ${amounts.join(" + ")}`;
  } catch {
    return row.summary;
  }
}
