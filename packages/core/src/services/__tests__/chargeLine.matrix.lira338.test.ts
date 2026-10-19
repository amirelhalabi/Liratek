/**
 * LIRA-338 — every way a card can be charged to one of the shop's own lines
 * (rule 28d: a money form gets a variant test, not just a happy path):
 *
 *   provider (iPick, Katsh, Whish App) × carrier (MTC, Alfa)
 *   × line (main shop line, another shop line, a line held for sale)
 *
 * Each case checks what moved (provider LBP balance, carrier drawer, the
 * picked line, the line's cost/price) and that ONE Void puts every balance,
 * line and product back exactly (rule 20).
 *
 * NOT proven failing-first (rule 17): written after LIRA-338's code, as the
 * owner asked for the missing cases on 2026-10-19.
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
import { resetTransactionRepository, getTransactionRepository } from "../../repositories/TransactionRepository";
import { resetStockBatchRepository, getStockBatchRepository } from "../../repositories/StockBatchRepository";
import { resetResaleLineRepository } from "../../repositories/ResaleLineRepository";
import { resetCarrierLineRepository } from "../../repositories/CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../../repositories/CarrierLineMovementRepository";
import { resetExpenseRepository } from "../../repositories/ExpenseRepository";
import { resetPaymentMethodRepository } from "../../repositories/PaymentMethodRepository";
import { resetServiceProviderRepository } from "../../repositories/ServiceProviderRepository";
import { resetMobileServiceItemRepository } from "../../repositories/MobileServiceItemRepository";
import { FinancialServiceRepository } from "../../repositories/FinancialServiceRepository";
import { resetCarrierLineService } from "../CarrierLineService";
import { ResaleLineService, resetResaleLineService } from "../ResaleLineService";
import { snapshotLedgers } from "../../repositories/testHelpers/postingAssert";
import { localDay } from "../../utils/localDate";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");
const USER_ID = 1;
const RATE = 89_000;
const TODAY = localDay();
const COST_LBP = 765_007;
const CREDITS = 7.58;
const DAYS = 30;

const PROVIDER_DRAWER = { iPick: "iPick", Katsh: "Katsh", WHISH_APP: "Whish_App" } as const;
const CARRIER_DRAWER = { mtc: "MTC", alfa: "Alfa" } as const;

type Provider = keyof typeof PROVIDER_DRAWER;
type Carrier = keyof typeof CARRIER_DRAWER;
type Target = "main" | "other" | "sale";

const CASES: Array<[Provider, Carrier, Target]> = [];
for (const p of ["iPick", "Katsh", "WHISH_APP"] as Provider[]) {
  for (const c of ["mtc", "alfa"] as Carrier[]) {
    for (const t of ["main", "other", "sale"] as Target[]) CASES.push([p, c, t]);
  }
}

function inDays(n: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function buildDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  return db;
}

function resetAll(): void {
  resetTransactionRepository();
  resetStockBatchRepository();
  resetResaleLineRepository();
  resetCarrierLineRepository();
  resetCarrierLineMovementRepository();
  resetExpenseRepository();
  resetPaymentMethodRepository();
  resetServiceProviderRepository();
  resetMobileServiceItemRepository();
  resetCarrierLineService();
  resetResaleLineService();
}

interface Fixture {
  mainId: number;
  otherId: number;
  productId: number;
  batchId: number;
  cardId: number;
}

function seed(db: Database.Database, provider: Provider, carrier: Carrier): Fixture {
  const line = (phone: string, primary: number) =>
    Number(
      db
        .prepare(
          `INSERT INTO carrier_lines (tenant_id, carrier, phone_number, credits, validity_expires_at, is_active, is_primary)
           VALUES (1, ?, ?, 20, ?, 1, ?)`,
        )
        .run(carrier, phone, inDays(60), primary).lastInsertRowid,
    );
  const mainId = line("03222875", 1);
  const otherId = line("03444111", 0);
  db.prepare(
    `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
     VALUES (1, ?, 'USD', 40)
     ON CONFLICT DO UPDATE SET balance = 40`,
  ).run(CARRIER_DRAWER[carrier]);
  const productId = Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, barcode, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity, min_stock_level)
         VALUES (1, '70444202', 'Line for sale', 'Product', 'Phone Lines', 15, 25, 1, 0)`,
      )
      .run().lastInsertRowid,
  );
  const batchId = getStockBatchRepository().createBatch({
    product_id: productId,
    supplier_id: null,
    quantity: 1,
    unit_cost_usd: 15,
    books_debt: false,
    created_by: USER_ID,
  });
  db.prepare(
    `INSERT INTO resale_lines (tenant_id, product_id, carrier, credits, validity_expires_at, created_at, updated_at)
     VALUES (1, ?, ?, 0, ?, '2026-10-01', '2026-10-01')`,
  ).run(productId, carrier, inDays(5));
  const cardId = Number(
    db
      .prepare(
        `INSERT INTO mobile_service_items (tenant_id, provider, category, subcategory, label, cost_lbp, sell_lbp, credits, validity_days)
         VALUES (1, ?, ?, 'Prepaid', '7.58', ?, 800000, ?, ?)`,
      )
      .run(provider, carrier, COST_LBP, CREDITS, DAYS).lastInsertRowid,
  );
  return { mainId, otherId, productId, batchId, cardId };
}

function state(db: Database.Database, f: Fixture) {
  const credits = (id: number) =>
    (db.prepare(`SELECT credits, validity_expires_at AS exp FROM carrier_lines WHERE id = ?`).get(id) as {
      credits: number;
      exp: string;
    });
  return {
    ledgers: snapshotLedgers(db),
    main: credits(f.mainId),
    other: credits(f.otherId),
    product: db
      .prepare(`SELECT cost_price_usd AS cost, selling_price_usd AS price FROM products WHERE id = ?`)
      .get(f.productId),
    batch: (db.prepare(`SELECT unit_cost_usd AS c FROM product_stock_batches WHERE id = ?`).get(f.batchId) as { c: number }).c,
    sale: db
      .prepare(`SELECT credits, validity_expires_at AS exp FROM resale_lines WHERE product_id = ?`)
      .get(f.productId),
  };
}

describe("LIRA-338 — charge a card to a line: every provider × carrier × line", () => {
  let db: Database.Database;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it.each(CASES)("%s %s card → %s line, then Void", (provider, carrier, target) => {
    const f = seed(db, provider, carrier);
    const before = state(db, f);
    const providerKey = `${PROVIDER_DRAWER[provider]}|LBP`;
    const carrierKey = `${CARRIER_DRAWER[carrier]}|USD`;

    let transactionId: number;
    if (target === "sale") {
      const r = new ResaleLineService().recharge(
        { product_id: f.productId, source: "CARD", mobile_service_item_id: f.cardId, exchange_rate: RATE, client_day: TODAY },
        USER_ID,
      );
      if (!r.success) throw new Error(r.error);
      transactionId = r.data.transaction_id;
      const costUsd = 8.6; // 765,007 / 89,000
      expect(r.data.cost_usd).toBe(costUsd);
      const after = state(db, f);
      expect((after.ledgers.drawers[providerKey] ?? 0) - (before.ledgers.drawers[providerKey] ?? 0)).toBe(-COST_LBP);
      expect(after.ledgers.drawers[carrierKey]).toBe(before.ledgers.drawers[carrierKey]);
      expect(after.product).toEqual({ cost: 15 + costUsd, price: 25 + costUsd });
      expect(after.batch).toBe(15 + costUsd);
      expect(after.sale).toEqual({ credits: CREDITS, exp: inDays(35) });
      expect(after.main).toEqual(before.main);
      expect(after.other).toEqual(before.other);
    } else {
      const lineId = target === "main" ? f.mainId : f.otherId;
      const res = new FinancialServiceRepository().selfChargeTelecomItem({
        mobileServiceItemId: f.cardId,
        carrierLineId: lineId,
        client_day: TODAY,
      });
      transactionId = res.transactionId;
      const after = state(db, f);
      expect((after.ledgers.drawers[providerKey] ?? 0) - (before.ledgers.drawers[providerKey] ?? 0)).toBe(-COST_LBP);
      expect(after.ledgers.drawers[carrierKey] - before.ledgers.drawers[carrierKey]).toBeCloseTo(CREDITS, 6);
      const picked = target === "main" ? after.main : after.other;
      const untouched = target === "main" ? after.other : after.main;
      expect(picked.credits).toBeCloseTo(27.58, 6);
      expect(picked.exp).toBe(inDays(90));
      expect(untouched).toEqual(target === "main" ? before.other : before.main);
      expect(after.product).toEqual(before.product);
      expect(after.sale).toEqual(before.sale);
    }

    getTransactionRepository().voidTransaction(transactionId, USER_ID);
    expect(state(db, f)).toEqual(before);
  });
});
