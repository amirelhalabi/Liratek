import { z } from "zod";
import { positiveDecimalSchema, positiveIntegerSchema } from "./common.js";

/**
 * Daily closing validation schemas
 */

const drawerAmountSchema = z.object({
  currency: z.enum(["USD", "LBP", "EUR"]),
  amount: positiveDecimalSchema,
});

export const setOpeningBalancesSchema = z.object({
  closingDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  amounts: z
    .array(drawerAmountSchema)
    .min(1, "At least one drawer amount is required"),
  userId: positiveIntegerSchema,
});

export const createDailyClosingSchema = z.object({
  closingDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  amounts: z
    .array(drawerAmountSchema)
    .min(1, "At least one drawer amount is required"),
  userId: positiveIntegerSchema,
  notes: z.string().max(1000).optional(),
});

export type DrawerAmountInput = z.infer<typeof drawerAmountSchema>;
export type SetOpeningBalancesInput = z.infer<typeof setOpeningBalancesSchema>;
export type CreateDailyClosingInput = z.infer<typeof createDailyClosingSchema>;
