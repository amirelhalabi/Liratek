/**
 * LIRA-296 (T043, T044, user story 5) — a repair carries its own warranty.
 *   - `warranty_months` is saved with the job (shared schema; rule 23: the
 *     schema keeps the key, so neither transport strips it);
 *   - the end day is stamped ONCE, when the job reaches Delivered_Paid, from
 *     the shop's own day (`client_day`, rule 27), and rides on the job's
 *     MAINTENANCE transaction so the receipt can print it;
 *   - the warranty search finds it (source REPAIR) and a claim on it can
 *     only be another repair.
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
import { resetTransactionRepository } from "../../repositories/TransactionRepository";
import { resetStockBatchRepository } from "../../repositories/StockBatchRepository";
import { resetWarrantyRepository } from "../../repositories/WarrantyRepository";
import { saveMaintenanceJobSchema } from "../../validators/maintenance";
import { MaintenanceService } from "../MaintenanceService";
import { getWarrantyService, resetWarrantyService } from "../WarrantyService";

const REPO_ROOT = path.join(__dirname, "../../../../..");
let db: Database.Database;
let svc: MaintenanceService;

beforeEach(() => {
  resetTransactionRepository();
  resetStockBatchRepository();
  resetWarrantyRepository();
  resetWarrantyService();
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
  svc = new MaintenanceService();
});
afterEach(() => {
  resetTenantContext();
  db.close();
});

const job = (id: number) =>
  db
    .prepare(
      `SELECT warranty_months, warranty_until FROM maintenance WHERE id = ?`,
    )
    .get(id) as {
    warranty_months: number | null;
    warranty_until: string | null;
  };

function createJob(months: number | null = 3): number {
  const r = svc.saveJob(
    saveMaintenanceJobSchema.parse({
      device_name: "iPhone 12 screen",
      client_id: 7,
      client_name: "Rami Haddad",
      price_usd: 50,
      final_amount_usd: 50,
      status: "Received",
      warranty_months: months,
    }) as never,
    1,
  );
  expect(r.success).toBe(true);
  return r.id!;
}

function deliverPaid(
  id: number,
  day = "2026-01-31",
  months: number | null = 3,
) {
  return svc.saveJob(
    saveMaintenanceJobSchema.parse({
      id,
      device_name: "iPhone 12 screen",
      client_id: 7,
      client_name: "Rami Haddad",
      price_usd: 50,
      final_amount_usd: 50,
      status: "Delivered_Paid",
      warranty_months: months,
      client_day: day,
      payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
    }) as never,
    1,
  );
}

describe("repair warranty", () => {
  it("the shared schema keeps warranty_months and client_day", () => {
    const parsed = saveMaintenanceJobSchema.parse({
      device_name: "x",
      price_usd: 1,
      warranty_months: 6,
      client_day: "2026-10-10",
    });
    expect(parsed).toMatchObject({
      warranty_months: 6,
      client_day: "2026-10-10",
    });
    expect(
      saveMaintenanceJobSchema.safeParse({
        device_name: "x",
        price_usd: 1,
        warranty_months: 61,
      }).success,
    ).toBe(false);
  });

  it("is saved with the job; not stamped before Delivered_Paid", () => {
    const id = createJob(3);
    expect(job(id)).toEqual({ warranty_months: 3, warranty_until: null });
  });

  it("is stamped from the shop's day at Delivered_Paid, once, and rides on the transaction", () => {
    const id = createJob(3);
    expect(deliverPaid(id).success).toBe(true);
    expect(job(id)).toEqual({
      warranty_months: 3,
      warranty_until: "2026-04-30",
    });
    const meta = JSON.parse(
      (
        db
          .prepare(
            `SELECT metadata_json FROM transactions WHERE type = 'MAINTENANCE' AND source_id = ?`,
          )
          .get(id) as { metadata_json: string }
      ).metadata_json,
    );
    expect(meta).toMatchObject({ warranty_until: "2026-04-30" });
    // A later resave never moves it.
    svc.saveJob(
      saveMaintenanceJobSchema.parse({
        id,
        device_name: "iPhone 12 screen",
        price_usd: 50,
        status: "Delivered_Paid",
        warranty_months: 3,
        client_day: "2026-03-01",
      }) as never,
      1,
    );
    expect(job(id).warranty_until).toBe("2026-04-30");
  });

  it("no warranty months: nothing stamped", () => {
    const id = createJob(null);
    deliverPaid(id, "2026-01-31", null);
    expect(job(id).warranty_until).toBeNull();
  });

  it("the warranty search finds the repair (source REPAIR)", () => {
    const id = createJob(3);
    deliverPaid(id);
    const rows = getWarrantyService().search({
      client_day: "2026-02-15",
      q: "Rami",
    });
    expect(rows).toEqual([
      expect.objectContaining({
        source: "REPAIR",
        maintenanceId: id,
        saleId: null,
        saleItemId: null,
        warrantyUntil: "2026-04-30",
        state: "COVERED",
        product: expect.objectContaining({ name: "iPhone 12 screen" }),
        customer: expect.objectContaining({
          name: "Rami Haddad",
          phone: "71123456",
        }),
      }),
    ]);
  });

  it("a claim on a repair's warranty opens a free repair; REPLACE is refused", () => {
    const id = createJob(3);
    deliverPaid(id);
    const admin = { userId: 1, role: "admin" };
    expect(
      getWarrantyService().createClaim(
        { maintenance_id: id, action: "REPLACE", client_day: "2026-02-15" },
        admin,
      ),
    ).toMatchObject({ success: false, code: "FORBIDDEN_ACTION" });
    const r = getWarrantyService().createClaim(
      { maintenance_id: id, action: "REPAIR", client_day: "2026-02-15" },
      admin,
    );
    expect(r).toMatchObject({ success: true });
    const jobId = (r as { data: { repairJobId: number } }).data.repairJobId;
    expect(
      db
        .prepare(
          `SELECT client_id, final_amount_usd FROM maintenance WHERE id = ?`,
        )
        .get(jobId),
    ).toEqual({ client_id: 7, final_amount_usd: 0 });
  });
});
