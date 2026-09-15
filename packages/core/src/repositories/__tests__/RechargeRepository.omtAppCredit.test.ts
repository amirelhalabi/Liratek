/**
 * LIRA-190 — OMT App wallet loads on OMT credit by default.
 *
 * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §1 (D2/D4), §5. `RechargeRepository
 * .topUpFromSupplier` — already correct for iPick/Katsh (no source drawer
 * touched, dest drawer up, `TOP_UP` debt booked on the supplier found by
 * `getByProvider`) — is widened to accept `"OMT_APP"` too. The behaviour is
 * NOT new; only the accepted provider is. `getByProvider("OMT_APP")`
 * resolves the `'OMT App'` supplier row, which LIRA-187's migration parents
 * under `'OMT'`, so the booking lands in the OMT open-credit account with
 * zero new code in this method.
 *
 * D2's OTHER half — `TOP_UP_PROVIDER_DEFAULT_SOURCES.OMT_APP` no longer
 * defaulting the DRAWER-TRANSFER path (`topUpApp`) to `OMT_System` — is a
 * plain constants test below (that path is `frontend`'s default choice, not
 * this repository's own behaviour, but the constant itself lives in this
 * lane — `constants/rechargeProviders.ts`).
 *
 * DELTA discipline (rule 15): every drawer/ledger assertion below is a
 * before/after delta on freshly-seeded balances, not an absolute total.
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
import {
  TOP_UP_PROVIDER_DEFAULT_SOURCES,
  TOP_UP_PROVIDER_DRAWERS,
} from "../../constants/rechargeProviders";

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

// ─── In-memory schema ──────────────────────────────────────────────────────
// Same shape as TransactionRepository.supplierSiblingVoidCascade.test.ts's
// proven fixture (that file's case (b) already demonstrates the generic
// cascade mechanism against a synthetic recharges-sourced sibling) — reused
// here so a real `topUpFromSupplier("OMT_APP", ...)` call exercises the same
// tables.

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
    INSERT INTO suppliers (name, provider, is_system) VALUES ('iPick', 'iPick', 1);

    -- v136 shape (source_ref_table/id) — present so addLedgerEntry's
    -- schema-drift probe sees the modern shape, even though topUpFromSupplier
    -- itself uses LINK-MODE (transaction_id), never source_ref.
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

    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_App', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_App', 'LBP', 0);
    -- Seeded NON-ZERO so a regression back to the old
    -- TOP_UP_PROVIDER_DEFAULT_SOURCES.OMT_APP = 'OMT_System' behaviour (which
    -- only affects topUpApp, not topUpFromSupplier — but a future refactor
    -- that accidentally merges the two paths would show up here) is visible.
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

describe("RechargeRepository.topUpFromSupplier() — OMT App (LIRA-190)", () => {
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

  it("USD: OMT_App drawer += amount, OMT_System stays untouched (D2), TOP_UP booked on 'OMT App'", () => {
    const omtAppSupplierId = (
      db.prepare(`SELECT id FROM suppliers WHERE provider = 'OMT_APP'`).get() as {
        id: number;
      }
    ).id;

    const before = {
      omtApp: balance(db, "OMT_App", "USD"),
      omtSystem: balance(db, "OMT_System", "USD"),
    };

    const result = repo.topUpFromSupplier({
      provider: "OMT_APP",
      amount: 100,
      currency: "USD",
      userId: 1,
    });

    expect(result.success).toBe(true);
    expect(balance(db, "OMT_App", "USD") - before.omtApp).toBeCloseTo(100, 2);
    // D2 — the OMT Cash Drawer never moves for a credit-funded wallet load.
    expect(balance(db, "OMT_System", "USD") - before.omtSystem).toBe(0);

    const ledgerRows = db
      .prepare(`SELECT * FROM supplier_ledger WHERE supplier_id = ?`)
      .all(omtAppSupplierId) as Array<{
      entry_type: string;
      amount_usd: number;
      amount_lbp: number;
      transaction_id: number | null;
    }>;
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].entry_type).toBe("TOP_UP");
    expect(ledgerRows[0].amount_usd).toBeCloseTo(100, 2);
    expect(ledgerRows[0].transaction_id).toBeTruthy();

    const txn = db
      .prepare(`SELECT * FROM transactions WHERE type = 'RECHARGE_TOPUP'`)
      .get() as { amount_usd: number; source_table: string };
    expect(txn.amount_usd).toBeCloseTo(100, 2);
    expect(txn.source_table).toBe("recharges");

    // Link-mode: the ledger row shares the SAME transaction as the parent —
    // not a separate auto sibling (contrast with cashoutToSupplier's
    // source-ref sibling shape).
    const allTxns = db.prepare(`SELECT COUNT(*) c FROM transactions`).get() as {
      c: number;
    };
    expect(allTxns.c).toBe(1);
  });

  it("LBP: OMT_App drawer += amount, OMT_System stays untouched, TOP_UP booked in LBP", () => {
    const before = {
      omtApp: balance(db, "OMT_App", "LBP"),
      omtSystem: balance(db, "OMT_System", "LBP"),
    };

    const result = repo.topUpFromSupplier({
      provider: "OMT_APP",
      amount: 9_000_000,
      currency: "LBP",
      userId: 1,
    });

    expect(result.success).toBe(true);
    expect(balance(db, "OMT_App", "LBP") - before.omtApp).toBeCloseTo(
      9_000_000,
      0,
    );
    expect(balance(db, "OMT_System", "LBP") - before.omtSystem).toBe(0);

    const ledgerRow = db
      .prepare(
        `SELECT amount_lbp FROM supplier_ledger WHERE entry_type = 'TOP_UP'`,
      )
      .get() as { amount_lbp: number };
    expect(ledgerRow.amount_lbp).toBeCloseTo(9_000_000, 0);
  });

  it("does not resolve 'iPick' or Katsh into the OMT App drawer (provider isolation)", () => {
    const result = repo.topUpFromSupplier({
      provider: "iPick",
      amount: 50,
      currency: "USD",
      userId: 1,
    });
    expect(result.success).toBe(true);
    expect(balance(db, "OMT_App", "USD")).toBe(0);
    expect(balance(db, TOP_UP_PROVIDER_DRAWERS.iPick, "USD")).toBeCloseTo(
      50,
      2,
    );
  });

  // ── Reversal — NOT proven here (contract contradiction, see RISKS) ───────
  //
  // OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §5 (LIRA-190 "Reversal") claims "iPick's
  // existing void path is the model" for making this credit top-up void to
  // zero. That is factually incorrect as of this ticket:
  // `TRANSACTION_TYPES.RECHARGE_TOPUP` — the type EVERY topUpFromSupplier/
  // topUpApp/topUpFromPartner/topUpFromClient call produces, iPick and Katsh
  // included — is listed in `NON_REVERSIBLE_TRANSACTION_TYPES`
  // (constants/transactionTypes.ts) with the documented rationale "the
  // provider-drawer credit has no payments row either", which still holds
  // here: this method moves the OMT_App/iPick/Katsh drawer via a bare
  // `applyDrawerDelta` call, never a `payments` row. No iPick/Katsh/OMT App
  // credit top-up is voidable today — `_assertReversible`
  // (TransactionRepository.ts) refuses ANY row of this type before any
  // write. Verified by reading, not assumed.
  //
  // Making this reversible would mean either (a) rewriting
  // `topUpFromSupplier` to post a real `payments` row for every provider and
  // removing `RECHARGE_TOPUP` from `NON_REVERSIBLE_TRANSACTION_TYPES` — a
  // cross-cutting change touching every top-up flow, not just OMT App — or
  // (b) a narrower OMT-App-only carve-out. Neither is done here: it is a
  // real design decision for the owner, not a silent side effect of this
  // ticket. This test instead PINS the current (unchanged) behaviour so a
  // future change to it is deliberate, not accidental.
  it("REGRESSION GUARD: an OMT App credit top-up is NOT voidable today (RECHARGE_TOPUP is non-reversible)", () => {
    const result = repo.topUpFromSupplier({
      provider: "OMT_APP",
      amount: 100,
      currency: "USD",
      userId: 1,
    });
    expect(result.success).toBe(true);

    const txn = db
      .prepare(`SELECT id FROM transactions WHERE type = 'RECHARGE_TOPUP'`)
      .get() as { id: number };

    expect(() => getTransactionRepository().voidTransaction(txn.id, 1)).toThrow();
  });
});

describe("TOP_UP_PROVIDER_DEFAULT_SOURCES.OMT_APP (LIRA-190, D2/D4)", () => {
  it("no longer defaults the OMT App drawer-transfer path to OMT_System", () => {
    // The transfer path (topUpApp) is the explicit ALTERNATIVE to credit —
    // it must no longer silently drain the OMT Cash Drawer by default.
    expect(TOP_UP_PROVIDER_DEFAULT_SOURCES.OMT_APP).not.toBe("OMT_System");
    expect(TOP_UP_PROVIDER_DEFAULT_SOURCES.OMT_APP).toBe("General");
  });
});
