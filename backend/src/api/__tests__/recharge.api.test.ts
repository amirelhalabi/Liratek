/**
 * Recharge REST route tests — CARRIER_LINES_VALIDITY_PLAN.md Phase 6a
 * (schema consolidation).
 *
 * THE BUG THIS FILE GUARDS (a live money bug on web, independent of the
 * carrier-lines feature):
 *
 *   `backend/src/middleware/validation.ts:69` does `req.body = schema.parse(...)`
 *   and Zod strips unknown keys. Before Phase 6a the core
 *   `createRechargeSchema` had NO `payments` field (its own comment admitted
 *   the gap), so EVERY REST recharge silently lost its split payment legs and
 *   fell into `RechargeRepository`'s legacy single-method fallback — which
 *   routes the FULL price to ONE drawer picked from `paid_by_method` alone.
 *   A $3 CASH-USD + 270,000 LBP split posted $6 to General/USD and nothing to
 *   General/LBP.
 *
 * Unlike the other *.api.test.ts files in this folder (which stub the service
 * with jest.spyOn), this suite runs the REAL core RechargeRepository against a
 * REAL in-memory SQLite DB, because the assertion that matters is the DRAWER
 * DELTA — a spy on the service would only prove the payload shape, not that
 * the money landed in two drawers.
 *
 * Getting a real DB inside backend jest takes two deliberate hacks:
 *  1. `backend/jest.config.cjs` maps `^better-sqlite3$` to a hand-written mock,
 *     so the real driver is required through a path the mapper cannot match
 *     (`better-sqlite3/lib/index.js`).
 *  2. `backend/src/jest.setup.ts` points core's `getDatabase()` test hook
 *     (`globalThis.__LIRATEK_TEST_DB__`) at that mock; we re-point it at the
 *     real handle and reset the core singletons that cached the old one.
 *
 * Schema mirrors packages/core/src/repositories/__tests__/RechargeRepository.legReconciliation.test.ts.
 */

import { jest } from "@jest/globals";

jest.mock("../../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../../middleware/auth.js", () => {
  const authenticateJWT = (req: any, res: any, next: any) => {
    const role = req.headers["x-test-role"];
    if (!role) {
      res.status(401).json({ success: false, error: "No token provided" });
      return;
    }
    req.user = {
      userId: 42,
      username: "tester",
      role,
      tenantId: 1,
      sessionToken: "test-session",
    };
    next();
  };
  const requireRole = (roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: "Not authenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    next();
  };
  return { authenticateJWT, requireAuth: authenticateJWT, requireRole };
});

import express, { type Express } from "express";
import request from "supertest";
import type DatabaseType from "better-sqlite3";
import {
  resetRechargeRepository,
  resetRechargeService,
  resetTransactionRepository,
} from "@liratek/core";
import rechargeRouter from "../recharge.js";

// Bypass jest.config.cjs's `^better-sqlite3$` → mock mapping: a deep path is
// not matched by that anchored pattern, so this is the REAL native driver.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require("better-sqlite3/lib/index.js") as new (
  filename: string,
) => DatabaseType.Database;

const USD_LBP_SELL_RATE = 90_000;

function createTestDb(): DatabaseType.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE recharges (
      tenant_id INTEGER DEFAULT 1,
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier                 TEXT NOT NULL,
      recharge_type           TEXT NOT NULL,
      amount                  REAL NOT NULL,
      cost                    REAL NOT NULL DEFAULT 0,
      price                   REAL NOT NULL DEFAULT 0,
      default_price_to_client REAL,
      currency_code           TEXT DEFAULT 'USD',
      paid_by                 TEXT DEFAULT 'CASH',
      phone_number            TEXT,
      client_id               INTEGER,
      client_name             TEXT,
      note                    TEXT,
      created_by              INTEGER DEFAULT 1,
      created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
      edited_by               TEXT,
      edited_at               TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table  TEXT NOT NULL,
      source_id     INTEGER NOT NULL,
      user_id       INTEGER NOT NULL DEFAULT 1,
      amount_usd    REAL NOT NULL DEFAULT 0,
      amount_lbp    REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id     INTEGER,
      client_name   TEXT,
      client_phone  TEXT,
      reverses_id   INTEGER,
      profit_usd    REAL NOT NULL DEFAULT 0,
      profit_lbp    REAL NOT NULL DEFAULT 0,
      summary       TEXT,
      metadata_json TEXT,
      device_id     TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name    TEXT NOT NULL,
      phone_number TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      note             TEXT,
      due_date         TEXT,
      created_by       INTEGER,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    CREATE TABLE exchange_rates (
      to_code     TEXT,
      sell_rate   REAL,
      market_rate REAL
    );
    INSERT INTO exchange_rates (to_code, sell_rate) VALUES ('LBP', ${USD_LBP_SELL_RATE});

    INSERT INTO drawer_balances VALUES (1, 'MTC',     'USD', 1000,      CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Alfa',    'USD', 1000,      CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 5000,      CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 500000000, CURRENT_TIMESTAMP);
  `);

  return db;
}

function drawerBalance(
  db: DatabaseType.Database,
  drawer: string,
  currency: string,
): number {
  const row = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/recharge", rechargeRouter);
  return app;
}

describe("Recharge REST routes — POST /api/recharge/process", () => {
  let app: Express;
  let db: DatabaseType.Database;

  beforeEach(() => {
    db = createTestDb();
    // Re-point core's getDatabase() test hook (jest.setup.ts aims it at the
    // better-sqlite3 mock) and drop the singletons that captured it.
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__: unknown }
    ).__LIRATEK_TEST_DB__ = db;
    resetRechargeRepository();
    resetRechargeService();
    resetTransactionRepository();
    app = buildApp();
  });

  afterEach(() => {
    resetRechargeRepository();
    resetRechargeService();
    resetTransactionRepository();
    db.close();
  });

  it("moves BOTH drawers on a two-currency split — the legs must survive Zod (Phase 6a)", async () => {
    const generalUsdBefore = drawerBalance(db, "General", "USD");
    const generalLbpBefore = drawerBalance(db, "General", "LBP");

    // $6 recharge paid half in USD cash, half in LBP cash at the stamped
    // 90,000 sell rate ($3 → 270,000 LBP). Both legs are IN legs (no
    // `direction` key), so both must land in their OWN currency's drawer.
    const res = await request(app)
      .post("/api/recharge/process")
      .set("x-test-role", "admin")
      .send({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 6,
        cost: 5,
        price: 6,
        currency: "USD",
        phoneNumber: "03000091",
        paid_by_method: "CASH",
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 3 },
          { method: "CASH", currencyCode: "LBP", amount: 270_000 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(drawerBalance(db, "General", "USD")).toBe(generalUsdBefore + 3);
    expect(drawerBalance(db, "General", "LBP")).toBe(
      generalLbpBefore + 270_000,
    );

    // Belt-and-braces: two distinct customer-cash payment rows, one per
    // currency — not one collapsed $6 row from the legacy fallback.
    const cashLegs = db
      .prepare(
        "SELECT currency_code, amount FROM payments WHERE method = 'CASH' ORDER BY currency_code",
      )
      .all() as Array<{ currency_code: string; amount: number }>;
    expect(cashLegs).toEqual([
      { currency_code: "LBP", amount: 270_000 },
      { currency_code: "USD", amount: 3 },
    ]);
  });

  it("carries an OUT (change) leg through — forward-compat for money-OUT payouts", async () => {
    const generalUsdBefore = drawerBalance(db, "General", "USD");
    const generalLbpBefore = drawerBalance(db, "General", "LBP");

    // $6 price, customer tenders $10 USD, 360,000 LBP change handed back.
    const res = await request(app)
      .post("/api/recharge/process")
      .set("x-test-role", "admin")
      .send({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 6,
        cost: 5,
        price: 6,
        currency: "USD",
        phoneNumber: "03000092",
        paid_by_method: "CASH",
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 10 },
          {
            method: "CASH",
            currencyCode: "LBP",
            amount: 360_000,
            direction: "OUT",
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(drawerBalance(db, "General", "USD")).toBe(generalUsdBefore + 10);
    expect(drawerBalance(db, "General", "LBP")).toBe(
      generalLbpBefore - 360_000,
    );
  });

  it("keeps ALFA_GIFT, clientName and default_price_to_client on the recharge row", async () => {
    const res = await request(app)
      .post("/api/recharge/process")
      .set("x-test-role", "admin")
      .send({
        provider: "Alfa",
        type: "ALFA_GIFT",
        amount: 5,
        cost: 4,
        price: 6,
        currency: "USD",
        clientName: "Walk-in Rita",
        default_price_to_client: 5.5,
        paid_by_method: "CASH",
        payments: [{ method: "CASH", currencyCode: "USD", amount: 6 }],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const row = db
      .prepare(
        "SELECT recharge_type, client_name, default_price_to_client FROM recharges ORDER BY id DESC LIMIT 1",
      )
      .get() as {
      recharge_type: string;
      client_name: string | null;
      default_price_to_client: number | null;
    };
    expect(row).toEqual({
      recharge_type: "ALFA_GIFT",
      client_name: "Walk-in Rita",
      default_price_to_client: 5.5,
    });
  });

  it("staff is refused with 403 and never reaches the service (role parity with recharge:process)", async () => {
    const res = await request(app)
      .post("/api/recharge/process")
      .set("x-test-role", "staff")
      .send({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 6,
        cost: 5,
        price: 6,
        currency: "USD",
      });

    expect(res.status).toBe(403);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM recharges").get() as { n: number })
        .n,
    ).toBe(0);
  });
});
