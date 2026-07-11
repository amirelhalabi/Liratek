import { z } from "zod";
import {
  positiveDecimalSchema,
  positiveIntegerSchema,
  currencyCodeSchema,
} from "./common.js";

/**
 * Daily closing validation schemas
 */

const drawerAmountSchema = z.object({
  currency: currencyCodeSchema,
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

// Per-drawer/currency line of a unified checkpoint: the physical count plus
// the expected (system) amount at count time. Shape matches CheckpointAmount
// in ClosingRepository (drawer_name/currency_code/expected_amount/physical_amount) —
// distinct from the legacy {currency, amount} drawerAmountSchema above.
const checkpointAmountSchema = z.object({
  drawer_name: z.string().min(1),
  currency_code: currencyCodeSchema,
  expected_amount: z.number(),
  physical_amount: z.number().nonnegative(),
});

// Create a unified checkpoint (the money write: reconciles each drawer/currency
// to its physical count via a delta to the payments journal + drawer_balances).
// Shared by the REST route (rule 14). NO user_id — the actor is injected
// server-side from the JWT, never trusted from the client.
export const createCheckpointSchema = z.object({
  drawer_name: z.string().min(1),
  notes: z.string().max(1000).optional(),
  report_path: z.string().optional(),
  amounts: z
    .array(checkpointAmountSchema)
    .min(1, "At least one drawer amount is required"),
});

export type DrawerAmountInput = z.infer<typeof drawerAmountSchema>;
export type SetOpeningBalancesInput = z.infer<typeof setOpeningBalancesSchema>;
export type CreateDailyClosingInput = z.infer<typeof createDailyClosingSchema>;
export type CheckpointAmountInput = z.infer<typeof checkpointAmountSchema>;
export type CreateCheckpointInput = z.infer<typeof createCheckpointSchema>;
