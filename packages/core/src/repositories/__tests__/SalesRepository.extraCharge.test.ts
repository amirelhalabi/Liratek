/**
 * LIRA-319 US1 (T013–T015) — a POS sale with an extra charge.
 *
 * The owner's example: an item costs $5 and is priced $6; the cashier adds a
 * $1 extra, the customer pays $7. The item keeps its price and cost; the
 * SALE row's amount includes the extra (7), its profit does not (1 = item
 * margin), and the extra is stamped on its own column (research R2).
 *
 * Real production schema (create_db.sql + migrations); nothing is mocked.
 * Field names come from `saleProcessSchema` — fixtures are typed as the
 * schema's input and parsed through it (rule 24). Refusals that only the
 * repository can enforce (deferred session item, extra above total) call
 * `processSale` directly with the typed request.
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
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetStockBatchRepository } from "../StockBatchRepository";
import { resetProductUnitRepository } from "../ProductUnitRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetDebtService } from "../../services/DebtService";
import { saleProcessSchema } from "../../validators/sale";
import {
  snapshotLedgers,
  ledgerDeltas,
  expectPostings,
} from "../testHelpers/postingAssert";

type SalePayload = z.input<typeof saleProcessSchema>;

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");
const USER_ID = 1;
const RATE = 89_500;
const PRICE = 6;
const COST = 5;

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
}

function addProduct(): number {
  return Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, ?, 'Product', ?, ?, 10)`,
      )
      .run(`P-${Math.random()}`, COST, PRICE).lastInsertRowid,
  );
}

function addClient(): number {
  return Number(
    db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, ?, ?)`,
      )
      .run(`Client ${Math.random()}`, `03${Math.floor(Math.random() * 1e6)}`)
      .lastInsertRowid,
  );
}

function addPartner(): number {
  return Number(
    db
      .prepare(`INSERT INTO partners (tenant_id, name) VALUES (1, ?)`)
      .run(`Partner ${Math.random()}`).lastInsertRowid,
  );
}

/** A one-item $6 sale (cost $5) as CheckoutModal sends it. */
function payload(extra: Partial<SalePayload>): SalePayload {
  return {
    client_id: null,
    items: [{ product_id: addProduct(), quantity: 1, price: PRICE }],
    total_amount: PRICE,
    discount: 0,
    final_amount: PRICE,
    payment_usd: 0,
    payment_lbp: 0,
    exchange_rate: RATE,
    status: "completed",
    ...extra,
  };
}

function sale(extra: Partial<SalePayload>): SaleRequest {
  return saleProcessSchema.parse(payload(extra)) as SaleRequest;
}

interface SaleTxnRow {
  id: number;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  extra_usd: number;
  extra_lbp: number;
  metadata_json: string | null;
}

function saleTxn(saleId: number): SaleTxnRow {
  return db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, profit_usd, profit_lbp, extra_usd, extra_lbp, metadata_json
         FROM transactions
        WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`,
    )
    .get(saleId) as SaleTxnRow;
}

function txnCount(): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM transactions`).get() as { c: number }
  ).c;
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

describe("T013 — a POS sale with a $1 extra (failing-first)", () => {
  it("cash $7: SALE amount 7, profit 1, extra 1; General +7; item price 6 / cost 5", () => {
    const before = snapshotLedgers(db);
    const res = repo.processSale(
      sale({
        extra_usd: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 7 }],
      }),
      USER_ID,
    );
    expect(res).toEqual({ success: true, id: expect.any(Number) });
    const txn = saleTxn(res.id!);
    expect(txn.amount_usd).toBeCloseTo(7, 6);
    expect(txn.amount_lbp).toBe(0);
    expect(txn.profit_usd).toBeCloseTo(1, 6);
    expect(txn.profit_lbp).toBe(0);
    expect(txn.extra_usd).toBeCloseTo(1, 6);
    expect(txn.extra_lbp).toBe(0);
    expect(JSON.parse(txn.metadata_json ?? "{}")).toMatchObject({
      extra_usd: 1,
    });
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": 7 },
    });
    const item = db
      .prepare(
        `SELECT sold_price_usd, cost_price_snapshot_usd FROM sale_items WHERE sale_id = ?`,
      )
      .get(res.id) as { sold_price_usd: number; cost_price_snapshot_usd: number };
    expect(item).toEqual({ sold_price_usd: 6, cost_price_snapshot_usd: 5 });
    const s = db
      .prepare(`SELECT final_amount_usd FROM sales WHERE id = ?`)
      .get(res.id) as { final_amount_usd: number };
    expect(s.final_amount_usd).toBe(6);
  });

  it("Whish $7: the Whish drawer gets +7", () => {
    const before = snapshotLedgers(db);
    const res = repo.processSale(
      sale({
        extra_usd: 1,
        payments: [{ method: "WHISH", currency_code: "USD", amount: 7 }],
      }),
      USER_ID,
    );
    expect(res.success).toBe(true);
    expect(saleTxn(res.id!).amount_usd).toBeCloseTo(7, 6);
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "Whish_App|USD": 7 },
    });
  });

  it("kept change reconciles against price + extra: $10 paid, $2.50 back, $0.50 kept", () => {
    const res = repo.processSale(
      sale({
        extra_usd: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
        change_given_usd: 2.5,
        kept_change_usd: 0.5,
      }),
      USER_ID,
    );
    expect(res.success).toBe(true);
    const txn = saleTxn(res.id!);
    expect(txn.amount_usd).toBeCloseTo(7, 6);
    // item margin 1 + kept 0.50; the extra is NOT in profit
    expect(txn.profit_usd).toBeCloseTo(1.5, 6);
    expect(txn.extra_usd).toBeCloseTo(1, 6);
  });

  it("void: every ledger nets to 0 and the row leaves profit (VOIDED)", () => {
    const before = snapshotLedgers(db);
    const res = repo.processSale(
      sale({
        extra_usd: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 7 }],
      }),
      USER_ID,
    );
    getTransactionRepository().voidTransaction(saleTxn(res.id!).id, USER_ID);
    expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
      drawers: {},
      supplier: {},
      partner: {},
      debt: {},
    });
  });
});

describe("T014 — refusals: success false, nothing posts (failing-first)", () => {
  function expectRefused(request: SaleRequest, message: string | RegExp): void {
    const before = snapshotLedgers(db);
    const txnsBefore = txnCount();
    const res = repo.processSale(request, USER_ID);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(message);
    expectPostings(before, snapshotLedgers(db), {});
    expect(txnCount()).toBe(txnsBefore);
  }

  /** A request the schema would have refused, sent straight to the repo —
   *  the session checkout calls processSale without the schema. */
  function raw(extra: Partial<SaleRequest>): SaleRequest {
    return { ...(payload({}) as SaleRequest), ...extra };
  }

  describe("schema (both transports)", () => {
    it("extra + discount", () => {
      const r = saleProcessSchema.safeParse(
        payload({ extra_usd: 1, discount: 1, final_amount: 5 }),
      );
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toBe(
        "A sale can have a discount or an extra, not both.",
      );
    });

    it("extra on a for-partner sale", () => {
      const r = saleProcessSchema.safeParse(
        payload({ extra_usd: 1, partnerId: 3, partnerMode: "FOR", payments: [] }),
      );
      expect(r.success).toBe(false);
      expect(r.error?.issues.map((i) => i.message)).toContain(
        "No extra on a for-partner sale.",
      );
    });

    it("an LBP extra on a POS sale (POS sales are USD-priced)", () => {
      const r = saleProcessSchema.safeParse(payload({ extra_lbp: 10_000 }));
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toBe(
        "A POS sale's extra is in dollars — enter it in USD.",
      );
    });

    it("a negative extra", () => {
      expect(saleProcessSchema.safeParse(payload({ extra_usd: -1 })).success).toBe(
        false,
      );
    });
  });

  describe("repository (server-side, whatever the caller)", () => {
    it("extra + discount", () => {
      expectRefused(
        raw({
          extra_usd: 1,
          discount: 1,
          final_amount: 5,
          payments: [{ method: "CASH", currency_code: "USD", amount: 6 }],
        }),
        "A sale can have a discount or an extra, not both.",
      );
    });

    it("extra on a for-partner sale", () => {
      expectRefused(
        raw({ extra_usd: 1, partnerId: addPartner(), partnerMode: "FOR", payments: [] }),
        "No extra on a for-partner sale.",
      );
    });

    it("extra above the pre-extra total", () => {
      expectRefused(
        raw({
          extra_usd: 6.01,
          payments: [{ method: "CASH", currency_code: "USD", amount: 12.01 }],
        }),
        "The extra can't be more than the sale itself.",
      );
    });

    it("extra on a deferred (session basket) item", () => {
      expectRefused(
        raw({ extra_usd: 1, deferPayment: true }),
        "Add the extra at the session checkout.",
      );
    });

    it("an LBP extra on a POS sale", () => {
      expectRefused(
        raw({
          extra_lbp: 10_000,
          payments: [{ method: "CASH", currency_code: "USD", amount: 6 }],
        }),
        "A POS sale's extra is in dollars — enter it in USD.",
      );
    });
  });

  it("an extra equal to the total is accepted (the cap is inclusive)", () => {
    const res = repo.processSale(
      sale({
        extra_usd: 6,
        payments: [{ method: "CASH", currency_code: "USD", amount: 12 }],
      }),
      USER_ID,
    );
    expect(res.success).toBe(true);
  });
});

describe("T015 — the debt residual includes the extra (failing-first)", () => {
  it("$6 + $1 extra, $6 paid with a client → Sale Debt +1", () => {
    const clientId = addClient();
    const before = snapshotLedgers(db);
    const res = repo.processSale(
      sale({
        client_id: clientId,
        extra_usd: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 6 }],
      }),
      USER_ID,
    );
    expect(res.success).toBe(true);
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": 6 },
      debt: { [`${clientId}|USD`]: 1 },
    });
  });

  it("all on the client's account: debt +7; void → every ledger back to 0", () => {
    const clientId = addClient();
    const before = snapshotLedgers(db);
    const res = repo.processSale(
      sale({
        client_id: clientId,
        extra_usd: 1,
        payments: [
          { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 7 },
        ],
      }),
      USER_ID,
    );
    expect(res.success).toBe(true);
    expectPostings(before, snapshotLedgers(db), {
      debt: { [`${clientId}|USD`]: 7 },
    });
    getTransactionRepository().voidTransaction(saleTxn(res.id!).id, USER_ID);
    expectPostings(before, snapshotLedgers(db), {});
  });
});
