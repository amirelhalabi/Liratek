import { z } from "zod";
import { isCalendarDay } from "../utils/trialCalendar.js";

/**
 * LIRA-332 — the owner's trial actions (research R10). Both are separate
 * validated routes, never new keys on the unvalidated legacy
 * `PATCH /api/admin/subscriptions/:tenantId`.
 *
 * A day is `YYYY-MM-DD` in the shop's calendar (Asia/Beirut). Whether it is
 * already over is decided by the service against its clock, not here: a
 * schema has no clock.
 */
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-01")
  .refine(isCalendarDay, "Not a real date");

/** "Activate subscription": open-ended (`null`) or paid until a shop day. */
export const activateSubscriptionSchema = z.object({
  until: dateOnly.nullable(),
});

/** "Extend trial": the new last day of the trial. */
export const extendTrialSchema = z.object({
  lastDay: dateOnly,
});

export type ActivateSubscriptionInput = z.input<
  typeof activateSubscriptionSchema
>;
export type ExtendTrialInput = z.input<typeof extendTrialSchema>;
