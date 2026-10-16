/**
 * LIRA-329 T013 — a Custom Service keeps every field the cashier entered on
 * its own transaction: description, category, the product picked, the
 * insurance fulfilment status, direction, cost and price, the partner (For
 * or Via, by id — Via used to leave no trace on the transaction), the note,
 * and how it was paid.
 *
 * Money columns are asserted FIRST at today's values (FR-008); those passed
 * on the pre-change run. Expected details go through the kind's own schema
 * (rule 24). Rule 17: run before the builder existed and seen failing.
 *
 * Real schema: create_db.sql + migrations.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { CustomServiceRepository } from "../CustomServiceRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { buildDb, fundDrawer, USER_ID } from "../testHelpers/omtAccountDb";
import { createCustomServiceSchema } from "../../validators/customService";
import {
  customServiceDetailsSchema,
  paymentSnapshotSchema,
} from "../../validators/transactionDetails";
import { expectEverySnapshotMatchesPayments } from "../testHelpers/paymentSnapshotAssert";

interface TxnRow {
  id: number;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  client_name: string | null;
  client_phone: string | null;
  metadata_json: string;
}

function txnFor(db: Database.Database, serviceId: number): TxnRow {
  return db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_name,
              client_phone, metadata_json
         FROM transactions
        WHERE source_table = 'custom_services' AND source_id = ?`,
    )
    .get(serviceId) as TxnRow;
}

function meta(row: TxnRow): Record<string, unknown> {
  return JSON.parse(row.metadata_json) as Record<string, unknown>;
}

function expectDetails(row: TxnRow, expected: Record<string, unknown>): void {
  expect(customServiceDetailsSchema.parse(expected)).toEqual(expected);
  expect(meta(row).details).toEqual(expected);
}

describe("LIRA-329 — CustomServiceRepository: custom_service details", () => {
  let db: Database.Database;
  let repo: CustomServiceRepository;
  let partnerId: number;

  beforeEach(() => {
    resetTransactionRepository();
    resetPartnerRepository();
    db = buildDb();
    initFixedTenantContext(1);
    fundDrawer(db, "General", "USD", 10000);
    fundDrawer(db, "General", "LBP", 100_000_000);
    partnerId = Number(
      db
        .prepare(
          `INSERT INTO partners (tenant_id, name) VALUES (1, 'Syria Desk')`,
        )
        .run().lastInsertRowid,
    );
    repo = new CustomServiceRepository();
  });

  // LIRA-329 T036 — every payment snapshot saved by a case above equals
  // the payments rows it booked (method, currency, amount, direction).
  afterEach(() => {
    expectEverySnapshotMatchesPayments(db);
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  function create(payload: Record<string, unknown>): TxnRow {
    const result = repo.createService(
      createCustomServiceSchema.parse(payload),
      USER_ID,
    );
    expect(result).toMatchObject({ success: true });
    return txnFor(db, result.id as number);
  }

  it("a walk-in sale keeps description, category, fulfilment, note, cost/price, client and payment lines", () => {
    const row = create({
      description: "Car insurance, 1 year",
      category: "Insurance",
      cost_usd: 12,
      price_usd: 20,
      client_name: "Rami Nasr",
      phone_number: "70444555",
      note: "renewal, call in March",
      fulfillment_status: "ORDERED",
      payments: [
        { method: "CASH", currency_code: "USD", amount: 25 },
        { method: "CASH", currency_code: "USD", amount: 5, direction: "OUT" },
      ],
    });

    // FR-008 — today's money (asserted first; passed on the pre-change run).
    expect(row).toMatchObject({
      amount_usd: 20,
      amount_lbp: 0,
      profit_usd: 8,
      profit_lbp: 0,
    });
    expect(row.client_name).toBe("Rami Nasr");
    expect(row.client_phone).toBe("70444555");

    expectDetails(row, {
      v: 1,
      kind: "custom_service",
      description: "Car insurance, 1 year",
      category: "Insurance",
      fulfillmentStatus: "ORDERED",
      direction: "IN",
      cost: { usd: 12, lbp: 0 },
      price: { usd: 20, lbp: 0 },
      note: "renewal, call in March",
    });
    const snapshot = paymentSnapshotSchema.parse(meta(row).payment_snapshot);
    expect(snapshot).toEqual({
      lines: [
        { method: "CASH", currency: "USD", amount: 25, direction: "IN" },
        { method: "CASH", currency: "USD", amount: 5, direction: "OUT" },
      ],
      change_returned: [{ method: "CASH", currency: "USD", amount: 5 }],
    });
    // The copy matches the customer-facing payment rows actually inserted.
    const listed = getTransactionRepository()
      .getRecent(50)
      .find((t) => t.id === row.id) as unknown as {
      payments?: Array<{
        method: string;
        currency_code: string;
        amount: number;
      }>;
    };
    const legs = (listed.payments ?? []).map((l) => ({
      method: l.method,
      currency: l.currency_code,
      amount: l.amount,
    }));
    for (const line of snapshot.lines) {
      expect(legs).toContainEqual({
        method: line.method,
        currency: line.currency,
        amount: line.amount,
      });
    }
  });

  it("a Via-Partner pay-out keeps the partner by id and mode and the OUT direction", () => {
    const row = create({
      description: "Transfer from Syria",
      cost_usd: 97,
      price_usd: 100,
      client_name: "Recipient",
      partnerId,
      partnerMode: "VIA",
      direction: "OUT",
    });
    expect(row).toMatchObject({ amount_usd: 97, profit_usd: 3 });
    expectDetails(row, {
      v: 1,
      kind: "custom_service",
      description: "Transfer from Syria",
      direction: "OUT",
      cost: { usd: 97, lbp: 0 },
      price: { usd: 100, lbp: 0 },
      partner: { id: partnerId, name: "Syria Desk", mode: "VIA" },
    });
  });

  it("a For-Partner sale keeps the partner and has no counter payment snapshot", () => {
    const row = create({
      description: "Visa form",
      cost_usd: 10,
      price_usd: 15,
      partnerId,
      partnerMode: "FOR",
    });
    expect(row.client_name).toBe("Syria Desk [partner]");
    expectDetails(row, {
      v: 1,
      kind: "custom_service",
      description: "Visa form",
      direction: "IN",
      cost: { usd: 10, lbp: 0 },
      price: { usd: 15, lbp: 0 },
      partner: { id: partnerId, name: "Syria Desk", mode: "FOR" },
    });
    expect(meta(row).payment_snapshot).toBeUndefined();
  });

  it("an inventory-backed service keeps the product picked", () => {
    const productId = Number(
      db
        .prepare(
          `INSERT INTO products (tenant_id, name, item_type, stock_quantity) VALUES (1, 'SIM card', 'product', 5)`,
        )
        .run().lastInsertRowid,
    );
    const row = create({
      description: "SIM activation",
      cost_usd: 2,
      price_usd: 5,
      product_id: productId,
      payments: [{ method: "CASH", currency_code: "USD", amount: 5 }],
    });
    expect(row).toMatchObject({ amount_usd: 5, profit_usd: 3 });
    expect((meta(row).details as Record<string, unknown>).productId).toBe(
      productId,
    );
  });

  // LIRA-329 T037 — a session-basket item records the session that paid
  // for it (server-injected, like `deferPayment`); the basket owns the money.
  it("a customer-basket service records its session, and no payment lines of its own", () => {
    const result = repo.createService(
      {
        ...createCustomServiceSchema.parse({
          description: "Glass protector",
          cost_usd: 2,
          price_usd: 8,
          client_name: "Basket Guy",
        }),
        deferPayment: true,
        paid_in_session: 9,
      } as Parameters<CustomServiceRepository["createService"]>[0],
      USER_ID,
    );
    expect(result).toMatchObject({ success: true });
    const row = txnFor(db, result.id as number);
    expect(row.amount_usd).toBe(8);
    expect(meta(row).details).toMatchObject({
      kind: "custom_service",
      paid_in_session: 9,
    });
    expect(meta(row).payment_snapshot).toEqual({ lines: [], session_id: 9 });
  });
});
