/**
 * SessionPaymentService — a basket's store-credit leg must not be droppable
 * (LIRA-258, POSTING_MAP.md §7 gap G13 follow-up).
 *
 * A session basket paid $25 cash for $20 of goods, with the $5 change kept on
 * the customer's account (a CUSTOMER_ACCOUNT OUT leg), posts +$25 to a drawer
 * and a $5 CREDIT_DEPOSIT on the customer's account. Before the fix the
 * credit went through `DebtService.addCredit`, which CATCHES any error and
 * returns `{ success: false }` — and recordBasketPayment ignored the result.
 * So when the credit write failed, the checkout (and the $25 drawer posting)
 * still committed and the customer silently lost their $5.
 *
 * The failure is forced at the database level (a BEFORE INSERT trigger on
 * CREDIT_DEPOSIT rows); the real DebtService/DebtRepository run, nothing in
 * the money path is mocked. Real production schema (create_db.sql +
 * migrations).
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
  SessionPaymentService,
  resetSessionPaymentService,
} from "../SessionPaymentService";
import { resetDebtService } from "../DebtService";
import { resetDebtRepository } from "../../repositories/DebtRepository";
import { resetCustomerSessionRepository } from "../../repositories/CustomerSessionRepository";
import { resetSessionPaymentRepository } from "../../repositories/SessionPaymentRepository";
import { resetClientRepository } from "../../repositories/ClientRepository";
import { resetTransactionRepository } from "../../repositories/TransactionRepository";
import {
  expectPostings,
  snapshotLedgers,
} from "../../repositories/testHelpers/postingAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");

function buildDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  return db;
}

function resetAll(): void {
  resetSessionPaymentService();
  resetDebtService();
  resetDebtRepository();
  resetCustomerSessionRepository();
  resetSessionPaymentRepository();
  resetClientRepository();
  resetTransactionRepository();
}

describe("LIRA-258 G13 — session basket store credit cannot be silently dropped", () => {
  let db: Database.Database;
  let sessionId: number;
  let clientId: number;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    initFixedTenantContext(1);
    clientId = Number(
      db
        .prepare(
          `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Basket Client', '03111222')`,
        )
        .run().lastInsertRowid,
    );
    sessionId = Number(
      db
        .prepare(
          `INSERT INTO customer_sessions (tenant_id, customer_name, customer_phone, started_by) VALUES (1, 'Basket Client', '03111222', 'admin')`,
        )
        .run().lastInsertRowid,
    );
  });

  afterEach(() => {
    resetTenantContext();
    resetAll();
    db.close();
  });

  const legs = [
    { method: "CASH", currencyCode: "USD", amount: 25, direction: "IN" as const },
    {
      method: "CUSTOMER_ACCOUNT",
      currencyCode: "USD",
      amount: 5,
      direction: "OUT" as const,
    },
  ];

  it("control: the change kept on account books a $5 credit", () => {
    const before = snapshotLedgers(db);
    db.transaction(() =>
      new SessionPaymentService().recordBasketPayment(sessionId, {
        legs,
        exchangeRate: 89500,
        userId: 1,
        clientId,
      }),
    )();
    const after = snapshotLedgers(db);
    expect(after.debt[`${clientId}|USD`]).toBe(-5);
    expect(
      Object.values(after.drawers).reduce((a, b) => a + b, 0) -
        Object.values(before.drawers).reduce((a, b) => a + b, 0),
    ).toBe(25);
  });

  it("a failed credit write aborts the whole basket payment — nothing commits", () => {
    db.exec(`
      CREATE TRIGGER block_credit BEFORE INSERT ON debt_ledger
      WHEN NEW.transaction_type = 'CREDIT_DEPOSIT'
      BEGIN SELECT RAISE(ABORT, 'forced credit failure'); END;
    `);
    const before = snapshotLedgers(db);

    expect(() =>
      db.transaction(() =>
        new SessionPaymentService().recordBasketPayment(sessionId, {
          legs,
          exchangeRate: 89500,
          userId: 1,
          clientId,
        }),
      )(),
    ).toThrow(/forced credit failure/);

    expectPostings(before, snapshotLedgers(db), {});
    const sessionLegs = db
      .prepare(`SELECT COUNT(*) AS c FROM payments WHERE session_id = ?`)
      .get(sessionId) as { c: number };
    expect(sessionLegs.c).toBe(0);
  });
});
