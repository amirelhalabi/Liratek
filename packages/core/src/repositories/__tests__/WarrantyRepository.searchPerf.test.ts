/**
 * LIRA-296 (T015a, SC-001) — the warranty search stays fast on two years of
 * sales: ~50,000 warranty lines across ~5,000 clients. Searching by phone,
 * by receipt number and by product must each answer in under 1 second.
 *
 * The bound is the spec's, never loosened: if this fails, add an index.
 */
import type Database from "better-sqlite3";
import { WarrantyRepository } from "../WarrantyRepository";
import {
  installWarrantyTestDb,
  uninstallWarrantyTestDb,
} from "../testHelpers/warrantyDb";

const CLIENTS = 5_000;
const SALES = 25_000;
const LINES_PER_SALE = 2; // 50,000 warranty lines
const PRODUCTS = 400;

let db: Database.Database;
const repo = new WarrantyRepository();

beforeAll(() => {
  db = installWarrantyTestDb();
  const seed = db.transaction(() => {
    const client = db.prepare(
      `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (?, 1, ?, ?)`,
    );
    for (let i = 1; i <= CLIENTS; i++) {
      client.run(i, `Client ${i}`, `71 ${String(100000 + i).slice(0, 3)} ${String(100000 + i).slice(3)}`);
    }
    const product = db.prepare(
      `INSERT INTO products (id, tenant_id, barcode, name, item_type, category) VALUES (?, 1, ?, ?, 'Product', 'Accessories')`,
    );
    for (let p = 1; p <= PRODUCTS; p++) {
      product.run(p, `BC-${p}`, `Product ${p}`);
    }
    const sale = db.prepare(
      `INSERT INTO sales (id, tenant_id, client_id, total_amount_usd, final_amount_usd, status, created_at)
       VALUES (?, 1, ?, 10, 10, 'completed', ?)`,
    );
    const txn = db.prepare(
      `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id, amount_usd, client_id, created_at)
       VALUES (1, 'SALE', 'sales', ?, 1, 10, ?, ?)`,
    );
    const line = db.prepare(
      `INSERT INTO sale_items (tenant_id, sale_id, product_id, quantity, sold_price_usd, warranty_until, warranty_months)
       VALUES (1, ?, ?, 1, 10, ?, 12)`,
    );
    const start = Date.UTC(2024, 9, 10);
    for (let s = 1; s <= SALES; s++) {
      const at = new Date(start + Math.floor((s / SALES) * 730) * 86_400_000);
      const createdAt = at.toISOString().slice(0, 19).replace("T", " ");
      const until = new Date(at.getTime() + 365 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const clientId = (s % CLIENTS) + 1;
      sale.run(s, clientId, createdAt);
      txn.run(s, clientId, createdAt);
      for (let k = 0; k < LINES_PER_SALE; k++) {
        line.run(s, ((s * LINES_PER_SALE + k) % PRODUCTS) + 1, until);
      }
    }
  });
  seed();
  db.exec("ANALYZE");
}, 120_000);

afterAll(() => uninstallWarrantyTestDb(db));

function timed<T>(fn: () => T): { ms: number; result: T } {
  const t0 = performance.now();
  const result = fn();
  return { ms: performance.now() - t0, result };
}

it("seeded 50,000 warranty lines", () => {
  const n = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM sale_items WHERE warranty_until IS NOT NULL`)
      .get() as { n: number }
  ).n;
  expect(n).toBe(SALES * LINES_PER_SALE);
});

it.each([
  ["phone", "71100123"],
  ["receipt", "RCP-24000"],
  ["product", "Product 37"],
  ["customer name", "Client 4321"],
])("search by %s answers in under 1 second", (_label, q) => {
  const { ms, result } = timed(() => repo.search({ q, limit: 50 }));
  expect(result.length).toBeGreaterThan(0);
  expect(ms).toBeLessThan(1000);
});
