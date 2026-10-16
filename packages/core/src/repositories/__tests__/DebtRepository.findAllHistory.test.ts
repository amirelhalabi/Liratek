/**
 * LIRA-330 — `findAllHistory()`: every client's debt history in ONE read, for
 * the Accounts Excel export (one request per client tripped the web API's
 * per-user rate limit on a real shop). It must return exactly what the
 * per-client read returns for each client — same rows, same hidden 0/0
 * 'Refund Reversal' marker, same username — and nothing from another shop.
 *
 * Not failing-first: a new read, written alongside it (rule 17 — said, not
 * proven). The export's request-count guard is
 * frontend debtExcelExport.loadAccounts.test.ts, which was seen failing.
 */

import Database from "better-sqlite3";
import { DebtRepository } from "../DebtRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id   INTEGER,
      username    TEXT NOT NULL
    );

    CREATE TABLE debt_ledger (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id         INTEGER,
      client_id         INTEGER NOT NULL,
      transaction_type  TEXT NOT NULL,
      amount_usd        DECIMAL(10, 2),
      amount_lbp        DECIMAL(15, 2),
      transaction_id    INTEGER,
      due_date          TEXT,
      note              TEXT,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by        INTEGER,
      edited_by         TEXT DEFAULT NULL,
      edited_at         TEXT DEFAULT NULL,
      is_refunded       INTEGER DEFAULT 0,
      refunded_at       TEXT DEFAULT NULL,
      session_id        INTEGER,
      covered_usd       REAL NOT NULL DEFAULT 0,
      covered_lbp       REAL NOT NULL DEFAULT 0
    );
  `);
  return db;
}

describe("DebtRepository.findAllHistory (LIRA-330)", () => {
  let db: Database.Database;
  let repo: DebtRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    repo = new DebtRepository();
    db.prepare(
      `INSERT INTO users (id, tenant_id, username) VALUES (7, 1, 'cashier')`,
    ).run();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTenantContext();
  });

  function row(
    tenant: number,
    client: number,
    type: string,
    usd: number,
    lbp: number,
    at: string,
  ): void {
    db.prepare(
      `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 7)`,
    ).run(tenant, client, type, usd, lbp, at);
  }

  beforeEach(() => {
    row(1, 10, "Manual Debt", 25, 0, "2026-09-02 09:00:00");
    row(1, 10, "Repayment", -10, 0, "2026-09-20 09:00:00");
    row(1, 20, "Recharge Debt", 0, 600000, "2026-10-01 09:00:00");
    row(1, 20, "Refund Reversal", 0, -600000, "2026-10-01 09:00:01");
    row(1, 20, "Refund Reversal", 0, 0, "2026-10-01 09:00:02"); // hidden
    row(2, 10, "Manual Debt", 999, 0, "2026-09-03 09:00:00"); // other shop
  });

  it("returns, per client, exactly the rows the per-client read returns", () => {
    const all = repo.findAllHistory();
    for (const client of [10, 20]) {
      expect(all.filter((r) => r.client_id === client)).toEqual(
        repo.findClientHistory(client),
      );
    }
    expect(all).toHaveLength(4);
  });

  it("hides the 0/0 refund marker and never reads another shop's rows", () => {
    const all = repo.findAllHistory();
    expect(all.some((r) => r.amount_usd === 999)).toBe(false);
    expect(
      all.some(
        (r) =>
          r.transaction_type === "Refund Reversal" &&
          r.amount_usd === 0 &&
          r.amount_lbp === 0,
      ),
    ).toBe(false);
    expect(all.every((r) => r.created_by_username === "cashier")).toBe(true);
  });
});
