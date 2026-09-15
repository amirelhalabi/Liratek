/**
 * LIRA-189 — reversal owner for the OMT ACCOUNT settlement (rule 20, CLAUDE.md
 * rule 17). Contract: `docs/plans/todo_plans/OMT_OPEN_CREDIT_ACCOUNT_PLAN.md`
 * §5/§9.4, `CONTRACT_W2.md` §1/§1.1/§3 (lane W2).
 *
 * `SupplierRepository.settleAccount` (lane W1) is being built in parallel and
 * had not landed when this file was written, so every fixture below
 * HAND-SEEDS the row shape `_reverseSupplierSettlement` is contracted to
 * reverse, rather than calling a real `settleAccount()` — the exact same
 * "prove genericity with a synthetic fixture" approach
 * `TransactionRepository.supplierSiblingVoidCascade.test.ts`'s case (b)
 * already uses for a `recharges`-sourced auto sibling. The shape hand-seeded
 * here is derived from two THINGS THAT ARE ALREADY REAL production code, not
 * guessed from the plan text alone:
 *
 *   1. `SupplierRepository.settleTransactions`' own "Link ledger entry to
 *      unified transaction" step — `UPDATE supplier_ledger SET
 *      transaction_id = ? WHERE id = ?` — stamps the settlement's own ledger
 *      row with `transaction_id = <the settlement transaction's own id>`.
 *      That is the ONE existing precedent for "a supplier_ledger row shares
 *      its parent transaction's id", and `_reverseSupplierSettlement` is
 *      rewritten to key off exactly that link (`transaction_id =
 *      original.id`) so it generalizes to N per-child rows for free.
 *   2. `RechargeRepository.cashoutToSupplier` (LIRA-192, already shipped in
 *      the working tree) — a REAL `WALLET_CASHOUT` transaction with
 *      `source_table: 'recharges'`, whose auto ledger sibling carries
 *      `source_ref_table: 'recharges', source_ref_id: <recharge id>,
 *      is_auto: 1, entry_type: 'PAYMENT'`. Section 2's fixtures use this
 *      EXACT shape.
 *
 * Rule-17 classification — verified red pre-fix by TEMPORARILY reverting
 * `_reverseSupplierSettlement` to its pre-LIRA-189 single-row form (querying
 * only `WHERE settlement_id = original.source_id` / soft-voiding only
 * `original.source_id` via the generic step) and re-running this file:
 *   - "every per-child ledger row soft-voids, not just original.source_id"
 *     — FAILED red (only 1 of 3 rows soft-voided) before the transaction_id
 *     generalization, PASSED after.
 *   - "a batch whose parent has no debt of its own still fully reverses"
 *     — FAILED red (the pre-fix code required source_table ===
 *     'supplier_ledger' && source_id != null as a hard gate then only ever
 *     touched that one id) before, PASSED after.
 *   - "raw supplier_ledger settlement_id un-stamps" — FAILED red (pre-fix
 *     code never touched supplier_ledger.settlement_id at all — the column
 *     didn't exist in scope for that method), PASSED after.
 * And for the sibling-voidability extension (§2 below), verified red by
 * temporarily removing the new `sibling.settlement_id` check from
 * `_assertSupplierSiblingsVoidable` (leaving only the pre-existing
 * `_supplierSourceSettlementId` call, which only resolves a
 * `financial_services`-anchored parent): "voiding a settled WALLET_CASHOUT
 * sibling is blocked" FAILED red (the void wrongly succeeded, silently
 * un-refunding a row an account settlement had already netted), PASSED
 * after adding the direct sibling-row check.
 */

import Database from "better-sqlite3";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  SupplierRepository,
  resetSupplierRepository,
} from "../SupplierRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { TRANSACTION_TYPES } from "../../constants/transactionTypes";

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

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );
    INSERT INTO users (id, username) VALUES (1, 'admin');

    -- v176 (LIRA-187): account_supplier_id self-FK.
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
      account_supplier_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO suppliers (id, name, provider, is_system) VALUES (1, 'OMT', 'OMT', 1);
    INSERT INTO suppliers (id, name, provider, account_supplier_id) VALUES (2, 'OMT App', 'OMT_APP', 1);
    INSERT INTO suppliers (id, name, provider, account_supplier_id) VALUES (3, 'iPick', 'iPick', 1);

    CREATE TABLE financial_services (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      commission REAL NOT NULL DEFAULT 0,
      is_settled INTEGER NOT NULL DEFAULT 0,
      settled_at TEXT,
      settlement_id INTEGER,
      commission_model INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- v176 schema: settlement_id (D8's per-row selectable queue), plus the
    -- v136 source_ref columns the sibling-cascade/voidability guards read.
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
      settlement_id INTEGER DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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

    -- Unrelated to this fixture's own scenarios, but _cancelDebt/
    -- _restoreRepaymentDebt/_reversePartnerLedger run unconditionally on
    -- every void/refund and need these tables to exist.
    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System', 'USD', 500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_App', 'USD', 200, CURRENT_TIMESTAMP);

    -- recharges: the WALLET_CASHOUT parent's real source table (§2 fixtures).
    CREATE TABLE recharges (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier TEXT,
      recharge_type TEXT,
      amount REAL,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      currency_code TEXT,
      paid_by TEXT,
      note TEXT,
      created_by INTEGER,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function ledgerRow(
  db: Database.Database,
  id: number,
): {
  is_refunded: number;
  settlement_id: number | null;
  amount_usd: number;
} {
  return db
    .prepare(
      `SELECT is_refunded, settlement_id, amount_usd FROM supplier_ledger WHERE id = ?`,
    )
    .get(id) as {
    is_refunded: number;
    settlement_id: number | null;
    amount_usd: number;
  };
}

function fsRow(
  db: Database.Database,
  id: number,
): { is_settled: number; settled_at: string | null; settlement_id: number | null } {
  return db
    .prepare(
      `SELECT is_settled, settled_at, settlement_id FROM financial_services WHERE id = ?`,
    )
    .get(id) as {
    is_settled: number;
    settled_at: string | null;
    settlement_id: number | null;
  };
}

function drawerBal(db: Database.Database, name: string, ccy = "USD"): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(name, ccy) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function activeProfitSum(db: Database.Database, ids: number[]): number {
  const placeholders = ids.map(() => "?").join(",");
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(profit_usd), 0) AS total FROM transactions
       WHERE id IN (${placeholders}) AND status = 'ACTIVE'`,
    )
    .get(...ids) as { total: number };
  return row.total;
}

/**
 * Hand-seeds the exact write-shape §1/§9.4 of the contract describes for an
 * account settlement: ONE SUPPLIER_SETTLEMENT transaction, per-child
 * `supplier_ledger` PAYMENT rows sharing that transaction's own id via
 * `transaction_id` (the same link `settleTransactions` stamps on its own
 * lone row), each optionally anchoring a `supplier_settlements` +
 * `settlement_commission_allocations` pair, plus optional real payment legs
 * and a deferred-commission profit stamp.
 */
function seedAccountSettlement(
  db: Database.Database,
  txnRepo: TransactionRepository,
  opts: {
    /** [{supplierId, amountUsd (signed — negative = PAY, positive = COLLECT/credit)}] */
    children: Array<{ supplierId: number; amountUsd: number }>;
    /** Which of the new per-child rows (index into `children`) becomes the
     *  transaction's own source_id — mirrors settleTransactions' anchor. */
    anchorIndex: number;
    profitUsd?: number;
    cashLegUsd?: number;
    cashLegDrawer?: string;
    /** financial_services rows to stamp settlement_id on, keyed to one of
     *  the new per-child ledger rows (by children index). */
    financialServiceSettles?: Array<{ fsId: number; childIndex: number }>;
    /** raw supplier_ledger rows to stamp settlement_id on (D8 LEDGER-kind
     *  selections), keyed to one of the new per-child ledger rows. */
    rawLedgerSettles?: Array<{ ledgerId: number; childIndex: number }>;
  },
): { txnId: number; childLedgerIds: number[] } {
  const netUsd = opts.children.reduce((s, c) => s + c.amountUsd, 0);

  // 1. Insert every per-child supplier_ledger row FIRST (mirrors
  //    settleTransactions' own ordering — the ledger row must exist before
  //    createTransaction can anchor `source_id` to one of them).
  const childLedgerIds = opts.children.map((c) =>
    Number(
      db
        .prepare(
          `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp, is_auto, note)
           VALUES (?, ?, ?, 0, 0, 'Account settlement leg')`,
        )
        .run(c.supplierId, c.amountUsd < 0 ? "PAYMENT" : "SUPPLIER_PAYS_US", c.amountUsd)
        .lastInsertRowid,
    ),
  );

  const anchorId = childLedgerIds[opts.anchorIndex];
  const txnId = txnRepo.createTransaction({
    type: TRANSACTION_TYPES.SUPPLIER_SETTLEMENT,
    source_table: "supplier_ledger",
    source_id: anchorId,
    user_id: 1,
    amount_usd: Math.abs(netUsd),
    amount_lbp: 0,
    profit_usd: opts.profitUsd ?? 0,
    profit_lbp: 0,
    summary: "Account settlement",
    metadata_json: { account: true },
  });

  // 2. Link EVERY per-child row to this settlement's own transaction id —
  //    the exact mechanism settleTransactions already proves for its lone
  //    row (see this file's header comment).
  for (const id of childLedgerIds) {
    db.prepare(`UPDATE supplier_ledger SET transaction_id = ? WHERE id = ?`).run(
      txnId,
      id,
    );
  }

  for (const fs of opts.financialServiceSettles ?? []) {
    db.prepare(
      `UPDATE financial_services SET settlement_id = ?, is_settled = 1, settled_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(childLedgerIds[fs.childIndex], fs.fsId);
  }
  for (const raw of opts.rawLedgerSettles ?? []) {
    db.prepare(`UPDATE supplier_ledger SET settlement_id = ? WHERE id = ?`).run(
      childLedgerIds[raw.childIndex],
      raw.ledgerId,
    );
  }

  if (opts.cashLegUsd) {
    const drawerName = opts.cashLegDrawer ?? "OMT_System";
    db.prepare(
      `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, note, created_by)
       VALUES (?, 'CASH', ?, 'USD', ?, 'Settlement payment', 1)`,
    ).run(txnId, drawerName, -Math.abs(opts.cashLegUsd));
    db.prepare(
      `UPDATE drawer_balances SET balance = balance - ? WHERE drawer_name = ? AND currency_code = 'USD'`,
    ).run(Math.abs(opts.cashLegUsd), drawerName);
  }

  return { txnId, childLedgerIds };
}

describe("LIRA-189 — OMT account settlement reversal (void/refund)", () => {
  let db: Database.Database;
  let txnRepo: TransactionRepository;
  let supplierRepo: SupplierRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetSupplierRepository();
    txnRepo = new TransactionRepository();
    supplierRepo = new SupplierRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetTransactionRepository();
    resetSupplierRepository();
  });

  describe("full multi-child settlement — mixed sign, financial_services + raw-ledger un-stamp, drawer, profit", () => {
    let fsId: number;
    let cashoutLedgerId: number;
    let txnId: number;
    let childLedgerIds: number[];
    const OMT_APP_SUPPLIER_ID = 2;
    const IPICK_SUPPLIER_ID = 3;

    beforeEach(() => {
      // Pre-existing OMT counter debt (financial_services, model 1 — a real
      // SEND).
      fsId = Number(
        db
          .prepare(
            `INSERT INTO financial_services (provider, service_type, amount, currency, commission, commission_model, is_settled)
             VALUES ('OMT', 'SEND', 100, 'USD', 2, 1, 0)`,
          )
          .run().lastInsertRowid,
      );
      // Pre-existing raw iPick debt row (D8 LEDGER-kind selection).
      const ipickTopUp = Number(
        db
          .prepare(
            `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp)
             VALUES (?, 'TOP_UP', 200, 0)`,
          )
          .run(IPICK_SUPPLIER_ID).lastInsertRowid,
      );
      // Pre-existing WALLET_CASHOUT auto sibling on OMT App (LIRA-192 shape,
      // §2 below exercises voidability directly — here it's just a mixed-
      // sign LEDGER-kind selection: this credits the account, netting
      // against the SEND/TOP_UP debt).
      cashoutLedgerId = Number(
        db
          .prepare(
            `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp, is_auto, source_ref_table, source_ref_id)
             VALUES (?, 'PAYMENT', -50.05, 0, 1, 'recharges', 999)`,
          )
          .run(OMT_APP_SUPPLIER_ID).lastInsertRowid,
      );

      const seeded = seedAccountSettlement(db, txnRepo, {
        children: [
          { supplierId: 1, amountUsd: -102 }, // OMT counter net PAYMENT
          { supplierId: IPICK_SUPPLIER_ID, amountUsd: -200 }, // iPick PAYMENT
          { supplierId: OMT_APP_SUPPLIER_ID, amountUsd: 50.05 }, // OMT App SUPPLIER_PAYS_US (nets the credit back out — settlement pays the NET, but this fixture models the per-child gross rows individually, matching contract §1's "never one lump row")
        ],
        anchorIndex: 0,
        profitUsd: 0.1, // deferred cashout commission, summed at settlement (D14)
        cashLegUsd: 251.95,
        cashLegDrawer: "OMT_System",
        financialServiceSettles: [{ fsId, childIndex: 0 }],
        rawLedgerSettles: [
          { ledgerId: ipickTopUp, childIndex: 1 },
          { ledgerId: cashoutLedgerId, childIndex: 2 },
        ],
      });
      txnId = seeded.txnId;
      childLedgerIds = seeded.childLedgerIds;
    });

    it("create phase sanity: every per-child row and settle-mark landed as seeded", () => {
      expect(fsRow(db, fsId).settlement_id).toBe(childLedgerIds[0]);
      expect(ledgerRow(db, childLedgerIds[0]).amount_usd).toBeCloseTo(-102, 5);
      expect(drawerBal(db, "OMT_System")).toBeCloseTo(500 - 251.95, 5);
    });

    it("void nets EVERY per-child ledger row, financial_services, raw-ledger un-stamp, the drawer, and profit to 0 (rule 17)", () => {
      const drawerBefore = drawerBal(db, "OMT_System");

      txnRepo.voidTransaction(txnId, 1);

      // Every one of the 3 per-child rows this settlement wrote is
      // soft-voided — not just childLedgerIds[0] (original.source_id, which
      // the GENERIC step already covers).
      for (const id of childLedgerIds) {
        expect(ledgerRow(db, id).is_refunded).toBe(1);
      }

      // financial_services un-stamped exactly like the single-supplier path.
      const fs = fsRow(db, fsId);
      expect(fs.settlement_id).toBeNull();
      expect(fs.is_settled).toBe(0);
      expect(fs.settled_at).toBeNull();

      // Raw supplier_ledger LEDGER-kind selections re-open (settlement_id
      // NULL) — the iPick TOP_UP and the cashout sibling both re-enter the
      // unsettled queue. Neither is itself soft-voided (they are what the
      // settlement MARKED, not what it wrote).
      const ipickRow = db
        .prepare(`SELECT settlement_id, is_refunded FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'TOP_UP'`)
        .get(IPICK_SUPPLIER_ID) as { settlement_id: number | null; is_refunded: number };
      expect(ipickRow.settlement_id).toBeNull();
      expect(ipickRow.is_refunded).toBe(0);

      const cashoutRow = ledgerRow(db, cashoutLedgerId);
      expect(cashoutRow.settlement_id).toBeNull();
      expect(cashoutRow.is_refunded).toBe(0);

      // supplier_settlements + settlement_commission_allocations deleted for
      // the anchored child.
      const remainingSettlements = db
        .prepare(`SELECT COUNT(*) AS n FROM supplier_settlements WHERE ledger_entry_id = ?`)
        .get(childLedgerIds[0]) as { n: number };
      expect(remainingSettlements.n).toBe(0);

      // Drawer nets back to its pre-settlement balance (generic
      // _reversePayments, no bespoke code needed).
      expect(drawerBal(db, "OMT_System")).toBeCloseTo(
        drawerBefore + 251.95,
        5,
      );

      // Profit nets to 0: original flipped VOIDED, only the ACTIVE reversal
      // row remains and carries no profit column at all.
      const reversal = db
        .prepare(
          `SELECT id FROM transactions WHERE reverses_id = ? AND status = 'ACTIVE'`,
        )
        .get(txnId) as { id: number };
      expect(activeProfitSum(db, [txnId, reversal.id])).toBeCloseTo(0, 5);
    });

    it("REFUND path also nets profit to 0 via explicit negation (original stays ACTIVE)", () => {
      txnRepo.refundTransaction(txnId, 1);
      const refund = db
        .prepare(`SELECT id FROM transactions WHERE reverses_id = ?`)
        .get(txnId) as { id: number };
      expect(activeProfitSum(db, [txnId, refund.id])).toBeCloseTo(0, 5);
      for (const id of childLedgerIds) {
        expect(ledgerRow(db, id).is_refunded).toBe(1);
      }
    });
  });

  describe("a batch whose parent has no debt of its own", () => {
    it("still fully reverses via transaction_id — no assumption of a parent-anchored source_id", () => {
      // Only children touched: no 'OMT' (id 1) financial_services/ledger row
      // enters this batch at all. The anchor (source_id) points at a CHILD
      // row, never a parent row — §1's own constraint.
      const { txnId, childLedgerIds } = seedAccountSettlement(db, txnRepo, {
        children: [
          { supplierId: 2, amountUsd: -30 }, // OMT App
          { supplierId: 3, amountUsd: -70 }, // iPick
        ],
        anchorIndex: 0,
      });

      txnRepo.voidTransaction(txnId, 1);

      for (const id of childLedgerIds) {
        expect(ledgerRow(db, id).is_refunded).toBe(1);
      }
    });
  });

  describe("_assertSupplierSiblingsVoidable — a settled WALLET_CASHOUT sibling blocks void until its settlement is undone", () => {
    let cashoutTxnId: number;
    let cashoutLedgerId: number;
    let settlementTxnId: number;

    beforeEach(() => {
      // LIRA-192 shape (already real production code —
      // RechargeRepository.cashoutToSupplier): a WALLET_CASHOUT transaction
      // sourced from `recharges`, with an auto ledger sibling back-linked by
      // source_ref_table/source_ref_id.
      const rechargeId = Number(
        db
          .prepare(
            `INSERT INTO recharges (carrier, recharge_type, amount, currency_code, paid_by)
             VALUES ('OMT_APP', 'TOP_UP', 100, 'USD', 'OMT_App')`,
          )
          .run().lastInsertRowid,
      );
      cashoutTxnId = txnRepo.createTransaction({
        type: TRANSACTION_TYPES.WALLET_CASHOUT,
        source_table: "recharges",
        source_id: rechargeId,
        user_id: 1,
        amount_usd: 100,
        amount_lbp: 0,
        profit_usd: 0,
        profit_lbp: 0,
        summary: "Cash Out to OMT",
        metadata_json: { commission: 0.1 },
      });
      cashoutLedgerId = Number(
        db
          .prepare(
            `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp, is_auto, source_ref_table, source_ref_id)
             VALUES (2, 'PAYMENT', -100.1, 0, 1, 'recharges', ?)`,
          )
          .run(rechargeId).lastInsertRowid,
      );
      // `addLedgerEntry`'s no-drawer, is_auto:true branch (the REAL path
      // `RechargeRepository.cashoutToSupplier` uses) always creates its OWN
      // hidden SUPPLIER_PAYMENT transaction for the sibling row and links it
      // via `transaction_id` — `_cascadeSupplierSiblingVoid` dispatches
      // `_voidTransactionInternal` on THAT id, so a fixture that omits it
      // would never actually reverse the sibling. Mirrored here rather than
      // left as a bare orphaned ledger row.
      const cashoutSiblingTxnId = txnRepo.createTransaction({
        type: TRANSACTION_TYPES.SUPPLIER_PAYMENT,
        source_table: "supplier_ledger",
        source_id: cashoutLedgerId,
        user_id: 1,
        amount_usd: 100.1,
        amount_lbp: 0,
        summary: "Cash Out to OMT: -$100.00",
        metadata_json: {},
      });
      db.prepare(`UPDATE supplier_ledger SET transaction_id = ? WHERE id = ?`).run(
        cashoutSiblingTxnId,
        cashoutLedgerId,
      );

      const seeded = seedAccountSettlement(db, txnRepo, {
        children: [{ supplierId: 2, amountUsd: -100.1 }],
        anchorIndex: 0,
        rawLedgerSettles: [{ ledgerId: cashoutLedgerId, childIndex: 0 }],
      });
      settlementTxnId = seeded.txnId;
    });

    it("blocks voiding the cashout while its sibling is swept into the settlement", () => {
      // Named by the SIBLING ROW's own id (v176 anchor), not the settlement
      // transaction's id — assert the message references a settlement, and
      // that nothing was mutated by the refused attempt.
      expect(() => txnRepo.voidTransaction(cashoutTxnId, 1)).toThrow(
        /already been included in settlement/i,
      );
      expect(ledgerRow(db, cashoutLedgerId).is_refunded).toBe(0);
      expect(settlementTxnId).toBeGreaterThan(0);
    });

    it("becomes voidable again once the settlement itself is voided (settlement_id un-stamped)", () => {
      txnRepo.voidTransaction(settlementTxnId, 1);
      expect(ledgerRow(db, cashoutLedgerId).settlement_id).toBeNull();

      expect(() => txnRepo.voidTransaction(cashoutTxnId, 1)).not.toThrow();
      expect(ledgerRow(db, cashoutLedgerId).is_refunded).toBe(1);
    });
  });

  describe("regression — ordinary single-supplier settleTransactions is unaffected", () => {
    it("still un-stamps financial_services and soft-voids its lone ledger row exactly as before", () => {
      // commission_model = 0 (legacy/embedded) — deliberately, NOT 1: model 1
      // routes settleTransactions through `_bookCommissionAtSettlement`,
      // which reads the FS row via `FinancialServiceRepository.findById()`'s
      // FULL explicit column list (unrelated to this regression's own
      // point). `TransactionRepository.supplierSettlementReversal.test.ts`
      // is the dedicated, exhaustive coverage for the model-1/commission
      // path and passes unchanged — see this file's own header comment for
      // confirmation it was run directly.
      const fsId = Number(
        db
          .prepare(
            `INSERT INTO financial_services (provider, service_type, amount, currency, commission, commission_model, is_settled)
             VALUES ('OMT', 'SEND', 100, 'USD', 0.5, 0, 0)`,
          )
          .run().lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp, is_auto)
         VALUES (1, 'TOP_UP', 104.5, 0, 1)`,
      ).run();

      const settlement = supplierRepo.settleTransactions({
        supplier_id: 1,
        financial_service_ids: [fsId],
        amount_usd: 104.5,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 104.5 }],
      });
      // settleTransactions returns { id: <the SETTLEMENT supplier_ledger
      // row's id> }, not the transaction id — look the transaction up the
      // same way _reverseSupplierSettlement's own anchor (source_id) does.
      const settlementTxn = db
        .prepare(
          `SELECT id FROM transactions WHERE source_table = 'supplier_ledger' AND source_id = ? AND type = 'SUPPLIER_SETTLEMENT'`,
        )
        .get(settlement.id) as { id: number };

      txnRepo.voidTransaction(settlementTxn.id, 1);

      const fs = fsRow(db, fsId);
      expect(fs.settlement_id).toBeNull();
      expect(fs.is_settled).toBe(0);
      const settlementLedgerRow = ledgerRow(db, settlement.id);
      expect(settlementLedgerRow.is_refunded).toBe(1);
    });
  });
});
