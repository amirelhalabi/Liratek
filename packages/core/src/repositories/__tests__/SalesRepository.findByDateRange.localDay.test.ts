/**
 * LIRA-299 — `findByDateRange` returns sales by the SHOP's local day.
 *
 * A sale at 01:00 Beirut on Oct 10 is 22:00 UTC on Oct 9. `created_at` is
 * UTC, stored either as ISO `…T22:00:00.000Z` or SQLite's
 * `YYYY-MM-DD 22:00:00`. The old `WHERE DATE(s.created_at) BETWEEN ? AND ?`
 * read the UTC prefix, so on the web (server in UTC) both rows landed on
 * Oct 9 while the caller asked for Beirut days (rule 27).
 *
 * The web passes the browser's offset via `X-Client-Tz-Offset` →
 * `runWithTenant({ clientTzOffsetMinutes })`; desktop has none and uses
 * SQLite's `'localtime'` on the shop's own PC.
 *
 * Written FIRST and run against the old UTC-prefix query (rule 17).
 */
import type Database from "better-sqlite3";
import {
  installWarrantyTestDb,
  uninstallWarrantyTestDb,
} from "../testHelpers/warrantyDb";
import { resetTenantContext, runWithTenant } from "../../db/tenantContext";
import { SalesRepository } from "../SalesRepository";

let db: Database.Database;
const BEIRUT = 180; // minutes east of UTC (the browser sends -getTimezoneOffset())

function addSale(id: number, createdAt: string, status = "completed") {
  db.prepare(
    `INSERT INTO sales (id, tenant_id, total_amount_usd, final_amount_usd, status, created_at)
     VALUES (?, 1, 10, 10, ?, ?)`,
  ).run(id, status, createdAt);
}

beforeAll(() => {
  db = installWarrantyTestDb();
  // 01:00 Beirut on Oct 10 = 22:00 UTC on Oct 9, in both stored shapes.
  addSale(9101, "2026-10-09T22:00:00.000Z");
  addSale(9102, "2026-10-09 22:00:00");
  // Control: 20:00 UTC Oct 9 = 23:00 Beirut Oct 9 — stays on Oct 9.
  addSale(9103, "2026-10-09 20:00:00");
});

afterAll(() => {
  resetTenantContext();
  uninstallWarrantyTestDb(db);
});

const ids = (rows: { id: number }[]) => rows.map((r) => r.id).sort();
const inBeirut = (from: string, to: string) =>
  runWithTenant(1, () => new SalesRepository().findByDateRange(from, to), {
    clientTzOffsetMinutes: BEIRUT,
  });

describe("findByDateRange uses the shop's local day", () => {
  it("returns the 01:00-Beirut sale for the Beirut day (Oct 10)", () => {
    expect(ids(inBeirut("2026-10-10", "2026-10-10"))).toEqual([9101, 9102]);
  });

  it("does not return it for the previous day (Oct 9)", () => {
    expect(ids(inBeirut("2026-10-09", "2026-10-09"))).toEqual([9103]);
  });

  it("a range spanning both days returns all three", () => {
    expect(ids(inBeirut("2026-10-09", "2026-10-10"))).toEqual([
      9101, 9102, 9103,
    ]);
  });
});
