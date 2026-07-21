import { z } from "zod";

/**
 * Carrier Line validation schemas (LIRA W6.a — shop SIM-line tracking).
 *
 * Informational only: no drawer legs, no checkout/closing involvement.
 * `validity_expires_at` is a DATE string (YYYY-MM-DD) — the UI may let the
 * operator type "days from today", but it always resolves that to a date
 * before calling the API; days-remaining is derived from the stored date at
 * render time so the figure never goes stale (a stored day-count would).
 */

const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date string");

export const carrierLineCreateSchema = z.object({
  carrier: z.enum(["alfa", "mtc"]),
  phone_number: z.string().trim().min(1, "Phone number is required"),
  label: z.string().trim().max(200).optional().nullable(),
  credits: z.number().nonnegative().optional().default(0),
  validity_expires_at: dateStringSchema.optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const carrierLineUpdateSchema = z.object({
  id: z.number().int().positive(),
  carrier: z.enum(["alfa", "mtc"]).optional(),
  phone_number: z.string().trim().min(1).optional(),
  label: z.string().trim().max(200).optional().nullable(),
  credits: z.number().nonnegative().optional(),
  validity_expires_at: dateStringSchema.optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  is_active: z.number().int().min(0).max(1).optional(),
});

/**
 * The Recharge-tab inline quick-update: credits and/or a new expiry, at
 * least one of the two must be present.
 */
export const carrierLineUpdateBalanceSchema = z
  .object({
    id: z.number().int().positive(),
    credits: z.number().nonnegative().optional(),
    validity_expires_at: dateStringSchema.optional().nullable(),
  })
  .refine(
    (d) => d.credits !== undefined || d.validity_expires_at !== undefined,
    {
      message: "Provide credits and/or a new validity_expires_at",
      path: ["credits"],
    },
  );

export type CarrierLineCreateInput = z.infer<typeof carrierLineCreateSchema>;
export type CarrierLineUpdateInput = z.infer<typeof carrierLineUpdateSchema>;
export type CarrierLineUpdateBalanceInput = z.infer<
  typeof carrierLineUpdateBalanceSchema
>;
