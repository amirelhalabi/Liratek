import { z } from "zod";
import { phoneNumberSchema } from "./common.js";

/**
 * Client validation schemas
 */

export const createClientSchema = z.object({
  full_name: z.string().min(1, "Name is required").max(255),
  phone_number: phoneNumberSchema,
  notes: z.string().max(1000).optional(),
  whatsapp_opt_in: z.boolean().default(true),
});

export const updateClientSchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string().min(1).max(255).optional(),
  phone_number: phoneNumberSchema.optional(),
  notes: z.string().max(1000).optional(),
  whatsapp_opt_in: z.boolean().optional(),
});

export const getClientSchema = z.object({
  id: z.number().int().positive(),
});

export const searchClientsSchema = z.object({
  search: z.string().optional(),
  limit: z.number().int().positive().max(100).default(50),
});

/**
 * Bulk import of clients and their debt history, parsed from an Excel sheet.
 *
 * Mirrors `ImportedClientData` / `ImportedDebtEntry` in ClientService. Defined
 * here so BOTH transports validate identically (rule 19b): the REST route feeds
 * it to `validateRequest`, the IPC handler to `validatePayload`. Until now this
 * path had no schema at all on either side — the browser could not reach it and
 * the desktop handler took `data: ImportedClientData[]` on trust.
 *
 * `phone` is intentionally NOT `phoneNumberSchema`: the service itself decides
 * what to do with a blank phone (it discards those clients and reports the
 * count), and rejecting the whole spreadsheet because one row is missing a
 * number would be far worse than importing the rest and saying so.
 */
// Deliberately NO STRICTER than what the desktop handler already accepts.
// Desktop takes this payload on trust, so any rule added here that real
// spreadsheets violate would mean the same file imports on desktop and is
// rejected on the web — a per-transport difference in behaviour, which is
// exactly what rule 19 exists to prevent. The caps below are generous on
// purpose: they bound abuse, they do not enforce data quality.
export const importedDebtEntrySchema = z.object({
  date: z.string().nullable(),
  amount_usd: z.number(),
  amount_lbp: z.number(),
  // An Excel description cell. Long ones are odd, not invalid — and losing a
  // whole import to one verbose cell would be a worse outcome than storing it.
  description: z.string().max(5000),
  type: z.enum(["debt", "payment"]),
});

export const importedClientSchema = z.object({
  name: z.string().max(255),
  // Not `phoneNumberSchema`, and no `min(1)`: the SERVICE decides what a blank
  // phone means (it discards that client and reports the count). Rejecting the
  // spreadsheet here would replace a partial import plus a summary with a
  // total failure.
  phone: z.string().max(50),
  entries: z.array(importedDebtEntrySchema),
});

/**
 * The payload itself. Capped at 5000 clients: an import runs synchronously
 * inside one request, and an unbounded array would let a single spreadsheet
 * hold the event loop — and on the web, the single SQLite writer — for as long
 * as it liked.
 */
export const importClientDebtsSchema = z.object({
  clients: z.array(importedClientSchema).min(1).max(5000),
});

export type ImportedDebtEntryInput = z.infer<typeof importedDebtEntrySchema>;
export type ImportedClientInput = z.infer<typeof importedClientSchema>;
export type ImportClientDebtsInput = z.infer<typeof importClientDebtsSchema>;

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type GetClientInput = z.infer<typeof getClientSchema>;
export type SearchClientsInput = z.infer<typeof searchClientsSchema>;
