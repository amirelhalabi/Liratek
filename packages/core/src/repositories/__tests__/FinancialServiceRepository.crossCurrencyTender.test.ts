/**
 * FinancialServiceRepository — cross-currency single-leg tender
 * (Payment-Legs Integrity plan, Wave 6 / S8 guard sweep)
 *
 * Context: four frontend forms used to gate `payments[]` on "split payment
 * only" — a single-line payment (the common case, e.g. a $10 Whish App SEND
 * tendered as 900,000 LBP cash) silently dropped amount+currency and only
 * the bare method survived. The repository's multi-leg branch was ALWAYS
 * correct; the bug lived entirely in the forms not calling it. S1 removes
 * the four gates so every form now forwards legs whenever ≥1 payment line
 * exists. This file is the core-side proof that the un-gated forms land on
 * verified ground: it pins, per SEND/RECEIVE family, what the repository
 * does with
 *   (a) a SINGLE payment leg denominated in a currency different from the
 *       service currency (the case the gates used to swallow), and
 *   (b) NO legs at all (the legacy/scripted-caller fallback that assumes
 *       tender === service currency — still correct for those callers, but
 *       no longer reachable from any UI form per S1).
 *
 * The value/tender split (owner decisions S3/S4):
 *   - The drawer physically moves in the TENDER currency (General +900,000
 *     LBP) — "book physical reality".
 *   - transactions.amount_usd/amount_lbp stamp the SERVICE VALUE, never the
 *     tender, so profit/reporting never double-count (v126 model).
 *   - The OMT/WHISH System-drawer reserve transfer is an internal accounting
 *     entry that ALWAYS runs in the service currency, regardless of what
 *     currency the customer actually handed over — no phantom FX
 *     conversion; till rebalancing is the Exchange module's job (S4).
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// ─── Mock DB connection (shared by all sub-repositories) ─────────────────────

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

// ─── Mock DebtService (unused by these cases, but imported by the repo) ──────

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

// ─── In-memory schema (mirrors appWalletTransfer + systemLedger fixtures,
//      union of drawers both need: app wallets, Binance, AND the OMT/WHISH
//      System reserve drawers) ────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, role TEXT DEFAULT 'staff');
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD' NOT NULL,
      commission REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      paid_by TEXT DEFAULT 'CASH',
      client_id INTEGER REFERENCES clients(id),
      client_name TEXT,
      reference_number TEXT,
      phone_number TEXT,
      omt_service_type TEXT,
      omt_fee REAL DEFAULT 0,
      whish_fee REAL DEFAULT 0,
      profit_rate REAL,
      pay_fee INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0,
      payment_method_fee_rate REAL,
      item_key TEXT,
      note TEXT,
      sender_name TEXT,
      sender_phone TEXT,
      receiver_name TEXT,
      receiver_phone TEXT,
      sender_client_id INTEGER,
      receiver_client_id INTEGER,
      is_settled INTEGER NOT NULL DEFAULT 1,
      settled_at TEXT,
      settlement_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      paid_amount REAL DEFAULT NULL,
      paid_currency TEXT DEFAULT NULL,
      partner_id INTEGER REFERENCES partners(id),
      partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR'))
    );

    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id INTEGER NOT NULL REFERENCES partners(id),
      transaction_type TEXT NOT NULL,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes TEXT,
      user_id INTEGER REFERENCES users(id),
      settlement_method TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
      is_active INTEGER DEFAULT 1,
      is_system INTEGER DEFAULT 0,
      module_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE system_settings (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_name TEXT NOT NULL UNIQUE,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO drawer_balances VALUES (1, 'General',      'USD',  1000,      CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General',      'LBP',  100000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_App',      'USD',  500,       CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_App',    'USD',  500,       CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Binance',      'USDT', 500,       CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System',   'USD',  500,       CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_System', 'USD',  500,       CURRENT_TIMESTAMP);
  `);

  return db;
}

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
  return row ? row.balance : 0;
}

function lastTransaction(db: Database.Database): {
  summary: string;
  amount_usd: number;
  amount_lbp: number;
  metadata_json: string;
} {
  return db
    .prepare(
      `SELECT summary, amount_usd, amount_lbp, metadata_json FROM transactions ORDER BY id DESC LIMIT 1`,
    )
    .get() as {
    summary: string;
    amount_usd: number;
    amount_lbp: number;
    metadata_json: string;
  };
}

function paymentsFor(
  db: Database.Database,
  method: string,
): Array<{ drawer_name: string; currency_code: string; amount: number }> {
  return db
    .prepare(
      `SELECT drawer_name, currency_code, amount FROM payments
       WHERE transaction_id = (SELECT id FROM transactions ORDER BY id DESC LIMIT 1)
       AND method = ?`,
    )
    .all(method) as Array<{
    drawer_name: string;
    currency_code: string;
    amount: number;
  }>;
}

describe("FinancialServiceRepository — cross-currency single-leg tender", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new FinancialServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 1. WHISH_APP SEND — the reported bug's exact shape (a $10 transfer
  //    tendered as 900,000 LBP cash). This is the class's mechanism, pinned.
  // ═══════════════════════════════════════════════════════════════════════
  describe("WHISH_APP SEND", () => {
    it("with a single LBP leg: General +900,000 LBP, ZERO USD; wallet drawer debited in the SERVICE currency", () => {
      const genUsdBefore = balance(db, "General", "USD");
      const genLbpBefore = balance(db, "General", "LBP");
      const appBefore = balance(db, "Whish_App", "USD");

      repo.createTransaction({
        provider: "WHISH_APP",
        serviceType: "SEND",
        amount: 10,
        currency: "USD",
        commission: 0,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 900000 }],
        exchangeRate: 90000,
      });

      // General moves in the TENDER currency only — no phantom USD leg.
      expect(balance(db, "General", "LBP")).toBeCloseTo(
        genLbpBefore + 900000,
        2,
      );
      expect(balance(db, "General", "USD")).toBeCloseTo(genUsdBefore, 2);
      // Wallet drawer always tracks the SERVICE currency (USD), regardless
      // of tender.
      expect(balance(db, "Whish_App", "USD")).toBeCloseTo(appBefore - 10, 2);

      // The payments row carries the REAL tender leg.
      const cashLegs = paymentsFor(db, "CASH");
      expect(cashLegs).toEqual([
        { drawer_name: "General", currency_code: "LBP", amount: 900000 },
      ]);

      // Value-not-tender model: amount_usd/lbp stamp the SERVICE VALUE
      // ($10), never the tender — profit/reporting never double-count.
      const txn = lastTransaction(db);
      expect(txn.amount_usd).toBeCloseTo(10, 2);
      expect(txn.amount_lbp).toBe(0);

      // Tender-first display (S3): the summary still surfaces the real
      // tender alongside the value line. The exact "(paid …)" formatting is
      // Wave 8's territory (S3 display verification) — assert only that the
      // value line is present and locale-free, not the full formatted
      // string (`.toLocaleString()` output is environment-dependent).
      expect(txn.summary).toContain("10 USD");
      const meta = JSON.parse(txn.metadata_json) as {
        paid_amount: number;
        paid_currency: string;
      };
      expect(meta.paid_amount).toBe(900000);
      expect(meta.paid_currency).toBe("LBP");
    });

    it("FALLBACK — with NO legs at all: General +$10 USD (tender assumed = service currency)", () => {
      // Legacy-caller fallback: this is the exact assumption the removed UI
      // gates used to force every single-line payment through (only the
      // method survived; amount+currency were dropped). Un-gated forms (S1)
      // never hit this branch anymore — it remains correct ONLY for
      // legacy/scripted callers that pass paidByMethod with no payments[].
      const genUsdBefore = balance(db, "General", "USD");
      const genLbpBefore = balance(db, "General", "LBP");
      const appBefore = balance(db, "Whish_App", "USD");

      repo.createTransaction({
        provider: "WHISH_APP",
        serviceType: "SEND",
        amount: 10,
        currency: "USD",
        commission: 0,
        paidByMethod: "CASH",
        exchangeRate: 90000,
      });

      expect(balance(db, "General", "USD")).toBeCloseTo(genUsdBefore + 10, 2);
      expect(balance(db, "General", "LBP")).toBeCloseTo(genLbpBefore, 2);
      expect(balance(db, "Whish_App", "USD")).toBeCloseTo(appBefore - 10, 2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. OMT_APP SEND — same app-wallet mechanism, different provider.
  // ═══════════════════════════════════════════════════════════════════════
  describe("OMT_APP SEND", () => {
    it("with a single LBP leg: General +1,800,000 LBP, ZERO USD; OMT_App debited in USD", () => {
      const genUsdBefore = balance(db, "General", "USD");
      const genLbpBefore = balance(db, "General", "LBP");
      const appBefore = balance(db, "OMT_App", "USD");

      repo.createTransaction({
        provider: "OMT_APP",
        serviceType: "SEND",
        amount: 20,
        currency: "USD",
        commission: 0,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 1800000 }],
        exchangeRate: 90000,
      });

      expect(balance(db, "General", "LBP")).toBeCloseTo(
        genLbpBefore + 1800000,
        2,
      );
      expect(balance(db, "General", "USD")).toBeCloseTo(genUsdBefore, 2);
      expect(balance(db, "OMT_App", "USD")).toBeCloseTo(appBefore - 20, 2);

      const txn = lastTransaction(db);
      expect(txn.amount_usd).toBeCloseTo(20, 2); // value stamp, not tender
      expect(txn.amount_lbp).toBe(0);
    });

    it("FALLBACK — with NO legs at all: General +$20 USD (tender assumed = service currency)", () => {
      const genUsdBefore = balance(db, "General", "USD");
      const appBefore = balance(db, "OMT_App", "USD");

      repo.createTransaction({
        provider: "OMT_APP",
        serviceType: "SEND",
        amount: 20,
        currency: "USD",
        commission: 0,
        paidByMethod: "CASH",
        exchangeRate: 90000,
      });

      expect(balance(db, "General", "USD")).toBeCloseTo(genUsdBefore + 20, 2);
      expect(balance(db, "OMT_App", "USD")).toBeCloseTo(appBefore - 20, 2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. BINANCE SEND (crypto) — the wallet leg is ALWAYS USDT regardless of
  //    `currency`; the cash leg follows the payment-leg currency.
  // ═══════════════════════════════════════════════════════════════════════
  describe("BINANCE SEND", () => {
    it("with a single LBP leg: General +1,800,000 LBP, ZERO USD; Binance drawer debited in USDT", () => {
      const genUsdBefore = balance(db, "General", "USD");
      const genLbpBefore = balance(db, "General", "LBP");
      const binBefore = balance(db, "Binance", "USDT");

      repo.createTransaction({
        provider: "BINANCE",
        serviceType: "SEND",
        amount: 20,
        currency: "USDT",
        commission: 0,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 1800000 }],
        exchangeRate: 90000,
      });

      expect(balance(db, "General", "LBP")).toBeCloseTo(
        genLbpBefore + 1800000,
        2,
      );
      expect(balance(db, "General", "USD")).toBeCloseTo(genUsdBefore, 2);
      expect(balance(db, "Binance", "USDT")).toBeCloseTo(binBefore - 20, 2);

      const cashLegs = paymentsFor(db, "CASH");
      expect(cashLegs).toEqual([
        { drawer_name: "General", currency_code: "LBP", amount: 1800000 },
      ]);
    });

    it("FALLBACK — with NO legs at all: General +$20 USD (Binance's crypto currency, USDT, can never be the cash leg — the fallback defaults to USD, not `currency`)", () => {
      // Control, already covered by
      // FinancialServiceRepository.appWalletTransfer.test.ts's "BINANCE
      // control" case — repeated here so the provider matrix in this file
      // is self-contained.
      const genUsdBefore = balance(db, "General", "USD");
      const binBefore = balance(db, "Binance", "USDT");

      repo.createTransaction({
        provider: "BINANCE",
        serviceType: "SEND",
        amount: 20,
        currency: "USDT",
        commission: 0,
        paidByMethod: "CASH",
        exchangeRate: 90000,
      });

      expect(balance(db, "General", "USD")).toBeCloseTo(genUsdBefore + 20, 2);
      expect(balance(db, "Binance", "USDT")).toBeCloseTo(binBefore - 20, 2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. OMT SYSTEM SEND (the Services page flow) — includes the reserve
  //    transfer to *_System. Owner decision S4: the reserve legs are
  //    UNCHANGED by tender currency (booked in the service currency always).
  // ═══════════════════════════════════════════════════════════════════════
  describe("OMT SYSTEM SEND (reserve transfer)", () => {
    it("with a single LBP leg: General +900,000 LBP (tender), ZERO USD (no reserve); OMT_System −$10 USD (float drawn down)", () => {
      const genUsdBefore = balance(db, "General", "USD");
      const genLbpBefore = balance(db, "General", "LBP");
      const systemBefore = balance(db, "OMT_System", "USD");

      repo.createTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 10,
        currency: "USD",
        commission: 0,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 900000 }],
        exchangeRate: 90000,
      });

      // Physical reality: the customer's LBP cash lands in General.
      // Float model: the RESERVE leg is gone entirely — General never had a
      // USD leg to begin with (the customer's only leg was LBP), so USD is
      // untouched. The float posting now happens directly on OMT_System
      // (−sentAmount, fee-on-top; f=0 here), never on General.
      expect(balance(db, "General", "LBP")).toBeCloseTo(
        genLbpBefore + 900000,
        2,
      );
      // float model: the SEND cash reserve is gone — General no longer
      // reserves a USD leg to fund the float transfer.
      // rule 17: proven failing-first 2026-07-30 — restoring the deleted
      // `RESERVE -totalCollected` insertPayment/upsertBalanceDelta pair off
      // General makes this red (General USD read 990 instead of 1000).
      expect(balance(db, "General", "USD")).toBeCloseTo(genUsdBefore, 2);
      // float model: SEND draws the float down by the bare principal (x),
      // it no longer builds a gross reserve.
      // rule 17: proven failing-first 2026-07-30 — flipping the sign back to
      // `+totalCollected` (the old systemDrawerCredit) makes this red
      // (OMT_System read 510 instead of 490).
      expect(balance(db, "OMT_System", "USD")).toBeCloseTo(
        systemBefore - 10,
        2,
      );

      // The tender leg is still visible on the payments ledger.
      const cashLegs = paymentsFor(db, "CASH");
      expect(cashLegs).toEqual(
        expect.arrayContaining([
          { drawer_name: "General", currency_code: "LBP", amount: 900000 },
        ]),
      );
      // the SEND cash reserve is gone: no RESERVE-method payment row is ever
      // written anymore (insertPayment.run(..., systemDrawer, ...) below
      // tags the float leg with `data.provider`, e.g. "OMT", not "RESERVE").
      // rule 17: proven failing-first 2026-07-30 — reintroducing the deleted
      // RESERVE insertPayment call off General makes this red (isolation run
      // with the two assertions above neutralized: reserveLegs came back
      // with the restored `{General, USD, -10}` row instead of `[]`).
      const reserveLegs = paymentsFor(db, "RESERVE");
      expect(reserveLegs).toEqual([]);

      // Value-not-tender model holds here too: the unified transaction
      // stamps the SERVICE value, uniform with the app-wallet families above.
      const txn = lastTransaction(db);
      expect(txn.amount_usd).toBeCloseTo(10, 2);
      expect(txn.amount_lbp).toBe(0);
    });

    it("WHISH variant: the SAME float mechanism applies to WHISH (isSystemProvider = isOMT || WHISH shares one branch) — General +900,000 LBP, ZERO USD; Whish_System −$10 USD", () => {
      // A stale comment above this flow (FinancialServiceRepository.ts:1380-
      // 1381) describes WHISH as a "2-drawer" flow that never touches
      // General — the code does NOT special-case WHISH that way; both
      // providers run through the identical isSystemProvider branch. This
      // test pins the actual (shared) behavior so a future "fix" aligning
      // the code to the stale comment gets caught here.
      //
      // Float model addendum: a walk-in (no partnerId) transaction on the
      // SECONDARY provider (provider !== shop_base_system) is now REJECTED
      // outright (orchestrator default, 2026-07-29 — see
      // FinancialServiceRepository.ts's walk-in-secondary-provider guard,
      // right after isThroughPartner/isForPartner). This test's own intent
      // is to pin WHISH sharing OMT's system-float branch, not to exercise
      // partner routing, so we seed `shop_base_system=WHISH` to make WHISH
      // the PRIMARY provider for this test — sidestepping the new guard
      // without diluting what the test is actually checking.
      db.exec(
        `INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'WHISH')`,
      );

      const genUsdBefore = balance(db, "General", "USD");
      const genLbpBefore = balance(db, "General", "LBP");
      const systemBefore = balance(db, "Whish_System", "USD");

      repo.createTransaction({
        provider: "WHISH",
        serviceType: "SEND",
        amount: 10,
        currency: "USD",
        commission: 0, // WHISH SEND commission is forced to 0 regardless
        whishFee: 0, // suppress the WHISH_FEE_TIERS auto-lookup (unrelated to this test)
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 900000 }],
        exchangeRate: 90000,
      });

      expect(balance(db, "General", "LBP")).toBeCloseTo(
        genLbpBefore + 900000,
        2,
      );
      // float model: the SEND cash reserve is gone — General no longer
      // reserves a USD leg (mirrors the OMT case above).
      // rule 17: proven failing-first 2026-07-30 — restoring the deleted
      // RESERVE leg off General makes this red (General USD read 990
      // instead of 1000).
      expect(balance(db, "General", "USD")).toBeCloseTo(genUsdBefore, 2);
      // float model: SEND draws the float down by the bare principal (x).
      // rule 17: proven failing-first 2026-07-30 — flipping the sign back to
      // `+totalCollected` makes this red (Whish_System read 510 instead of
      // 490).
      expect(balance(db, "Whish_System", "USD")).toBeCloseTo(
        systemBefore - 10,
        2,
      );
    });

    it("FALLBACK — with NO legs at all: General +$10 USD (cash stays, no reserve); OMT_System −$10 USD", () => {
      const genUsdBefore = balance(db, "General", "USD");
      const genLbpBefore = balance(db, "General", "LBP");
      const systemBefore = balance(db, "OMT_System", "USD");

      repo.createTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 10,
        currency: "USD",
        commission: 0,
        paidByMethod: "CASH",
        exchangeRate: 90000,
      });

      // float model: the SEND cash reserve is gone — General keeps the
      // customer's +$10 cash-in permanently; there is no longer a RESERVE
      // leg to zero it back out (that RESERVE/net-to-0 dance was the root
      // cause the float-model fix removes).
      // rule 17: proven failing-first 2026-07-30 — restoring the deleted
      // RESERVE leg off General (net General back to `genUsdBefore`) makes
      // this red (General USD read 1000 instead of 1010).
      expect(balance(db, "General", "USD")).toBeCloseTo(genUsdBefore + 10, 2);
      expect(balance(db, "General", "LBP")).toBeCloseTo(genLbpBefore, 2);
      // float model: SEND draws the float down by the bare principal (x).
      // rule 17: proven failing-first 2026-07-30 — flipping the sign back to
      // `+totalCollected` makes this red (OMT_System read 510 instead of
      // 490).
      expect(balance(db, "OMT_System", "USD")).toBeCloseTo(
        systemBefore - 10,
        2,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. RECEIVE spot-check — OMT RECEIVE cashed out in LBP for a USD service.
  //    The payout leg must book in ITS OWN currency (already correct code,
  //    per FinancialServiceRepository.ts:2199-2220 — pinned here as new
  //    coverage: every existing RECEIVE test in this suite either payouts
  //    same-currency or splits across BOTH currencies, never a pure
  //    single-leg cross-currency payout).
  // ═══════════════════════════════════════════════════════════════════════
  describe("OMT RECEIVE — cross-currency cashout", () => {
    it("$100 USD service cashed out as a single 9,000,000 LBP leg: General −9,000,000 LBP, ZERO USD; OMT_System debited in USD (service currency)", () => {
      const genUsdBefore = balance(db, "General", "USD");
      const genLbpBefore = balance(db, "General", "LBP");
      const systemBefore = balance(db, "OMT_System", "USD");

      repo.createTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 0,
        cashoutMethod: "CASH",
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 9000000 }],
        exchangeRate: 90000,
      });

      expect(balance(db, "General", "LBP")).toBeCloseTo(
        genLbpBefore - 9000000,
        2,
      );
      expect(balance(db, "General", "USD")).toBeCloseTo(genUsdBefore, 2);
      // The System drawer tracks the shop's float, always in the SERVICE
      // currency, unaffected by the payout tender.
      // float model: RECEIVE fills the float back up by the bare principal
      // (x) — the old model drew it down by totalOwed (principal+commission
      // is 0 here, so the magnitude happens to match, but the sign flips).
      // rule 17: proven failing-first 2026-07-30 — flipping the sign back to
      // `-totalOwed` (the old posting) makes this red (OMT_System read 400
      // instead of 600).
      expect(balance(db, "OMT_System", "USD")).toBeCloseTo(
        systemBefore + 100,
        2,
      );

      // Value-not-tender model holds for RECEIVE too.
      const txn = lastTransaction(db);
      expect(txn.amount_usd).toBeCloseTo(100, 2);
      expect(txn.amount_lbp).toBe(0);
    });
  });
});
