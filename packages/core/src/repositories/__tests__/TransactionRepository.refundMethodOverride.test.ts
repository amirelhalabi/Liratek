/**
 * LIRA-078 — refund tender-selection modal, core money contract.
 *
 * `refundTransaction(id, userId, opts?.refundLegs)` lets the operator choose
 * the return method(s) for a refund instead of always mirroring the
 * original payment legs verbatim. Money contract: METHOD-OVERRIDE ONLY —
 * the refund's chosen legs must sum to the original's own net
 * customer-facing total, per currency; the operator picks the DRAWER the
 * money leaves from, never the amount or currency.
 *
 * Rule-17 classification:
 *   FAILING-FIRST (manually verified: temporarily short-circuiting the
 *   `isOverridableLeg`-gated skip in `_reversePayments` back to an
 *   unconditional mirror — i.e. reverting to the pre-LIRA-078 shape — makes
 *   "debits the CHOSEN drawer, original drawer untouched" go red: General
 *   gets debited back to 0 and OMT_App is never touched, the exact opposite
 *   of what the test asserts):
 *     - "override debits the chosen drawer, leaves the original untouched,
 *       nets to 0 system-wide"
 *     - D3 / LIRA-085 composition cases (the override still runs those
 *       modules' own reversal, alongside a DIFFERENT chosen drawer)
 *
 *   INVARIANT (rejection paths — always red without the fix simply because
 *   the feature/param doesn't exist pre-LIRA-078, not a behavioral flip):
 *     - mismatched per-currency totals rejected
 *     - inactive / non-drawer-affecting method rejected
 */

import Database from "better-sqlite3";
import { DebtRepository } from "../DebtRepository.js";
import { PartnerRepository } from "../PartnerRepository.js";
import { PartnerService } from "../../services/PartnerService.js";
import {
  TransactionRepository,
  resetTransactionRepository,
  type RefundLegOverride,
} from "../TransactionRepository.js";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

const RATE = 90_000;
const CLIENT_ID = 1;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL);
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO clients (id, full_name) VALUES (${CLIENT_ID}, 'Override Client');

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_App', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_App', 'USD', 0);

    CREATE TABLE payment_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      affects_drawer INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO payment_methods (code, label, drawer_name, affects_drawer, is_active, is_system) VALUES
      ('CASH', 'Cash', 'General', 1, 1, 1),
      ('OMT', 'OMT Wallet', 'OMT_App', 1, 1, 0),
      ('WHISH', 'Whish Wallet', 'Whish_App', 1, 1, 0),
      ('CUSTOMER_ACCOUNT', 'Customer Account', 'General', 0, 1, 1),
      ('OLDCARD', 'Retired Card Method', 'General', 1, 0, 0);

    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      edited_by TEXT,
      edited_at DATETIME,
      session_id INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0,
      refunded_at DATETIME,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      final_amount_usd REAL NOT NULL DEFAULT 0,
      paid_usd REAL NOT NULL DEFAULT 0,
      paid_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 0,
      status TEXT DEFAULT 'completed',
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1
    );

    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      is_refunded INTEGER DEFAULT 0,
      tenant_id INTEGER DEFAULT 1
    );

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT DEFAULT 'BILL',
      amount REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      refunded_at DATETIME,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE exchange_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_code TEXT NOT NULL DEFAULT 'USD',
      to_code TEXT NOT NULL,
      market_rate REAL NOT NULL,
      buy_rate REAL NOT NULL,
      sell_rate REAL NOT NULL,
      is_stronger INTEGER NOT NULL DEFAULT 1,
      tenant_id INTEGER DEFAULT 1
    );
    INSERT INTO exchange_rates (to_code, market_rate, buy_rate, sell_rate, is_stronger)
    VALUES ('LBP', ${RATE}, ${RATE}, ${RATE}, 1);

    CREATE TABLE partners (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL UNIQUE,
      phone              TEXT,
      notes              TEXT,
      is_active          INTEGER NOT NULL DEFAULT 1,
      system_association TEXT,
      tenant_id          INTEGER DEFAULT 1,
      created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at         TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO partners (id, name) VALUES (1, 'Override Partner');

    CREATE TABLE partner_ledger (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id        INTEGER NOT NULL REFERENCES partners(id),
      transaction_type  TEXT,
      reference_table   TEXT,
      reference_id      INTEGER,
      amount            REAL NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'USD',
      direction         TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes             TEXT,
      user_id           INTEGER,
      settlement_method TEXT,
      tenant_id         INTEGER DEFAULT 1,
      created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount    REAL NOT NULL DEFAULT 0
    );
  `);
  return db;
}

function drawer(db: Database.Database, name: string, ccy = "USD"): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(name, ccy) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function insertTxnWithCashLeg(
  db: Database.Database,
  amountUsd: number,
): number {
  const txn = db
    .prepare(
      `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, summary)
       VALUES ('SALE', 'sales', 1, 1, ?, 'Cash sale')`,
    )
    .run(amountUsd);
  const txnId = Number(txn.lastInsertRowid);
  db.prepare(
    `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, note, created_by)
     VALUES (?, 'CASH', 'General', 'USD', ?, NULL, 1)`,
  ).run(txnId, amountUsd);
  db.prepare(
    `UPDATE drawer_balances SET balance = balance + ? WHERE drawer_name = 'General' AND currency_code = 'USD'`,
  ).run(amountUsd);
  return txnId;
}

/**
 * A transaction shaped like an OMT/WHISH SEND: ONE customer-facing CASH leg
 * (the tender the operator may override) alongside TWO internal bookkeeping
 * legs the override must never touch — a `RESERVE`-method leg (matches
 * `INTERNAL_LEG_METHODS`) and a `TRANSFER`-method leg posted to a `_System`
 * drawer (matches the drawer-suffix branch of `isInternalLegJs`). Both
 * exemption paths are exercised so a regression in EITHER branch of the
 * shared predicate would be caught.
 */
function insertMixedLegTxn(db: Database.Database): number {
  const txn = db
    .prepare(
      `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, summary)
       VALUES ('FINANCIAL_SERVICE', 'financial_services', 1, 1, 100, 'OMT SEND')`,
    )
    .run();
  const txnId = Number(txn.lastInsertRowid);

  const legs: Array<[string, string, string, number]> = [
    ["CASH", "General", "USD", 100], // customer-facing — overridable
    ["RESERVE", "General", "USD", -20], // internal (method marker)
    ["TRANSFER", "OMT_System", "USD", -100], // internal (drawer suffix)
  ];
  for (const [method, drawerName, currencyCode, amount] of legs) {
    db.prepare(
      `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, note, created_by)
       VALUES (?, ?, ?, ?, ?, NULL, 1)`,
    ).run(txnId, method, drawerName, currencyCode, amount);
    db.prepare(
      `INSERT INTO drawer_balances (drawer_name, currency_code, balance)
       VALUES (?, ?, ?)
       ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET balance = drawer_balances.balance + excluded.balance`,
    ).run(drawerName, currencyCode, amount);
  }
  return txnId;
}

describe("LIRA-078 — refund method-override (tender-selection modal)", () => {
  let db: Database.Database;
  let txnRepo: TransactionRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetPaymentMethodRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetPaymentMethodRepository();
    resetTenantContext();
  });

  // ── (a) FAILING-FIRST: override debits the CHOSEN drawer ────────────────

  describe("override debits the chosen drawer, leaves the original untouched, nets to 0 system-wide", () => {
    it("a $100 CASH sale refunded via OMT debits OMT_App, NOT General", () => {
      const txnId = insertTxnWithCashLeg(db, 100);
      expect(drawer(db, "General", "USD")).toBeCloseTo(100, 2);
      expect(drawer(db, "OMT_App", "USD")).toBeCloseTo(0, 2);

      const refundLegs: RefundLegOverride[] = [
        { method: "OMT", currencyCode: "USD", amount: 100 },
      ];
      const refundId = txnRepo.refundTransaction(txnId, 1, { refundLegs });

      // The ORIGINAL drawer (General) is left exactly as the sale left it —
      // the override does NOT mirror/reverse the CASH leg.
      expect(drawer(db, "General", "USD")).toBeCloseTo(100, 2);
      // The CHOSEN drawer (OMT_App) absorbs the refund instead.
      expect(drawer(db, "OMT_App", "USD")).toBeCloseTo(-100, 2);
      // System-wide (sum across every drawer this flow touched), the money
      // nets to 0 relative to the pre-sale baseline: +100 (sale) - 100
      // (override refund) = 0 — "nets to 0" means summed across drawers,
      // never per-drawer, when the operator redirects the payout.
      expect(
        drawer(db, "General", "USD") + drawer(db, "OMT_App", "USD"),
      ).toBeCloseTo(0, 2);

      const refundLeg = db
        .prepare(
          `SELECT method, drawer_name, currency_code, amount, note FROM payments WHERE transaction_id = ?`,
        )
        .get(refundId) as {
        method: string;
        drawer_name: string;
        currency_code: string;
        amount: number;
        note: string;
      };
      expect(refundLeg.method).toBe("OMT");
      expect(refundLeg.drawer_name).toBe("OMT_App");
      expect(refundLeg.amount).toBeCloseTo(-100, 2);
      expect(refundLeg.note).toMatch(/method override/i);
    });

    it("plain refund (no refundLegs) still mirrors the original leg exactly — unchanged default path", () => {
      const txnId = insertTxnWithCashLeg(db, 100);
      txnRepo.refundTransaction(txnId, 1);
      expect(drawer(db, "General", "USD")).toBeCloseTo(0, 2);
      expect(drawer(db, "OMT_App", "USD")).toBeCloseTo(0, 2);
    });
  });

  // ── (b) mismatched totals rejected ───────────────────────────────────────

  describe("mismatched per-currency totals are rejected", () => {
    it("throws when the override total is less than the original", () => {
      const txnId = insertTxnWithCashLeg(db, 100);
      expect(() =>
        txnRepo.refundTransaction(txnId, 1, {
          refundLegs: [{ method: "OMT", currencyCode: "USD", amount: 60 }],
        }),
      ).toThrow(/do not match/i);
      // Nothing partial was written — the guard runs before the transaction.
      expect(drawer(db, "General", "USD")).toBeCloseTo(100, 2);
      expect(drawer(db, "OMT_App", "USD")).toBeCloseTo(0, 2);
    });

    it("throws when the override total is more than the original", () => {
      const txnId = insertTxnWithCashLeg(db, 100);
      expect(() =>
        txnRepo.refundTransaction(txnId, 1, {
          refundLegs: [{ method: "OMT", currencyCode: "USD", amount: 150 }],
        }),
      ).toThrow(/do not match/i);
    });

    it("throws for a currency the original never had (cross-currency out of scope)", () => {
      const txnId = insertTxnWithCashLeg(db, 100);
      expect(() =>
        txnRepo.refundTransaction(txnId, 1, {
          refundLegs: [
            { method: "OMT", currencyCode: "LBP", amount: 9_000_000 },
          ],
        }),
      ).toThrow(/do not match/i);
    });
  });

  // ── (c) inactive / non-drawer method rejected ────────────────────────────

  describe("inactive / non-drawer-affecting methods are rejected", () => {
    it("throws for an inactive payment method", () => {
      const txnId = insertTxnWithCashLeg(db, 100);
      expect(() =>
        txnRepo.refundTransaction(txnId, 1, {
          refundLegs: [{ method: "OLDCARD", currencyCode: "USD", amount: 100 }],
        }),
      ).toThrow(/not an active, drawer-affecting/i);
    });

    it("throws for a non-drawer method (CUSTOMER_ACCOUNT)", () => {
      const txnId = insertTxnWithCashLeg(db, 100);
      expect(() =>
        txnRepo.refundTransaction(txnId, 1, {
          refundLegs: [
            { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 100 },
          ],
        }),
      ).toThrow(/not an active, drawer-affecting/i);
    });

    it("throws for an unknown method code", () => {
      const txnId = insertTxnWithCashLeg(db, 100);
      expect(() =>
        txnRepo.refundTransaction(txnId, 1, {
          refundLegs: [
            { method: "NOT_A_METHOD", currencyCode: "USD", amount: 100 },
          ],
        }),
      ).toThrow(/not an active, drawer-affecting/i);
    });
  });

  // ── (d) D3 composition — DEBT_REPAYMENT refunded via override ────────────

  describe("D3 composition: a DEBT_REPAYMENT refunded via override still restores the debt", () => {
    it("restores the ledger to its pre-repayment value AND debits the chosen drawer (not General)", () => {
      db.prepare(
        `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, created_by)
         VALUES (?, 'Sale Debt', 100, 0, 1)`,
      ).run(CLIENT_ID);

      const debtRepo = new DebtRepository();
      const { id: repaymentId } = debtRepo.addRepayment({
        client_id: CLIENT_ID,
        amount_usd: 60,
        amount_lbp: 0,
        created_by: 1,
      });
      const repaymentTxn = db
        .prepare(`SELECT transaction_id FROM debt_ledger WHERE id = ?`)
        .get(repaymentId) as { transaction_id: number };
      const txnId = repaymentTxn.transaction_id;

      const ledgerBefore = db
        .prepare(
          `SELECT COALESCE(SUM(amount_usd), 0) AS usd FROM debt_ledger WHERE client_id = ?`,
        )
        .get(CLIENT_ID) as { usd: number };
      expect(ledgerBefore.usd).toBeCloseTo(40, 2); // 100 charge - 60 repaid
      expect(drawer(db, "General", "USD")).toBeCloseTo(60, 2);

      txnRepo.refundTransaction(txnId, 1, {
        refundLegs: [{ method: "OMT", currencyCode: "USD", amount: 60 }],
      });

      // D3 restore still fires: debt back to its pre-repayment 100.
      const ledgerAfter = db
        .prepare(
          `SELECT COALESCE(SUM(amount_usd), 0) AS usd FROM debt_ledger WHERE client_id = ?`,
        )
        .get(CLIENT_ID) as { usd: number };
      expect(ledgerAfter.usd).toBeCloseTo(100, 2);

      // But the CASH the client originally paid (General) is untouched — the
      // override redirected the refund to OMT_App instead.
      expect(drawer(db, "General", "USD")).toBeCloseTo(60, 2);
      expect(drawer(db, "OMT_App", "USD")).toBeCloseTo(-60, 2);
    });
  });

  // ── (e) LIRA-085 composition — PARTNER_SETTLEMENT refunded via override ──

  describe("LIRA-085 composition: a PARTNER_SETTLEMENT refunded via override still unwinds partner ledger + coverage", () => {
    it("restores the partner balance + FOR_POS coverage AND debits the chosen drawer (not General)", () => {
      db.prepare(
        `INSERT INTO partner_ledger (partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, user_id)
         VALUES (1, 'FOR_POS', 'sales', 1, 100, 'USD', 'DEBIT', 1)`,
      ).run();

      const partnerRepo = new PartnerRepository();
      const partnerService = new PartnerService(partnerRepo);
      const entry = partnerService.settle({
        partnerId: 1,
        amount: 100,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
      });
      const txnId = txnRepo.getBySourceId("partner_ledger", entry.id)!.id;

      const balanceBefore = db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN direction='DEBIT' THEN amount ELSE -amount END), 0) AS net
           FROM partner_ledger WHERE partner_id = 1 AND currency = 'USD'`,
        )
        .get() as { net: number };
      expect(balanceBefore.net).toBeCloseTo(0, 2); // settlement nets it
      expect(drawer(db, "General", "USD")).toBeCloseTo(100, 2);

      txnRepo.refundTransaction(txnId, 1, {
        refundLegs: [{ method: "WHISH", currencyCode: "USD", amount: 100 }],
      });

      // LIRA-085 restore still fires: partner owes us again.
      const balanceAfter = db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN direction='DEBIT' THEN amount ELSE -amount END), 0) AS net
           FROM partner_ledger WHERE partner_id = 1 AND currency = 'USD'`,
        )
        .get() as { net: number };
      expect(balanceAfter.net).toBeCloseTo(100, 2);

      const forPos = db
        .prepare(
          `SELECT covered_amount FROM partner_ledger WHERE transaction_type = 'FOR_POS'`,
        )
        .get() as { covered_amount: number };
      expect(forPos.covered_amount).toBeCloseTo(0, 2);

      // The CASH the settlement paid out of General is untouched — the
      // override redirected the refund's reversal to Whish_App instead.
      expect(drawer(db, "General", "USD")).toBeCloseTo(100, 2);
      expect(drawer(db, "Whish_App", "USD")).toBeCloseTo(-100, 2);
    });
  });

  // ── (f) mixed-leg composition — internal legs still mirror verbatim ─────

  describe("mixed-leg composition: internal legs mirror verbatim while the customer-facing leg is overridden", () => {
    it("an OMT-SEND-shaped txn (CASH + RESERVE + _System TRANSFER) refunded via override only redirects the CASH leg", () => {
      const txnId = insertMixedLegTxn(db);

      // Sanity on the forward state before refunding.
      expect(drawer(db, "General", "USD")).toBeCloseTo(80, 2); // +100 CASH - 20 RESERVE
      expect(drawer(db, "OMT_System", "USD")).toBeCloseTo(-100, 2); // TRANSFER
      expect(drawer(db, "OMT_App", "USD")).toBeCloseTo(0, 2);

      const refundId = txnRepo.refundTransaction(txnId, 1, {
        refundLegs: [{ method: "OMT", currencyCode: "USD", amount: 100 }],
      });

      // The internal RESERVE leg round-trips fully: its own -20 is undone,
      // so General ends up back at the CASH-only value (100) — NOT reversed
      // to 0, because the CASH leg itself was overridden away, not mirrored.
      expect(drawer(db, "General", "USD")).toBeCloseTo(100, 2);
      // The internal TRANSFER leg (drawer-suffix exemption) round-trips
      // fully too — back to its pre-transaction baseline.
      expect(drawer(db, "OMT_System", "USD")).toBeCloseTo(0, 2);
      // The CHOSEN drawer absorbs exactly the customer-facing leg's amount.
      expect(drawer(db, "OMT_App", "USD")).toBeCloseTo(-100, 2);

      const refundLegRows = db
        .prepare(
          `SELECT method, drawer_name, amount, note FROM payments WHERE transaction_id = ? ORDER BY id ASC`,
        )
        .all(refundId) as Array<{
        method: string;
        drawer_name: string;
        amount: number;
        note: string;
      }>;
      // Exactly 3 reversal rows: RESERVE + TRANSFER mirrored verbatim, CASH
      // replaced by the ONE override leg — never 4 (CASH never mirrored
      // AND overridden) and never 2 (an internal leg silently dropped).
      expect(refundLegRows).toHaveLength(3);
      const reserveReversal = refundLegRows.find((r) => r.method === "RESERVE");
      expect(reserveReversal?.amount).toBeCloseTo(20, 2);
      expect(reserveReversal?.note).toBe("Reversal");
      const transferReversal = refundLegRows.find(
        (r) => r.method === "TRANSFER",
      );
      expect(transferReversal?.amount).toBeCloseTo(100, 2);
      expect(transferReversal?.drawer_name).toBe("OMT_System");
      expect(transferReversal?.note).toBe("Reversal");
      const overrideLeg = refundLegRows.find((r) => r.method === "OMT");
      expect(overrideLeg?.amount).toBeCloseTo(-100, 2);
      expect(overrideLeg?.note).toMatch(/method override/i);
    });
  });
});
