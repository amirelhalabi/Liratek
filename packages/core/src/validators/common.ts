import { z } from "zod";

/**
 * Common validation schemas used across multiple entities
 */

// Phone number validation (Lebanese format)
export const phoneNumberSchema = z
  .string()
  .regex(/^\+?[0-9]{8,15}$/, "Invalid phone number format");

/**
 * Same format check as `phoneNumberSchema`, but also accepts a blank string.
 * `.optional()` alone only permits `undefined` — it still 400s on `""` — and
 * every form field that renders an optional phone input (no client picked,
 * walk-in left it blank) submits `""`, not a missing key. The desktop IPC
 * copy of these contracts has always accepted `""` here (raw/no-op schemas,
 * or `z.string().optional().nullable()`), so this matches that existing
 * behaviour rather than tightening it (CLAUDE.md rule 14/19: one contract,
 * and the looser transport wins so a working flow doesn't start failing).
 * A non-empty value still has to pass the real regex.
 */
export const optionalPhoneNumberSchema = z
  .union([phoneNumberSchema, z.literal("")])
  .optional();

// Currency codes — dynamic: accepts any 2-10 char string, uppercased.
// Runtime validation against DB happens at the service layer.
export const currencyCodeSchema = z
  .string()
  .min(2, "Currency code must be at least 2 characters")
  .max(10, "Currency code must be at most 10 characters")
  .transform((v) => v.toUpperCase());

// Positive decimal
export const positiveDecimalSchema = z.number().nonnegative();

// Positive integer
export const positiveIntegerSchema = z.number().int().nonnegative();

// Date string (ISO format)
export const dateStringSchema = z.string().datetime();

// Pagination
export const paginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

// ID validation
export const idSchema = z.number().int().positive();

/** Optional ISO datetime for backdating transactions. */
export const transactionTimeSchema = z.string().datetime().optional();
