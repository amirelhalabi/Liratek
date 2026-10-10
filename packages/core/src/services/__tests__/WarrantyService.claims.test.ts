/**
 * LIRA-296 (T035–T037) — warranty claims: guards, what each action writes,
 * voiding, and resolving a defective item. Real schema; nothing mocked.
 *
 * Money assertions are DELTAS around the action (rule 15), and every row is
 * found by identity (claim id, source_table/source_id), never by position.
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
} from "../../repositories/SalesRepository";
import { resetTransactionRepository } from "../../repositories/TransactionRepository";
import {
  getStockBatchRepository,
  resetStockBatchRepository,
} from "../../repositories/StockBatchRepository";
import { resetProductUnitRepository } from "../../repositories/ProductUnitRepository";
import { resetDebtRepository } from "../../repositories/DebtRepository";
import { resetWarrantyRepository } from "../../repositories/WarrantyRepository";
import { MaintenanceService } from "../MaintenanceService";
import { getWarrantyService, resetWarrantyService } from "../WarrantyService";
import { snapshotLedgers } from "../../repositories/testHelpers/postingAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const ADMIN = { userId: 1, role: "admin" };
const STAFF = { userId: 2, role: "staff" };
const DAY = "2026-10-10";
let db: Database.Database;

type Ok = {
  success: true;
  data: {
    claim: { id: number; status: string };
    repairJobId?: number;
    replacementUnitId?: number;
    refundTransactionId?: number;
  };
};
type Fail = { success: false; code: string; error: string };

function resetAll(): void {
  resetSalesRepository();
  resetTransactionRepository();
  resetStockBatchRepository();
  resetProductUnitRepository();
  resetDebtRepository();
  resetWarrantyRepository();
  resetWarrantyService();
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
  db.exec(`
    INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (7, 1, 'Rami Haddad', '71123456');
    INSERT OR IGNORE INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (2, 1, 'cashier', '', 'staff', 1);
  `);
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
  months: number | null = 3,
): number {
  const id = Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity, warranty_months)
         VALUES (1, ?, 'Product', 'Accessories', ?, 20, ?, ?)`,
      )
      .run(name, cost, stock, months).lastInsertRowid,
  );
  if (stock > 0) {
    getStockBatchRepository().createBatch({
      product_id: id,
      supplier_id: null,
      quantity: stock,
      unit_cost_usd: cost,
      books_debt: false,
      created_by: 1,
    });
  }
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

function sell(
  productId: number,
  opts: { unitId?: number; qty?: number; day?: string } = {},
): number {
  const qty = opts.qty ?? 1;
  const r = new SalesRepository().processSale(
    {
      client_id: 7,
      items: [
        {
          product_id: productId,
          quantity: qty,
          price: 20,
          ...(opts.unitId ? { product_unit_id: opts.unitId } : {}),
        },
      ],
      total_amount: 20 * qty,
      discount: 0,
      final_amount: 20 * qty,
      payment_usd: 20 * qty,
      payment_lbp: 0,
      payments: [{ method: "CASH", currency_code: "USD", amount: 20 * qty }],
      exchange_rate: 89500,
      status: "completed",
      client_day: opts.day ?? DAY,
    },
    1,
  );
  expect(r.success).toBe(true);
  return (
    db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(r.id) as {
      id: number;
    }
  ).id;
}

const claim = (input: Record<string, unknown>, actor = ADMIN) =>
  getWarrantyService().createClaim(
    { client_day: DAY, ...input } as never,
    actor,
  ) as Ok | Fail;

const stockOf = (id: number) =>
  (
    db
      .prepare(`SELECT stock_quantity AS s FROM products WHERE id = ?`)
      .get(id) as { s: number }
  ).s;
const costRows = (claimId: number) =>
  db
    .prepare(
      `SELECT profit_usd, profit_lbp, amount_usd, client_id, metadata_json, reverses_id FROM transactions
      WHERE type = 'WARRANTY_COST' AND source_table = 'warranty_claims' AND source_id = ? ORDER BY id`,
    )
    .all(claimId) as {
    profit_usd: number;
    profit_lbp: number;
    amount_usd: number;
    client_id: number | null;
    metadata_json: string;
    reverses_id: number | null;
  }[];
const paymentsOf = (txnId: number) =>
  (
    db
      .prepare(`SELECT COUNT(*) AS n FROM payments WHERE transaction_id = ?`)
      .get(txnId) as { n: number }
  ).n;

describe("guards", () => {
  it("an expired warranty is NOT_COVERED unless an admin overrides it with a reason", () => {
    const p = addProduct("Old buds", 3, 6, 1);
    const line = sell(p, { day: "2026-01-01" }); // ends 2026-02-01
    expect(claim({ sale_item_id: line, action: "REPAIR" })).toMatchObject({
      success: false,
      code: "NOT_COVERED",
    });
    expect(
      claim(
        { sale_item_id: line, action: "REPAIR", override_reason: "goodwill" },
        STAFF,
      ),
    ).toMatchObject({ success: false, code: "NOT_COVERED" });
    expect(
      claim({
        sale_item_id: line,
        action: "REPAIR",
        override_reason: "goodwill",
      }),
    ).toMatchObject({ success: true });
  });

  it("a void warranty (fully refunded) is NOT_COVERED, even with an override", () => {
    const p = addProduct("Buds", 3, 6);
    const line = sell(p);
    const saleId = (
      db.prepare(`SELECT sale_id FROM sale_items WHERE id = ?`).get(line) as {
        sale_id: number;
      }
    ).sale_id;
    new SalesRepository().refundSaleItem({
      saleId,
      saleItemId: line,
      refundQuantity: 1,
      userId: 1,
    });
    expect(
      claim({
        sale_item_id: line,
        action: "REPAIR",
        override_reason: "please",
      }),
    ).toMatchObject({ success: false, code: "NOT_COVERED" });
  });

  it("staff may start a REPAIR only (REPLACE/REFUND are admin)", () => {
    const p = addProduct("Buds", 3, 6);
    const line = sell(p);
    expect(
      claim({ sale_item_id: line, action: "REPLACE" }, STAFF),
    ).toMatchObject({ success: false, code: "FORBIDDEN_ACTION" });
    expect(
      claim({ sale_item_id: line, action: "REFUND" }, STAFF),
    ).toMatchObject({ success: false, code: "FORBIDDEN_ACTION" });
    expect(
      claim({ sale_item_id: line, action: "REPAIR" }, STAFF),
    ).toMatchObject({ success: true });
  });

  it("one open claim per unit: ALREADY_CLAIMED", () => {
    const p = addProduct("Phone", 1, 100);
    const unit = addUnit(p, "SN-1");
    const line = sell(p, { unitId: unit });
    expect(
      claim({ sale_item_id: line, unit_id: unit, action: "REPAIR" }),
    ).toMatchObject({ success: true });
    expect(
      claim({ sale_item_id: line, unit_id: unit, action: "REPAIR" }),
    ).toMatchObject({ success: false, code: "ALREADY_CLAIMED" });
  });

  it("a line's claims never exceed its covered units: NO_COVERED_UNIT_LEFT", () => {
    const p = addProduct("Cable", 5, 2);
    const line = sell(p, { qty: 2 });
    expect(claim({ sale_item_id: line, action: "REPLACE" })).toMatchObject({
      success: true,
    });
    expect(claim({ sale_item_id: line, action: "REPLACE" })).toMatchObject({
      success: true,
    });
    expect(claim({ sale_item_id: line, action: "REPLACE" })).toMatchObject({
      success: false,
      code: "NO_COVERED_UNIT_LEFT",
    });
  });

  it("REPLACE with nothing in stock: OUT_OF_STOCK", () => {
    const p = addProduct("Last one", 1, 6);
    const line = sell(p);
    expect(claim({ sale_item_id: line, action: "REPLACE" })).toMatchObject({
      success: false,
      code: "OUT_OF_STOCK",
    });
  });
});

describe("REFUND claim", () => {
  it("refunds the money, never restocks, holds the item as defective, books −cost", () => {
    const p = addProduct("Earbuds", 5, 6);
    const line = sell(p);
    const drawer0 = snapshotLedgers(db).drawers["General|USD"] ?? 0;
    const stock0 = stockOf(p);
    const r = claim({
      sale_item_id: line,
      action: "REFUND",
      notes: "dead left bud",
    }) as Ok;
    expect(r.success).toBe(true);
    expect(r.data.claim.status).toBe("DONE");
    expect(r.data.refundTransactionId).toBeTruthy();
    expect(
      (snapshotLedgers(db).drawers["General|USD"] ?? 0) - drawer0,
    ).toBeCloseTo(-20, 6);
    expect(stockOf(p)).toBe(stock0);
    expect(
      db
        .prepare(
          `SELECT status, unit_cost_usd, quantity FROM defective_items WHERE warranty_claim_id = ?`,
        )
        .get(r.data.claim.id),
    ).toEqual({ status: "HELD", unit_cost_usd: 6, quantity: 1 });
    const cost = costRows(r.data.claim.id);
    expect(cost).toHaveLength(1);
    expect(cost[0]).toMatchObject({
      profit_usd: -6,
      profit_lbp: 0,
      amount_usd: 0,
      client_id: 7,
    });
    expect(JSON.parse(cost[0]!.metadata_json)).toMatchObject({
      is_auto: true,
      warranty_claim_id: r.data.claim.id,
    });
    expect(
      paymentsOf(
        (
          db
            .prepare(
              `SELECT id FROM transactions WHERE type='WARRANTY_COST' AND source_id = ?`,
            )
            .get(r.data.claim.id) as { id: number }
        ).id,
      ),
    ).toBe(0);
  });
});

describe("REPLACE claim", () => {
  it("takes a unit from stock (FIFO, owned by the claim), keeps the original end date, holds the faulty one", () => {
    const p = addProduct("Phone", 2, 100, 12);
    const sold = addUnit(p, "SN-SOLD");
    const spare = addUnit(p, "SN-SPARE");
    const line = sell(p, { unitId: sold });
    const until = (
      db
        .prepare(`SELECT warranty_until FROM sale_items WHERE id = ?`)
        .get(line) as { warranty_until: string }
    ).warranty_until;
    const stock0 = stockOf(p);
    const r = claim({
      sale_item_id: line,
      unit_id: sold,
      action: "REPLACE",
      replacement_unit_id: spare,
    }) as Ok;
    expect(r.success).toBe(true);
    expect(r.data.replacementUnitId).toBe(spare);
    expect(stockOf(p)).toBe(stock0 - 1);
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM stock_batch_consumptions WHERE warranty_claim_id = ?`,
        )
        .get(r.data.claim.id),
    ).toEqual({ n: 1 });
    expect(
      db
        .prepare(
          `SELECT status, warranty_claim_id, warranty_override_until FROM product_units WHERE id = ?`,
        )
        .get(spare),
    ).toEqual({
      status: "SOLD",
      warranty_claim_id: r.data.claim.id,
      warranty_override_until: until,
    });
    expect(
      db
        .prepare(`SELECT is_defective FROM product_units WHERE id = ?`)
        .get(sold),
    ).toEqual({ is_defective: 1 });
    expect(
      db
        .prepare(
          `SELECT status, unit_id FROM defective_items WHERE warranty_claim_id = ?`,
        )
        .get(r.data.claim.id),
    ).toEqual({ status: "HELD", unit_id: sold });
    expect(costRows(r.data.claim.id)[0]).toMatchObject({ profit_usd: -100 });
    // The original sale is untouched.
    expect(
      db
        .prepare(`SELECT refunded_quantity FROM sale_items WHERE id = ?`)
        .get(line),
    ).toEqual({ refunded_quantity: 0 });
  });

  it("a tracked product needs the replacement unit picked", () => {
    const p = addProduct("Phone", 2, 100, 12);
    const sold = addUnit(p, "SN-A");
    addUnit(p, "SN-B");
    const line = sell(p, { unitId: sold });
    expect(
      claim({ sale_item_id: line, unit_id: sold, action: "REPLACE" }),
    ).toMatchObject({ success: false, code: "REPLACEMENT_UNIT_REQUIRED" });
  });
});

describe("REPAIR claim", () => {
  it("opens a free repair job for the customer; delivering it books the parts once", () => {
    const p = addProduct("Speaker", 3, 6);
    const part = addProduct("Driver", 3, 4);
    const line = sell(p);
    const r = claim({
      sale_item_id: line,
      action: "REPAIR",
      notes: "no sound",
    }) as Ok;
    expect(r.data.claim.status).toBe("OPEN");
    const job = db
      .prepare(
        `SELECT client_id, client_name, final_amount_usd, warranty_claim_id, issue_description FROM maintenance WHERE id = ?`,
      )
      .get(r.data.repairJobId) as Record<string, unknown>;
    expect(job).toMatchObject({
      client_id: 7,
      client_name: "Rami Haddad",
      final_amount_usd: 0,
      warranty_claim_id: r.data.claim.id,
      issue_description: "no sound",
    });

    const svc = new MaintenanceService();
    // A warranty repair is free: charging it is refused.
    expect(
      svc.saveJob(
        {
          id: r.data.repairJobId!,
          device_name: "Speaker",
          status: "Delivered_Paid",
          final_amount_usd: 5,
          payments: [{ method: "CASH", currency_code: "USD", amount: 5 }],
        },
        1,
      ),
    ).toMatchObject({ success: false });
    // Deleting it is refused (void the claim instead).
    expect(svc.deleteJob(r.data.repairJobId!)).toMatchObject({
      success: false,
    });

    for (let i = 0; i < 2; i++) {
      expect(
        svc.saveJob(
          {
            id: r.data.repairJobId!,
            device_name: "Speaker",
            status: "Delivered",
            parts: [{ product_id: part, quantity: 1 }],
          },
          1,
        ).success,
      ).toBe(true);
    }
    expect(costRows(r.data.claim.id).map((c) => c.profit_usd)).toEqual([-4]);
    expect(
      db
        .prepare(`SELECT status FROM warranty_claims WHERE id = ?`)
        .get(r.data.claim.id),
    ).toEqual({ status: "DONE" });
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM transactions WHERE type = 'MAINTENANCE' AND source_id = ?`,
        )
        .get(r.data.repairJobId),
    ).toEqual({ n: 0 });
  });
});

describe("voidClaim", () => {
  it("refuses a second void", () => {
    const p = addProduct("Buds", 3, 6);
    const line = sell(p);
    const r = claim({ sale_item_id: line, action: "REPAIR" }) as Ok;
    expect(
      getWarrantyService().voidClaim({ claim_id: r.data.claim.id }, ADMIN),
    ).toMatchObject({ success: true });
    expect(
      getWarrantyService().voidClaim({ claim_id: r.data.claim.id }, ADMIN),
    ).toMatchObject({ success: false, code: "ALREADY_VOIDED" });
  });

  it("is admin only", () => {
    const p = addProduct("Buds", 3, 6);
    const line = sell(p);
    const r = claim({ sale_item_id: line, action: "REPAIR" }) as Ok;
    expect(
      getWarrantyService().voidClaim({ claim_id: r.data.claim.id }, STAFF),
    ).toMatchObject({ success: false, code: "FORBIDDEN_ACTION" });
  });

  it("refuses once the defective item was resolved", () => {
    const p = addProduct("Buds", 3, 6);
    const line = sell(p);
    const r = claim({ sale_item_id: line, action: "REFUND" }) as Ok;
    const defectiveId = (
      db
        .prepare(`SELECT id FROM defective_items WHERE warranty_claim_id = ?`)
        .get(r.data.claim.id) as { id: number }
    ).id;
    expect(
      getWarrantyService().resolveDefective(
        { defective_item_id: defectiveId, outcome: "WRITE_OFF" },
        ADMIN,
      ),
    ).toMatchObject({ success: true });
    expect(
      getWarrantyService().voidClaim({ claim_id: r.data.claim.id }, ADMIN),
    ).toMatchObject({ success: false, code: "DEFECTIVE_RESOLVED" });
  });
});

describe("resolveDefective", () => {
  it("WRITE_OFF keeps the cost already booked", () => {
    const p = addProduct("Buds", 3, 6);
    const line = sell(p);
    const r = claim({ sale_item_id: line, action: "REFUND" }) as Ok;
    const d = (
      db
        .prepare(`SELECT id FROM defective_items WHERE warranty_claim_id = ?`)
        .get(r.data.claim.id) as { id: number }
    ).id;
    getWarrantyService().resolveDefective(
      { defective_item_id: d, outcome: "WRITE_OFF" },
      ADMIN,
    );
    expect(
      db.prepare(`SELECT status FROM defective_items WHERE id = ?`).get(d),
    ).toEqual({ status: "WRITTEN_OFF" });
    expect(costRows(r.data.claim.id).map((c) => c.profit_usd)).toEqual([-6]);
  });

  it("NOT_FAULTY puts a refunded item back in stock at its cost and books +cost", () => {
    const p = addProduct("Buds", 3, 6);
    const unit = addUnit(p, "SN-9");
    const line = sell(p, { unitId: unit });
    const r = claim({
      sale_item_id: line,
      unit_id: unit,
      action: "REFUND",
    }) as Ok;
    const stock0 = stockOf(p);
    const d = (
      db
        .prepare(`SELECT id FROM defective_items WHERE warranty_claim_id = ?`)
        .get(r.data.claim.id) as { id: number }
    ).id;
    expect(
      getWarrantyService().resolveDefective(
        { defective_item_id: d, outcome: "NOT_FAULTY" },
        ADMIN,
      ),
    ).toMatchObject({ success: true });
    expect(stockOf(p)).toBe(stock0 + 1);
    expect(
      db
        .prepare(`SELECT status, is_defective FROM product_units WHERE id = ?`)
        .get(unit),
    ).toEqual({ status: "IN_STOCK", is_defective: 0 });
    expect(costRows(r.data.claim.id).map((c) => c.profit_usd)).toEqual([-6, 6]);
  });

  it("NOT_FAULTY on a replaced item creates a fresh batch at its cost (the sale stands)", () => {
    const p = addProduct("Cable", 3, 2);
    const line = sell(p);
    const r = claim({ sale_item_id: line, action: "REPLACE" }) as Ok;
    const batches0 = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM product_stock_batches WHERE product_id = ?`,
        )
        .get(p) as { n: number }
    ).n;
    const d = (
      db
        .prepare(`SELECT id FROM defective_items WHERE warranty_claim_id = ?`)
        .get(r.data.claim.id) as { id: number }
    ).id;
    getWarrantyService().resolveDefective(
      { defective_item_id: d, outcome: "NOT_FAULTY" },
      ADMIN,
    );
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM product_stock_batches WHERE product_id = ?`,
          )
          .get(p) as { n: number }
      ).n,
    ).toBe(batches0 + 1);
    expect(
      db
        .prepare(
          `SELECT restock_batch_id IS NOT NULL AS has FROM defective_items WHERE id = ?`,
        )
        .get(d),
    ).toEqual({ has: 1 });
  });

  it("only HELD items can be resolved", () => {
    const p = addProduct("Buds", 3, 6);
    const line = sell(p);
    const r = claim({ sale_item_id: line, action: "REFUND" }) as Ok;
    const d = (
      db
        .prepare(`SELECT id FROM defective_items WHERE warranty_claim_id = ?`)
        .get(r.data.claim.id) as { id: number }
    ).id;
    getWarrantyService().resolveDefective(
      { defective_item_id: d, outcome: "WRITE_OFF" },
      ADMIN,
    );
    expect(
      getWarrantyService().resolveDefective(
        { defective_item_id: d, outcome: "NOT_FAULTY" },
        ADMIN,
      ),
    ).toMatchObject({ success: false, code: "NOT_HELD" });
  });
});

describe("claim history and the search", () => {
  it("lists a line's claims newest first, and the search shows the open claim", () => {
    const p = addProduct("Buds", 3, 6);
    const line = sell(p);
    const a = claim({
      sale_item_id: line,
      action: "REPAIR",
      notes: "first",
    }) as Ok;
    const history = getWarrantyService().claimsFor({ sale_item_id: line });
    expect(history.map((c) => c.id)).toEqual([a.data.claim.id]);
    expect(history[0]).toMatchObject({
      action: "REPAIR",
      status: "OPEN",
      notes: "first",
      username: "admin",
    });
    const [row] = getWarrantyService().search({ client_day: DAY, q: "Buds" });
    expect(row?.openClaimId).toBe(a.data.claim.id);
  });
});
