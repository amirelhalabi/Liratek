import { z } from "zod";

/**
 * Common validation schemas used across multiple entities
 */

// Phone number validation (Lebanese format)
export const phoneNumberSchema = z
  .string()
  .regex(/^\+?[0-9]{8,15}$/, "Invalid phone number format");

// Currency codes
export const currencyCodeSchema = z.enum(["USD", "LBP", "EUR"]);

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
