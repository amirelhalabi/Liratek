/**
 * Carrier Line Repository (LIRA W6.a)
 *
 * Shop-owned alfa/mtc SIM lines: remaining credits + validity expiry date.
 * Informational only — no drawer legs, no checkout/closing involvement.
 * `validity_expires_at` stores a DATE (YYYY-MM-DD); days-remaining is
 * derived by the caller at render time so the figure never goes stale.
 */

import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { localDay } from "../utils/localDate.js";
import {
  CarrierLineMovementRepository,
  getCarrierLineMovementRepository,
  type CarrierLineMovementEntity,
} from "./CarrierLineMovementRepository.js";

// =============================================================================
// Entity Types
// =============================================================================

export type CarrierKey = "alfa" | "mtc";

export interface CarrierLineEntity {
  id: number;
  carrier: CarrierKey;
  phone_number: string;
  label: string | null;
  credits: number;
  validity_expires_at: string | null;
  notes: string | null;
  is_active: number;
  /** LIRA-090 v140 — at most one primary line per (tenant_id, carrier),
   *  enforced by the partial unique index
   *  `idx_carrier_lines_one_primary_per_carrier`. The primary line is the
   *  one that receives automated Only-Days credit returns and self-charges
   *  by default (spec §3 decision 8) — never set directly via `updateLine`/
   *  `UpdateCarrierLineData` (deliberately excluded from that type); always
   *  go through `setPrimary`, which clears the previous holder in the same
   *  db transaction. Also cleared by `archive()` (H2 fix, 2026-07-30
   *  adversarial review) — see `getPrimary()`'s doc for the belt-and-braces
   *  reasoning. */
  is_primary: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCarrierLineData {
  carrier: CarrierKey;
  phone_number: string;
  label?: string | null;
  credits?: number;
  validity_expires_at?: string | null;
  notes?: string | null;
}

export interface UpdateCarrierLineData {
  carrier?: CarrierKey;
  phone_number?: string;
  label?: string | null;
  credits?: number;
  validity_expires_at?: string | null;
  notes?: string | null;
  is_active?: number;
}

/** The Recharge-tab inline quick-update: credits and/or a new expiry. */
export interface UpdateBalanceData {
  credits?: number;
  validity_expires_at?: string | null;
}

// -----------------------------------------------------------------------------
// Date helpers (LIRA-090 §5.2 validity extension)
// -----------------------------------------------------------------------------

/**
 * Add (or, for a negative `days`, subtract) whole days to a `YYYY-MM-DD`
 * calendar-date string. Parsed/formatted entirely in UTC — a calendar date
 * has no timezone of its own, so doing this arithmetic in UTC sidesteps any
 * local-timezone month/day-rollover bug entirely (contrast `utils/localDate.ts`,
 * which deliberately uses local getters because IT is answering "what day is
 * it on the shop's clock right now" — a different question from "what date is
 * N days after this stored calendar date").
 */
function addDaysToDateString(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  const y = date.getUTCFullYear();
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Whole-day difference `toStr - fromStr` between two `YYYY-MM-DD` calendar
 * dates, computed in UTC (a fixed 86,400,000ms/day — no DST ambiguity ever
 * applies to a pure calendar date). Used ONLY by `updateBalance`'s manual
 * hand-edit path (H3 fix) to record an audit-trail `validity_days_delta` on
 * its movement row; the reversal path never re-derives a date from this
 * value (see `previous_validity_expires_at` / M2).
 */
function daysBetweenDateStrings(fromStr: string, toStr: string): number {
  const [fy, fm, fd] = fromStr.split("-").map(Number);
  const [ty, tm, td] = toStr.split("-").map(Number);
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.round((toMs - fromMs) / 86_400_000);
}

// -----------------------------------------------------------------------------
// Movement-paired mutation types (LIRA-090 §5.2, §8 — H3 fix)
// -----------------------------------------------------------------------------

/** Input to {@link CarrierLineRepository.applyMovement}. */
export interface ApplyCarrierLineMovementInput {
  carrierLineId: number;
  /** USD credit to add (or subtract). 0 for a validity-only movement. */
  creditsDelta: number;
  /** Days to extend validity by (§5.2's `max(today, current_expiry) +
   *  validity_days`). 0 for a credits-only movement. */
  validityDaysDelta: number;
  /** `carrier_line_movements.reason` is NOT NULL. */
  reason: string;
  /** The unified `transactions.id` this movement rides on, or null for a
   *  non-transactional (manual) adjustment. */
  transactionId: number | null;
}

/** Output of {@link CarrierLineRepository.applyMovement} /
 *  {@link CarrierLineRepository.reverseMovement}. */
export interface CarrierLineMovementMutation {
  line: CarrierLineEntity;
  movement: CarrierLineMovementEntity;
}

// =============================================================================
// Repository
// =============================================================================

export class CarrierLineRepository extends BaseRepository<CarrierLineEntity> {
  private movementRepo: CarrierLineMovementRepository;

  constructor(movementRepo?: CarrierLineMovementRepository) {
    super("carrier_lines");
    this.movementRepo = movementRepo ?? getCarrierLineMovementRepository();
  }

  protected getColumns(): string {
    return "id, carrier, phone_number, label, credits, validity_expires_at, notes, is_active, is_primary, created_at, updated_at";
  }

  /** Active lines for one carrier — the Recharge-tab compact panel. */
  getActiveByCarrier(carrier: CarrierKey): CarrierLineEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM carrier_lines
         WHERE carrier = ? AND is_active = 1 AND tenant_id = ?
         ORDER BY phone_number`,
      )
      .all(carrier, getCurrentTenantId()) as CarrierLineEntity[];
  }

  /** All active lines, every carrier. */
  getAllActive(): CarrierLineEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM carrier_lines
         WHERE is_active = 1 AND tenant_id = ?
         ORDER BY carrier, phone_number`,
      )
      .all(getCurrentTenantId()) as CarrierLineEntity[];
  }

  /** Every line including archived (is_active = 0) — the Settings manager. */
  getAllIncludingInactive(): CarrierLineEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM carrier_lines
         WHERE tenant_id = ?
         ORDER BY carrier, phone_number`,
      )
      .all(getCurrentTenantId()) as CarrierLineEntity[];
  }

  getById(id: number): CarrierLineEntity | null {
    return (
      (this.db
        .prepare(
          `SELECT ${this.getColumns()} FROM carrier_lines WHERE id = ? AND tenant_id = ?`,
        )
        .get(id, getCurrentTenantId()) as CarrierLineEntity | undefined) ?? null
    );
  }

  createLine(data: CreateCarrierLineData): CarrierLineEntity {
    const stmt = this.db.prepare(`
      INSERT INTO carrier_lines
        (tenant_id, carrier, phone_number, label, credits, validity_expires_at, notes, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    const result = stmt.run(
      getCurrentTenantId(),
      data.carrier,
      data.phone_number,
      data.label ?? null,
      data.credits ?? 0,
      data.validity_expires_at ?? null,
      data.notes ?? null,
    );
    return this.getById(result.lastInsertRowid as number)!;
  }

  updateLine(
    id: number,
    data: UpdateCarrierLineData,
  ): CarrierLineEntity | null {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];

    if (data.carrier !== undefined) {
      sets.push("carrier = ?");
      values.push(data.carrier);
    }
    if (data.phone_number !== undefined) {
      sets.push("phone_number = ?");
      values.push(data.phone_number);
    }
    if (data.label !== undefined) {
      sets.push("label = ?");
      values.push(data.label);
    }
    if (data.credits !== undefined) {
      sets.push("credits = ?");
      values.push(data.credits);
    }
    if (data.validity_expires_at !== undefined) {
      sets.push("validity_expires_at = ?");
      values.push(data.validity_expires_at);
    }
    if (data.notes !== undefined) {
      sets.push("notes = ?");
      values.push(data.notes);
    }
    if (data.is_active !== undefined) {
      sets.push("is_active = ?");
      values.push(data.is_active);
    }

    if (sets.length === 0) return this.getById(id);

    sets.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id, getCurrentTenantId());

    this.db
      .prepare(
        `UPDATE carrier_lines SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`,
      )
      .run(...values);

    return this.getById(id);
  }

  /**
   * The Recharge-tab inline quick-update: credits and/or a new expiry date,
   * given as ABSOLUTE new values (not deltas) — the owner-facing manual
   * hand-edit path.
   *
   * H3 DECISION (2026-07-30 adversarial review): this used to write
   * `credits`/`validity_expires_at` directly with NO `carrier_line_movements`
   * row at all — the true "sharp edge" the review named, since a manual
   * balance correction left zero audit trail and was structurally
   * indistinguishable from silent data corruption. Chose to LOG a movement
   * (reason `'manual'`) rather than remove the manual-edit capability: the
   * owner explicitly wants staff/admins to correct a line's balance/expiry
   * by hand (spec §3 decision 8's Recharge-tab flow), so the fix is to make
   * that edit auditable, not to take it away.
   *
   * `transaction_id` is always null here — a hand-typed correction is not
   * tied to a sale/self-charge transaction — so this movement is invisible
   * to the generic void/refund reversal (§8) by design; there is nothing to
   * void. `validity_days_delta` is the exact calendar-day difference when
   * both the old and new expiry are real dates; when either side is null
   * (clearing an expiry, or setting one from scratch) no clean day-count
   * exists, so it is recorded as 0 while `previous_validity_expires_at`
   * still carries the truthful old value for the audit trail. That is safe
   * because a transaction_id-less movement is never reachable from
   * `reverseMovement` via the void/refund path — an imprecise numeric delta
   * on that one edge case has no operational consequence, only an
   * audit-trail nuance.
   *
   * A no-op call (values identical to what is already stored) still applies
   * (idempotent) but skips the movement log — nothing changed, nothing to
   * audit or ever reverse.
   */
  updateBalance(id: number, data: UpdateBalanceData): CarrierLineEntity | null {
    const line = this.getById(id);
    if (!line) return null;

    const creditsChanged =
      data.credits !== undefined && data.credits !== line.credits;
    const validityChanged =
      data.validity_expires_at !== undefined &&
      data.validity_expires_at !== line.validity_expires_at;

    if (!creditsChanged && !validityChanged) {
      return this.updateLine(id, data);
    }

    const creditsDelta = creditsChanged
      ? (data.credits as number) - (line.credits ?? 0)
      : 0;
    const validityDaysDelta =
      validityChanged && line.validity_expires_at && data.validity_expires_at
        ? daysBetweenDateStrings(
            line.validity_expires_at,
            data.validity_expires_at,
          )
        : 0;

    return this.transaction(() => {
      const updated = this.updateLine(id, data)!;
      this.movementRepo.createMovement({
        carrier_line_id: id,
        transaction_id: null,
        credits_delta: creditsDelta,
        validity_days_delta: validityDaysDelta,
        previous_validity_expires_at: line.validity_expires_at,
        reason: "manual",
      });
      return updated;
    });
  }

  /** Toggle active/archived status. */
  toggleActive(id: number): CarrierLineEntity | null {
    this.db
      .prepare(
        `UPDATE carrier_lines
         SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND tenant_id = ?`,
      )
      .run(id, getCurrentTenantId());
    return this.getById(id);
  }

  /**
   * Archive (soft — sets is_active = 0). Lines are never hard-deleted.
   *
   * H2 fix (2026-07-30 adversarial review): ALSO clears `is_primary` in the
   * same statement. Before this fix, archiving the shop's primary line left
   * `is_primary = 1` on an inactive row (`is_primary` is deliberately
   * excluded from `UpdateCarrierLineData`, so the old `updateLine(id,
   * {is_active: 0})` implementation had no way to touch it), and
   * `getPrimary()` had no `is_active` predicate — so the archived line kept
   * silently receiving automated credit returns/self-charges forever.
   * Fixed BOTH halves (belt and braces, spec's own words): this method
   * clears the flag directly (bypassing `updateLine`/`UpdateCarrierLineData`
   * on purpose — `is_primary` must never be settable through the generic
   * patch path), AND `getPrimary()` independently requires `is_active = 1`
   * so ANY other path that leaves an inactive line with a stale
   * `is_primary = 1` (not just this one) is still excluded.
   */
  archive(id: number): CarrierLineEntity | null {
    this.db
      .prepare(
        `UPDATE carrier_lines
         SET is_active = 0, is_primary = 0, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND tenant_id = ?`,
      )
      .run(id, getCurrentTenantId());
    return this.getById(id);
  }

  // ---------------------------------------------------------------------------
  // is_primary (LIRA-090 §3 decision 8, v140)
  // ---------------------------------------------------------------------------

  /**
   * The primary line for a carrier — the one that receives automated
   * Only-Days credit returns and self-charges by default (overridable per
   * call). Null if no line has been designated primary yet.
   *
   * Requires `is_active = 1` (H2 fix, 2026-07-30 adversarial review) —
   * belt-and-braces alongside `archive()` clearing `is_primary` on its own
   * write: `archive()` stops a NEWLY-archived line from staying primary,
   * while THIS predicate independently stops ANY inactive row (archived via
   * any path, present or future) from ever being returned as primary, even
   * if `is_primary` somehow reads 1 on it. Either guard alone leaves a hole;
   * both together close it regardless of which path an inactive+primary row
   * came from.
   */
  getPrimary(carrier: CarrierKey): CarrierLineEntity | null {
    return (
      (this.db
        .prepare(
          `SELECT ${this.getColumns()} FROM carrier_lines
           WHERE carrier = ? AND is_primary = 1 AND is_active = 1 AND tenant_id = ?`,
        )
        .get(carrier, getCurrentTenantId()) as
        | CarrierLineEntity
        | undefined) ?? null
    );
  }

  /**
   * Make `id` the primary line for ITS OWN carrier, clearing whichever line
   * (if any) held that title before — in ONE db transaction. Skipping the
   * clear step (or splitting it across two separate calls) would let the
   * second INSERT/UPDATE hit `idx_carrier_lines_one_primary_per_carrier`
   * (at most one `is_primary = 1` row per `(tenant_id, carrier)`) and throw
   * a raw SQLite UNIQUE constraint error.
   *
   * Reads the line's own `carrier` column rather than accepting it as a
   * parameter — a single source of truth, so a caller can never pass a
   * carrier that doesn't match the line's actual row (which would silently
   * clear the WRONG carrier's primary while promoting this one).
   */
  setPrimary(id: number): CarrierLineEntity | null {
    const line = this.getById(id);
    if (!line) return null;

    return this.transaction(() => {
      const tenantId = getCurrentTenantId();
      this.db
        .prepare(
          `UPDATE carrier_lines SET is_primary = 0, updated_at = CURRENT_TIMESTAMP
           WHERE carrier = ? AND is_primary = 1 AND tenant_id = ?`,
        )
        .run(line.carrier, tenantId);

      this.db
        .prepare(
          `UPDATE carrier_lines SET is_primary = 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND tenant_id = ?`,
        )
        .run(id, tenantId);

      return this.getById(id);
    });
  }

  // ---------------------------------------------------------------------------
  // Movement-paired mutation API (LIRA-090 §5.2, §8 — H3 + M2 fixes)
  //
  // `applyMovement`/`reverseMovement` are the ONLY public entry points that
  // can move `credits`/`validity_expires_at` as a tracked, reversible
  // business event. H3 fix (2026-07-30 adversarial review): this used to be
  // TWO public methods (`applyDelta`/`reverseDelta`) that any caller holding
  // a `CarrierLineRepository` could invoke directly, mutating the line with
  // NO movement row — only a doc comment said "don't do that". The raw
  // delta math is now the private, module-level `computeAppliedState`
  // helper below: it is not a class member at all, so it is not reachable
  // from ANY external file, even one that imports `CarrierLineRepository`
  // directly. `applyMovement` is the one place that calls it, always paired
  // with a `carrier_line_movements` INSERT in the SAME db transaction — a
  // credits/validity write with no movement row is now structurally
  // impossible through this API, not just discouraged by convention.
  // ---------------------------------------------------------------------------

  /**
   * Apply a credits delta and/or a validity-days delta to a line AND write
   * the paired `carrier_line_movements` row — both in ONE db transaction
   * (spec §5.2, §8). This is the ONLY entry point money-path code (Phase 4,
   * `FinancialServiceRepository`, via `CarrierLineService.applyMovement`)
   * should use to touch a carrier line's credits/validity.
   *
   * Validity extension rule: `new_expiry = max(today, current_expiry) +
   * validity_days` — an already-expired line extends from TODAY, not the
   * stale date, so "10 more days" on a line that lapsed three months ago
   * lands 10 days from now, not 10 days after a date already in the past.
   *
   * Captures the line's `validity_expires_at` AS IT STOOD IMMEDIATELY
   * BEFORE this mutation onto the movement row
   * (`previous_validity_expires_at`, v141, M2 fix) — `reverseMovement`
   * restores that value verbatim rather than re-deriving it via day-math,
   * which is the only way to correctly undo the "already-expired extends
   * from today" rebasing above.
   *
   * Throws if `carrierLineId` does not resolve to a row — the caller
   * (`CarrierLineService.applyMovement`) catches it and returns
   * `{success: false}`; better-sqlite3's `transaction()` rolls back the
   * whole savepoint on throw, so no orphan movement row is ever left behind.
   */
  applyMovement(
    input: ApplyCarrierLineMovementInput,
  ): CarrierLineMovementMutation {
    return this.transaction(() => {
      const line = this.getById(input.carrierLineId);
      if (!line) {
        throw new Error(`Carrier line #${input.carrierLineId} not found`);
      }

      const previousValidityExpiresAt = line.validity_expires_at;
      const nextState = computeAppliedState(
        line,
        input.creditsDelta,
        input.validityDaysDelta,
      );
      const updatedLine = this.updateLine(input.carrierLineId, nextState)!;

      const movement = this.movementRepo.createMovement({
        carrier_line_id: input.carrierLineId,
        transaction_id: input.transactionId,
        credits_delta: input.creditsDelta,
        validity_days_delta: input.validityDaysDelta,
        previous_validity_expires_at: previousValidityExpiresAt,
        reason: input.reason,
      });

      return { line: updatedLine, movement };
    });
  }

  /**
   * The rule-20 reversal counterpart to `applyMovement` — the ONLY way to
   * undo a `carrier_line_movements` row. Requires an existing movement row
   * (there is nothing else to reverse FROM), so a credits/validity change
   * that was never logged via `applyMovement` can never be silently undone
   * either — the same structural guarantee applies to both directions.
   *
   * Idempotent: a no-op returning the line's CURRENT (unchanged) state when
   * the movement is already reversed or does not exist — belt-and-braces on
   * top of `TransactionRepository`'s own "already voided/refunded" guard.
   *
   * M2 fix: restores `validity_expires_at` to the movement's stored
   * `previous_validity_expires_at` VERBATIM whenever the movement touched
   * validity (`validity_days_delta !== 0`) — never by subtracting days off
   * whatever the CURRENT value happens to be. The pre-fix `reverseDelta`
   * guarded on `line.validity_expires_at` being truthy AT REVERSAL TIME and
   * silently skipped the restore when it was null (e.g. an intervening
   * manual edit had cleared it) — with no error, no log, and the movement
   * still flipped to `is_reversed = 1`. Keying off the movement's OWN
   * recorded delta instead of the line's current state closes that hole,
   * and also fixes the separate "already-expired line" drift: a naive
   * `-validityDaysDelta` cannot undo the `applyMovement` "extend from today"
   * rebasing, but restoring the exact pre-mutation snapshot always can.
   */
  reverseMovement(movementId: number): CarrierLineMovementMutation | null {
    return this.transaction(() => {
      const movement = this.movementRepo.getById(movementId);
      if (!movement) return null;

      const line = this.getById(movement.carrier_line_id);
      if (!line) {
        throw new Error(
          `Carrier line #${movement.carrier_line_id} not found (movement #${movementId})`,
        );
      }

      if (movement.is_reversed) {
        // Already reversed — no-op. Mirrors CarrierLineMovementRepository.
        // markReversed's own `is_reversed = 0` guard.
        return { line, movement };
      }

      const newCredits = (line.credits ?? 0) - movement.credits_delta;
      const newExpiry =
        movement.validity_days_delta !== 0
          ? movement.previous_validity_expires_at
          : line.validity_expires_at;

      const updatedLine = this.updateLine(movement.carrier_line_id, {
        credits: newCredits,
        validity_expires_at: newExpiry,
      })!;

      this.movementRepo.markReversed(movementId);

      return {
        line: updatedLine,
        movement: { ...movement, is_reversed: 1 },
      };
    });
  }
}

/**
 * The §5.2 extension-rule math, factored out as a plain module-level
 * function (NOT a class method — see the H3 doc block above for why that
 * matters): computes the next `{credits, validity_expires_at}` state for
 * `applyMovement`, but is not itself reachable from outside this module, so
 * it cannot be called without also going through `applyMovement`'s paired
 * movement write.
 */
function computeAppliedState(
  line: CarrierLineEntity,
  creditsDelta: number,
  validityDaysDelta: number,
): Pick<UpdateCarrierLineData, "credits" | "validity_expires_at"> {
  const newCredits = (line.credits ?? 0) + creditsDelta;

  let newExpiry = line.validity_expires_at;
  if (validityDaysDelta !== 0) {
    const today = localDay();
    const base =
      line.validity_expires_at && line.validity_expires_at > today
        ? line.validity_expires_at
        : today;
    newExpiry = addDaysToDateString(base, validityDaysDelta);
  }

  return { credits: newCredits, validity_expires_at: newExpiry };
}

// =============================================================================
// Singleton
// =============================================================================

let instance: CarrierLineRepository | null = null;

export function getCarrierLineRepository(): CarrierLineRepository {
  if (!instance) {
    instance = new CarrierLineRepository();
  }
  return instance;
}

export function resetCarrierLineRepository(): void {
  instance = null;
}
