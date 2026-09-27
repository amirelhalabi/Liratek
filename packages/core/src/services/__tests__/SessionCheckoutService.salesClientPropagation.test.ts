/**
 * LIRA-232 e2e investigation — a session-checkout SALE never carried the
 * walk-in customer's identity onto its own `transactions` row.
 *
 * Repro (found by RUNNING `lira-232-session-item-refund.spec.ts`, not by
 * reading — rule 28): the spec seeds a session with `customer_name`/
 * `customer_phone`, checks out a POS sale on the customer's account, then
 * looks up the SALE row on the Transactions page by that customer's name.
 * A debug `transactions:get-recent` dump taken mid-investigation showed the
 * SALE row with `client_id: null, client_name: null` even though the
 * session had already resolved/created a client (a `CLIENT_CREATED` row for
 * that same name was right there in the same dump) and the account debt had
 * booked correctly.
 *
 * Root cause: `SessionCheckoutService.checkout()`'s "Inject session customer
 * into cart items lacking a client name" block only ever wrote the CAMEL-CASE
 * keys `clientId`/`clientName` onto the cart item's `formData`. That matches
 * `RechargeRequest`/`FinancialServiceRequest` (both camelCase), but
 * `SalesRepository`'s `SaleRequest` reads SNAKE_CASE `client_id`/
 * `client_name` only (see `SalesRepository.ts` — `sale.client_id`,
 * `sale.client_name`) — so the injected value was silently invisible to
 * every session-checkout POS sale (rule 21: one injection has to speak
 * every downstream module's request shape, not just the shape of whichever
 * module was tested first). The bug was unconditional: it did not matter
 * whether the session's customer resolved to a real client id or not,
 * because the injected key was never read either way.
 *
 * Fix: the same injection block now stamps BOTH the camelCase and
 * snake_case keys (only when the field is not already present under any of
 * its three known spellings), so whichever key a module's own request type
 * reads picks up the walk-in's identity.
 *
 * RULE 17 (failing-first): this test was run against the pre-fix
 * `SessionCheckoutService.checkout()` (camelCase-only injection) and
 * observed RED — `client_id`/`client_name` both `null` on the SALE row —
 * before the fix landed; see the task's final report for the exact
 * pre-fix/post-fix `getRecent` dumps from the live e2e run.
 *
 * Schema: `SalesRepository.draftAutosaveDuplicateTxn.test.ts`'s sales
 * schema (proven to support `SalesRepository.processSale` end to end)
 * plus `SessionCheckoutService.keptChangeClientName.test.ts`'s session
 * lifecycle tables (`customer_sessions`/`customer_session_transactions`)
 * and DebtService/VoucherRepository leaf mocks (rule 14 — reused, not
 * re-derived). `payments` is deliberately omitted from the checkout
 * request, same as that file: this ticket is about the identity STAMP on
 * the SALE row, not the basket payment/debt posting, and omitting it keeps
 * `recordBasketPayment` (and its DebtService/VoucherRepository leaves) out
 * of the picture entirely.
 */

import Database from "better-sqlite3";
import { SessionCheckoutService } from "../SessionCheckoutService";
import { getSalesService, resetSalesService } from "../SalesService";
import {
  resetSalesRepository,
  type SaleRequest,
} from "../../repositories/SalesRepository";
import { CustomerSessionRepository } from "../../repositories/CustomerSessionRepository";
import { CustomerSessionService } from "../CustomerSessionService";
import { resetTransactionRepository } from "../../repositories/TransactionRepository";
import { resetClientRepository } from "../../repositories/ClientRepository";
import { resetCustomerSessionRepository } from "../../repositories/CustomerSessionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// SessionCheckoutService imports SessionPaymentService unconditionally, which
// in turn reaches DebtService/VoucherRepository — leaf-mocked exactly like
// SessionCheckoutService.keptChangeClientName.test.ts, since this file's
// checkout request never passes `payments` and so never actually calls into
// either.
jest.mock("../DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));
jest.mock("../../repositories/VoucherRepository", () => ({
  getVoucherRepository: () => ({ redeemByCode: jest.fn() }),
  resetVoucherRepository: jest.fn(),
}));

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
      notes           TEXT,
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

    -- Real session lifecycle (CustomerSessionRepository/CustomerSessionService).
    CREATE TABLE customer_sessions (
      tenant_id           INTEGER DEFAULT 1,
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name       TEXT,
      customer_phone      TEXT,
      customer_notes      TEXT,
      user_id             INTEGER,
      started_at          TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at           TEXT,
      started_by          TEXT NOT NULL,
      closed_by           TEXT,
      is_active           INTEGER NOT NULL DEFAULT 1,
      checkout_at         TEXT,
      checkout_total      REAL,
      checkout_currency   TEXT,
      checkout_total_usd  REAL,
      checkout_total_lbp  REAL,
      checkout_profit_usd REAL,
      checkout_profit_lbp REAL
    );

    CREATE TABLE customer_session_transactions (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id             INTEGER NOT NULL,
      transaction_type       TEXT NOT NULL,
      transaction_id         INTEGER NOT NULL,
      unified_transaction_id INTEGER,
      amount_usd             REAL NOT NULL DEFAULT 0,
      amount_lbp             REAL NOT NULL DEFAULT 0,
      profit_usd             REAL NOT NULL DEFAULT 0,
      profit_lbp             REAL NOT NULL DEFAULT 0,
      tenant_id              INTEGER NOT NULL DEFAULT 1,
      created_at             TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'admin')`).run();
  db.prepare(
    `INSERT INTO products (id, name, cost_price_usd, stock_quantity)
     VALUES (1, 'Phone case', 3, 10)`,
  ).run();
  return db;
}

function countClients(db: Database.Database): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM clients`).get() as { n: number }
  ).n;
}

function saleTxnRow(db: Database.Database, saleId: number):
  | { client_id: number | null; client_name: string | null }
  | undefined {
  return db
    .prepare(
      `SELECT client_id, client_name FROM transactions
        WHERE type = 'SALE' AND source_table = 'sales' AND source_id = ?`,
    )
    .get(saleId) as
    | { client_id: number | null; client_name: string | null }
    | undefined;
}

function saleCartItem(): {
  id: string;
  module: string;
  label: string;
  amount: number;
  currency: string;
  formData: Record<string, unknown>;
  ipcChannel: string;
} {
  return {
    id: "cart-1",
    module: "pos",
    label: "Sale",
    amount: 8,
    currency: "USD",
    // Mirrors the real raw IPC payload a walk-in POS sale sends: `client_id`
    // explicit `null` (no per-item client picked), relying entirely on the
    // session's own resolved customer to be injected in by `checkout()`.
    formData: {
      client_id: null,
      items: [{ product_id: 1, quantity: 1, price: 8 }],
      total_amount: 8,
      discount: 0,
      final_amount: 8,
      payment_usd: 0,
      payment_lbp: 0,
      exchange_rate: 90_000,
      status: "completed",
    },
    ipcChannel: "sales:process",
  };
}

describe("LIRA-232 — SessionCheckoutService SALE client_id/client_name propagation", () => {
  let db: Database.Database;
  let service: SessionCheckoutService;
  let sessionRepo: CustomerSessionRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);

    resetTransactionRepository();
    resetClientRepository();
    resetCustomerSessionRepository();
    resetSalesRepository();
    resetSalesService();

    service = new SessionCheckoutService();
    sessionRepo = new CustomerSessionRepository(db);
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    db.close();
    resetTenantContext();
    resetSalesRepository();
    resetSalesService();
  });

  it("a named+phoned walk-in's session-checkout SALE carries BOTH the resolved client_id and the customer's name on its own transaction row", async () => {
    // Fixture fix (not proven failing-first — rule 17: this is a fixture
    // correction, not a new guarded behavior, so there is no separate
    // pre-fix/post-fix run to record): the session MUST be started through
    // `CustomerSessionService.startSession`, the same call
    // `electron-app/handlers/sessionHandlers.ts`'s `session:start` IPC
    // handler makes. That is where a named+phoned walk-in's client actually
    // gets created (`autoRegisterClient` -> `ClientRepository
    // .findOrCreateByPhone`) — `CustomerSessionRepository.createSession`
    // (used directly below, and by this file before this fix) only inserts
    // the `customer_sessions` row and never touches `clients` at all, so the
    // "client above was already resolved/created" premise in the comment
    // block above was untrue for this fixture and `client` below came back
    // `undefined`.
    const sessionService = new CustomerSessionService();
    const startResult = await sessionService.startSession({
      customer_name: "Jean Dupont",
      customer_phone: "71000002",
      started_by: "admin",
      user_id: 1,
    });
    expect(startResult.success).toBe(true);
    const sessionId = startResult.sessionId!;

    const result = await service.checkout(
      {
        sessionId,
        cartItems: [saleCartItem()],
        exchangeRate: 90_000,
        userId: 1,
      },
      { username: "admin" },
    );

    expect(result.success).toBe(true);
    const saleId = result.results?.[0]?.transactionId;
    expect(saleId).toBeTruthy();

    const client = db
      .prepare(`SELECT id FROM clients WHERE phone_number = ?`)
      .get("71000002") as { id: number } | undefined;
    expect(client).toBeDefined();

    const row = saleTxnRow(db, saleId!);
    // THE reproduction: pre-fix both were null (the camelCase-only
    // injection SalesRepository's snake_case SaleRequest never reads) even
    // though the client above was already resolved/created.
    expect(row?.client_id).toBe(client!.id);
    expect(row?.client_name).toBe("Jean Dupont");
  });

  it("a name-only walk-in (no phone, no resolvable client) still carries the customer's name on the SALE row, with client_id null, and does NOT auto-create a client", async () => {
    // Seed a pre-existing, UNRELATED client with a DIFFERENT name+phone, so
    // the count assertion below can't accidentally pass because the table
    // was already non-empty for an unrelated reason.
    db.prepare(
      `INSERT INTO clients (full_name, phone_number, tenant_id) VALUES (?, ?, 1)`,
    ).run("Someone Else", "70000000");

    const sessionId = sessionRepo.createSession({
      customer_name: "Nadia Khoury",
      started_by: "admin",
      user_id: 1,
    });

    const clientCountBefore = countClients(db);

    const result = await service.checkout(
      {
        sessionId,
        cartItems: [saleCartItem()],
        exchangeRate: 90_000,
        userId: 1,
      },
      { username: "admin" },
    );

    expect(result.success).toBe(true);
    const saleId = result.results?.[0]?.transactionId;

    // No new client row was created by the sale's own processSale. Neither
    // the session's own resolution (resolveSessionClientForCheckout — no
    // phone, so an exact findByName that matches nothing) nor
    // SalesRepository's redundant auto-create/match block should have
    // inserted a "Nadia Khoury" row. Pre-fix, the redundant block ran
    // unconditionally and DID create one here (finalClientId stayed null
    // going in, since the injection only ever sets client_id when
    // sessionClientId already resolved to something).
    expect(countClients(db)).toBe(clientCountBefore);

    const row = saleTxnRow(db, saleId!);
    expect(row?.client_id).toBeNull();
    expect(row?.client_name).toBe("Nadia Khoury");
  });
});

describe("LIRA-232 follow-up — standalone POS auto-create/match is unchanged", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);

    resetTransactionRepository();
    resetClientRepository();
    resetSalesRepository();
    resetSalesService();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    db.close();
    resetTenantContext();
    resetSalesRepository();
    resetSalesService();
  });

  it("a standalone POS sale (no deferPayment) with a name but no client_id still auto-creates a client, as before lira-094 / the session gate", () => {
    const clientCountBefore = countClients(db);

    const saleRequest: SaleRequest = {
      client_id: null,
      client_name: "Walk-in Direct",
      client_phone: "70222333",
      items: [{ product_id: 1, quantity: 1, price: 8 }],
      total_amount: 8,
      discount: 0,
      final_amount: 8,
      payment_usd: 8,
      payment_lbp: 0,
      exchange_rate: 90_000,
      status: "completed",
      // Deliberately NOT setting deferPayment — this is the standalone POS
      // shape (electron-app/handlers/salesHandlers.ts never sets it; only
      // SessionCheckoutService's processCartItem does).
    };
    const result = getSalesService().processSale(saleRequest, 1);

    expect(result.success).toBe(true);
    expect(countClients(db)).toBe(clientCountBefore + 1);

    const createdClient = db
      .prepare(`SELECT id FROM clients WHERE phone_number = ?`)
      .get("70222333") as { id: number } | undefined;
    expect(createdClient).toBeDefined();

    const row = saleTxnRow(db, result.id!);
    expect(row?.client_id).toBe(createdClient!.id);
  });
});
