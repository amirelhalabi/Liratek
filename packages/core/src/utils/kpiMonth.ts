/**
 * LIRA-364 — the monthly KPI snapshot's months are Beirut calendar months.
 * The capture runs on a timer with no client to ask (rule 27's exception), so
 * the zone is the explicit `SHOP_TIME_ZONE`, never the host's own clock or
 * `process.env.TZ`.
 */
import {
  shopDayOf,
  startOfShopDay,
  toUtcSqlTimestamp,
} from "./trialCalendar.js";

/** The Beirut month (`YYYY-MM`) an instant falls in. */
export function beirutMonth(instant: Date): string {
  return shopDayOf(instant).slice(0, 7);
}

/** The month before `month` (`YYYY-MM`). */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** The instant a Beirut month starts, as a UTC SQL timestamp. */
export function beirutMonthStartUtc(month: string): string {
  return toUtcSqlTimestamp(startOfShopDay(`${month}-01`));
}
