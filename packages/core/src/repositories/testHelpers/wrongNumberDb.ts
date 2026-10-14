/**
 * LIRA-312 — shared fixture for the WrongNumberService tests: a full
 * database (create_db.sql + migrations) with an iPick Alfa 7.58 card
 * (770,000 LBP, $7.58), an Alfa shop line 03222875 whose credits ARE the
 * Alfa drawer ($20), and an 800,000 LBP iPick card sale.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetCarrierLineRepository } from "../CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository";
import { resetExpenseRepository } from "../ExpenseRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetServiceProviderRepository } from "../ServiceProviderRepository";
import { resetWrongNumberRepository } from "../WrongNumberRepository";
import { resetCarrierLineService } from "../../services/CarrierLineService";
import { resetWrongNumberService } from "../../services/WrongNumberService";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");

export const USER_ID = 1;

export function buildDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  return db;
}

export function resetAll(): void {
  resetTransactionRepository();
  resetCarrierLineRepository();
  resetCarrierLineMovementRepository();
  resetExpenseRepository();
  resetPaymentMethodRepository();
  resetServiceProviderRepository();
  resetWrongNumberRepository();
  resetCarrierLineService();
  resetWrongNumberService();
}

export interface WrongNumberFixture {
  alfaCardId: number;
  mtcCardId: number;
  billItemId: number;
  katshAlfaCardId: number;
  shopLineId: number;
  mtcShopLineId: number;
  inactiveAlfaLineId: number;
  saleId: number;
  katshSaleId: number;
}

function insertId(db: Database.Database, sql: string, ...args: unknown[]): number {
  return Number(
    db
      /* tenant-exempt: test-only helper — single-tenant in-memory test database */
      .prepare(sql)
      .run(...args).lastInsertRowid,
  );
}

export function seed(db: Database.Database): WrongNumberFixture {
  const item = (provider: string, category: string, label: string, cost: number, credits: number | null) =>
    insertId(
      db,
      `INSERT INTO mobile_service_items (tenant_id, provider, category, subcategory, label, cost_lbp, sell_lbp, credits, validity_days)
       VALUES (1, ?, ?, 'Prepaid', ?, ?, ?, ?, 30)`,
      provider,
      category,
      label,
      cost,
      cost + 30000,
      credits,
    );
  const alfaCardId = item("iPick", "alfa", "Alfa 7.58", 770000, 7.58);
  const mtcCardId = item("iPick", "mtc", "MTC 4.5", 466000, 4.5);
  const billItemId = item("iPick", "Internet", "IDM 10GB", 500000, null);
  const katshAlfaCardId = item("Katsh", "alfa", "Alfa 7.58", 760000, 7.58);

  const line = (carrier: string, phone: string, credits: number, active: number, primary: number) =>
    insertId(
      db,
      `INSERT INTO carrier_lines (tenant_id, carrier, phone_number, credits, validity_expires_at, is_active, is_primary)
       VALUES (1, ?, ?, ?, '2099-01-01', ?, ?)`,
      carrier,
      phone,
      credits,
      active,
      primary,
    );
  const shopLineId = line("alfa", "03222875", 20, 1, 1);
  const mtcShopLineId = line("mtc", "71000111", 10, 1, 1);
  const inactiveAlfaLineId = line("alfa", "03999888", 0, 0, 0);

  for (const [drawer, currency, balance] of [
    ["Alfa", "USD", 20],
    ["MTC", "USD", 10],
    ["iPick", "LBP", 5_000_000],
    ["Katsh", "LBP", 5_000_000],
  ] as const) {
    db.prepare(
      `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
       VALUES (1, ?, ?, ?)
       ON CONFLICT DO UPDATE SET balance = excluded.balance`,
    ).run(drawer, currency, balance);
  }

  const sale = (provider: string) =>
    insertId(
      db,
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_lbp, summary, metadata_json)
       VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', 1, 1, 0, 800000, 30000, 'iPick sale', ?)`,
      JSON.stringify({ provider, service_type: "SEND", cost: 770000, price: 800000 }),
    );
  const saleId = sale("iPick");
  const katshSaleId = sale("Katsh");

  return {
    alfaCardId,
    mtcCardId,
    billItemId,
    katshAlfaCardId,
    shopLineId,
    mtcShopLineId,
    inactiveAlfaLineId,
    saleId,
    katshSaleId,
  };
}

export function drawer(db: Database.Database, name: string, currency: string): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE tenant_id = 1 AND drawer_name = ? AND currency_code = ?`,
    )
    .get(name, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

export function lineCredits(db: Database.Database, id: number): number {
  return (
    db
      /* tenant-exempt: test-only helper — single-tenant in-memory test database */
      .prepare(`SELECT credits FROM carrier_lines WHERE id = ?`)
      .get(id) as { credits: number }
  ).credits;
}

/** Σ profit_lbp of ACTIVE rows (the Profits page's LBP stamp). */
export function activeProfitLbp(db: Database.Database): number {
  return (
    db
      /* tenant-exempt: test-only helper — single-tenant in-memory test database */
      .prepare(`SELECT COALESCE(SUM(profit_lbp), 0) AS p FROM transactions WHERE status = 'ACTIVE'`)
      .get() as { p: number }
  ).p;
}
