/**
 * Round-4 review finding L3 — `TransactionRepository._allocateExact` (the
 * ONE proportional-split allocator every money-producing site in this class
 * uses: `_reverseSessionPooledPayments`, `_defaultSessionRefundLegs`) can
 * return a NEGATIVE share once the earlier legs' independent rounding
 * overshoots the total, because the pre-fix algorithm rounds every share
 * EXCEPT the last independently, then forces the last share to absorb
 * whatever is left — which can be negative.
 *
 * Rule 17: written first, run against the pre-fix "last share absorbs the
 * remainder" implementation and observed red (both cases below return a
 * negative last share), then the fix (largest-remainder / Hamilton
 * apportionment) makes them green.
 */

import Database from "better-sqlite3";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE transactions (id INTEGER PRIMARY KEY);`);
  return db;
}

describe("TransactionRepository._allocateExact (round-4 finding L3)", () => {
  let db: Database.Database;
  let txnRepo: {
    _allocateExact(total: number, weights: number[], unit: number): number[];
  };

  beforeEach(() => {
    db = createTestDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    txnRepo = new TransactionRepository() as unknown as typeof txnRepo;
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    resetTransactionRepository();
  });

  it("never returns a negative share (USD case: 0.02 across [25,25,25,2.5])", () => {
    const shares = txnRepo._allocateExact(0.02, [25, 25, 25, 2.5], 0.01);
    for (const s of shares) {
      expect(s).toBeGreaterThanOrEqual(0);
    }
    const sum = shares.reduce((a: number, b: number) => a + b, 0);
    expect(Math.round(sum * 100) / 100).toBe(0.02);
  });

  it("never returns a negative share (LBP case: 2 across [1,1,1,0.1])", () => {
    const shares = txnRepo._allocateExact(2, [1, 1, 1, 0.1], 1);
    for (const s of shares) {
      expect(s).toBeGreaterThanOrEqual(0);
    }
    const sum = shares.reduce((a: number, b: number) => a + b, 0);
    expect(sum).toBe(2);
  });

  it("still sums exactly for the existing 3-equal-LBP-legs case (890,000 / 3)", () => {
    const shares = txnRepo._allocateExact(890000, [1, 1, 1], 1);
    const sum = shares.reduce((a: number, b: number) => a + b, 0);
    expect(sum).toBe(890000);
    for (const s of shares) expect(s).toBeGreaterThanOrEqual(0);
  });

  it("returns all zeros for a non-positive total", () => {
    expect(txnRepo._allocateExact(0, [1, 2, 3], 0.01)).toEqual([0, 0, 0]);
  });
});
