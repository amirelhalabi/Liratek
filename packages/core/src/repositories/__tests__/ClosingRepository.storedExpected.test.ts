/**
 * LIRA-335 T007(c) / FR-023 — the expected figure stored with a checkpoint
 * (`daily_closing_amounts.opening_amount`) is the server balance the
 * correction was calculated from, not whatever the window showed when it
 * opened. Otherwise the timeline's "Over $X" and the posted correction can
 * disagree (finding 4 of the review).
 *
 * Rule 17: written before the fix; the first run failed on the stored
 * figure (expected 1000, received 900 — the client's stale value).
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  getClosingRepository,
  resetClosingRepository,
} from "../ClosingRepository";
import { resetTransactionRepository } from "../TransactionRepository";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf-8",
);

let db: Database.Database;

beforeEach(() => {
  resetClosingRepository();
  resetTransactionRepository();
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  initDatabase(db);
  runMigrations(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'USD', 1000)`,
  ).run();
});

afterEach(() => {
  resetTenantContext();
  resetClosingRepository();
  resetTransactionRepository();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

it("stores the server balance the delta was computed from, not the client's stale expected", () => {
  const res = getClosingRepository().createCheckpoint({
    user_id: 1,
    drawer_name: "General",
    closing_date: "2026-10-18",
    amounts: [
      {
        drawer_name: "General",
        currency_code: "USD",
        expected_amount: 900, // stale: the window opened before a $100 sale
        physical_amount: 1050,
      },
    ],
  });
  expect(res.success).toBe(true);

  const row = db
    .prepare(
      `SELECT opening_amount, physical_amount FROM daily_closing_amounts WHERE closing_id = ?`,
    )
    .get(Number(res.id)) as { opening_amount: number; physical_amount: number };
  expect(row.opening_amount).toBe(1000);
  expect(row.physical_amount).toBe(1050);

  // The posted correction agrees with the stored figures.
  const leg = db
    .prepare(
      `SELECT SUM(amount) AS amount FROM payments WHERE method = 'CHECKPOINT_ADJUSTMENT'`,
    )
    .get() as { amount: number };
  expect(leg.amount).toBe(row.physical_amount - row.opening_amount);

  // The CHECKPOINT transaction's own snapshot carries the same figure.
  // Added after the fix: NOT proven failing-first (rule 17).
  const meta = db
    .prepare(
      `SELECT metadata_json FROM transactions WHERE type = 'CHECKPOINT' AND source_id = ?`,
    )
    .get(Number(res.id)) as { metadata_json: string };
  expect(JSON.parse(meta.metadata_json).amounts).toEqual([
    {
      drawer_name: "General",
      currency_code: "USD",
      expected_amount: 1000,
      physical_amount: 1050,
    },
  ]);
});
