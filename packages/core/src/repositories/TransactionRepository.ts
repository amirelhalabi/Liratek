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
  NON_REVERSIBLE_TRANSACTION_TYPES,
  type TransactionStatus,
  type TransactionType,
} from "../constants/transactionTypes.js";
import { BaseRepository, type BaseEntity } from "./BaseRepository.js";
import { DatabaseError, NotFoundError } from "../utils/errors.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

// A `debt_ledger` row represents an on-account CHARGE (customer paid via their
// account) that should surface a "Customer Account" method leg — EXCEPT
// 'Refund Reversal' rows, which cancel debt and belong to a refund/void
// transaction that already shows its own real method. Defined once and reused
// by every account-leg reconstruction query (rule 14).
const ACCOUNT_CHARGE_PREDICATE = "transaction_type <> 'Refund Reversal'";

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
 * (e.g. the Binance USDT crypto leg, OMT/WHISH system-reserve legs, cost-flow
 * provider cost legs, and fee/transfer reporting rows). The LIRA-064 in/out
 * summary must surface ONLY customer-facing cash — so these internal legs are
 * filtered out. Identifiers below mark legs that are NOT customer cash:
 */
// Marker methods used for internal (non-customer) ledger rows.
const INTERNAL_LEG_METHODS = new Set([
  "COMMISSION", // reporting-only fee row (zero delta)
  "PM_FEE", // payment-method fee audit row
  "TRANSFER", // shop→system drawer transfer leg
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
// `*_System` reserve drawers (OMT_System / Whish_System) are matched separately.
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
    p.drawer_name.endsWith("_System") || // OMT_System / Whish_System reserve
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
  return `${a}.amount != 0
      AND ${a}.method NOT IN (${methods})
      AND ${a}.drawer_name NOT IN (${drawers})
      AND ${a}.drawer_name NOT LIKE '%\\_System' ESCAPE '\\'
      AND ${a}.currency_code IN (${currencies})
      AND COALESCE(${a}.note, '') NOT LIKE 'Cost:%'
      AND COALESCE(${a}.note, '') NOT LIKE '%(cost outflow)'
      AND COALESCE(${a}.note, '') NOT LIKE 'Crypto %'`;
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
  amount_usd?: number;
  amount_lbp?: number;
  profit_usd?: number;
  profit_lbp?: number;
  exchange_rate?: number | null;
  client_id?: number | null;
  client_name?: string | null;
  client_phone?: string | null;
  summary?: string;
  metadata_json?: Record<string, unknown>;
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
   */
  createTransaction(data: CreateTransactionInput): number {
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
      data.exchange_rate ?? null,
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
              cst.session_id AS session_id
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
    const original = this.findById(id);
    if (!original) {
      throw new NotFoundError("transactions", id);
    }
    if (original.status === "VOIDED") {
      throw new DatabaseError("Transaction is already voided", {
        entityId: id,
      });
    }
    this._assertReversible(original);
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

      // 5. If SALE: cancel sale, restore stock, cancel debt
      if (original.source_table === "sales" && original.source_id) {
        this.execute(
          `UPDATE sales SET status = 'cancelled' WHERE id = ? AND tenant_id = ?`,
          original.source_id,
          tenantId,
        );
        this._restoreStock(original.source_id);
        this._cancelDebt(id, userId);
      }

      // 6. Supplier payment: un-apply the FIFO purchase coverage the payment
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

  refundTransaction(id: number, userId: number): number {
    const original = this.findById(id);
    if (!original) {
      throw new NotFoundError("transactions", id);
    }
    if (original.status === "VOIDED") {
      throw new DatabaseError("Cannot refund a voided transaction", {
        entityId: id,
      });
    }
    this._assertReversible(original);
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

      // 2. Reverse drawer balances — negate every payment from the original
      this._reversePayments(id, refundId, userId);

      // 3. Mark source module record as refunded
      this._markSourceRefunded(original.source_table, original.source_id);

      // 4. If SALE: mark sale & items as refunded, restore stock, cancel debt
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
        this._cancelDebt(id, userId);
      }

      // 5. Supplier payment: un-apply the FIFO purchase coverage
      this._unapplySupplierPurchaseCoverage(original);

      return refundId;
    });
  }

  /**
   * Shared void/refund gate: refuse types whose side effects the generic
   * reversal cannot undo, and refuse reversing a reversal row (a VOID
   * reversal keeps the original type but carries reverses_id).
   */
  private _assertReversible(original: TransactionEntity): void {
    if (NON_REVERSIBLE_TRANSACTION_TYPES.has(original.type)) {
      throw new DatabaseError(
        `${original.type} transactions cannot be voided or refunded — reverse them from their own module`,
        { entityId: original.id },
      );
    }
    if (original.reverses_id != null) {
      throw new DatabaseError(
        "Cannot void or refund a reversal transaction",
        { entityId: original.id },
      );
    }
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
   * Mark the source module record as refunded.
   * Tables with is_refunded column: recharges, financial_services,
   * exchange_transactions, custom_services, maintenance, expenses,
   * loto_tickets, debt_ledger, supplier_ledger.
   * Sales are handled separately (status + sale_items).
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

  private _reversePayments(
    originalTxnId: number,
    reversalTxnId: number,
    userId: number,
  ): void {
    const tenantId = getCurrentTenantId();
    const payments = this.query<{
      method: string;
      drawer_name: string;
      currency_code: string;
      amount: number;
    }>(
      `SELECT method, drawer_name, currency_code, amount
       FROM payments WHERE transaction_id = ? AND tenant_id = ?`,
      originalTxnId,
      tenantId,
    );

    const insertPayment = this.db.prepare(`
      INSERT INTO payments (
        transaction_id, method, drawer_name, currency_code, amount, note, created_by, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const upsertBalance = this.db.prepare(`
      INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET
        balance = drawer_balances.balance + excluded.balance,
        updated_at = CURRENT_TIMESTAMP
    `);

    for (const p of payments) {
      const negatedAmount = -p.amount;
      insertPayment.run(
        reversalTxnId,
        p.method,
        p.drawer_name,
        p.currency_code,
        negatedAmount,
        "Reversal",
        userId,
        tenantId,
      );
      upsertBalance.run(tenantId, p.drawer_name, p.currency_code, negatedAmount);
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
   * Cancel any debt_ledger entries linked to a transaction.
   * Inserts a reversing "Refund Reversal" entry to zero out the debt.
   */
  private _cancelDebt(originalTxnId: number, userId: number): void {
    const tenantId = getCurrentTenantId();
    const debts = this.query<{
      id: number;
      client_id: number;
      amount_usd: number;
    }>(
      `SELECT id, client_id, amount_usd FROM debt_ledger
       WHERE transaction_id = ? AND transaction_type = 'Sale Debt' AND tenant_id = ?`,
      originalTxnId,
      tenantId,
    );

    const insertReversal = this.db.prepare(`
      INSERT INTO debt_ledger (
        client_id, transaction_type, amount_usd, transaction_id, note, created_by, tenant_id
      ) VALUES (?, 'Refund Reversal', ?, ?, 'Debt cancelled by refund/void', ?, ?)
    `);

    for (const d of debts) {
      insertReversal.run(
        d.client_id,
        -d.amount_usd,
        originalTxnId,
        userId,
        tenantId,
      );
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
