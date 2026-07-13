/**
 * Local (machine-timezone) calendar-day helpers.
 *
 * SQLite `CURRENT_TIMESTAMP` stores UTC. When we need the *business day* — the
 * day as the operator sees it on the shop's clock — we must NOT use
 * `new Date().toISOString().split("T")[0]`, which yields the UTC calendar day
 * (rolls over at 03:00 in Beirut, UTC+3). These helpers use the local getters
 * so the day matches the machine's timezone, consistent with the SQL
 * `DATE(col, 'localtime') = DATE('now', 'localtime')` convention used across the
 * reporting repositories (SalesRepository, FinancialServiceRepository, …).
 *
 * On the desktop app the machine is the shop's PC (Beirut). On the web backend
 * the machine is the server — pin `TZ=Asia/Beirut` there (see
 * docs/plans/done_plans/LOCAL_BUSINESS_DAY_PLAN.md).
 */

const pad = (n: number): string => n.toString().padStart(2, "0");

/** Local calendar day as `YYYY-MM-DD`. */
export function localDay(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local calendar month as `YYYY-MM`. */
export function localMonth(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** Local calendar day `n` days before today, as `YYYY-MM-DD`. */
export function localDaysAgo(n: number, date: Date = new Date()): string {
  const d = new Date(date);
  d.setDate(d.getDate() - n);
  return localDay(d);
}
