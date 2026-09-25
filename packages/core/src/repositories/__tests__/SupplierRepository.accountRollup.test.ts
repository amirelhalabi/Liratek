/**
 * SupplierRepository — OMT open-credit account rollup (LIRA-187/188)
 *
 * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §1/§2/§9.3: OMT is ONE open-credit
 * account. The counter (`'OMT'`), the OMT App wallet (`'OMT App'`), and
 * iPick credit all draw on it, linked via the self-FK
 * `suppliers.account_supplier_id` (migration v176). Ledger rows never
 * move — each child keeps its own `supplier_ledger` rows; the account is a
 * READ-TIME rollup (`getAccountBalances`/`getAccountLedger`/
 * `getAccountUnsettled`).
 *
 * This file is STRUCTURALLY INSULATED from LIRA-189 (account settlement,
 * wave 2 — not built yet): every "unsettled" assertion below only proves
 * the read-side union, never a settlement write.
 *
 * DO NOT RUN — written per the multi-agent build contract's lane
 * discipline (owner's standing check cadence: nothing runs until the whole
 * batch — including LANE L1's migration — is implemented). The in-memory
 * schema below hand-mirrors what migration v176 adds
 * (`suppliers.account_supplier_id`, `supplier_ledger.settlement_id`) rather
 * than running the real migration.
 */

import Database from "better-sqlite3";
import { SupplierRepository } from "../SupplierRepository";
import { resetFinancialServiceRepository } from "../FinancialServiceRepository";

// ─── Mock DB connection (shared by SupplierRepository AND the real
//     FinancialServiceRepository getAccountUnsettled() calls into) ──────────

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

// FinancialServiceRepository.ts imports DebtService at module scope (used by
// unrelated write paths this file never exercises) — mocked the same way
// TransactionRepository.supplierSiblingVoidCascade.test.ts does so the
// module-level import resolves without a real DB.
jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

// ─── Minimal in-memory schema ─────────────────────────────────────────────

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
      account_supplier_id INTEGER REFERENCES suppliers(id),
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP', 'SALE_COST', 'PAYMENT', 'ADJUSTMENT', 'SETTLEMENT', 'CASH_PRIZE', 'SUPPLIER_PAYS_US', 'DISCOUNT', 'STOCK_INTAKE')),
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at DATETIME,
      source_ref_table TEXT,
      source_ref_id INTEGER,
      settlement_id INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
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
      client_id INTEGER,
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
      is_settled INTEGER NOT NULL DEFAULT 0,
      settled_at TEXT,
      settlement_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      edited_by INTEGER,
      edited_at DATETIME,
      paid_amount REAL DEFAULT NULL,
      paid_currency TEXT DEFAULT NULL,
      partner_id INTEGER,
      partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR')),
      commission_model INTEGER NOT NULL DEFAULT 0,
      receive_fee_model INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE service_providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      is_system_provider INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE system_settings (
      key_name TEXT NOT NULL,
      value TEXT,
      tenant_id INTEGER DEFAULT 1,
      PRIMARY KEY (tenant_id, key_name)
    );
  `);

  return db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function seedSupplier(
  db: Database.Database,
  data: {
    name: string;
    provider?: string | null;
    accountSupplierId?: number | null;
    isSystem?: number;
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO suppliers (name, provider, account_supplier_id, is_system)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      data.name,
      data.provider ?? null,
      data.accountSupplierId ?? null,
      data.isSystem ?? 0,
    );
  return Number(res.lastInsertRowid);
}

function seedLedgerEntry(
  db: Database.Database,
  data: {
    supplierId: number;
    entryType: string;
    amountUsd?: number;
    amountLbp?: number;
    isRefunded?: number;
    settlementId?: number | null;
    sourceRefTable?: string | null;
    sourceRefId?: number | null;
    createdAt?: string;
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO supplier_ledger
         (supplier_id, entry_type, amount_usd, amount_lbp, is_refunded, settlement_id, source_ref_table, source_ref_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
    )
    .run(
      data.supplierId,
      data.entryType,
      data.amountUsd ?? 0,
      data.amountLbp ?? 0,
      data.isRefunded ?? 0,
      data.settlementId ?? null,
      data.sourceRefTable ?? null,
      data.sourceRefId ?? null,
      data.createdAt ?? null,
    );
  return Number(res.lastInsertRowid);
}

function seedFinancialService(
  db: Database.Database,
  data: {
    provider: string;
    serviceType: string;
    amount: number;
    currency?: string;
    commissionModel?: number;
    omtFee?: number;
    isSettled?: number;
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO financial_services
         (provider, service_type, amount, currency, commission_model, omt_fee, is_settled)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      data.provider,
      data.serviceType,
      data.amount,
      data.currency ?? "USD",
      data.commissionModel ?? 0,
      data.omtFee ?? 0,
      data.isSettled ?? 0,
    );
  return Number(res.lastInsertRowid);
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("SupplierRepository — OMT open-credit account rollup", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    repo = new SupplierRepository();
    resetFinancialServiceRepository();
  });

  afterEach(() => {
    db.close();
    resetFinancialServiceRepository();
  });

  describe("getAccountBalances()", () => {
    it("rolls up the parent and every child, summed per currency", () => {
      const omtId = seedSupplier(db, {
        name: "OMT",
        provider: "OMT",
        isSystem: 1,
      });
      const appId = seedSupplier(db, {
        name: "OMT App",
        provider: "OMT_APP",
        accountSupplierId: omtId,
      });
      const ipickId = seedSupplier(db, {
        name: "iPick",
        provider: "iPick",
        accountSupplierId: omtId,
      });

      seedLedgerEntry(db, {
        supplierId: omtId,
        entryType: "TOP_UP",
        amountUsd: 1050,
      });
      seedLedgerEntry(db, {
        supplierId: appId,
        entryType: "TOP_UP",
        amountUsd: 200,
      });
      seedLedgerEntry(db, {
        supplierId: ipickId,
        entryType: "TOP_UP",
        amountLbp: 500000,
      });

      const accounts = repo.getAccountBalances();
      expect(accounts).toHaveLength(1);
      const [account] = accounts;
      expect(account.account_supplier_id).toBe(omtId);
      expect(account.account_name).toBe("OMT");
      // Worked example, plan §4: parent + children, summed per currency.
      expect(account.total_usd).toBeCloseTo(1250);
      expect(account.total_lbp).toBeCloseTo(500000);
      expect(account.children).toHaveLength(3);

      const parentRow = account.children.find((c) => c.is_parent);
      expect(parentRow?.supplier_id).toBe(omtId);
      expect(parentRow?.total_usd).toBeCloseTo(1050);

      const appRow = account.children.find((c) => c.supplier_id === appId);
      expect(appRow?.is_parent).toBe(false);
      expect(appRow?.total_usd).toBeCloseTo(200);

      const ipickRow = account.children.find(
        (c) => c.supplier_id === ipickId,
      );
      expect(ipickRow?.total_lbp).toBeCloseTo(500000);
    });

    it("returns [] for a tenant whose OMT supplier has no children yet", () => {
      seedSupplier(db, { name: "OMT", provider: "OMT", isSystem: 1 });
      expect(repo.getAccountBalances()).toEqual([]);
    });

    it("resolves drawer_name from service_providers, never a hardcoded map", () => {
      const omtId = seedSupplier(db, {
        name: "OMT",
        provider: "OMT",
        isSystem: 1,
      });
      const appId = seedSupplier(db, {
        name: "OMT App",
        provider: "OMT_APP",
        accountSupplierId: omtId,
      });
      db.prepare(
        `INSERT INTO service_providers (code, label, drawer_name) VALUES ('OMT_APP', 'OMT App', 'OMT_App')`,
      ).run();

      const [account] = repo.getAccountBalances();
      const appRow = account.children.find((c) => c.supplier_id === appId);
      expect(appRow?.drawer_name).toBe("OMT_App");
    });
  });

  describe("getSupplierBalances() — LIRA-188 child exclusion", () => {
    it("drops account children but keeps the parent and standalone suppliers (Katsh unaffected)", () => {
      const omtId = seedSupplier(db, {
        name: "OMT",
        provider: "OMT",
        isSystem: 1,
      });
      const appId = seedSupplier(db, {
        name: "OMT App",
        provider: "OMT_APP",
        accountSupplierId: omtId,
      });
      const katshId = seedSupplier(db, { name: "Katsh", provider: "Katsh" });

      seedLedgerEntry(db, {
        supplierId: omtId,
        entryType: "TOP_UP",
        amountUsd: 100,
      });
      seedLedgerEntry(db, {
        supplierId: appId,
        entryType: "TOP_UP",
        amountUsd: 200,
      });
      seedLedgerEntry(db, {
        supplierId: katshId,
        entryType: "TOP_UP",
        amountUsd: 300,
      });

      const balances = repo.getSupplierBalances();
      const ids = balances.map((b) => b.supplier_id);
      expect(ids).toContain(omtId);
      expect(ids).toContain(katshId);
      expect(ids).not.toContain(appId);
    });
  });

  describe("getAccountLedger()", () => {
    it("unions parent + children rows, newest first, carrying the right Type/source_name", () => {
      const omtId = seedSupplier(db, {
        name: "OMT",
        provider: "OMT",
        isSystem: 1,
      });
      const ipickId = seedSupplier(db, {
        name: "iPick",
        provider: "iPick",
        accountSupplierId: omtId,
      });

      seedLedgerEntry(db, {
        supplierId: omtId,
        entryType: "TOP_UP",
        amountUsd: 1050,
        createdAt: "2026-01-01 10:00:00",
      });
      seedLedgerEntry(db, {
        supplierId: ipickId,
        entryType: "TOP_UP",
        amountUsd: 200,
        createdAt: "2026-01-02 10:00:00",
      });

      const ledger = repo.getAccountLedger(omtId);
      expect(ledger).toHaveLength(2);
      expect(ledger[0].source_name).toBe("iPick"); // newest first
      expect(ledger[0].source_provider).toBe("iPick");
      expect(ledger[1].source_name).toBe("OMT");
    });

    it("includes refunded/voided rows, carrying is_refunded so the UI can badge them (matches getSupplierLedger's precedent — the ledger is a history view, unlike getAccountBalances)", () => {
      const omtId = seedSupplier(db, {
        name: "OMT",
        provider: "OMT",
        isSystem: 1,
      });
      seedSupplier(db, {
        name: "iPick",
        provider: "iPick",
        accountSupplierId: omtId,
      });
      seedLedgerEntry(db, {
        supplierId: omtId,
        entryType: "TOP_UP",
        amountUsd: 100,
        isRefunded: 1,
      });

      const ledger = repo.getAccountLedger(omtId);
      expect(ledger).toHaveLength(1);
      expect(ledger[0].is_refunded).toBe(1);
    });

    it("returns [] for an id that isn't a linked account (no children point at it)", () => {
      const standaloneId = seedSupplier(db, {
        name: "Katsh",
        provider: "Katsh",
      });
      seedLedgerEntry(db, {
        supplierId: standaloneId,
        entryType: "TOP_UP",
        amountUsd: 50,
      });
      // accountMemberOf still matches the id itself (s.id = ?), so a
      // standalone supplier's OWN ledger is still readable through this
      // method — it just never picks up anyone else's rows.
      const ledger = repo.getAccountLedger(standaloneId);
      expect(ledger).toHaveLength(1);
      expect(ledger[0].source_name).toBe("Katsh");
    });
  });

  describe("getAccountUnsettled()", () => {
    it("unions financial_services rows (kind a) and raw ledger rows (kind b) without double-counting the counter's own auto sibling", () => {
      const omtId = seedSupplier(db, {
        name: "OMT",
        provider: "OMT",
        isSystem: 1,
      });
      const ipickId = seedSupplier(db, {
        name: "iPick",
        provider: "iPick",
        accountSupplierId: omtId,
      });

      // Kind (a): an OMT counter SEND, pending settlement
      // (commission_model = 1, isOmtWhishTransfer — FinancialServiceRepository.ts).
      const fsId = seedFinancialService(db, {
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        commissionModel: 1,
        omtFee: 5,
      });
      // Its auto ledger sibling (LIRA-091: source_ref_table =
      // 'financial_services') — already represented by the fs row above;
      // MUST NOT also surface as a kind (b) row (would double the counter's
      // debt in the account queue).
      seedLedgerEntry(db, {
        supplierId: omtId,
        entryType: "TOP_UP",
        amountUsd: 105,
        sourceRefTable: "financial_services",
        sourceRefId: fsId,
      });

      // Kind (b): iPick's own supplier-credit top-up — no financial_services
      // row exists for this at all (RechargeRepository.topUpFromSupplier
      // link-mode).
      seedLedgerEntry(db, {
        supplierId: ipickId,
        entryType: "TOP_UP",
        amountUsd: 200,
      });

      const unsettled = repo.getAccountUnsettled(omtId);
      expect(unsettled).toHaveLength(2);

      const fsRow = unsettled.find((r) => r.kind === "FINANCIAL_SERVICE");
      expect(fsRow?.id).toBe(fsId);
      expect(fsRow?.source_name).toBe("OMT");
      expect(fsRow?.amount_usd).toBeCloseTo(105); // SUPPLIER_OWED_EXPR: amount + omt_fee

      const ledgerRow = unsettled.find((r) => r.kind === "LEDGER");
      expect(ledgerRow?.source_name).toBe("iPick");
      expect(ledgerRow?.amount_usd).toBeCloseTo(200);
    });

    it("excludes ledger rows already linked to a settlement batch (settlement_id set)", () => {
      const omtId = seedSupplier(db, {
        name: "OMT",
        provider: "OMT",
        isSystem: 1,
      });
      const ipickId = seedSupplier(db, {
        name: "iPick",
        provider: "iPick",
        accountSupplierId: omtId,
      });
      seedLedgerEntry(db, {
        supplierId: ipickId,
        entryType: "TOP_UP",
        amountUsd: 200,
        settlementId: 999,
      });

      expect(repo.getAccountUnsettled(omtId)).toHaveLength(0);
    });

    it("excludes refunded ledger rows and zero-amount rows", () => {
      const omtId = seedSupplier(db, {
        name: "OMT",
        provider: "OMT",
        isSystem: 1,
      });
      const ipickId = seedSupplier(db, {
        name: "iPick",
        provider: "iPick",
        accountSupplierId: omtId,
      });
      seedLedgerEntry(db, {
        supplierId: ipickId,
        entryType: "TOP_UP",
        amountUsd: 200,
        isRefunded: 1,
      });
      seedLedgerEntry(db, {
        supplierId: ipickId,
        entryType: "TOP_UP",
        amountUsd: 0,
        amountLbp: 0,
      });

      expect(repo.getAccountUnsettled(omtId)).toHaveLength(0);
    });
  });
});
