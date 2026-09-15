/**
 * LIRA-193 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §11.4) — a live money leak in
 * shipped code, found while hardening `settleAccount` (LIRA-189) but
 * deliberately left unfixed there to avoid widening that ticket's scope.
 *
 * Two shipped methods accepted payment legs and moved drawers WITHOUT ever
 * comparing those legs to the amount they record as settled/paid, and both
 * silently skipped legs whose method moves no drawer:
 *
 *   - `settleTransactions` (the single-supplier settlement in daily use)
 *     never reconciled `data.payments` against `amount_usd`/`amount_lbp` on
 *     the normal cash-owed path — it only checked "at least one leg
 *     exists" — and its posting loop silently `continue`d past any leg
 *     `isDrawerAffectingMethod` excludes (CUSTOMER_ACCOUNT, GIFT_CARD).
 *   - `recordSupplierCashflow` has NO separate target field at all — the
 *     amount it stamps on `supplier_ledger`/the unified transaction IS the
 *     sum of `data.payments` — but that sum counted EVERY leg while its own
 *     posting loop had the identical silent skip, so a non-drawer-affecting
 *     leg could inflate the recorded amount with nothing backing it.
 *
 * Both are fixed the same way `settleAccount` already was: ONE shared
 * predicate (`SupplierRepository._assertSupplierLegMovesADrawer`) decides
 * which legs count for BOTH the reconciliation/validation and the posting
 * loop, so the two can never again independently drift (rule 14). Structure
 * mirrors `SupplierRepository.accountSettlement.test.ts`'s "leg
 * reconciliation" / "non-drawer-affecting legs" describe blocks, per the
 * ticket's own instruction to copy it.
 *
 * `settleAccount` itself is NOT exercised here — it is done (LIRA-189) and
 * out of scope for this ticket.
 */

import Database from "better-sqlite3";
import { SupplierRepository } from "../SupplierRepository";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      module_key TEXT,
      provider TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      commission_entry_mode TEXT CHECK(commission_entry_mode IN ('LUMP', 'RATE')) DEFAULT 'LUMP',
      commission_rate REAL,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP', 'SALE_COST', 'PAYMENT', 'ADJUSTMENT', 'SETTLEMENT', 'CASH_PRIZE', 'SUPPLIER_PAYS_US', 'DISCOUNT')),
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
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Full column set — SupplierRepository._bookCommissionAtSettlement reads
    -- gross via getFinancialServiceRepository().findById(), which selects
    -- FinancialServiceRepository.getColumns()'s full explicit list.
    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      commission REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      paid_by TEXT DEFAULT 'CASH',
      paid_amount REAL DEFAULT NULL,
      paid_currency TEXT DEFAULT NULL,
      client_id INTEGER,
      client_name TEXT,
      reference_number TEXT,
      phone_number TEXT,
      sender_name TEXT,
      sender_phone TEXT,
      receiver_name TEXT,
      receiver_phone TEXT,
      sender_client_id INTEGER,
      receiver_client_id INTEGER,
      omt_service_type TEXT,
      omt_fee REAL DEFAULT 0,
      whish_fee REAL DEFAULT 0,
      profit_rate REAL,
      pay_fee INTEGER DEFAULT 0,
      item_key TEXT,
      note TEXT,
      is_settled INTEGER NOT NULL DEFAULT 0,
      settled_at TEXT,
      settlement_id INTEGER,
      payment_method_fee REAL DEFAULT 0,
      payment_method_fee_rate REAL,
      created_by INTEGER,
      edited_by TEXT DEFAULT NULL,
      edited_at TEXT DEFAULT NULL,
      partner_id INTEGER,
      partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR')),
      commission_model INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    -- Migration v150 (COMMISSION_AT_SETTLEMENT_PLAN.md §3) real schema.
    CREATE TABLE supplier_settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      supplier_id INTEGER NOT NULL,
      ledger_entry_id INTEGER NOT NULL UNIQUE,
      gross_usd REAL NOT NULL DEFAULT 0,
      gross_lbp REAL NOT NULL DEFAULT 0,
      commission_usd REAL NOT NULL DEFAULT 0,
      commission_lbp REAL NOT NULL DEFAULT 0,
      entry_mode TEXT NOT NULL DEFAULT 'LUMP' CHECK(entry_mode IN ('LUMP', 'RATE')),
      rate REAL,
      unit_count INTEGER,
      model INTEGER NOT NULL CHECK(model IN (0, 1)),
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE settlement_commission_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      settlement_ledger_id INTEGER NOT NULL,
      financial_service_id INTEGER NOT NULL,
      service_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      commission_usd REAL NOT NULL DEFAULT 0,
      commission_lbp REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- recordSupplierCashflow's PAY branch always calls
    -- _applyPurchaseFifoCoverage, which queries this table — must exist even
    -- though this file's scenarios never seed a row into it (0 open
    -- purchases is a legitimate, common state).
    CREATE TABLE supplier_purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      supplier_id INTEGER NOT NULL,
      total_usd REAL NOT NULL,
      paid_usd REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE transactions (
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
      device_id TEXT,
      summary TEXT,
      metadata_json TEXT,
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

    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Seed drawers. "OMT_System" starts at 500 USD so a PCD-resolved CASH
    -- leg (provider === base system "OMT") never goes negative mid-test.
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_System', 'USD', 500);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Katsh', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Katsh', 'LBP', 0);
  `);

  return db;
}

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

function seedSupplier(
  db: Database.Database,
  provider: string,
  isSystem = 0,
): number {
  const res = db
    .prepare(
      "INSERT INTO suppliers (name, provider, is_system) VALUES (?, ?, ?)",
    )
    .run(provider, provider, isSystem);
  return Number(res.lastInsertRowid);
}

function seedFs(
  db: Database.Database,
  opts: {
    provider: string;
    serviceType?: string;
    amount: number;
    currency?: string;
    commission?: number;
    commissionModel?: 0 | 1;
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO financial_services
         (provider, service_type, amount, currency, commission, commission_model, is_settled)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(
      opts.provider,
      opts.serviceType ?? "RECEIVE",
      opts.amount,
      opts.currency ?? "USD",
      opts.commission ?? 0,
      opts.commissionModel ?? 0,
    );
  return Number(res.lastInsertRowid);
}

function drawerBalance(
  db: Database.Database,
  drawerName: string,
  currencyCode: string,
): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(drawerName, currencyCode) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function ledgerRow(
  db: Database.Database,
  id: number,
): {
  amount_usd: number;
  amount_lbp: number;
  entry_type: string;
  supplier_id: number;
} {
  return db
    .prepare(
      `SELECT amount_usd, amount_lbp, entry_type, supplier_id FROM supplier_ledger WHERE id = ?`,
    )
    .get(id) as {
    amount_usd: number;
    amount_lbp: number;
    entry_type: string;
    supplier_id: number;
  };
}

function ledgerCount(db: Database.Database): number {
  return (
    db.prepare("SELECT COUNT(*) as cnt FROM supplier_ledger").get() as {
      cnt: number;
    }
  ).cnt;
}

// ─────────────────────────────────────────────────────────────────────────
describe("SupplierRepository.settleTransactions() — leg reconciliation (LIRA-193)", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    repo = new SupplierRepository();
  });

  afterEach(() => {
    db.close();
  });

  describe("leg reconciliation", () => {
    it("rejects an overpaid CASH leg — legs must equal the net amount owed, not just be accepted verbatim", () => {
      const supplierId = seedSupplier(db, "Katsh");
      const fsId = seedFs(db, { provider: "Katsh", amount: 100 });
      const preDrawer = drawerBalance(db, "General", "USD");

      expect(() =>
        repo.settleTransactions({
          supplier_id: supplierId,
          financial_service_ids: [fsId],
          amount_usd: 100,
          amount_lbp: 0,
          commission_usd: 0,
          commission_lbp: 0,
          created_by: 1,
          // A $100 debt "settled" with a $150 CASH leg — the pre-fix bug:
          // the $50 difference would leave the drawer with no ledger row,
          // no profit stamp, and no kept-change record.
          payments: [{ method: "CASH", currency_code: "USD", amount: 150 }],
        }),
      ).toThrow(/do not reconcile/i);

      // Nothing moved — rejected before the write transaction ever opened.
      expect(ledgerCount(db)).toBe(0);
      expect(drawerBalance(db, "General", "USD")).toBeCloseTo(preDrawer);
      const fsRow = db
        .prepare(`SELECT is_settled FROM financial_services WHERE id = ?`)
        .get(fsId) as { is_settled: number };
      expect(fsRow.is_settled).toBe(0);
    });

    it("rejects an underpaid CASH leg — a partial tender is not silently accepted as a full settlement", () => {
      const supplierId = seedSupplier(db, "Katsh");
      const fsId = seedFs(db, { provider: "Katsh", amount: 100 });
      const preDrawer = drawerBalance(db, "General", "USD");

      expect(() =>
        repo.settleTransactions({
          supplier_id: supplierId,
          financial_service_ids: [fsId],
          amount_usd: 100,
          amount_lbp: 0,
          commission_usd: 0,
          commission_lbp: 0,
          created_by: 1,
          payments: [{ method: "CASH", currency_code: "USD", amount: 60 }],
        }),
      ).toThrow(/do not reconcile/i);

      expect(ledgerCount(db)).toBe(0);
      expect(drawerBalance(db, "General", "USD")).toBeCloseTo(preDrawer);
    });

    it("rejects when only the LBP side of a mixed-currency batch fails to reconcile — checked per currency, not aggregated", () => {
      const supplierId = seedSupplier(db, "Katsh");
      const fsId = seedFs(db, {
        provider: "Katsh",
        amount: 50,
        currency: "USD",
      });
      const preDrawerUsd = drawerBalance(db, "General", "USD");
      const preDrawerLbp = drawerBalance(db, "General", "LBP");

      expect(() =>
        repo.settleTransactions({
          supplier_id: supplierId,
          financial_service_ids: [fsId],
          amount_usd: 50,
          amount_lbp: 100_000,
          commission_usd: 0,
          commission_lbp: 0,
          created_by: 1,
          // USD leg is exactly right; LBP leg is 50,000 over.
          payments: [
            { method: "CASH", currency_code: "USD", amount: 50 },
            { method: "CASH", currency_code: "LBP", amount: 150_000 },
          ],
        }),
      ).toThrow(/do not reconcile/i);

      expect(ledgerCount(db)).toBe(0);
      expect(drawerBalance(db, "General", "USD")).toBeCloseTo(preDrawerUsd);
      expect(drawerBalance(db, "General", "LBP")).toBeCloseTo(preDrawerLbp);
    });

    it("rejects an OUT (change) leg outright — a supplier settlement has no customer to hand change back to", () => {
      const supplierId = seedSupplier(db, "Katsh");
      const fsId = seedFs(db, { provider: "Katsh", amount: 100 });
      const preDrawer = drawerBalance(db, "General", "USD");

      expect(() =>
        repo.settleTransactions({
          supplier_id: supplierId,
          financial_service_ids: [fsId],
          amount_usd: 100,
          amount_lbp: 0,
          commission_usd: 0,
          commission_lbp: 0,
          created_by: 1,
          // Tendered $150, $50 "change" back — no code in this method has
          // ever read a leg's `direction` to honor this; rejected outright
          // instead, same as settleAccount (LIRA-189).
          payments: [
            { method: "CASH", currency_code: "USD", amount: 150 },
            {
              method: "CASH",
              currency_code: "USD",
              amount: 50,
              direction: "OUT",
            },
          ],
        }),
      ).toThrow(/does not accept OUT/i);

      expect(ledgerCount(db)).toBe(0);
      expect(drawerBalance(db, "General", "USD")).toBeCloseTo(preDrawer);
    });

    it("rejects combining a nonzero net amount owed with an Other-payment commission collection — the Other-payment legs are reserved for the commission", () => {
      const supplierId = seedSupplier(db, "Katsh");
      const fsId = seedFs(db, {
        provider: "Katsh",
        serviceType: "BILL",
        amount: 0,
        currency: "LBP",
        commissionModel: 1,
      });

      expect(() =>
        repo.settleTransactions({
          supplier_id: supplierId,
          financial_service_ids: [fsId],
          // A caller-crafted anomaly: bills-only batches are contractually
          // $0/0-owed (the principal never touches the ledger), but nothing
          // structurally stops a caller from claiming a nonzero amount_usd
          // here too — this repository is the trust boundary.
          amount_usd: 50,
          amount_lbp: 0,
          commission_usd: 0,
          commission_lbp: 20_000,
          entry_mode: "RATE",
          commission_rate: 20_000,
          commission_unit_count: 1,
          commission_collection_mode: "OTHER_PAYMENT",
          created_by: 1,
          payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
        }),
      ).toThrow(/cannot combine a nonzero net amount owed/i);

      expect(ledgerCount(db)).toBe(0);
    });
  });

  describe("non-drawer-affecting legs", () => {
    it("rejects an all-CUSTOMER_ACCOUNT leg set — the worst case, zero dollars would leave the drawer", () => {
      const supplierId = seedSupplier(db, "Katsh");
      const fsId = seedFs(db, { provider: "Katsh", amount: 100 });
      const preDrawer = drawerBalance(db, "General", "USD");

      expect(() =>
        repo.settleTransactions({
          supplier_id: supplierId,
          financial_service_ids: [fsId],
          amount_usd: 100,
          amount_lbp: 0,
          commission_usd: 0,
          commission_lbp: 0,
          created_by: 1,
          // Passes the old "at least one leg exists" check, reconciles to
          // $100 on paper — but CUSTOMER_ACCOUNT never touches a drawer.
          payments: [
            { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 100 },
          ],
        }),
      ).toThrow(/CUSTOMER_ACCOUNT.*does not move a real drawer/i);

      expect(ledgerCount(db)).toBe(0);
      expect(drawerBalance(db, "General", "USD")).toBeCloseTo(preDrawer);
      const fsRow = db
        .prepare(`SELECT is_settled FROM financial_services WHERE id = ?`)
        .get(fsId) as { is_settled: number };
      expect(fsRow.is_settled).toBe(0);
    });

    it("rejects a CASH + CUSTOMER_ACCOUNT split that reconciles cleanly on paper — the reproduced $30 leak", () => {
      const supplierId = seedSupplier(db, "Katsh");
      const fsId = seedFs(db, { provider: "Katsh", amount: 100 });
      const preDrawer = drawerBalance(db, "General", "USD");

      expect(() =>
        repo.settleTransactions({
          supplier_id: supplierId,
          financial_service_ids: [fsId],
          amount_usd: 100,
          amount_lbp: 0,
          commission_usd: 0,
          commission_lbp: 0,
          created_by: 1,
          // 70 + 30 = 100 reconciles per currency, but CUSTOMER_ACCOUNT
          // never touches a drawer — only $70 would actually leave it while
          // the ledger stamped the full $100 settled.
          payments: [
            { method: "CASH", currency_code: "USD", amount: 70 },
            { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 30 },
          ],
        }),
      ).toThrow(/CUSTOMER_ACCOUNT.*does not move a real drawer/i);

      expect(ledgerCount(db)).toBe(0);
      expect(drawerBalance(db, "General", "USD")).toBeCloseTo(preDrawer);
    });
  });

  describe("normal settlement — drawer delta equals ledger movement", () => {
    it("USD: a $100 legacy settlement debits General by exactly $100, matching the SETTLEMENT ledger row", () => {
      const supplierId = seedSupplier(db, "Katsh");
      const fsId = seedFs(db, { provider: "Katsh", amount: 100 });
      const preDrawer = drawerBalance(db, "General", "USD");

      const result = repo.settleTransactions({
        supplier_id: supplierId,
        financial_service_ids: [fsId],
        amount_usd: 100,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 100 }],
      });

      const drawerDelta = drawerBalance(db, "General", "USD") - preDrawer;
      const ledger = ledgerRow(db, result.id);
      expect(drawerDelta).toBeCloseTo(-100);
      expect(ledger.amount_usd).toBeCloseTo(-100);
      expect(ledger.entry_type).toBe("SETTLEMENT");
      // Drawer delta equals the ledger movement, exactly (rule 20's spirit).
      expect(drawerDelta).toBeCloseTo(ledger.amount_usd);
      const fsRow = db
        .prepare(`SELECT is_settled FROM financial_services WHERE id = ?`)
        .get(fsId) as { is_settled: number };
      expect(fsRow.is_settled).toBe(1);
    });

    it("LBP: a 900,000 LBP legacy settlement debits General(LBP) by exactly 900,000, matching the SETTLEMENT ledger row", () => {
      const supplierId = seedSupplier(db, "Katsh");
      const fsId = seedFs(db, {
        provider: "Katsh",
        amount: 900_000,
        currency: "LBP",
      });
      const preDrawer = drawerBalance(db, "General", "LBP");

      const result = repo.settleTransactions({
        supplier_id: supplierId,
        financial_service_ids: [fsId],
        amount_usd: 0,
        amount_lbp: 900_000,
        commission_usd: 0,
        commission_lbp: 0,
        created_by: 1,
        payments: [
          { method: "CASH", currency_code: "LBP", amount: 900_000 },
        ],
      });

      const drawerDelta = drawerBalance(db, "General", "LBP") - preDrawer;
      const ledger = ledgerRow(db, result.id);
      expect(drawerDelta).toBeCloseTo(-900_000);
      expect(ledger.amount_lbp).toBeCloseTo(-900_000);
      expect(drawerDelta).toBeCloseTo(ledger.amount_lbp);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// LIRA-193 follow-up (found + reproduced by an adversarial reviewer,
// 2026-09-15) — the ONE branch the LIRA-193 fix above did not reach: the
// Other-payment commission-reconciliation sum (`settleTransactions`) bucketed
// ANY `currency_code` that wasn't literally `"LBP"` into the USD bucket, with
// no check that it was actually `"USD"`. `_bookBillsCommissionViaPaymentLegs`'s
// posting loop then forwarded that same raw, unvalidated `currency_code`
// straight to `applyDrawerDelta` — an UPSERT (`moneyPosting.ts`) that
// silently CREATES a new `drawer_balances` row for whatever string it's
// given. A lowercase `"usd"` or a real-but-wrong currency like `"EUR"` both
// passed reconciliation and posted to a phantom `("<drawer>", "usd"/"EUR")`
// row no closing screen or report ever queries, while
// `supplier_settlements.commission_usd` and the settlement transaction's
// `profit_usd` both still recorded the money as USD collected. Fixed with
// the same shared predicate shape (`_assertSupplierLegCurrencyIsValid`,
// sibling to `_assertSupplierLegMovesADrawer`) at both the sum and the
// posting step, per rule 14.
// ─────────────────────────────────────────────────────────────────────────
describe("SupplierRepository.settleTransactions() — Other-payment commission currency validation (LIRA-193 follow-up)", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    repo = new SupplierRepository();
  });

  afterEach(() => {
    db.close();
  });

  it("rejects a lowercase 'usd' Other-payment leg — the exact case reproduced against shipped code", () => {
    const supplierId = seedSupplier(db, "Katsh", 0);
    const fsId = seedFs(db, {
      provider: "Katsh",
      serviceType: "BILL",
      amount: 0,
      currency: "USD",
      commissionModel: 1,
    });

    expect(() =>
      repo.settleTransactions({
        supplier_id: supplierId,
        financial_service_ids: [fsId],
        amount_usd: 0,
        amount_lbp: 0,
        commission_usd: 50,
        commission_lbp: 0,
        created_by: 1,
        commission_collection_mode: "OTHER_PAYMENT",
        // Before the fix: not "LBP" → silently bucketed as USD, "reconciled"
        // against the entered $50 commission, then posted verbatim to a
        // phantom ("General", "usd") drawer row.
        payments: [{ method: "CASH", currency_code: "usd", amount: 50 }],
      }),
    ).toThrow(/is not USD or LBP/i);

    // Rejected before the write transaction ever opened — nothing committed,
    // and no phantom drawer row for the mistyped currency code exists.
    expect(ledgerCount(db)).toBe(0);
    expect(drawerBalance(db, "General", "usd")).toBe(0);
    expect(drawerBalance(db, "General", "USD")).toBe(0);
    const fsRow = db
      .prepare(`SELECT is_settled FROM financial_services WHERE id = ?`)
      .get(fsId) as { is_settled: number };
    expect(fsRow.is_settled).toBe(0);
  });

  it("rejects an 'EUR' Other-payment leg — a real currency elsewhere in the app, not just a typo", () => {
    const supplierId = seedSupplier(db, "Katsh", 0);
    const fsId = seedFs(db, {
      provider: "Katsh",
      serviceType: "BILL",
      amount: 0,
      currency: "USD",
      commissionModel: 1,
    });

    expect(() =>
      repo.settleTransactions({
        supplier_id: supplierId,
        financial_service_ids: [fsId],
        amount_usd: 0,
        amount_lbp: 0,
        commission_usd: 50,
        commission_lbp: 0,
        created_by: 1,
        commission_collection_mode: "OTHER_PAYMENT",
        payments: [{ method: "CASH", currency_code: "EUR", amount: 50 }],
      }),
    ).toThrow(/is not USD or LBP/i);

    expect(ledgerCount(db)).toBe(0);
    expect(drawerBalance(db, "General", "EUR")).toBe(0);
    const fsRow = db
      .prepare(`SELECT is_settled FROM financial_services WHERE id = ?`)
      .get(fsId) as { is_settled: number };
    expect(fsRow.is_settled).toBe(0);
  });

  it("still accepts a correctly-cased USD leg for Other-payment commission — the fix must not over-tighten the legitimate path", () => {
    const supplierId = seedSupplier(db, "Katsh", 0);
    const fsId = seedFs(db, {
      provider: "Katsh",
      serviceType: "BILL",
      amount: 0,
      currency: "USD",
      commissionModel: 1,
    });
    const preDrawer = drawerBalance(db, "General", "USD");

    const result = repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [fsId],
      amount_usd: 0,
      amount_lbp: 0,
      commission_usd: 50,
      commission_lbp: 0,
      created_by: 1,
      commission_collection_mode: "OTHER_PAYMENT",
      payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
    });

    expect(drawerBalance(db, "General", "USD") - preDrawer).toBe(50);
    const fsRow = db
      .prepare(`SELECT is_settled FROM financial_services WHERE id = ?`)
      .get(fsId) as { is_settled: number };
    expect(fsRow.is_settled).toBe(1);
    expect(result.id).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("SupplierRepository.recordSupplierCashflow() — leg reconciliation (LIRA-193)", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    repo = new SupplierRepository();
  });

  afterEach(() => {
    db.close();
  });

  describe("non-drawer-affecting legs", () => {
    it("rejects an all-CUSTOMER_ACCOUNT leg set — recordSupplierCashflow has no separate target, so the SUM itself must never include a leg that can't post", () => {
      const supplierId = seedSupplier(db, "Katsh");
      const preDrawer = drawerBalance(db, "General", "USD");

      expect(() =>
        repo.recordSupplierCashflow({
          supplier_id: supplierId,
          direction: "PAY",
          created_by: 1,
          payments: [
            { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 100 },
          ],
        }),
      ).toThrow(/CUSTOMER_ACCOUNT.*does not move a real drawer/i);

      expect(ledgerCount(db)).toBe(0);
      expect(drawerBalance(db, "General", "USD")).toBeCloseTo(preDrawer);
    });

    it("rejects a CASH + CUSTOMER_ACCOUNT split — the sum would stamp $100 paid while only $70 leaves the drawer", () => {
      const supplierId = seedSupplier(db, "Katsh");
      const preDrawer = drawerBalance(db, "General", "USD");

      expect(() =>
        repo.recordSupplierCashflow({
          supplier_id: supplierId,
          direction: "PAY",
          created_by: 1,
          payments: [
            { method: "CASH", currency_code: "USD", amount: 70 },
            { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 30 },
          ],
        }),
      ).toThrow(/CUSTOMER_ACCOUNT.*does not move a real drawer/i);

      expect(ledgerCount(db)).toBe(0);
      expect(drawerBalance(db, "General", "USD")).toBeCloseTo(preDrawer);
    });
  });

  it("rejects an OUT (change) leg outright — no code in this method has ever read a leg's direction", () => {
    const supplierId = seedSupplier(db, "Katsh");
    const preDrawer = drawerBalance(db, "General", "USD");

    expect(() =>
      repo.recordSupplierCashflow({
        supplier_id: supplierId,
        direction: "PAY",
        created_by: 1,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 100 },
          {
            method: "CASH",
            currency_code: "USD",
            amount: 20,
            direction: "OUT",
          },
        ],
      }),
    ).toThrow(/does not accept OUT/i);

    expect(ledgerCount(db)).toBe(0);
    expect(drawerBalance(db, "General", "USD")).toBeCloseTo(preDrawer);
  });

  it("rejects a non-USD/LBP leg currency — the sum loop would otherwise drop it from the total while the posting loop still posted it", () => {
    const supplierId = seedSupplier(db, "Katsh");

    expect(() =>
      repo.recordSupplierCashflow({
        supplier_id: supplierId,
        direction: "PAY",
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "EUR", amount: 50 }],
      }),
    ).toThrow(/is not USD or LBP/i);

    expect(ledgerCount(db)).toBe(0);
  });

  describe("normal cashflow — drawer delta equals ledger movement", () => {
    it("PAY, USD: an $80 cash payment debits General by exactly $80, matching the PAYMENT ledger row", () => {
      const supplierId = seedSupplier(db, "Katsh");
      const preDrawer = drawerBalance(db, "General", "USD");

      const result = repo.recordSupplierCashflow({
        supplier_id: supplierId,
        direction: "PAY",
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 80 }],
      });

      const drawerDelta = drawerBalance(db, "General", "USD") - preDrawer;
      const ledger = ledgerRow(db, result.id);
      expect(drawerDelta).toBeCloseTo(-80);
      expect(ledger.amount_usd).toBeCloseTo(-80);
      expect(ledger.entry_type).toBe("PAYMENT");
      expect(drawerDelta).toBeCloseTo(ledger.amount_usd);
    });

    it("RECEIVE, LBP: a 200,000 LBP receipt credits General(LBP) by exactly 200,000, matching the SUPPLIER_PAYS_US ledger row", () => {
      const supplierId = seedSupplier(db, "Katsh");
      const preDrawer = drawerBalance(db, "General", "LBP");

      const result = repo.recordSupplierCashflow({
        supplier_id: supplierId,
        direction: "RECEIVE",
        created_by: 1,
        payments: [
          { method: "CASH", currency_code: "LBP", amount: 200_000 },
        ],
      });

      const drawerDelta = drawerBalance(db, "General", "LBP") - preDrawer;
      const ledger = ledgerRow(db, result.id);
      expect(drawerDelta).toBeCloseTo(200_000);
      expect(ledger.amount_lbp).toBeCloseTo(200_000);
      expect(ledger.entry_type).toBe("SUPPLIER_PAYS_US");
      expect(drawerDelta).toBeCloseTo(ledger.amount_lbp);
    });
  });
});
