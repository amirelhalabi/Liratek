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
   *  and even when non-null it cannot undo a forward step that DISCARDED
   *  days. Originally that was §5.2's "already-expired lines extend from
   *  today" rebasing (measured, pre-fix, 2026-07-30); since LIRA-157 it is the
   *  5-day grace rebase and the 365-day ceiling clip. The column outlives
   *  every one of those rules precisely because it stores a fact rather than
   *  re-deriving one. Null
   *  is a legitimate stored value (the line genuinely had no expiry before
   *  this movement) — not a sentinel for "not tracked". */
  previous_validity_expires_at: string | null;
  /** v184 (#28, LIRA-218) — the sold-ahead-days rule-20 snapshot pair,
   *  parallel to `previous_validity_expires_at` above. `days_owed_delta` is
   *  the EXACT change this movement applied to the line's `days_owed`
   *  balance (positive for a sell that banked sold-ahead days, negative for
   *  a charge that paid the balance down) — days_owed has no grace-rebase
   *  or 365-day-ceiling rule the way validity does, so it is never lossy,
   *  and `reverseMovement` undoes it by plain arithmetic (`current -
   *  days_owed_delta`) rather than a snapshot restore. `previous_days_owed`
   *  is carried for audit/symmetry with the validity column but is not what
   *  reversal keys off. */
  days_owed_delta: number;
  previous_days_owed: number;
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
  /** See {@link CarrierLineMovementEntity.days_owed_delta}. */
  days_owed_delta?: number;
  /** See {@link CarrierLineMovementEntity.previous_days_owed}. */
  previous_days_owed?: number;
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
    return "id, carrier_line_id, transaction_id, credits_delta, validity_days_delta, previous_validity_expires_at, days_owed_delta, previous_days_owed, reason, is_reversed, created_at, updated_at";
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

  /**
   * LIRA-239 — reversal-order guard lookups for CHARGE-shaped movements
   * (`validity_days_delta > 0`) ONLY. `CarrierLineRepository.reverseMovement`
   * restores a CHARGE's validity by a VERBATIM snapshot
   * (`previous_validity_expires_at`, captured at the charge's own creation),
   * which is safe only when reversed in strict reverse-creation order
   * relative to every OTHER validity-affecting movement on the same line:
   *
   *  - A NEWER unreversed validity movement is still stacked on top of this
   *    charge's own effect — restoring straight to this charge's
   *    pre-mutation snapshot would silently erase that newer movement's
   *    contribution instead of just this charge's own.
   *  - An OLDER validity movement that has ALREADY been reversed means this
   *    charge's snapshot (captured back when that older movement's effect
   *    was still live) no longer reflects the line's actual history —
   *    restoring it would resurrect a value that was never truly "current"
   *    once that older movement's own (order-safe, current-state-based)
   *    reversal ran.
   *
   * A SELL's reversal (`validity_days_delta < 0`) is deliberately EXEMPT
   * from both checks — its reclaim arithmetic always reads the line's
   * CURRENT `validity_expires_at`/`days_owed` (never a frozen snapshot for
   * the addback), so it composes correctly regardless of what has or hasn't
   * been reversed around it. That is exactly what the M1/m3 tests
   * (`CarrierLineRepository.soldAheadDays.test.ts`) already prove: reversing
   * a SELL while a LATER charge remains fully active is the sold-ahead
   * design's own load-bearing case, not a hazard to block.
   *
   * `credits_delta` is untouched by either check: it reverses by plain
   * arithmetic subtraction, which is commutative and always correct in any
   * order — a pure credits movement must never be blocked here.
   */
  getLaterUnreversedValidityMovement(
    carrierLineId: number,
    afterMovementId: number,
  ): CarrierLineMovementEntity | null {
    return (
      (this.db
        .prepare(
          `SELECT ${this.getColumns()} FROM carrier_line_movements
           WHERE carrier_line_id = ? AND id > ? AND is_reversed = 0
             AND validity_days_delta != 0 AND tenant_id = ?
           ORDER BY id ASC LIMIT 1`,
        )
        .get(
          carrierLineId,
          afterMovementId,
          getCurrentTenantId(),
        ) as CarrierLineMovementEntity | undefined) ?? null
    );
  }

  /** See {@link getLaterUnreversedValidityMovement}'s doc — the second half
   *  of the same CHARGE-only reversal-order guard: an OLDER validity
   *  movement that has ALREADY been reversed. */
  getOlderReversedValidityMovement(
    carrierLineId: number,
    beforeMovementId: number,
  ): CarrierLineMovementEntity | null {
    return (
      (this.db
        .prepare(
          `SELECT ${this.getColumns()} FROM carrier_line_movements
           WHERE carrier_line_id = ? AND id < ? AND is_reversed = 1
             AND validity_days_delta != 0 AND tenant_id = ?
           ORDER BY id DESC LIMIT 1`,
        )
        .get(
          carrierLineId,
          beforeMovementId,
          getCurrentTenantId(),
        ) as CarrierLineMovementEntity | undefined) ?? null
    );
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
        (tenant_id, carrier_line_id, transaction_id, credits_delta, validity_days_delta, previous_validity_expires_at, days_owed_delta, previous_days_owed, reason, is_reversed, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    const result = stmt.run(
      getCurrentTenantId(),
      data.carrier_line_id,
      data.transaction_id ?? null,
      data.credits_delta ?? 0,
      data.validity_days_delta ?? 0,
      data.previous_validity_expires_at ?? null,
      data.days_owed_delta ?? 0,
      data.previous_days_owed ?? 0,
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
