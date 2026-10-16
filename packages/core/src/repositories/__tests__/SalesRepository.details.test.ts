/**
 * LIRA-329 T024 — a POS sale keeps every field the cashier entered on its own
 * transaction: each item's product, quantity, unit price, unit cost, serial
 * (IMEI) or picked unit and warranty; the gift-card codes used; the payment
 * currency the checkout sends (dropped by the validator before); the discount
 * as typed; the partner (by id and mode); the note; the picked client's name
 * and phone; and how it was paid.
 *
 * Money columns are asserted FIRST at today's values (FR-008); those passed
 * on the pre-change run. Fixtures go through `saleProcessSchema` (the shared
 * contract both transports validate with), so a key the schema strips never
 * reaches the repository here either. Expected details go through the kind's
 * own schema (rule 24). Rule 17: run before the builder existed and seen
 * failing.
 *
 * Real schema: create_db.sql + migrations; nothing mocked.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  SalesRepository,
  resetSalesRepository,
  type SaleRequest,
} from "../SalesRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  getStockBatchRepository,
  resetStockBatchRepository,
} from "../StockBatchRepository";
import { resetProductUnitRepository } from "../ProductUnitRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetVoucherRepository } from "../VoucherRepository";
import { saleProcessSchema } from "../../validators/sale";
import {
  posSaleDetailsSchema,
  paymentSnapshotSchema,
} from "../../validators/transactionDetails";
import { expectEverySnapshotMatchesPayments } from "../testHelpers/paymentSnapshotAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const USER_ID = 1;
const RATE = 90_000;
let db: Database.Database;

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

function resetAll(): void {
  resetSalesRepository();
  resetTransactionRepository();
  resetStockBatchRepository();
  resetProductUnitRepository();
  resetDebtRepository();
  resetPartnerRepository();
  resetVoucherRepository();
}

beforeEach(() => {
  resetAll();
  db = new Database(":memory:");
  db.exec(
    fs.readFileSync(
      path.join(REPO_ROOT, "electron-app/create_db.sql"),
      "utf-8",
    ),
  );
  initDatabase(db);
  runMigrations(db);
  initFixedTenantContext(1);
  db.exec(
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (7, 1, 'Rami Haddad', '71123456')`,
  );
});

// LIRA-329 T036 — every payment snapshot saved by a case above equals
// the payments rows it booked (method, currency, amount, direction).
afterEach(() => {
  // A gift card is redeemed against its voucher and an on-account share books
  // a debt row; neither writes a payments row.
  expectEverySnapshotMatchesPayments(db, {
    unbookedMethods: ["GIFT_CARD", "CUSTOMER_ACCOUNT"],
  });
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  db.close();
});

function addProduct(
  name: string,
  stock: number,
  cost: number,
  price: number,
  months: number | null = null,
): number {
  const id = Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity, warranty_months)
         VALUES (1, ?, 'Product', 'Accessories', ?, ?, ?, ?)`,
      )
      .run(name, cost, price, stock, months).lastInsertRowid,
  );
  getStockBatchRepository().createBatch({
    product_id: id,
    supplier_id: null,
    quantity: stock,
    unit_cost_usd: cost,
    books_debt: false,
    created_by: USER_ID,
  });
  return id;
}

function addUnit(productId: number, imei: string): number {
  return Number(
    db
      .prepare(
        `INSERT INTO product_units (tenant_id, product_id, imei, status) VALUES (1, ?, ?, 'IN_STOCK')`,
      )
      .run(productId, imei).lastInsertRowid,
  );
}

/** Process a sale exactly as both transports do: through the shared schema.
 *  The payload is a plain object on purpose — it carries keys the CURRENT
 *  schema may not know (`currency`), which is what this test is about. */
function sell(payload: Record<string, unknown>): TxnRow {
  const sale = saleProcessSchema.parse({
    exchange_rate: RATE,
    status: "completed",
    client_day: "2026-10-10",
    ...payload,
  }) as SaleRequest;
  const r = new SalesRepository().processSale(sale, USER_ID);
  expect(r).toMatchObject({ success: true });
  return db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_name,
              client_phone, metadata_json
         FROM transactions
        WHERE type = 'SALE' AND source_table = 'sales' AND source_id = ?`,
    )
    .get(r.id) as TxnRow;
}

function meta(row: TxnRow): Record<string, unknown> {
  return JSON.parse(row.metadata_json) as Record<string, unknown>;
}

function expectDetails(row: TxnRow, expected: Record<string, unknown>): void {
  expect(posSaleDetailsSchema.parse(expected)).toEqual(expected);
  expect(meta(row).details).toEqual(expected);
}

/** The customer-facing payment rows actually inserted for the transaction,
 *  as unsigned lines (the snapshot keeps amounts unsigned + a direction). */
function paymentRows(txnId: number): Array<{
  method: string;
  currency: string;
  amount: number;
}> {
  return (
    db
      .prepare(
        `SELECT method, currency_code, amount FROM payments WHERE transaction_id = ? ORDER BY id`,
      )
      .all(txnId) as Array<{
      method: string;
      currency_code: string;
      amount: number;
    }>
  ).map((p) => ({
    method: p.method,
    currency: p.currency_code,
    amount: Math.abs(p.amount),
  }));
}

describe("LIRA-329 — SalesRepository: pos_sale details", () => {
  it("a two-line sale keeps each item (price, cost, unit/serial, warranty), the picked client, note, discount, currency and payment lines", () => {
    const phone = addProduct("iPhone 13", 2, 400, 500, 6);
    const unitId = addUnit(phone, "356000000000001");
    const cover = addProduct("Case", 10, 3, 10);

    const row = sell({
      // The picked client only — no typed name/phone.
      client_id: 7,
      items: [
        { product_id: phone, quantity: 1, price: 500, product_unit_id: unitId },
        // Warranty edited at the till for this line.
        { product_id: cover, quantity: 2, price: 10, warranty_months: 1 },
      ],
      total_amount: 520,
      discount: 20,
      final_amount: 500,
      payment_usd: 350,
      payment_lbp: 18_000_000,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 350 },
        { method: "CASH", currency_code: "LBP", amount: 18_000_000 },
      ],
      change_given_usd: 50,
      note: "screen protector included",
      // CheckoutModal's PaymentData always carries the total's currency.
      currency: "USD",
    });

    // FR-008 — today's money (asserted first; passed on the pre-change run).
    // Profit = (500 − 400) + 2 × (10 − 3) − 20 discount.
    expect(row).toMatchObject({
      amount_usd: 500,
      amount_lbp: 0,
      profit_usd: 94,
      profit_lbp: 0,
    });
    // FR-003 — the picked client's own name and phone.
    expect(row.client_name).toBe("Rami Haddad");
    expect(row.client_phone).toBe("71123456");

    expectDetails(row, {
      v: 1,
      kind: "pos_sale",
      items: [
        {
          productId: phone,
          name: "iPhone 13",
          quantity: 1,
          unitPrice: 500,
          unitCost: 400,
          imei: "356000000000001",
          unitId,
          warrantyMonths: 6,
        },
        {
          productId: cover,
          name: "Case",
          quantity: 2,
          unitPrice: 10,
          unitCost: 3,
          warrantyMonths: 1,
        },
      ],
      paymentCurrency: "USD",
      discount: { amount: 20, currency: "USD" },
      note: "screen protector included",
    });

    const snapshot = paymentSnapshotSchema.parse(meta(row).payment_snapshot);
    expect(snapshot).toEqual({
      lines: [
        { method: "CASH", currency: "USD", amount: 350, direction: "IN" },
        {
          method: "CASH",
          currency: "LBP",
          amount: 18_000_000,
          direction: "IN",
        },
        { method: "CASH", currency: "USD", amount: 50, direction: "OUT" },
      ],
      change_returned: [{ method: "CASH", currency: "USD", amount: 50 }],
    });
    // The copy equals the payment rows actually inserted (research R3).
    expect(paymentRows(row.id)).toEqual(
      snapshot.lines.map(({ method, currency, amount }) => ({
        method,
        currency,
        amount,
      })),
    );
  });

  it("a gift-card sale keeps the code used", () => {
    const cover = addProduct("Case", 10, 3, 10);
    db.prepare(
      `INSERT INTO vouchers (tenant_id, code, client_id, client_name, amount, currency_code, created_by)
       VALUES (1, 'GIFT-329-0001', 7, 'Rami Haddad', 10, 'USD', 1)`,
    ).run();

    const row = sell({
      client_id: 7,
      items: [{ product_id: cover, quantity: 2, price: 10 }],
      total_amount: 20,
      discount: 0,
      final_amount: 20,
      payment_usd: 10,
      payment_lbp: 0,
      payments: [
        {
          method: "GIFT_CARD",
          currency_code: "USD",
          amount: 10,
          voucher_code: "GIFT-329-0001",
        },
        { method: "CASH", currency_code: "USD", amount: 10 },
      ],
    });

    expect(row).toMatchObject({ amount_usd: 20, profit_usd: 14 });
    const details = meta(row).details as Record<string, unknown>;
    expect(details.giftCardCodes).toEqual(["GIFT-329-0001"]);
    expect(details).not.toHaveProperty("discount");
    expect(
      paymentSnapshotSchema.parse(meta(row).payment_snapshot).lines,
    ).toEqual([
      { method: "GIFT_CARD", currency: "USD", amount: 10, direction: "IN" },
      { method: "CASH", currency: "USD", amount: 10, direction: "IN" },
    ]);
  });

  it("change the customer left with the shop is kept as its own figure", () => {
    const cover = addProduct("Case", 10, 3, 10);
    const row = sell({
      client_id: null,
      client_name: "Walk-in Sami",
      client_phone: "03111222",
      items: [{ product_id: cover, quantity: 2, price: 10 }],
      total_amount: 20,
      discount: 0,
      final_amount: 20,
      payment_usd: 25,
      payment_lbp: 0,
      payments: [{ method: "CASH", currency_code: "USD", amount: 25 }],
      kept_change_usd: 5,
    });

    // Kept change joins profit today (T3).
    expect(row).toMatchObject({ amount_usd: 20, profit_usd: 19 });
    expect(row.client_name).toBe("Walk-in Sami");
    expect(row.client_phone).toBe("03111222");
    expect(paymentSnapshotSchema.parse(meta(row).payment_snapshot)).toEqual({
      lines: [{ method: "CASH", currency: "USD", amount: 25, direction: "IN" }],
      kept: { usd: 5 },
    });
    expect((meta(row).details as Record<string, unknown>).kind).toBe(
      "pos_sale",
    );
  });

  it("a For-Partner sale keeps the partner by id and mode and has no counter payment snapshot", () => {
    const cover = addProduct("Case", 10, 3, 10);
    const partnerId = Number(
      db
        .prepare(
          `INSERT INTO partners (tenant_id, name) VALUES (1, 'Syria Desk')`,
        )
        .run().lastInsertRowid,
    );
    const row = sell({
      client_id: null,
      items: [{ product_id: cover, quantity: 1, price: 10 }],
      total_amount: 10,
      discount: 0,
      final_amount: 10,
      payment_usd: 0,
      payment_lbp: 0,
      payments: [],
      partnerId,
      partnerMode: "FOR",
    });

    expect(row).toMatchObject({ amount_usd: 10, profit_usd: 7 });
    expect(row.client_name).toBe("Syria Desk [partner]");
    expectDetails(row, {
      v: 1,
      kind: "pos_sale",
      items: [
        {
          productId: cover,
          name: "Case",
          quantity: 1,
          unitPrice: 10,
          unitCost: 3,
        },
      ],
      partner: { id: partnerId, name: "Syria Desk", mode: "FOR" },
    });
    expect(meta(row).payment_snapshot).toBeUndefined();
    // The existing keys stay as they were (reports and filters read them).
    expect(meta(row)).toMatchObject({
      total_amount: 10,
      final_amount: 10,
      item_count: 1,
    });
    // Read back through the repository like any other reader.
    expect(
      getTransactionRepository()
        .getRecent(50)
        .some((t) => t.id === row.id),
    ).toBe(true);
  });

  // LIRA-329 T037 — a session-basket sale records the session that paid for
  // it (server-injected, like `deferPayment`); the basket owns the money.
  it("a customer-basket sale records its session, and no payment lines of its own", () => {
    const cover = addProduct("Case", 10, 3, 10);
    const sale = {
      ...saleProcessSchema.parse({
        exchange_rate: RATE,
        status: "completed",
        client_day: "2026-10-10",
        client_id: null,
        client_name: "Basket Guy",
        items: [{ product_id: cover, quantity: 1, price: 10 }],
        total_amount: 10,
        discount: 0,
        final_amount: 10,
        payment_usd: 0,
        payment_lbp: 0,
      }),
      deferPayment: true,
      paid_in_session: 9,
    } as SaleRequest;
    const r = new SalesRepository().processSale(sale, USER_ID);
    expect(r).toMatchObject({ success: true });
    const row = db
      .prepare(
        `SELECT id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_name,
                client_phone, metadata_json
           FROM transactions WHERE type = 'SALE' AND source_id = ?`,
      )
      .get(r.id) as TxnRow;
    expect(row.amount_usd).toBe(10);
    expect(meta(row).details).toMatchObject({
      kind: "pos_sale",
      paid_in_session: 9,
    });
    expect(meta(row).payment_snapshot).toEqual({ lines: [], session_id: 9 });
  });
});
