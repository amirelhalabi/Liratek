import { z } from "zod";
import { currencyCodeSchema, positiveDecimalSchema } from "./common.js";

/**
 * Exchange lot engine validation (EXCHANGE_LOT_SETTLEMENT.md Phase 4a) — the
 * read/admin API surface over `ExchangeLotRepository` (Phase 2). Shared by
 * the Electron IPC handlers (`electron-app/handlers/exchangeLotHandlers.ts`,
 * re-exported via `electron-app/schemas/index.ts`) and the REST routes
 * (`backend/src/api/exchangeLots.ts`) — CLAUDE.md rule 14.
 */

// =============================================================================
// Preview (Q10 — feeds the loss-confirm dialog before submit)
// =============================================================================

export const previewLotSettlementSchema = z.object({
  currencyCode: currencyCodeSchema,
  /** Quantity of `currencyCode` being disbursed. */
  qty: positiveDecimalSchema,
  /** USD proceeds per unit the operator's executed rate implies. */
  unitProceedsUsd: positiveDecimalSchema,
});

export type PreviewLotSettlementInput = z.infer<
  typeof previewLotSettlementSchema
>;

// =============================================================================
// Breakdown (per-exchange settlement history, lazily fetched on expand)
// =============================================================================

export const lotBreakdownSchema = z.object({
  /** `z.coerce` — this same schema validates a REST path param (always a
   *  string) and an IPC data object (already a number); coercion makes both
   *  callers safe without a second schema. */
  exchangeId: z.coerce.number().int().positive(),
});

export type LotBreakdownInput = z.infer<typeof lotBreakdownSchema>;

// =============================================================================
// Admin position adjustment (Q15 — drift correction, admin-only on both
// transports)
// =============================================================================

// Mirrors the validation `ExchangeLotRepository.adjust()` itself enforces
// (qty !== 0; unitCostUsd > 0 required only for an add) so a bad payload
// fails at the IPC/REST door with the same message instead of deep inside
// the repository's own throw.
export const adjustLotPositionSchema = z.object({
  currencyCode: currencyCodeSchema,
  /** Signed: positive adds to the position (requires `unitCostUsd`),
   *  negative writes it off (FIFO, at each lot's own cost — never 0). */
  qty: z
    .number()
    .refine((v) => v !== 0, {
      message:
        "qty must not be 0 — pass a positive qty to add or a negative qty to write off",
    }),
  /** Required (and must be > 0) only when `qty > 0` — enforced by the
   *  repository, not re-checked here (that conditional-required shape isn't
   *  expressible as a single field constraint without a `.refine()` that
   *  duplicates the repository's own error message; the repository is the
   *  authoritative guard, this schema only rejects the unconditionally
   *  invalid case of a non-positive cost). */
  unitCostUsd: z.number().positive().optional(),
  note: z.string().max(500).optional(),
});

export type AdjustLotPositionInput = z.infer<typeof adjustLotPositionSchema>;
