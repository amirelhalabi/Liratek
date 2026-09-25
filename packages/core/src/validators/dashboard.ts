import { z } from "zod";
import { clientDayInputSchema } from "./common.js";

/**
 * DC-10/DC-11 (OWNER_NOTES_2026-09-21.md §7.2) — the dashboard chart and the
 * "Net Profit — last 30 days" tile both read a rolling 30-day window ending
 * on "today", and "today" is a rule-27 dual-transport hazard: on web the
 * server has no idea which timezone the tenant is in. Both query shapes
 * below accept the CLIENT's own calendar day and validate it with the ONE
 * shared `clientDayInputSchema` (rule 14) rather than a third hand-rolled
 * regex. Pure zod — no Node.js deps — so this file is safe to re-export from
 * `browser.ts` (rule 29).
 */

export const dashboardChartQuerySchema = z.object({
  type: z.enum(["Sales", "Profit"]).optional().default("Sales"),
  client_day: clientDayInputSchema,
});
export type DashboardChartQueryInput = z.infer<typeof dashboardChartQuerySchema>;

export const netProfitWindowQuerySchema = z.object({
  client_day: clientDayInputSchema,
});
export type NetProfitWindowQueryInput = z.infer<
  typeof netProfitWindowQuerySchema
>;
