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

/**
 * One `from`/`to` date field: `YYYY-MM-DD`, or an EMPTY string treated
 * exactly like an omitted key (transformed to `undefined` before the
 * route's own `|| todayISO()` fallback runs). Round-2 review, LC-2:
 * `.regex(...).optional()` alone only skips a genuinely ABSENT query key —
 * `?from=` sends the key with an empty VALUE, which the regex rejects like
 * any other malformed string, unlike every other Profits data route (no
 * schema), whose bare `(req.query.from as string) || todayISO()` treats an
 * empty string the same as absent. Without this, a client-side quirk that
 * sends `from=''` gets a 200-envelope `{success:false}` instead of today's
 * default, and (LC-2's other half, `backendApi.ts`) now correctly SURFACES
 * that as a visible error instead of silently returning `undefined` — so
 * this half closes the trap at the source instead of only reporting it.
 */
const optionalIsoDateOrEmpty = (fieldName: "from" | "to") =>
  z
    .union([
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${fieldName} must be in YYYY-MM-DD format`),
      z.literal(""),
    ])
    .optional()
    .transform((v) => (v === "" ? undefined : v));

/**
 * GET /api/profits/commissions query contract (OWNER_NOTES_2026-09-21.md §6,
 * lane LC, PA-4.17). Both optional — an omitted (or empty, LC-2) from/to
 * falls back to the SAME today() default every other Profits data route
 * uses (`backend/src/api/profits.ts`'s `todayISO()`), unchanged behaviour
 * for a caller that sends neither. Consumed directly by
 * `backend/src/api/profits.ts` (rule 19 — backend imports core schemas
 * straight, no electron-app re-export needed for a route the desktop IPC
 * channel doesn't itself validate against — see profitHandlers.ts's
 * `profits:commissions`, which mirrors the other 6 profits channels' own
 * unvalidated `(from, to)` positional-args convention).
 */
export const commissionsReportQuerySchema = z.object({
  from: optionalIsoDateOrEmpty("from"),
  to: optionalIsoDateOrEmpty("to"),
});

export type CommissionsReportQueryInput = z.input<
  typeof commissionsReportQuerySchema
>;

/**
 * GET /api/profits/module-detail query contract (2026-09-24,
 * OWNER_NOTES_REMAINING_BUILD.md #14 slice 2 — Profits page "Show
 * transactions" drill-down). `module` is a By Module row's own `module` key
 * (e.g. "SALE", "RECHARGE_MTC") — the service validates it against the
 * modules it actually supports (SALE / RECHARGE_<carrier> in slice 2) and
 * throws a clear error for any other key; this schema only enforces shape,
 * matching every other Profits data route's `from`/`to` convention
 * ({@link commissionsReportQuerySchema}). Shared by both transports (rule
 * 19b) — IPC's `profits:module-detail` channel follows the other 7 data
 * channels' own unvalidated `(from, to)` positional-args convention and
 * does not itself call this schema, but a caller is welcome to; REST's
 * route validates against it directly (rule 19).
 */
export const moduleDetailQuerySchema = z.object({
  module: z.string().min(1, "module is required"),
  from: optionalIsoDateOrEmpty("from"),
  to: optionalIsoDateOrEmpty("to"),
});

export type ModuleDetailQueryInput = z.input<typeof moduleDetailQuerySchema>;
