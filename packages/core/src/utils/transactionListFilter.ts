/**
 * LIRA-389 — the Audit & Transactions list's filter rule, defined ONCE
 * (rule 14) for the two places that need it:
 *
 *  - the list (`frontend/.../audit/hooks/useTransactionRows.ts`), which pages
 *    through `getRecent` and keeps the visible rows;
 *  - the Summary view (`services/TransactionSummaryService.ts`), which runs
 *    the same `getRecent` filters on the server and keeps the same rows.
 *
 * The rule has two halves. `buildTransactionListFilters` is the SQL half (what
 * `getRecent` is asked for). `isTransactionListRowVisible` is the per-row half
 * the SQL cannot express: the rule-26 auto-row hide (SUPPLIER_PAYMENT /
 * EXPENSE / WARRANTY_COST, revealed by a filter of that type), "Supplier
 * Credit", "Cash only (till)", and a mixed typed + untyped selection (which
 * drops the SQL type restriction entirely). Both moved here unchanged from
 * the list hook so the summary can never disagree with the list.
 *
 * Also here: the Summary view's group keys and labels that the list's
 * drill-down must reproduce row by row (`summaryModuleOf`,
 * `serviceTypeTitle`) — one function for both sides.
 *
 * Leaf module (rule 29): reachable from `browser.ts`; imports only constants
 * and pure utils.
 */
import {
  PAID_VIA_DRAWER_OWN_TUPLES,
  type PaidViaDrawer,
} from "../constants/paidViaDrawer.js";
import { PAID_VIA_ACCOUNT_OWN_TUPLES } from "../constants/paidViaAccount.js";
import { PAID_VIA_VOUCHER_OWN_TUPLES } from "../constants/paidViaVoucher.js";
import type { TransactionType } from "../constants/transactionTypes.js";
import {
  DEFAULT_HIDDEN_TRANSACTION_TYPES,
  isAutoRow,
} from "./transactionVisibility.js";
import { extraCurrencyLegs, isCashTransaction } from "./cashFlow.js";
import { transactionTitle } from "./transactionText.js";

/** One selected Type-filter option, as the server needs it (the page's
 *  FILTER_GROUPS entry minus its label). */
export interface TransactionListOption {
  /** Unified transaction type — omitted for an untyped option (Cash only). */
  type?: string;
  provider?: string;
  service_type?: string;
  has_item_key?: boolean;
  /** Keep only transactions with a physical-cash (CASH) payment leg. */
  cash_only?: boolean;
  /** Keep only the is_credit SUPPLIER_PAYMENT rows. */
  supplier_credit_only?: boolean;
  /** LIRA-323 — the option also shows rows paid through this wallet drawer. */
  paid_via_drawer?: PaidViaDrawer;
  /** The option also shows rows linked to a customer account. */
  paid_via_account?: boolean;
  /** LIRA-339 — the option also shows rows paid with a voucher. */
  paid_via_voucher?: boolean;
}

/** One `typeFilters` tuple as `getRecent` takes it. */
export interface TransactionListTypeTuple {
  type?: string;
  provider?: string;
  service_type?: string;
  has_item_key?: boolean;
  paid_via_drawer?: PaidViaDrawer;
  paid_via_account?: boolean;
  paid_via_voucher?: boolean;
}

/** The `getRecent` filters the list (and the summary) ask for. */
export interface TransactionListFilters {
  typeFilters?: TransactionListTypeTuple[];
  search?: string;
  day_from?: string;
  day_to?: string;
  excludeTypes: string[];
}

/** The leg shape the predicate reads (a subset of `TransactionPaymentLeg`). */
interface ListLeg {
  method: string;
  drawer_name?: string;
}

/** The row fields the predicate reads (a subset of a `getRecent` row). */
export interface TransactionListRow {
  type: string;
  metadata_json: string | null;
  payments?: ListLeg[];
  session_payments?: ListLeg[];
  paid_via_account?: boolean;
  paid_via_voucher?: boolean;
}

function parseMeta(
  metaJson: string | null | undefined,
): Record<string, unknown> {
  if (!metaJson) return {};
  try {
    const v = JSON.parse(metaJson) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * The SQL half. One tuple per selected option that HAS a type, OR'd by
 * `getRecent`. An UNTYPED option (Cash only) can match a row of any type, so
 * a selection mixing it with typed options sends no type restriction at all
 * and leaves the narrowing to `isTransactionListRowVisible`.
 */
export function buildTransactionListFilters(
  options: readonly TransactionListOption[],
  range: { search?: string; day_from?: string; day_to?: string },
): TransactionListFilters {
  const filters: TransactionListFilters = {
    // Always-hidden types excluded in SQL so LIMIT applies to visible rows.
    excludeTypes: [...DEFAULT_HIDDEN_TRANSACTION_TYPES],
  };
  const typeTuples: TransactionListTypeTuple[] = options
    .filter((o) => o.type)
    .map((o) => ({
      type: o.type,
      provider: o.provider,
      service_type: o.service_type,
      has_item_key: o.has_item_key,
      paid_via_drawer: o.paid_via_drawer,
      paid_via_account: o.paid_via_account,
      paid_via_voucher: o.paid_via_voucher,
    }));
  if (options.length > 0 && typeTuples.length === options.length) {
    filters.typeFilters = typeTuples;
  }
  if (range.search) filters.search = range.search;
  if (range.day_from) filters.day_from = range.day_from;
  if (range.day_to) filters.day_to = range.day_to;
  return filters;
}

/** Whether a row's type/provider/service_type/item_key matches one option's
 *  tuple — the twin of `getRecent`'s `buildTypeTupleConditions`. */
export function matchesListTypeTuple(
  row: Pick<TransactionListRow, "type" | "metadata_json">,
  option: Pick<
    TransactionListOption,
    "type" | "provider" | "service_type" | "has_item_key"
  >,
): boolean {
  if (!option.type) return true;
  if (option.type !== row.type) return false;
  const meta = parseMeta(row.metadata_json);
  if (option.provider !== undefined && meta.provider !== option.provider)
    return false;
  if (
    option.service_type !== undefined &&
    meta.service_type !== option.service_type
  ) {
    return false;
  }
  if (option.has_item_key === true && meta.item_key == null) return false;
  if (option.has_item_key === false && meta.item_key != null) return false;
  return true;
}

/** LIRA-323 twin of `getRecent`'s `buildPaidViaDrawerCondition`. */
function isPaidViaOptionDrawer(
  row: TransactionListRow,
  option: TransactionListOption,
): boolean {
  const drawer = option.paid_via_drawer;
  if (!drawer) return false;
  if (
    PAID_VIA_DRAWER_OWN_TUPLES[drawer].some((t) => matchesListTypeTuple(row, t))
  ) {
    return false;
  }
  return [...(row.payments ?? []), ...(row.session_payments ?? [])].some(
    (leg) => leg.drawer_name === drawer,
  );
}

/** Twin of `getRecent`'s `buildPaidViaAccountCondition` (server flag). */
function isPaidViaOptionAccount(
  row: TransactionListRow,
  option: TransactionListOption,
): boolean {
  if (!option.paid_via_account || row.paid_via_account !== true) return false;
  return !PAID_VIA_ACCOUNT_OWN_TUPLES.some((t) => matchesListTypeTuple(row, t));
}

/** Twin of `getRecent`'s paid-via-voucher route (LIRA-339). */
function isPaidViaOptionVoucher(
  row: TransactionListRow,
  option: TransactionListOption,
): boolean {
  if (!option.paid_via_voucher || row.paid_via_voucher !== true) return false;
  return !PAID_VIA_VOUCHER_OWN_TUPLES.some((t) => matchesListTypeTuple(row, t));
}

/**
 * D2 — a SUPPLIER_PAYMENT row under the given option (undefined = All types):
 * auto siblings hidden unless a SUPPLIER_PAYMENT option is selected;
 * "Supplier Credit" narrows to the is_credit rows.
 */
export function isSupplierPaymentVisible(
  metaJson: string | null | undefined,
  activeOption:
    | Pick<TransactionListOption, "type" | "supplier_credit_only">
    | undefined,
): boolean {
  if (activeOption?.type === "SUPPLIER_PAYMENT") {
    if (activeOption.supplier_credit_only) {
      return parseMeta(metaJson).is_credit === true;
    }
    return true;
  }
  return !isAutoRow(metaJson);
}

/** An EXPENSE row: auto rows hidden unless the "Expense" option is selected. */
export function isExpenseVisible(
  metaJson: string | null | undefined,
  activeOption: Pick<TransactionListOption, "type"> | undefined,
): boolean {
  if (activeOption?.type === "EXPENSE") return true;
  return !isAutoRow(metaJson);
}

/** LIRA-296 — a WARRANTY_COST row: same rule as EXPENSE. */
export function isWarrantyCostVisible(
  metaJson: string | null | undefined,
  activeOption: Pick<TransactionListOption, "type"> | undefined,
): boolean {
  if (activeOption?.type === "WARRANTY_COST") return true;
  return !isAutoRow(metaJson);
}

/** Every rule of ONE option, ANDed. */
function isRowVisibleForOption(
  row: TransactionListRow,
  option: TransactionListOption,
): boolean {
  if (
    !matchesListTypeTuple(row, option) &&
    !isPaidViaOptionDrawer(row, option) &&
    !isPaidViaOptionAccount(row, option) &&
    !isPaidViaOptionVoucher(row, option)
  ) {
    return false;
  }
  if (
    row.type === "SUPPLIER_PAYMENT" &&
    !isSupplierPaymentVisible(row.metadata_json, option)
  ) {
    return false;
  }
  if (row.type === "EXPENSE" && !isExpenseVisible(row.metadata_json, option))
    return false;
  if (
    row.type === "WARRANTY_COST" &&
    !isWarrantyCostVisible(row.metadata_json, option)
  ) {
    return false;
  }
  if (option.cash_only) {
    // The row's own legs, its session basket's pooled legs, and a drawer
    // top-up / cash-out's other-currency money (LIRA-201b).
    const legs = [
      ...(row.payments ?? []),
      ...(row.session_payments ?? []),
      ...extraCurrencyLegs(row.type, row.metadata_json),
    ];
    if (!isCashTransaction(legs)) return false;
  }
  return true;
}

/** "All types": one option with no constraint — the default-view rule. */
const ALL_TYPES_OPTION: TransactionListOption = {};

/**
 * The per-row half: visible when it matches ANY selected option's full rule
 * set (a UNION). Empty `options` = All types (auto rows hidden).
 */
export function isTransactionListRowVisible(
  row: TransactionListRow,
  options: readonly TransactionListOption[],
): boolean {
  if (DEFAULT_HIDDEN_TRANSACTION_TYPES.includes(row.type)) return false;
  const effective = options.length > 0 ? options : [ALL_TYPES_OPTION];
  return effective.some((opt) => isRowVisibleForOption(row, opt));
}

// ---------------------------------------------------------------------------
// Summary group keys (shared with the list's drill-down)
// ---------------------------------------------------------------------------

/** The Summary view's "Type" rows: one per module. */
export type SummaryModuleKey =
  | "sales"
  | "financial"
  | "telecom"
  | "exchange"
  | "loto"
  | "repairs"
  | "services"
  | "expenses"
  | "vouchers"
  | "holdMoney"
  | "debts"
  | "suppliers"
  | "partners"
  | "drawers"
  | "basket"
  | "discounts"
  | "refunds"
  | "clients";

/**
 * Every transaction type's module. Typed against core's own union, so a new
 * type is a compile error until it is placed here.
 */
export const SUMMARY_MODULE_OF: Readonly<
  Record<TransactionType, SummaryModuleKey>
> = {
  SALE: "sales",
  FINANCIAL_SERVICE: "financial",
  EXCHANGE: "exchange",
  WALLET_EXCHANGE: "exchange",
  TELECOM_SELF_CHARGE: "telecom",
  LINE_RECHARGE: "telecom",
  LINE_CREDIT_GIVE_BACK: "telecom",
  TELECOM_CREDIT_BUYBACK: "telecom",
  WRONG_NUMBER_CREDITS: "telecom",
  DRAWER_TRANSFER: "drawers",
  RECHARGE: "telecom",
  RECHARGE_TOPUP: "suppliers",
  MTC_TOPUP: "telecom",
  ALFA_TOPUP: "telecom",
  WALLET_CASHOUT: "drawers",
  CUSTOM_SERVICE: "services",
  MAINTENANCE: "repairs",
  LOTO: "loto",
  LOTO_CASH_PRIZE: "loto",
  LOTO_SETTLEMENT: "loto",
  LOTO_MONTHLY_FEE: "loto",
  EXPENSE: "expenses",
  EXPENSE_INVENTORY: "expenses",
  EXPENSE_KATSH: "expenses",
  EXPENSE_IPICK: "expenses",
  EXPENSE_WHISH_APP: "expenses",
  DRAWER_TOPUP: "drawers",
  DRAWER_CASHOUT: "drawers",
  HOLD_MONEY: "holdMoney",
  HOLD_MONEY_COLLECT: "holdMoney",
  HOLD_MONEY_COLLECT_VOID: "holdMoney",
  VOUCHER_SALE: "vouchers",
  VOUCHER_CANCEL: "vouchers",
  DEBT_REPAYMENT: "debts",
  CREDIT_CASH_OUT: "debts",
  CREDIT_CASH_IN: "debts",
  DEBT_CASH_OUT: "debts",
  KEPT_CHANGE: "basket",
  WAIVED_SHORTFALL: "basket",
  EXTRA_CHARGE: "basket",
  BASKET_DISCOUNT: "basket",
  SUPPLIER_PAYMENT: "suppliers",
  SUPPLIER_SETTLEMENT: "suppliers",
  PARTNER_SETTLEMENT: "partners",
  PARTNER_PAYMENT: "partners",
  PARTNER_ADJUSTMENT: "partners",
  COUNTERPARTY_DISCOUNT: "discounts",
  ACCOUNT_ADJUSTMENT: "debts",
  SUPPLIER_ADJUSTMENT: "suppliers",
  SUPPLIER_STOCK_INTAKE: "suppliers",
  SUPPLIER_RECORDED_DEBT: "suppliers",
  CHECKPOINT: "drawers",
  CARRIER_LINE_ADJUSTMENT: "telecom",
  WARRANTY_COST: "expenses",
  REFUND: "refunds",
  REFUND_UNDO: "refunds",
  CLIENT_CREATED: "clients",
  CLIENT_UPDATED: "clients",
  CLIENT_DELETED: "clients",
};

/** A row's module; an unknown (newer-backend) type reads as its own key. */
export function summaryModuleOf(type: string): string {
  return (
    (SUMMARY_MODULE_OF as Record<string, SummaryModuleKey | undefined>)[type] ??
    type
  );
}

/** Service-type words, in the same spelling `transactionTitle` already uses
 *  ("OMT App Send", "OMT App Recv", "Katsh Bill"). */
const SERVICE_WORDS: Readonly<Record<string, string>> = {
  SEND: "Send",
  RECEIVE: "Recv",
  BILL: "Bill",
};

function serviceWord(serviceType: string): string {
  return (
    SERVICE_WORDS[serviceType] ??
    serviceType
      .toLowerCase()
      .split("_")
      .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
      .join(" ")
  );
}

/**
 * The Summary view's "Service type" row name: the list's own Type column text
 * (`transactionTitle`), plus the service word when that text does not carry
 * it already — so OMT / Whish system sends and receives are separate rows
 * ("OMT System Send", "OMT System Recv") while "OMT App Send" stays as is.
 */
export function serviceTypeTitle(
  row: Pick<TransactionListRow, "type" | "metadata_json">,
): string {
  const title = transactionTitle(row);
  if (row.type !== "FINANCIAL_SERVICE") return title;
  const meta = parseMeta(row.metadata_json);
  const st = typeof meta.service_type === "string" ? meta.service_type : "";
  if (!st) return title;
  const word = serviceWord(st);
  if (title.toLowerCase().endsWith(` ${word.toLowerCase()}`)) return title;
  // Whish App bills carry their own title ("Whish App Bills").
  if (meta.item_key != null) return title;
  return `${title} ${word}`;
}

/** The Summary dimensions whose key is read off the transaction row itself
 *  (product / category rows come from sale lines). */
export type SummaryRowDimension = "type" | "service";

/** A row's group key in the Summary view — and the list drill-down's match
 *  for a clicked Summary row (one function for both). */
export function summaryGroupKeyOf(
  row: Pick<TransactionListRow, "type" | "metadata_json">,
  dimension: SummaryRowDimension,
): string {
  return dimension === "type"
    ? summaryModuleOf(row.type)
    : serviceTypeTitle(row);
}

/** English names of the Summary view's Type rows (the export uses them; the
 *  page shows the `audit:summary.modules.*` translation). */
export const SUMMARY_MODULE_LABELS: Readonly<Record<SummaryModuleKey, string>> =
  {
    sales: "Sales",
    financial: "Money transfers & bills",
    telecom: "MTC / Alfa",
    exchange: "Exchange",
    loto: "Loto",
    repairs: "Repairs",
    services: "Services",
    expenses: "Expenses",
    vouchers: "Vouchers",
    holdMoney: "Hold money",
    debts: "Debts & accounts",
    suppliers: "Suppliers",
    partners: "Partners",
    drawers: "Drawers",
    basket: "Session basket",
    discounts: "Discounts",
    refunds: "Refunds",
    clients: "Clients",
  };
