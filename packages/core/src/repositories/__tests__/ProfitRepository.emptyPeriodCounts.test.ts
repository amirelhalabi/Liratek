/**
 * Profits page display fixes (production report 2026-10-07, issue 5) — the
 * Overview's Custom Services badge read "jobs" with no number on a period
 * with no custom services. Cause: the scalar totals queries counted with a
 * bare `SUM(CASE … THEN 1 ELSE 0 END)`, which SQLite returns as NULL (not 0)
 * when no row matches — every money column beside it was already
 * `COALESCE(…, 0)`. Same shape in the loto, exchange and top-up/buyback
 * totals, so all four are guarded here against the real schema.
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";

const CREATE_DB_SQL_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "electron-app",
  "create_db.sql",
);

const FROM = "2026-09-01 00:00:00";
const TO = "2026-09-30 23:59:59";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf8"));
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("ProfitRepository — scalar totals report count 0 (never null) for an empty period", () => {
  it("getCustomServicesTotals", () => {
    const row = runWithTenant(1, () =>
      new ProfitRepository().getCustomServicesTotals(FROM, TO),
    );
    expect(row.count).toBe(0);
  });

  it("getLotoTotals", () => {
    const row = runWithTenant(1, () =>
      new ProfitRepository().getLotoTotals(FROM, TO),
    );
    expect(row.count).toBe(0);
  });

  it("getExchangeTotals", () => {
    const row = runWithTenant(1, () =>
      new ProfitRepository().getExchangeTotals(FROM, TO),
    );
    expect(row.count).toBe(0);
  });

  it("getTopupBuybackProfit", () => {
    const row = runWithTenant(1, () =>
      new ProfitRepository().getTopupBuybackProfit(FROM, TO),
    );
    expect(row.count).toBe(0);
  });
});
