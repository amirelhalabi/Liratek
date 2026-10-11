import { z } from "zod";
import { clientDayInputSchema, localDayFormatSchema } from "./common.js";

/**
 * LIRA-309 — phone lines the shop holds FOR SALE (inventory products in a
 * lines category, LIRA-207) and their details (carrier, credit, expiry).
 * Shared by the Electron IPC handlers (`electron-app/handlers/
 * resaleLineHandlers.ts`, re-exported via `electron-app/schemas/index.ts`)
 * and the REST routes (`backend/src/api/resaleLines.ts`) — CLAUDE.md rules
 * 14 and 21. Contract: `specs/309-phone-lines-management/contracts/
 * resale-lines.md`.
 */

export const resaleLineCarrierSchema = z.enum(["mtc", "alfa"]);
export type ResaleLineCarrier = z.infer<typeof resaleLineCarrierSchema>;

/** A real calendar day, `YYYY-MM-DD` (rejects `2026-02-30`). */
const calendarDaySchema = localDayFormatSchema.refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Enter a real date");

// =============================================================================
// Reads
// =============================================================================

/** One object, the whole IPC arg and the REST query. `include_sold` arrives
 *  as a string on REST, so it is coerced from "true"/"false". */
export const listResaleLinesQuerySchema = z.object({
  carrier: resaleLineCarrierSchema.optional(),
  include_sold: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((v) => v === true || v === "true"),
});

export type ListResaleLinesQueryInput = z.input<
  typeof listResaleLinesQuerySchema
>;
export type ListResaleLinesQuery = z.output<typeof listResaleLinesQuerySchema>;

// =============================================================================
// Writes
// =============================================================================

/** Create or update a for-sale line's details (admin). */
export const saveResaleLineSchema = z.object({
  product_id: z.number().int().positive(),
  carrier: resaleLineCarrierSchema,
  validity_expires_at: calendarDaySchema.nullable().optional(),
  credits: z.number().min(0, "Credit cannot be negative").optional(),
});

export type SaveResaleLineInput = z.input<typeof saveResaleLineSchema>;
export type SaveResaleLineData = z.output<typeof saveResaleLineSchema>;

/** Write off a lost for-sale line (admin) — FR-016. */
export const writeOffResaleLineSchema = z.object({
  product_id: z.number().int().positive(),
  note: z.string().trim().max(500).optional(),
  client_day: clientDayInputSchema,
});

export type WriteOffResaleLineInput = z.input<typeof writeOffResaleLineSchema>;
export type WriteOffResaleLineData = z.output<
  typeof writeOffResaleLineSchema
>;
