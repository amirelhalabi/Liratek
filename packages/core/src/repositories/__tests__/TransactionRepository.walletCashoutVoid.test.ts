/**
 * LIRA-192 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §8.7, rule 20) — void/reversal
 * proof for the OMT App wallet cashout (`WALLET_CASHOUT`).
 *
 * `RechargeRepository.cashoutToSupplier` (L3's lane, this same batch) is the
 * mirror of `topUpFromSupplier`: it moves `OMT_App −amount` and books ONE
 * `supplier_ledger` PAYMENT row on `'OMT App'` for `−(amount + commission)`.
 * Per the implementation contract (§2.3/§3 L3), that ledger row is written
 * `is_auto: true` with `source_ref_table: "recharges"` / `source_ref_id`
 * pointing at the SAME `recharges` row the WALLET_CASHOUT transaction itself
 * is sourced from — the exact shape `TransactionRepository`'s pre-existing
 * LIRA-091 cascade (`_cascadeSupplierSiblingVoid`) already knows how to find
 * and void. The wallet-drawer leg is a REAL `payments` row on the
 * WALLET_CASHOUT transaction, so the generic `_reversePayments` mirror-and-
 * negate step restores it for free too.
 *
 * THIS FILE'S JOB (rule 20's proof obligation): confirm that combination
 * actually nets everything to 0 on void — the `OMT_App` drawer, the
 * `'OMT App'` ledger, and profit, per currency — WITHOUT adding a bespoke
 * reversal method to `TransactionRepository`, because none is needed: the
 * two pre-existing generic mechanisms (`_reversePayments` +
 * `_cascadeSupplierSiblingVoid`) already cover it, exactly as they already do
 * for a `financial_services`-sourced auto sibling
 * (`TransactionRepository.supplierSiblingVoidCascade.test.ts` case (a)) and,
 * synthetically, for a `recharges`-sourced one (that same file's case (b) —
 * this file is the money-shaped, WALLET_CASHOUT-specific descendant of that
 * proof).
 *
 * Rather than depending on `RechargeRepository.cashoutToSupplier` compiling
 * (a different, parallel lane's file, mid-edit in the same batch), the
 * "happy path" test below constructs the exact DB shape the contract
 * requires `cashoutToSupplier` to produce — same discipline as the model
 * file's case (b) synthetic RECHARGE proof — using the SAME shared
 * `applyDrawerDelta`/`insertPaymentRow` helpers a real repository method
 * would call, and the SAME `SupplierRepository.addLedgerEntry` a real
 * repository method would call.
 *
 * FAILING-FIRST (rule 17): a bare assertion that void nets to 0 proves
 * nothing on its own unless the two ways this specific flow is documented to
 * go wrong (contract §3 L3, step 5/6) are shown to actually break the
 * invariant when reconstructed by hand:
 *   (B) the wallet leg written as a bare `drawer_balances` UPDATE instead of
 *       a real `payments` row ("Do not bare-UPDATE the balance") — the
 *       drawer never comes back on void.
 *   (C) the ledger row written `is_auto: true` but WITHOUT the
 *       `source_ref_table`/`source_ref_id` back-link — the cascade can never
 *       find it, so the ledger (and the OMT account rollup built on top of
 *       it) stays wrong forever.
 * Both are reproduced below and assert the BROKEN outcome, pinning the exact
 * bug shape the contract's wording heads off — the same "reconstruct the
 * pre-fix shape, assert the pre-fix symptom" pattern used throughout
 * `TransactionRepository.supplierSiblingVoidCascade.test.ts`.
 */

import Database from "better-sqlite3";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  getSupplierRepository,
  resetSupplierRepository,
} from "../SupplierRepository";
import { applyDrawerDelta, insertPaymentRow } from "../moneyPosting";
import {
  initFixedTenantContext,
  resetTenantContext,
  getCurrentTenantId,
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

const CASHOUT_AMOUNT_USD = 100;
const CASHOUT_COMMISSION_USD = 0.1; // OMT_APP_CASHOUT_COMMISSION_RATE (0.001) * 100
const OMT_APP_STARTING_BALANCE = 500;

// ─── In-memory schema ─────────────────────────────────────────────────────────
//
// Minimal union of what `_voidTransactionInternal`'s generic reversal chain
// touches for a `source_table: "recharges"`, `type: "WALLET_CASHOUT"` row
// whose supplier-ledger sibling entry_type is "PAYMENT": every OTHER
// reversal step in that chain is gated on a transaction `type`/`source_table`
// this row never carries (SALE, LOTO, EXCHANGE, SUPPLIER_SETTLEMENT, …) or on
// a `sqlite_master` table-existence probe (`partner_ledger`, `expenses`,
// `carrier_line_movements`) that safely no-ops when the table is absent — see
// this file's PR notes / the orchestrator's read of TransactionRepository.ts
// for the line-by-line proof. `debt_ledger` and `supplier_purchases` DO need
// to exist (empty) even though nothing here writes to them:
// `_cancelDebt` queries `debt_ledger` unconditionally (no table-existence
// guard, unlike the others), and voiding the auto sibling's own hidden
// SUPPLIER_PAYMENT transaction reaches `_unapplySupplierPurchaseCoverage`
// (gated on `type === "SUPPLIER_PAYMENT" && source_table === "supplier_ledger"`,
// which the hidden transaction IS), which queries `supplier_purchases`
// unconditionally once the ledger row's `entry_type` is "PAYMENT".
function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
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

    CREATE TABLE recharges (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier TEXT NOT NULL,
      recharge_type TEXT NOT NULL DEFAULT 'TOP_UP',
      amount REAL NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      paid_by TEXT DEFAULT 'SUPPLIER',
      created_by INTEGER DEFAULT 1,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      account_supplier_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO suppliers (id, name, provider, is_system) VALUES (1, 'OMT', 'OMT', 1);
    INSERT INTO suppliers (id, name, provider, is_system, account_supplier_id)
      VALUES (2, 'OMT App', 'OMT_APP', 0, 1);

    -- v136 shape: is_refunded/refunded_at (v120) + source_ref_table/id (v136).
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

    -- Empty on purpose (see header doc) — only needs to exist so
    -- _cancelDebt's unconditional SELECT doesn't throw "no such table".
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

    -- Empty on purpose (see header doc) — only needs to exist so
    -- _unapplySupplierPurchaseCoverage's unconditional SELECT (reached via
    -- the auto sibling's own hidden SUPPLIER_PAYMENT transaction) doesn't
    -- throw "no such table".
    CREATE TABLE supplier_purchases (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      paid_usd REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO drawer_balances VALUES (1, 'OMT_App', 'USD', ${OMT_APP_STARTING_BALANCE}, CURRENT_TIMESTAMP);
  `);

  return db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function omtAppSupplierId(db: Database.Database): number {
  const row = db
    .prepare(`SELECT id FROM suppliers WHERE provider = 'OMT_APP'`)
    .get() as { id: number };
  return row.id;
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

function txnStatus(db: Database.Database, id: number): string {
  const row = db
    .prepare(`SELECT status FROM transactions WHERE id = ?`)
    .get(id) as { status: string };
  return row.status;
}

function ledgerRowForRecharge(
  db: Database.Database,
  rechargeId: number,
): {
  id: number;
  amount_usd: number;
  transaction_id: number | null;
  is_refunded: number;
} {
  return db
    .prepare(
      `SELECT id, amount_usd, transaction_id, is_refunded FROM supplier_ledger
        WHERE source_ref_table = 'recharges' AND source_ref_id = ?`,
    )
    .get(rechargeId) as {
    id: number;
    amount_usd: number;
    transaction_id: number | null;
    is_refunded: number;
  };
}

/**
 * Insert the `recharges` row + the WALLET_CASHOUT unified transaction — the
 * part every scenario below shares regardless of how (correctly or
 * incorrectly) the wallet leg / ledger sibling get attached to it.
 */
function createCashoutParent(
  db: Database.Database,
  txnRepo: TransactionRepository,
): { rechargeId: number; cashoutTxnId: number } {
  const rechargeResult = db
    .prepare(
      `INSERT INTO recharges (carrier, recharge_type, amount, cost, price, currency_code, paid_by)
       VALUES ('OMT_APP', 'CASHOUT', ?, 0, 0, 'USD', 'SUPPLIER')`,
    )
    .run(CASHOUT_AMOUNT_USD);
  const rechargeId = Number(rechargeResult.lastInsertRowid);

  const cashoutTxnId = txnRepo.createTransaction({
    // `WALLET_CASHOUT` is added to `TRANSACTION_TYPES` (and thus the
    // `TransactionType` union `type` is checked against) by this same
    // batch's L3 lane (constants/transactionTypes.ts, fixed by the
    // implementation contract §2.2) — a parallel, in-flight file this test
    // does not import, so this is typed as a plain string literal rather
    // than importing the constant. It is a real member of the union by the
    // time the whole batch is assembled and typechecked together (the
    // owner's standing check cadence never typechecks mid-batch).
    type: "WALLET_CASHOUT",
    source_table: "recharges",
    source_id: rechargeId,
    user_id: 1,
    amount_usd: CASHOUT_AMOUNT_USD,
    amount_lbp: 0,
    exchange_rate: 90000,
    // D14 — commission is recognised at settlement (LIRA-189, wave 2), not
    // at creation; the cashout row stamps 0 profit even though the ledger
    // carries the full principal+commission from the moment the wallet
    // moves.
    profit_usd: 0,
    profit_lbp: 0,
    summary: `Cash Out to OMT: $${CASHOUT_AMOUNT_USD.toFixed(2)}`,
    metadata_json: {
      provider: "OMT_APP",
      amount: CASHOUT_AMOUNT_USD,
      currency: "USD",
      commission: CASHOUT_COMMISSION_USD,
    },
  });

  return { rechargeId, cashoutTxnId };
}

describe("LIRA-192 — WALLET_CASHOUT void/reversal", () => {
  let db: Database.Database;
  let txnRepo: TransactionRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    resetTransactionRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetSupplierRepository();
    resetTransactionRepository();
  });

  // ── (A) Correct shape: nets to 0 on void ───────────────────────────────────

  it("(A) voiding a WALLET_CASHOUT restores the OMT_App drawer AND soft-voids the 'OMT App' PAYMENT sibling — drawer, ledger and profit all net to 0", () => {
    const supplierId = omtAppSupplierId(db);
    const tenantId = getCurrentTenantId();
    const { rechargeId, cashoutTxnId } = createCashoutParent(db, txnRepo);

    // Wallet leg: a REAL payments row on the WALLET_CASHOUT transaction
    // (contract step 5) — this is what makes it visible to the generic
    // `_reversePayments` mirror-and-negate step.
    insertPaymentRow(db, {
      transactionId: cashoutTxnId,
      method: "OMT_APP_CASHOUT",
      drawerName: "OMT_App",
      currencyCode: "USD",
      amount: -CASHOUT_AMOUNT_USD,
      note: "Cash Out to OMT",
      createdBy: 1,
      tenantId,
    });
    applyDrawerDelta(db, {
      drawerName: "OMT_App",
      currencyCode: "USD",
      delta: -CASHOUT_AMOUNT_USD,
      tenantId,
    });

    // Ledger sibling: is_auto:true, source_ref back-linked to the SAME
    // recharges row the WALLET_CASHOUT transaction is sourced from (contract
    // step 6) — no drawer_name (the wallet leg already lives on our own
    // transaction above; passing drawer_name here would double-move money),
    // no transaction_id (link-mode and source_ref are mutually exclusive —
    // addLedgerEntry throws if both are set).
    getSupplierRepository().addLedgerEntry({
      supplier_id: supplierId,
      entry_type: "PAYMENT",
      amount_usd: CASHOUT_AMOUNT_USD + CASHOUT_COMMISSION_USD,
      amount_lbp: 0,
      note: "Cash Out to OMT: $100.00 + 0.1% commission ($0.10)",
      created_by: 1,
      is_auto: true,
      source_ref_table: "recharges",
      source_ref_id: rechargeId,
    });

    // ── Before ──
    expect(drawerBalance(db, "OMT_App", "USD")).toBe(
      OMT_APP_STARTING_BALANCE - CASHOUT_AMOUNT_USD,
    );
    const ledgerBefore = ledgerRowForRecharge(db, rechargeId);
    expect(ledgerBefore.amount_usd).toBeCloseTo(
      -(CASHOUT_AMOUNT_USD + CASHOUT_COMMISSION_USD),
      2,
    );
    expect(ledgerBefore.is_refunded).toBe(0);
    const siblingTxnId = ledgerBefore.transaction_id!;
    expect(siblingTxnId).toBeTruthy();
    expect(txnStatus(db, siblingTxnId)).toBe("ACTIVE");
    expect(getSupplierRepository().getSupplierBalance(supplierId).balance_usd).toBeCloseTo(
      -(CASHOUT_AMOUNT_USD + CASHOUT_COMMISSION_USD),
      2,
    );

    // ── Act: void the parent WALLET_CASHOUT transaction ──
    txnRepo.voidTransaction(cashoutTxnId, 1);

    // ── After: drawer delta nets to 0 ──
    expect(drawerBalance(db, "OMT_App", "USD")).toBe(OMT_APP_STARTING_BALANCE);

    // ── After: ledger sibling soft-voided via the pre-existing LIRA-091
    // cascade, its own hidden SUPPLIER_PAYMENT transaction voided ──
    const ledgerAfter = ledgerRowForRecharge(db, rechargeId);
    expect(ledgerAfter.is_refunded).toBe(1);
    expect(txnStatus(db, siblingTxnId)).toBe("VOIDED");
    expect(getSupplierRepository().getSupplierBalance(supplierId).balance_usd).toBe(
      0,
    );

    // ── After: profit nets to 0 (trivially true — D14 stamps 0 at creation
    // — but asserted explicitly since it's part of rule 20's proof
    // obligation, and to guard against a future change that starts stamping
    // profit at creation without updating the reversal). Only ACTIVE rows
    // count; the voided original and its VOIDED reversal children are what
    // keep this at 0 either way. ──
    const profit = db
      .prepare(
        `SELECT COALESCE(SUM(profit_usd), 0) AS p FROM transactions
          WHERE source_table = 'recharges' AND source_id = ? AND status = 'ACTIVE'`,
      )
      .get(rechargeId) as { p: number };
    expect(profit.p).toBe(0);

    // ── Sanity: the recharges row itself was marked refunded too (the
    // pre-existing generic `_markSourceRefunded` step, untouched) ──
    const recharge = db
      .prepare(`SELECT is_refunded FROM recharges WHERE id = ?`)
      .get(rechargeId) as { is_refunded: number };
    expect(recharge.is_refunded).toBe(1);
  });

  // ── (B) FAILING-FIRST capture: bare drawer UPDATE instead of a payments row ──

  it("(B) FAILING-FIRST capture: a bare drawer-balance mutation (no payments row) never comes back on void — the exact 'do not bare-UPDATE the balance' bug the contract calls out", () => {
    const supplierId = omtAppSupplierId(db);
    const tenantId = getCurrentTenantId();
    const { rechargeId, cashoutTxnId } = createCashoutParent(db, txnRepo);

    // BUG SHAPE: move the drawer directly, with NO corresponding `payments`
    // row tied to `cashoutTxnId`. `_reversePayments` can only mirror rows it
    // can find by `transaction_id` — there is nothing here for it to find.
    applyDrawerDelta(db, {
      drawerName: "OMT_App",
      currencyCode: "USD",
      delta: -CASHOUT_AMOUNT_USD,
      tenantId,
    });

    // Ledger sibling is correctly linked, isolating the bug to the drawer
    // side only.
    getSupplierRepository().addLedgerEntry({
      supplier_id: supplierId,
      entry_type: "PAYMENT",
      amount_usd: CASHOUT_AMOUNT_USD + CASHOUT_COMMISSION_USD,
      amount_lbp: 0,
      note: "Cash Out to OMT (bug-shape B)",
      created_by: 1,
      is_auto: true,
      source_ref_table: "recharges",
      source_ref_id: rechargeId,
    });

    expect(drawerBalance(db, "OMT_App", "USD")).toBe(
      OMT_APP_STARTING_BALANCE - CASHOUT_AMOUNT_USD,
    );

    txnRepo.voidTransaction(cashoutTxnId, 1);

    // BUG: the drawer never comes back — stuck at 400, not restored to 500.
    expect(drawerBalance(db, "OMT_App", "USD")).toBe(
      OMT_APP_STARTING_BALANCE - CASHOUT_AMOUNT_USD,
    );

    // The ledger side, unaffected by this particular bug, still nets to 0 —
    // proving the drawer is the ONLY thing broken by this shape.
    expect(getSupplierRepository().getSupplierBalance(supplierId).balance_usd).toBe(
      0,
    );
  });

  // ── (C) FAILING-FIRST capture: is_auto without source_ref ──────────────────

  it("(C) FAILING-FIRST capture: an is_auto ledger sibling with NO source_ref back-link is invisible to the void cascade — the account stays wrong forever", () => {
    const supplierId = omtAppSupplierId(db);
    const tenantId = getCurrentTenantId();
    const { rechargeId, cashoutTxnId } = createCashoutParent(db, txnRepo);

    // Wallet leg correct — isolates the bug to the ledger side only.
    insertPaymentRow(db, {
      transactionId: cashoutTxnId,
      method: "OMT_APP_CASHOUT",
      drawerName: "OMT_App",
      currencyCode: "USD",
      amount: -CASHOUT_AMOUNT_USD,
      note: "Cash Out to OMT",
      createdBy: 1,
      tenantId,
    });
    applyDrawerDelta(db, {
      drawerName: "OMT_App",
      currencyCode: "USD",
      delta: -CASHOUT_AMOUNT_USD,
      tenantId,
    });

    // BUG SHAPE: is_auto:true (so addLedgerEntry still creates its own
    // hidden SUPPLIER_PAYMENT transaction, same as the correct shape) but NO
    // source_ref_table/source_ref_id — `_cascadeSupplierSiblingVoid`'s query
    // filters on `source_ref_table = ? AND source_ref_id = ?`, which a NULL
    // row can never match.
    getSupplierRepository().addLedgerEntry({
      supplier_id: supplierId,
      entry_type: "PAYMENT",
      amount_usd: CASHOUT_AMOUNT_USD + CASHOUT_COMMISSION_USD,
      amount_lbp: 0,
      note: "Cash Out to OMT (bug-shape C)",
      created_by: 1,
      is_auto: true,
      // source_ref_table / source_ref_id deliberately omitted.
    });

    const balanceBefore =
      getSupplierRepository().getSupplierBalance(supplierId).balance_usd;
    expect(balanceBefore).toBeCloseTo(
      -(CASHOUT_AMOUNT_USD + CASHOUT_COMMISSION_USD),
      2,
    );

    txnRepo.voidTransaction(cashoutTxnId, 1);

    // The drawer, unaffected by this particular bug, comes back correctly —
    // proving the ledger is the ONLY thing broken by this shape.
    expect(drawerBalance(db, "OMT_App", "USD")).toBe(OMT_APP_STARTING_BALANCE);

    // BUG: the ledger row is never found by the cascade, so it stays
    // un-refunded and the account keeps showing OMT owing the shop forever.
    const ledgerAfter = db
      .prepare(
        `SELECT is_refunded FROM supplier_ledger WHERE supplier_id = ? AND note = 'Cash Out to OMT (bug-shape C)'`,
      )
      .get(supplierId) as { is_refunded: number };
    expect(ledgerAfter.is_refunded).toBe(0);
    expect(getSupplierRepository().getSupplierBalance(supplierId).balance_usd).toBe(
      balanceBefore,
    );
  });
});
