/**
 * LIRA-263 — a maintenance job's client (phone number + client link) must
 * survive the WHOLE workflow: create → reopen → edit → status changes →
 * checkout (cash / customer account / session basket) → the MAINTENANCE
 * transaction row and the 'Maintenance Debt' row.
 *
 * Every payload here is built the way the Maintenance page builds it
 * (`buildJobPayload` in frontend/src/features/maintenance/pages/Maintenance/
 * index.tsx) and — except the session-basket step, which never goes through
 * Zod in production either (`processCartItem` hands raw formData to
 * `saveJob`) — is parsed through `saveMaintenanceJobSchema` first, exactly as
 * BOTH transports do (IPC `validatePayload`, REST `validateRequest`), so the
 * schema's phone normalisation and key-stripping are part of what is tested.
 *
 * Shapes the page really sends (the facts the drop hinged on):
 *  - a reopened job's phone field is filled from `job.client_phone` as the
 *    jobs list returns it (`handleEdit`), `""` when the list carries none;
 *  - a status transition / draft resave sends NO `client_id` (only the
 *    CheckoutModal's client search can supply one);
 *  - checkout sends `client_id` only when the modal picked a client.
 *
 * Rule 17: written before the fix and run against the unfixed code. It
 * failed at: (1) `getJobs` returned no `client_phone` (no column, no join),
 * so a reopened job showed an empty phone; (2) the FIRST resave of a
 * reopened job (draft edit or Received→In_Progress) wrote
 * `maintenance.client_id = NULL`, so every later checkout booked the
 * MAINTENANCE transaction with no client (Transactions "Client" column "—"),
 * a customer-account checkout was refused with "Cannot create debt for
 * anonymous client", and the session basket lost the link too; (3) the
 * MAINTENANCE transaction never carried the job's client name/phone.
 */

import Database from "better-sqlite3";
import { MaintenanceService, resetMaintenanceService } from "../MaintenanceService";
import { MaintenanceRepository } from "../../repositories/MaintenanceRepository";
import { resetTransactionRepository } from "../../repositories/TransactionRepository";
import { saveMaintenanceJobSchema } from "../../validators/maintenance";
import type { SaveJobParams } from "../MaintenanceService";
import { processCartItem } from "../SessionCheckoutService";

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
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, tenant_id INTEGER DEFAULT 1, role TEXT);
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      notes TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE maintenance (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT, -- migration v194
      device_name TEXT NOT NULL,
      issue_description TEXT,
      cost_usd REAL DEFAULT 0,
      price_usd REAL DEFAULT 0,
      cost_lbp REAL DEFAULT 0,
      price_lbp REAL DEFAULT 0,
      discount_usd REAL DEFAULT 0,
      final_amount_usd REAL DEFAULT 0,
      final_amount_lbp REAL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      paid_usd REAL DEFAULT 0,
      paid_lbp REAL DEFAULT 0,
      exchange_rate REAL,
      status TEXT DEFAULT 'Received',
      paid_by TEXT DEFAULT 'CASH',
      note TEXT,
      transaction_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      edited_by TEXT DEFAULT NULL,
      edited_at TEXT DEFAULT NULL,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL,
      parts_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      parts_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0
    );

    CREATE TABLE maintenance_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      maintenance_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      stock_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE maintenance_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      maintenance_id INTEGER NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      changed_by INTEGER,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      name TEXT NOT NULL,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      selling_price_usd REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 1000);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
  `);
  return db;
}

const CLIENT_NAME = "Rami Haddad";
// Typed with spaces, the way a cashier types it — LIRA-246b normalises it.
const TYPED_PHONE = "03 123 456";
const STORED_PHONE = "03123456";

type JobRow = {
  id: number;
  client_id: number | null;
  client_name: string | null;
  client_phone?: string | null;
  status: string;
  device_name: string;
  issue_description: string | null;
  price_usd: number;
  cost_usd: number;
  discount_usd: number;
  paid_usd: number;
  paid_lbp: number;
};

/** Mirrors the page's `buildJobPayload` (USD job, no parts change). */
function pagePayload(
  job: Partial<JobRow> & { status: string },
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...(job.id != null ? { id: job.id } : {}),
    device_name: job.device_name ?? "iPhone 13",
    issue_description: job.issue_description ?? "screen",
    cost_usd: job.cost_usd ?? 20,
    price_usd: job.price_usd ?? 50,
    final_amount_usd: (job.price_usd ?? 50) - (job.discount_usd ?? 0),
    final_amount_lbp: 0,
    currency: "USD",
    client_name: job.client_name ?? "",
    // A resave of an existing job (draft edit, status change, checkout)
    // sends the phone BLANK when the operator didn't edit it — the page's
    // `buildJobPayload` never re-sends the linked client's stored number. A
    // new job sends what was typed.
    client_phone: job.id != null ? "" : job.client_phone || "",
    status: job.status,
    paid_usd: job.paid_usd ?? 0,
    paid_lbp: job.paid_lbp ?? 0,
    discount_usd: job.discount_usd ?? 0,
    ...extra,
  };
}

describe("LIRA-263 — client phone + link survive the maintenance workflow", () => {
  let db: Database.Database;
  let service: MaintenanceService;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  /** Both transports: Zod-parse, then saveJob. */
  const save = (payload: Record<string, unknown>) => {
    const parsed = saveMaintenanceJobSchema.parse(payload);
    const res = service.saveJob(parsed as SaveJobParams, 1);
    expect(res).toEqual(expect.objectContaining({ success: true }));
    return res.id!;
  };

  /** The jobs list, as the page receives it (getJobs). */
  const listed = (id: number): JobRow => {
    const row = service.getJobs().find((j) => j.id === id);
    expect(row).toBeDefined();
    return row as unknown as JobRow;
  };

  const txnFor = (jobId: number) =>
    db
      .prepare(
        `SELECT client_id, client_name, client_phone FROM transactions
          WHERE source_table = 'maintenance' AND source_id = ? AND type = 'MAINTENANCE'`,
      )
      .get(jobId) as {
      client_id: number | null;
      client_name: string | null;
      client_phone: string | null;
    };

  /** create (name + typed phone) → reopen → edit draft → two status steps. */
  const createAndAdvanceToReady = (): { jobId: number; clientId: number } => {
    const jobId = save(
      pagePayload({
        status: "Received",
        client_name: CLIENT_NAME,
        client_phone: TYPED_PHONE,
      }),
    );
    const created = listed(jobId);
    expect(created.client_id).not.toBeNull();
    const clientId = created.client_id!;
    const client = db
      .prepare(`SELECT full_name, phone_number FROM clients WHERE id = ?`)
      .get(clientId) as { full_name: string; phone_number: string };
    expect(client).toEqual({ full_name: CLIENT_NAME, phone_number: STORED_PHONE });

    // Reopen: the page fills the phone field from the listed row.
    expect(created.client_phone).toBe(STORED_PHONE);

    // Edit the draft WITHOUT retyping the phone (issue text changes only).
    save(pagePayload({ ...created, issue_description: "screen + battery" }));
    const afterEdit = listed(jobId);
    expect(afterEdit.client_id).toBe(clientId);
    expect(afterEdit.client_name).toBe(CLIENT_NAME);
    expect(afterEdit.client_phone).toBe(STORED_PHONE);

    // Status transitions, built from the listed row each time.
    for (const next of ["In_Progress", "Ready"]) {
      save(pagePayload({ ...listed(jobId), status: next }));
      const row = listed(jobId);
      expect(row.status).toBe(next);
      expect(row.client_id).toBe(clientId);
      expect(row.client_name).toBe(CLIENT_NAME);
      expect(row.client_phone).toBe(STORED_PHONE);
    }
    return { jobId, clientId };
  };

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    resetTransactionRepository();
    resetMaintenanceService();
    service = new MaintenanceService(new MaintenanceRepository());
  });

  afterEach(() => {
    db.close();
    resetTransactionRepository();
    resetMaintenanceService();
  });

  it("cash checkout of the reopened job keeps the client on the job AND the MAINTENANCE transaction", () => {
    const { jobId, clientId } = createAndAdvanceToReady();

    // Checkout from the reopened job; the modal picked no client.
    save(
      pagePayload(
        { ...listed(jobId), status: "Delivered_Paid", paid_usd: 50 },
        {
          exchange_rate: 89500,
          payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
          paid_by: "CASH",
          change_given_usd: 0,
          change_given_lbp: 0,
        },
      ),
    );

    const row = listed(jobId);
    expect(row.status).toBe("Delivered_Paid");
    expect(row.client_id).toBe(clientId);
    expect(row.client_phone).toBe(STORED_PHONE);
    expect(txnFor(jobId)).toEqual({
      client_id: clientId,
      client_name: CLIENT_NAME,
      client_phone: STORED_PHONE,
    });
  });

  it("customer-account checkout of the reopened job books 'Maintenance Debt' against the same client", () => {
    const { jobId, clientId } = createAndAdvanceToReady();

    save(
      pagePayload(
        { ...listed(jobId), status: "Delivered_Paid" },
        {
          exchange_rate: 89500,
          payments: [
            { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 50 },
          ],
          paid_by: "CUSTOMER_ACCOUNT",
          change_given_usd: 0,
          change_given_lbp: 0,
        },
      ),
    );

    expect(listed(jobId).client_id).toBe(clientId);
    expect(txnFor(jobId).client_id).toBe(clientId);
    const debts = db
      .prepare(`SELECT client_id, transaction_type, amount_usd FROM debt_ledger`)
      .all();
    expect(debts).toEqual([
      { client_id: clientId, transaction_type: "Maintenance Debt", amount_usd: 50 },
    ]);
  });

  it("session-basket checkout of the reopened job keeps the client (raw formData, no Zod)", () => {
    const { jobId, clientId } = createAndAdvanceToReady();

    // handleCheckoutComplete with an active session → addToSessionCart; the
    // basket later hands formData straight to saveJob (deferPayment: true).
    processCartItem(
      {
        id: "cart-1",
        module: "maintenance",
        label: "Maintenance: iPhone 13 - $50.00",
        amount: 50,
        currency: "USD",
        ipcChannel: "maintenance:save",
        formData: pagePayload(
          { ...listed(jobId), status: "Delivered_Paid" },
          {
            exchange_rate: 89500,
            payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
            paid_by: "CASH",
            change_given_usd: 0,
            change_given_lbp: 0,
          },
        ),
      },
      89500,
      1,
    );

    expect(listed(jobId).client_id).toBe(clientId);
    expect(txnFor(jobId).client_id).toBe(clientId);
    expect(txnFor(jobId).client_name).toBe(CLIENT_NAME);
  });

  it("a client whose stored phone is free text ('03/123456') keeps the job linked through checkout, with that phone on the transaction", () => {
    // Another module (e.g. OMT/Whish) created the client with a free-text
    // phone; the operator picked that client for the job (rule 11).
    const clientId = Number(
      db
        .prepare(
          `INSERT INTO clients (full_name, phone_number) VALUES ('Nadine K', '03/123456')`,
        )
        .run().lastInsertRowid,
    );
    const jobId = save(
      pagePayload(
        { status: "Received", client_name: "Nadine K" },
        { client_id: clientId },
      ),
    );
    expect(listed(jobId).client_phone).toBe("03/123456");

    save(pagePayload({ ...listed(jobId), status: "In_Progress" }));
    save(
      pagePayload(
        { ...listed(jobId), status: "Delivered_Paid", paid_usd: 50 },
        {
          exchange_rate: 89500,
          payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
          paid_by: "CASH",
          change_given_usd: 0,
          change_given_lbp: 0,
        },
      ),
    );

    expect(listed(jobId).client_id).toBe(clientId);
    expect(txnFor(jobId)).toEqual({
      client_id: clientId,
      client_name: "Nadine K",
      client_phone: "03/123456",
    });
  });

  it("changing the name on a linked job re-resolves the client instead of keeping the old link", () => {
    const { jobId, clientId } = createAndAdvanceToReady();
    // Operator renames the job to a different walk-in with no phone: the old
    // link must NOT stick to someone else's name (LIRA-246c free-text rule).
    save(
      pagePayload({
        ...listed(jobId),
        client_name: "Someone Else",
        client_phone: "",
      }),
    );
    const row = listed(jobId);
    expect(row.client_name).toBe("Someone Else");
    expect(row.client_id).toBeNull();
    expect(row.client_id).not.toBe(clientId);
  });

  it("a name-only walk-in (no phone) keeps its name on the MAINTENANCE transaction", () => {
    const jobId = save(
      pagePayload(
        { status: "Delivered_Paid", client_name: "Walk-in Sami", paid_usd: 50 },
        {
          exchange_rate: 89500,
          payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
          paid_by: "CASH",
          change_given_usd: 0,
          change_given_lbp: 0,
        },
      ),
    );
    expect(listed(jobId).client_id).toBeNull();
    expect(txnFor(jobId)).toEqual({
      client_id: null,
      client_name: "Walk-in Sami",
      client_phone: null,
    });
  });
});

describe("LIRA-263 — maintenance phone normalisation never blanks a valid number", () => {
  const parsePhone = (client_phone: string) =>
    saveMaintenanceJobSchema.safeParse({
      device_name: "x",
      price_usd: 1,
      client_name: "n",
      client_phone,
    });

  it.each([
    ["03 123 456", "03123456"],
    ["03-123-456", "03123456"],
    ["+961 3 123 456", "03123456"],
    ["00961 70 123 456", "70123456"],
    ["70 123 456", "70123456"],
    ["70123456", "70123456"],
    ["+96170123456", "70123456"],
    // Formats other modules store on a client as free text, which a
    // reopened job now pre-fills — formatting alone must not fail a resave.
    ["961 70 123 456", "96170123456"],
    ["+44 20 7946 0958", "+442079460958"],
    ["(03) 123456", "03123456"],
    ["", ""],
  ])("%p is accepted and stored as %p", (typed, stored) => {
    const r = parsePhone(typed);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.client_phone).toBe(stored);
  });

  it("omitting the phone key leaves it undefined (never blanks a stored value)", () => {
    const r = saveMaintenanceJobSchema.safeParse({ device_name: "x", price_usd: 1 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.client_phone).toBeUndefined();
  });
});
