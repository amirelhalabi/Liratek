/**
 * LIRA-329 T026 — a warranty claim's transactions keep what the claim was:
 * its id and action, the unit claimed and the replacement handed over, the
 * notes, the admin's override reason on an expired warranty, and the sale
 * line (or repair) it was made on. Both the WARRANTY_COST rows and the
 * warranty REFUND row carry them.
 *
 * Money columns are asserted FIRST at today's values (FR-008); those passed
 * on the pre-change run. Expected details go through the kind's own schema
 * (rule 24). Rows are found by identity (claim id / refund id), never by
 * position (rule 15). Rule 17: run before the builder existed and seen
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
} from "../../repositories/SalesRepository";
import { resetTransactionRepository } from "../../repositories/TransactionRepository";
import {
  getStockBatchRepository,
  resetStockBatchRepository,
} from "../../repositories/StockBatchRepository";
import { resetProductUnitRepository } from "../../repositories/ProductUnitRepository";
import { resetDebtRepository } from "../../repositories/DebtRepository";
import { resetWarrantyRepository } from "../../repositories/WarrantyRepository";
import { resetWarrantyClaimRepository } from "../../repositories/WarrantyClaimRepository";
import { MaintenanceService } from "../MaintenanceService";
import { getWarrantyService, resetWarrantyService } from "../WarrantyService";
import { warrantyClaimDetailsSchema } from "../../validators/transactionDetails";
import { expectEverySnapshotMatchesPayments } from "../../repositories/testHelpers/paymentSnapshotAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const ADMIN = { userId: 1, role: "admin" };
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

interface TxnRow {
  id: number;
  type: string;
  amount_usd: number;
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
  resetWarrantyRepository();
  resetWarrantyClaimRepository();
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
  db.exec(
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (7, 1, 'Rami Haddad', '71123456')`,
  );
});

// LIRA-329 T036 — every payment snapshot saved by a case above equals
// the payments rows it booked (method, currency, amount, direction).
afterEach(() => {
  expectEverySnapshotMatchesPayments(db);
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
  getStockBatchRepository().createBatch({
    product_id: id,
    supplier_id: null,
    quantity: stock,
    unit_cost_usd: cost,
    books_debt: false,
    created_by: 1,
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

function sell(productId: number, opts: { unitId?: number; day?: string } = {}) {
  const r = new SalesRepository().processSale(
    {
      client_id: 7,
      items: [
        {
          product_id: productId,
          quantity: 1,
          price: 20,
          ...(opts.unitId ? { product_unit_id: opts.unitId } : {}),
        },
      ],
      total_amount: 20,
      discount: 0,
      final_amount: 20,
      payment_usd: 20,
      payment_lbp: 0,
      payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
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

const claim = (input: Record<string, unknown>) =>
  getWarrantyService().createClaim(
    { client_day: DAY, ...input } as never,
    ADMIN,
  ) as Ok;

const SELECT = `SELECT id, type, amount_usd, profit_usd, profit_lbp, client_name, client_phone, metadata_json FROM transactions`;

const costRows = (claimId: number) =>
  db
    .prepare(
      `${SELECT} WHERE type = 'WARRANTY_COST' AND source_table = 'warranty_claims' AND source_id = ? ORDER BY id`,
    )
    .all(claimId) as TxnRow[];

const txn = (id: number) =>
  db.prepare(`${SELECT} WHERE id = ?`).get(id) as TxnRow;

function details(row: TxnRow): unknown {
  return (JSON.parse(row.metadata_json) as Record<string, unknown>).details;
}

function expectDetails(row: TxnRow, expected: Record<string, unknown>): void {
  expect(warrantyClaimDetailsSchema.parse(expected)).toEqual(expected);
  expect(details(row)).toEqual(expected);
}

describe("LIRA-329 — WarrantyService: warranty_claim details", () => {
  it("a REPLACE keeps the claimed unit, the replacement handed over, the notes and the sale line", () => {
    const p = addProduct("Phone", 2, 100, 12);
    const sold = addUnit(p, "SN-A");
    const replacement = addUnit(p, "SN-B");
    const line = sell(p, { unitId: sold });

    const r = claim({
      sale_item_id: line,
      unit_id: sold,
      action: "REPLACE",
      replacement_unit_id: replacement,
      notes: "dead on arrival, swapped at the counter",
    });
    expect(r.success).toBe(true);
    const [cost] = costRows(r.data.claim.id);

    // FR-008 — today's money: −replacement cost, no amount.
    expect(cost).toMatchObject({ amount_usd: 0, profit_usd: -100 });
    // FR-003 — the claim's customer (resolved from the client id).
    expect(cost.client_name).toBe("Rami Haddad");
    expect(cost.client_phone).toBe("71123456");

    expectDetails(cost, {
      v: 1,
      kind: "warranty_claim",
      claimId: r.data.claim.id,
      action: "REPLACE",
      unitId: sold,
      replacementUnitId: replacement,
      notes: "dead on arrival, swapped at the counter",
      saleItemId: line,
    });
  });

  it("a REFUND keeps the claim on the REFUND row as well as on its cost row", () => {
    const p = addProduct("Buds", 3, 6);
    const line = sell(p);

    const r = claim({
      sale_item_id: line,
      action: "REFUND",
      notes: "left earbud silent",
    });
    expect(r.success).toBe(true);
    const refund = txn(r.data.refundTransactionId!);
    const [cost] = costRows(r.data.claim.id);

    // FR-008 — today's money.
    expect(refund).toMatchObject({ type: "REFUND", amount_usd: -20 });
    expect(cost).toMatchObject({ amount_usd: 0, profit_usd: -6 });

    const expected = {
      v: 1,
      kind: "warranty_claim",
      claimId: r.data.claim.id,
      action: "REFUND",
      notes: "left earbud silent",
      saleItemId: line,
    };
    expectDetails(refund, expected);
    expectDetails(cost, expected);
  });

  it("an expired warranty honoured by an admin keeps the override reason; the repair cost row carries the claim", () => {
    const p = addProduct("Speaker", 3, 6, 1);
    const part = addProduct("Driver", 3, 4);
    const line = sell(p, { day: "2026-01-01" }); // warranty ended 2026-02-01

    const r = claim({
      sale_item_id: line,
      action: "REPAIR",
      override_reason: "loyal customer",
    });
    expect(r.success).toBe(true);
    // Delivering the free repair books its cost, once.
    expect(
      new MaintenanceService().saveJob(
        {
          id: r.data.repairJobId!,
          device_name: "Speaker",
          status: "Delivered",
          parts: [{ product_id: part, quantity: 1 }],
        },
        1,
      ).success,
    ).toBe(true);
    const [cost] = costRows(r.data.claim.id);

    expect(cost).toMatchObject({ amount_usd: 0, profit_usd: -4 });
    expectDetails(cost, {
      v: 1,
      kind: "warranty_claim",
      claimId: r.data.claim.id,
      action: "REPAIR",
      overrideReason: "loyal customer",
      saleItemId: line,
    });

    // Voiding the claim: the reversal row says which claim it reverses.
    expect(
      getWarrantyService().voidClaim({ claim_id: r.data.claim.id }, ADMIN),
    ).toMatchObject({ success: true });
    const reversal = costRows(r.data.claim.id)[1];
    expect(reversal).toMatchObject({ profit_usd: 4 });
    expect(details(reversal)).toMatchObject({
      kind: "warranty_claim",
      claimId: r.data.claim.id,
      action: "REPAIR",
    });
  });
});
