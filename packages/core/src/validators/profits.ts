import { z } from "zod";
import { PROFITS_PASSWORD_MIN_LENGTH } from "../constants/profitsAccess.js";

/**
 * Profits password gate — shared schemas (frozen contract, agent A).
 * Consumed by electron-app/schemas/index.ts (re-export + zod-major cast) and
 * directly by backend/src/api/profits.ts (validateRequest), per rule 19.
 */

// Setting a NEW password (admin, from Settings) — enforces the minimum.
export const SetProfitsPasswordSchema = z.object({
  password: z.string().min(PROFITS_PASSWORD_MIN_LENGTH),
});

// Unlocking with an EXISTING password — only non-empty is required here;
// ProfitsAccessService.verify() is the source of truth for correctness.
export const UnlockProfitsSchema = z.object({ password: z.string().min(1) });

export type SetProfitsPasswordInput = z.infer<typeof SetProfitsPasswordSchema>;
export type UnlockProfitsInput = z.infer<typeof UnlockProfitsSchema>;
