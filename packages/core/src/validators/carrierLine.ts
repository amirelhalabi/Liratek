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

/**
 * Record CONSUMPTION of a shop line's credits as an expense (LIRA-145).
 *
 * The operator reads the line's NEW balance off the SIM (or types the amount
 * used, which the UI resolves to a new balance before calling); the shop
 * books the difference as a `Line_Usage` expense at face value — $1 per
 * credit, USD only, paid out of the carrier's own credit drawer. No cash
 * moves.
 *
 * Deliberately NOT a `.refine`d "newCredits < current" schema: the current
 * balance is a SERVER fact (the `carrier_lines` row), so every
 * delta/ordering rule — line exists, line is active, `newCredits` is
 * strictly below the stored balance by at least the $0.01 epsilon — is
 * enforced in `CarrierLineRepository.recordUsage`, inside the same db
 * transaction that writes the rows. A client-side-checkable schema rule
 * here would be a second, weaker copy of that (rule 14).
 *
 * `expectedCurrentCredits` is the optimistic-concurrency guard: the UI sends
 * the balance it rendered the form against, and the server rejects if the
 * line has moved since (a concurrent self-charge, Only-Days return, or a
 * second operator's usage entry) rather than silently booking a
 * differently-sized expense than the one the operator previewed.
 */
export const recordCarrierLineUsageSchema = z.object({
  carrierLineId: z.number().int().positive(),
  newCredits: z.number().min(0),
  expectedCurrentCredits: z.number().min(0).optional(),
  note: z.string().max(500).optional(),
});

export type CarrierLineCreateInput = z.infer<typeof carrierLineCreateSchema>;
export type CarrierLineUpdateInput = z.infer<typeof carrierLineUpdateSchema>;
export type CarrierLineUpdateBalanceInput = z.infer<
  typeof carrierLineUpdateBalanceSchema
>;
export type RecordCarrierLineUsageInput = z.infer<
  typeof recordCarrierLineUsageSchema
>;
