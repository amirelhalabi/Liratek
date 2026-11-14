/**
 * Profits page → By module → MTC / Alfa → "Show transactions": the Detail
 * column names what was sold the way the Recharge page and the Transactions
 * summary already do (`rechargeDetailLabel`, rule 14), instead of a second
 * `${amount} credit` string that ignored the recharge type.
 *
 * Owner report 2026-11-14 (Cornertech): a "MTC Days 180 days" validity sale
 * showed as "Walk-in · 180 credit" under MTC recharges. `amount` is a DAY
 * COUNT for a DAYS recharge, a dollar face value for every other type.
 *
 * Rule 17: written first, seen failing on the unfixed code
 * ("180 credit" / "6 credit"), then fixed.
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
import { ProfitRepository } from "../../repositories/ProfitRepository";
import { ProfitService } from "../ProfitService";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const FROM = "2026-11-01";
const TO = "2026-11-30";
const IN_RANGE = "2026-11-13 14:45:38";
let db: Database.Database;
let profits: ProfitService;

beforeEach(() => {
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
  db.prepare(
    `INSERT OR IGNORE INTO users (id, username) VALUES (1, 'owner')`,
  ).run();
  profits = new ProfitService(new ProfitRepository());
});
afterEach(() => {
  resetTenantContext();
  db.close();
});

function insertRecharge(r: {
  type: string;
  amount: number;
  currency: "USD" | "LBP";
  price: number;
  cost: number;
  profit: number;
}): number {
  const id = Number(
    db
      .prepare(
        `INSERT INTO recharges (tenant_id, carrier, recharge_type, amount, cost, price, currency_code, created_at)
         VALUES (1, 'MTC', ?, ?, ?, ?, ?, ?)`,
      )
      .run(r.type, r.amount, r.cost, r.price, r.currency, IN_RANGE)
      .lastInsertRowid,
  );
  const usd = r.currency === "USD";
  db.prepare(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, summary, created_at)
     VALUES (1, 'RECHARGE', 'ACTIVE', 'recharges', ?, 1, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    usd ? r.price : 0,
    usd ? 0 : r.price,
    usd ? r.profit : 0,
    usd ? 0 : r.profit,
    `MTC ${r.type} ${r.amount}`,
    IN_RANGE,
  );
  return id;
}

describe("Profits drill-down: recharge Detail column names the recharge type", () => {
  it("a DAYS recharge reads 'Days 180 days', not '180 credit' (Cornertech #395)", () => {
    const daysId = insertRecharge({
      type: "DAYS",
      amount: 180,
      currency: "LBP",
      price: 1_500_000,
      cost: 459_000,
      profit: 1_041_000,
    });

    const detail = profits.getModuleDetail("RECHARGE_MTC", FROM, TO);
    const row = detail.counted.find((r) => r.id === daysId);
    expect(row).toBeDefined();
    expect(row!.detail).toBe("Days 180 days");
    expect(row!.profit_lbp).toBe(1_041_000);
  });

  it("a CREDIT_TRANSFER recharge reads 'Credits $6' — the same label the Recharge page and Transactions summary use", () => {
    const creditId = insertRecharge({
      type: "CREDIT_TRANSFER",
      amount: 6,
      currency: "LBP",
      price: 540_000,
      cost: 450_000,
      profit: 90_000,
    });

    const detail = profits.getModuleDetail("RECHARGE_MTC", FROM, TO);
    const row = detail.counted.find((r) => r.id === creditId);
    expect(row).toBeDefined();
    expect(row!.detail).toBe("Credits $6");
  });

  it("every recharge type gets its own label — no type falls back to 'credit'", () => {
    const ids = (
      [
        ["VOUCHER", 10, "Voucher $10"],
        ["TOP_UP", 20, "Top-up"],
        ["ALFA_GIFT", 5, "Gift $5"],
        ["SHOP_LINE_USE", 3, "Shop Line Use $3"],
      ] as const
    ).map(([type, amount, expected]) => ({
      id: insertRecharge({
        type,
        amount,
        currency: "USD",
        price: amount,
        cost: amount - 1,
        profit: 1,
      }),
      expected,
    }));

    const detail = profits.getModuleDetail("RECHARGE_MTC", FROM, TO);
    for (const { id, expected } of ids) {
      const row = detail.counted.find((r) => r.id === id);
      expect(row).toBeDefined();
      expect(row!.detail).toBe(expected);
    }
  });
});
