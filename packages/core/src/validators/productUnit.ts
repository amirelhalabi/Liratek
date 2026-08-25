import { z } from "zod";

/**
 * Product unit (per-IMEI phone tracking) validation — LIRA-143 Phase 5
 * (current_sprint.md, owner-interviewed 2026-08-23). Shared by the Electron
 * IPC handlers (`electron-app/handlers/productUnitHandlers.ts`, re-exported
 * via `electron-app/schemas/index.ts`) and the REST routes
 * (`backend/src/api/productUnits.ts`) — CLAUDE.md rule 14, same shape as
 * `validators/exchangeLot.ts`.
 */

// =============================================================================
// Intake — register IMEI units against a product model
// =============================================================================

export const registerProductUnitsSchema = z.object({
  product_id: z.number().int().positive(),
  imeis: z.array(z.string().trim().min(1, "IMEI must not be blank")).min(1),
});

export type RegisterProductUnitsInput = z.infer<
  typeof registerProductUnitsSchema
>;

// =============================================================================
// Reads
// =============================================================================

export const productUnitStatusSchema = z.enum(["IN_STOCK", "SOLD"]);

/** `productId` uses `z.coerce` (see `lotBreakdownSchema`'s doc) so the SAME
 *  schema validates a REST path param (always a string) and an IPC data
 *  object (already a number). */
export const productUnitsForProductSchema = z.object({
  productId: z.coerce.number().int().positive(),
  status: productUnitStatusSchema.optional(),
});

export type ProductUnitsForProductInput = z.infer<
  typeof productUnitsForProductSchema
>;

export const productUnitsSummarySchema = z.object({
  product_ids: z.array(z.number().int().positive()).min(1),
});

export type ProductUnitsSummaryInput = z.infer<
  typeof productUnitsSummarySchema
>;

/** `id` uses `z.coerce` — REST's `DELETE /:id` param is always a string,
 *  IPC's positional `unitId` arg is already a number. */
export const productUnitIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export type ProductUnitIdInput = z.infer<typeof productUnitIdSchema>;

/** The walk-in lookup (decision #7) — `imei` as a query param (REST) or a
 *  wrapped positional arg (IPC). */
export const unitStoryQuerySchema = z.object({
  imei: z.string().min(1, "imei is required"),
});

export type UnitStoryQueryInput = z.infer<typeof unitStoryQuerySchema>;

/** Phase 6 refund UI — the units linked to a sale being refunded (imei +
 *  defective checkbox + warranty-override date per unit), fed by
 *  `ProductUnitRepository.findBySaleItemIds`. */
export const unitsForSaleItemsSchema = z.object({
  sale_item_ids: z.array(z.number().int().positive()).min(1),
});

export type UnitsForSaleItemsInput = z.infer<typeof unitsForSaleItemsSchema>;

// =============================================================================
// Scanner resolve (LIRA-143 Phase 3, owner decision #2) — barcode-or-IMEI
// =============================================================================

export const resolveScanCodeSchema = z.object({
  code: z.string().min(1, "code is required"),
});

export type ResolveScanCodeInput = z.infer<typeof resolveScanCodeSchema>;

// =============================================================================
// Category flag (owner decision #9 — Settings toggle plumbing). No shared
// schema existed for `inventory:update-category`/`inventory:create-category`
// before this (the IPC handler called the repository directly with no Zod
// gate) — lifted here per rule 19b since the flag now needs validation on
// BOTH transports.
// =============================================================================

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Category name is required"),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

/** At least one of `name`/`tracks_imei_units` must be provided — an
 *  all-omitted update is a no-op the caller should not have sent. */
export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1, "Category name is required").optional(),
    tracks_imei_units: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.tracks_imei_units !== undefined, {
    message: "At least one of name or tracks_imei_units must be provided",
  });

export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
