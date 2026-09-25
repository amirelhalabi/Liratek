import { z } from "zod";
import {
  positiveDecimalSchema,
  positiveIntegerSchema,
  currencyCodeSchema,
  localDayFormatSchema,
} from "./common.js";

/**
 * Daily closing validation schemas
 */

/**
 * A `YYYY-MM-DD` CLIENT local calendar day (rule 14 — this file repeated the
 * same regex 5 times before LIRA-219 extracted it once here; every schema
 * below that accepts a client-supplied day reuses this, so the format can
 * never drift between them). Not itself optional — callers that want an
 * optional day wrap this with `.optional()` at the point of use, same as
 * before.
 *
 * Re-exported alias of `common.ts`'s `localDayFormatSchema` (rule 14 dedup):
 * `common.ts` already carries the same YYYY-MM-DD regex as
 * `clientDayInputSchema`'s base, so this file reuses that one definition
 * instead of keeping a second copy of the pattern. `common.ts` is the more
 * neutral home (no closing-specific semantics), and this name stays so every
 * existing caller in this file is unchanged.
 */
export const localDaySchema = localDayFormatSchema;

const drawerAmountSchema = z.object({
  currency: currencyCodeSchema,
  amount: positiveDecimalSchema,
});

export const setOpeningBalancesSchema = z.object({
  closingDate: localDaySchema,
  amounts: z
    .array(drawerAmountSchema)
    .min(1, "At least one drawer amount is required"),
  userId: positiveIntegerSchema,
});

export const createDailyClosingSchema = z.object({
  closingDate: localDaySchema,
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

// One shop-owned SIM line counted during a checkpoint (D2, carrier-lines
// plan Phase 3). ONLY the counted values cross the wire: expected_credits /
// expected_expires_at are read off carrier_lines server-side at count time,
// so the audit snapshot cannot be spoofed and the delta is always measured
// against the value the server actually holds.
//
// `counted_expires_at` absent (or null) means validity was not counted for
// this line and the stored expiry is left alone — a checkpoint never clears
// a date. Note that `validateRequest` REPLACES req.body with the parsed
// object, so anything missing from this schema is silently stripped on REST:
// every field the frontend sends must be declared here.
const checkpointCarrierLineSchema = z.object({
  carrier_line_id: positiveIntegerSchema,
  counted_credits: z.number().nonnegative(),
  counted_expires_at: localDaySchema.nullable().optional(),
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
  /** Optional — present only for the MTC/Alfa cards. */
  carrier_lines: z.array(checkpointCarrierLineSchema).optional(),
  /**
   * The CLIENT's own local calendar day (`YYYY-MM-DD`), e.g. the browser's
   * `localDay()`. The server cannot infer this: on web the process runs in
   * whatever timezone the Fly machine boots in (UTC), not the shop's, so a
   * checkpoint taken between 00:00-03:00 Beirut would otherwise be filed
   * under the wrong (previous) UTC day. Optional so any existing caller that
   * omits it keeps falling back to the server's own `localDay()`
   * (`ClosingRepository.createCheckpoint`) — unchanged behaviour for
   * desktop, where server-local IS shop-local.
   */
  closing_date: localDaySchema.optional(),
});

/**
 * GET /api/closing/has-opening-balance-today query contract. The CLIENT's own
 * local calendar day (`YYYY-MM-DD`, e.g. the browser's `localDay()`) — the
 * server cannot infer this on web, which runs on whatever timezone the Fly
 * machine boots in (UTC), not the shop's (Beirut, UTC+3). Optional so an
 * omitted value falls back to the server's own `localDay()`
 * (`ClosingRepository.hasOpeningBalanceToday`) — unchanged behaviour for
 * desktop and any caller that doesn't send it. Mirrors `closing_date` on
 * `createCheckpointSchema` above.
 */
export const hasOpeningBalanceTodayQuerySchema = z.object({
  day: localDaySchema.optional(),
});

/**
 * GET .../daily-stats-snapshot query contract (LIRA-219). Same CLIENT-day
 * contract as `hasOpeningBalanceTodayQuerySchema` immediately above — the
 * server falls back to `clientDay()` (the request's own `X-Client-Day`
 * context value, else `localDay()`) when `day` is omitted, never trusting
 * its own bare calendar day as primary (rule 27). `z.input<>`, not `z.infer<>`
 * (rule 21): the schema has no `.default()` or transform on this field today,
 * so the two are identical, but `z.input` is the contract every adapter
 * payload type in this codebase derives from, and staying consistent means a
 * future `.default()` here doesn't silently change what callers must supply.
 */
export const dailyStatsSnapshotQuerySchema = z.object({
  day: localDaySchema.optional(),
});

export type DrawerAmountInput = z.infer<typeof drawerAmountSchema>;
export type SetOpeningBalancesInput = z.infer<typeof setOpeningBalancesSchema>;
export type CreateDailyClosingInput = z.infer<typeof createDailyClosingSchema>;
export type CheckpointAmountInput = z.infer<typeof checkpointAmountSchema>;
export type CheckpointCarrierLineInput = z.infer<
  typeof checkpointCarrierLineSchema
>;
export type CreateCheckpointInput = z.infer<typeof createCheckpointSchema>;
export type HasOpeningBalanceTodayQueryInput = z.infer<
  typeof hasOpeningBalanceTodayQuerySchema
>;
export type DailyStatsSnapshotQuery = z.input<
  typeof dailyStatsSnapshotQuerySchema
>;
