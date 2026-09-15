/**
 * LIRA-192 — "Cash Out to OMT" (OMT App wallet cashout).
 *
 * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §8 (D10-D15). The mirror of LIRA-190's
 * credit top-up, opposite sign: `OMT_App` drawer −amount, the `'OMT App'`
 * supplier_ledger credited −(amount + 0.1% commission) — OMT now owes the
 * shop — `OMT_System` untouched (D2), `profit_* = 0` at creation (D14, the
 * commission is recognised at OMT account settlement, LIRA-189 wave 2).
 *
 * DELTA discipline (rule 15): every assertion is a before/after delta on
 * freshly-seeded balances, not an absolute total.
 *
 * RULE 17 NOTE for whoever runs this suite (this lane does not run tests):
 * the "create+void nets to 0" case below is this ticket's rule-17 proof
 * obligation. To watch it FAIL on pre-fix code, temporarily change the
 * `entry_type` this file expects from `"PAYMENT"` to `"SUPPLIER_PAYS_US"` in
 * the "books ... entry_type PAYMENT" assertions (plan §9.2's exact wrong-sign
 * mistake) — the ledger-sign and net-to-zero assertions must then fail,
 * because `SUPPLIER_PAYS_US` is POSITIVE and moves the account the WRONG
 * way. Revert after observing the failure.
 */

import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  getSupplierRepository,
  resetSupplierRepository,
} from "../SupplierRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { omtAppCashoutCommission } from "../../constants/omtAppCashout";

// ─── Mock DB connection ────────────────────────────────────────────────────

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("Test DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

// ─── In-memory schema (same shape as RechargeRepository.omtAppCredit.test.ts
//      and TransactionRepository.supplierSiblingVoidCascade.test.ts's proven
//      cascade fixture — reused so this file's create+void case exercises
//      the SAME generic mechanism that test already demonstrates works). ────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE recharges (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier TEXT NOT NULL,
      recharge_type TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      default_price_to_client REAL,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      paid_by TEXT NOT NULL,
      phone_number TEXT,
      client_id INTEGER,
      client_name TEXT,
      note TEXT,
      created_by INTEGER NOT NULL DEFAULT 1,
      edited_by TEXT,
      edited_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      transaction_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE suppliers (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      provider TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      module_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT', 'OMT', 1);
    INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT App', 'OMT_APP', 1);

    -- v136 shape (source_ref_table/id) — cashoutToSupplier's ledger row is a
    -- source-ref sibling (NOT link-mode), so these columns must be present
    -- for the back-link to actually be stored and for the void cascade to
    -- find it.
    CREATE TABLE supplier_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at DATETIME,
      source_ref_table TEXT DEFAULT NULL,
      source_ref_id INTEGER DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- voidTransaction() unconditionally runs _cancelDebt(), which SELECTs
    -- from debt_ledger for EVERY void regardless of transaction type (it's
    -- a no-op SELECT when nothing matches, but the table must exist or the
    -- query itself throws — the exact "missing table kills every test in
    -- the file" trap this repo has been bitten by before). Same shape as
    -- TransactionRepository.supplierSiblingVoidCascade.test.ts's fixture.
    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );

    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_App', 'USD', 500);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_App', 'LBP', 50000000);
    -- Seeded non-zero so a regression that ever touches the PCD is visible.
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_System', 'USD', 250);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_System', 'LBP', 25000000);
  `);

  return db;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function balance(
  db: Database.Database,
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

function omtAppSupplierId(db: Database.Database): number {
  return (
    db.prepare(`SELECT id FROM suppliers WHERE provider = 'OMT_APP'`).get() as {
      id: number;
    }
  ).id;
}

describe("RechargeRepository.cashoutToSupplier() — Cash Out to OMT (LIRA-192)", () => {
  let db: Database.Database;
  let repo: RechargeRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    resetTransactionRepository();
    repo = new RechargeRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetSupplierRepository();
    resetTransactionRepository();
  });

  it("USD: OMT_App -= amount, OMT_System untouched, ledger -(amount+commission), profit 0, commission stored", () => {
    const before = {
      omtApp: balance(db, "OMT_App", "USD"),
      omtSystem: balance(db, "OMT_System", "USD"),
    };
    const expectedCommission = omtAppCashoutCommission(100, "USD");
    expect(expectedCommission).toBeCloseTo(0.1, 4); // 0.1% of 100

    const result = repo.cashoutToSupplier({
      provider: "OMT_APP",
      amount: 100,
      currency: "USD",
      userId: 1,
    });

    expect(result.success).toBe(true);
    expect(result.commission).toBeCloseTo(expectedCommission, 4);

    expect(balance(db, "OMT_App", "USD") - before.omtApp).toBeCloseTo(-100, 2);
    // D2 — no physical cash moves; the OMT Cash Drawer is untouched.
    expect(balance(db, "OMT_System", "USD") - before.omtSystem).toBe(0);

    const ledgerRow = db
      .prepare(
        `SELECT * FROM supplier_ledger WHERE supplier_id = ?`,
      )
      .get(omtAppSupplierId(db)) as {
      entry_type: string;
      amount_usd: number;
      amount_lbp: number;
      is_auto: number;
      source_ref_table: string | null;
      source_ref_id: number | null;
    };
    // §9.2 — PAYMENT, never SUPPLIER_PAYS_US (which is POSITIVE and would
    // move the account the WRONG way).
    expect(ledgerRow.entry_type).toBe("PAYMENT");
    // addLedgerEntry force-negates every PAYMENT row.
    expect(ledgerRow.amount_usd).toBeCloseTo(
      -(100 + expectedCommission),
      4,
    );
    expect(ledgerRow.amount_usd).toBeLessThan(0);
    expect(ledgerRow.is_auto).toBe(1);
    expect(ledgerRow.source_ref_table).toBe("recharges");
    expect(ledgerRow.source_ref_id).toBeTruthy();

    const rechargeRow = db
      .prepare(`SELECT id FROM recharges`)
      .get() as { id: number };
    expect(ledgerRow.source_ref_id).toBe(rechargeRow.id);

    // Two transaction rows: WALLET_CASHOUT (this method's own) + the auto
    // SUPPLIER_PAYMENT sibling addLedgerEntry creates (source-ref mode, not
    // link-mode — a known trap, see CONTRACT.md L10).
    const cashoutTxn = db
      .prepare(`SELECT * FROM transactions WHERE type = 'WALLET_CASHOUT'`)
      .get() as {
      id: number;
      amount_usd: number;
      profit_usd: number;
      profit_lbp: number;
      metadata_json: string;
      source_table: string;
      source_id: number;
    };
    expect(cashoutTxn.amount_usd).toBeCloseTo(100, 2);
    expect(cashoutTxn.profit_usd).toBe(0);
    expect(cashoutTxn.profit_lbp).toBe(0);
    expect(cashoutTxn.source_table).toBe("recharges");
    expect(cashoutTxn.source_id).toBe(rechargeRow.id);
    // No `commission` COLUMN exists on `transactions` — stored in
    // metadata_json (this repo's established json_extract-queryable
    // pattern), echoed back in the return value for the UI (rule 19).
    const metadata = JSON.parse(cashoutTxn.metadata_json) as {
      commission: number;
    };
    expect(metadata.commission).toBeCloseTo(expectedCommission, 4);

    const siblingTxn = db
      .prepare(`SELECT * FROM transactions WHERE type = 'SUPPLIER_PAYMENT'`)
      .get() as { source_table: string };
    expect(siblingTxn.source_table).toBe("supplier_ledger");

    const txnCount = (
      db.prepare(`SELECT COUNT(*) c FROM transactions`).get() as { c: number }
    ).c;
    expect(txnCount).toBe(2);

    // The wallet leg is a REAL payments row (rule 20 — reversible).
    const paymentRow = db
      .prepare(
        `SELECT * FROM payments WHERE transaction_id = ? AND drawer_name = 'OMT_App'`,
      )
      .get(cashoutTxn.id) as { amount: number } | undefined;
    expect(paymentRow).toBeDefined();
    expect(paymentRow!.amount).toBeCloseTo(-100, 2);
  });

  it("LBP: OMT_App -= amount, OMT_System untouched, ledger -(amount+commission) in LBP", () => {
    const before = {
      omtApp: balance(db, "OMT_App", "LBP"),
      omtSystem: balance(db, "OMT_System", "LBP"),
    };
    const expectedCommission = omtAppCashoutCommission(9_000_000, "LBP");
    expect(expectedCommission).toBeCloseTo(9_000, 0); // 0.1% of 9,000,000

    const result = repo.cashoutToSupplier({
      provider: "OMT_APP",
      amount: 9_000_000,
      currency: "LBP",
      userId: 1,
    });

    expect(result.success).toBe(true);
    expect(result.commission).toBeCloseTo(expectedCommission, 0);
    expect(balance(db, "OMT_App", "LBP") - before.omtApp).toBeCloseTo(
      -9_000_000,
      0,
    );
    expect(balance(db, "OMT_System", "LBP") - before.omtSystem).toBe(0);

    const ledgerRow = db
      .prepare(`SELECT amount_lbp FROM supplier_ledger WHERE entry_type = 'PAYMENT'`)
      .get() as { amount_lbp: number };
    expect(ledgerRow.amount_lbp).toBeCloseTo(-(9_000_000 + 9_000), 0);
  });

  it("D15: an over-draw is rejected per currency and writes NOTHING", () => {
    // Wallet only holds 500 USD (seeded above); ask for more.
    const before = {
      omtApp: balance(db, "OMT_App", "USD"),
      omtSystem: balance(db, "OMT_System", "USD"),
    };

    const result = repo.cashoutToSupplier({
      provider: "OMT_APP",
      amount: 1_000,
      currency: "USD",
      userId: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Insufficient balance");
    expect(result.commission).toBeUndefined();

    // Nothing moved and nothing was written.
    expect(balance(db, "OMT_App", "USD")).toBe(before.omtApp);
    expect(balance(db, "OMT_System", "USD")).toBe(before.omtSystem);
    expect(
      (db.prepare(`SELECT COUNT(*) c FROM recharges`).get() as { c: number })
        .c,
    ).toBe(0);
    expect(
      (
        db.prepare(`SELECT COUNT(*) c FROM transactions`).get() as {
          c: number;
        }
      ).c,
    ).toBe(0);
    expect(
      (
        db.prepare(`SELECT COUNT(*) c FROM supplier_ledger`).get() as {
          c: number;
        }
      ).c,
    ).toBe(0);
  });

  it("rejects a zero/negative amount without touching anything", () => {
    const result = repo.cashoutToSupplier({
      provider: "OMT_APP",
      amount: 0,
      currency: "USD",
      userId: 1,
    });
    expect(result.success).toBe(false);
    expect(
      (db.prepare(`SELECT COUNT(*) c FROM recharges`).get() as { c: number })
        .c,
    ).toBe(0);
  });

  // ── Reversal (rule 20 / rule 17) ──────────────────────────────────────────

  it("create + void nets the OMT_App drawer, the 'OMT App' ledger, and profit to exactly 0 (USD)", () => {
    const supplierId = omtAppSupplierId(db);
    const drawerBefore = balance(db, "OMT_App", "USD");

    const result = repo.cashoutToSupplier({
      provider: "OMT_APP",
      amount: 100,
      currency: "USD",
      userId: 1,
    });
    expect(result.success).toBe(true);

    // Sanity: the account is in debt to the shop before voiding.
    const balanceAfterCashout = getSupplierRepository().getSupplierBalance(
      supplierId,
    );
    expect(balanceAfterCashout.balance_usd).toBeLessThan(0);

    const cashoutTxn = db
      .prepare(`SELECT id FROM transactions WHERE type = 'WALLET_CASHOUT'`)
      .get() as { id: number };
    // Capture the auto sibling's OWN hidden transaction id BEFORE voiding —
    // voidTransaction's reversal row (same type, status ACTIVE, negated
    // amounts — the accounting-journal append-only pattern this file's own
    // header comment documents) would otherwise be indistinguishable from
    // the original by `type` alone.
    const siblingLedgerRow = db
      .prepare(
        `SELECT transaction_id FROM supplier_ledger WHERE supplier_id = ?`,
      )
      .get(supplierId) as { transaction_id: number };
    const siblingTxnId = siblingLedgerRow.transaction_id;

    // WALLET_CASHOUT is deliberately NOT in NON_REVERSIBLE_TRANSACTION_TYPES
    // (constants/transactionTypes.ts) — unlike RECHARGE_TOPUP, its wallet
    // leg is a real `payments` row, so the generic void path applies.
    getTransactionRepository().voidTransaction(cashoutTxn.id, 1);

    // Drawer nets back to its pre-cashout value.
    expect(balance(db, "OMT_App", "USD")).toBeCloseTo(drawerBefore, 2);

    // Account nets to 0 — the same "nets to 0" idiom
    // TransactionRepository.supplierSiblingVoidCascade.test.ts's case (b)
    // already proves for a generic recharges-sourced auto sibling
    // (getSupplierBalance excludes is_refunded rows from its SUM).
    const balanceAfterVoid = getSupplierRepository().getSupplierBalance(
      supplierId,
    );
    expect(balanceAfterVoid.balance_usd).toBe(0);
    expect(balanceAfterVoid.balance_lbp).toBe(0);

    // Both ORIGINAL transactions (the cashout AND its cascaded auto sibling)
    // end up VOIDED — each also now has its own ACTIVE reversal row, which is
    // correct and NOT asserted against here.
    const cashoutStatus = (
      db.prepare(`SELECT status FROM transactions WHERE id = ?`).get(
        cashoutTxn.id,
      ) as { status: string }
    ).status;
    const siblingStatus = (
      db.prepare(`SELECT status FROM transactions WHERE id = ?`).get(
        siblingTxnId,
      ) as { status: string }
    ).status;
    expect(cashoutStatus).toBe("VOIDED");
    expect(siblingStatus).toBe("VOIDED");

    // The sibling supplier_ledger row itself is flagged, not deleted.
    const ledgerAfterVoid = db
      .prepare(`SELECT is_refunded FROM supplier_ledger WHERE supplier_id = ?`)
      .get(supplierId) as { is_refunded: number };
    expect(ledgerAfterVoid.is_refunded).toBe(1);
  });
});
