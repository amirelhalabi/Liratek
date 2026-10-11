/**
 * LIRA-306 T107 (FR-040) — a receipt printed offline reads `RCP-<offline
 * sale id>`. Once the sale is replayed, that number must still find the
 * sale on the web: the warranty search and the receipt reprint
 * (`SalesService.getSale`) resolve it through `offline_id_map` (never swept)
 * to the server sale. Another shop's alias never leaks; an alias of a row
 * that is not a sale is ignored; a normal receipt number is unchanged.
 */
import type Database from "better-sqlite3";
import { WarrantyRepository } from "../WarrantyRepository";
import { runWithTenant } from "../../db/tenantContext";
import { getSalesService, resetSalesService } from "../../services/SalesService";
import { resetSalesRepository } from "../SalesRepository";
import {
  installWarrantyTestDb,
  uninstallWarrantyTestDb,
  addClient,
  addProduct,
  addSale,
  addLine,
} from "../testHelpers/warrantyDb";

const OFFLINE_SALE = 1_017_000_000_005; // PC 1's sale #5, printed RCP-1017000000005
const OFFLINE_CLIENT = 1_017_000_000_006;

let db: Database.Database;
const repo = new WarrantyRepository();

beforeEach(() => {
  db = installWarrantyTestDb();
  resetSalesService();
  resetSalesRepository();
  addClient(db, { id: 1, name: "Rami Haddad", phone: "71 123 456" });
  addProduct(db, { id: 10, name: "Earbuds Pro", barcode: "EB-777" });
  addSale(db, { id: 101, clientId: 1, createdAt: "2026-10-10 20:50:00" });
  addLine(db, { id: 1010, saleId: 101, productId: 10, warrantyUntil: "2027-10-10", warrantyMonths: 12 });
  addSale(db, { id: 102, clientId: 1, createdAt: "2026-10-09 10:00:00" });
  addLine(db, { id: 1020, saleId: 102, productId: 10, warrantyUntil: "2027-10-09", warrantyMonths: 12 });
  db.exec(`
    INSERT OR IGNORE INTO tenants (id, name, slug, status) VALUES (2, 'Other', 'other', 'active');
    INSERT INTO offline_devices (id, tenant_id, device_no, name, key_id, key_hash, paired_by, paired_at, created_at, updated_at)
      VALUES (1, 1, 1, 'PC 1', 'aaaaaaaaaaa1', 'h', 1, '2026-10-01T00:00:00Z', '2026-10-01', '2026-10-01'),
             (2, 2, 1, 'Other PC', 'bbbbbbbbbbb2', 'h', 1, '2026-10-01T00:00:00Z', '2026-10-01', '2026-10-01');
    INSERT INTO offline_id_map (tenant_id, offline_id, device_id, table_name, server_id, event_id, link_kind, created_at, updated_at)
      VALUES (1, ${OFFLINE_SALE}, 1, 'sales', 101, 'e1', 'created', '2026-10-11', '2026-10-11'),
             (1, ${OFFLINE_CLIENT}, 1, 'clients', 102, 'e2', 'created', '2026-10-11', '2026-10-11'),
             (2, 1017000000009, 2, 'sales', 102, 'e3', 'created', '2026-10-11', '2026-10-11');
  `);
});

afterEach(() => uninstallWarrantyTestDb(db));

const saleIds = (rows: Array<{ sale_id: number }>) => [...new Set(rows.map((r) => r.sale_id))];

describe("RCP-<offline id> resolves to the server sale (FR-040)", () => {
  it("warranty search: RCP-<offline id> finds the replayed sale", () => {
    const rows = runWithTenant(1, () => repo.search({ q: `RCP-${OFFLINE_SALE}`, limit: 50 }));
    expect(saleIds(rows)).toEqual([101]);
  });

  it("warranty search: a normal receipt number is unchanged", () => {
    expect(saleIds(runWithTenant(1, () => repo.search({ q: "RCP-102", limit: 50 })))).toEqual([102]);
  });

  it("warranty search: another shop's alias and a non-sale alias resolve to nothing", () => {
    expect(runWithTenant(1, () => repo.search({ q: "RCP-1017000000009", limit: 50 }))).toEqual([]);
    expect(runWithTenant(1, () => repo.search({ q: `RCP-${OFFLINE_CLIENT}`, limit: 50 }))).toEqual([]);
  });

  it("reprint: getSale(<offline id>) returns the server sale", () => {
    const sale = runWithTenant(1, () => getSalesService().getSale(OFFLINE_SALE)) as { id: number } | null;
    expect(sale?.id).toBe(101);
  });
});

describe("reprint lines (FR-040)", () => {
  it("getSaleItems(<offline id>) returns the server sale's lines (the reprint loads them in parallel)", () => {
    const items = runWithTenant(1, () => getSalesService().getSaleItems(OFFLINE_SALE)) as Array<{ id: number }>;
    expect(items.map((i) => i.id)).toEqual([1010]);
  });
});
