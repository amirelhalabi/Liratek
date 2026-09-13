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
import { getCurrentTenantId } from "../db/tenantContext.js";
import { clientDay } from "../utils/localDate.js";

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
  cancelled_at: string | null;
  cancelled_by: number | null;
  note: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
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
  "id, code, client_id, client_name, client_phone, amount, currency_code, expiry_date, status, redeemed_at, redeemed_by, redeemed_in_transaction, redeemed_transaction_id, cancelled_at, cancelled_by, note, created_by, created_at, updated_at";

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
        `SELECT ${VOUCHER_COLUMNS} FROM vouchers WHERE code = ? AND tenant_id = ?`,
      )
      .get(code, getCurrentTenantId()) as VoucherEntity | undefined;
    return row ? this.withEffectiveStatus(row, day) : null;
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
        `SELECT ${VOUCHER_COLUMNS} FROM vouchers WHERE tenant_id = ?${extraWhere} ORDER BY created_at DESC, id DESC`,
      )
      .all(...params) as VoucherEntity[];
    return rows.map((r) => this.withEffectiveStatus(r, effectiveDay));
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  createVoucher(data: CreateVoucherData & { code: string }): VoucherEntity {
    const stmt = this.db.prepare(`
      INSERT INTO vouchers (
        code, client_id, client_name, client_phone, amount, currency_code,
        expiry_date, status, note, created_by, tenant_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
    // Extremely unlikely fallback — append a timestamp fragment
    return `GIFT-${block()}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
  }

  /**
   * Cancel (void) a pending voucher. Returns the updated voucher, or null if the
   * voucher does not exist or was not pending.
   */
  cancel(id: number, cancelledBy: number): VoucherEntity | null {
    const result = this.db
      .prepare(
        `UPDATE vouchers
         SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancelled_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'pending' AND tenant_id = ?`,
      )
      .run(cancelledBy, id, getCurrentTenantId());
    if (result.changes === 0) return null;
    return this.findById(id);
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
    const { code, context, transactionId, userId, day } = params;

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
         SET status = 'redeemed', redeemed_at = CURRENT_TIMESTAMP, redeemed_by = ?,
             redeemed_in_transaction = ?, redeemed_transaction_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND tenant_id = ?`,
      )
      .run(userId, context, transactionId, voucher.id, getCurrentTenantId());

    return this.findByIdOrFail(voucher.id);
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
