/**
 * Voucher Repository
 *
 * Handles all vouchers (gift card) table operations.
 * Uses BaseRepository for common functionality.
 *
 * Redemption note: redeeming deposits the voucher's full face value to the
 * owner's customer account via DebtRepository.addCredit; the originating
 * transaction then consumes from that account. `redeemByCode` is designed to run
 * inside an existing db.transaction() so redemption is atomic with the parent
 * sale / service / recharge / session.
 */

import { BaseRepository } from "./BaseRepository.js";
import { getDebtRepository } from "./DebtRepository.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { resolveBackTimedDrawerMovement } from "./checkpointResolution.js";
import {
  applyDrawerDelta,
  bookClientDebtCharge,
  insertPaymentRow,
  lbpEquivalent,
  reconcileLegs,
  resolveStampedExchangeRate,
  sumLegsByCurrency,
  usdEquivalent,
  type ReconciliationLeg,
} from "./moneyPosting.js";
import { insertDebtRefundReversal } from "./debtReversal.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { clientDay } from "../utils/requestDay.js";
import { requestNow } from "../utils/requestNow.js";
import { getUsdLbpSellRate } from "../utils/exchangeRate.js";
import {
  isDrawerAffectingMethod,
  partitionLegs,
  paymentMethodToDrawerName,
} from "../utils/payments.js";
import { buildPaymentSnapshot } from "../utils/paymentSnapshot.js";
import {
  TRANSACTION_DETAILS_VERSION,
  type VoucherDetails,
} from "../validators/transactionDetails.js";
import {
  VOUCHER_SALE_METHODS,
  VOUCHER_REFUND_METHODS,
  type VoucherPaymentLegInput,
  type VoucherRefundLegInput,
} from "../validators/voucher.js";

// =============================================================================
// Entity Types
// =============================================================================

export type VoucherStatus = "pending" | "redeemed" | "expired" | "cancelled";

export interface VoucherEntity {
  id: number;
  code: string;
  client_id: number;
  client_name: string;
  client_phone: string | null;
  amount: number;
  currency_code: string;
  expiry_date: string | null;
  status: VoucherStatus;
  redeemed_at: string | null;
  redeemed_by: number | null;
  redeemed_in_transaction: string | null;
  redeemed_transaction_id: number | null;
  /** LIRA-339 (v224): the session a voucher was redeemed in at session
   *  checkout (that redemption has no single transaction). */
  redeemed_session_id: number | null;
  cancelled_at: string | null;
  cancelled_by: number | null;
  note: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  /** LIRA-339 (T021) — what the voucher's VOUCHER_SALE took in, in the
   *  voucher's currency (0/0 = a legacy voucher: cancel refunds nothing),
   *  and the part of it booked on the customer's account. Read-only, set
   *  by `getAll`/`getByCode` from `SALE_TOTAL_COLUMNS`. */
  sale_usd?: number;
  sale_lbp?: number;
  sale_account_usd?: number;
  sale_account_lbp?: number;
}

/** A per-currency USD/LBP pair. */
export interface UsdLbp {
  usd: number;
  lbp: number;
}

/** LIRA-339 — what a voucher's sale took in (`findSaleTotals`). */
export interface VoucherSaleTotals {
  /** The ACTIVE VOUCHER_SALE row, or null for a legacy voucher. */
  saleTxnId: number | null;
  total: UsdLbp;
  /** SUM of the sale's 'Voucher Debt' rows. */
  onAccount: UsdLbp;
  /** total − onAccount, per currency: what the drawers took in. */
  cash: UsdLbp;
}

export interface SellVoucherOptions {
  /** The cashier's tender rate (LBP per USD). */
  exchangeRate?: number;
  /** Optional back-time, same rule as Hold Money. */
  transactionTime?: string;
}

export interface SellVoucherResult {
  voucher: VoucherEntity;
  transactionId: number;
}

export interface CancelWithRefundOptions {
  cancelledBy: number;
  exchangeRate?: number;
  /** The shop's own day (rule 27) — recorded as `expired_at_cancel`. */
  clientDay?: string;
}

export interface CancelWithRefundResult {
  voucher: VoucherEntity;
  transactionId: number;
  refunded: { cash: UsdLbp; toAccount: UsdLbp };
}

export interface CreateVoucherData {
  client_id: number;
  client_name: string;
  client_phone: string | null;
  amount: number;
  currency_code: string;
  expiry_date: string | null;
  note: string | null;
  created_by: number;
}

export interface VoucherFilters {
  status?: VoucherStatus;
  clientId?: number;
}

export interface RedeemVoucherParams {
  code: string;
  context: string;
  transactionId: number | null;
  userId: number;
  /** LIRA-339 — the session this redemption belongs to (session checkout
   *  has no single transaction). Stamped as `redeemed_session_id`. */
  sessionId?: number | null;
  /**
   * The CLIENT's own local calendar day (`YYYY-MM-DD`), compared against the
   * voucher's stored `expiry_date`. Falls back to `clientDay()` when
   * omitted — which itself prefers the request's tenant-context `X-Client-Day`
   * value and only then falls back to the server's own `localDay()` — so an
   * explicit `day` here still wins for the one caller (RechargeRepository)
   * that already threads its own, while the other five `redeemByCode`
   * callers now get the request's client day for free with no plumbing of
   * their own. Unchanged behaviour for desktop (no request-scoped context is
   * ever active there, so `clientDay()` reduces to `localDay()`). On web the
   * server runs whichever timezone the host booted in (UTC on Fly), not the
   * shop's (Beirut, UTC+3), so trusting the server's day alone can read a
   * voucher as valid/expired up to 3 hours out of step with the shop — see
   * `withEffectiveStatus`'s identical fix for the read-side twin of this bug.
   */
  day?: string;
}

const VOUCHER_COLUMNS =
  "id, code, client_id, client_name, client_phone, amount, currency_code, expiry_date, status, redeemed_at, redeemed_by, redeemed_in_transaction, redeemed_transaction_id, redeemed_session_id, cancelled_at, cancelled_by, note, created_by, created_at, updated_at";

// `effective_status` downgrades a still-pending voucher to 'expired' when its
// expiry date has passed, without mutating the stored row. Takes a bound `?`
// parameter (the CLIENT's own local calendar day) rather than SQLite's own
// `date('now')` — the same reasoning as `withEffectiveStatus` below: the
// server's day disagrees with the shop's for up to 3h/day on web, and a
// literal `date('now')` could never be overridden by a caller's `day` at all.
const EFFECTIVE_STATUS_EXPR = `CASE
  WHEN status = 'pending' AND expiry_date IS NOT NULL AND expiry_date < ?
  THEN 'expired'
  ELSE status
END`;

/**
 * LIRA-339 — the ONE definition of "this voucher's sale" (rule 14): its
 * VOUCHER_SALE row, matched by identity and never a reversal. Correlated on
 * the outer `vouchers` row's columns, so it adds no bind parameter.
 */
const SALE_TXN_ID_SQL = `(SELECT t.id FROM transactions t
   WHERE t.type = 'VOUCHER_SALE' AND t.source_table = 'vouchers'
     AND t.source_id = vouchers.id AND t.tenant_id = vouchers.tenant_id
     AND t.reverses_id IS NULL
   ORDER BY t.id LIMIT 1)`;

/** LIRA-329/339 — the `voucher` details on a sale or cancel row. Pure. */
export function buildVoucherDetails(
  action: VoucherDetails["action"],
  code: string,
  note?: string | null,
  legacy?: boolean,
): VoucherDetails {
  return {
    v: TRANSACTION_DETAILS_VERSION,
    kind: "voucher",
    action,
    code,
    ...(note != null && note.trim() !== "" ? { note } : {}),
    ...(legacy ? { legacy: true } : {}),
  };
}

/**
 * LIRA-339 — the ONE definition of "this sale's voucher debt rows": the
 * 'Voucher Debt' charges (never their reversals) booked on the sale's
 * transaction id, tenant-scoped. Used by `SALE_TOTAL_COLUMNS` (what the page
 * shows and the refund is sized from) AND by the cancel's reversal loop, so
 * the rows reversed are exactly the rows summed (rule 14).
 */
function saleVoucherDebtWhere(
  alias: string,
  saleTxnIdSql: string,
  tenantIdSql: string,
): string {
  return `${alias}.transaction_type = 'Voucher Debt' AND ${alias}.tenant_id = ${tenantIdSql}
       AND ${alias}.transaction_id = ${saleTxnIdSql}`;
}

/**
 * LIRA-339 — what the sale took in and how much of it went on the customer's
 * account. Used by the list reads (`getAll`/`getByCode`) AND by
 * `findSaleTotals` (the cancel), so the page and the refund can never
 * disagree. Only 'Voucher Debt' charge rows count, never their reversals.
 */
const SALE_TOTAL_COLUMNS = `
  ${SALE_TXN_ID_SQL} AS sale_txn_id,
  COALESCE((SELECT t.amount_usd FROM transactions t WHERE t.id = ${SALE_TXN_ID_SQL}), 0) AS sale_usd,
  COALESCE((SELECT t.amount_lbp FROM transactions t WHERE t.id = ${SALE_TXN_ID_SQL}), 0) AS sale_lbp,
  COALESCE((SELECT SUM(d.amount_usd) FROM debt_ledger d
     WHERE ${saleVoucherDebtWhere("d", SALE_TXN_ID_SQL, "vouchers.tenant_id")}), 0) AS sale_account_usd,
  COALESCE((SELECT SUM(d.amount_lbp) FROM debt_ledger d
     WHERE ${saleVoucherDebtWhere("d", SALE_TXN_ID_SQL, "vouchers.tenant_id")}), 0) AS sale_account_lbp`;

interface SaleTotalsRow {
  sale_txn_id: number | null;
  sale_usd: number;
  sale_lbp: number;
  sale_account_usd: number;
  sale_account_lbp: number;
}

/** Strip the internal `sale_txn_id` helper column from a list row. */
function toListEntity(
  row: VoucherEntity & { sale_txn_id?: number | null },
): VoucherEntity {
  const { sale_txn_id: _ignored, ...rest } = row;
  void _ignored;
  return rest;
}

/** Money below this (USD-equivalent) is zero. */
const VOUCHER_EPSILON_USD = 0.005;

function toReconciliationLeg(leg: {
  method: string;
  currency_code: string;
  amount: number;
  direction?: "IN" | "OUT";
}): ReconciliationLeg {
  return {
    method: leg.method,
    currencyCode: leg.currency_code,
    amount: leg.amount,
    direction: leg.direction,
  };
}

// =============================================================================
// Voucher Repository Class
// =============================================================================

export class VoucherRepository extends BaseRepository<VoucherEntity> {
  constructor() {
    super("vouchers", { softDelete: false });
  }

  protected getColumns(): string {
    return VOUCHER_COLUMNS;
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * Map a stored row to its effective status (pending → expired when past
   * expiry). `day` is the CLIENT's own local calendar day (`YYYY-MM-DD`);
   * falls back to `clientDay()` (request context, then `localDay()`) when
   * omitted — see `RedeemVoucherParams.day`'s doc for why the server's own
   * day alone is untrustworthy on web.
   */
  private withEffectiveStatus(
    row: VoucherEntity,
    day: string = clientDay(),
  ): VoucherEntity {
    if (row.status === "pending" && row.expiry_date && row.expiry_date < day) {
      return { ...row, status: "expired" };
    }
    return row;
  }

  getByCode(code: string, day?: string): VoucherEntity | null {
    const row = this.db
      .prepare(
        `SELECT ${VOUCHER_COLUMNS}, ${SALE_TOTAL_COLUMNS} FROM vouchers WHERE code = ? AND tenant_id = ?`,
      )
      .get(code, getCurrentTenantId()) as VoucherEntity | undefined;
    return row ? this.withEffectiveStatus(toListEntity(row), day) : null;
  }

  /**
   * List vouchers, newest first, with effective status applied.
   * When filtering by status, the effective (computed) status is used so that
   * date-expired pending vouchers show under "expired".
   *
   * `day` is the CLIENT's own local calendar day — applied BOTH to the
   * `filters.status` WHERE clause (via `EFFECTIVE_STATUS_EXPR`'s bound `?`)
   * and to the in-app `withEffectiveStatus` recompute below, so a status
   * filter and each row's own displayed `status` field can never disagree.
   */
  getAll(filters: VoucherFilters = {}, day?: string): VoucherEntity[] {
    const clauses: string[] = [];
    const params: unknown[] = [getCurrentTenantId()];
    const effectiveDay = day ?? clientDay();

    if (filters.clientId) {
      clauses.push("client_id = ?");
      params.push(filters.clientId);
    }
    if (filters.status) {
      clauses.push(`(${EFFECTIVE_STATUS_EXPR}) = ?`);
      params.push(effectiveDay, filters.status);
    }

    // tenant_id is always the first predicate (literal, statically visible to
    // the tenant-scoping checker) — additional filters are appended via AND.
    const extraWhere = clauses.length ? ` AND ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT ${VOUCHER_COLUMNS}, ${SALE_TOTAL_COLUMNS} FROM vouchers WHERE tenant_id = ?${extraWhere} ORDER BY created_at DESC, id DESC`,
      )
      .all(...params) as VoucherEntity[];
    return rows.map((r) =>
      this.withEffectiveStatus(toListEntity(r), effectiveDay),
    );
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  /** `createdAt` back-dates the row with its sale (`transaction_time`, the
   *  Hold Money precedent); absent, it is the request's now. */
  createVoucher(
    data: CreateVoucherData & { code: string },
    createdAt?: string,
  ): VoucherEntity {
    const stmt = this.db.prepare(`
      INSERT INTO vouchers (
        code, client_id, client_name, client_phone, amount, currency_code,
        expiry_date, status, note, created_by, tenant_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const result = stmt.run(
      data.code,
      data.client_id,
      data.client_name,
      data.client_phone,
      data.amount,
      data.currency_code,
      data.expiry_date,
      data.note,
      data.created_by,
      getCurrentTenantId(),
      createdAt ?? requestNow(),
    );
    return this.findByIdOrFail(Number(result.lastInsertRowid));
  }

  /**
   * Generate a unique voucher code in the form GIFT-XXXX-XXXX.
   * Retries on the (vanishingly unlikely) collision.
   */
  generateUniqueCode(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
    const block = (): string =>
      Array.from(
        { length: 4 },
        () => alphabet[Math.floor(Math.random() * alphabet.length)],
      ).join("");

    for (let attempt = 0; attempt < 10; attempt++) {
      const code = `GIFT-${block()}-${block()}`;
      const exists = this.db
        .prepare(`SELECT 1 FROM vouchers WHERE code = ? AND tenant_id = ?`)
        .get(code, getCurrentTenantId());
      if (!exists) return code;
    }
    // Extremely unlikely fallback — append a timestamp fragment (the
    // request's time, LIRA-306 FR-021 — never the machine clock)
    const stamp = Date.parse(requestNow().replace(" ", "T") + "Z");
    return `GIFT-${block()}-${stamp.toString(36).toUpperCase().slice(-4)}`;
  }

  // ---------------------------------------------------------------------------
  // LIRA-339 — sale and cancel are money flows
  // ---------------------------------------------------------------------------

  /**
   * Sell a voucher: insert it, write its VOUCHER_SALE row (profit 0 — a
   * voucher is a liability, not income) and post its legs, all in ONE
   * db.transaction() (the Hold Money drop-off precedent).
   *
   * Legs: drawer legs → `payments` + drawer delta (OUT change negative,
   * "Change returned"); CUSTOMER_ACCOUNT legs → summed per currency and
   * booked once per currency as a 'Voucher Debt' on the sale's id. ONE loop
   * posts every leg exactly once (rule 16). No legs → one CASH leg for the
   * face value in the voucher's currency (old callers keep working).
   *
   * Reversal owner (rule 20): `cancelWithRefund`. VOUCHER_SALE is gated in
   * NON_REVERSIBLE_TRANSACTION_TYPES, so the generic void never reaches it.
   *
   * Throws a cashier-facing Error on any refusal, before anything is written.
   */
  sellVoucher(
    data: CreateVoucherData & { code: string },
    legs: VoucherPaymentLegInput[],
    opts: SellVoucherOptions = {},
  ): SellVoucherResult {
    const isLbp = data.currency_code === "LBP";
    const expected: UsdLbp = isLbp
      ? { usd: 0, lbp: data.amount }
      : { usd: data.amount, lbp: 0 };
    const liveLegs = legs.filter((l) => Math.abs(l.amount) > 0);

    const saleMethods: readonly string[] = VOUCHER_SALE_METHODS;
    for (const leg of liveLegs) {
      // Defensive: a caller that skips the schema (GIFT_CARD — a voucher
      // cannot buy a voucher — or an unknown method) is refused here.
      const method: string = leg.method;
      if (!saleMethods.includes(method)) {
        throw new Error(
          `A voucher cannot be paid with ${method === "GIFT_CARD" ? "a gift card" : method}.`,
        );
      }
      if (leg.method === "CUSTOMER_ACCOUNT") {
        if (leg.direction === "OUT") {
          throw new Error(
            "Change on a voucher sale cannot go to the customer's account.",
          );
        }
        if (!data.client_phone?.trim()) {
          throw new Error(
            "The voucher's owner needs a phone number to buy on account.",
          );
        }
      }
    }

    const sellRate = getUsdLbpSellRate(this.db);
    const stampedRate = resolveStampedExchangeRate(sellRate, opts.exchangeRate);
    if (liveLegs.length > 0) {
      const { inLegs, outLegs } = partitionLegs(
        liveLegs.map(toReconciliationLeg),
      );
      // Every IN leg counts, the account leg included (moneyPosting S2).
      reconcileLegs({
        inLegs,
        outLegs,
        expectedTotals: expected,
        exchangeRate: sellRate,
        tenderExchangeRate: opts.exchangeRate,
        context: "Voucher sale",
      });
    }

    return this.db.transaction((): SellVoucherResult => {
      const tenantId = getCurrentTenantId();
      const voucher = this.createVoucher(data, opts.transactionTime);
      const noteText = `Voucher sold ${voucher.code}`;

      const transactionId = getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.VOUCHER_SALE,
        source_table: "vouchers",
        source_id: voucher.id,
        user_id: data.created_by,
        amount_usd: expected.usd,
        amount_lbp: expected.lbp,
        profit_usd: 0,
        profit_lbp: 0,
        exchange_rate: stampedRate,
        client_id: voucher.client_id,
        client_name: voucher.client_name,
        client_phone: voucher.client_phone,
        summary: noteText,
        metadata_json: {
          details: buildVoucherDetails("SALE", voucher.code, voucher.note),
          code: voucher.code,
          currency_code: voucher.currency_code,
          kind: "voucher_sale",
        },
        ...(liveLegs.length > 0
          ? {
              payment_snapshot: buildPaymentSnapshot({
                flow: "IN",
                payments: liveLegs,
              }),
            }
          : {}),
        transaction_time: opts.transactionTime,
      });

      const postLegs: VoucherPaymentLegInput[] =
        liveLegs.length > 0
          ? liveLegs
          : [
              {
                method: "CASH",
                currency_code: isLbp ? "LBP" : "USD",
                amount: data.amount,
              },
            ];
      const onAccount: UsdLbp = { usd: 0, lbp: 0 };
      for (const leg of postLegs) {
        const amt = Math.abs(leg.amount);
        if (leg.method === "CUSTOMER_ACCOUNT") {
          if (leg.currency_code === "LBP") onAccount.lbp += amt;
          else onAccount.usd += amt;
          continue;
        }
        const isOut = leg.direction === "OUT";
        const signed = isOut ? -amt : amt;
        const drawer = paymentMethodToDrawerName(leg.method);
        insertPaymentRow(this.db, {
          transactionId,
          method: leg.method,
          drawerName: drawer,
          currencyCode: leg.currency_code,
          amount: signed,
          note: isOut ? "Change returned" : noteText,
          createdBy: data.created_by,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName: drawer,
          currencyCode: leg.currency_code,
          delta: signed,
          tenantId,
        });
      }
      if (onAccount.usd > 0) {
        bookClientDebtCharge(this.db, {
          clientId: voucher.client_id,
          transactionType: "Voucher Debt",
          amountUsd: onAccount.usd,
          amountLbp: 0,
          transactionId,
          note: noteText,
          createdBy: data.created_by,
          tenantId,
        });
      }
      if (onAccount.lbp > 0) {
        bookClientDebtCharge(this.db, {
          clientId: voucher.client_id,
          transactionType: "Voucher Debt",
          amountUsd: 0,
          amountLbp: onAccount.lbp,
          transactionId,
          note: noteText,
          createdBy: data.created_by,
          tenantId,
        });
      }

      resolveBackTimedDrawerMovement(this.db, {
        transactionId,
        userId: data.created_by,
      });

      return { voucher, transactionId };
    })();
  }

  /**
   * What a voucher's sale took in (`SALE_TOTAL_COLUMNS`, the same fragment
   * the list reads use — rule 14). A legacy voucher (no VOUCHER_SALE row)
   * reads all zeros with `saleTxnId: null`.
   */
  findSaleTotals(voucherId: number): VoucherSaleTotals {
    const row = this.db
      .prepare(
        `SELECT ${SALE_TOTAL_COLUMNS} FROM vouchers WHERE id = ? AND tenant_id = ?`,
      )
      .get(voucherId, getCurrentTenantId()) as SaleTotalsRow | undefined;
    const total: UsdLbp = { usd: row?.sale_usd ?? 0, lbp: row?.sale_lbp ?? 0 };
    const onAccount: UsdLbp = {
      usd: row?.sale_account_usd ?? 0,
      lbp: row?.sale_account_lbp ?? 0,
    };
    return {
      saleTxnId: row?.sale_txn_id ?? null,
      total,
      onAccount,
      cash: { usd: total.usd - onAccount.usd, lbp: total.lbp - onAccount.lbp },
    };
  }

  /**
   * Cancel a pending voucher and refund what its sale took in, leg by leg,
   * in ONE db.transaction(). The reversal owner of VOUCHER_SALE (rule 20).
   *
   *  1. Guarded flip `pending → cancelled` FIRST; any other status (or a
   *     second cancel) throws before a leg is written. A stored-pending but
   *     date-expired voucher is refundable.
   *  2. Legacy voucher (no sale row): no money moves, payout legs refused, a
   *     0-amount VOUCHER_CANCEL with `metadata.legacy = true`.
   *  3. Otherwise: every 'Voucher Debt' row of the sale gets the shared
   *     'Refund Reversal' (full amount, repaid or not — a repaid part becomes
   *     account credit); the cash part is paid out through `legs` (drawer
   *     methods only, reconciled against it), or one CASH leg in the
   *     voucher's currency when no legs are sent. No legs are allowed when
   *     the cash part is 0.
   *
   * Throws a cashier-facing Error on any refusal.
   */
  cancelWithRefund(
    id: number,
    legs: VoucherRefundLegInput[],
    opts: CancelWithRefundOptions,
  ): CancelWithRefundResult {
    const refundMethods: readonly string[] = VOUCHER_REFUND_METHODS;
    const liveLegs = legs.filter((l) => Math.abs(l.amount) > 0);
    for (const leg of liveLegs) {
      if (
        !refundMethods.includes(leg.method) ||
        !isDrawerAffectingMethod(leg.method)
      ) {
        throw new Error(
          `A voucher refund cannot be paid out with ${leg.method}.`,
        );
      }
    }
    const sellRate = getUsdLbpSellRate(this.db);
    const stampedRate = resolveStampedExchangeRate(sellRate, opts.exchangeRate);
    const day = opts.clientDay ?? clientDay();

    return this.db.transaction((): CancelWithRefundResult => {
      const tenantId = getCurrentTenantId();
      const flipped = this.db
        .prepare(
          `UPDATE vouchers
              SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'pending' AND tenant_id = ?`,
        )
        .run(requestNow(), opts.cancelledBy, id, tenantId);
      if (flipped.changes !== 1) {
        throw new Error("Voucher can no longer be cancelled");
      }
      const voucher = this.findByIdOrFail(id);
      const expiredAtCancel =
        voucher.expiry_date !== null && voucher.expiry_date < day;
      const totals = this.findSaleTotals(id);
      const isLbp = voucher.currency_code === "LBP";
      const zero: UsdLbp = { usd: 0, lbp: 0 };
      const baseMeta = {
        code: voucher.code,
        currency_code: voucher.currency_code,
        kind: "voucher_cancel",
        expired_at_cancel: expiredAtCancel,
      };

      if (totals.saleTxnId === null) {
        if (liveLegs.length > 0) {
          throw new Error(
            "This voucher was not sold, so there is nothing to refund.",
          );
        }
        const transactionId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.VOUCHER_CANCEL,
          source_table: "vouchers",
          source_id: voucher.id,
          user_id: opts.cancelledBy,
          amount_usd: 0,
          amount_lbp: 0,
          profit_usd: 0,
          profit_lbp: 0,
          exchange_rate: stampedRate,
          client_id: voucher.client_id,
          client_name: voucher.client_name,
          client_phone: voucher.client_phone,
          summary: `Voucher cancelled ${voucher.code}`,
          metadata_json: {
            ...baseMeta,
            legacy: true,
            details: buildVoucherDetails(
              "CANCEL",
              voucher.code,
              voucher.note,
              true,
            ),
          },
        });
        return {
          voucher: this.findByIdOrFail(id),
          transactionId,
          refunded: { cash: zero, toAccount: zero },
        };
      }

      // The cash part is what the drawers took in; settle it in the
      // voucher's currency at the stamped rate (it may be negative in one
      // currency when an account leg was in the other).
      const cashEqInVoucherCcy = isLbp
        ? lbpEquivalent(totals.cash.usd, totals.cash.lbp, stampedRate)
        : usdEquivalent(totals.cash.usd, totals.cash.lbp, stampedRate);
      const cashUsdEq = usdEquivalent(
        totals.cash.usd,
        totals.cash.lbp,
        stampedRate,
      );
      const hasCash = cashUsdEq > VOUCHER_EPSILON_USD;
      if (!hasCash && liveLegs.length > 0) {
        throw new Error(
          "This voucher was paid on the customer's account — nothing is paid out in cash.",
        );
      }
      if (liveLegs.length > 0) {
        reconcileLegs({
          inLegs: liveLegs.map(toReconciliationLeg),
          expectedTotals: totals.cash,
          exchangeRate: sellRate,
          tenderExchangeRate: opts.exchangeRate,
          context: "Voucher refund",
        });
      }
      const payout: VoucherRefundLegInput[] =
        liveLegs.length > 0
          ? liveLegs
          : hasCash
            ? [
                {
                  method: "CASH",
                  currency_code: isLbp ? "LBP" : "USD",
                  amount: cashEqInVoucherCcy,
                },
              ]
            : [];
      const refundedCash = sumLegsByCurrency(
        payout.map(toReconciliationLeg),
        "Voucher refund",
      );

      for (const charge of this.db
        .prepare(
          // Tenant bound first and spelled out here so the tenant-scoping
          // check can see it; the fragment then compares the row to itself.
          `SELECT d.client_id, d.amount_usd, d.amount_lbp FROM debt_ledger d
            WHERE d.tenant_id = ?
              AND ${saleVoucherDebtWhere("d", "?", "d.tenant_id")}
            ORDER BY d.id`,
        )
        .all(tenantId, totals.saleTxnId) as Array<{
        client_id: number;
        amount_usd: number | null;
        amount_lbp: number | null;
      }>) {
        insertDebtRefundReversal(this.db, {
          clientId: charge.client_id,
          amountUsd: charge.amount_usd,
          amountLbp: charge.amount_lbp,
          transactionId: totals.saleTxnId,
          createdBy: opts.cancelledBy,
          tenantId,
        });
      }

      const noteText = `Voucher cancelled ${voucher.code}`;
      const transactionId = getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.VOUCHER_CANCEL,
        source_table: "vouchers",
        source_id: voucher.id,
        user_id: opts.cancelledBy,
        amount_usd: totals.total.usd,
        amount_lbp: totals.total.lbp,
        profit_usd: 0,
        profit_lbp: 0,
        exchange_rate: stampedRate,
        client_id: voucher.client_id,
        client_name: voucher.client_name,
        client_phone: voucher.client_phone,
        summary: noteText,
        metadata_json: {
          ...baseMeta,
          details: buildVoucherDetails("CANCEL", voucher.code, voucher.note),
          refunded_cash: refundedCash,
          reversed_to_account: totals.onAccount,
        },
        ...(payout.length > 0
          ? {
              payment_snapshot: buildPaymentSnapshot({
                flow: "PAYOUT",
                payments: payout,
              }),
            }
          : {}),
      });

      for (const leg of payout) {
        const amt = Math.abs(leg.amount);
        const drawer = paymentMethodToDrawerName(leg.method);
        insertPaymentRow(this.db, {
          transactionId,
          method: leg.method,
          drawerName: drawer,
          currencyCode: leg.currency_code,
          amount: -amt,
          note: noteText,
          createdBy: opts.cancelledBy,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName: drawer,
          currencyCode: leg.currency_code,
          delta: -amt,
          tenantId,
        });
      }

      return {
        voucher: this.findByIdOrFail(id),
        transactionId,
        refunded: { cash: refundedCash, toAccount: totals.onAccount },
      };
    })();
  }

  /**
   * Validate and redeem a voucher by code. Intended to be called inside the
   * parent transaction so redemption is atomic with the originating transaction.
   *
   * Model: redeeming deposits the voucher's FULL face value to the owner's
   * customer account as credit ("Voucher redeemed …"). The originating
   * transaction then consumes from that account via its CUSTOMER_ACCOUNT / debt
   * path, so any leftover stays as account credit and the flow is currency-safe
   * (USD voucher, LBP charge, etc.).
   *
   * Throws an Error with a user-facing message when the voucher cannot be redeemed.
   */
  redeemByCode(params: RedeemVoucherParams): VoucherEntity {
    const { code, context, transactionId, userId, day, sessionId } = params;

    const voucher = this.db
      .prepare(
        `SELECT ${VOUCHER_COLUMNS} FROM vouchers WHERE code = ? AND tenant_id = ?`,
      )
      .get(code, getCurrentTenantId()) as VoucherEntity | undefined;

    if (!voucher) {
      throw new Error(`Voucher ${code} not found`);
    }
    if (voucher.status === "cancelled") {
      throw new Error(`Voucher ${code} has been cancelled`);
    }
    if (voucher.status === "redeemed") {
      throw new Error(`Voucher ${code} has already been redeemed`);
    }
    const today = day ?? clientDay();
    if (voucher.expiry_date && voucher.expiry_date < today) {
      throw new Error(`Voucher ${code} has expired`);
    }

    // Deposit the full face value to the owner's account as credit.
    const isLbp = voucher.currency_code === "LBP";
    getDebtRepository().addCredit({
      clientId: voucher.client_id,
      amountUsd: isLbp ? 0 : voucher.amount,
      amountLbp: isLbp ? voucher.amount : 0,
      note: `Voucher redeemed ${code}`,
      createdBy: String(userId),
      transactionId: transactionId ?? undefined,
    });

    this.db
      .prepare(
        `UPDATE vouchers
         SET status = 'redeemed', redeemed_at = ?, redeemed_by = ?,
             redeemed_in_transaction = ?, redeemed_transaction_id = ?,
             redeemed_session_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND tenant_id = ?`,
      )
      .run(
        requestNow(),
        userId,
        context,
        transactionId,
        sessionId ?? null,
        voucher.id,
        getCurrentTenantId(),
      );

    return this.findByIdOrFail(voucher.id);
  }

  /**
   * LIRA-258 / G37 — give back every voucher redeemed in `transactionId`
   * when that transaction is voided or refunded as a whole.
   *
   * Redemption wrote two things: a CREDIT_DEPOSIT of the face value to the
   * owner (note `Voucher redeemed <code>`, linked to the transaction) and the
   * `redeemed` status. The generic reversal
   * (`TransactionRepository._cancelDebt`) cancels the deposit; this undoes
   * the status, so the refund returns both the ledger AND the voucher to
   * their pre-sale state (rule 20). Keeping the deposit instead would leave
   * the owner's account changed by the refund.
   *
   * Only vouchers whose own deposit is linked to this transaction are
   * restored (the deposit is what `_cancelDebt` reverses), so the two halves
   * can never disagree. Redemptions without a transaction id (session
   * checkout passes `transactionId: null`) are not reachable from here.
   * An expired voucher comes back `pending` and still reads as expired
   * (`VOUCHER_COLUMNS`' status CASE / `redeemByCode`'s expiry check).
   *
   * Must run inside the caller's db.transaction(). Returns how many vouchers
   * were restored.
   */
  restoreRedeemedByTransaction(transactionId: number): number {
    const tenantId = getCurrentTenantId();
    const result = this.db
      .prepare(
        `UPDATE vouchers
            SET status = 'pending', redeemed_at = NULL, redeemed_by = NULL,
                redeemed_in_transaction = NULL, redeemed_transaction_id = NULL,
                redeemed_session_id = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE redeemed_transaction_id = ? AND status = 'redeemed' AND tenant_id = ?
            AND EXISTS (
              SELECT 1 FROM debt_ledger d
               WHERE d.transaction_id = vouchers.redeemed_transaction_id
                 AND d.transaction_type = 'CREDIT_DEPOSIT'
                 AND d.note = 'Voucher redeemed ' || vouchers.code
                 AND d.tenant_id = vouchers.tenant_id
            )`,
      )
      .run(transactionId, tenantId);
    return result.changes;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let voucherRepositoryInstance: VoucherRepository | null = null;

export function getVoucherRepository(): VoucherRepository {
  if (!voucherRepositoryInstance) {
    voucherRepositoryInstance = new VoucherRepository();
  }
  return voucherRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetVoucherRepository(): void {
  voucherRepositoryInstance = null;
}
