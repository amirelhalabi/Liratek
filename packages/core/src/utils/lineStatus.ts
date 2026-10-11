/**
 * LIRA-309 — the status a phone line shows on the Phone Lines page and in the
 * Dashboard / bell alerts, for BOTH kinds of line: shop lines
 * (`carrier_lines`) and lines held for sale (`resale_lines`).
 *
 * Owner rule (2026-10-11): a for-sale line warns 3 days before its expiry; a
 * shop line keeps the 7-day warning it already had. Both turn red inside the
 * revival grace and are lost after it.
 *
 * A thin layer over {@link classifyLineValidity}: the grace boundary is
 * compared there and only there (rule 14) — this module only splits VALID
 * into OK / EXPIRING by the caller's warning window.
 *
 * Browser-safe leaf (rule 29): reachable from `browser.ts`, imports nothing
 * but `carrierLineValidity.js`.
 */
import {
  classifyLineValidity,
  LINE_REVIVAL_GRACE_DAYS,
} from "./carrierLineValidity.js";

/** Warning window for a line the shop holds for sale. */
export const RESALE_LINE_EXPIRY_WARNING_DAYS = 3;

/** Warning window for a shop line (unchanged from before LIRA-309). */
export const SHOP_LINE_EXPIRY_WARNING_DAYS = 7;

export type LineStatus =
  | "OK"
  | "EXPIRING"
  | "IN_GRACE"
  | "LOST"
  | "NO_EXPIRY";

export interface LineStatusResult {
  status: LineStatus;
  /** Whole days of validity left (0 when lapsed or no expiry). */
  daysLeft: number;
  /** IN_GRACE only: days left in which a charge still revives the line. */
  daysToSave: number;
}

/**
 * @param expiry `YYYY-MM-DD`, or empty when none was recorded.
 * @param today the shop's own calendar day (rule 27) — the browser's
 *   `localDay()` on the client.
 * @param warningDays {@link RESALE_LINE_EXPIRY_WARNING_DAYS} or
 *   {@link SHOP_LINE_EXPIRY_WARNING_DAYS}.
 */
export function classifyLineStatus(
  expiry: string | null | undefined,
  today: string,
  warningDays: number,
): LineStatusResult {
  const v = classifyLineValidity(expiry, today);
  switch (v.state) {
    case "NO_EXPIRY":
      return { status: "NO_EXPIRY", daysLeft: 0, daysToSave: 0 };
    case "VALID":
      return {
        status: v.daysRemaining <= warningDays ? "EXPIRING" : "OK",
        daysLeft: v.daysRemaining,
        daysToSave: 0,
      };
    case "GRACE":
      return {
        status: "IN_GRACE",
        daysLeft: 0,
        daysToSave: LINE_REVIVAL_GRACE_DAYS - v.lapseDays,
      };
    case "BURNED":
      return { status: "LOST", daysLeft: 0, daysToSave: 0 };
  }
}
