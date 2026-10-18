/**
 * LIRA-335 T011 — ClosingService over checkpoint differences: the timeline
 * attaches `differences` and `open_count` and honours `open_only`
 * (FR-017/018/022); close / reopen return the IPC envelope with the
 * refreshed view (FR-011/012/014).
 *
 * Rule 17: NOT proven failing-first — written after `ClosingService`'s
 * LIRA-335 methods existed (the repository behaviour underneath was proven
 * failing-first in `CheckpointDifferenceRepository.test.ts`). Nothing was
 * re-broken to prove it.
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
import { resetClosingRepository } from "../../repositories/ClosingRepository";
import { resetTransactionRepository } from "../../repositories/TransactionRepository";
import { resetExpenseRepository } from "../../repositories/ExpenseRepository";
import { resetCheckpointDifferenceRepository } from "../../repositories/CheckpointDifferenceRepository";
import { getClosingService, resetClosingService } from "../ClosingService";
import {
  closeCheckpointDifferenceSchema,
  reopenCheckpointDifferenceSchema,
} from "../../validators/closing";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf-8",
);
const DAY = "2026-10-18";
let db: Database.Database;

function resetAll(): void {
  resetClosingRepository();
  resetTransactionRepository();
  resetExpenseRepository();
  resetCheckpointDifferenceRepository();
  resetClosingService();
}

beforeEach(() => {
  resetAll();
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
  resetAll();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

function checkpoint(physical: number): number {
  const res = getClosingService().createCheckpoint({
    user_id: 1,
    drawer_name: "General",
    closing_date: DAY,
    amounts: [
      {
        drawer_name: "General",
        currency_code: "USD",
        expected_amount: 0,
        physical_amount: physical,
      },
    ],
  });
  if (!res.success) throw new Error(res.error);
  return Number(res.id);
}

it("the timeline carries differences, counts the open ones and filters with open_only", async () => {
  const over = checkpoint(1050); // Over 50, open
  const matched = checkpoint(1050); // matched → no difference
  const short = checkpoint(1042); // Short 8, open

  const all = await getClosingService().getCheckpointTimeline({
    date_from: DAY,
    date_to: DAY,
  });
  expect(all.success).toBe(true);
  expect(all.open_count).toBe(2);
  const byId = new Map(all.checkpoints!.map((c) => [c.id, c]));
  expect(byId.get(matched)!.differences).toEqual([]);
  expect(byId.get(over)!.differences[0]).toMatchObject({ amount: 50, status: "OPEN" });
  expect(byId.get(short)!.differences[0]).toMatchObject({ amount: -8, status: "OPEN" });

  // Close the Short: it leaves the open list, the count follows.
  const diffId = byId.get(short)!.differences[0].id;
  const closed = getClosingService().closeCheckpointDifference({
    ...closeCheckpointDifferenceSchema.parse({ difference_id: diffId }),
    userId: 1,
  });
  expect(closed.success).toBe(true);
  expect(closed.data).toMatchObject({ id: diffId, status: "CLOSED", direction: "SHORT" });
  expect(closed.data!.shortage_expense_id).not.toBeNull();

  const openOnly = await getClosingService().getCheckpointTimeline({
    date_from: DAY,
    date_to: DAY,
    open_only: true,
  });
  expect(openOnly.open_count).toBe(1);
  expect(openOnly.checkpoints!.map((c) => c.id)).toEqual([over]);

  const reopened = getClosingService().reopenCheckpointDifference({
    ...reopenCheckpointDifferenceSchema.parse({ difference_id: diffId }),
    userId: 1,
  });
  expect(reopened).toMatchObject({ success: true, data: { status: "OPEN", shortage_expense_id: null } });
});

it("refusals come back as the envelope with an error, no data", () => {
  const id = checkpoint(1050);
  void id;
  const res = getClosingService().reopenCheckpointDifference({ difference_id: 999_999, userId: 1 });
  expect(res.success).toBe(false);
  expect(res.error).toMatch(/not found/i);
  expect(res.data).toBeUndefined();
});

it("open differences after a time: a checkpoint after it with something open is listed", () => {
  checkpoint(1050);
  const res = getClosingService().getOpenDifferencesAfter({ at: "2000-01-01 00:00:00" });
  expect(res.success).toBe(true);
  expect(res.data!.map((d) => [d.drawer_name, d.currency_code, d.open])).toEqual([
    ["General", "USD", 50],
  ]);
  const later = getClosingService().getOpenDifferencesAfter({ at: "2999-01-01 00:00:00" });
  expect(later).toEqual({ success: true, data: [] });
});
