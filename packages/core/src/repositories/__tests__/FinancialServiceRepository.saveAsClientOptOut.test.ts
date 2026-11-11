/**
 * Shop-day 2026-10-16 (bug 1) — an OMT / Whish send or receive on the
 * Services page created a client from the sender's (or receiver's) name and
 * phone even with "Save as client" unchecked (Fadi Nassar, txn 10901).
 *
 * The page's checkbox is the rule: `saveAsClient: false` means "do not create
 * a client". An EXISTING client with that phone is still linked (that is not
 * creation). When the key is absent the old behaviour stays (Mobile Recharge
 * walk-ins, session replays and every other caller that never offered the
 * choice keep auto-creating).
 *
 * Field names go through the shared schema (rule 24 / rule 23): the payload
 * is parsed by `createFinancialServiceSchema`, which strips keys it does not
 * declare.
 *
 * Rule 17: run against the unfixed repository first and seen failing (a
 * client was created and linked though the payload said not to).
 *
 * Real schema: create_db.sql + migrations.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  FinancialServiceRepository,
  resetFinancialServiceRepository,
  type CreateFinancialServiceData,
} from "../FinancialServiceRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { buildDb, fundDrawer, USER_ID } from "../testHelpers/omtAccountDb";
import { createFinancialServiceSchema } from "../../validators/financial";

const OMT_SEND = {
  provider: "OMT",
  serviceType: "SEND",
  amount: 100,
  currency: "USD",
  omtServiceType: "CASH_TO_BUSINESS",
  omtFee: 5,
  includingFees: false,
  referenceNumber: "C2B-1",
  clientName: "Fadi Nassar",
  phoneNumber: "03778899",
  senderName: "Fadi Nassar",
  senderPhone: "03778899",
  receiverName: "",
  receiverPhone: "",
  payments: [{ method: "CASH", currencyCode: "USD", amount: 105 }],
};

function clientCount(db: Database.Database): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM clients`).get() as { n: number }
  ).n;
}

function txnClientId(db: Database.Database, fsId: number): number | null {
  return (
    db
      .prepare(
        `SELECT client_id FROM transactions
          WHERE source_table = 'financial_services' AND source_id = ?
            AND type = 'FINANCIAL_SERVICE'`,
      )
      .get(fsId) as { client_id: number | null }
  ).client_id;
}

describe("Services page — 'Save as client' unchecked creates no client", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;

  beforeEach(() => {
    resetFinancialServiceRepository();
    resetTransactionRepository();
    resetSupplierRepository();
    db = buildDb();
    initFixedTenantContext(1);
    for (const d of ["General", "OMT_System", "Whish_System"]) {
      fundDrawer(db, d, "USD", 10000);
      fundDrawer(db, d, "LBP", 500_000_000);
    }
    repo = new FinancialServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  /** The payload as the REST route / IPC handler hands it on: parsed by
   *  the shared schema first. */
  function create(payload: Record<string, unknown>): number {
    const parsed = createFinancialServiceSchema.parse(payload);
    return repo.createTransaction({
      ...(parsed as unknown as CreateFinancialServiceData),
      userId: USER_ID,
    }).id;
  }

  it("the schema keeps the choice (rule 23)", () => {
    const parsed: Record<string, unknown> = createFinancialServiceSchema.parse({
      ...OMT_SEND,
      saveAsClient: false,
    });
    expect(parsed.saveAsClient).toBe(false);
  });

  it("unchecked: a new name + phone creates no client and the row has none", () => {
    const before = clientCount(db);
    const id = create({ ...OMT_SEND, saveAsClient: false });
    expect(clientCount(db)).toBe(before);
    expect(txnClientId(db, id)).toBeNull();
  });

  it("unchecked: an existing client with that phone is still linked", () => {
    const existingId = Number(
      db
        .prepare(
          `INSERT INTO clients (full_name, phone_number, tenant_id) VALUES (?, ?, 1)`,
        )
        .run("Fadi Nassar", "03778899").lastInsertRowid,
    );
    const before = clientCount(db);
    const id = create({ ...OMT_SEND, saveAsClient: false });
    expect(clientCount(db)).toBe(before);
    expect(txnClientId(db, id)).toBe(existingId);
  });

  it("checked: a new name + phone is saved as a client and linked", () => {
    const before = clientCount(db);
    const id = create({ ...OMT_SEND, saveAsClient: true });
    expect(clientCount(db)).toBe(before + 1);
    expect(txnClientId(db, id)).not.toBeNull();
  });

  it("no choice sent (other callers): the old auto-create stays", () => {
    const before = clientCount(db);
    const id = create(OMT_SEND);
    expect(clientCount(db)).toBe(before + 1);
    expect(txnClientId(db, id)).not.toBeNull();
  });
});

/**
 * LIRA-387 F2 (owner 2026-11-11) — a RECEIVE paid out to a NEW receiver's
 * customer account failed with "Client is required for CUSTOMER_ACCOUNT
 * cashout" unless "Save as client" was ticked: the opt-out skipped creating
 * the client, and an account line cannot be booked without one. A SEND with
 * an account line always created it. The account line wins over the opt-out:
 * charging or crediting an account IS saving the customer.
 *
 * Rule 17: run against the unfixed repository first and seen failing.
 */
describe("LIRA-387 — an account line creates the client even when 'Save as client' is unticked", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;

  beforeEach(() => {
    resetFinancialServiceRepository();
    resetTransactionRepository();
    resetSupplierRepository();
    db = buildDb();
    initFixedTenantContext(1);
    for (const d of ["General", "OMT_System", "Whish_System"]) {
      fundDrawer(db, d, "USD", 10000);
      fundDrawer(db, d, "LBP", 500_000_000);
    }
    repo = new FinancialServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  function create(payload: Record<string, unknown>): number {
    const parsed = createFinancialServiceSchema.parse(payload);
    return repo.createTransaction({
      ...(parsed as unknown as CreateFinancialServiceData),
      userId: USER_ID,
    }).id;
  }

  function accountBalanceUsd(clientId: number): number {
    return (
      db
        .prepare(
          `SELECT COALESCE(SUM(amount_usd), 0) AS s FROM debt_ledger WHERE client_id = ?`,
        )
        .get(clientId) as { s: number }
    ).s;
  }

  const OMT_RECEIVE_TO_ACCOUNT = {
    provider: "OMT",
    serviceType: "RECEIVE",
    amount: 100,
    currency: "USD",
    omtServiceType: "INTRA",
    referenceNumber: "RCV-387",
    clientName: "Nour Saleh",
    phoneNumber: "71222333",
    senderName: "",
    senderPhone: "",
    receiverName: "Nour Saleh",
    receiverPhone: "71222333",
    cashoutMethod: "CUSTOMER_ACCOUNT",
    payments: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 100 }],
    saveAsClient: false,
  };

  it("RECEIVE to a new receiver's account: the client is created and credited", () => {
    const before = clientCount(db);
    const id = create(OMT_RECEIVE_TO_ACCOUNT);
    expect(clientCount(db)).toBe(before + 1);
    const clientId = txnClientId(db, id);
    expect(clientId).not.toBeNull();
    // Credit = a negative debt balance of the payout.
    expect(accountBalanceUsd(clientId as number)).toBeCloseTo(-100, 5);
  });

  it("RECEIVE to an account with the picked client's id: no new client", () => {
    const existingId = Number(
      db
        .prepare(
          `INSERT INTO clients (full_name, phone_number, tenant_id) VALUES (?, ?, 1)`,
        )
        .run("Nour Saleh", "71000000").lastInsertRowid,
    );
    const before = clientCount(db);
    const id = create({ ...OMT_RECEIVE_TO_ACCOUNT, clientId: existingId });
    expect(clientCount(db)).toBe(before);
    expect(txnClientId(db, id)).toBe(existingId);
  });

  it("Whish RECEIVE with the fee on a new receiver's account: the client is created and charged", () => {
    db.prepare(
      `UPDATE system_settings SET value = 'WHISH' WHERE key_name = 'shop_base_system'`,
    ).run();
    const before = clientCount(db);
    const id = create({
      ...OMT_RECEIVE_TO_ACCOUNT,
      provider: "WHISH",
      omtServiceType: undefined,
      whishFee: 5,
      cashoutMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
      feePayments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 5 },
      ],
    });
    expect(clientCount(db)).toBe(before + 1);
    const clientId = txnClientId(db, id);
    expect(clientId).not.toBeNull();
    expect(accountBalanceUsd(clientId as number)).toBeCloseTo(5, 5);
  });

  it("unticked and no account line: still no client (the opt-out stands)", () => {
    const before = clientCount(db);
    const id = create({
      ...OMT_RECEIVE_TO_ACCOUNT,
      cashoutMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
    });
    expect(clientCount(db)).toBe(before);
    expect(txnClientId(db, id)).toBeNull();
  });
});
