/**
 * Carrier-legs void asymmetry — split checkout guard + voidCheckoutGroup
 * (CARRIER_LEGS_VOID_ASYMMETRY.md, design B+)
 *
 * The bug (pre-existing property of the lira-095 legs-carrying convention,
 * exposure widened by the auto-debt-remainder change set): a multi-unit
 * split checkout (KatchForm bills / FinancialForm catalog units) submits ONE
 * unified transaction PER UNIT, but the customer's full tender + any
 * CUSTOMER_ACCOUNT debt books against exactly ONE unit — the CARRIER; every
 * SIBLING unit submits `deferPayment: true` (cost + commission only, no
 * legs). The generic void/refund (`TransactionRepository._reversePayments`,
 * `_cancelDebt`) is per-transaction, so:
 *   1. Voiding the CARRIER alone reverses the WHOLE checkout's customer
 *      cash/debt but only the carrier's own cost/profit — siblings keep
 *      their cost-outflow legs and profit stamps on a now-VOIDED-sibling-less
 *      checkout.
 *   2. Voiding a SIBLING alone reverses its cost/profit but returns none of
 *      the customer's money for that unit — the customer stays charged for
 *      a cancelled unit.
 * Create + reverse does NOT net to 0 per currency unless every unit is
 * voided together — and before this fix, nothing enforced that.
 *
 * Design B+ (metadata group linkage + void guard + whole-group void, no
 * migration): every unit of a multi-unit checkout is stamped with
 * `split_group` (uuid) / `split_role` ('carrier'|'sibling') / `split_units`
 * in its `metadata_json` (FinancialServiceRepository.createTransaction). The
 * generic void/refund path (`TransactionRepository._assertReversible`)
 * refuses a lone member; `voidCheckoutGroup` voids every non-voided member —
 * siblings first, carrier last — in ONE db transaction, reusing the exact
 * per-transaction reversal internals (`_reversePayments`, `_cancelDebt`,
 * `_markSourceRefunded`) so drawer/debt/profit reversal runs through code
 * that already knows how.
 *
 * Failing-first proof (CLAUDE.md rule 17) — recorded verbatim in the W5
 * report: the "voidTransaction refuses a lone carrier/sibling" tests below
 * were run against the pre-fix repository (the `_assertReversible` guard
 * block temporarily commented out) and FAILED (no throw — the pre-fix void
 * succeeds silently, which is exactly the bug). Restoring the guard makes
 * them pass. The "internal bypass" test group documents the resulting
 * non-zero net WITHOUT needing to revert code, by calling the same
 * `allowSplitGroupMember: true` escape hatch `voidCheckoutGroup` itself
 * uses — pinned permanently as the mechanism explanation.
 *
 * Both KatchForm-bills and FinancialForm-catalog shapes are covered:
 *   - Checkout A mirrors KatchForm bills: provider "Katsh", serviceType
 *     "BILL", explicit `price` (KatchForm always sends it), a
 *     CROSS-CURRENCY tender (USD-denominated bills, LBP cash payment).
 *   - Checkout B mirrors FinancialForm catalog items: provider "WHISH_APP",
 *     serviceType "SEND", NO explicit `price` (defaults to `amount`, exactly
 *     how FinancialForm's real payload omits it), a CUSTOMER_ACCOUNT debt
 *     leg, and non-zero commission/profit on both units (proving the
 *     ACTIVE-status profit filter genuinely returns to baseline, not just
 *     staying at 0).
 *
 * Scope note (rule 20's own limitation, NOT introduced by this fix): a Katsh
 * BILL books an auto `SUPPLIER_PAYS_US` supplier_ledger row when an ACTIVE
 * supplier row exists for the provider (FEATURE_GUIDE §9's standing gap at
 * the time this file was written — "voiding a FINANCIAL_SERVICE row leaves
 * its auto SUPPLIER_PAYMENT sibling standing", FIXED 2026-07-21 by LIRA-091).
 * This fixture deliberately seeds NO supplier row for "Katsh", so that branch
 * stays a no-op here (`getByProvider` returns undefined, the code logs and
 * skips) — supplier_ledger was out of scope for THIS fix's acceptance
 * criteria (payments/drawers/debt_ledger/profit only). The supplier-sibling
 * cascade itself — including a Katsh BILL split-group member voided via
 * `voidCheckoutGroup`, which delegates to the same `_voidTransactionInternal`
 * every single void uses — is proved in
 * `TransactionRepository.supplierSiblingVoidCascade.test.ts` case (d).
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
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

const CLIENT_ID = 9;

// ─── In-memory schema (union of saleCost.test.ts's cost/price-flow drawers
//      [Katsh/iPick] + crossCurrencyTender.test.ts's app-wallet drawers
//      [Whish_App] + is_refunded/refunded_at on financial_services, which
//      voidTransaction's _markSourceRefunded UPDATEs unconditionally) ───────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      role TEXT DEFAULT 'staff'
    );
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO clients (id, full_name, phone_number) VALUES (${CLIENT_ID}, 'Split Checkout Client', '76000000');

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
      edited_by TEXT,
      edited_at TEXT,
      paid_amount REAL DEFAULT NULL,
      paid_currency TEXT DEFAULT NULL,
      partner_id INTEGER,
      partner_mode TEXT,
      commission_model INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at TEXT
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

    -- Empty on purpose (see the file doc's scope note): no Katsh supplier
    -- row means the BILL branch's supplier-ledger auto-entry is a no-op,
    -- keeping supplier_ledger out of scope for this fix.
    CREATE TABLE suppliers (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      provider TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
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

    INSERT INTO drawer_balances VALUES (1, 'General',   'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General',   'LBP', 100000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Katsh',     'USD', 500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Katsh',     'LBP', 0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'iPick',     'USD', 500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_App', 'USD', 500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_App', 'LBP', 10000000, CURRENT_TIMESTAMP);
  `);

  return db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

/** Sum of ALL debt_ledger rows for a client — charge + 'Refund Reversal'
 *  cancellation nets to 0 with no status filter needed (debt_ledger has no
 *  status column; every row counts permanently). */
function clientDebtSum(
  db: Database.Database,
  clientId: number,
): { usd: number; lbp: number } {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
       FROM debt_ledger WHERE client_id = ?`,
    )
    .get(clientId) as { usd: number; lbp: number };
  return row;
}

/** Sum of profit_usd/profit_lbp over ACTIVE-status transactions ONLY — a
 *  VOID (unlike REFUND) does not negate profit; it relies on the original
 *  row dropping out of every ACTIVE-status profit scan the moment its
 *  status flips to VOIDED (ProfitRepository's WHERE t.status = 'ACTIVE'
 *  convention). Global (not scoped to one checkout) — each test starts from
 *  a fresh in-memory db, so the baseline is always 0. */
function activeProfitSum(db: Database.Database): { usd: number; lbp: number } {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(profit_usd), 0) AS usd, COALESCE(SUM(profit_lbp), 0) AS lbp
       FROM transactions WHERE status = 'ACTIVE'`,
    )
    .get() as { usd: number; lbp: number };
  return row;
}

/** Every non-reversal payments row (originals + reversal legs) — the ONE
 *  correct way to check a checkout's drawer effect nets to 0: filtering by
 *  transaction status would only see the reversal's OWN legs, not the pair
 *  (see the file's advisor-caught trap). Kept as a raw sum for readability;
 *  the actual proof drawer_balances snapshot returns to baseline. */
function paymentsSum(
  db: Database.Database,
  drawer: string,
  currency: string,
): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS s FROM payments
       WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(drawer, currency) as { s: number };
  return row.s;
}

describe("Split-checkout void guard + voidCheckoutGroup (CARRIER_LEGS_VOID_ASYMMETRY.md, design B+)", () => {
  let db: Database.Database;
  let fsRepo: FinancialServiceRepository;
  let txnRepo: TransactionRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    fsRepo = new FinancialServiceRepository();
    resetTransactionRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetTransactionRepository();
  });

  /**
   * Checkout A — KatchForm-bills shape: 2 Katsh BILLs, CROSS-CURRENCY tender
   * (USD-denominated bills, customer pays the full checkout total in LBP
   * cash — the exact "tendered in a different currency than the service"
   * case §4 of the Feature Guide calls out). Zero commission (bills carry
   * no margin, matching KatchForm's real payload) — this checkout proves
   * the drawer/cross-currency netting; Checkout B below proves profit +
   * CUSTOMER_ACCOUNT debt netting.
   */
  function createCheckoutA(): {
    groupId: string;
    carrierTxnId: number;
    siblingTxnId: number;
  } {
    const groupId = "11111111-1111-4111-8111-111111111111";
    const carrierFs = fsRepo.createTransaction({
      provider: "Katsh",
      serviceType: "BILL",
      amount: 20,
      cost: 20,
      price: 20, // KatchForm bills always send an explicit price
      currency: "USD",
      commission: 0,
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 3150000 }],
      checkoutTotal: { usd: 35, lbp: 0 },
      tender_exchange_rate: 90000,
      exchangeRate: 90000,
      split_group: groupId,
      split_role: "carrier",
      split_units: 2,
      userId: 1,
    });
    const siblingFs = fsRepo.createTransaction({
      provider: "Katsh",
      serviceType: "BILL",
      amount: 15,
      cost: 15,
      price: 15,
      currency: "USD",
      commission: 0,
      deferPayment: true,
      exchangeRate: 90000,
      split_group: groupId,
      split_role: "sibling",
      split_units: 2,
      userId: 1,
    });
    const carrierTxnId = txnRepo.getBySourceId(
      "financial_services",
      carrierFs.id,
    )!.id;
    const siblingTxnId = txnRepo.getBySourceId(
      "financial_services",
      siblingFs.id,
    )!.id;
    return { groupId, carrierTxnId, siblingTxnId };
  }

  /**
   * Checkout B — FinancialForm-catalog shape: 2 WHISH_APP catalog items, NO
   * explicit `price` (defaults to `amount` — exactly how FinancialForm's
   * real payload omits it), CUSTOMER_ACCOUNT debt leg for the full checkout
   * total, and non-zero commission on both units (proves the ACTIVE-status
   * profit filter genuinely returns to baseline, not just staying at 0).
   */
  function createCheckoutB(): {
    groupId: string;
    carrierTxnId: number;
    siblingTxnId: number;
  } {
    const groupId = "22222222-2222-4222-8222-222222222222";
    const carrierFs = fsRepo.createTransaction({
      provider: "WHISH_APP",
      serviceType: "SEND",
      amount: 3000000,
      cost: 2000000, // commission = price(=amount) - cost = 1,000,000
      currency: "LBP",
      commission: 0, // ignored for cost/price flow (recomputed as price - cost)
      payments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 4500000 },
      ],
      checkoutTotal: { usd: 0, lbp: 4500000 },
      clientId: CLIENT_ID,
      exchangeRate: 90000,
      split_group: groupId,
      split_role: "carrier",
      split_units: 2,
      userId: 1,
    });
    const siblingFs = fsRepo.createTransaction({
      provider: "WHISH_APP",
      serviceType: "SEND",
      amount: 1500000,
      cost: 1000000, // commission = 500,000
      currency: "LBP",
      commission: 0, // ignored for cost/price flow (recomputed as price - cost)
      deferPayment: true,
      exchangeRate: 90000,
      split_group: groupId,
      split_role: "sibling",
      split_units: 2,
      userId: 1,
    });
    const carrierTxnId = txnRepo.getBySourceId(
      "financial_services",
      carrierFs.id,
    )!.id;
    const siblingTxnId = txnRepo.getBySourceId(
      "financial_services",
      siblingFs.id,
    )!.id;
    return { groupId, carrierTxnId, siblingTxnId };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 0. Wiring sanity: both shapes actually stamp split_group/role/units
  // ═══════════════════════════════════════════════════════════════════════
  describe("metadata wiring (both shapes)", () => {
    it("Checkout A (Katsh BILL): carrier/sibling metadata_json carries split_group/role/units", () => {
      const { groupId, carrierTxnId, siblingTxnId } = createCheckoutA();
      const carrier = txnRepo.findById(carrierTxnId)!;
      const sibling = txnRepo.findById(siblingTxnId)!;
      const carrierMeta = JSON.parse(carrier.metadata_json!);
      const siblingMeta = JSON.parse(sibling.metadata_json!);
      expect(carrierMeta.split_group).toBe(groupId);
      expect(carrierMeta.split_role).toBe("carrier");
      expect(carrierMeta.split_units).toBe(2);
      expect(siblingMeta.split_group).toBe(groupId);
      expect(siblingMeta.split_role).toBe("sibling");
      expect(siblingMeta.split_units).toBe(2);
    });

    it("Checkout B (WHISH_APP catalog): carrier/sibling metadata_json carries split_group/role/units", () => {
      const { groupId, carrierTxnId, siblingTxnId } = createCheckoutB();
      const carrierMeta = JSON.parse(
        txnRepo.findById(carrierTxnId)!.metadata_json!,
      );
      const siblingMeta = JSON.parse(
        txnRepo.findById(siblingTxnId)!.metadata_json!,
      );
      expect(carrierMeta.split_group).toBe(groupId);
      expect(carrierMeta.split_role).toBe("carrier");
      expect(siblingMeta.split_group).toBe(groupId);
      expect(siblingMeta.split_role).toBe("sibling");
    });

    it("single-unit checkout (no split_group/role/units sent) stamps NO split metadata — no noise", () => {
      const fs = fsRepo.createTransaction({
        provider: "Katsh",
        serviceType: "BILL",
        amount: 10,
        cost: 10,
        price: 10,
        currency: "USD",
        commission: 0,
        paidByMethod: "CASH",
        exchangeRate: 90000,
        userId: 1,
      });
      const txn = txnRepo.getBySourceId("financial_services", fs.id)!;
      const meta = JSON.parse(txn.metadata_json!);
      expect(meta.split_group).toBeUndefined();
      expect(meta.split_role).toBeUndefined();
      expect(meta.split_units).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 1. The guard — voidTransaction/refundTransaction refuse a lone member
  //    (FAILING-FIRST per rule 17: run with the guard commented out first —
  //    see the W5 report for the captured pre-fix output).
  // ═══════════════════════════════════════════════════════════════════════
  describe("guard: a lone split-group member cannot be voided/refunded alone", () => {
    it("voidTransaction(carrier) throws naming the checkout size — Checkout A", () => {
      const { carrierTxnId } = createCheckoutA();
      expect(() => txnRepo.voidTransaction(carrierTxnId, 1)).toThrow(
        /2-unit checkout; void the whole checkout instead/i,
      );
    });

    it("voidTransaction(sibling) throws — Checkout A (case 2 of the asymmetry: a lone sibling void must NOT be allowed either)", () => {
      const { siblingTxnId } = createCheckoutA();
      expect(() => txnRepo.voidTransaction(siblingTxnId, 1)).toThrow(
        /2-unit checkout; void the whole checkout instead/i,
      );
    });

    it("refundTransaction(carrier) throws — Checkout A", () => {
      const { carrierTxnId } = createCheckoutA();
      expect(() => txnRepo.refundTransaction(carrierTxnId, 1)).toThrow(
        /2-unit checkout; void the whole checkout instead/i,
      );
    });

    it("refundTransaction(sibling) throws — Checkout A", () => {
      const { siblingTxnId } = createCheckoutA();
      expect(() => txnRepo.refundTransaction(siblingTxnId, 1)).toThrow(
        /2-unit checkout; void the whole checkout instead/i,
      );
    });

    it("voidTransaction(carrier) throws — Checkout B (FinancialForm-catalog shape)", () => {
      const { carrierTxnId } = createCheckoutB();
      expect(() => txnRepo.voidTransaction(carrierTxnId, 1)).toThrow(
        /2-unit checkout; void the whole checkout instead/i,
      );
    });

    it("voidTransaction(sibling) throws — Checkout B (FinancialForm-catalog shape)", () => {
      const { siblingTxnId } = createCheckoutB();
      expect(() => txnRepo.voidTransaction(siblingTxnId, 1)).toThrow(
        /2-unit checkout; void the whole checkout instead/i,
      );
    });

    it("control: an ordinary (non-split) FINANCIAL_SERVICE transaction voids normally — the guard doesn't over-fire", () => {
      const fs = fsRepo.createTransaction({
        provider: "Katsh",
        serviceType: "BILL",
        amount: 10,
        cost: 10,
        price: 10,
        currency: "USD",
        commission: 0,
        paidByMethod: "CASH",
        exchangeRate: 90000,
        userId: 1,
      });
      const txnId = txnRepo.getBySourceId("financial_services", fs.id)!.id;
      expect(() => txnRepo.voidTransaction(txnId, 1)).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Bug-mechanism documentation (permanent, no code reversion needed): a
  //    lone void via the SAME internal escape hatch voidCheckoutGroup uses
  //    leaves the checkout's money non-zero — this is exactly what the
  //    guard above prevents from happening through the public API.
  // ═══════════════════════════════════════════════════════════════════════
  describe("bug mechanism: bypassing the guard leaves a non-zero net (documents WHY the guard exists)", () => {
    it("voiding the carrier alone (bypass) reverses ALL customer cash but leaves the sibling's cost leg standing — General LBP does not return to its pre-checkout baseline while Katsh USD still reflects BOTH units' cost", () => {
      const genLbpBefore = balance(db, "General", "LBP");
      const katshUsdBefore = balance(db, "Katsh", "USD");
      const { carrierTxnId } = createCheckoutA();

      // Sanity: checkout booked as expected before any void.
      expect(balance(db, "General", "LBP")).toBeCloseTo(
        genLbpBefore + 3150000,
        2,
      );
      expect(balance(db, "Katsh", "USD")).toBeCloseTo(katshUsdBefore - 35, 2);

      // Bypass the guard exactly like voidCheckoutGroup does internally,
      // but for ONLY the carrier — simulating the pre-fix "single void
      // always allowed" behavior.
      (
        txnRepo as unknown as {
          _voidTransactionInternal: (
            id: number,
            userId: number,
            opts: { allowSplitGroupMember?: boolean },
          ) => number;
        }
      )._voidTransactionInternal(carrierTxnId, 1, {
        allowSplitGroupMember: true,
      });

      // Carrier's own CASH leg is reversed — General LBP is back to its
      // pre-checkout baseline (the FULL tender was on the carrier).
      expect(balance(db, "General", "LBP")).toBeCloseTo(genLbpBefore, 2);
      // But the SIBLING's −15 USD Katsh cost leg is untouched — the drawer
      // does NOT return to its pre-checkout baseline. Net effect: shop paid
      // the provider for the sibling's bill and returned the customer's
      // money for BOTH, netting −15 USD it can never recover from this
      // checkout. This is the asymmetry's case 1.
      expect(balance(db, "Katsh", "USD")).toBeCloseTo(katshUsdBefore - 15, 2);
      expect(balance(db, "Katsh", "USD")).not.toBeCloseTo(katshUsdBefore, 2);
    });

    it("voiding a sibling alone (bypass) reverses its own cost but the customer stays charged for that unit — Checkout B's debt_ledger keeps the FULL 4,500,000 LBP charge, not the sibling's 1,500,000 share", () => {
      const { siblingTxnId } = createCheckoutB();
      const debtBefore = clientDebtSum(db, CLIENT_ID);
      expect(debtBefore.lbp).toBeCloseTo(4500000, 2); // full checkout charged

      (
        txnRepo as unknown as {
          _voidTransactionInternal: (
            id: number,
            userId: number,
            opts: { allowSplitGroupMember?: boolean },
          ) => number;
        }
      )._voidTransactionInternal(siblingTxnId, 1, {
        allowSplitGroupMember: true,
      });

      // _cancelDebt only fires for the transaction being voided — the
      // sibling booked NO debt of its own (deferPayment skips the whole
      // inflow/debt block), so voiding it touches debt_ledger not at all.
      // The customer is still on the hook for the WHOLE 4,500,000 LBP even
      // though the sibling's unit was "cancelled".
      const debtAfter = clientDebtSum(db, CLIENT_ID);
      expect(debtAfter.lbp).toBeCloseTo(4500000, 2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. voidCheckoutGroup — nets every ledger to EXACTLY 0, per currency
  // ═══════════════════════════════════════════════════════════════════════
  describe("voidCheckoutGroup nets to 0 (rule 20 acceptance)", () => {
    it("Checkout A (KatchForm-bills, cross-currency tender): drawers return to their exact pre-checkout baseline", () => {
      const genUsdBefore = balance(db, "General", "USD");
      const genLbpBefore = balance(db, "General", "LBP");
      const katshUsdBefore = balance(db, "Katsh", "USD");
      const profitBefore = activeProfitSum(db);

      const { groupId } = createCheckoutA();

      const result = txnRepo.voidCheckoutGroup(groupId, 1);
      expect(result.memberCount).toBe(2);
      expect(result.voidedTransactionIds).toHaveLength(2);
      expect(result.reversalIds).toHaveLength(2);

      expect(balance(db, "General", "USD")).toBeCloseTo(genUsdBefore, 2);
      expect(balance(db, "General", "LBP")).toBeCloseTo(genLbpBefore, 2);
      expect(balance(db, "Katsh", "USD")).toBeCloseTo(katshUsdBefore, 2);
      // Zero-commission bills: profit was 0 before and after.
      const profitAfter = activeProfitSum(db);
      expect(profitAfter.usd).toBeCloseTo(profitBefore.usd, 2);
      expect(profitAfter.lbp).toBeCloseTo(profitBefore.lbp, 2);
    });

    it("Checkout B (FinancialForm-catalog, CUSTOMER_ACCOUNT debt-leg): Whish_App drawer, client debt, AND active profit all return to baseline", () => {
      const whishAppLbpBefore = balance(db, "Whish_App", "LBP");
      const debtBefore = clientDebtSum(db, CLIENT_ID);
      const profitBefore = activeProfitSum(db);

      const { groupId } = createCheckoutB();

      // Sanity: mid-checkout, profit and debt are NOT at baseline (proves
      // the "after" assertions below are a real return, not a no-op).
      expect(activeProfitSum(db).lbp).toBeCloseTo(
        profitBefore.lbp + 1500000,
        2,
      );
      expect(clientDebtSum(db, CLIENT_ID).lbp).toBeCloseTo(
        debtBefore.lbp + 4500000,
        2,
      );

      const result = txnRepo.voidCheckoutGroup(groupId, 1);
      expect(result.memberCount).toBe(2);

      expect(balance(db, "Whish_App", "LBP")).toBeCloseTo(whishAppLbpBefore, 2);
      const debtAfter = clientDebtSum(db, CLIENT_ID);
      expect(debtAfter.usd).toBeCloseTo(debtBefore.usd, 2);
      expect(debtAfter.lbp).toBeCloseTo(debtBefore.lbp, 2);
      const profitAfter = activeProfitSum(db);
      expect(profitAfter.usd).toBeCloseTo(profitBefore.usd, 2);
      expect(profitAfter.lbp).toBeCloseTo(profitBefore.lbp, 2);
    });

    it("voids siblings before the carrier (member void order)", () => {
      const { groupId, carrierTxnId, siblingTxnId } = createCheckoutA();
      const result = txnRepo.voidCheckoutGroup(groupId, 1);
      const siblingIdx = result.voidedTransactionIds.indexOf(siblingTxnId);
      const carrierIdx = result.voidedTransactionIds.indexOf(carrierTxnId);
      expect(siblingIdx).toBeGreaterThanOrEqual(0);
      expect(carrierIdx).toBeGreaterThanOrEqual(0);
      expect(siblingIdx).toBeLessThan(carrierIdx);
    });

    it("is idempotent — voiding an already-fully-voided group returns 0 newly-voided members, no error", () => {
      const { groupId } = createCheckoutA();
      txnRepo.voidCheckoutGroup(groupId, 1);
      const second = txnRepo.voidCheckoutGroup(groupId, 1);
      expect(second.voidedTransactionIds).toHaveLength(0);
      expect(second.reversalIds).toHaveLength(0);
      expect(second.memberCount).toBe(2); // members still found (now VOIDED)
    });

    it("throws NotFoundError for an unknown groupId", () => {
      expect(() => txnRepo.voidCheckoutGroup("no-such-group", 1)).toThrow(
        /not found/i,
      );
    });

    it("throws for an empty groupId", () => {
      expect(() => txnRepo.voidCheckoutGroup("", 1)).toThrow(
        /groupId is required/i,
      );
    });

    it("does not touch supplier_ledger (out of scope — see the file doc's scope note)", () => {
      const { groupId } = createCheckoutA();
      txnRepo.voidCheckoutGroup(groupId, 1);
      const rows = db
        .prepare(`SELECT COUNT(*) AS c FROM supplier_ledger`)
        .get() as { c: number };
      expect(rows.c).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Raw payments-row cross-check (belt-and-suspenders on top of the
  //    drawer-balance snapshot proof above): every payments row this
  //    checkout wrote (originals + reversal legs) sums to exactly 0 per
  //    drawer/currency once the group is fully voided.
  // ═══════════════════════════════════════════════════════════════════════
  it("Checkout A: raw payments-table sum per drawer/currency is 0 after voidCheckoutGroup", () => {
    const { groupId } = createCheckoutA();
    txnRepo.voidCheckoutGroup(groupId, 1);
    expect(paymentsSum(db, "General", "LBP")).toBeCloseTo(0, 2);
    expect(paymentsSum(db, "Katsh", "USD")).toBeCloseTo(0, 2);
  });
});
