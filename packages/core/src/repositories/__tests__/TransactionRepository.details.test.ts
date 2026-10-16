/**
 * LIRA-329 T006 — `createTransaction` keeps the transaction's details.
 *
 *  - `details` + `payment_snapshot` land in `metadata_json`, every existing
 *    key untouched;
 *  - a `details`/`payment_snapshot` key that rides in through
 *    `metadata_json` itself (e.g. copied from an original row by a refund)
 *    is never trusted — only the dedicated inputs set them;
 *  - invalid details throw in tests, and in production are logged and saved
 *    without the bad fields (the transaction is never refused);
 *  - the client resolver fills `client_name`/`client_phone` from
 *    `client_id`, keeps the "phone requires name" guard satisfied, and never
 *    puts a walk-in's phone under a partner label;
 *  - void and refund rows go through the same merge, so they never present
 *    the original's payment lines as their own.
 *
 * Real schema (create_db.sql + migrations). Rule 17: run first with only the
 * new optional input fields declared (no merge, no resolver) and seen
 * failing; the failures are recorded in the LIRA-329 report.
 */
import Database from "better-sqlite3";
import { initFixedTenantContext } from "../../db/tenantContext";
import {
  getTransactionRepository,
  type CreateTransactionInput,
} from "../TransactionRepository";
import { buildDb, resetAll, USER_ID } from "../testHelpers/omtAccountDb";
import type { TransactionDetails } from "../../validators/transactionDetails";

const BASE: CreateTransactionInput = {
  type: "CUSTOM_SERVICE",
  source_table: "custom_services",
  source_id: 999,
  user_id: USER_ID,
  amount_usd: 10,
  amount_lbp: 0,
  summary: "Custom Service: test",
  metadata_json: { cost_usd: 5, price_usd: 10, direction: "IN" },
  exchange_rate: 89500,
};

const DETAILS: TransactionDetails = {
  v: 1,
  kind: "custom_service",
  description: "test",
  category: "Printing",
  note: "two copies",
};

const SNAPSHOT = {
  lines: [
    { method: "CASH", currency: "USD", amount: 10, direction: "IN" as const },
  ],
};

function row(db: Database.Database, id: number) {
  return db
    .prepare(
      `SELECT client_id, client_name, client_phone, metadata_json FROM transactions WHERE id = ?`,
    )
    .get(id) as {
    client_id: number | null;
    client_name: string | null;
    client_phone: string | null;
    metadata_json: string | null;
  };
}

function meta(db: Database.Database, id: number): Record<string, unknown> {
  return JSON.parse(row(db, id).metadata_json ?? "{}") as Record<
    string,
    unknown
  >;
}

describe("LIRA-329 — TransactionRepository.createTransaction details", () => {
  let db: Database.Database;
  let clientId: number;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    initFixedTenantContext(1);
    clientId = Number(
      db
        .prepare(
          `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Rania Haddad', '70111222')`,
        )
        .run().lastInsertRowid,
    );
  });

  afterEach(() => db.close());

  it("merges details and payment_snapshot into metadata_json, keeping every existing key", () => {
    const id = getTransactionRepository().createTransaction({
      ...BASE,
      details: DETAILS,
      payment_snapshot: SNAPSHOT,
    });
    expect(meta(db, id)).toEqual({
      cost_usd: 5,
      price_usd: 10,
      direction: "IN",
      details: DETAILS,
      payment_snapshot: SNAPSHOT,
    });
  });

  it("leaves metadata_json byte-identical when neither is passed", () => {
    const id = getTransactionRepository().createTransaction(BASE);
    expect(row(db, id).metadata_json).toBe(JSON.stringify(BASE.metadata_json));
  });

  it("never trusts details/payment_snapshot copied in through metadata_json", () => {
    const id = getTransactionRepository().createTransaction({
      ...BASE,
      metadata_json: {
        ...BASE.metadata_json,
        details: DETAILS,
        payment_snapshot: SNAPSHOT,
      },
    });
    const m = meta(db, id);
    expect(m.details).toBeUndefined();
    expect(m.payment_snapshot).toBeUndefined();
    expect(m.cost_usd).toBe(5);
  });

  it("throws on invalid details under test", () => {
    expect(() =>
      getTransactionRepository().createTransaction({
        ...BASE,
        details: { ...DETAILS, category: "" },
      }),
    ).toThrow(/details/i);
  });

  it("in production, saves the transaction with the bad field dropped (never refuses it)", () => {
    const saved = {
      NODE_ENV: process.env.NODE_ENV,
      JEST_WORKER_ID: process.env.JEST_WORKER_ID,
    };
    process.env.NODE_ENV = "production";
    delete process.env.JEST_WORKER_ID;
    try {
      const id = getTransactionRepository().createTransaction({
        ...BASE,
        details: {
          ...DETAILS,
          category: "",
          unknownKey: 1,
        } as TransactionDetails,
      });
      expect(meta(db, id).details).toEqual({
        v: 1,
        kind: "custom_service",
        description: "test",
        note: "two copies",
      });
    } finally {
      process.env.NODE_ENV = saved.NODE_ENV;
      if (saved.JEST_WORKER_ID !== undefined) {
        process.env.JEST_WORKER_ID = saved.JEST_WORKER_ID;
      }
    }
  });

  it("fills client_name and client_phone from client_id when both are missing", () => {
    const id = getTransactionRepository().createTransaction({
      ...BASE,
      client_id: clientId,
    });
    expect(row(db, id)).toMatchObject({
      client_id: clientId,
      client_name: "Rania Haddad",
      client_phone: "70111222",
    });
  });

  it("a phone-only caller with a client_id gets the client's name (guard satisfied)", () => {
    const id = getTransactionRepository().createTransaction({
      ...BASE,
      client_id: clientId,
      client_phone: "03999888",
    });
    expect(row(db, id)).toMatchObject({
      client_name: "Rania Haddad",
      client_phone: "03999888",
    });
  });

  it("keeps the guard for a phone with no name and no client", () => {
    expect(() =>
      getTransactionRepository().createTransaction({
        ...BASE,
        client_phone: "03999888",
      }),
    ).toThrow(/client_phone requires client_name/);
  });

  it("never replaces a sent name, and never puts the walk-in's phone under a partner label", () => {
    const repo = getTransactionRepository();
    const partnerRow = repo.createTransaction({
      ...BASE,
      client_id: clientId,
      client_name: "Abu Ali [partner]",
    });
    expect(row(db, partnerRow)).toMatchObject({
      client_name: "Abu Ali [partner]",
      client_phone: null,
    });
    const ownName = repo.createTransaction({
      ...BASE,
      client_id: clientId,
      client_name: "rania haddad",
    });
    expect(row(db, ownName)).toMatchObject({
      client_name: "rania haddad",
      client_phone: "70111222",
    });
  });

  // Phase 8 (T038): reversal writers send the ORIGINAL's name and phone
  // (`reversalClientOf`); the resolver never replaces a sent name, so a
  // reversal keeps the label its original carried. (Before phase 8 these
  // types were excluded from the resolver altogether.)
  it("a REFUND / REFUND_UNDO row keeps the original's client it is given", () => {
    const repo = getTransactionRepository();
    for (const type of ["REFUND", "REFUND_UNDO"] as const) {
      const id = repo.createTransaction({
        ...BASE,
        type,
        client_id: clientId,
        client_name: "Syria Desk [partner]",
      });
      expect(row(db, id)).toMatchObject({
        client_id: clientId,
        client_name: "Syria Desk [partner]",
        client_phone: null,
      });
    }
  });

  it("a void row never carries the original's details or payment lines — only what it reverses", () => {
    const repo = getTransactionRepository();
    const id = repo.createTransaction(BASE);
    // The original as a LIRA-329 writer leaves it (seeded directly, so this
    // case does not depend on the createTransaction merge it guards).
    db.prepare(`UPDATE transactions SET metadata_json = ? WHERE id = ?`).run(
      JSON.stringify({
        ...BASE.metadata_json,
        details: DETAILS,
        payment_snapshot: SNAPSHOT,
      }),
      id,
    );
    const voidId = repo.voidTransaction(id, USER_ID);
    const m = meta(db, voidId);
    expect(m.cost_usd).toBe(5);
    // Phase 8 (T038): its own `reversal` details, never the original's.
    expect(m.details).toEqual({
      v: 1,
      kind: "reversal",
      originalTransactionId: id,
    });
    expect(m.payment_snapshot).toBeUndefined();
  });

  it("a refund row never carries the original's details or payment lines — only what it reverses", () => {
    const repo = getTransactionRepository();
    const id = repo.createTransaction(BASE);
    // The original as a LIRA-329 writer leaves it (seeded directly, so this
    // case does not depend on the createTransaction merge it guards).
    db.prepare(`UPDATE transactions SET metadata_json = ? WHERE id = ?`).run(
      JSON.stringify({
        ...BASE.metadata_json,
        details: DETAILS,
        payment_snapshot: SNAPSHOT,
      }),
      id,
    );
    const refundId = repo.refundTransaction(id, USER_ID);
    const m = meta(db, refundId);
    expect(m.cost_usd).toBe(5);
    // Phase 8 (T038): its own `reversal` details, never the original's.
    expect(m.details).toEqual({
      v: 1,
      kind: "reversal",
      originalTransactionId: id,
    });
    expect(m.payment_snapshot).toBeUndefined();
  });
});
