/**
 * Transaction Repository
 *
 * Provides the unified accounting journal for all financial operations.
 * Every module creates a `transactions` row as the canonical record of
 * "something happened." Downstream tables (payments, debt_ledger, etc.)
 * link back via `transaction_id` / `unified_transaction_id`.
 *
 * Key concepts:
 * - **Void**: Sets original status to VOIDED, creates reversal row with
 *   negated amounts and `reverses_id` pointing to the original.
 *   Reverses drawer balances, restores stock, and cancels debt.
 * - **Refund**: Creates a REFUND row with `reverses_id` pointing to the
 *   original. Original stays ACTIVE.
 *   Reverses drawer balances, restores stock, and cancels debt.
 * - **Exchange rate**: Immutable snapshot captured at creation time.
 */

import {
  MODULE_DEBT_TRANSACTION_TYPES,
  NON_REVERSIBLE_TRANSACTION_TYPES,
  type TransactionStatus,
  type TransactionType,
} from "../constants/transactionTypes.js";
import { BaseRepository, type BaseEntity } from "./BaseRepository.js";
import { getRateRepository } from "./RateRepository.js";
import { DatabaseError, NotFoundError } from "../utils/errors.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { applyDrawerDelta, insertPaymentRow } from "./moneyPosting.js";
import { allocateFifo } from "../utils/fifoCoverage.js";
import {
  isDrawerAffectingMethod,
  paymentMethodToDrawerName,
  resolveServiceCashDrawer,
  type BaseSystem,
  type ServiceCashDrawerContext,
} from "../utils/payments.js";
import { getPaymentMethodRepository } from "./PaymentMethodRepository.js";
import { getCarrierLineMovementRepository } from "./CarrierLineMovementRepository.js";
import { getCarrierLineService } from "../services/CarrierLineService.js";
import { isPendingSupplierSettlement } from "./FinancialServiceRepository.js";

// A `debt_ledger` row represents an on-account CHARGE (customer paid via their
// account) that should surface a "Customer Account" method leg — EXCEPT
// 'Refund Reversal' rows, which cancel debt and belong to a refund/void
// transaction that already shows its own real method. Defined once and reused
// by every account-leg reconstruction query (rule 14).
const ACCOUNT_CHARGE_PREDICATE = "transaction_type <> 'Refund Reversal'";

// LIRA-115: the `payments.note` stamped on a session basket's pooled-leg
// reversal (`_reverseSessionPooledPayments`) — reused (rule 14) both to write
// the row and to detect "this basket's pooled cash was already reversed"
// (`_assertSessionBasketReversible`), so the two never drift out of sync.
const SESSION_BASKET_REVERSAL_NOTE = "Basket reversal";

// =============================================================================
// Types
// =============================================================================

export interface TransactionEntity extends BaseEntity {
  type: TransactionType;
  status: TransactionStatus;
  source_table: string;
  source_id: number;
  user_id: number;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  exchange_rate: number | null;
  client_id: number | null;
  client_name: string | null;
  client_phone: string | null;
  reverses_id: number | null;
  summary: string | null;
  metadata_json: string | null;
  device_id: string | null;
  created_at: string;
}

export interface PaymentRow {
  id: number;
  method: string;
  drawer_name: string;
  currency_code: string;
  amount: number;
  note: string | null;
  created_at: string;
}

/**
 * A single structured payment leg for a transaction (LIRA-064).
 *
 * `direction` describes cash flow from the shop's perspective:
 * - `"in"`  — money the customer paid the shop (positive payment amount)
 * - `"out"` — money the shop returned/disbursed (negative payment amount,
 *   e.g. change given, exchange payout, reversal leg)
 *
 * `amount` is always the absolute value; the sign lives in `direction` so the
 * frontend can render `in: ... · out: ...` without re-deriving signs. The raw
 * signed value is preserved in `signed_amount` for any future aggregation.
 *
 * This shape is intentionally self-describing so a future expandable detail
 * row (LIRA-067) can consume the same field with no backend changes.
 */
export interface TransactionPaymentLeg {
  direction: "in" | "out";
  amount: number;
  signed_amount: number;
  currency_code: string;
  method: string;
}

/**
 * The `payments` table is an internal multi-leg ledger: alongside real customer
 * payments and change/returns it also stores provider/system drawer movements
 * (e.g. the Binance USDT crypto leg, cost-flow provider cost legs, and
 * fee/transfer reporting rows). The LIRA-064 in/out summary must surface ONLY
 * customer-facing cash — so these internal legs are filtered out. Identifiers
 * below mark legs that are NOT customer cash. NOTE (Primary Cash Drawer plan
 * §2#4): OMT_System/Whish_System are EXCLUDED from that internal set as of
 * this feature — they are the physical primary cash drawer (PCD) now, not a
 * provider-side float, so their legs ARE customer cash and must stay visible.
 */
// Marker methods used for internal (non-customer) ledger rows.
const INTERNAL_LEG_METHODS = new Set([
  "COMMISSION", // reporting-only fee row (zero delta)
  "PM_FEE", // payment-method fee audit row
  "TRANSFER", // shop→system drawer transfer leg
  // Primary Cash Drawer plan §8.6: both legs of a General↔cash-drawer transfer
  // are the shop moving its OWN money between two of its own drawers — never
  // customer cash. This entry is load-bearing now that the `_System`
  // drawer-name exclusion above is gone: without it BOTH legs of every
  // transfer would leak into the D1 cash-flow report and the in/out summary.
  "DRAWER_TRANSFER",
  "RESERVE", // cash reserved out of General/wallet for provider settlement (SEND / debt repayment)
  "OMT_APP", // shop-wallet side of an app transfer (customer cash side stays visible)
  "WHISH_APP", // shop-wallet side of an app transfer (customer cash side stays visible)
  "CREDIT_RETURN", // returned telecom credits to a provider drawer
  "CREDIT_USED", // on-account charge (also lives in debt_ledger)
  "SMS_COST", // telecom SMS cost consumed from the provider stock drawer
]);
// Provider stock / reserve drawers — value the SHOP holds with a provider
// (telecom credit stock, app balance), never customer cash. Customer WALLET
// drawers (Whish_App / OMT_App) are intentionally NOT here: a customer paying
// via that method is real customer cash and must stay in the summary.
// OMT_System / Whish_System are ALSO intentionally NOT here (Primary Cash
// Drawer plan §2#4) — they are the primary cash drawer (PCD), real
// customer-facing cash, not a provider stock/reserve drawer.
const PROVIDER_STOCK_DRAWERS = new Set(["MTC", "Alfa", "Katsh", "iPick"]);
// Customer cash is always denominated in one of these; USDT/crypto legs are internal.
const CUSTOMER_CASH_CURRENCIES = new Set(["USD", "LBP"]);

/**
 * ONE definition of "customer-facing cash leg" (rule 14). The JS predicate is
 * used by the per-row leg attachment (toLeg); the SQL builder mirrors it from
 * the SAME constant sets for aggregate queries (D1 cash-flow report). Change
 * the rule here, in both forms, or the report and the in/out column diverge.
 */
function isInternalLegJs(p: {
  method: string;
  drawer_name: string;
  currency_code: string;
  amount: number;
  note: string | null;
}): boolean {
  const note = p.note ?? "";
  return (
    p.amount === 0 || // reporting-only row (e.g. COMMISSION, zero delta)
    INTERNAL_LEG_METHODS.has(p.method) || // fee / transfer / credit / SMS markers
    PROVIDER_STOCK_DRAWERS.has(p.drawer_name) || // MTC/Alfa/Katsh/iPick stock
    // Primary Cash Drawer plan §2#4 (docs/plans/todo_plans/PRIMARY_CASH_DRAWER_PLAN.md):
    // OMT_System/Whish_System are no longer an internal provider-side float —
    // they ARE the physical cash drawer at the money-transfer counter, so a
    // leg posted there is real customer cash and must NOT be filtered out
    // here. The `endsWith("_System")` exclusion that used to live on this
    // line is deleted (rule 14 pair with customerCashLegSql below — change
    // both or neither).
    !CUSTOMER_CASH_CURRENCIES.has(p.currency_code) || // USDT / crypto leg
    note.startsWith("Cost:") || // cost/price-flow provider cost outflow
    note.endsWith("(cost outflow)") || // custom-service hidden cost outflow
    note.startsWith("Crypto ") // Binance crypto sent/received leg
  );
}

/** SQL mirror of isInternalLegJs, negated (keeps customer-cash legs). Values
 *  come from module constants, never user input. */
function customerCashLegSql(a: string): string {
  const methods = [...INTERNAL_LEG_METHODS].map((m) => `'${m}'`).join(", ");
  const drawers = [...PROVIDER_STOCK_DRAWERS].map((d) => `'${d}'`).join(", ");
  const currencies = [...CUSTOMER_CASH_CURRENCIES]
    .map((c) => `'${c}'`)
    .join(", ");
  // Primary Cash Drawer plan §2#4: the `NOT LIKE '%\_System'` exclusion that
  // used to sit here is deleted in lockstep with isInternalLegJs above (rule
  // 14) — OMT_System/Whish_System legs are customer-facing cash now.
  return `${a}.amount != 0
      AND ${a}.method NOT IN (${methods})
      AND ${a}.drawer_name NOT IN (${drawers})
      AND ${a}.currency_code IN (${currencies})
      AND COALESCE(${a}.note, '') NOT LIKE 'Cost:%'
      AND COALESCE(${a}.note, '') NOT LIKE '%(cost outflow)'
      AND COALESCE(${a}.note, '') NOT LIKE 'Crypto %'`;
}

/**
 * LIRA-078 (refund tender-selection modal): a payments row is eligible to be
 * REPLACED by the operator's chosen return method — instead of mirrored
 * verbatim — only when it is BOTH customer-facing (`!isInternalLegJs`, the
 * same rule the LIRA-064 in/out summary and `getCustomerFacingLegs` use) AND
 * itself drawer-affecting (`isDrawerAffectingMethod`). The second condition is
 * belt-and-suspenders: every existing repository already gates
 * `insertPaymentRow` on `isDrawerAffectingMethod` (CUSTOMER_ACCOUNT/GIFT_CARD
 * never reach the `payments` table today), so in practice `!isInternalLegJs`
 * alone already excludes them — but requiring both here means a future call
 * site that regresses that gate still can't leak a non-drawer leg into the
 * override's replace-set; it would just keep mirroring harmlessly (rule 14:
 * ONE predicate, reused by both the validation net and the `_reversePayments`
 * skip-set below, never copy-pasted).
 */
function isOverridableLeg(p: {
  method: string;
  drawer_name: string;
  currency_code: string;
  amount: number;
  note: string | null;
}): boolean {
  return !isInternalLegJs(p) && isDrawerAffectingMethod(p.method);
}

/**
 * Operator-chosen return method for ONE currency of a refund (LIRA-078). The
 * money contract is METHOD-OVERRIDE ONLY: `amount`/`currencyCode` together
 * must reproduce the original transaction's own net customer-facing total for
 * that currency (see `_validateRefundLegOverride`) — the operator picks which
 * drawer the money leaves from, never the amount or the currency. Multiple
 * entries for the same currency are allowed (a split return, e.g. part CASH +
 * part OMT) as long as they sum correctly.
 */
export interface RefundLegOverride {
  /** A payment method code (payment_methods.code) — must be active and
   *  drawer-affecting (CUSTOMER_ACCOUNT/GIFT_CARD rejected). */
  method: string;
  /** "USD" or "LBP" — cross-currency refunds are out of scope (see the
   *  money contract doc on `refundTransaction`). */
  currencyCode: string;
  /** Absolute amount returned via this method, in `currencyCode`. */
  amount: number;
}

/** One row of the D1 currency in/out by-date report. */
export interface CashFlowByDateRow {
  /** Business date (YYYY-MM-DD): transaction_time when set, else created_at. */
  date: string;
  currency_code: string;
  total_in: number;
  total_out: number;
}

export interface CreateTransactionInput {
  type: TransactionType;
  source_table: string;
  source_id: number;
  user_id: number;
  /** Denominated value of the transaction, NOT the tender (legs carry tender).
   *  Required: a row with no stated amount is unreadable in every report. */
  amount_usd: number;
  amount_lbp: number;
  profit_usd?: number;
  profit_lbp?: number;
  /** USD↔LBP rate stamp. Omit to snapshot the current market rate; pass an
   *  explicit null only to opt out of a rate stamp entirely. */
  exchange_rate?: number | null;
  client_id?: number | null;
  client_name?: string | null;
  /** Requires client_name — a bare phone number is never a valid identity. */
  client_phone?: string | null;
  /** Required, non-blank: the human-readable row label in the transactions table. */
  summary: string;
  /** Required: flow-specific facts (provider, service_type, item_key, …) that
   *  filters and receipts read. Pass {} only if the flow truly has none. */
  metadata_json: Record<string, unknown>;
  device_id?: string;
  transaction_time?: string;
}

export interface TransactionFilters {
  type?: TransactionType;
  status?: TransactionStatus;
  user_id?: number;
  client_id?: number;
  source_table?: string;
  from?: string;
  to?: string;
  provider?: string;
  service_type?: string;
  has_item_key?: boolean;
  search?: string;
  /** Types to exclude from the result, applied before LIMIT (see getRecent). */
  excludeTypes?: TransactionType[];
}

export interface DailySummary {
  date: string;
  total_usd: number;
  total_lbp: number;
  by_type: Array<{
    type: string;
    count: number;
    total_usd: number;
    total_lbp: number;
  }>;
  void_count: number;
  void_usd: number;
  void_lbp: number;
}

export interface TransactionWithUser extends TransactionEntity {
  username: string;
  client_name: string | null;
  /**
   * The customer session this transaction belongs to (basket payment), or null.
   * Resolved via customer_session_transactions.unified_transaction_id = t.id.
   * Used by the viewer to group same-session rows and attach basket legs.
   */
  session_id: number | null;
  /**
   * The id of the ACTIVE REFUND row whose `reverses_id` points back at this
   * row, or null if this row has never been refunded (note 21d). Computed
   * via a correlated subquery over `reverses_id` (indexed —
   * idx_transactions_reverses) so the Transactions viewer can gate
   * Void/Refund WITHOUT needing that REFUND row loaded on the same
   * page/filter window: refundTransaction() deliberately leaves the
   * ORIGINAL row status=ACTIVE (so SALE/module + REFUND profit nets to
   * zero — see `_markSourceRefunded`), so `status`/`reverses_id` alone
   * can never reveal "this was refunded" on the original row. Mirrors
   * refundTransaction's own double-refund guard exactly (`reverses_id = id
   * AND type = 'REFUND'`, no status filter needed — a REFUND row's
   * `reverses_id` is always set, so `_assertReversible` already forbids it
   * from ever being voided/refunded itself, meaning it can never end up
   * non-ACTIVE).
   */
  reversed_by_id: number | null;
  /**
   * Structured in/out payment legs joined from the `payments` table (LIRA-064).
   * Computed read-only; never persisted into the stored `summary` text.
   * For session rows with no own customer-cash legs, the session's basket legs
   * are attached instead (same legs on every row in that session).
   */
  payments: TransactionPaymentLeg[];
  /**
   * CUSTOMER_ACCOUNT (on-account) legs of a session basket, sourced from
   * `debt_ledger` rather than `payments` — a CUSTOMER_ACCOUNT settlement never
   * touches a drawer, so `SessionPaymentService.recordBasketPayment` deliberately
   * skips writing a `payments` row for it (see that file's non-drawer branch).
   * Kept SEPARATE from `payments` (rather than merged in) so the cash-only
   * `in:/out:` summary keeps its existing meaning; only method-display code
   * should read this field. Same session-wide attachment as basket legs.
   */
  account_payments?: TransactionPaymentLeg[];
}

export interface DebtAgingBuckets {
  client_id: number;
  current: { usd: number; lbp: number };
  days_31_60: { usd: number; lbp: number };
  days_61_90: { usd: number; lbp: number };
  over_90: { usd: number; lbp: number };
}

export interface OverdueDebtEntry {
  client_id: number;
  client_name: string;
  phone_number: string | null;
  total_usd: number;
  total_lbp: number;
  oldest_due_date: string;
  max_days_overdue: number;
  entry_count: number;
}

/**
 * Result of `voidCheckoutGroup` — CARRIER_LEGS_VOID_ASYMMETRY.md (design B+).
 */
export interface VoidCheckoutGroupResult {
  groupId: string;
  /** Total members found for this group (voided + already-voided-and-skipped). */
  memberCount: number;
  /** Original transaction ids that were voided by THIS call (excludes any
   *  already VOIDED before the call). */
  voidedTransactionIds: number[];
  /** Reversal transaction ids created, one per entry in voidedTransactionIds. */
  reversalIds: number[];
}

/**
 * Result of `voidSessionBasket` / `refundSessionBasket` (LIRA-115) — the
 * basket-level reversal option (a) routes to, mirroring
 * `VoidCheckoutGroupResult`'s shape for the split_group precedent (rule 14).
 */
export interface SessionBasketReversalResult {
  sessionId: number;
  /** Total items found linked to this session basket (reversed + any
   *  already-voided/refunded-and-skipped). */
  itemCount: number;
  /** Original item transaction ids reversed by THIS call (excludes any
   *  already VOIDED/refunded before the call). */
  reversedTransactionIds: number[];
  /** Reversal (VOID or REFUND) transaction ids created, one per entry in
   *  reversedTransactionIds. */
  reversalIds: number[];
}

// =============================================================================
// Repository
// =============================================================================

export class TransactionRepository extends BaseRepository<TransactionEntity> {
  constructor() {
    super("transactions");
  }

  protected getColumns(): string {
    return [
      "id",
      "type",
      "status",
      "source_table",
      "source_id",
      "user_id",
      "amount_usd",
      "amount_lbp",
      "profit_usd",
      "profit_lbp",
      "exchange_rate",
      "client_id",
      "client_name",
      "client_phone",
      "reverses_id",
      "summary",
      "metadata_json",
      "device_id",
      "created_at",
    ].join(", ");
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  /**
   * Create a new transaction record. Returns the new transaction ID.
   *
   * Completeness guards (every flow funnels through here — see
   * createGuards test): blank summaries and phone-without-name client
   * identities are rejected; a missing exchange_rate is snapshotted from the
   * current LBP market rate so reports can always convert the row.
   */
  createTransaction(data: CreateTransactionInput): number {
    if (!data.summary || data.summary.trim() === "") {
      throw new Error(
        `Transaction summary must be non-empty (type=${data.type}, source=${data.source_table}#${data.source_id})`,
      );
    }
    if (data.client_phone && !data.client_name) {
      throw new Error(
        `client_phone requires client_name (type=${data.type}, source=${data.source_table}#${data.source_id})`,
      );
    }

    const exchangeRate =
      data.exchange_rate !== undefined
        ? data.exchange_rate
        : this.snapshotExchangeRate();

    const metadataStr = data.metadata_json
      ? JSON.stringify(data.metadata_json)
      : null;

    const result = this.execute(
      `INSERT INTO transactions
        (type, source_table, source_id, user_id, amount_usd, amount_lbp,
         profit_usd, profit_lbp,
         exchange_rate, client_id, client_name, client_phone, summary, metadata_json, device_id, created_at, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?)`,
      data.type,
      data.source_table,
      data.source_id,
      data.user_id,
      data.amount_usd ?? 0,
      data.amount_lbp ?? 0,
      data.profit_usd ?? 0,
      data.profit_lbp ?? 0,
      exchangeRate ?? null,
      data.client_id ?? null,
      data.client_name ?? null,
      data.client_phone ?? null,
      data.summary ?? null,
      metadataStr,
      data.device_id ?? null,
      data.transaction_time ?? null,
      getCurrentTenantId(),
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Snapshot the current USD→LBP market rate for rows created without an
   * explicit exchange_rate. Fail-soft: partial schemas (older test fixtures)
   * and missing rate rows yield null — a write must never fail on this.
   */
  private snapshotExchangeRate(): number | null {
    try {
      const rate = getRateRepository().findByCode("LBP");
      return rate ? rate.market_rate : null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /**
   * Get recent transactions with optional filters.
   */
  /**
   * D1 — currency in/out by business date. Aggregates customer-facing cash
   * legs (same rule as the transactions table's in/out column) per date and
   * currency. transactions.created_at IS the business date: createTransaction
   * COALESCEs the caller's transaction_time into it, so backdated entries
   * already land on their business date. Session-basket legs (no transaction
   * of their own) bucket by their payment date.
   */
  getCashFlowByDate(from: string, to: string): CashFlowByDateRow[] {
    const tenantId = getCurrentTenantId();
    return this.query<CashFlowByDateRow>(
      `SELECT
         l.date,
         l.currency_code,
         ROUND(SUM(CASE WHEN l.amount > 0 THEN l.amount ELSE 0 END), 2) AS total_in,
         ROUND(SUM(CASE WHEN l.amount < 0 THEN -l.amount ELSE 0 END), 2) AS total_out
       FROM (
         SELECT substr(t.created_at, 1, 10) AS date,
                p.currency_code, p.amount, p.method, p.drawer_name, p.note
           FROM payments p
           JOIN transactions t ON t.id = p.transaction_id AND t.tenant_id = ?
          WHERE t.status = 'ACTIVE' AND p.tenant_id = ?
         UNION ALL
         SELECT substr(p.created_at, 1, 10) AS date,
                p.currency_code, p.amount, p.method, p.drawer_name, p.note
           FROM payments p
          WHERE p.transaction_id IS NULL AND p.session_id IS NOT NULL AND p.tenant_id = ?
       ) l
       WHERE l.date BETWEEN ? AND ?
         AND ${customerCashLegSql("l")}
       GROUP BY l.date, l.currency_code
       ORDER BY l.date DESC`,
      tenantId,
      tenantId,
      tenantId,
      from,
      to,
    );
  }

  getRecent(limit = 50, filters?: TransactionFilters): TransactionWithUser[] {
    const tenantId = getCurrentTenantId();
    const conditions: string[] = ["t.tenant_id = ?"];
    const params: unknown[] = [tenantId];

    if (filters?.type) {
      conditions.push("t.type = ?");
      params.push(filters.type);
    }
    if (filters?.status) {
      conditions.push("t.status = ?");
      params.push(filters.status);
    }
    if (filters?.user_id) {
      conditions.push("t.user_id = ?");
      params.push(filters.user_id);
    }
    if (filters?.client_id) {
      conditions.push("t.client_id = ?");
      params.push(filters.client_id);
    }
    if (filters?.source_table) {
      conditions.push("t.source_table = ?");
      params.push(filters.source_table);
    }
    if (filters?.from) {
      conditions.push("t.created_at >= ?");
      params.push(filters.from);
    }
    if (filters?.to) {
      conditions.push("t.created_at <= ?");
      params.push(filters.to);
    }
    if (filters?.provider) {
      conditions.push("json_extract(t.metadata_json, '$.provider') = ?");
      params.push(filters.provider);
    }
    if (filters?.service_type) {
      conditions.push("json_extract(t.metadata_json, '$.service_type') = ?");
      params.push(filters.service_type);
    }
    if (filters?.has_item_key === true) {
      conditions.push(
        "json_extract(t.metadata_json, '$.item_key') IS NOT NULL",
      );
    } else if (filters?.has_item_key === false) {
      conditions.push("json_extract(t.metadata_json, '$.item_key') IS NULL");
    }
    if (filters?.search) {
      const term = `%${filters.search}%`;
      conditions.push(
        "(t.summary LIKE ? OR t.client_name LIKE ? OR u.username LIKE ?)",
      );
      params.push(term, term, term);
    }
    if (filters?.excludeTypes && filters.excludeTypes.length > 0) {
      const placeholders = filters.excludeTypes.map(() => "?").join(", ");
      conditions.push(`t.type NOT IN (${placeholders})`);
      params.push(...filters.excludeTypes);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    params.push(limit);

    const rows = this.query<TransactionWithUser>(
      `SELECT t.id, t.type, t.status, t.source_table, t.source_id,
              t.user_id, t.amount_usd, t.amount_lbp, t.exchange_rate,
              t.client_id, t.client_phone,
              t.reverses_id, t.summary, t.metadata_json,
              t.device_id, t.created_at,
              u.username,
              COALESCE(t.client_name, c.full_name) AS client_name,
              cst.session_id AS session_id,
              (SELECT r.id FROM transactions r
                WHERE r.reverses_id = t.id
                  AND r.type = 'REFUND'
                  AND r.tenant_id = t.tenant_id
                LIMIT 1) AS reversed_by_id
       FROM transactions t
       LEFT JOIN users u ON u.id = t.user_id AND u.tenant_id = ?
       LEFT JOIN clients c ON c.id = t.client_id AND c.tenant_id = ?
       LEFT JOIN customer_session_transactions cst
              ON cst.unified_transaction_id = t.id AND cst.tenant_id = ?
       ${where}
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT ?`,
      tenantId,
      tenantId,
      tenantId,
      ...params,
    );

    return this._attachPaymentLegs(rows);
  }

  /**
   * Batch-load structured in/out payment legs for a set of transaction rows and
   * attach them as `row.payments` (LIRA-064). One `IN (...)` query covers every
   * row, so this stays O(1) round-trips regardless of page size.
   *
   * Legs are derived purely from the joined `payments` table; the stored
   * `summary` text is never modified.
   */
  private _attachPaymentLegs(
    rows: TransactionWithUser[],
  ): TransactionWithUser[] {
    if (rows.length === 0) return rows;

    const tenantId = getCurrentTenantId();
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(", ");

    const legRows = this.query<{
      transaction_id: number;
      method: string;
      drawer_name: string;
      currency_code: string;
      amount: number;
      note: string | null;
    }>(
      `SELECT transaction_id, method, drawer_name, currency_code, amount, note
       FROM payments
       WHERE transaction_id IN (${placeholders}) AND tenant_id = ?
       ORDER BY id ASC`,
      ...ids,
      tenantId,
    );

    const toLeg = (p: {
      method: string;
      drawer_name: string;
      currency_code: string;
      amount: number;
      note: string | null;
    }): TransactionPaymentLeg | null => {
      // Surface only customer-facing cash — shared rule (see isInternalLegJs).
      if (isInternalLegJs(p)) return null;
      return {
        direction: p.amount < 0 ? "out" : "in",
        amount: Math.abs(p.amount),
        signed_amount: p.amount,
        currency_code: p.currency_code,
        method: p.method,
      };
    };

    // A CUSTOMER_ACCOUNT settlement never writes a `payments` row (no drawer
    // movement), so its method leg is reconstructed from the matching
    // `debt_ledger` charge. One builder, shared by both the session and the
    // non-session paths below (rule 14).
    const debtToAccountLegs = (
      amount_usd: number,
      amount_lbp: number,
    ): TransactionPaymentLeg[] => {
      const legs: TransactionPaymentLeg[] = [];
      if (amount_usd !== 0) {
        legs.push({
          direction: amount_usd < 0 ? "out" : "in",
          amount: Math.abs(amount_usd),
          signed_amount: amount_usd,
          currency_code: "USD",
          method: "CUSTOMER_ACCOUNT",
        });
      }
      if (amount_lbp !== 0) {
        legs.push({
          direction: amount_lbp < 0 ? "out" : "in",
          amount: Math.abs(amount_lbp),
          signed_amount: amount_lbp,
          currency_code: "LBP",
          method: "CUSTOMER_ACCOUNT",
        });
      }
      return legs;
    };

    const byTxn = new Map<number, TransactionPaymentLeg[]>();
    for (const p of legRows) {
      const leg = toLeg(p);
      if (!leg) continue;
      const legs = byTxn.get(p.transaction_id) ?? [];
      legs.push(leg);
      byTxn.set(p.transaction_id, legs);
    }

    // Session-basket fallback: rows that belong to a session but carry no own
    // customer-cash legs inherit the session's basket legs (the ONE basket
    // payment posted with session_id set, transaction_id NULL). One IN(...)
    // query batch-loads every distinct session, keeping this O(1) round-trips.
    const sessionIds = Array.from(
      new Set(
        rows
          .filter((r) => r.session_id != null && !byTxn.has(r.id))
          .map((r) => r.session_id as number),
      ),
    );
    const basketLegsBySession = new Map<number, TransactionPaymentLeg[]>();
    const accountLegsBySession = new Map<number, TransactionPaymentLeg[]>();
    if (sessionIds.length > 0) {
      const sPlaceholders = sessionIds.map(() => "?").join(", ");
      const basketRows = this.query<{
        session_id: number;
        method: string;
        drawer_name: string;
        currency_code: string;
        amount: number;
        note: string | null;
      }>(
        `SELECT session_id, method, drawer_name, currency_code, amount, note
         FROM payments
         WHERE session_id IN (${sPlaceholders}) AND tenant_id = ?
         ORDER BY id ASC`,
        ...sessionIds,
        tenantId,
      );
      for (const p of basketRows) {
        const leg = toLeg(p);
        if (!leg) continue;
        const legs = basketLegsBySession.get(p.session_id) ?? [];
        legs.push(leg);
        basketLegsBySession.set(p.session_id, legs);
      }

      // CUSTOMER_ACCOUNT settlement of the same basket, if any — see the
      // `account_payments` doc comment on TransactionWithUser for why this is
      // a separate table/field rather than another `payments` row.
      // ACCOUNT_CHARGE_PREDICATE excludes 'Refund Reversal': reversal rows also
      // carry a transaction_id/session_id but belong to the refund transaction,
      // which shows its own real method — a refund must never render a spurious
      // "Customer Account" leg. Shared verbatim by the non-session lookup below.
      const debtRows = this.query<{
        session_id: number;
        amount_usd: number;
        amount_lbp: number;
      }>(
        `SELECT session_id, amount_usd, amount_lbp
         FROM debt_ledger
         WHERE session_id IN (${sPlaceholders}) AND tenant_id = ?
           AND ${ACCOUNT_CHARGE_PREDICATE}`,
        ...sessionIds,
        tenantId,
      );
      for (const d of debtRows) {
        const legs = accountLegsBySession.get(d.session_id) ?? [];
        legs.push(...debtToAccountLegs(d.amount_usd, d.amount_lbp));
        accountLegsBySession.set(d.session_id, legs);
      }
    }

    // Non-session on-account charges. Unlike the session-basket settlement, a
    // plain on-account sale/recharge/service/… writes its `debt_ledger` row with
    // `transaction_id` set and `session_id` NULL, so the session-keyed lookup
    // above misses it and the Method column renders blank. Reconstruct the same
    // CUSTOMER_ACCOUNT leg by `transaction_id`. `session_id IS NULL` keeps this
    // query-disjoint from the session path (session debt carries both keys), so
    // no row is ever attached twice.
    const accountLegsByTxn = new Map<number, TransactionPaymentLeg[]>();
    const txnDebtRows = this.query<{
      transaction_id: number;
      amount_usd: number;
      amount_lbp: number;
    }>(
      `SELECT transaction_id, amount_usd, amount_lbp
       FROM debt_ledger
       WHERE transaction_id IN (${placeholders})
         AND session_id IS NULL
         AND tenant_id = ?
         AND ${ACCOUNT_CHARGE_PREDICATE}`,
      ...ids,
      tenantId,
    );
    for (const d of txnDebtRows) {
      const legs = accountLegsByTxn.get(d.transaction_id) ?? [];
      legs.push(...debtToAccountLegs(d.amount_usd, d.amount_lbp));
      accountLegsByTxn.set(d.transaction_id, legs);
    }

    for (const row of rows) {
      const own = byTxn.get(row.id);
      if (own && own.length > 0) {
        row.payments = own;
      } else if (row.session_id != null) {
        row.payments = basketLegsBySession.get(row.session_id) ?? [];
      } else {
        row.payments = [];
      }
      const accountLegs =
        row.session_id != null
          ? accountLegsBySession.get(row.session_id)
          : accountLegsByTxn.get(row.id);
      if (accountLegs && accountLegs.length > 0) {
        row.account_payments = accountLegs;
      }
    }

    return rows;
  }

  /**
   * Find the transaction row that corresponds to a specific source record.
   */
  getBySourceId(
    sourceTable: string,
    sourceId: number,
  ): TransactionEntity | null {
    return this.queryOne<TransactionEntity>(
      `SELECT ${this.getColumns()} FROM transactions
       WHERE source_table = ? AND source_id = ? AND status = 'ACTIVE' AND tenant_id = ?
       ORDER BY id DESC LIMIT 1`,
      sourceTable,
      sourceId,
      getCurrentTenantId(),
    );
  }

  /**
   * Get all transactions for a given client.
   */
  getByClientId(clientId: number, limit = 100): TransactionEntity[] {
    return this.query<TransactionEntity>(
      `SELECT ${this.getColumns()} FROM transactions
       WHERE client_id = ? AND tenant_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      clientId,
      getCurrentTenantId(),
      limit,
    );
  }

  /**
   * Get transactions in a date range with optional type filter.
   */
  getByDateRange(
    from: string,
    to: string,
    type?: TransactionType,
  ): TransactionEntity[] {
    const tenantId = getCurrentTenantId();
    if (type) {
      return this.query<TransactionEntity>(
        `SELECT ${this.getColumns()} FROM transactions
         WHERE created_at >= ? AND created_at <= ? AND type = ? AND tenant_id = ?
         ORDER BY created_at DESC`,
        from,
        to,
        type,
        tenantId,
      );
    }
    return this.query<TransactionEntity>(
      `SELECT ${this.getColumns()} FROM transactions
       WHERE created_at >= ? AND created_at <= ? AND tenant_id = ?
       ORDER BY created_at DESC`,
      from,
      to,
      tenantId,
    );
  }

  // ---------------------------------------------------------------------------
  // Accounting Journal Operations
  // ---------------------------------------------------------------------------

  /**
   * Void a transaction using the accounting journal pattern:
   * 1. Set original status to VOIDED
   * 2. Create a reversal row with negated amounts and reverses_id = original.id
   * 3. Reverse drawer balances via negated payment rows
   * 4. If SALE: mark sale as 'cancelled', restore stock, cancel debt
   *
   * Returns the reversal transaction's ID.
   */
  voidTransaction(id: number, userId: number): number {
    return this._voidTransactionInternal(id, userId, {});
  }

  /**
   * Void every non-voided member of a multi-unit split checkout
   * (CARRIER_LEGS_VOID_ASYMMETRY.md, design B+) in ONE db transaction —
   * siblings first, carrier last. Reuses `_voidTransactionInternal` per
   * member (with the split-group guard bypassed for THIS call only) so
   * drawer/debt/profit/partner-ledger reversal all run through the exact
   * same code a single `voidTransaction` uses — nothing new to keep in sync.
   * better-sqlite3 nests `db.transaction()` calls via savepoints, so the
   * whole group is genuinely atomic: a failure partway through rolls back
   * every member already voided in this call.
   *
   * Members already VOIDED (e.g. a re-run after a partial failure) are
   * skipped, not errored — idempotent re-invocation is safe. An unknown or
   * empty group throws NotFoundError. Legacy pre-fix rows carry no
   * `split_group` marker and can never be found by this method — see the
   * doc's legacy-row limitation.
   */
  voidCheckoutGroup(groupId: string, userId: number): VoidCheckoutGroupResult {
    if (!groupId || groupId.trim() === "") {
      throw new DatabaseError("groupId is required");
    }
    const tenantId = getCurrentTenantId();
    // json_extract (not a `metadata_json LIKE '%"split_group":"<id>"%'` scan)
    // — already the established pattern for querying this exact column in
    // this exact file (see the provider/service_type filters in getRecent
    // below), exact-match rather than substring, and safe: metadata_json is
    // always either NULL or `JSON.stringify`-produced (createTransaction),
    // so json_extract never sees malformed JSON, and `groupId` is a bound
    // parameter, never concatenated.
    const members = this.query<{
      id: number;
      status: TransactionStatus;
      metadata_json: string | null;
    }>(
      `SELECT id, status, metadata_json FROM transactions
       WHERE tenant_id = ? AND reverses_id IS NULL
         AND json_extract(metadata_json, '$.split_group') = ?
       ORDER BY id ASC`,
      tenantId,
      groupId,
    );
    if (members.length === 0) {
      throw new NotFoundError("split checkout group", groupId);
    }

    // Siblings first, carrier last (see method doc).
    const ranked = members
      .map((m) => ({
        ...m,
        role: this._getSplitGroup(m.metadata_json)?.role ?? null,
      }))
      .sort((a, b) => {
        const rank = (r: string | null) => (r === "carrier" ? 1 : 0);
        return rank(a.role) - rank(b.role);
      });

    return this.transaction(() => {
      const voidedTransactionIds: number[] = [];
      const reversalIds: number[] = [];
      for (const m of ranked) {
        if (m.status === "VOIDED") continue;
        const reversalId = this._voidTransactionInternal(m.id, userId, {
          allowSplitGroupMember: true,
        });
        voidedTransactionIds.push(m.id);
        reversalIds.push(reversalId);
      }
      return {
        groupId,
        memberCount: members.length,
        voidedTransactionIds,
        reversalIds,
      };
    });
  }

  /**
   * Void every item in a customer-session basket, PLUS the basket's own
   * pooled cash leg(s) and pooled 'Session Debt' charge, in ONE db
   * transaction (LIRA-115, option (a) — the per-item guard in
   * `_assertReversible` refuses a bare `voidTransaction` on any of these
   * rows and routes here instead, mirroring `voidCheckoutGroup`'s relationship
   * to the split_group guard).
   *
   * Each item is reversed via `_voidTransactionInternal` with
   * `allowSessionMember: true` — the EXACT same per-item reversal a standalone
   * `voidTransaction` would run (cost/provider-drawer legs, profit stamp,
   * carrier-line movements, supplier-ledger siblings, partner ledger, …), so
   * nothing module-specific needs reimplementing here (rule 14). This method
   * adds exactly the TWO things a per-item reversal structurally cannot see:
   * the pooled `payments` row(s) (`transaction_id IS NULL, session_id = ?`)
   * and the pooled `debt_ledger` 'Session Debt' row, each reversed exactly
   * ONCE for the whole basket — never per item, which would multiply the
   * reversal by the item count.
   *
   * Idempotent re-invocation is refused, not silently no-op'd: once the
   * pooled leg/debt has a reversal marker, a second call throws (see
   * `_assertSessionBasketReversible`) rather than risk double-reversing money
   * that was already returned.
   */
  voidSessionBasket(sessionId: number, userId: number): SessionBasketReversalResult {
    const tenantId = getCurrentTenantId();
    this._assertSessionBasketReversible(sessionId);
    const items = this.query<{ id: number; status: TransactionStatus }>(
      `SELECT t.id AS id, t.status AS status
       FROM customer_session_transactions cst
       JOIN transactions t ON t.id = cst.unified_transaction_id AND t.tenant_id = ?
       WHERE cst.session_id = ? AND cst.tenant_id = ?
       ORDER BY cst.id ASC`,
      tenantId,
      sessionId,
      tenantId,
    );
    if (items.length === 0) {
      throw new NotFoundError("session basket", sessionId);
    }

    return this.transaction(() => {
      const reversedTransactionIds: number[] = [];
      const reversalIds: number[] = [];
      for (const item of items) {
        // Idempotent re-invocation safe, mirroring voidCheckoutGroup's own
        // already-voided skip — a partial-progress re-run never happens in
        // practice (the whole loop + pooled reversal below is ONE db
        // transaction, so a mid-loop failure rolls back everything), but a
        // deliberate second call after a full success is still handled
        // gracefully rather than throwing on item #1's "already voided".
        if (item.status === "VOIDED") continue;
        const reversalId = this._voidTransactionInternal(item.id, userId, {
          allowSessionMember: true,
        });
        reversedTransactionIds.push(item.id);
        reversalIds.push(reversalId);
      }
      this._reverseSessionPooledPayments(sessionId, userId);
      this._cancelSessionDebt(sessionId, userId);
      return {
        sessionId,
        itemCount: items.length,
        reversedTransactionIds,
        reversalIds,
      };
    });
  }

  /**
   * Refund every item in a customer-session basket, PLUS the basket's own
   * pooled cash leg(s) and pooled 'Session Debt' charge, in ONE db
   * transaction. Same shape as `voidSessionBasket` (rule 14) but keeps every
   * original item ACTIVE and creates a REFUND row per item, matching
   * `refundTransaction`'s own accounting (rather than VOIDing the item) —
   * this is the path the owner's actual LIRA-115 report exercises
   * ("Refund of a service txn...").
   */
  refundSessionBasket(
    sessionId: number,
    userId: number,
  ): SessionBasketReversalResult {
    const tenantId = getCurrentTenantId();
    this._assertSessionBasketReversible(sessionId);
    const items = this.query<{ id: number; status: TransactionStatus }>(
      `SELECT t.id AS id, t.status AS status
       FROM customer_session_transactions cst
       JOIN transactions t ON t.id = cst.unified_transaction_id AND t.tenant_id = ?
       WHERE cst.session_id = ? AND cst.tenant_id = ?
       ORDER BY cst.id ASC`,
      tenantId,
      sessionId,
      tenantId,
    );
    if (items.length === 0) {
      throw new NotFoundError("session basket", sessionId);
    }

    return this.transaction(() => {
      const reversedTransactionIds: number[] = [];
      const reversalIds: number[] = [];
      for (const item of items) {
        // Skip a member already voided, or already refunded by a prior call
        // to this same method (idempotent re-invocation — see
        // voidSessionBasket's identical comment).
        if (item.status === "VOIDED") continue;
        const alreadyRefunded = this.queryOne<{ id: number }>(
          `SELECT id FROM transactions WHERE reverses_id = ? AND type = 'REFUND' AND tenant_id = ?`,
          item.id,
          tenantId,
        );
        if (alreadyRefunded) continue;
        const refundId = this._refundTransactionInternal(item.id, userId, {
          allowSessionMember: true,
        });
        reversedTransactionIds.push(item.id);
        reversalIds.push(refundId);
      }
      this._reverseSessionPooledPayments(sessionId, userId);
      this._cancelSessionDebt(sessionId, userId);
      return {
        sessionId,
        itemCount: items.length,
        reversedTransactionIds,
        reversalIds,
      };
    });
  }

  /**
   * Up-front refusal (before any write) if this basket's pooled cash/debt
   * was already reversed by a prior `voidSessionBasket`/`refundSessionBasket`
   * call — prevents double-reversing the ONE pooled leg/debt on a repeat
   * invocation (see both callers' idempotency comment for why the per-item
   * loop alone can't detect this: every item might already be
   * voided/refunded from a fully-successful prior call, which would
   * otherwise look identical to "nothing to do" and let the pooled-reversal
   * steps run a second time).
   */
  private _assertSessionBasketReversible(sessionId: number): void {
    const tenantId = getCurrentTenantId();
    const reversedLeg = this.queryOne<{ id: number }>(
      `SELECT id FROM payments
       WHERE session_id = ? AND transaction_id IS NULL AND note = ? AND tenant_id = ?
       LIMIT 1`,
      sessionId,
      SESSION_BASKET_REVERSAL_NOTE,
      tenantId,
    );
    if (reversedLeg) {
      throw new DatabaseError(
        `Session basket #${sessionId} has already been voided/refunded`,
        { entityId: sessionId },
      );
    }
    const reversedDebt = this.queryOne<{ id: number }>(
      `SELECT id FROM debt_ledger
       WHERE session_id = ? AND transaction_type = 'Refund Reversal' AND tenant_id = ?
       LIMIT 1`,
      sessionId,
      tenantId,
    );
    if (reversedDebt) {
      throw new DatabaseError(
        `Session basket #${sessionId} has already been voided/refunded`,
        { entityId: sessionId },
      );
    }
  }

  /**
   * Reverse the ONE (or two, USD+LBP) pooled `payments` row(s) a session
   * basket's customer-cash leg was posted as (`SessionPaymentService
   * .recordBasketPayment` → `insertSessionLeg`, `transaction_id` NULL,
   * `session_id` set) — exactly once for the whole basket. Mirrors
   * `_reversePayments`'s mirror-and-negate shape (rule 14) but keyed by
   * `session_id` instead of `transaction_id`, and posts the reversal leg back
   * onto the SAME pool (`session_id` set, `transaction_id` NULL) rather than
   * onto any one item's reversal row — there is no single item that "owns"
   * pooled cash, so the reversal stays pooled too. `getCashFlowByDate` (D1)
   * already includes `transaction_id IS NULL AND session_id IS NOT NULL`
   * rows unconditionally, so this reversal leg surfaces on its own date
   * exactly like the original leg did on its date — no report changes needed.
   */
  private _reverseSessionPooledPayments(sessionId: number, userId: number): void {
    const tenantId = getCurrentTenantId();
    const legs = this.query<{
      method: string;
      drawer_name: string;
      currency_code: string;
      amount: number;
    }>(
      `SELECT method, drawer_name, currency_code, amount
       FROM payments WHERE transaction_id IS NULL AND session_id = ? AND tenant_id = ?`,
      sessionId,
      tenantId,
    );

    for (const p of legs) {
      const negatedAmount = -p.amount;
      insertPaymentRow(this.db, {
        sessionId,
        method: p.method,
        drawerName: p.drawer_name,
        currencyCode: p.currency_code,
        amount: negatedAmount,
        note: SESSION_BASKET_REVERSAL_NOTE,
        createdBy: userId,
        tenantId,
      });
      applyDrawerDelta(this.db, {
        drawerName: p.drawer_name,
        currencyCode: p.currency_code,
        delta: negatedAmount,
        tenantId,
      });
    }
  }

  /**
   * Reverse the ONE pooled `debt_ledger` 'Session Debt' row a basket's
   * CUSTOMER_ACCOUNT (+ GIFT_CARD) portion was booked as
   * (`SessionPaymentRepository.insertBasketDebt`, `session_id` set,
   * `transaction_id` NULL) — closes the gap the constant's own doc comment
   * (`transactionTypes.ts`) named but never implemented: "'Session Debt' ...
   * is reversed by the session flow, not the generic path." No drawer is
   * touched here — an on-account charge took no cash, so its reversal is
   * ledger-only, exactly like `_cancelDebt`'s generic pattern for every other
   * module-charge debt type (rule 14 — same 'Refund Reversal' insert shape).
   */
  private _cancelSessionDebt(sessionId: number, userId: number): void {
    const tenantId = getCurrentTenantId();
    const debts = this.query<{
      id: number;
      client_id: number;
      amount_usd: number;
      amount_lbp: number;
    }>(
      `SELECT id, client_id, amount_usd, amount_lbp FROM debt_ledger
       WHERE session_id = ? AND transaction_type = 'Session Debt' AND tenant_id = ?`,
      sessionId,
      tenantId,
    );

    const insertReversal = this.db.prepare(`
      INSERT INTO debt_ledger (
        client_id, transaction_type, amount_usd, amount_lbp, transaction_id, session_id, note, created_by, tenant_id
      ) VALUES (?, 'Refund Reversal', ?, ?, NULL, ?, 'Debt cancelled by session basket void/refund', ?, ?)
    `);

    for (const d of debts) {
      insertReversal.run(
        d.client_id,
        -d.amount_usd,
        -d.amount_lbp,
        sessionId,
        userId,
        tenantId,
      );
    }
  }

  private _voidTransactionInternal(
    id: number,
    userId: number,
    opts: { allowSplitGroupMember?: boolean; allowSessionMember?: boolean },
  ): number {
    const original = this.findById(id);
    if (!original) {
      throw new NotFoundError("transactions", id);
    }
    if (original.status === "VOIDED") {
      throw new DatabaseError("Transaction is already voided", {
        entityId: id,
      });
    }
    this._assertReversible(original, opts);
    // LIRA-091: refuse up-front (before any write) if this transaction's own
    // auto supplier-ledger sibling has already been swept into a settlement —
    // see the method doc for why cascading through a settled sibling is
    // blocked rather than silently corrupting the settlement's netted math.
    this._assertSupplierSiblingsVoidable(original);
    // This ticket's own guard — refuse up-front if its checkpoint has already
    // settled (see the method doc). No-op for every non-LOTO type.
    this._assertLotoTicketVoidable(original);
    const tenantId = getCurrentTenantId();
    // A transaction that already has an ACTIVE REFUND reverser had its cash
    // reversed once — voiding it too would double-reverse the drawers.
    const refunded = this.queryOne<{ id: number }>(
      `SELECT id FROM transactions WHERE reverses_id = ? AND type = 'REFUND' AND status = 'ACTIVE' AND tenant_id = ?`,
      id,
      tenantId,
    );
    if (refunded) {
      throw new DatabaseError(
        "Transaction has already been refunded — cannot void it too",
        { entityId: id },
      );
    }

    return this.transaction(() => {
      // 1. Mark original as VOIDED
      this.execute(
        `UPDATE transactions SET status = 'VOIDED' WHERE id = ? AND tenant_id = ?`,
        id,
        tenantId,
      );

      // 2. Create reversal row
      const result = this.execute(
        `INSERT INTO transactions
          (type, status, source_table, source_id, user_id,
           amount_usd, amount_lbp, exchange_rate,
           client_id, reverses_id, summary, metadata_json, device_id, tenant_id)
         VALUES (?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        original.type,
        original.source_table,
        original.source_id,
        userId,
        -original.amount_usd,
        -original.amount_lbp,
        original.exchange_rate,
        original.client_id,
        id,
        `VOID: ${original.summary ?? original.type}`,
        original.metadata_json,
        original.device_id,
        tenantId,
      );

      const reversalId = result.lastInsertRowid as number;

      // 3. Reverse drawer balances — negate every payment from the original
      this._reversePayments(id, reversalId, userId);

      // 4. Mark source module record as voided/refunded
      this._markSourceRefunded(original.source_table, original.source_id);

      // 5. Cancel any module-charge debt booked against this transaction —
      // every account-charged flow (sale, recharge, financial/custom service,
      // maintenance), not just sales. No-op when nothing matches.
      this._cancelDebt(id, userId);

      // 5a. D3 (COUNTERPARTY_CONSOLIDATION_PLAN.md) — if the transaction
      // being voided IS a DEBT_REPAYMENT itself, restore the debt the
      // repayment paid down and unwind the FIFO coverage it applied. No-op
      // for every other transaction type (see the method doc for the
      // disjoint-trigger proof vs. _cancelDebt above).
      this._restoreRepaymentDebt(original, userId);

      // 5b. Reverse any partner_ledger rows tied to this transaction
      // (PFT-2, rule 20) — type-agnostic, so this also fixes the
      // pre-existing FOR_OMT/THROUGH_* void gap uniformly.
      this._reversePartnerLedger(original, userId, "void");

      // 5c. LIRA-091 — cascade-void any auto supplier-ledger sibling this
      // transaction's own event created (FinancialServiceRepository's BILL
      // commission / SEND-RECEIVE TOP_UP-PAYMENT auto rows). No-op when
      // there is none, or on a legacy (pre-v136) row with no link.
      this._cascadeSupplierSiblingVoid(original, userId);

      // 5d. LIRA-085 — if this transaction IS a PARTNER_SETTLEMENT/
      // PARTNER_PAYMENT, restore its own partner_ledger row (+ any bundled
      // CQ-10 discount) and unwind the FIFO covered_amount stamps it
      // applied. No-op for every other type.
      this._reversePartnerSettlementLedger(original, userId);

      // 5e. LIRA-085 — if this transaction IS a SUPPLIER_SETTLEMENT, reverse
      // the commission drawer funding, soft-void the linked SUPPLIER_PAYS_US
      // row, and un-stamp financial_services.settlement_id/is_settled. No-op
      // for every other type.
      this._reverseSupplierSettlement(original, userId);

      // 5f. Rule 20 — if this transaction IS a LOTO ticket sale, soft-void
      // its supplier_ledger TOP_UP row and delta-adjust its checkpoint (if
      // still open). No-op for every other type; a settled checkpoint was
      // already refused by _assertLotoTicketVoidable before this transaction
      // opened.
      this._reverseLotoSupplierLedger(original);

      // 5g. LIRA-090 §8, rule 20 — reverse every carrier_line_movements row
      // tied to this transaction (Only Days credit-return, self-charge).
      // Type-agnostic, keyed by transaction_id; no-op when none match.
      this._reverseCarrierLineMovements(original);

      // 6. If SALE: cancel sale, restore stock
      if (original.source_table === "sales" && original.source_id) {
        this.execute(
          `UPDATE sales SET status = 'cancelled' WHERE id = ? AND tenant_id = ?`,
          original.source_id,
          tenantId,
        );
        this._restoreStock(original.source_id);
      }

      // 7. Supplier payment: un-apply the FIFO purchase coverage the payment
      // consumed (the ledger row itself is soft-voided by step 4).
      this._unapplySupplierPurchaseCoverage(original);

      return reversalId;
    });
  }

  /**
   * Create a refund transaction:
   * 1. Guard against double-refund.
   * 2. Create a REFUND row with reverses_id = original.id and negated amounts.
   * 3. Reverse drawer balances via negated payment rows.
   * 4. If the original is a SALE, mark sale status = 'refunded',
   *    set sale_items.is_refunded = 1, restore stock, and cancel debt.
   *
   * Returns the refund transaction's ID.
   */
  /**
   * Refund a sale by its sale ID (looks up the corresponding transaction).
   * This is the entry point from the POS / SaleDetailModal.
   */
  refundBySaleId(saleId: number, userId: number): number {
    const txn = this.queryOne<{ id: number }>(
      `SELECT id FROM transactions
       WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE' AND tenant_id = ?
       ORDER BY id DESC LIMIT 1`,
      saleId,
      getCurrentTenantId(),
    );
    if (!txn) {
      throw new DatabaseError(`No SALE transaction found for sale #${saleId}`, {
        entityId: saleId,
      });
    }
    return this.refundTransaction(txn.id, userId);
  }

  refundTransaction(
    id: number,
    userId: number,
    opts?: { refundLegs?: RefundLegOverride[] },
  ): number {
    return this._refundTransactionInternal(id, userId, {
      refundLegs: opts?.refundLegs,
    });
  }

  /**
   * LIRA-115: internal counterpart to `refundTransaction`, split out the same
   * way `voidTransaction` delegates to `_voidTransactionInternal` (rule 14 —
   * one shape, reused) so `refundSessionBasket` can bypass the session-basket
   * guard (`allowSessionMember: true`) for one item at a time while every
   * OTHER caller (the public `refundTransaction`, `refundBySaleId`) keeps the
   * guard enforced.
   */
  private _refundTransactionInternal(
    id: number,
    userId: number,
    opts: {
      refundLegs?: RefundLegOverride[];
      allowSessionMember?: boolean;
    },
  ): number {
    const original = this.findById(id);
    if (!original) {
      throw new NotFoundError("transactions", id);
    }
    if (original.status === "VOIDED") {
      throw new DatabaseError("Cannot refund a voided transaction", {
        entityId: id,
      });
    }
    this._assertReversible(original, {
      allowSessionMember: opts.allowSessionMember,
    });
    // LIRA-091: same up-front settled-sibling guard as voidTransaction — see
    // _assertSupplierSiblingsVoidable's doc.
    this._assertSupplierSiblingsVoidable(original);
    // Same up-front settled-checkpoint guard as voidTransaction — see
    // _assertLotoTicketVoidable's doc. No-op for every non-LOTO type.
    this._assertLotoTicketVoidable(original);
    const tenantId = getCurrentTenantId();

    // Guard: prevent double-refund
    const existing = this.queryOne<{ id: number }>(
      `SELECT id FROM transactions WHERE reverses_id = ? AND type = 'REFUND' AND tenant_id = ?`,
      id,
      tenantId,
    );
    if (existing) {
      throw new DatabaseError("Transaction has already been refunded", {
        entityId: id,
      });
    }

    // LIRA-078: validate the operator's chosen return method(s) BEFORE any
    // row is written — a throw here never enters this.transaction(), so a
    // rejected override leaves nothing partial behind (same discipline as
    // reconcileLegs, moneyPosting.ts). No-op (existing mirror-verbatim
    // behavior, byte-identical to pre-LIRA-078) when opts/refundLegs is
    // omitted — this is what keeps every OTHER refund call site (refundBySaleId,
    // scripted callers, tests) unchanged.
    const refundLegs = opts.refundLegs;
    if (refundLegs && refundLegs.length > 0) {
      this._validateRefundLegOverride(id, refundLegs);
    }

    return this.transaction(() => {
      // 1. Create refund transaction row. The refund carries NEGATED profit:
      // the original stays ACTIVE (profit queries sum SALE + REFUND rows), so
      // without the negative stamp a refunded transaction keeps its full
      // profit forever.
      const result = this.execute(
        `INSERT INTO transactions
          (type, status, source_table, source_id, user_id,
           amount_usd, amount_lbp, exchange_rate, profit_usd, profit_lbp,
           client_id, reverses_id, summary, metadata_json, device_id, tenant_id)
         VALUES ('REFUND', 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        original.source_table,
        original.source_id,
        userId,
        -original.amount_usd,
        -original.amount_lbp,
        original.exchange_rate,
        -original.profit_usd,
        -original.profit_lbp,
        original.client_id,
        id,
        `REFUND: ${original.summary ?? original.type}`,
        original.metadata_json,
        original.device_id,
        tenantId,
      );

      const refundId = result.lastInsertRowid as number;

      // 2. Reverse drawer balances — negate every payment from the original.
      // LIRA-078: when refundLegs is present, the customer-facing legs are
      // replaced by the operator's chosen return method(s) instead of being
      // mirrored verbatim; every other (internal bookkeeping) leg still
      // mirrors exactly as before — see _reversePayments.
      this._reversePayments(id, refundId, userId, refundLegs);

      // 3. Mark source module record as refunded
      this._markSourceRefunded(original.source_table, original.source_id);

      // 4. Cancel any module-charge debt booked against this transaction —
      // every account-charged flow (sale, recharge, financial/custom service,
      // maintenance), not just sales. No-op when nothing matches.
      this._cancelDebt(id, userId);

      // 4a. D3 (COUNTERPARTY_CONSOLIDATION_PLAN.md) — if the transaction
      // being refunded IS a DEBT_REPAYMENT itself, restore the debt the
      // repayment paid down and unwind the FIFO coverage it applied. No-op
      // for every other transaction type.
      this._restoreRepaymentDebt(original, userId);

      // 4b. Reverse any partner_ledger rows tied to this transaction
      // (PFT-2, rule 20) — type-agnostic, so this also fixes the
      // pre-existing FOR_OMT/THROUGH_* refund gap uniformly.
      this._reversePartnerLedger(original, userId, "refund");

      // 4c. LIRA-091 — cascade-void any auto supplier-ledger sibling this
      // transaction's own event created. See voidTransaction's identical step.
      this._cascadeSupplierSiblingVoid(original, userId);

      // 4d. LIRA-085 — PARTNER_SETTLEMENT/PARTNER_PAYMENT ledger + coverage
      // restore. See voidTransaction's identical step.
      this._reversePartnerSettlementLedger(original, userId);

      // 4e. LIRA-085 — SUPPLIER_SETTLEMENT commission/ledger/fs-stamp
      // restore. See voidTransaction's identical step.
      this._reverseSupplierSettlement(original, userId);

      // 4f. Rule 20 — LOTO ticket TOP_UP soft-void + checkpoint delta-adjust.
      // See voidTransaction's identical step.
      this._reverseLotoSupplierLedger(original);

      // 4g. LIRA-090 §8, rule 20 — carrier_line_movements reversal. See
      // voidTransaction's identical step.
      this._reverseCarrierLineMovements(original);

      // 5. If SALE: mark sale & items as refunded, restore stock
      if (original.source_table === "sales" && original.source_id) {
        this.execute(
          `UPDATE sales SET status = 'refunded' WHERE id = ? AND tenant_id = ?`,
          original.source_id,
          tenantId,
        );
        this.execute(
          `UPDATE sale_items SET is_refunded = 1 WHERE sale_id = ? AND tenant_id = ?`,
          original.source_id,
          tenantId,
        );
        this._restoreStock(original.source_id);
      }

      // 6. Supplier payment: un-apply the FIFO purchase coverage
      this._unapplySupplierPurchaseCoverage(original);

      return refundId;
    });
  }

  /**
   * Shared void/refund gate: refuse types whose side effects the generic
   * reversal cannot undo, and refuse reversing a reversal row (a VOID
   * reversal keeps the original type but carries reverses_id).
   */
  private _assertReversible(
    original: TransactionEntity,
    opts: {
      allowSplitGroupMember?: boolean;
      allowSessionMember?: boolean;
    } = {},
  ): void {
    if (NON_REVERSIBLE_TRANSACTION_TYPES.has(original.type)) {
      throw new DatabaseError(
        `${original.type} transactions cannot be voided or refunded — reverse them from their own module`,
        { entityId: original.id },
      );
    }
    if (original.reverses_id != null) {
      throw new DatabaseError("Cannot void or refund a reversal transaction", {
        entityId: original.id,
      });
    }
    // CARRIER_LEGS_VOID_ASYMMETRY.md (design B+): a row stamped with
    // `split_group` is one unit of a multi-unit split-payment checkout
    // (KatchForm bills / FinancialForm catalog units) — the customer's full
    // tender + any CUSTOMER_ACCOUNT debt books against exactly ONE unit (the
    // carrier); every sibling defers its own price/cost only. Voiding ANY
    // single member alone (carrier OR sibling) leaves the checkout's money
    // non-zero across drawers/debt_ledger/profit. Blocked here for BOTH void
    // and refund; `voidCheckoutGroup` is the only legitimate way to reverse
    // one, and passes `allowSplitGroupMember: true` to bypass this check
    // per-member while it does so under one shared db transaction. Legacy
    // rows created before this fix carry no `split_group` marker and are NOT
    // covered by this guard — see the doc's legacy-row limitation.
    if (!opts.allowSplitGroupMember) {
      const group = this._getSplitGroup(original.metadata_json);
      if (group) {
        const size = group.units != null ? `${group.units}-unit` : "multi-unit";
        throw new DatabaseError(
          `This transaction is part of a ${size} checkout; void the whole checkout instead.`,
          { entityId: original.id },
        );
      }
    }
    // LIRA-115: a row linked to a customer-session basket
    // (customer_session_transactions.unified_transaction_id = this row) was
    // sold with `deferPayment` — its own customer-cash leg was skipped at
    // create time; the customer's ONE real payment (and/or the ONE pooled
    // 'Session Debt' charge) is POOLED across every item in the basket
    // (`payments`/`debt_ledger` rows keyed by `session_id`, `transaction_id`
    // NULL). Reversing this single item alone can only ever undo its own
    // transaction_id-scoped legs (e.g. the cost leg) — the pooled cash/debt
    // is invisible to a transaction_id-keyed query and is silently never
    // reversed (the exact money-loss bug this guard closes). Mirrors the
    // split_group guard immediately above in shape (rule 14): blocked for
    // BOTH void and refund; `voidSessionBasket`/`refundSessionBasket` are the
    // only legitimate way to reverse one, and pass `allowSessionMember: true`
    // to bypass this check per-item while they do so under one shared db
    // transaction.
    if (!opts.allowSessionMember) {
      const sessionId = this._sessionIdForTransaction(original.id);
      if (sessionId != null) {
        throw new DatabaseError(
          `This transaction is part of session basket #${sessionId}; void/refund the whole basket instead.`,
          { entityId: original.id },
        );
      }
    }
  }

  /**
   * Resolve the customer-session basket a transaction belongs to, or null.
   * `customer_session_transactions` is absent from many minimal/legacy test
   * fixtures (only ~7 of the ~90 repository test DBs declare it) — guarded
   * with the same `hasTable` pattern `_reversePartnerLedger` uses for
   * `partner_ledger`, so this stays safe to call unconditionally from
   * `_assertReversible` (every void/refund call site) without breaking any
   * fixture that never seeded session tables.
   */
  private _sessionIdForTransaction(transactionId: number): number | null {
    const hasTable = this.db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'customer_session_transactions'`,
      )
      .get();
    if (!hasTable) return null;
    const tenantId = getCurrentTenantId();
    const row = this.queryOne<{ session_id: number }>(
      `SELECT session_id FROM customer_session_transactions
       WHERE unified_transaction_id = ? AND tenant_id = ?
       LIMIT 1`,
      transactionId,
      tenantId,
    );
    return row ? row.session_id : null;
  }

  /**
   * Parse the `split_group` linkage a multi-unit split checkout stamps into
   * `metadata_json` at create time (CARRIER_LEGS_VOID_ASYMMETRY.md, design
   * B+: FinancialServiceRepository.createTransaction). Returns null for
   * ordinary rows and for legacy pre-fix split rows that predate this
   * marker (undetectable by design — see the doc).
   */
  private _getSplitGroup(metadataJson: string | null): {
    id: string;
    role: "carrier" | "sibling" | null;
    units: number | null;
  } | null {
    if (!metadataJson) return null;
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(metadataJson) as Record<string, unknown>;
    } catch {
      return null;
    }
    const id = meta.split_group;
    if (typeof id !== "string" || id.length === 0) return null;
    const role =
      meta.split_role === "carrier" || meta.split_role === "sibling"
        ? meta.split_role
        : null;
    const units =
      typeof meta.split_units === "number" ? meta.split_units : null;
    return { id, role, units };
  }

  // ---------------------------------------------------------------------------
  // Private helpers for void / refund
  // ---------------------------------------------------------------------------

  /**
   * For each payment row linked to the original transaction, insert a negated
   * payment row linked to the reversal transaction and update drawer_balances.
   */
  /**
   * Get all payment rows linked to a transaction.
   * Used by the debt detail eye button to show a full payment breakdown
   * (Cash $50, WHISH $49.50 + PM fee $0.50, Debt $1.50, etc.)
   */
  getPaymentsByTransactionId(transactionId: number): PaymentRow[] {
    return this.query<PaymentRow>(
      `SELECT id, method, drawer_name, currency_code, amount, note, created_at
       FROM payments
       WHERE transaction_id = ? AND tenant_id = ?
       ORDER BY id ASC`,
      transactionId,
      getCurrentTenantId(),
    );
  }

  /**
   * Customer-facing payment legs for one transaction — the SAME filter the
   * LIRA-064 in/out summary uses (isInternalLegJs), so a receipt shows only
   * real customer cash (never the internal cost / crypto / system-reserve
   * legs). Direction is sign-derived (negative = paid OUT to the customer);
   * amount is the absolute value. Used by the RCP-3 service receipts.
   */
  getCustomerFacingLegs(transactionId: number): {
    method: string;
    currency_code: string;
    amount: number;
    direction: "IN" | "OUT";
  }[] {
    return this.getPaymentsByTransactionId(transactionId)
      .filter((p) => !isInternalLegJs(p))
      .map((p) => ({
        method: p.method,
        currency_code: p.currency_code,
        amount: Math.abs(p.amount),
        direction: p.amount < 0 ? "OUT" : "IN",
      }));
  }

  /**
   * Mark the source module record as refunded.
   * Tables with is_refunded column: recharges, financial_services,
   * exchange_transactions, custom_services, maintenance, expenses,
   * loto_tickets, debt_ledger, supplier_ledger, wallet_exchanges,
   * drawer_transfers.
   * Sales are handled separately (status + sale_items).
   *
   * Primary Cash Drawer plan §8.6 (rule 20): `system_float_topups` (v139) is
   * rebuilt by migration v140 as `drawer_transfers` (same `is_refunded` /
   * `refunded_at` columns, now supporting both General→PCD and PCD→General
   * directions) — the entry below is updated to the new table name so the
   * generic void/refund path keeps owning reversal of a drawer transfer.
   *
   * supplier_ledger uses this as a SOFT-VOID: balance/pool aggregates exclude
   * flagged rows (SupplierRepository), so voiding a supplier payment restores
   * the supplier balance without a compensating row — a compensator cannot
   * net the sign-bucketed FIFO pools, only excluding the original can.
   */
  private _markSourceRefunded(
    sourceTable: string,
    sourceId: number | null,
  ): void {
    if (!sourceId) return;
    // Only mark tables that have the is_refunded column
    const supported = [
      "recharges",
      "financial_services",
      "exchange_transactions",
      "custom_services",
      "maintenance",
      "expenses",
      "loto_tickets",
      "debt_ledger",
      "supplier_ledger",
      "wallet_exchanges",
      "drawer_transfers",
    ];
    if (!supported.includes(sourceTable)) return;
    // tenant_id predicate applies to every legal value of sourceTable above —
    // all are tenant-scoped tables (see scripts/check-tenant-scoping.mjs's
    // __UNRESOLVED__ fail-closed flag on this dynamic-table-name statement).
    this.execute(
      `UPDATE ${sourceTable} SET is_refunded = 1, refunded_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
      sourceId,
      getCurrentTenantId(),
    );
  }

  /**
   * Reversing a SUPPLIER_PAYMENT whose ledger entry was a manual PAYMENT must
   * also give back the FIFO purchase coverage the payment consumed
   * (SupplierRepository.recordSupplierCashflow PAY walks supplier_purchases
   * oldest-first and bumps paid_usd; nothing records the split, so we un-apply
   * the same USD-equivalent reverse-FIFO: newest-covered first, capped at each
   * purchase's paid_usd). No-op for every other transaction shape.
   */
  private _unapplySupplierPurchaseCoverage(original: TransactionEntity): void {
    if (
      original.type !== "SUPPLIER_PAYMENT" ||
      original.source_table !== "supplier_ledger" ||
      !original.source_id
    ) {
      return;
    }
    const tenantId = getCurrentTenantId();
    const ledger = this.queryOne<{
      supplier_id: number;
      entry_type: string;
      amount_usd: number;
      amount_lbp: number;
    }>(
      `SELECT supplier_id, entry_type, amount_usd, amount_lbp FROM supplier_ledger WHERE id = ? AND tenant_id = ?`,
      original.source_id,
      tenantId,
    );
    if (!ledger || ledger.entry_type !== "PAYMENT") return;

    const rate = original.exchange_rate || 89000;
    let remaining =
      Math.abs(ledger.amount_usd) + Math.abs(ledger.amount_lbp) / rate;
    if (remaining <= 0) return;

    const covered = this.query<{ id: number; paid_usd: number }>(
      `SELECT id, paid_usd FROM supplier_purchases
       WHERE supplier_id = ? AND paid_usd > 0 AND tenant_id = ?
       ORDER BY created_at DESC, id DESC`,
      ledger.supplier_id,
      tenantId,
    );
    for (const row of covered) {
      if (remaining <= 0) break;
      const giveBack = Math.min(remaining, row.paid_usd);
      this.execute(
        `UPDATE supplier_purchases SET paid_usd = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
        row.paid_usd - giveBack,
        row.id,
        tenantId,
      );
      remaining -= giveBack;
    }
  }

  /**
   * True when the connected `supplier_ledger` table already carries the v136
   * source_ref_table/source_ref_id columns. Mirrors `_reversePartnerLedger`'s
   * `sqlite_master` existence check — some hand-rolled test-fixture DBs (and,
   * defensively, any DB caught mid-upgrade) predate this migration; querying
   * a column that doesn't exist would throw and break every void/refund on
   * that connection, not just the supplier-sibling cascade. Absent columns
   * means "no siblings can possibly be linked" — genuinely no-op, not a
   * swallowed error.
   */
  private _supplierLedgerHasSourceRefColumns(): boolean {
    const hasTable = this.db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'supplier_ledger'`,
      )
      .get();
    if (!hasTable) return false;
    const cols = this.db
      .prepare(`PRAGMA table_info(supplier_ledger)`)
      .all() as { name: string }[];
    return (
      cols.some((c) => c.name === "source_ref_table") &&
      cols.some((c) => c.name === "source_ref_id")
    );
  }

  /**
   * LIRA-091 — refuse a void/refund up-front (before any write) if this
   * transaction's own event booked an auto supplier-ledger sibling
   * (FinancialServiceRepository's is_auto:true BILL-commission /
   * SEND-RECEIVE TOP_UP-PAYMENT rows, linked via
   * supplier_ledger.source_ref_table/source_ref_id — migration v136) that has
   * ALREADY been swept into a supplier settlement
   * (SupplierRepository.settleTransactions). Cascading the sibling's void
   * anyway would unwind its TOP_UP/PAYMENT contribution to a settlement whose
   * SETTLEMENT/SUPPLIER_PAYS_US rows were computed assuming it stayed — the
   * ledger would no longer net to 0 for that batch and nothing here can
   * compensate for it. Blocking beats corrupting (mirrors the split-group
   * void guard's philosophy) — the owner corrects a mis-settled sibling with
   * a manual supplier adjustment instead. A no-op when there is no unrefunded
   * sibling at all (nothing to protect), so a settled WALLET-provider FS row
   * (which never books a sibling) stays voidable.
   */
  private _assertSupplierSiblingsVoidable(original: TransactionEntity): void {
    if (!original.source_table || original.source_id == null) return;
    if (!this._supplierLedgerHasSourceRefColumns()) return;
    const tenantId = getCurrentTenantId();
    const hasUnrefundedSibling = this.queryOne<{ id: number }>(
      `SELECT id FROM supplier_ledger
        WHERE source_ref_table = ? AND source_ref_id = ? AND tenant_id = ?
          AND is_auto = 1 AND COALESCE(is_refunded, 0) = 0
        LIMIT 1`,
      original.source_table,
      original.source_id,
      tenantId,
    );
    if (!hasUnrefundedSibling) return;

    const settlementId = this._supplierSourceSettlementId(
      original.source_table,
      original.source_id,
    );
    if (settlementId != null) {
      throw new DatabaseError(
        `Cannot void/refund — its auto supplier-ledger entry has already been included in settlement #${settlementId}; correct the supplier balance with a manual adjustment instead.`,
        { entityId: original.id },
      );
    }
  }

  /**
   * Settlement marker for the row a source_ref_table/source_ref_id link
   * points at. Only `financial_services` stamps a settlement marker today
   * (SupplierRepository.settleTransactions sets settlement_id) — other
   * source tables have no settlement concept yet and are treated as never
   * settled (returns null), same honest-default shape as
   * `_markSourceRefunded`'s explicit supported-tables list.
   */
  private _supplierSourceSettlementId(
    sourceTable: string,
    sourceId: number,
  ): number | null {
    if (sourceTable !== "financial_services") return null;
    const row = this.queryOne<{ settlement_id: number | null }>(
      `SELECT settlement_id FROM financial_services WHERE id = ? AND tenant_id = ?`,
      sourceId,
      getCurrentTenantId(),
    );
    return row?.settlement_id ?? null;
  }

  /**
   * LIRA-091 — cascade-void every auto supplier-ledger sibling this
   * transaction's own event created. Reuses `_voidTransactionInternal` per
   * sibling (its own separate hidden SUPPLIER_PAYMENT transaction) so
   * drawer/ledger reversal runs through the EXACT same mechanics a manual
   * supplier-payment void uses (rule 14/20, not a second reversal path) —
   * soft-voiding the ledger row is already `_markSourceRefunded`'s job, fired
   * naturally when that recursive call reaches its own step 4 (the sibling's
   * source_table is 'supplier_ledger'). Filtered to `is_auto = 1` so this can
   * only ever touch genuine separate-hidden-transaction siblings, never a
   * link-mode row (whose supplier_ledger.transaction_id IS the caller's own
   * in-flight parent transaction — recursing into that would self-void).
   * Already-refunded siblings (voided independently beforehand, or by an
   * earlier pass of this same cascade) are excluded — idempotent re-entry.
   * A no-op for legacy (pre-v136) rows: they carry no source_ref link and can
   * never be found here — undetectable by design, same limitation LIRA-094
   * documented for its split_group marker. The settled-sibling case never
   * reaches this method — `_assertSupplierSiblingsVoidable` already blocked
   * it before the enclosing db.transaction() began.
   */
  private _cascadeSupplierSiblingVoid(
    original: TransactionEntity,
    userId: number,
  ): void {
    if (!original.source_table || original.source_id == null) return;
    if (!this._supplierLedgerHasSourceRefColumns()) return;
    const tenantId = getCurrentTenantId();
    const siblings = this.query<{ transaction_id: number | null }>(
      `SELECT transaction_id FROM supplier_ledger
        WHERE source_ref_table = ? AND source_ref_id = ? AND tenant_id = ?
          AND is_auto = 1 AND COALESCE(is_refunded, 0) = 0`,
      original.source_table,
      original.source_id,
      tenantId,
    );
    for (const sibling of siblings) {
      if (sibling.transaction_id == null) continue;
      this._voidTransactionInternal(sibling.transaction_id, userId, {
        allowSplitGroupMember: true,
      });
    }
  }

  /**
   * D3 (COUNTERPARTY_CONSOLIDATION_PLAN.md, owner-decided 2026-07-18) —
   * voiding/refunding a DEBT_REPAYMENT transaction must give the debt back,
   * not just the cash. `_reversePayments` already undoes the drawer side
   * (the customer's cash / provider RESERVE legs); this step undoes the
   * LEDGER side `DebtRepository.addRepayment` applied: the 'Repayment'
   * debt_ledger reduction itself, plus the FIFO coverage stamps it bumped
   * (`sales.paid_usd` via `_markSalesPaidFIFO`, `debt_ledger.covered_usd/lbp`
   * via `_coverServiceDebtsFIFO`). This was a long-documented, unowned gap
   * (COUNTERPARTY_LEDGERS.md §7, FEATURE_GUIDE §9) — this method is now its
   * owner.
   *
   * Trigger is DIFFERENT from `_cancelDebt`: this fires only when the
   * REVERSED transaction IS the repayment itself (type DEBT_REPAYMENT,
   * source_table 'debt_ledger'); `_cancelDebt` fires when a MODULE CHARGE
   * transaction (Sale/Recharge/Service/…) is reversed, and its whitelist
   * (MODULE_DEBT_TRANSACTION_TYPES) deliberately EXCLUDES 'Repayment' rows
   * (pinned by debtReversal.test.ts's "whitelist guard" case) so that
   * reversing a charge never un-pays an unrelated, later repayment. The two
   * never fire for the same call — no double-reversal risk, no conflict with
   * that existing pin.
   *
   * Boundary (CQ-10): a bundled 'Debt Discount' posts its OWN
   * COUNTERPARTY_DISCOUNT transaction — a DIFFERENT transaction_id, whose
   * source_id is the 'Debt Discount' ledger row, never the repayment's own
   * 'Repayment' row. This method only ever looks up `original.source_id`
   * (the repayment's row), so it can never see or touch the discount's row
   * or transaction. COUNTERPARTY_DISCOUNT is NON_REVERSIBLE by design
   * (correcting a discount is always an opposite discount, never a void) —
   * voiding the cash side of a discounted repayment must leave the bundled
   * discount exactly as forgiven as before.
   *
   * Approximation (same shape as `_unapplySupplierPurchaseCoverage`):
   * nothing records exactly which sale/charge rows THIS repayment's coverage
   * landed on, so the give-back budget is re-derived from the 'Repayment'
   * row's absolute amounts and applied newest-covered-first, capped at each
   * row's CURRENT coverage — mirroring `_markSalesPaidFIFO` →
   * `_coverServiceDebtsFIFO`'s oldest-first/remainder-chaining shape, run in
   * reverse. Exact when reversed in LIFO order (the common case: void/refund
   * soon after the repayment); interleaved repayments on the same client can
   * give back coverage a DIFFERENT repayment applied — the same accepted
   * imprecision as the supplier analog.
   *
   * Viewer note: the new 'Repayment Reversal' row is deliberately NOT added
   * to `ACCOUNT_CHARGE_PREDICATE`'s exclusion (unlike 'Refund Reversal').
   * The repayment's OWN 'Repayment' row already satisfies that predicate
   * (pre-existing, independent of this fix) and gets reconstructed as a
   * CUSTOMER_ACCOUNT leg on the repayment's row regardless; excluding the
   * reversal here would leave that pre-existing leg unbalanced (looking like
   * a standing on-account charge) instead of netting to zero. Cosmetic only
   * — no ledger amount is affected either way.
   */
  private _restoreRepaymentDebt(
    original: TransactionEntity,
    userId: number,
  ): void {
    if (
      original.type !== "DEBT_REPAYMENT" ||
      original.source_table !== "debt_ledger" ||
      !original.source_id
    ) {
      return;
    }
    const tenantId = getCurrentTenantId();
    const ledger = this.queryOne<{
      client_id: number;
      amount_usd: number;
      amount_lbp: number;
      transaction_type: string;
    }>(
      `SELECT client_id, amount_usd, amount_lbp, transaction_type
       FROM debt_ledger WHERE id = ? AND tenant_id = ?`,
      original.source_id,
      tenantId,
    );
    // Defensive: a DEBT_REPAYMENT transaction's source_id always points at
    // its own 'Repayment' row, but never trust a join blindly.
    if (!ledger || ledger.transaction_type !== "Repayment") return;

    // The 'Repayment' row stores NEGATIVE amounts (a debt reduction); the
    // give-back budget — and the compensating row below — use the absolute
    // value so the restore is a straightforward sign flip.
    const budgetUsd = Math.abs(ledger.amount_usd);
    const budgetLbp = Math.abs(ledger.amount_lbp);

    // 1. Restore the debt: a compensating row that negates the 'Repayment'
    // reduction. Named 'Repayment Reversal' — NOT '<Module> Debt' — so the
    // rule-20 guard (moduleDebtTypes.guard.test.ts), which only classifies
    // string literals ending in " Debt", never has to classify it; same
    // shape as the existing 'Refund Reversal' precedent used by _cancelDebt.
    // Linked via transaction_id = original.id (the DEBT_REPAYMENT's own id),
    // mirroring _cancelDebt's originalTxnId linking, not the reversal row's
    // own new id.
    this.execute(
      `INSERT INTO debt_ledger
        (client_id, transaction_type, amount_usd, amount_lbp, transaction_id, note, created_by, tenant_id)
       VALUES (?, 'Repayment Reversal', ?, ?, ?, ?, ?, ?)`,
      ledger.client_id,
      budgetUsd,
      budgetLbp,
      original.id,
      "Repayment reversed by refund/void",
      userId,
      tenantId,
    );

    // 2. Unwind the FIFO coverage this repayment applied. Sales absorb first
    // (mirrors _markSalesPaidFIFO's priority in the forward direction); the
    // USD remainder plus the full LBP budget then unwinds module-debt
    // covered_usd/covered_lbp (mirrors _coverServiceDebtsFIFO). Same budget
    // chaining shape as the forward path, just newest-first and giving back
    // instead of taking.
    const consumedBySales = this._unwindSalesPaidFifo(
      ledger.client_id,
      budgetUsd,
      tenantId,
    );
    this._unwindServiceDebtCoverageFifo(
      ledger.client_id,
      Math.max(0, budgetUsd - consumedBySales),
      budgetLbp,
      tenantId,
    );
  }

  /**
   * Reverse-FIFO give-back for `sales.paid_usd` — the exact mirror of
   * `_markSalesPaidFIFO`, but newest-first (instead of oldest-first) and
   * subtracting (instead of adding). Returns the consumed amount so the
   * caller can chain the unconsumed remainder into the service-debt unwind,
   * exactly like the forward direction chains ITS remainder into
   * `_coverServiceDebtsFIFO`.
   *
   * `s.status = 'completed'` is REQUIRED here (not cosmetic) — it's what
   * _markSalesPaidFIFO's own SELECT carries and this query must keep: a sale
   * that has since been voided/refunded gets a SECOND `transactions` row
   * pointing at the same `source_id` (a VOID reversal keeps `type='SALE'`; a
   * REFUND row does too), so without this filter the JOIN would return that
   * sale TWICE and double-subtract its `paid_usd` on the SAME allocateFifo
   * pass. Excluding non-'completed' sales keeps the join 1:1, same as the
   * forward direction.
   */
  private _unwindSalesPaidFifo(
    clientId: number,
    budgetUsd: number,
    tenantId: number,
  ): number {
    if (budgetUsd <= 0) return 0;

    const paidSales = this.query<{ id: number; paid_usd: number }>(
      `SELECT s.id, s.paid_usd
       FROM sales s
       JOIN transactions t ON t.source_table = 'sales' AND t.source_id = s.id
         AND t.tenant_id = s.tenant_id
       WHERE t.client_id = ? AND s.status = 'completed' AND s.paid_usd > 0
         AND s.tenant_id = ?
       ORDER BY s.created_at DESC, s.id DESC`,
      clientId,
      tenantId,
    );

    // CQ-2 shared allocator; epsilon 0.01 matches _markSalesPaidFIFO's own
    // tolerance exactly.
    const takes = allocateFifo(
      paidSales.map((s) => ({ id: s.id, outstanding: s.paid_usd })),
      budgetUsd,
      0.01,
    );

    const upd = this.db.prepare(
      `UPDATE sales SET paid_usd = paid_usd - ? WHERE id = ? AND tenant_id = ?`,
    );
    let consumed = 0;
    for (const t of takes) {
      upd.run(t.take, t.id, tenantId);
      consumed += t.take;
    }
    return consumed;
  }

  /**
   * Reverse-FIFO give-back for `debt_ledger.covered_usd/covered_lbp` — the
   * exact mirror of `_coverServiceDebtsFIFO`: same MODULE-debt type set,
   * newest-first, each currency allocated independently via the shared
   * allocator and merged into one UPDATE per row.
   */
  private _unwindServiceDebtCoverageFifo(
    clientId: number,
    budgetUsd: number,
    budgetLbp: number,
    tenantId: number,
  ): void {
    if (budgetUsd <= 0.005 && budgetLbp <= 1) return;

    const covered = this.query<{
      id: number;
      covered_usd: number;
      covered_lbp: number;
    }>(
      `SELECT id, covered_usd, covered_lbp
       FROM debt_ledger
       WHERE client_id = ? AND tenant_id = ?
         AND transaction_type IN ('Recharge Debt', 'Service Debt', 'Custom Service Debt', 'Loto Debt', 'Maintenance Debt')
         AND (covered_usd > 0 OR covered_lbp > 0)
       ORDER BY created_at DESC, id DESC`,
      clientId,
      tenantId,
    );

    const usdTakes = allocateFifo(
      covered.map((r) => ({ id: r.id, outstanding: r.covered_usd })),
      budgetUsd,
      0.005,
    );
    const lbpTakes = allocateFifo(
      covered.map((r) => ({ id: r.id, outstanding: r.covered_lbp })),
      budgetLbp,
      1,
    );
    const usdById = new Map(usdTakes.map((t) => [t.id, t.take]));
    const lbpById = new Map(lbpTakes.map((t) => [t.id, t.take]));

    const upd = this.db.prepare(
      `UPDATE debt_ledger SET covered_usd = covered_usd - ?, covered_lbp = covered_lbp - ?
       WHERE id = ? AND tenant_id = ?`,
    );
    for (const row of covered) {
      const takeUsd = usdById.get(row.id) ?? 0;
      const takeLbp = lbpById.get(row.id) ?? 0;
      if (takeUsd > 0 || takeLbp > 0) {
        upd.run(takeUsd, takeLbp, row.id, tenantId);
      }
    }
  }

  /**
   * ONE definition (rule 14) of "signed net customer-facing total per
   * currency, summed over overridable legs" — shared by
   * `_validateRefundLegOverride` (the pre-write guard) and the
   * override-application step in `_reversePayments`, so the sign the
   * reversal restores can never drift from the total the validator checked
   * against. `rows` is whatever the caller already fetched (either
   * `getPaymentsByTransactionId`'s result or the raw `payments` query
   * `_reversePayments` runs for its own mirror loop) — this never re-queries.
   */
  private _overridableNetByCurrency(
    rows: Array<{
      method: string;
      drawer_name: string;
      currency_code: string;
      amount: number;
      note: string | null;
    }>,
  ): Record<string, number> {
    const net: Record<string, number> = {};
    for (const p of rows) {
      if (!isOverridableLeg(p)) continue;
      net[p.currency_code] = (net[p.currency_code] ?? 0) + p.amount;
    }
    return net;
  }

  /**
   * LIRA-078 (refund tender-selection modal, money contract): validate the
   * operator's chosen return legs against THIS transaction's own net
   * customer-facing total, per currency, BEFORE any row is written. Reuses
   * `isOverridableLeg` (rule 14) — the SAME predicate `_reversePayments`
   * below uses to decide which original rows the override replaces, so the
   * two can never disagree about what "customer-facing" means.
   *
   * NET-BASED OVERRIDE (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md Phase B): the
   * override describes the MAGNITUDE of the row's net customer-facing
   * movement, never a per-leg mirror — the operator picks the METHOD(s), the
   * DIRECTION is always restored from the original net's sign (see
   * `_reversePayments`). This is why `originalNet` here is left SIGNED (a
   * plain SALE/SEND's net is positive — the customer paid in; a fee-on-top
   * RECEIVE's overridable legs are the payout leg (negative, the shop paid
   * the customer x) and the customer-paid fee leg (positive, +f) — netting to
   * `f - x`, negative whenever the fee is smaller than the payout, which it
   * always is) while `refundLegs[].amount` is validated to be a positive
   * MAGNITUDE (checked below) and `overrideNet` sums those positive
   * magnitudes. The check is therefore `|originalNet| == overrideNet` — NOT
   * `originalNet == overrideNet` (comparing a signed total to an unsigned one
   * would hard-reject every RECEIVE override, since a $95 override could
   * never equal a -$95 net) — matching the frontend's identical
   * `Math.abs(originalNet[c])` comparison in `validateRefundLines`
   * (refundLegOverride.ts) so the modal's Confirm gate and the backend's
   * authority never disagree about what's valid.
   *
   * Worked example (x=100 payout, f=5 customer-paid fee, CASH throughout):
   * originalNet.USD = f - x = 5 - 100 = -95. Operator overrides with ONE
   * CASH leg, amount 95 (a positive magnitude — matches |−95|). Applied in
   * `_reversePayments`, that leg is written with the ORIGINAL net's sign
   * negated: since originalNet is negative, the reversal leg posts +95 to the
   * chosen drawer — arithmetically identical to reversing the two original
   * legs individually (+100 payout given back, -5 fee returned = +95 net),
   * just collapsed into one line the way the operator sees it.
   */
  private _validateRefundLegOverride(
    transactionId: number,
    refundLegs: RefundLegOverride[],
  ): void {
    const EPSILON: Record<string, number> = { USD: 0.01, LBP: 1 };

    const originalRows = this.getPaymentsByTransactionId(transactionId);
    const originalNet = this._overridableNetByCurrency(originalRows);

    const paymentMethodRepo = getPaymentMethodRepository();
    const overrideNet: Record<string, number> = {};
    for (const leg of refundLegs) {
      if (!(leg.amount > 0)) {
        throw new DatabaseError(
          `Refund method override: leg amount must be greater than 0 (got ${leg.amount} ${leg.currencyCode})`,
          { entityId: transactionId },
        );
      }
      if (!CUSTOMER_CASH_CURRENCIES.has(leg.currencyCode)) {
        throw new DatabaseError(
          `Refund method override: currency "${leg.currencyCode}" is not USD or LBP — cross-currency refund is not supported`,
          { entityId: transactionId },
        );
      }
      const pm = paymentMethodRepo.getByCode(leg.method);
      if (!pm || pm.is_active !== 1 || pm.affects_drawer !== 1) {
        throw new DatabaseError(
          `Refund method override: "${leg.method}" is not an active, drawer-affecting payment method`,
          { entityId: transactionId },
        );
      }
      overrideNet[leg.currencyCode] =
        (overrideNet[leg.currencyCode] ?? 0) + leg.amount;
    }

    const currencies = new Set([
      ...Object.keys(originalNet),
      ...Object.keys(overrideNet),
    ]);
    if (currencies.size === 0) {
      throw new DatabaseError(
        "Refund method override: this transaction has no customer-facing payment to refund",
        { entityId: transactionId },
      );
    }
    for (const currency of currencies) {
      // Magnitude comparison (see the doc comment above): originalNet is
      // SIGNED (negative for a fee-on-top RECEIVE, whose payout leg
      // outweighs the customer-paid fee leg), override is always a positive
      // magnitude sum — comparing the signed value to the unsigned one
      // directly would hard-reject every such row.
      const original = Math.abs(originalNet[currency] ?? 0);
      const override = overrideNet[currency] ?? 0;
      const epsilon = EPSILON[currency] ?? 0.01;
      if (Math.abs(original - override) > epsilon) {
        throw new DatabaseError(
          `Refund method override: ${currency} totals do not match the original payment — ` +
            `original ${original}, refund legs total ${override}`,
          { entityId: transactionId },
        );
      }
    }
  }

  /**
   * Primary Cash Drawer plan §8.2 (LIRA-078): the `{provider, baseSystem}`
   * context `resolveServiceCashDrawer` needs to route an OVERRIDDEN refund
   * leg back into the PCD instead of General, when the reversed transaction
   * IS a financial-service SEND/RECEIVE running on the shop's primary
   * system. Only `financial_services` rows carry a `provider` — every other
   * reversible source table (sales, recharges, custom services, ...) has no
   * primary-system concept, so this returns null for them and the caller
   * falls back to the plain `paymentMethodToDrawerName` mapping unchanged
   * (mirrors `_supplierSourceSettlementId`'s same "only FS rows are
   * relevant" shape). `resolveServiceCashDrawer` itself is a no-op whenever
   * `provider !== baseSystem` (secondary-system / partner-through legs), so
   * returning a context here never mis-routes those cases either.
   */
  private _financialServiceCashDrawerCtx(
    originalTxnId: number,
  ): ServiceCashDrawerContext | null {
    const tenantId = getCurrentTenantId();
    const original = this.queryOne<{
      source_table: string;
      source_id: number | null;
    }>(
      `SELECT source_table, source_id FROM transactions WHERE id = ? AND tenant_id = ?`,
      originalTxnId,
      tenantId,
    );
    if (
      !original ||
      original.source_table !== "financial_services" ||
      original.source_id == null
    ) {
      return null;
    }

    const fs = this.queryOne<{ provider: string }>(
      `SELECT provider FROM financial_services WHERE id = ? AND tenant_id = ?`,
      original.source_id,
      tenantId,
    );
    if (!fs) return null;

    // Same defensive shape as FinancialServiceRepository's own baseSystem
    // read: system_settings may be absent in minimal/test schemas, so a
    // missing/unreadable setting defaults to OMT rather than throwing and
    // breaking every refund override on that connection.
    let baseSystem: BaseSystem = "OMT";
    try {
      const row = this.db
        .prepare(
          `SELECT value FROM system_settings WHERE key_name = 'shop_base_system' AND tenant_id = ?`,
        )
        .get(tenantId) as { value?: string } | undefined;
      if (row?.value === "WHISH") baseSystem = "WHISH";
    } catch {
      // system_settings may be absent in minimal/test schemas — default to OMT.
    }

    return { provider: fs.provider, baseSystem };
  }

  private _reversePayments(
    originalTxnId: number,
    reversalTxnId: number,
    userId: number,
    refundLegOverride?: RefundLegOverride[],
  ): void {
    const tenantId = getCurrentTenantId();
    const payments = this.query<{
      method: string;
      drawer_name: string;
      currency_code: string;
      amount: number;
      note: string | null;
    }>(
      `SELECT method, drawer_name, currency_code, amount, note
       FROM payments WHERE transaction_id = ? AND tenant_id = ?`,
      originalTxnId,
      tenantId,
    );

    for (const p of payments) {
      // LIRA-078: when the operator chose override return method(s), skip
      // mirroring the customer-facing legs verbatim here — they are replaced
      // by refundLegOverride below instead. Every OTHER (internal
      // bookkeeping) leg — provider stock/reserve drawers, fee/transfer
      // markers, crypto legs, etc. — still mirrors exactly as before,
      // regardless of the override, since none of those represent "how the
      // operator hands the customer's money back."
      if (refundLegOverride && isOverridableLeg(p)) continue;

      const negatedAmount = -p.amount;
      insertPaymentRow(this.db, {
        transactionId: reversalTxnId,
        method: p.method,
        drawerName: p.drawer_name,
        currencyCode: p.currency_code,
        amount: negatedAmount,
        note: "Reversal",
        createdBy: userId,
        tenantId,
      });
      applyDrawerDelta(this.db, {
        drawerName: p.drawer_name,
        currencyCode: p.currency_code,
        delta: negatedAmount,
        tenantId,
      });
    }

    if (refundLegOverride) {
      // Primary Cash Drawer plan §8.2 (LIRA-078): a replacement leg must NOT
      // blindly re-derive its drawer from the payment method alone — an
      // overridden CASH refund of a primary-system financial-service
      // SEND/RECEIVE has to land back in the PCD it came out of, not
      // General. Resolved ONCE per override call (not per leg) via the same
      // one-definition resolver every other primary-system cash leg uses
      // (rule 14); it falls through to plain `paymentMethodToDrawerName`
      // unchanged for every non-FS / non-primary-system transaction, so this
      // is safe even when `cashDrawerCtx` is null.
      const cashDrawerCtx = this._financialServiceCashDrawerCtx(originalTxnId);
      // BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md Phase B: the override leg carries
      // a positive MAGNITUDE only (validated in `_validateRefundLegOverride`)
      // — the DIRECTION it posts in must be restored from the sign of the
      // ORIGINAL overridable net for that currency, computed here from the
      // SAME `payments` rows the mirror loop above already fetched (rule 14 —
      // one query, one predicate, no drift between "what got skipped" and
      // "what sign the replacement gets"). A plain money-IN row (SALE/SEND: a
      // positive net, e.g. +100 cash) reverses by SUBTRACTING from the
      // chosen drawer — unchanged from pre-Phase-B behavior. A fee-on-top
      // RECEIVE's overridable legs net NEGATIVE (payout f-x, e.g. 5-100=-95:
      // the shop paid the customer more than the fee it collected back), so
      // its override reverses by ADDING to the chosen drawer instead — undoing
      // the OUT movement the original transaction made. See the worked
      // example in `_validateRefundLegOverride`'s doc comment. A currency
      // whose original net is exactly 0 can only be reached here by an
      // override leg of amount 0, which the validator already rejects
      // (`leg.amount > 0` is required) — so the `-1` default below is never
      // actually exercised, kept only as the historically-safe fallback.
      const originalNetByCurrency = this._overridableNetByCurrency(payments);
      for (const leg of refundLegOverride) {
        const drawerName = cashDrawerCtx
          ? resolveServiceCashDrawer(leg.method, cashDrawerCtx)
          : paymentMethodToDrawerName(leg.method);
        const originalNet = originalNetByCurrency[leg.currencyCode] ?? 0;
        const reversalSign = originalNet < 0 ? 1 : -1;
        const signedAmount = reversalSign * leg.amount;
        insertPaymentRow(this.db, {
          transactionId: reversalTxnId,
          method: leg.method,
          drawerName,
          currencyCode: leg.currencyCode,
          amount: signedAmount,
          note: "Refund (method override)",
          createdBy: userId,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName,
          currencyCode: leg.currencyCode,
          delta: signedAmount,
          tenantId,
        });
      }
    }
  }

  /**
   * Restore stock for all items in a sale.
   */
  private _restoreStock(saleId: number): void {
    const tenantId = getCurrentTenantId();
    const items = this.query<{ product_id: number; quantity: number }>(
      `SELECT product_id, quantity FROM sale_items WHERE sale_id = ? AND tenant_id = ?`,
      saleId,
      tenantId,
    );

    const restoreStmt = this.db.prepare(
      `UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ? AND tenant_id = ?`,
    );

    for (const item of items) {
      restoreStmt.run(item.quantity, item.product_id, tenantId);
    }
  }

  /**
   * Cancel the MODULE-CHARGE debt_ledger entries linked to a transaction by
   * inserting a reversing "Refund Reversal" entry per charge, negating BOTH
   * currencies (module debts are per-currency — an LBP recharge debt lives
   * entirely in amount_lbp).
   *
   * Scoped to MODULE_DEBT_TRANSACTION_TYPES, never a blanket transaction_id
   * match: 'Repayment' rows are back-linked to a transaction too and negating
   * one would un-pay a debt. No drawer is touched here — an account-charged
   * leg took no cash, so its reversal must be ledger-only.
   */
  private _cancelDebt(originalTxnId: number, userId: number): void {
    const tenantId = getCurrentTenantId();
    // Rule 20: also reverse 'CREDIT_DEPOSIT' rows carrying a REAL
    // transaction_id — the ones a flow writes as a side effect (change
    // returned as store credit, a RECEIVE cashed out to CUSTOMER_ACCOUNT, the
    // Binance/app-wallet equivalent — see DebtRepository.addCredit's doc).
    // Deliberately NOT added to the exported MODULE_DEBT_TRANSACTION_TYPES
    // whitelist: that constant is guarded by
    // constants/__tests__/moduleDebtTypes.guard.test.ts as "module CHARGE
    // types named '<Module> Debt'" — a credit isn't a charge and doesn't
    // match that naming convention, and 'CREDIT_DEPOSIT' would fail the
    // guard's dead-entry check. Local to this method only. A row with
    // transaction_id = NULL (standalone/manual credits, voucher deposits with
    // no originating transaction) never matches `transaction_id = ?` below,
    // so this stays surgical — see
    // TransactionRepository.debtReversal.test.ts's whitelist guard test and
    // ServiceStoreCreditReversal.test.ts's negative control.
    const CANCELLABLE_LEDGER_TYPES = [
      ...MODULE_DEBT_TRANSACTION_TYPES,
      "CREDIT_DEPOSIT",
    ];
    const typePlaceholders = CANCELLABLE_LEDGER_TYPES.map(() => "?").join(", ");
    const debts = this.query<{
      id: number;
      client_id: number;
      amount_usd: number;
      amount_lbp: number;
    }>(
      `SELECT id, client_id, amount_usd, amount_lbp FROM debt_ledger
       WHERE transaction_id = ? AND transaction_type IN (${typePlaceholders}) AND tenant_id = ?`,
      originalTxnId,
      ...CANCELLABLE_LEDGER_TYPES,
      tenantId,
    );

    const insertReversal = this.db.prepare(`
      INSERT INTO debt_ledger (
        client_id, transaction_type, amount_usd, amount_lbp, transaction_id, note, created_by, tenant_id
      ) VALUES (?, 'Refund Reversal', ?, ?, ?, 'Debt cancelled by refund/void', ?, ?)
    `);

    for (const d of debts) {
      insertReversal.run(
        d.client_id,
        -d.amount_usd,
        -d.amount_lbp,
        originalTxnId,
        userId,
        tenantId,
      );
    }
  }

  /**
   * Reverse any `partner_ledger` rows tied to a voided/refunded transaction.
   *
   * Type-agnostic (rule 20) and looked up by `reference_table`/`reference_id`
   * — NOT a `transaction_id` FK like debt_ledger — because partner_ledger has
   * none. This is what closes a PRE-EXISTING gap: before this method existed,
   * neither `voidTransaction` nor `refundTransaction` touched partner_ledger
   * at all, so voiding/refunding ANY partner transaction (FOR_OMT, THROUGH_*,
   * and now FOR_POS) stranded its ledger row permanently.
   *
   * The reversal reuses the SAME `transaction_type` (never a generic
   * ADJUSTMENT) with the OPPOSITE `direction` — required so the balance nets
   * to zero within the specific FOR_%/THROUGH_% bucket the original row
   * counted against, not just the partner's grand total.
   */
  private _reversePartnerLedger(
    original: TransactionEntity,
    userId: number,
    reason: "void" | "refund",
  ): void {
    if (!original.source_table || original.source_id == null) return;
    // LIRA-085: a transaction whose OWN source_table IS 'partner_ledger'
    // (PARTNER_SETTLEMENT/PARTNER_PAYMENT — its source_id points at the
    // settlement/payment's own ledger row) is never a legitimate target for
    // THIS method's reference_table/reference_id scan. That scan exists to
    // find FOR_%/THROUGH_% rows tied back to the CAUSING transaction (source
    // tables like 'sales'/'financial_services') — never partner_ledger rows
    // that reference ANOTHER partner_ledger row. Since LIRA-085 stamped the
    // bundled CQ-10 discount's OWN reference_table='partner_ledger'/
    // reference_id=<settlement row id> link (so
    // `_reversePartnerSettlementLedger` can find and sweep it), without this
    // guard THIS method's identical reference_table/reference_id query would
    // match that SAME discount row and double-reverse it. No existing
    // behavior depends on this method running for a 'partner_ledger'-sourced
    // transaction — those types were all NON_REVERSIBLE before LIRA-085, so
    // this method was never reached with that source_table until now.
    if (original.source_table === "partner_ledger") return;
    const tenantId = getCurrentTenantId();

    // Only partner (FOR_*/THROUGH_*) transactions have rows to reverse; a void
    // with nothing to scan is a no-op. Skip cleanly when partner_ledger is
    // absent (some hand-rolled test DBs omit it) rather than hard-crash.
    const hasTable = this.db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'partner_ledger'`,
      )
      .get();
    if (!hasTable) return;

    const entries = this.query<{
      partner_id: number;
      transaction_type: string | null;
      amount: number;
      currency: string;
      direction: "DEBIT" | "CREDIT";
    }>(
      `SELECT partner_id, transaction_type, amount, currency, direction
       FROM partner_ledger
       WHERE reference_table = ? AND reference_id = ? AND tenant_id = ?`,
      original.source_table,
      original.source_id,
      tenantId,
    );

    const insertReversal = this.db.prepare(`
      INSERT INTO partner_ledger (
        partner_id, transaction_type, reference_table, reference_id,
        amount, currency, direction, notes, user_id, tenant_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    const verb = reason === "void" ? "voided" : "refunded";
    for (const e of entries) {
      insertReversal.run(
        e.partner_id,
        e.transaction_type,
        original.source_table,
        original.source_id,
        e.amount,
        e.currency,
        e.direction === "DEBIT" ? "CREDIT" : "DEBIT",
        `Reversal of ${verb} txn #${original.id}`,
        userId,
        tenantId,
      );
    }
  }

  /**
   * LIRA-085 — reversal owner for PARTNER_SETTLEMENT / PARTNER_PAYMENT (rule
   * 20). These used to be flatly `NON_REVERSIBLE_TRANSACTION_TYPES` — the
   * documented blocker was "the FIFO covered_amount stamps a settlement
   * applies to FOR_% rows have no unwind mechanism." That mechanism now
   * exists (`_unwindPartnerSettlementCoverage` below, mirroring
   * `PartnerRepository.applySettlementCoverage` in reverse).
   *
   * Different lookup shape from `_reversePartnerLedger`: THIS transaction's
   * own `source_table`/`source_id` (`'partner_ledger'`/entry.id) point AT
   * the settlement/payment's own ledger row — it is not a row that
   * REFERENCES the transaction being reversed (which is what
   * `_reversePartnerLedger`'s `reference_table`/`reference_id` lookup finds
   * for FOR_%/THROUGH_% rows). Both methods run unconditionally on every
   * void/refund; each is a no-op unless its own shape matches.
   *
   * partner_ledger has no soft-void column — every reversal here is a NEW
   * compensating row (same `transaction_type`, opposite `direction`), same
   * convention `_reversePartnerLedger` already uses. Drawer/cash is handled
   * for free by the generic `_reversePayments` (the settlement's own
   * `payments` row(s) — single-leg or CQ-11 split — reverse before this
   * method runs); a CLIENT_ACCOUNT-method settlement moved no drawer cash at
   * all, so that step is simply a no-op for it, and this method's ledger/
   * coverage restore is identical either way.
   *
   * CQ-10 bundled discount: unlike D3's DEBT_REPAYMENT precedent (a bundled
   * discount stays untouched, a SEPARATE non-reversible transaction), THIS
   * ticket's own acceptance text requires the opposite — "COUNTERPARTY_
   * DISCOUNT bundled inside a settlement must be handled by that
   * settlement's reversal (net to 0)". Found via the discount's own
   * partner_ledger row's `reference_table='partner_ledger'`/`reference_id=
   * <settlement row id>` link (stamped by `PartnerService.settle()`,
   * LIRA-085 — previously these two rows were linked only by time
   * proximity, which a reversal method cannot rely on). Its ledger row gets
   * the same compensating-row treatment; its COUNTERPARTY_DISCOUNT
   * transaction's signed profit is negated by a NEW reversal transaction
   * (never mutate the original — same additive convention as
   * `_cancelDebt`/`_restoreRepaymentDebt`). PARTNER_PAYMENT never carries a
   * bundled discount (`recordPartnerTransaction` has no discount parameter),
   * so this step is naturally a no-op for that type.
   *
   * Coverage unwind budget = |settlement.amount| + |bundled discount.amount|
   * (both apply against the exact same targetDirection FOR_% bucket, per
   * `PartnerRepository.addLedgerEntry`'s coverage trigger) — combined into
   * ONE newest-covered-first give-back, mirroring the D3 repayment/
   * service-debt reverse-FIFO shape (same accepted imprecision under
   * interleaved settlements on the same partner — exact when reversed in
   * LIFO order, the common case).
   */
  private _reversePartnerSettlementLedger(
    original: TransactionEntity,
    userId: number,
  ): void {
    if (
      (original.type !== "PARTNER_SETTLEMENT" &&
        original.type !== "PARTNER_PAYMENT") ||
      original.source_table !== "partner_ledger" ||
      original.source_id == null
    ) {
      return;
    }
    const tenantId = getCurrentTenantId();
    const hasTable = this.db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'partner_ledger'`,
      )
      .get();
    if (!hasTable) return;

    const entry = this.queryOne<{
      partner_id: number;
      transaction_type: string | null;
      amount: number;
      currency: string;
      direction: "DEBIT" | "CREDIT";
    }>(
      `SELECT partner_id, transaction_type, amount, currency, direction
       FROM partner_ledger WHERE id = ? AND tenant_id = ?`,
      original.source_id,
      tenantId,
    );
    if (!entry) return;

    const insertLedgerReversal = this.db.prepare(`
      INSERT INTO partner_ledger (
        partner_id, transaction_type, reference_table, reference_id,
        amount, currency, direction, notes, user_id, tenant_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    // 1. Reverse the settlement/payment's own ledger row.
    insertLedgerReversal.run(
      entry.partner_id,
      entry.transaction_type,
      "partner_ledger",
      original.source_id,
      entry.amount,
      entry.currency,
      entry.direction === "DEBIT" ? "CREDIT" : "DEBIT",
      `Reversal of settlement/payment txn #${original.id}`,
      userId,
      tenantId,
    );

    let coverageBudget = Math.abs(entry.amount);

    // 2. Sweep a bundled CQ-10 discount, if this settlement carried one.
    const discountEntry = this.queryOne<{
      id: number;
      amount: number;
      currency: string;
      direction: "DEBIT" | "CREDIT";
    }>(
      `SELECT id, amount, currency, direction FROM partner_ledger
       WHERE reference_table = 'partner_ledger' AND reference_id = ?
         AND transaction_type = 'DISCOUNT' AND tenant_id = ?`,
      original.source_id,
      tenantId,
    );
    if (discountEntry) {
      insertLedgerReversal.run(
        entry.partner_id,
        "DISCOUNT",
        "partner_ledger",
        original.source_id,
        discountEntry.amount,
        discountEntry.currency,
        discountEntry.direction === "DEBIT" ? "CREDIT" : "DEBIT",
        `Reversal of bundled discount for settlement/payment txn #${original.id}`,
        userId,
        tenantId,
      );
      coverageBudget += Math.abs(discountEntry.amount);

      // Negate the discount's own COUNTERPARTY_DISCOUNT transaction's
      // profit stamp via a NEW compensating transaction (never mutate the
      // original).
      const discountTxn = this.getBySourceId(
        "partner_ledger",
        discountEntry.id,
      );
      if (discountTxn) {
        const reversalTxnId = this.createTransaction({
          type: "COUNTERPARTY_DISCOUNT",
          source_table: "partner_ledger",
          source_id: discountEntry.id,
          user_id: userId,
          amount_usd: 0,
          amount_lbp: 0,
          profit_usd: -discountTxn.profit_usd,
          profit_lbp: -discountTxn.profit_lbp,
          client_id: null,
          summary: `Discount reversed by settlement void/refund #${original.id}`,
          metadata_json: { reversed_discount_txn_id: discountTxn.id },
        });
        this.execute(
          `UPDATE transactions SET reverses_id = ? WHERE id = ? AND tenant_id = ?`,
          discountTxn.id,
          reversalTxnId,
          tenantId,
        );
      }
    }

    // 3. Unwind the combined FIFO coverage both rows applied.
    this._unwindPartnerSettlementCoverage(
      entry.partner_id,
      entry.currency,
      entry.direction,
      coverageBudget,
      tenantId,
    );
  }

  /**
   * Reverse-FIFO give-back for `partner_ledger.covered_amount` — the exact
   * mirror of `PartnerRepository.applySettlementCoverage`: newest-first
   * (instead of oldest-first) and subtracting (instead of adding). `direction`
   * is the settlement/payment's OWN direction (same param
   * `applySettlementCoverage` takes) — the target bucket is derived
   * identically (opposite direction, `FOR_%` type only; `THROUGH_%` rows are
   * never covered by a settlement, so never unwound either).
   */
  private _unwindPartnerSettlementCoverage(
    partnerId: number,
    currency: string,
    direction: "DEBIT" | "CREDIT",
    budget: number,
    tenantId: number,
  ): void {
    if (budget <= 0.005) return;
    const targetDirection = direction === "CREDIT" ? "DEBIT" : "CREDIT";
    const open = this.query<{ id: number; covered_amount: number }>(
      `SELECT id, covered_amount FROM partner_ledger
       WHERE partner_id = ? AND tenant_id = ? AND currency = ?
         AND direction = ?
         AND transaction_type LIKE 'FOR\\_%' ESCAPE '\\'
         AND covered_amount > 0
       ORDER BY created_at DESC, id DESC`,
      partnerId,
      tenantId,
      currency,
      targetDirection,
    );
    const takes = allocateFifo(
      open.map((row) => ({ id: row.id, outstanding: row.covered_amount })),
      budget,
      0.005,
    );
    const upd = this.db.prepare(
      `UPDATE partner_ledger SET covered_amount = covered_amount - ? WHERE id = ? AND tenant_id = ?`,
    );
    for (const t of takes) {
      upd.run(t.take, t.id, tenantId);
    }
  }

  /**
   * LIRA-085 — reversal owner for SUPPLIER_SETTLEMENT (rule 20). This used
   * to be flatly `NON_REVERSIBLE_TRANSACTION_TYPES` alongside
   * LOTO_SETTLEMENT — the documented blocker was "settlement stamps stay in
   * place, and the commission credit to General has no payments row to
   * reverse."
   *
   * OMT/WHISH float model (owner-confirmed 2026-07-29) — updated: under the
   * fee-only model, `SupplierRepository.settleTransactions` no longer funds
   * a commission credit (no `General += commission` / settle-drawer
   * `-= commission` pair, no `SUPPLIER_PAYS_US` ledger row — see that
   * method's doc comment) — there is nothing bespoke left to reverse on the
   * commission side AT ALL. What's left:
   *
   * 1. `financial_services.settlement_id`/`is_settled` stamps — scoped by
   *    `settlement_id = <this settlement's ledger row id>` (never the
   *    metadata id list — only `settlement_id` proves a row STILL belongs
   *    to exactly this settlement at reversal time). `settlement_id` always
   *    clears to NULL. `is_settled` only resets to 0 (with `settled_at`
   *    cleared) for rows where `isPendingSupplierSettlement` (D2, the ONE
   *    shared predicate — `FinancialServiceRepository.ts`) is true — the
   *    EXACT condition `FinancialServiceRepository.createTransaction` used
   *    to decide `is_settled = 0` at creation (see that method's "NOTE on
   *    is_settled vs settlement_id" doc comment; COMMISSION_AT_SETTLEMENT_
   *    PLAN.md §3/Phase 0 — this branches on `commission_model` per row
   *    instead of `commission > 0`, so new-model rows born with
   *    commission = 0 still reverse correctly). Every other row (legacy
   *    cost/price-flow SEND, commission_model = 0 rows with commission = 0)
   *    was ALREADY `is_settled = 1` before this settlement, independent of
   *    `settlement_id` — resetting it would un-realize profit this
   *    settlement never gated in the first place.
   *
   * The SETTLEMENT ledger row itself soft-voids for free via the generic
   * `_markSourceRefunded('supplier_ledger', original.source_id)` step that
   * already runs for every voided/refunded transaction — under the fee-only
   * model that single soft-void is now sufficient to net the ledger back to
   * its pre-settlement (TOP_UP-only) balance, since there is no second
   * (SUPPLIER_PAYS_US) row masking it anymore. The net-payment legs
   * (settleTransactions step 4) DO write real `payments` rows through a real
   * payment-method drawer — under the Primary Cash Drawer plan (§1
   * "Settlement identity") a CASH leg for the primary provider now DOES
   * resolve to `OMT_System`/`Whish_System` (the PCD) instead of General, but
   * `_reversePayments` mirrors whatever `drawer_name` the row actually
   * carries and is drawer-agnostic by design (CLAUDE.md rule 20's generic
   * path), so the generic `_reversePayments` already reverses them for free
   * either way, with no bespoke step needed here.
   * `_assertSupplierSiblingsVoidable` (LIRA-091) already prevents any of
   * this settlement's `financial_service_ids` from being independently
   * voided/refunded while `settlement_id` stays stamped — once this method
   * clears it, those rows become correctable again too, by design (no new
   * guard needed for that direction).
   *
   * COMMISSION_AT_SETTLEMENT_PLAN.md D5/D6 (Phase 0) — a NEW-MODEL
   * (`commission_model` = 1) settlement DOES fund a real commission credit
   * again (`SUPPLIER_PAYS_US`, `SupplierRepository._bookCommissionAtSettlement`)
   * — the fee-only-model paragraph above is about the OLD embedded-commission
   * float, unrelated to this. That credit row is soft-voided for FREE by
   * step 5c's existing LIRA-091 sibling cascade (linked via the SAME
   * `source_ref_table`/`source_ref_id` shape as every other auto supplier
   * sibling); this method additionally deletes the settlement's
   * `supplier_settlements` + `settlement_commission_allocations` rows
   * (`_reverseCommissionAtSettlementRecords` — no soft-void column exists on
   * either table, so DELETE is the correct reversal, not a compensating row).
   */
  private _reverseSupplierSettlement(
    original: TransactionEntity,
    userId: number,
  ): void {
    if (
      original.type !== "SUPPLIER_SETTLEMENT" ||
      original.source_table !== "supplier_ledger" ||
      original.source_id == null
    ) {
      return;
    }
    const tenantId = getCurrentTenantId();

    // Un-stamp financial_services rows THIS exact settlement touched.
    const settled = this.query<{
      id: number;
      provider: string;
      service_type: string;
      commission: number;
      commission_model: number;
    }>(
      `SELECT id, provider, service_type, commission, commission_model FROM financial_services
       WHERE settlement_id = ? AND tenant_id = ?`,
      original.source_id,
      tenantId,
    );
    for (const fs of settled) {
      // COMMISSION_AT_SETTLEMENT_PLAN.md D2 — branch on the ONE shared
      // pending-settlement predicate (isPendingSupplierSettlement), not on
      // `commission > 0` directly. See its doc comment
      // (FinancialServiceRepository.ts) for why the old inline condition
      // breaks for new-model rows.
      const wasPendingSettlement = isPendingSupplierSettlement(fs);
      if (wasPendingSettlement) {
        this.execute(
          `UPDATE financial_services SET settlement_id = NULL, is_settled = 0, settled_at = NULL
           WHERE id = ? AND tenant_id = ?`,
          fs.id,
          tenantId,
        );
      } else {
        this.execute(
          `UPDATE financial_services SET settlement_id = NULL
           WHERE id = ? AND tenant_id = ?`,
          fs.id,
          tenantId,
        );
      }
    }

    // COMMISSION_AT_SETTLEMENT_PLAN.md D5/D6, rule 20 — the commission
    // credit ledger row itself (SUPPLIER_PAYS_US) is already soft-voided for
    // FREE by step 5c's generic LIRA-091 sibling cascade
    // (`_cascadeSupplierSiblingVoid`, which runs BEFORE this method and is
    // keyed off THIS exact `source_table`/`source_id` — the shape
    // `SupplierRepository._bookCommissionAtSettlement` links it with). What
    // remains: the derived audit/reporting records this settlement wrote for
    // a new-model batch.
    this._reverseCommissionAtSettlementRecords(original.source_id, tenantId);
  }

  /**
   * COMMISSION_AT_SETTLEMENT_PLAN.md D5/D6, rule 20 — `supplier_settlements`
   * and `settlement_commission_allocations` have no soft-void column of
   * their own (unlike `supplier_ledger`'s `is_refunded`) — they are pure
   * derived/reporting records with no independent existence once their
   * settlement is voided, so the correct reversal is to DELETE them (not a
   * compensating row, not a flag). The permanent audit trail for "a
   * settlement happened and was voided" lives entirely on the
   * `supplier_ledger` rows (the SETTLEMENT row + the commission credit),
   * which stay forever with `is_refunded = 1` — this method never touches
   * them.
   *
   * Defensive against a pre-v150 connected schema (no such tables at all —
   * same schema-drift-guard shape as every other one in this file): a
   * no-op, which is exactly correct — a settlement on such a schema could
   * never have written to these tables in the first place.
   */
  private _reverseCommissionAtSettlementRecords(
    settlementLedgerId: number,
    tenantId: number,
  ): void {
    const hasAllocationsTable = this.db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settlement_commission_allocations'`,
      )
      .get();
    if (hasAllocationsTable) {
      this.execute(
        `DELETE FROM settlement_commission_allocations WHERE settlement_ledger_id = ? AND tenant_id = ?`,
        settlementLedgerId,
        tenantId,
      );
    }

    const hasSettlementsTable = this.db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'supplier_settlements'`,
      )
      .get();
    if (hasSettlementsTable) {
      this.execute(
        `DELETE FROM supplier_settlements WHERE ledger_entry_id = ? AND tenant_id = ?`,
        settlementLedgerId,
        tenantId,
      );
    }
  }

  /**
   * Refuse a LOTO ticket void/refund up-front (before any write) if the
   * ticket's own checkpoint has already been SETTLED. `LotoCheckpointRepository
   * .settleCheckpoint` freezes `total_sales`/`total_commission`/`total_tickets`/
   * `total_prizes` into the settlement's net-to-zero math (`netSettlement =
   * totalCommission (+ totalCashPrizes) - totalSales`, stamped verbatim onto
   * the SETTLEMENT ledger row) — adjusting a ticket's contribution after that
   * point would desync the checkpoint's frozen totals from a settlement
   * that's already posted, and nothing in this repository can retroactively
   * re-post it. Blocking beats corrupting (same philosophy as
   * `_assertSupplierSiblingsVoidable`, LIRA-091) — the owner corrects a
   * mis-settled ticket with a manual supplier adjustment instead.
   *
   * A ticket that was never checkpointed (`checkpoint_id IS NULL`), or is
   * sitting in a checkpoint that hasn't settled yet, stays reversible —
   * `_reverseLotoSupplierLedger` (below) delta-adjusts the still-open
   * checkpoint's totals so ITS eventual settlement stays correct.
   */
  private _assertLotoTicketVoidable(original: TransactionEntity): void {
    if (
      original.type !== "LOTO" ||
      original.source_table !== "loto_tickets" ||
      original.source_id == null
    ) {
      return;
    }
    const tenantId = getCurrentTenantId();
    const row = this.queryOne<{
      checkpoint_id: number | null;
      is_settled: number | null;
      settlement_id: number | null;
      checkpoint_date: string | null;
    }>(
      `SELECT lc.id AS checkpoint_id, lc.is_settled, lc.settlement_id, lc.checkpoint_date
         FROM loto_tickets lt
         LEFT JOIN loto_checkpoints lc ON lc.id = lt.checkpoint_id AND lc.tenant_id = lt.tenant_id
        WHERE lt.id = ? AND lt.tenant_id = ?`,
      original.source_id,
      tenantId,
    );
    if (!row || row.checkpoint_id == null) return; // never checkpointed → reversible
    if (row.is_settled) {
      const when = row.checkpoint_date ? ` on ${row.checkpoint_date}` : "";
      throw new DatabaseError(
        `Cannot void/refund — this ticket's checkpoint #${row.checkpoint_id} has already been settled${when} (settlement #${row.settlement_id ?? "?"}); correct the supplier balance with a manual adjustment instead.`,
        { entityId: original.id },
      );
    }
  }

  /**
   * Reversal owner (rule 20) for a LOTO ticket sale's `supplier_ledger`
   * TOP_UP row — the one gap the generic void/refund path doesn't already
   * cover for a ticket sale. Everything else a ticket writes is handled
   * generically: `loto_tickets.is_refunded` by `_markSourceRefunded` (v68),
   * the `payments`/drawer legs by `_reversePayments`, the 'Loto Debt'
   * `debt_ledger` row by `_cancelDebt` (`MODULE_DEBT_TRANSACTION_TYPES`), and
   * any FOR_LOTO `partner_ledger` row by `_reversePartnerLedger`. Only the
   * TOP_UP row has no owner: `LotoTicketRepository.createTicket` (CQ-7,
   * a3d09e7, 2026-07-19) writes it in LINK mode
   * (`addLedgerEntry({ transaction_id: txnId })`), not as an
   * `is_auto`/`source_ref_*` sibling, so it is invisible to both
   * `_cascadeSupplierSiblingVoid` and `_assertSupplierSiblingsVoidable` (they
   * only ever scan `is_auto = 1` rows).
   *
   * By the time this runs, `_assertLotoTicketVoidable` has already refused a
   * settled checkpoint before `this.transaction()` even opened, so everything
   * below only ever touches an uncheckpointed ticket or a still-open one.
   *
   * 1. Soft-void (house convention — see `_reverseSupplierSettlement` step 2)
   *    the TOP_UP row keyed on `transaction_id = original.id`: the id
   *    `createTicket` stamped it with at sale time, never the new reversal
   *    row's id — the reversal row never gets a `supplier_ledger` row of its
   *    own, so there is nothing here to mis-target. Re-entrancy is closed
   *    upstream, not by this predicate: voiding an already-VOIDED row throws
   *    before reaching this method, and `_assertReversible` refuses to
   *    void/refund a row that already carries `reverses_id`, so the reversal
   *    row itself can never reach `_reverseLotoSupplierLedger` a second time.
   *    `COALESCE(is_refunded, 0) = 0` is belt-and-suspenders idempotency, the
   *    same guard `_reverseSupplierSettlement` uses.
   *
   * 2. If the ticket sits in a checkpoint that hasn't settled (a settled one
   *    was already blocked above), delta-adjust that checkpoint's frozen
   *    totals by exactly this ticket's own contribution: `total_sales`,
   *    `total_commission`, and `total_tickets` always; `total_prizes` only
   *    when `is_winner = 1` — mirroring
   *    `LotoTicketRepository.getUncheckpointedTotals`'s own
   *    `CASE WHEN is_winner = 1 THEN prize_amount ELSE 0 END` so an unwon
   *    ticket contributes (and so subtracts) 0. This keeps that checkpoint's
   *    OWN future `settleCheckpoint` call — which trusts caller-supplied
   *    totals verbatim — net-to-zero against the now-void ticket's balance
   *    contribution. `total_cash_prizes`/`total_cash_prizes_count` are left
   *    untouched: LOTO_CASH_PRIZE is a separate table/flow, out of scope here.
   */
  private _reverseLotoSupplierLedger(original: TransactionEntity): void {
    if (
      original.type !== "LOTO" ||
      original.source_table !== "loto_tickets" ||
      original.source_id == null
    ) {
      return;
    }
    const tenantId = getCurrentTenantId();

    // 1. Soft-void the link-mode TOP_UP row this ticket sale created.
    this.execute(
      `UPDATE supplier_ledger SET is_refunded = 1, refunded_at = CURRENT_TIMESTAMP
        WHERE transaction_id = ? AND entry_type = 'TOP_UP' AND COALESCE(is_refunded, 0) = 0 AND tenant_id = ?`,
      original.id,
      tenantId,
    );

    // 2. Delta-adjust an unsettled checkpoint (a settled one was already
    // blocked by _assertLotoTicketVoidable before this transaction opened).
    const ticket = this.queryOne<{
      checkpoint_id: number | null;
      sale_amount: number;
      commission_amount: number;
      is_winner: number;
      prize_amount: number;
    }>(
      `SELECT checkpoint_id, sale_amount, commission_amount, is_winner, prize_amount
         FROM loto_tickets WHERE id = ? AND tenant_id = ?`,
      original.source_id,
      tenantId,
    );
    if (ticket?.checkpoint_id != null) {
      this.execute(
        `UPDATE loto_checkpoints
            SET total_sales = total_sales - ?,
                total_commission = total_commission - ?,
                total_tickets = total_tickets - 1,
                total_prizes = total_prizes - ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND is_settled = 0 AND tenant_id = ?`,
        ticket.sale_amount,
        ticket.commission_amount,
        ticket.is_winner ? ticket.prize_amount : 0,
        ticket.checkpoint_id,
        tenantId,
      );
    }
  }

  /**
   * LIRA-090 §8 — reversal owner for `carrier_line_movements` (rule 20).
   * `carrier_lines` has no `is_refunded` column and is absent from
   * `_markSourceRefunded`'s whitelist, so every automated credit/validity
   * mutation a telecom flow makes (`CarrierLineService.applyMovement` —
   * Only Days credit-return, self-charge) is undone HERE instead.
   *
   * Type-agnostic and keyed purely by `transaction_id` (same shape as
   * `_reversePartnerLedger`, not the type-gated shape of
   * `_reverseLotoSupplierLedger`) — the movements table was deliberately
   * designed so ANY flow that mutates a carrier line can hang a movement
   * off ANY transaction, not just one type. Runs unconditionally on every
   * void/refund; a no-op when the table doesn't exist (hand-rolled test
   * DBs predating v140) or when no movement rows match this transaction.
   *
   * Each unreversed movement is undone via
   * `CarrierLineService.reverseMovement` (H3/M2 fix, 2026-07-30 adversarial
   * review) — which restores `validity_expires_at` from the movement's own
   * stored `previous_validity_expires_at` snapshot verbatim, rather than
   * subtracting `validity_days_delta` off whatever the line's CURRENT
   * expiry happens to be. That closes two bugs the old direct
   * `reverseDelta` call had: (a) it silently skipped the validity restore
   * whenever the current expiry was null, with no error and no log, and
   * (b) even when non-null, a naive subtraction could not undo the §5.2
   * "already-expired lines extend from today" rebasing. `reverseMovement`
   * also marks the movement `is_reversed = 1` itself, atomically with the
   * line update — this method no longer touches either table directly.
   *
   * Reuses `CarrierLineMovementRepository.getUnreversedByTransactionId`
   * (rule 14 — one definition of "unreversed movements for a transaction")
   * instead of hand-rolling the same predicate as a second SQL string.
   *
   * Scoped to `is_reversed = 0` so a defensive re-invocation is a no-op —
   * belt-and-suspenders on top of the fact that `voidTransaction`/
   * `refundTransaction` already refuse to run twice on the same original
   * transaction (their own up-front "already voided"/"already refunded"
   * guards), same convention `_reverseLotoSupplierLedger`'s
   * `COALESCE(is_refunded, 0) = 0` guard uses.
   */
  private _reverseCarrierLineMovements(original: TransactionEntity): void {
    const hasTable = this.db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'carrier_line_movements'`,
      )
      .get();
    if (!hasTable) return;

    const movements =
      getCarrierLineMovementRepository().getUnreversedByTransactionId(
        original.id,
      );
    if (movements.length === 0) return;

    const carrierLineService = getCarrierLineService();
    for (const m of movements) {
      carrierLineService.reverseMovement(m.id);
    }
  }

  // ---------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------

  /**
   * Get a summary of all transactions for a given date.
   */
  getDailySummary(date: string): DailySummary {
    const tenantId = getCurrentTenantId();
    const byType = this.query<{
      type: string;
      count: number;
      total_usd: number;
      total_lbp: number;
    }>(
      `SELECT type,
              COUNT(*) AS count,
              SUM(amount_usd) AS total_usd,
              SUM(amount_lbp) AS total_lbp
       FROM transactions
       WHERE DATE(created_at) = ? AND status = 'ACTIVE' AND tenant_id = ?
       GROUP BY type`,
      date,
      tenantId,
    );

    const voids = this.queryOne<{
      void_count: number;
      void_usd: number;
      void_lbp: number;
    }>(
      `SELECT COUNT(*) AS void_count,
              COALESCE(SUM(amount_usd), 0) AS void_usd,
              COALESCE(SUM(amount_lbp), 0) AS void_lbp
       FROM transactions
       WHERE DATE(created_at) = ? AND status = 'VOIDED' AND tenant_id = ?`,
      date,
      tenantId,
    );

    return {
      date,
      total_usd: byType.reduce((sum, r) => sum + r.total_usd, 0),
      total_lbp: byType.reduce((sum, r) => sum + r.total_lbp, 0),
      by_type: byType,
      void_count: voids?.void_count ?? 0,
      void_usd: voids?.void_usd ?? 0,
      void_lbp: voids?.void_lbp ?? 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Debt Aging
  // ---------------------------------------------------------------------------

  /**
   * Get debt aging buckets for a specific client.
   * Buckets: current (0-30 days), 31-60, 61-90, over 90.
   */
  getClientDebtAging(clientId: number): DebtAgingBuckets {
    const row = this.queryOne<{
      current_usd: number;
      current_lbp: number;
      days_31_60_usd: number;
      days_31_60_lbp: number;
      days_61_90_usd: number;
      days_61_90_lbp: number;
      over_90_usd: number;
      over_90_lbp: number;
    }>(
      `SELECT
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) <= 0 THEN amount_usd ELSE 0 END), 0) AS current_usd,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) <= 0 THEN amount_lbp ELSE 0 END), 0) AS current_lbp,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) BETWEEN 1 AND 30 THEN amount_usd ELSE 0 END), 0) AS days_31_60_usd,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) BETWEEN 1 AND 30 THEN amount_lbp ELSE 0 END), 0) AS days_31_60_lbp,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) BETWEEN 31 AND 60 THEN amount_usd ELSE 0 END), 0) AS days_61_90_usd,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) BETWEEN 31 AND 60 THEN amount_lbp ELSE 0 END), 0) AS days_61_90_lbp,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) > 60 THEN amount_usd ELSE 0 END), 0) AS over_90_usd,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) > 60 THEN amount_lbp ELSE 0 END), 0) AS over_90_lbp
      FROM debt_ledger
      WHERE client_id = ?
        AND due_date IS NOT NULL
        AND (amount_usd > 0 OR amount_lbp > 0)
        AND tenant_id = ?`,
      clientId,
      getCurrentTenantId(),
    );

    return {
      client_id: clientId,
      current: { usd: row?.current_usd ?? 0, lbp: row?.current_lbp ?? 0 },
      days_31_60: {
        usd: row?.days_31_60_usd ?? 0,
        lbp: row?.days_31_60_lbp ?? 0,
      },
      days_61_90: {
        usd: row?.days_61_90_usd ?? 0,
        lbp: row?.days_61_90_lbp ?? 0,
      },
      over_90: { usd: row?.over_90_usd ?? 0, lbp: row?.over_90_lbp ?? 0 },
    };
  }

  /**
   * Get all clients with overdue debts (due_date < today AND net balance > 0).
   */
  getOverdueDebts(): OverdueDebtEntry[] {
    const tenantId = getCurrentTenantId();
    return this.query<OverdueDebtEntry>(
      `SELECT
        c.id AS client_id,
        c.full_name AS client_name,
        c.phone_number,
        SUM(d.amount_usd) AS total_usd,
        SUM(d.amount_lbp) AS total_lbp,
        MIN(d.due_date) AS oldest_due_date,
        CAST(MAX(julianday('now') - julianday(d.due_date)) AS INTEGER) AS max_days_overdue,
        COUNT(*) AS entry_count
      FROM debt_ledger d
      JOIN clients c ON c.id = d.client_id AND c.tenant_id = ?
      WHERE d.due_date < datetime('now')
        AND d.due_date IS NOT NULL
        AND d.tenant_id = ?
      GROUP BY d.client_id
      HAVING SUM(d.amount_usd) > 0 OR SUM(d.amount_lbp) > 0
      ORDER BY max_days_overdue DESC`,
      tenantId,
      tenantId,
    );
  }

  /**
   * Get revenue breakdown by module/type for a date range.
   */
  getRevenueByType(
    from: string,
    to: string,
  ): Array<{
    type: string;
    count: number;
    total_usd: number;
    total_lbp: number;
  }> {
    return this.query(
      `SELECT type,
              COUNT(*) AS count,
              SUM(amount_usd) AS total_usd,
              SUM(amount_lbp) AS total_lbp
       FROM transactions
       WHERE status = 'ACTIVE'
         AND created_at >= ? AND created_at <= ?
         AND tenant_id = ?
       GROUP BY type
       ORDER BY total_usd DESC`,
      from,
      to,
      getCurrentTenantId(),
    );
  }

  /**
   * Get revenue breakdown by user for a date range.
   */
  getRevenueByUser(
    from: string,
    to: string,
  ): Array<{
    user_id: number;
    username: string;
    count: number;
    total_usd: number;
    total_lbp: number;
  }> {
    const tenantId = getCurrentTenantId();
    return this.query(
      `SELECT t.user_id,
              u.username,
              COUNT(*) AS count,
              SUM(t.amount_usd) AS total_usd,
              SUM(t.amount_lbp) AS total_lbp
       FROM transactions t
       LEFT JOIN users u ON u.id = t.user_id AND u.tenant_id = ?
       WHERE t.status = 'ACTIVE'
         AND t.created_at >= ? AND t.created_at <= ?
         AND t.tenant_id = ?
       GROUP BY t.user_id
       ORDER BY total_usd DESC`,
      tenantId,
      from,
      to,
      tenantId,
    );
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let transactionRepositoryInstance: TransactionRepository | null = null;

export function getTransactionRepository(): TransactionRepository {
  if (!transactionRepositoryInstance) {
    transactionRepositoryInstance = new TransactionRepository();
  }
  return transactionRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetTransactionRepository(): void {
  transactionRepositoryInstance = null;
}
