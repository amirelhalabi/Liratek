/**
 * Carrier Line Service (LIRA W6.a)
 *
 * Business logic wrapper around CarrierLineRepository. Informational only —
 * no drawer legs, no checkout/closing involvement.
 */

import {
  CarrierLineRepository,
  getCarrierLineRepository,
  type CarrierKey,
  type CarrierLineEntity,
  type CreateCarrierLineData,
  type UpdateCarrierLineData,
  type UpdateBalanceData,
  type RecordCarrierLineUsageData,
  type RecordCarrierLineUsageResult,
} from "../repositories/CarrierLineRepository.js";
import {
  CarrierLineMovementRepository,
  getCarrierLineMovementRepository,
  type CarrierLineMovementEntity,
} from "../repositories/CarrierLineMovementRepository.js";
import { financialLogger } from "../utils/logger.js";

// =============================================================================
// Types
// =============================================================================

export interface CarrierLineResult {
  success: boolean;
  data?: CarrierLineEntity;
  error?: string;
}

/**
 * Input to `applyMovement` — the ONE entry point for the money-path agent
 * (Phase 4, FinancialServiceRepository) to mutate a carrier line's credits
 * and/or validity. `carrierLineId` is normally the shop's primary line for
 * the relevant carrier (`CarrierLineRepository.getPrimary`), overridable per
 * call (spec §3 decision 8).
 */
export interface ApplyMovementInput {
  carrierLineId: number;
  /** USD credit to add (Only-Days return) or subtract. Omit or 0 for a
   *  validity-only movement. */
  creditsDelta?: number;
  /** Days to move validity by. POSITIVE charges the line, NEGATIVE consumes
   *  days off it; the rule that decides where the result lands (stack on a
   *  live line, start from today inside the 5-day revival grace, refuse past
   *  it, clip at 365 days) is `projectValidityExpiry` in
   *  `utils/carrierLineValidity.ts` — LIRA-157, superseding spec §5.2's
   *  `max(today, current_expiry) + validity_days`. A refused charge comes back
   *  as `{success: false, error}` from {@link CarrierLineService.applyMovement},
   *  carrying the operator-facing sentence verbatim. Omit or 0 for a
   *  credits-only movement. */
  validityDaysDelta?: number;
  /** ABSOLUTE new expiry (`YYYY-MM-DD`) — the counted-date variant (Phase 3).
   *  Mutually exclusive with a non-zero `validityDaysDelta`; satisfies the
   *  "at least one thing changed" guard on its own, so a validity-only count
   *  with `creditsDelta === 0` is a legal movement. See
   *  {@link import("../repositories/CarrierLineRepository.js").ApplyCarrierLineMovementInput.validityExpiresAt}
   *  for why a day-delta cannot express a counted date. */
  validityExpiresAt?: string;
  /** Required — `carrier_line_movements.reason` is NOT NULL. Use one
   *  consistent vocabulary per call site (e.g. 'ONLY_DAYS_RETURN',
   *  'SELF_CHARGE'). */
  reason: string;
  /** The unified `transactions.id` this movement rides on, if any. Nullable
   *  — a movement with no transaction_id is invisible to the generic void/
   *  refund reversal (nothing to reverse it FROM). Pass the real id
   *  whenever the calling flow creates one. */
  transactionId?: number | null;
}

export interface ApplyMovementData {
  line: CarrierLineEntity;
  movement: CarrierLineMovementEntity;
}

export interface ApplyMovementResult {
  success: boolean;
  data?: ApplyMovementData;
  error?: string;
}

/** Output of {@link CarrierLineService.reverseMovement}. */
export interface ReverseMovementResult {
  success: boolean;
  data?: ApplyMovementData;
  error?: string;
}

/** Output of {@link CarrierLineService.recordUsage} (LIRA-145). */
export interface RecordUsageResult {
  success: boolean;
  data?: RecordCarrierLineUsageResult;
  error?: string;
}

// =============================================================================
// Service
// =============================================================================

export class CarrierLineService {
  private repo: CarrierLineRepository;
  private movementRepo: CarrierLineMovementRepository;

  constructor(
    repo?: CarrierLineRepository,
    movementRepo?: CarrierLineMovementRepository,
  ) {
    this.repo = repo ?? getCarrierLineRepository();
    this.movementRepo = movementRepo ?? getCarrierLineMovementRepository();
  }

  /** Active lines for one carrier — the Recharge-tab compact panel. */
  getActiveByCarrier(carrier: CarrierKey): CarrierLineEntity[] {
    try {
      return this.repo.getActiveByCarrier(carrier);
    } catch (error) {
      financialLogger.error(
        { error, carrier },
        "Failed to get active carrier lines",
      );
      return [];
    }
  }

  /** All active lines, every carrier. */
  getAllActive(): CarrierLineEntity[] {
    try {
      return this.repo.getAllActive();
    } catch (error) {
      financialLogger.error({ error }, "Failed to get active carrier lines");
      return [];
    }
  }

  /**
   * The sum invariant's single definition (§0.1, rule 14) — Σ credits of
   * that carrier's active lines.
   *
   * Deliberately RETHROWS rather than returning a fallback. Phase 3 uses
   * this value to SET the provider drawer balance, so "lookup failed" and
   * "this carrier has no lines" must never collapse to the same number: a
   * swallowed error returning 0 would zero the drawer and post a large
   * negative checkpoint delta. The legitimate empty case is already 0 via
   * the repository's COALESCE; anything else is a real fault and must
   * abort the caller's transaction.
   */
  getCarrierCreditsSum(carrier: CarrierKey): number {
    try {
      return this.repo.getCarrierCreditsSum(carrier);
    } catch (error) {
      financialLogger.error(
        { error, carrier },
        "Failed to get carrier credits sum",
      );
      throw error;
    }
  }

  /** Every line including archived — the Settings manager. */
  getAllIncludingInactive(): CarrierLineEntity[] {
    try {
      return this.repo.getAllIncludingInactive();
    } catch (error) {
      financialLogger.error({ error }, "Failed to get carrier lines");
      return [];
    }
  }

  /** A line's full movement/audit history (newest first) — every
   *  `applyMovement`/manual `updateBalance` change, reversed or not. */
  getMovementHistory(carrierLineId: number): CarrierLineMovementEntity[] {
    try {
      return this.movementRepo.getByCarrierLineId(carrierLineId);
    } catch (error) {
      financialLogger.error(
        { error, carrierLineId },
        "Failed to get carrier line movement history",
      );
      return [];
    }
  }

  create(data: CreateCarrierLineData): CarrierLineResult {
    try {
      if (!data.carrier || !data.phone_number) {
        return {
          success: false,
          error: "Carrier and phone number are required",
        };
      }
      const line = this.repo.createLine(data);
      financialLogger.info(
        { lineId: line.id, carrier: data.carrier },
        "Carrier line created",
      );
      return { success: true, data: line };
    } catch (error) {
      financialLogger.error({ error }, "Failed to create carrier line");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  update(id: number, data: UpdateCarrierLineData): CarrierLineResult {
    try {
      const line = this.repo.updateLine(id, data);
      if (!line) return { success: false, error: "Carrier line not found" };
      financialLogger.info({ lineId: id }, "Carrier line updated");
      return { success: true, data: line };
    } catch (error) {
      financialLogger.error({ error, id }, "Failed to update carrier line");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** The Recharge-tab inline quick-update: credits and/or a new expiry date. */
  updateBalance(id: number, data: UpdateBalanceData): CarrierLineResult {
    try {
      const line = this.repo.updateBalance(id, data);
      if (!line) return { success: false, error: "Carrier line not found" };
      financialLogger.info({ lineId: id }, "Carrier line balance updated");
      return { success: true, data: line };
    } catch (error) {
      financialLogger.error(
        { error, id },
        "Failed to update carrier line balance",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * The movement-logged mutation API (LIRA-090 §5.2, §8, rule 20). Applies a
   * credits delta and/or a validity-days delta to a carrier line and writes
   * a `carrier_line_movements` row documenting exactly what changed — BOTH
   * in ONE db transaction. Delegates the actual write to
   * `CarrierLineRepository.applyMovement` (H3 fix, 2026-07-30 adversarial
   * review): the atomic pairing now lives in the repository itself, where
   * the raw delta math is a private, module-scoped helper unreachable from
   * any other file — not just a convention this service happened to follow.
   * This method's job is the business-rule validation in front of that
   * write (reason required, at least one delta non-zero) plus logging.
   *
   * This is the ONLY entry point money-path code (Phase 4,
   * `FinancialServiceRepository`) should use to touch a carrier line's
   * credits/validity.
   */
  applyMovement(input: ApplyMovementInput): ApplyMovementResult {
    try {
      const creditsDelta = input.creditsDelta ?? 0;
      const validityDaysDelta = input.validityDaysDelta ?? 0;

      if (!input.reason || input.reason.trim() === "") {
        return { success: false, error: "reason is required" };
      }
      if (
        creditsDelta === 0 &&
        validityDaysDelta === 0 &&
        input.validityExpiresAt === undefined
      ) {
        return {
          success: false,
          error:
            "At least one of creditsDelta, validityDaysDelta or validityExpiresAt must be supplied",
        };
      }

      const data = this.repo.applyMovement({
        carrierLineId: input.carrierLineId,
        creditsDelta,
        validityDaysDelta,
        ...(input.validityExpiresAt !== undefined
          ? { validityExpiresAt: input.validityExpiresAt }
          : {}),
        reason: input.reason,
        transactionId: input.transactionId ?? null,
      });

      financialLogger.info(
        {
          carrierLineId: input.carrierLineId,
          creditsDelta,
          validityDaysDelta,
          validityExpiresAt: input.validityExpiresAt ?? null,
          reason: input.reason,
          transactionId: input.transactionId ?? null,
          movementId: data.movement.id,
        },
        "Carrier line movement applied",
      );
      return { success: true, data };
    } catch (error) {
      financialLogger.error(
        { error, input },
        "Failed to apply carrier line movement",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * The rule-20 reversal counterpart to `applyMovement` — the sanctioned
   * entry point for undoing a `carrier_line_movements` row (used by
   * `TransactionRepository._reverseCarrierLineMovements` on every void/
   * refund). Delegates to `CarrierLineRepository.reverseMovement`, which
   * restores `validity_expires_at` from the movement's stored
   * `previous_validity_expires_at` verbatim (M2 fix) rather than
   * subtracting days off whatever the line's current value happens to be.
   */
  reverseMovement(movementId: number): ReverseMovementResult {
    try {
      const data = this.repo.reverseMovement(movementId);
      if (!data) {
        return {
          success: false,
          error: `Carrier line movement #${movementId} not found`,
        };
      }
      financialLogger.info(
        { movementId, carrierLineId: data.line.id },
        "Carrier line movement reversed",
      );
      return { success: true, data };
    } catch (error) {
      financialLogger.error(
        { error, movementId },
        "Failed to reverse carrier line movement",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Record CONSUMPTION of a shop line's credits as a `Line_Usage` expense
   * (LIRA-145). Thin orchestration only — every rule (line exists, line
   * active, `expectedCurrentCredits` still matches, delta strictly positive)
   * and every write live in `CarrierLineRepository.recordUsage`, inside one
   * db transaction, so a rejection can never leave a partial expense behind.
   * This method's job is the envelope and the log line.
   */
  recordUsage(
    data: RecordCarrierLineUsageData,
    userId: number,
  ): RecordUsageResult {
    try {
      const result = this.repo.recordUsage(data, userId);
      financialLogger.info(
        {
          carrierLineId: data.carrierLineId,
          expenseId: result.expenseId,
          transactionId: result.transactionId,
          creditsUsed: result.creditsUsed,
          newCredits: result.newCredits,
          userId,
        },
        "Carrier line usage recorded",
      );
      return { success: true, data: result };
    } catch (error) {
      financialLogger.error(
        { error, data, userId },
        "Failed to record carrier line usage",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  archive(id: number): CarrierLineResult {
    try {
      const line = this.repo.archive(id);
      if (!line) return { success: false, error: "Carrier line not found" };
      financialLogger.info({ lineId: id }, "Carrier line archived");
      return { success: true, data: line };
    } catch (error) {
      financialLogger.error({ error, id }, "Failed to archive carrier line");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  toggleActive(id: number): CarrierLineResult {
    try {
      const line = this.repo.toggleActive(id);
      if (!line) return { success: false, error: "Carrier line not found" };
      financialLogger.info(
        { lineId: id, isActive: line.is_active },
        "Carrier line toggled",
      );
      return { success: true, data: line };
    } catch (error) {
      financialLogger.error({ error, id }, "Failed to toggle carrier line");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Primary-line designation (LIRA-090 §3 decision 8, v140)
  // ---------------------------------------------------------------------------

  /**
   * The primary line for a carrier — the one that receives automated
   * Only-Days credit returns and self-charges by default. Returns `null`
   * if no line has been designated primary yet.
   */
  getPrimary(carrier: CarrierKey): CarrierLineResult {
    try {
      const line = this.repo.getPrimary(carrier);
      if (!line) return { success: false, error: "No primary line set" };
      return { success: true, data: line };
    } catch (error) {
      financialLogger.error(
        { error, carrier },
        "Failed to get primary carrier line",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Make `id` the primary line for its own carrier, clearing the previous
   * primary holder in a single DB transaction. Only an active (non-archived)
   * line may be set primary — the partial unique index enforces at most one
   * primary per (tenant, carrier).
   */
  setPrimary(id: number): CarrierLineResult {
    try {
      const line = this.repo.setPrimary(id);
      if (!line) return { success: false, error: "Carrier line not found" };
      financialLogger.info(
        { lineId: id, carrier: line.carrier },
        "Carrier line set as primary",
      );
      return { success: true, data: line };
    } catch (error) {
      financialLogger.error(
        { error, id },
        "Failed to set primary carrier line",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: CarrierLineService | null = null;

export function getCarrierLineService(): CarrierLineService {
  if (!instance) {
    instance = new CarrierLineService();
  }
  return instance;
}

export function resetCarrierLineService(): void {
  instance = null;
}
