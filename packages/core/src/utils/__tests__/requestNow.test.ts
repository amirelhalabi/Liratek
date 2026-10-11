/**
 * LIRA-306 T015 — `requestNow()`: the ONE "now" business timestamps are
 * written with. Inside a replay it is the event's (corrected) instant;
 * otherwise the real time. Always the `YYYY-MM-DD HH:MM:SS` UTC text SQLite's
 * CURRENT_TIMESTAMP produces, so existing string date-range filters keep
 * matching (R11).
 */
import Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { requestNow, toSqliteUtc } from "../requestNow";

describe("requestNow", () => {
  it("returns the context's effectiveNow in SQLite UTC text", () => {
    runWithTenant(1, () => expect(requestNow()).toBe("2026-10-10 20:50:00"), {
      effectiveNow: "2026-10-10T20:50:00.000Z",
    });
    runWithTenant(1, () => expect(requestNow()).toBe("2026-10-10 20:50:00"), {
      effectiveNow: "2026-10-10T23:50:00.000+03:00",
    });
  });

  it("falls back to the real time in the same format as CURRENT_TIMESTAMP", () => {
    const db = new Database(":memory:");
    const sql = (db.prepare("SELECT CURRENT_TIMESTAMP AS t").get() as { t: string }).t;
    db.close();
    const ours = requestNow();
    expect(ours).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(Math.abs(Date.parse(ours + "Z") - Date.parse(sql + "Z"))).toBeLessThan(5000);
  });

  it("toSqliteUtc converts an ISO instant", () => {
    expect(toSqliteUtc("2026-01-02T03:04:05.678Z")).toBe("2026-01-02 03:04:05");
  });
});
