/**
 * Carrier Line Owed Delivery Repository (v184 — #28, LIRA-218)
 *
 * The "days still to send" list. A DAYS sale that sells ahead of a line's
 * real remaining days is recorded ONCE — the ordinary DAYS recharge
 * transaction, which already banks the shortfall into
 * `carrier_lines.days_owed` (see `RechargeRepository`'s DAYS-sale path and
 * `utils/carrierLineValidity.ts`'s `projectValidityExpiry`). This table
 * tracks a SEPARATE, purely operational fact: that the shop still owes that
 * customer the physical delivery of those days, until the line is recharged
 * and the operator actually transfers them.
 *
 * `markSent` is the ONLY write this repository performs after creation. It
 * flips `status` to `'SENT'` and stamps `sent_at`/`sent_by` — nothing else.
 * It never re-charges the line, never books a second sale, and never
 * touches `carrier_lines.days_owed` (that balance is settled independently,
 * by the NEXT charge's owed-payoff in `CarrierLineRepository.applyMovement`
 * — see the owner's "delivering never makes a second sale or a second
 * charge"). The two can legitimately drift apart in timing (the operator may
 * recharge before ticking every pending delivery, or vice versa); that is by
 * design, not a bug to reconcile here.
 *
 * No rule-20 reversal owner: a delivery row is a checklist item, not money
 * or validity. Voiding/refunding the ORIGINAL DAYS sale reverses the
 * `carrier_line_movements` row (which restores `days_owed`) through the
 * existing generic path — it does not need to, and does not, touch this
 * table. A delivery row left dangling after its parent sale is voided is
 * cosmetic (a stale "still to send" entry for a sale that no longer exists),
 * so it is never mutated by a void/refund — instead `getAllPending` (the
 * ONLY read the "days still to send" action list uses) filters it out at
 * read time by joining against the source transaction's void/refund state
 * (M5 fix, 2026-09-24 adversarial review — the join was previously only
 * promised in this comment, not actually implemented, so a refunded sale's
 * customer stayed on the list with a live "Mark sent" button).
 * `getByCarrierLineId` deliberately does NOT apply this filter — it is the
 * per-line HISTORY view (PENDING and SENT alike, see its own doc), where a
 * refunded delivery is legitimate audit trail, not an actionable item.
 */

import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

/**
 * Rule 14 — the ONE definition of "this transaction was voided or
 * refunded", used only by `getAllPending`'s M5 filter (see the module doc).
 * Expects the query to alias `carrier_line_owed_deliveries` as `d` (LEFT
 * JOINed to `transactions` as `t` on `t.id = d.transaction_id`) and takes
 * exactly one `?` bind param — the tenant id for the REFUND sibling's own
 * `tenant_id` check. A void flips the original row's own `status`; a refund
 * never touches the original row and instead inserts a sibling `type =
 * 'REFUND'` row with `reverses_id` pointing back at it (see
 * `TransactionRepository._refundTransactionInternal` / `voidTransaction`) —
 * so both must be checked, not just `status`.
 *
 * `COALESCE(t.status, '')` (rather than bare `t.status`) matters: on the
 * LEFT JOIN's no-match side `t.status` is SQL NULL, and `NULL = 'VOIDED'`
 * evaluates to NULL, not FALSE — which would make the enclosing `OR` (and
 * this whole predicate) NULL instead of FALSE for a perfectly live
 * delivery, silently dropping it from the list. `EXISTS` itself is never
 * NULL, so only the direct `status` comparison needs the guard.
 */
const REVERSED_SOURCE_SQL = `(
  COALESCE(t.status, '') = 'VOIDED'
  OR EXISTS (
    SELECT 1 FROM transactions r
     WHERE r.reverses_id = d.transaction_id AND r.type = 'REFUND' AND r.tenant_id = ?
  )
)`;

export type CarrierLineOwedDeliveryStatus = "PENDING" | "SENT";

export interface CarrierLineOwedDeliveryEntity {
  id: number;
  carrier_line_id: number;
  transaction_id: number | null;
  client_id: number | null;
  client_name: string | null;
  days_owed: number;
  status: CarrierLineOwedDeliveryStatus;
  sent_at: string | null;
  sent_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCarrierLineOwedDeliveryData {
  carrier_line_id: number;
  transaction_id: number | null;
  client_id?: number | null;
  client_name?: string | null;
  /** The sold-ahead portion of THIS sale — always > 0 (a caller with 0
   *  sold-ahead days has nothing to list; see RechargeRepository's gate). */
  days_owed: number;
}

export class CarrierLineOwedDeliveryRepository extends BaseRepository<CarrierLineOwedDeliveryEntity> {
  constructor() {
    super("carrier_line_owed_deliveries");
  }

  protected getColumns(): string {
    return "id, carrier_line_id, transaction_id, client_id, client_name, days_owed, status, sent_at, sent_by, created_at, updated_at";
  }

  getById(id: number): CarrierLineOwedDeliveryEntity | null {
    return (
      (this.db
        .prepare(
          `SELECT ${this.getColumns()} FROM carrier_line_owed_deliveries WHERE id = ? AND tenant_id = ?`,
        )
        .get(id, getCurrentTenantId()) as
        | CarrierLineOwedDeliveryEntity
        | undefined) ?? null
    );
  }

  /** Every delivery for one line, newest first — PENDING and SENT alike
   *  (the UI filters to PENDING for the "still to send" list and can still
   *  show history). */
  getByCarrierLineId(
    carrierLineId: number,
  ): CarrierLineOwedDeliveryEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM carrier_line_owed_deliveries
         WHERE carrier_line_id = ? AND tenant_id = ?
         ORDER BY id DESC`,
      )
      .all(carrierLineId, getCurrentTenantId()) as CarrierLineOwedDeliveryEntity[];
  }

  /** Every PENDING delivery, every line — the Days tab's "days still to
   *  send" list. Oldest first: the longest-waiting customer surfaces first.
   *
   *  M5 fix: excludes a delivery whose source transaction was voided
   *  (`status = 'VOIDED'`) or refunded (a sibling `type = 'REFUND'` row
   *  with `reverses_id` pointing at it) — {@link REVERSED_SOURCE_SQL}, the
   *  ONE definition of that predicate (rule 14), reused nowhere else in
   *  this repository. A delivery with no `transaction_id` (defensive —
   *  every real caller sets one, see `CreateCarrierLineOwedDeliveryData`)
   *  is always shown: there is no source transaction to have reversed. */
  getAllPending(): CarrierLineOwedDeliveryEntity[] {
    const tenantId = getCurrentTenantId();
    return this.db
      .prepare(
        `SELECT d.id, d.carrier_line_id, d.transaction_id, d.client_id, d.client_name,
                d.days_owed, d.status, d.sent_at, d.sent_by, d.created_at, d.updated_at
           FROM carrier_line_owed_deliveries d
           LEFT JOIN transactions t
             ON t.id = d.transaction_id AND t.tenant_id = d.tenant_id
          WHERE d.status = 'PENDING' AND d.tenant_id = ?
            AND (d.transaction_id IS NULL OR NOT (${REVERSED_SOURCE_SQL}))
          ORDER BY d.id ASC`,
      )
      .all(tenantId, tenantId) as CarrierLineOwedDeliveryEntity[];
  }

  create(
    data: CreateCarrierLineOwedDeliveryData,
  ): CarrierLineOwedDeliveryEntity {
    const stmt = this.db.prepare(`
      INSERT INTO carrier_line_owed_deliveries
        (tenant_id, carrier_line_id, transaction_id, client_id, client_name, days_owed, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    const result = stmt.run(
      getCurrentTenantId(),
      data.carrier_line_id,
      data.transaction_id ?? null,
      data.client_id ?? null,
      data.client_name ?? null,
      data.days_owed,
    );
    return this.getById(result.lastInsertRowid as number)!;
  }

  /**
   * Record that this delivery's days were physically transferred to the
   * customer. Pure operational bookkeeping — never a sale, never a charge,
   * never a `carrier_lines.days_owed` write (see the module doc).
   *
   * Idempotent: a no-op returning the row unchanged if already SENT, so a
   * doubled click can't stamp a second `sent_at`.
   */
  markSent(
    id: number,
    userId: number,
  ): CarrierLineOwedDeliveryEntity | null {
    const delivery = this.getById(id);
    if (!delivery) return null;
    if (delivery.status === "SENT") return delivery;

    this.db
      .prepare(
        `UPDATE carrier_line_owed_deliveries
         SET status = 'SENT', sent_at = CURRENT_TIMESTAMP, sent_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND tenant_id = ?`,
      )
      .run(userId, id, getCurrentTenantId());

    return this.getById(id);
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: CarrierLineOwedDeliveryRepository | null = null;

export function getCarrierLineOwedDeliveryRepository(): CarrierLineOwedDeliveryRepository {
  if (!instance) {
    instance = new CarrierLineOwedDeliveryRepository();
  }
  return instance;
}

export function resetCarrierLineOwedDeliveryRepository(): void {
  instance = null;
}
