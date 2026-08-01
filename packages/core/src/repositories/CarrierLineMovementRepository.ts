/**
 * Carrier Line Movement Repository (LIRA-090 §8)
 *
 * The rule-20 reversal owner for every automated `carrier_lines` credit/
 * validity mutation (Only Days credit-return, self-charge — see
 * `CarrierLineService.applyMovement`). `carrier_lines` itself has no
 * `is_refunded` column and is absent from
 * `TransactionRepository._markSourceRefunded`'s whitelist, so voiding/
 * refunding the transaction that drove a mutation must reverse it by reading
 * these rows back (`transaction_id`), never by touching `carrier_lines`
 * directly — see `TransactionRepository._reverseCarrierLineMovements`.
 *
 * Every automated mutation writes exactly one row here, in the SAME db
 * transaction as the `carrier_lines` update (`CarrierLineService.
 * applyMovement` — never one without the other, rule 20).
 */

import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

// =============================================================================
// Entity Types
// =============================================================================

export interface CarrierLineMovementEntity {
  id: number;
  carrier_line_id: number;
  /** Nullable — a movement is not required to be tied to a `transactions`
   *  row (e.g. a manual adjustment with nothing to void/refund later). Only
   *  rows WITH a transaction_id are ever visible to the generic void/refund
   *  reversal. */
  transaction_id: number | null;
  credits_delta: number;
  validity_days_delta: number;
  /** v141 (M2 fix, 2026-07-30 adversarial review) — the carrier line's
   *  `validity_expires_at` exactly as it stood immediately BEFORE this
   *  movement's mutation was applied. `CarrierLineRepository.reverseMovement`
   *  restores this value VERBATIM instead of subtracting `validity_days_delta`
   *  off whatever the line's CURRENT expiry happens to be — a naive
   *  subtraction silently drops the restore when the current expiry is null,
   *  and even when non-null it cannot undo the §5.2 "already-expired lines
   *  extend from today" rebasing (both measured, pre-fix, 2026-07-30). Null
   *  is a legitimate stored value (the line genuinely had no expiry before
   *  this movement) — not a sentinel for "not tracked". */
  previous_validity_expires_at: string | null;
  reason: string;
  is_reversed: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCarrierLineMovementData {
  carrier_line_id: number;
  transaction_id?: number | null;
  credits_delta?: number;
  validity_days_delta?: number;
  /** See {@link CarrierLineMovementEntity.previous_validity_expires_at}. */
  previous_validity_expires_at?: string | null;
  reason: string;
}

// =============================================================================
// Repository
// =============================================================================

export class CarrierLineMovementRepository extends BaseRepository<CarrierLineMovementEntity> {
  constructor() {
    super("carrier_line_movements");
  }

  protected getColumns(): string {
    return "id, carrier_line_id, transaction_id, credits_delta, validity_days_delta, previous_validity_expires_at, reason, is_reversed, created_at, updated_at";
  }

  getById(id: number): CarrierLineMovementEntity | null {
    return (
      (this.db
        .prepare(
          `SELECT ${this.getColumns()} FROM carrier_line_movements WHERE id = ? AND tenant_id = ?`,
        )
        .get(id, getCurrentTenantId()) as
        | CarrierLineMovementEntity
        | undefined) ?? null
    );
  }

  /** Every movement tied to a carrier line, newest first — the line's own
   *  history view. */
  getByCarrierLineId(carrierLineId: number): CarrierLineMovementEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM carrier_line_movements
         WHERE carrier_line_id = ? AND tenant_id = ?
         ORDER BY id DESC`,
      )
      .all(carrierLineId, getCurrentTenantId()) as CarrierLineMovementEntity[];
  }

  /** Every movement tied to a transaction (reversed or not), oldest first. */
  getByTransactionId(transactionId: number): CarrierLineMovementEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM carrier_line_movements
         WHERE transaction_id = ? AND tenant_id = ?
         ORDER BY id ASC`,
      )
      .all(transactionId, getCurrentTenantId()) as CarrierLineMovementEntity[];
  }

  /** Not-yet-reversed movements tied to a transaction — exactly what the
   *  generic void/refund path reverses. Idempotent re-invocation naturally
   *  excludes rows already flipped. */
  getUnreversedByTransactionId(
    transactionId: number,
  ): CarrierLineMovementEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM carrier_line_movements
         WHERE transaction_id = ? AND is_reversed = 0 AND tenant_id = ?
         ORDER BY id ASC`,
      )
      .all(transactionId, getCurrentTenantId()) as CarrierLineMovementEntity[];
  }

  /** Named `createMovement` (not `create`) to avoid colliding with
   *  `BaseRepository.create`'s incompatible generic signature — same
   *  convention `CarrierLineRepository.createLine` already uses. */
  createMovement(
    data: CreateCarrierLineMovementData,
  ): CarrierLineMovementEntity {
    const stmt = this.db.prepare(`
      INSERT INTO carrier_line_movements
        (tenant_id, carrier_line_id, transaction_id, credits_delta, validity_days_delta, previous_validity_expires_at, reason, is_reversed, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    const result = stmt.run(
      getCurrentTenantId(),
      data.carrier_line_id,
      data.transaction_id ?? null,
      data.credits_delta ?? 0,
      data.validity_days_delta ?? 0,
      data.previous_validity_expires_at ?? null,
      data.reason,
    );
    return this.getById(result.lastInsertRowid as number)!;
  }

  /** Flip `is_reversed` to 1. Scoped to `is_reversed = 0` so a defensive
   *  re-invocation on an already-reversed row is a no-op — the double-void/
   *  double-refund guard in `TransactionRepository` already prevents this
   *  from being reached twice for the same transaction; this predicate is
   *  belt-and-suspenders on top of that. */
  markReversed(id: number): void {
    this.db
      .prepare(
        `UPDATE carrier_line_movements SET is_reversed = 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND is_reversed = 0 AND tenant_id = ?`,
      )
      .run(id, getCurrentTenantId());
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: CarrierLineMovementRepository | null = null;

export function getCarrierLineMovementRepository(): CarrierLineMovementRepository {
  if (!instance) {
    instance = new CarrierLineMovementRepository();
  }
  return instance;
}

export function resetCarrierLineMovementRepository(): void {
  instance = null;
}
