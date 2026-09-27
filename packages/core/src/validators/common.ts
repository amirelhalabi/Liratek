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

/**
 * A `YYYY-MM-DD` CLIENT local calendar day — REQUIRED shape. This is the one
 * definition of the regex (rule 14); every other client-day schema in the
 * codebase (this file's own `clientDayInputSchema` below, and
 * `validators/closing.ts`'s `localDaySchema`, which LIRA-219 extracted
 * separately before this dedup) derives from it rather than repeating the
 * pattern. Not itself optional — wrap with `.optional()` at the point of use
 * (as `clientDayInputSchema` does immediately below) when a caller may omit
 * the day and fall back to `clientDay()`/`localDay()` server-side.
 */
export const localDayFormatSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

/**
 * The CLIENT's own local calendar day (`YYYY-MM-DD`) for ANY request-path
 * query whose answer depends on "what day is it for the shop" (CLAUDE.md
 * rule 27) — e.g. a rolling-window report's end day. Same shape as the
 * per-module `client_day` fields already hand-written in
 * `validators/recharge.ts`/`validators/financial.ts` (not centralized
 * retroactively here — out of scope for this change), but a NEW caller
 * should reuse this one instead of pasting a third copy of the regex (rule
 * 14). Optional; the caller falls back to `clientDay()`/`localDay()`
 * (`utils/requestDay.ts`) when omitted.
 */
export const clientDayInputSchema = localDayFormatSchema.optional();

/**
 * LIRA-236 (REFUND_EXCHANGE_RATE_PLAN.md §3) — the cashier-typed exchange
 * rate (LBP per 1 USD) a refund popup may send, shared (rule 14) by every
 * refund payload schema: `saleRefundSchema`/`saleRefundItemSchema`
 * (validators/sale.ts), `sessionItemRefundSchema`/
 * `sessionItemRefundPreviewSchema` (validators/transaction.ts), and the
 * Transactions-page generic refund (validated standalone the same way
 * `refundLegsSchema` already is, since that channel has no combined payload
 * schema). Optional everywhere — omitting it keeps today's per-currency
 * exact-match / day's-rate-fallback behavior unchanged
 * (`TransactionRepository.validateRefundLegOverrideAmounts`).
 *
 * F13 (round-3 review) — `.nullish()` + a transform, not just `.optional()`:
 * `undefined` (key omitted) is not the only way a caller signals "no typed
 * rate" — a React input cleared back to empty, or a JSON body built with
 * `exchangeRate: state.rate ?? null`, sends a literal `null`. `.optional()`
 * alone only accepts `undefined`; a `null` failed this schema with a type
 * error ("expected number, received null") on every route that embeds this
 * field directly (`saleRefundSchema`, `saleRefundItemSchema`,
 * `sessionItemRefundSchema`) even though the intent was identical to
 * omitting the key. `null` and `undefined` now both collapse to `undefined`
 * — the exact "not given" value every consumer already branches on.
 *
 * Trailing `.optional()` (post-transform) — a `.transform()` fixes the
 * schema's inferred OUTPUT type to exactly its return type (`number |
 * undefined` here), but zod's object-key optionality check does not treat
 * that as "may be absent": every schema that embeds this field directly
 * (`saleRefundSchema`, `saleRefundItemSchema`, `sessionItemRefundSchema`)
 * came out with `exchangeRate` as a REQUIRED key typed `number | undefined`
 * — so every caller that legitimately omits it (nearly all of them; this is
 * the rare optional field) failed `tsc` with "Property 'exchangeRate' is
 * missing". Wrapping the whole chain in `.optional()` makes zod treat the KEY
 * itself as optional in both the input and output types, while changing
 * nothing at runtime: an omitted key or an explicit `undefined` short-circuits
 * at this outer layer to the same `undefined` the inner transform already
 * produced for `null`; `null` and every numeric value still flow into the
 * inner `nullish()`+`transform` chain untouched. Confirmed with an isolated
 * `tsc` repro before landing (CLAUDE.md rule 17/28 — measured, not assumed).
 *
 * Coordinator follow-up (2026-09-28, rule 14 dedup) — `_buildRefundExchangeRateSchema`
 * below is the ONE definition of the positive/finite/nullish/transform/
 * optional chain; `refundExchangeRateSchema` (a real JSON body number, e.g.
 * `saleRefundSchema`/`sessionItemRefundSchema`) and
 * `refundExchangeRateQuerySchema` (a query-string value, e.g.
 * `sessionItemRefundPreviewSchema` — arrives as a string, so it needs
 * `z.coerce.number()` instead of `z.number()`) apply the SAME rules to two
 * different starting number schemas rather than each hand-writing its own
 * copy of `.positive().finite().nullish().transform(...).optional()`, which
 * is exactly how `sessionItemRefundPreviewSchema` used to drift from this
 * one (a bare `z.coerce.number().positive().finite().optional()` with no
 * `.nullish()`/transform at all).
 */
function _buildRefundExchangeRateSchema<T extends z.ZodNumber>(numberSchema: T) {
  return numberSchema
    .positive()
    .finite()
    .nullish()
    .transform((v) => v ?? undefined)
    .optional();
}

export const refundExchangeRateSchema = _buildRefundExchangeRateSchema(z.number());

/**
 * The SAME rate, for a caller that reads it off a query string
 * (`sessionItemRefundPreviewSchema` — a GET preview, every field arrives as
 * text) instead of a JSON body. `z.coerce.number()` turns `"89000"` into
 * `89000` before the shared positive/finite/nullish/transform/optional
 * chain above runs; a literal `null`/`undefined` still short-circuits the
 * wrapper BEFORE coercion (same as `refundExchangeRateSchema`), so it is
 * never coerced to `0` and wrongly rejected by `.positive()`.
 */
export const refundExchangeRateQuerySchema = _buildRefundExchangeRateSchema(
  // zod v4 types `z.coerce.number()` as `ZodCoercedNumber<unknown>`, a
  // distinct (and, per its `_input: unknown` generic, non-assignable) type
  // from plain `ZodNumber` even though both are `ZodNumber` instances at
  // runtime (verified: `z.coerce.number().constructor.name === "ZodNumber"`)
  // and support the exact same `.positive()/.finite()/.nullish()/
  // .transform()/.optional()` chain. Same category of zod-major type cast
  // CLAUDE.md documents for `electron-app/schemas/index.ts`
  // (`as unknown as z.ZodSchema<T>`) — a version-typing quirk, not an
  // unsafe runtime assumption.
  z.coerce.number() as unknown as z.ZodNumber,
);
