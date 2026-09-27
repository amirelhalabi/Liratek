/**
 * LIRA-229 — reproduction (rule 17/28): does a sale's draft autosave write a
 * fresh `type = 'SALE'` transactions row on EVERY `processSale` call,
 * including a resave that only edits the SAME draft, and again on that
 * draft's completion? And does deleting a draft (the POS "cancel" flow —
 * `deleteDraft`, called from `handleCancelOrder`) leave any of those rows
 * behind, orphaned, still ACTIVE, and still counted by Profits?
 *
 * Pre-fix, both were true: every processSale call — draft autosave, draft
 * resave, and completion alike — unconditionally inserted a fresh ACTIVE
 * `type = 'SALE'` row, and a resave's DELETE-then-reinsert of `payments`
 * never reversed the drawer delta a prior insert had applied.
 *
 * Fix (owner design decision, overriding an earlier "reuse/update-in-place"
 * draft): the sale's lifecycle lives entirely in `sales.status`
 * (draft/completed/cancelled), updated in place. A DRAFT writes NO row to
 * the `transactions` money ledger at all — no transaction row, no payment
 * legs, no drawer delta, no debt/partner-ledger entry, no stock movement.
 * The ONE SALE transaction is written exactly once, the moment the sale
 * becomes `completed` (see the `status === "completed"` gate in
 * `SalesRepository.processSale`). Cancelling a draft (`deleteDraft`) is
 * therefore a plain delete with nothing to reverse — nothing was ever
 * posted. (Investigated per the ticket's own prompt: could a draft carry
 * real payment legs? In the ORIGINAL code, yes — `payment_usd`/`payment_lbp`
 * drove the same unconditional posting loop a completed sale used, with no
 * `status` gate at all; that gap is exactly what closes here.)
 *
 * `SalesRepository.processSale` is the ONLY writer under test — no IPC/REST
 * layer is driven, but `SalesService.processSale`/`SalesRepository.deleteDraft`
 * are both pure passthroughs to this repository, so this is the real code
 * path both the Electron IPC handler (`sales:process`) and the REST route
 * (`POST /api/sales/process`, `backend/src/api/sales.ts`) hit on both
 * transports.
 *
 * Uses the same hand-built schema pattern as
 * `SalesRepository.txnAmountStamp.test.ts` (sibling file in this directory).
 */

import Database from "better-sqlite3";
import { SalesRepository } from "../SalesRepository.js";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );

    CREATE TABLE clients (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name       TEXT NOT NULL,
      phone_number    TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      tenant_id       INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT NOT NULL,
      cost_price_usd REAL NOT NULL DEFAULT 0,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      warranty_months INTEGER,
      tenant_id      INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE sales (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id              INTEGER,
      total_amount_usd       REAL NOT NULL DEFAULT 0,
      discount_usd           REAL NOT NULL DEFAULT 0,
      final_amount_usd       REAL NOT NULL DEFAULT 0,
      paid_usd               REAL NOT NULL DEFAULT 0,
      paid_lbp               REAL NOT NULL DEFAULT 0,
      change_given_usd       REAL NOT NULL DEFAULT 0,
      change_given_lbp       REAL NOT NULL DEFAULT 0,
      exchange_rate_snapshot REAL,
      drawer_name            TEXT DEFAULT 'General',
      status                 TEXT NOT NULL DEFAULT 'completed',
      note                   TEXT,
      edited_by              TEXT,
      edited_at              TEXT,
      tenant_id              INTEGER NOT NULL DEFAULT 1,
      created_at             TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at             TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sale_items (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id                 INTEGER NOT NULL,
      product_id              INTEGER,
      quantity                INTEGER NOT NULL DEFAULT 1,
      sold_price_usd          REAL NOT NULL DEFAULT 0,
      cost_price_snapshot_usd REAL NOT NULL DEFAULT 0,
      imei                    TEXT,
      warranty_until          TEXT,
      is_refunded             INTEGER NOT NULL DEFAULT 0,
      refunded_quantity       INTEGER NOT NULL DEFAULT 0,
      tenant_id               INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table  TEXT,
      source_id     INTEGER,
      user_id       INTEGER,
      amount_usd    REAL NOT NULL DEFAULT 0,
      amount_lbp    REAL NOT NULL DEFAULT 0,
      profit_usd    REAL NOT NULL DEFAULT 0,
      profit_lbp    REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id     INTEGER,
      client_name   TEXT,
      client_phone  TEXT,
      reverses_id   INTEGER,
      summary       TEXT,
      metadata_json TEXT,
      device_id     TEXT,
      tenant_id     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      tenant_id      INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id     INTEGER NOT NULL DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance, updated_at) VALUES (1, 'General', 'USD', 500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance, updated_at) VALUES (1, 'General', 'LBP', 20000000, CURRENT_TIMESTAMP);

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL,
      transaction_id   INTEGER,
      note             TEXT,
      due_date         TEXT,
      created_by       INTEGER,
      tenant_id        INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    -- See CLAUDE.md "Test schemas silently void whole files" — SalesRepository
    -- unconditionally touches these two tables even for products with no
    -- batch history.
    CREATE TABLE product_stock_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      product_id INTEGER NOT NULL,
      supplier_id INTEGER,
      quantity INTEGER NOT NULL,
      quantity_remaining INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      books_debt INTEGER NOT NULL DEFAULT 0,
      ledger_entry_id INTEGER,
      transaction_id INTEGER,
      is_opening INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE stock_batch_consumptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      batch_id INTEGER NOT NULL,
      sale_item_id INTEGER,
      custom_service_id INTEGER,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL,
      reason TEXT NOT NULL DEFAULT 'SALE',
      is_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      maintenance_part_id INTEGER
    );
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
  db.prepare(
    `INSERT INTO products (id, name, cost_price_usd, stock_quantity)
     VALUES (1, 'Phone case', 3, 10)`,
  ).run();
  return db;
}

function countSaleTxns(
  db: Database.Database,
  saleId: number,
): { total: number; active: number } {
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`,
      )
      .get(saleId) as { c: number }
  ).c;
  const active = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE' AND status = 'ACTIVE'`,
      )
      .get(saleId) as { c: number }
  ).c;
  return { total, active };
}

function generalUsdBalance(db: Database.Database): number {
  return (
    db
      .prepare(
        `SELECT balance FROM drawer_balances WHERE tenant_id = 1 AND drawer_name = 'General' AND currency_code = 'USD'`,
      )
      .get() as { balance: number }
  ).balance;
}

function paymentsCountForSale(db: Database.Database, saleId: number): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM payments p
         JOIN transactions t ON t.id = p.transaction_id
         WHERE t.source_table = 'sales' AND t.source_id = ?`,
      )
      .get(saleId) as { c: number }
  ).c;
}

function stockQty(db: Database.Database, productId: number): number {
  return (
    db
      .prepare(`SELECT stock_quantity FROM products WHERE id = ?`)
      .get(productId) as { stock_quantity: number }
  ).stock_quantity;
}

describe("LIRA-229 — draft autosave / resave / complete / cancel write a fresh SALE transaction row every time", () => {
  let db: Database.Database;
  let repo: SalesRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new SalesRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  it("draft -> autosave resave x2 -> complete: exactly ONE SALE transaction row survives ACTIVE, and the drawer is credited exactly once for the money actually taken", () => {
    const baseItems = [{ product_id: 1, quantity: 1, price: 8 }];

    // 1) Save as draft. Mirrors POS handleSaveDraft/autosave: partial
    // pre-payment info can already be on the checkout form at draft time
    // (pendingCheckoutData.paidUSD), so the draft itself carries a non-zero
    // payment_usd — exactly the "can a DRAFT carry payments/legs" case the
    // ticket asks to check first.
    const draft = repo.processSale(
      {
        client_id: null,
        items: baseItems,
        total_amount: 8,
        discount: 0,
        final_amount: 8,
        payment_usd: 5,
        payment_lbp: 0,
        exchange_rate: 90_000,
        status: "draft",
      },
      1,
    );
    expect(draft.success).toBe(true);
    const saleId = draft.id!;

    // 2) Autosave resave #1 — same draft id, same $5 pre-payment re-sent
    // (this is exactly what the POS autosave effect re-sends every debounce
    // tick while the draft is open).
    const resave1 = repo.processSale(
      {
        id: saleId,
        client_id: null,
        items: baseItems,
        total_amount: 8,
        discount: 0,
        final_amount: 8,
        payment_usd: 5,
        payment_lbp: 0,
        exchange_rate: 90_000,
        status: "draft",
      },
      1,
    );
    expect(resave1.success).toBe(true);
    expect(resave1.id).toBe(saleId);

    // Owner design decision: a DRAFT writes NO row to the transactions
    // money ledger at all — money posts exactly once, on completion. Two
    // draft saves in (with a non-zero payment_usd on both), there must
    // still be zero SALE transaction rows and the drawer must be
    // untouched.
    expect(countSaleTxns(db, saleId)).toEqual({ total: 0, active: 0 });
    expect(generalUsdBalance(db)).toBe(500);

    // 3) Autosave resave #2.
    const resave2 = repo.processSale(
      {
        id: saleId,
        client_id: null,
        items: baseItems,
        total_amount: 8,
        discount: 0,
        final_amount: 8,
        payment_usd: 5,
        payment_lbp: 0,
        exchange_rate: 90_000,
        status: "draft",
      },
      1,
    );
    expect(resave2.success).toBe(true);

    // 4) Complete the draft — the customer actually pays the full $8 now.
    const completed = repo.processSale(
      {
        id: saleId,
        client_id: null,
        items: baseItems,
        total_amount: 8,
        discount: 0,
        final_amount: 8,
        payment_usd: 8,
        payment_lbp: 0,
        exchange_rate: 90_000,
        status: "completed",
      },
      1,
    );
    expect(completed.success).toBe(true);

    const { total, active } = countSaleTxns(db, saleId);
    // eslint-disable-next-line no-console
    console.log("LIRA-229 repro — SALE txn rows for one sale:", {
      total,
      active,
    });
    // ACTIVE invariant this ticket targets: at most one ACTIVE SALE row per
    // sale, at any time.
    expect(active).toBeLessThanOrEqual(1);

    // The drawer must reflect the money ACTUALLY taken from the customer
    // (the final $8 the completed sale charged), not the sum of every
    // autosave's payment_usd replayed on top of each other ($5+$5+$5+$8=23).
    const usdBalance = generalUsdBalance(db);
    // eslint-disable-next-line no-console
    console.log("LIRA-229 repro — General/USD drawer balance:", usdBalance);
    expect(usdBalance).toBe(500 + 8);

    // Exactly one payments row should exist for this sale (the completed
    // sale's $8 leg) — no orphaned draft-stage payment rows.
    expect(paymentsCountForSale(db, saleId)).toBe(1);

    // Stock must be decremented exactly once (on completion), never on a
    // draft save.
    expect(stockQty(db, 1)).toBe(9);
  });

  it("draft -> cancel (deleteDraft, the POS handleCancelOrder path): no ACTIVE SALE transaction row is left orphaned", () => {
    const draft = repo.processSale(
      {
        client_id: null,
        items: [{ product_id: 1, quantity: 1, price: 8 }],
        total_amount: 8,
        discount: 0,
        final_amount: 8,
        payment_usd: 0,
        payment_lbp: 0,
        exchange_rate: 90_000,
        status: "draft",
      },
      1,
    );
    expect(draft.success).toBe(true);
    const saleId = draft.id!;

    // Owner design decision: a draft never wrote a transactions row in the
    // first place, so there is nothing to reverse on cancel.
    expect(countSaleTxns(db, saleId)).toEqual({ total: 0, active: 0 });

    const del = repo.deleteDraft(saleId);
    expect(del.success).toBe(true);

    // The sales row is gone...
    const saleRow = db.prepare(`SELECT id FROM sales WHERE id = ?`).get(saleId);
    expect(saleRow).toBeUndefined();

    // ...and still no orphaned ACTIVE 'SALE' transaction row (source_id
    // pointing at a now-deleted sale) survives, readable by Profits.
    const { total, active } = countSaleTxns(db, saleId);
    // eslint-disable-next-line no-console
    console.log("LIRA-229 repro — orphaned SALE txn rows after cancel:", {
      total,
      active,
    });
    expect(active).toBe(0);
    expect(total).toBe(0);
    expect(generalUsdBalance(db)).toBe(500);
  });

  it("baseline: a normal one-shot completed sale (no draft stage) writes exactly one ACTIVE SALE row", () => {
    const res = repo.processSale(
      {
        client_id: null,
        items: [{ product_id: 1, quantity: 1, price: 8 }],
        total_amount: 8,
        discount: 0,
        final_amount: 8,
        payment_usd: 8,
        payment_lbp: 0,
        exchange_rate: 90_000,
        status: "completed",
      },
      1,
    );
    expect(res.success).toBe(true);
    const { total, active } = countSaleTxns(db, res.id!);
    expect(total).toBe(1);
    expect(active).toBe(1);
  });

  it("draft resaved with a partial pre-payment, then completed on-account: the remainder is booked to debt_ledger exactly ONCE", () => {
    db.prepare(
      `INSERT INTO clients (id, full_name, phone_number) VALUES (1, 'Jad', '71000000')`,
    ).run();

    const draft = repo.processSale(
      {
        id: undefined,
        client_id: 1,
        items: [{ product_id: 1, quantity: 1, price: 20 }],
        total_amount: 20,
        discount: 0,
        final_amount: 20,
        payment_usd: 5,
        payment_lbp: 0,
        exchange_rate: 90_000,
        status: "draft",
      },
      1,
    );
    expect(draft.success).toBe(true);
    const saleId = draft.id!;

    // Autosave resave, same $5 pre-payment re-sent.
    const resave = repo.processSale(
      {
        id: saleId,
        client_id: 1,
        items: [{ product_id: 1, quantity: 1, price: 20 }],
        total_amount: 20,
        discount: 0,
        final_amount: 20,
        payment_usd: 5,
        payment_lbp: 0,
        exchange_rate: 90_000,
        status: "draft",
      },
      1,
    );
    expect(resave.success).toBe(true);

    // Complete on-account: still only $5 paid, $15 remainder goes to debt.
    const completed = repo.processSale(
      {
        id: saleId,
        client_id: 1,
        items: [{ product_id: 1, quantity: 1, price: 20 }],
        total_amount: 20,
        discount: 0,
        final_amount: 20,
        payment_usd: 5,
        payment_lbp: 0,
        exchange_rate: 90_000,
        status: "completed",
      },
      1,
    );
    expect(completed.success).toBe(true);

    const { active } = countSaleTxns(db, saleId);
    expect(active).toBe(1);

    const debtRows = db
      .prepare(
        `SELECT amount_usd FROM debt_ledger WHERE client_id = 1 AND transaction_type = 'Sale Debt'`,
      )
      .all() as { amount_usd: number }[];
    expect(debtRows).toHaveLength(1);
    expect(debtRows[0].amount_usd).toBeCloseTo(15, 6);

    // Only $5 ever actually moved into the drawer (the debt covers the rest).
    expect(generalUsdBalance(db)).toBe(500 + 5);
  });

  it("void of a sale that went through draft -> resave -> complete still reverses correctly: drawer, stock and the ACTIVE-row invariant all restore", () => {
    const baseItems = [{ product_id: 1, quantity: 1, price: 8 }];

    const draft = repo.processSale(
      {
        client_id: null,
        items: baseItems,
        total_amount: 8,
        discount: 0,
        final_amount: 8,
        payment_usd: 0,
        payment_lbp: 0,
        exchange_rate: 90_000,
        status: "draft",
      },
      1,
    );
    const saleId = draft.id!;

    repo.processSale(
      {
        id: saleId,
        client_id: null,
        items: baseItems,
        total_amount: 8,
        discount: 0,
        final_amount: 8,
        payment_usd: 8,
        payment_lbp: 0,
        exchange_rate: 90_000,
        status: "completed",
      },
      1,
    );

    expect(stockQty(db, 1)).toBe(9);
    expect(generalUsdBalance(db)).toBe(500 + 8);

    const { active: activeBefore } = countSaleTxns(db, saleId);
    expect(activeBefore).toBe(1);

    const saleTxnRow = db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE' AND status = 'ACTIVE'`,
      )
      .get(saleId) as { id: number };

    getTransactionRepository().voidTransaction(saleTxnRow.id, 1);

    // Exactly one ACTIVE SALE row remains — the void's own negated
    // reversal row — never the voided original AND never a leftover
    // duplicate from the draft stage.
    const { total: totalAfter, active: activeAfter } = countSaleTxns(
      db,
      saleId,
    );
    expect(totalAfter).toBe(2); // original (VOIDED) + reversal (ACTIVE)
    expect(activeAfter).toBe(1);

    // Money and stock both net back to exactly where they started.
    expect(generalUsdBalance(db)).toBe(500);
    expect(stockQty(db, 1)).toBe(10);

    const saleRow = db
      .prepare(`SELECT status FROM sales WHERE id = ?`)
      .get(saleId) as { status: string };
    expect(saleRow.status).toBe("cancelled");
  });
});
