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

/**
 * Internal recharge of a line held for sale (LIRA-309 US3). Three sources
 * (owner, 2026-10-11): MTC/Alfa DAYS taken from a shop line, CREDIT moved from
 * a shop line, or a CARD from the iPick/Katsh balance. The recharge's cost is
 * added to the line's cost and selling price.
 */
export const rechargeResaleLineSchema = z
  .object({
    product_id: z.number().int().positive(),
    source: z.enum(["CARD", "SHOP_LINE_CREDIT", "DAYS"]),
    /** CARD: the iPick/Katsh catalog card (same carrier as the line). */
    mobile_service_item_id: z.number().int().positive().optional(),
    /** SHOP_LINE_CREDIT: USD credit moved onto the line. */
    credits: z.number().positive().optional(),
    /** DAYS: days added, and what they cost the shop in USD. */
    days: z.number().int().positive().optional(),
    days_cost_usd: z.number().positive().optional(),
    /** SHOP_LINE_CREDIT / DAYS: source shop line (default: primary). */
    source_carrier_line_id: z.number().int().positive().optional(),
    /** USD→LBP rate the cashier saw; server sell rate is the fallback. */
    exchange_rate: z.number().positive().optional(),
    client_day: clientDayInputSchema,
  })
  .superRefine((d, ctx) => {
    if (d.source === "CARD" && d.mobile_service_item_id === undefined) {
      ctx.addIssue({ code: "custom", path: ["mobile_service_item_id"], message: "Pick the card" });
    }
    if (d.source === "SHOP_LINE_CREDIT" && d.credits === undefined) {
      ctx.addIssue({ code: "custom", path: ["credits"], message: "Enter the credit to move" });
    }
    if (d.source === "DAYS" && (d.days === undefined || d.days_cost_usd === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: [d.days === undefined ? "days" : "days_cost_usd"],
        message: "Enter the days and what they cost",
      });
    }
  });

export type RechargeResaleLineInput = z.input<typeof rechargeResaleLineSchema>;
export type RechargeResaleLineData = z.output<typeof rechargeResaleLineSchema>;
