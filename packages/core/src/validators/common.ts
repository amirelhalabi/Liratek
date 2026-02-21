import { z } from "zod";

/**
 * Common validation schemas used across multiple entities
 */

// Phone number validation (Lebanese format)
export const phoneNumberSchema = z
  .string()
  .regex(/^\+?[0-9]{8,15}$/, "Invalid phone number format");

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
