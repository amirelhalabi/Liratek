/**
 * LIRA-333 T006/T007 — the saved-sale read the WhatsApp receipt and the
 * reprint share (contracts/sale-receipt-read.md, data-model.md).
 *
 * Part 1 — phone fields: `sale_phone` (the phone saved with the sale, on its
 * SALE transaction) and `linked_client_phone` (the linked client's phone),
 * with the existing `client_phone`/`client_name` left exactly as they were.
 *
 * Part 2 — the variant matrix (rule 28d): every sale is booked through the
 * REAL `processSale` with the real leg shape, and the receipt figures
 * (`tender_usd`, `tender_lbp`, `gift_card_usd`, `on_account_usd`,
 * `change_given_usd`, `change_given_lbp`) are asserted. Cases (j) and (k)
 * are the immutability guards for SC-003: a later debt repayment raises
 * `sales.paid_usd` (`_markSalesPaidFIFO`) and a partial item refund posts
 * reversal rows, but the receipt figures must not move.
 *
 * Every added subquery must be tenant-scoped: a foreign tenant's rows that
 * point at the same transaction id are ignored.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { z } from "zod";
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
import { resetTransactionRepository } from "../TransactionRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetStockBatchRepository } from "../StockBatchRepository";
import { resetProductUnitRepository } from "../ProductUnitRepository";
import { DebtRepository, resetDebtRepository } from "../DebtRepository";
import {
  getVoucherRepository,
  resetVoucherRepository,
} from "../VoucherRepository";
import { resetDebtService } from "../../services/DebtService";
import { saleProcessSchema } from "../../validators/sale";

type SalePayload = z.input<typeof saleProcessSchema>;

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");
const USER_ID = 1;
const RATE = 89_500;

let db: Database.Database;
let repo: SalesRepository;

function buildDb(): Database.Database {
  const d = new Database(":memory:");
  d.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(d);
  runMigrations(d);
  return d;
}

function resetAll(): void {
  resetSalesRepository();
  resetTransactionRepository();
  resetPartnerRepository();
  resetStockBatchRepository();
  resetProductUnitRepository();
  resetDebtRepository();
  resetDebtService();
  resetVoucherRepository();
}

beforeEach(() => {
  resetAll();
  db = buildDb();
  initFixedTenantContext(1);
  repo = new SalesRepository();
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  db.close();
});

function addProduct(price: number): number {
  return Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, ?, 'Product', 1, ?, 10)`,
      )
      .run(`P-${Math.random()}`, price).lastInsertRowid,
  );
}

function addClient(phone: string | null = null): number {
  return Number(
    db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, ?, ?)`,
      )
      .run(`Client ${Math.random()}`, phone).lastInsertRowid,
  );
}

function addVoucher(clientId: number, amount: number, code: string): void {
  getVoucherRepository().createVoucher({
    code,
    client_id: clientId,
    client_name: "Gift owner",
    client_phone: null,
    amount,
    currency_code: "USD",
    expiry_date: null,
    note: null,
    created_by: USER_ID,
  });
}

/** Two items, $10 and $5 — $15 before any discount or extra. */
function payload(extra: Partial<SalePayload>): SalePayload {
  return {
    client_id: null,
    items: [
      { product_id: addProduct(10), quantity: 1, price: 10 },
      { product_id: addProduct(5), quantity: 1, price: 5 },
    ],
    total_amount: 15,
    discount: 0,
    final_amount: 15,
    payment_usd: 0,
    payment_lbp: 0,
    exchange_rate: RATE,
    status: "completed",
    ...extra,
  };
}

function sell(extra: Partial<SalePayload>, opts: Partial<SaleRequest> = {}) {
  const req = {
    ...(saleProcessSchema.parse(payload(extra)) as SaleRequest),
    ...opts,
  };
  const res = repo.processSale(req, USER_ID);
  if (!res.success) throw new Error(`sale refused: ${res.error}`);
  return res.id!;
}

interface ReceiptFields {
  tender_usd: number;
  tender_lbp: number;
  gift_card_usd: number;
  on_account_usd: number;
  change_given_usd: number;
  change_given_lbp: number;
}

const r2 = (n: unknown) => Math.round(Number(n ?? NaN) * 100) / 100;

function receipt(saleId: number): ReceiptFields {
  const s = repo.getSaleWithCustomer(saleId) as unknown as Record<
    string,
    unknown
  >;
  return {
    tender_usd: r2(s.tender_usd),
    tender_lbp: r2(s.tender_lbp),
    gift_card_usd: r2(s.gift_card_usd),
    on_account_usd: r2(s.on_account_usd),
    change_given_usd: r2(s.change_given_usd),
    change_given_lbp: r2(s.change_given_lbp),
  };
}

function expected(p: Partial<ReceiptFields>): ReceiptFields {
  return {
    tender_usd: 0,
    tender_lbp: 0,
    gift_card_usd: 0,
    on_account_usd: 0,
    change_given_usd: 0,
    change_given_lbp: 0,
    ...p,
  };
}

function saleTxnId(saleId: number): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`,
      )
      .get(saleId) as { id: number }
  ).id;
}

// ─── Part 1 — phone fields (T006) ───────────────────────────────────────────

describe("getSaleWithCustomer — phone fields (FR-012)", () => {
  it("walk-in sale with a typed name + phone: sale_phone is that phone", () => {
    const saleId = sell({
      client_name: "Walk-in Ali",
      client_phone: "03 123 456",
      payments: [{ method: "CASH", currency_code: "USD", amount: 15 }],
    });
    const s = repo.getSaleWithCustomer(saleId) as unknown as Record<
      string,
      unknown
    >;
    expect(s.sale_phone).toBe("03 123 456");
    // Observed: processSale auto-creates (or matches) a client from the
    // typed name + phone, so the walk-in also gets a linked client.
    expect(s.linked_client_phone).toBe("03 123 456");
    // unchanged display field
    expect(s.client_phone).toBe("03 123 456");
  });

  it("linked-client sale: linked_client_phone is the client's phone; client_phone keeps COALESCE(client, sale)", () => {
    const clientId = addClient("76 901 610");
    const saleId = sell({
      client_id: clientId,
      payments: [{ method: "CASH", currency_code: "USD", amount: 15 }],
    });
    const s = repo.getSaleWithCustomer(saleId) as unknown as Record<
      string,
      unknown
    >;
    expect(s.linked_client_phone).toBe("76 901 610");
    // Observed (research R4, 2026-10-17): with no phone typed at checkout,
    // processSale stamps the linked client's phone AS IT WAS at sale time on
    // the sale's transaction, so sale_phone is that snapshot.
    expect(s.sale_phone).toBe("76 901 610");
    expect(s.client_phone).toBe("76 901 610");
  });

  it("linked-client sale with a phone typed at checkout: sale_phone wins over the client's", () => {
    const clientId = addClient("76 901 610");
    const saleId = sell({
      client_id: clientId,
      client_name: "Linked Client",
      client_phone: "03 999 888",
      payments: [{ method: "CASH", currency_code: "USD", amount: 15 }],
    });
    const s = repo.getSaleWithCustomer(saleId) as unknown as Record<
      string,
      unknown
    >;
    expect(s.sale_phone).toBe("03 999 888");
    expect(s.linked_client_phone).toBe("76 901 610");
    // existing display semantics unchanged: the client's phone first
    expect(s.client_phone).toBe("76 901 610");
  });
});

// ─── Part 2 — the variant matrix (T007) ─────────────────────────────────────

describe("getSaleWithCustomer — receipt figures, every leg shape (rule 28d)", () => {
  it("(a) cash USD only", () => {
    const id = sell({
      payments: [{ method: "CASH", currency_code: "USD", amount: 15 }],
    });
    expect(receipt(id)).toEqual(expected({ tender_usd: 15 }));
  });

  it("(b) USD + LBP", () => {
    const id = sell({
      payments: [
        { method: "CASH", currency_code: "USD", amount: 10 },
        { method: "CASH", currency_code: "LBP", amount: 5 * RATE },
      ],
    });
    expect(receipt(id)).toEqual(
      expected({ tender_usd: 10, tender_lbp: 5 * RATE }),
    );
  });

  it("(c) fully on account", () => {
    const clientId = addClient();
    const id = sell({
      client_id: clientId,
      payments: [
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 15 },
      ],
    });
    expect(receipt(id)).toEqual(expected({ on_account_usd: 15 }));
  });

  it("(d) partly on account, USD", () => {
    const clientId = addClient();
    const id = sell({
      client_id: clientId,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 5 },
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 10 },
      ],
    });
    expect(receipt(id)).toEqual(
      expected({ tender_usd: 5, on_account_usd: 10 }),
    );
  });

  it("(e) partly on account, account leg in LBP → its USD equivalent", () => {
    const clientId = addClient();
    const id = sell({
      client_id: clientId,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 5 },
        { method: "CUSTOMER_ACCOUNT", currency_code: "LBP", amount: 10 * RATE },
      ],
    });
    expect(receipt(id)).toEqual(
      expected({ tender_usd: 5, on_account_usd: 10 }),
    );
  });

  it("(f) gift card covering part", () => {
    const clientId = addClient();
    addVoucher(clientId, 10, "GIFT-F");
    const id = sell({
      client_id: clientId,
      payments: [
        {
          method: "GIFT_CARD",
          currency_code: "USD",
          amount: 10,
          voucher_code: "GIFT-F",
        },
        { method: "CASH", currency_code: "USD", amount: 5 },
      ],
    });
    expect(receipt(id)).toEqual(expected({ tender_usd: 5, gift_card_usd: 10 }));
  });

  it("(f2) gift card worth more than the sale: only the part used shows", () => {
    const clientId = addClient();
    addVoucher(clientId, 25, "GIFT-F2");
    const id = sell({
      client_id: clientId,
      payments: [
        {
          method: "GIFT_CARD",
          currency_code: "USD",
          amount: 15,
          voucher_code: "GIFT-F2",
        },
      ],
    });
    expect(receipt(id)).toEqual(expected({ gift_card_usd: 15 }));
  });

  it("(g) gift card + account", () => {
    const clientId = addClient();
    addVoucher(clientId, 5, "GIFT-G");
    const id = sell({
      client_id: clientId,
      payments: [
        {
          method: "GIFT_CARD",
          currency_code: "USD",
          amount: 5,
          voucher_code: "GIFT-G",
        },
        { method: "CASH", currency_code: "USD", amount: 5 },
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 5 },
      ],
    });
    expect(receipt(id)).toEqual(
      expected({ tender_usd: 5, gift_card_usd: 5, on_account_usd: 5 }),
    );
  });

  it("(h) change in USD and LBP", () => {
    const id = sell({
      payments: [
        { method: "CASH", currency_code: "USD", amount: 20 },
        { method: "CASH", currency_code: "LBP", amount: RATE },
      ],
      change_given_usd: 5,
      change_given_lbp: RATE,
    });
    expect(receipt(id)).toEqual(
      expected({
        tender_usd: 20,
        tender_lbp: RATE,
        change_given_usd: 5,
        change_given_lbp: RATE,
      }),
    );
  });

  it("(i) discount", () => {
    const id = sell({
      discount: 2,
      final_amount: 13,
      payments: [{ method: "CASH", currency_code: "USD", amount: 13 }],
    });
    expect(receipt(id)).toEqual(expected({ tender_usd: 13 }));
  });

  it("(i2) extra charge, partly on account", () => {
    const clientId = addClient();
    const id = sell({
      client_id: clientId,
      extra_usd: 3,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 8 },
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 10 },
      ],
    });
    expect(receipt(id)).toEqual(
      expected({ tender_usd: 8, on_account_usd: 10 }),
    );
  });

  it("(j) a later debt repayment changes sales.paid_usd but NOT the receipt (SC-003)", () => {
    const clientId = addClient();
    const id = sell({
      client_id: clientId,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 5 },
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 10 },
      ],
    });
    const before = receipt(id);
    const paidBefore = repo.getSaleWithCustomer(id)!.paid_usd;

    new DebtRepository().addRepayment({
      client_id: clientId,
      amount_usd: 10,
      amount_lbp: 0,
      created_by: USER_ID,
    });

    // the premise: the repayment really did move sales.paid_usd …
    expect(repo.getSaleWithCustomer(id)!.paid_usd).not.toBe(paidBefore);
    // … and the receipt did not move with it
    expect(receipt(id)).toEqual(before);
    expect(before).toEqual(expected({ tender_usd: 5, on_account_usd: 10 }));
  });

  it("(k) a partial item refund does not change the receipt (R7)", () => {
    const clientId = addClient();
    const id = sell({
      client_id: clientId,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 5 },
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 10 },
      ],
    });
    const before = receipt(id);
    const five = db
      .prepare(
        `SELECT id FROM sale_items WHERE sale_id = ? AND sold_price_usd = 5`,
      )
      .get(id) as { id: number };
    repo.refundSaleItem({
      saleId: id,
      saleItemId: five.id,
      refundQuantity: 1,
      userId: USER_ID,
    });
    expect(receipt(id)).toEqual(before);
  });

  it("(l) a session-basket sale reads the basket's back-filled paid amounts (R3)", () => {
    const clientId = addClient();
    const id = sell(
      { client_id: clientId, payments: [] },
      { deferPayment: true },
    );
    const txnId = saleTxnId(id);
    const sessionId = Number(
      db
        .prepare(
          `INSERT INTO customer_sessions (tenant_id, customer_name, started_by, is_active)
           VALUES (1, 'Basket', 'admin', 0)`,
        )
        .run().lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO customer_session_transactions (tenant_id, session_id, transaction_type,
         transaction_id, unified_transaction_id, amount_usd)
       VALUES (1, ?, 'sale', ?, ?, 15)`,
    ).run(sessionId, id, txnId);
    // what SessionPaymentService.recordBasketPayment does for a paid member
    repo.markSalePaid(id, 10, 5 * RATE, RATE);

    expect(receipt(id)).toEqual(
      expected({ tender_usd: 10, tender_lbp: 5 * RATE }),
    );
  });

  it("(l2) a session sale the basket left partly unpaid shows the rest on account", () => {
    const clientId = addClient();
    const id = sell(
      { client_id: clientId, payments: [] },
      { deferPayment: true },
    );
    const txnId = saleTxnId(id);
    const sessionId = Number(
      db
        .prepare(
          `INSERT INTO customer_sessions (tenant_id, customer_name, started_by, is_active)
           VALUES (1, 'Basket', 'admin', 0)`,
        )
        .run().lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO customer_session_transactions (tenant_id, session_id, transaction_type,
         transaction_id, unified_transaction_id, amount_usd)
       VALUES (1, ?, 'sale', ?, ?, 15)`,
    ).run(sessionId, id, txnId);
    repo.markSalePaid(id, 6, 0, RATE);

    expect(receipt(id)).toEqual(expected({ tender_usd: 6, on_account_usd: 9 }));
  });

  it("(m) a counter-paid sale linked to an open session still reads its own payments, gift card and account", () => {
    const clientId = addClient();
    addVoucher(clientId, 5, "GIFT-M");
    const id = sell({
      client_id: clientId,
      payments: [
        {
          method: "GIFT_CARD",
          currency_code: "USD",
          amount: 5,
          voucher_code: "GIFT-M",
        },
        { method: "CASH", currency_code: "USD", amount: 4 },
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 6 },
      ],
    });
    const before = receipt(id);
    // the POS links a counter-paid sale to the active session; even if that
    // link carried the unified transaction id, the sale is not a basket item
    const sessionId = Number(
      db
        .prepare(
          `INSERT INTO customer_sessions (tenant_id, customer_name, started_by, is_active)
           VALUES (1, 'Open', 'admin', 1)`,
        )
        .run().lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO customer_session_transactions (tenant_id, session_id, transaction_type,
         transaction_id, unified_transaction_id, amount_usd)
       VALUES (1, ?, 'sale', ?, ?, 15)`,
    ).run(sessionId, id, saleTxnId(id));
    new DebtRepository().addRepayment({
      client_id: clientId,
      amount_usd: 6,
      amount_lbp: 0,
      created_by: USER_ID,
    });
    expect(receipt(id)).toEqual(before);
    expect(before).toEqual(
      expected({ tender_usd: 4, gift_card_usd: 5, on_account_usd: 6 }),
    );
  });

  it("(n) a For-Partner sale: no counter payment, nothing on the customer's account", () => {
    const partnerId = Number(
      db
        .prepare(`INSERT INTO partners (tenant_id, name) VALUES (1, 'P333')`)
        .run().lastInsertRowid,
    );
    const id = sell({ partnerId, partnerMode: "FOR", payments: [] });
    // the partner owes the sale (partner ledger); the receipt shows no
    // payment and no account line — same "Paid USD: $0.00" as the old
    // reprint, which read sales.paid_usd = 0 for these sales
    expect(repo.getSaleWithCustomer(id)!.paid_usd).toBe(0);
    expect(receipt(id)).toEqual(expected({}));
  });

  it("ignores another tenant's rows that point at the same transaction id", () => {
    const clientId = addClient();
    const id = sell({
      client_id: clientId,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 5 },
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 10 },
      ],
    });
    const before = receipt(id);
    const txnId = saleTxnId(id);

    db.prepare(
      `INSERT INTO tenants (id, name, slug) VALUES (2, 'Other', 'other')`,
    ).run();
    const foreignClient = Number(
      db
        .prepare(
          `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (2, 'Foreign', '70000000')`,
        )
        .run().lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO payments (tenant_id, transaction_id, method, drawer_name, currency_code, amount, created_by)
       VALUES (2, ?, 'CASH', 'General', 'USD', 999, 1)`,
    ).run(txnId);
    db.prepare(
      `INSERT INTO payments (tenant_id, transaction_id, method, drawer_name, currency_code, amount, created_by)
       VALUES (2, ?, 'CASH', 'General', 'LBP', 999, 1)`,
    ).run(txnId);
    db.prepare(
      `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, transaction_id, created_by)
       VALUES (2, ?, 'Sale Debt', 777, ?, 1)`,
    ).run(foreignClient, txnId);
    db.prepare(
      `INSERT INTO vouchers (tenant_id, code, client_id, client_name, amount, currency_code, status,
         redeemed_transaction_id, created_by)
       VALUES (2, 'FOREIGN', ?, 'Foreign', 555, 'USD', 'redeemed', ?, 1)`,
    ).run(foreignClient, txnId);

    expect(receipt(id)).toEqual(before);
    expect(before).toEqual(expected({ tender_usd: 5, on_account_usd: 10 }));
  });
});
