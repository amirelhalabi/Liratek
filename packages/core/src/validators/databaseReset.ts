import { z } from "zod";

/**
 * Database Reset (LIRA-165 — Settings › Reset Data) validation schema.
 *
 * The phrase itself is NOT hard-coded here: `DatabaseResetService.reset()`
 * owns the comparison against `DATABASE_RESET_CONFIRMATION_PHRASE`
 * (constants/resetTables.ts) so there is one place — the service, not the
 * schema — where "does this string authorize the wipe" is decided. This
 * schema only enforces the shape (a non-empty string was supplied at all).
 */
export const databaseResetSchema = z.object({
  confirmation: z.string().min(1, "Confirmation phrase is required"),
});

export type DatabaseResetInput = z.infer<typeof databaseResetSchema>;
