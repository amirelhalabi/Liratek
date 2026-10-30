/**
 * LIRA-364 — the monthly KPI snapshot's capture. Owner decisions 2026-10-30:
 * month-end balances only, USD and LBP never combined, each counterparty
 * judged per currency, automatic once per Beirut month, starting empty.
 *
 * RULE 17 — written before KpiSnapshotService / KpiSnapshotRepository existed.
 */
import type Database from "better-sqlite3";
import {
  getKpiSnapshotService,
  resetKpiSnapshotService,
} from "../KpiSnapshotService.js";
import { resetKpiSnapshotRepository } from "../../repositories/KpiSnapshotRepository.js";
import {
  getProductSupplierRepository,
  resetProductSupplierRepository,
} from "../../repositories/ProductSupplierRepository.js";
import {
  getSupplierRepository,
  resetSupplierRepository,
} from "../../repositories/SupplierRepository.js";
import {
  getProductRepository,
  resetProductRepository,
} from "../../repositories/ProductRepository.js";
import { resetDebtRepository } from "../../repositories/DebtRepository.js";
import { resetPartnerRepository } from "../../repositories/PartnerRepository.js";
import { resetCarrierLineRepository } from "../../repositories/CarrierLineRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";
import {
  addClient,
  addProduct,
  installWarrantyTestDb,
  uninstallWarrantyTestDb,
} from "../../repositories/testHelpers/warrantyDb.js";

/** 01:00 on 1 November 2026, Beirut (UTC+2 after DST ends on 25 Oct). */
const NOV_1_BEIRUT = new Date("2026-10-31T23:00:00Z");

function resetAll(): void {
  resetKpiSnapshotService();
  resetKpiSnapshotRepository();
  resetProductSupplierRepository();
  resetSupplierRepository();
  resetProductRepository();
  resetDebtRepository();
  resetPartnerRepository();
  resetCarrierLineRepository();
}

/** Super admin's per-shop switch (Plan window → Features). Off by default. */
function enableFeature(db: Database.Database, on: boolean): void {
  db.prepare(
    `UPDATE tenant_subscriptions SET enabled_features = ? WHERE tenant_id = 1`,
  ).run(on ? JSON.stringify(["kpi_snapshots"]) : null);
}

function setMarker(db: Database.Database, month: string): void {
  db.prepare(
    `INSERT INTO system_settings (tenant_id, key_name, value) VALUES (1, 'kpi_snapshots_since', ?)
     ON CONFLICT (tenant_id, key_name) DO UPDATE SET value = excluded.value`,
  ).run(month);
}

function snapshots(db: Database.Database) {
  return db
    .prepare(`SELECT * FROM kpi_snapshots WHERE tenant_id = 1 ORDER BY month`)
    .all() as Array<{ id: number; month: string; is_late: number }>;
}

function value(db: Database.Database, key: string) {
  return db
    .prepare(
      `SELECT amount_usd AS usd, amount_lbp AS lbp FROM kpi_snapshot_values WHERE kpi_key = ? AND tenant_id = 1`,
    )
    .get(key) as { usd: number; lbp: number } | undefined;
}

function debt(db: Database.Database, client: number, usd: number, lbp: number) {
  db.prepare(
    `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp)
     VALUES (1, ?, 'Sale Debt', ?, ?)`,
  ).run(client, usd, lbp);
}

function supplierLedger(
  db: Database.Database,
  supplierId: number,
  usd: number,
  refunded = 0,
) {
  db.prepare(
    `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp, created_by, tenant_id, is_refunded)
     VALUES (?, 'ADJUSTMENT', ?, 0, 1, 1, ?)`,
  ).run(supplierId, usd, refunded);
}

describe("KpiSnapshotService.captureDue (LIRA-364)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = installWarrantyTestDb();
    initFixedTenantContext(1);
    resetAll();
    enableFeature(db, true);
  });

  afterEach(() => {
    uninstallWarrantyTestDb(db);
    resetAll();
    resetTenantContext();
  });

  it("switched off for the shop (the default): saves nothing and sets no marker", () => {
    enableFeature(db, false);
    setMarker(db, "2026-10");
    const result = getKpiSnapshotService().captureDue(NOV_1_BEIRUT);
    expect(result).toEqual({ captured: null, reason: "disabled" });
    expect(snapshots(db)).toHaveLength(0);
  });

  it("switched off: the first run does not start the clock either", () => {
    enableFeature(db, false);
    getKpiSnapshotService().captureDue(new Date("2026-11-15T10:00:00Z"));
    const marker = db
      .prepare(
        `SELECT value FROM system_settings WHERE key_name = 'kpi_snapshots_since' AND tenant_id = 1`,
      )
      .get();
    expect(marker).toBeUndefined();
  });

  it("the first run only sets the start marker — a mid-month deploy saves nothing", () => {
    const result = getKpiSnapshotService().captureDue(
      new Date("2026-11-15T10:00:00Z"),
    );
    expect(result.reason).toBe("marker_set");
    expect(snapshots(db)).toHaveLength(0);
    const marker = db
      .prepare(
        `SELECT value FROM system_settings WHERE key_name = 'kpi_snapshots_since' AND tenant_id = 1`,
      )
      .get() as { value: string };
    expect(marker.value).toBe("2026-11");
  });

  it("does not save a month before the marker", () => {
    setMarker(db, "2026-11");
    const result = getKpiSnapshotService().captureDue(NOV_1_BEIRUT);
    expect(result.reason).toBe("not_due");
    expect(snapshots(db)).toHaveLength(0);
  });

  it("saves the month just ended once, at 01:00 Beirut on the 1st", () => {
    setMarker(db, "2026-10");
    const service = getKpiSnapshotService();

    expect(service.captureDue(NOV_1_BEIRUT)).toEqual({
      captured: "2026-10",
      reason: "captured",
    });
    expect(service.captureDue(NOV_1_BEIRUT).reason).toBe("exists");
    expect(snapshots(db).map((s) => s.month)).toEqual(["2026-10"]);
    expect(snapshots(db)[0].is_late).toBe(0);
  });

  it("customers: each one judged per currency, never netted across people or currencies", () => {
    setMarker(db, "2026-10");
    addClient(db, { id: 11, name: "Ali" });
    addClient(db, { id: 12, name: "Rana" });
    addClient(db, { id: 13, name: "Mixed" });
    debt(db, 11, 120, 900000);
    debt(db, 12, -30, 0);
    debt(db, 13, 50, 0);
    debt(db, 13, 0, -450000);

    getKpiSnapshotService().captureDue(NOV_1_BEIRUT);

    expect(value(db, "customers_owe_shop")).toEqual({ usd: 170, lbp: 900000 });
    expect(value(db, "shop_owes_customers")).toEqual({ usd: 30, lbp: 450000 });
  });

  it("suppliers: positive = shop owes; an account counts once; refunded rows excluded", () => {
    setMarker(db, "2026-10");
    const psRepo = getProductSupplierRepository();
    const acme = psRepo.create("Acme");
    const owesUs = psRepo.create("Owes Us");
    const parent = psRepo.create("Account Parent");
    const child = psRepo.create("Account Child");
    db.prepare(`UPDATE suppliers SET account_supplier_id = ? WHERE id = ?`).run(
      parent.supplier_id,
      child.supplier_id,
    );
    getSupplierRepository().recordDebt({
      supplier_id: acme.supplier_id,
      amount_usd: 200,
      amount_lbp: 0,
      created_by: 1,
    });
    supplierLedger(db, acme.supplier_id, 999, 1); // refunded: ignored
    supplierLedger(db, owesUs.supplier_id, -40);
    supplierLedger(db, parent.supplier_id, 10);
    supplierLedger(db, child.supplier_id, -25); // account nets to −15

    getKpiSnapshotService().captureDue(NOV_1_BEIRUT);

    expect(value(db, "shop_owes_suppliers")).toEqual({ usd: 200, lbp: 0 });
    expect(value(db, "suppliers_owe_shop")).toEqual({ usd: 55, lbp: 0 });
  });

  it("partners: DEBIT − CREDIT positive = partner owes shop; USDT ignored", () => {
    setMarker(db, "2026-10");
    db.exec(`
      INSERT INTO partners (id, tenant_id, name) VALUES (21, 1, 'Rawad'), (22, 1, 'Sami');
      INSERT INTO partner_ledger (tenant_id, partner_id, transaction_type, amount, currency, direction)
        VALUES (1, 21, 'MANUAL', 100, 'USD', 'DEBIT'),
               (1, 21, 'MANUAL', 50, 'USDT', 'DEBIT'),
               (1, 22, 'MANUAL', 500000, 'LBP', 'CREDIT');
    `);

    getKpiSnapshotService().captureDue(NOV_1_BEIRUT);

    expect(value(db, "partners_owe_shop")).toEqual({ usd: 100, lbp: 0 });
    expect(value(db, "shop_owes_partners")).toEqual({ usd: 0, lbp: 500000 });
  });

  it("stock value is the Dashboard's Stock Budget; carrier credits are MTC + Alfa active lines", () => {
    setMarker(db, "2026-10");
    addProduct(db, { id: 101, name: "Cable", cost: 4, stock: 10 });
    db.exec(`
      INSERT INTO carrier_lines (tenant_id, carrier, phone_number, credits, is_active)
        VALUES (1, 'mtc', '70000001', 12.5, 1),
               (1, 'alfa', '71000001', 7.5, 1),
               (1, 'alfa', '71000002', 99, 0);
    `);

    getKpiSnapshotService().captureDue(NOV_1_BEIRUT);

    expect(value(db, "stock_value")).toEqual({
      usd: getProductRepository().getStockStats().stock_budget_usd,
      lbp: 0,
    });
    expect(value(db, "stock_value")!.usd).toBeGreaterThanOrEqual(40);
    expect(value(db, "carrier_credits")).toEqual({ usd: 20, lbp: 0 });
  });

  it("saves all eight KPIs and the day's USD/LBP rate", () => {
    setMarker(db, "2026-10");
    getKpiSnapshotService().captureDue(NOV_1_BEIRUT);

    const keys = (
      db
        .prepare(`SELECT kpi_key FROM kpi_snapshot_values WHERE tenant_id = 1`)
        .all() as { kpi_key: string }[]
    ).map((r) => r.kpi_key);
    expect(keys.sort()).toEqual(
      [
        "carrier_credits",
        "customers_owe_shop",
        "partners_owe_shop",
        "shop_owes_customers",
        "shop_owes_partners",
        "shop_owes_suppliers",
        "stock_value",
        "suppliers_owe_shop",
      ].sort(),
    );
    const snap = db
      .prepare(
        `SELECT usd_lbp_buy_rate AS buy, usd_lbp_sell_rate AS sell FROM kpi_snapshots WHERE tenant_id = 1`,
      )
      .get() as { buy: number; sell: number };
    expect(snap).toEqual({ buy: 89000, sell: 90000 });
  });

  it("a transaction already saved in the new month marks the snapshot late", () => {
    setMarker(db, "2026-10");
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id, created_at)
       VALUES (1, 'SALE', 'sales', 1, 1, '2026-10-31 22:30:00')`,
    ).run();

    getKpiSnapshotService().captureDue(new Date("2026-11-02T08:00:00Z"));

    expect(snapshots(db)[0]).toMatchObject({ month: "2026-10", is_late: 1 });
  });

  it("listSnapshots returns months newest first with their values", () => {
    setMarker(db, "2026-09");
    const service = getKpiSnapshotService();
    service.captureDue(new Date("2026-09-30T22:00:00Z")); // 1 Oct 01:00 Beirut (UTC+3)
    service.captureDue(NOV_1_BEIRUT);

    const list = service.listSnapshots();
    expect(list.map((s) => s.month)).toEqual(["2026-10", "2026-09"]);
    expect(list[0].values.stock_value).toBeDefined();
    expect(list[0].is_late).toBe(false);
  });

  it("getProgress: switched on → enabled, with the saved months", () => {
    setMarker(db, "2026-10");
    getKpiSnapshotService().captureDue(NOV_1_BEIRUT);
    const progress = getKpiSnapshotService().getProgress();
    expect(progress.enabled).toBe(true);
    expect(progress.snapshots.map((s) => s.month)).toEqual(["2026-10"]);
  });

  it("getProgress: switched off → not enabled and no months, even if some were saved", () => {
    setMarker(db, "2026-10");
    getKpiSnapshotService().captureDue(NOV_1_BEIRUT);
    enableFeature(db, false);
    expect(getKpiSnapshotService().getProgress()).toEqual({
      enabled: false,
      snapshots: [],
    });
  });
});
