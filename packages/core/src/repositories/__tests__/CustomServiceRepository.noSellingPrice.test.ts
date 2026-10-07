/**
 * Custom Services — a customer-pays sale needs a selling price
 * (owner decision 2026-10-07).
 *
 * Owner: "no selling price set only means that when the custom service is
 * selected on the services page, the selling price is not auto-filled, and
 * the cashier fills it in on the spot. The payment form should be waiting
 * for a selling price."
 *
 * Before this change `customerAmountDue` fell back to the COST when no price
 * was entered, so the server reconciled the customer's payment against the
 * cost — i.e. the customer was charged the cost, while the unified
 * transaction stamped `amount_usd = price = 0` and a negative profit.
 *
 * Now a customer-pays sale (not For-partner, not a payout, not a
 * session-basket item) with no price in either currency is refused before
 * anything is written. The flows that legitimately carry no price are pinned
 * here too so the guard cannot widen silently:
 *   - payout (Via partner, direction OUT) — unaffected, has its own
 *     both-sides rule;
 *   - For partner — no customer pays; left unchanged (open owner question);
 *   - session-basket item (deferPayment) — the basket owns the customer's
 *     money, and `session_cart_items` is persisted in the DB, so refusing
 *     here would strand a basket opened before this upgrade. The page now
 *     refuses to add a no-price item to the basket instead.
 *
 * Payload field names come from the core schema (rule 24).
 */

import Database from "better-sqlite3";
import type { z } from "zod";
import fs from "fs";
import path from "path";
import { CustomServiceRepository } from "../CustomServiceRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { runWithTenant } from "../../db/tenantContext";
import {
  createCustomServiceSchema,
  type CreateCustomServiceInput,
} from "../../validators/customService";

const CREATE_DB_SQL_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "electron-app",
  "create_db.sql",
);

const RATE = 90_000;
const NO_PRICE_MESSAGE = "Enter a selling price first.";

let db: Database.Database;
let partnerId: number;
let clientId: number;

type Input = z.input<typeof createCustomServiceSchema>;

function attempt(input: Input): {
  success: boolean;
  id?: number;
  error?: string;
} {
  const parsed = createCustomServiceSchema.parse(
    input,
  ) as CreateCustomServiceInput;
  return runWithTenant(1, () =>
    new CustomServiceRepository().createService(parsed, 1),
  );
}

function counts(): { services: number; txns: number; payments: number } {
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    services: n(`SELECT COUNT(*) AS n FROM custom_services`),
    txns: n(`SELECT COUNT(*) AS n FROM transactions`),
    payments: n(`SELECT COUNT(*) AS n FROM payments`),
  };
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf8"));
  partnerId = Number(
    db
      .prepare(
        `INSERT INTO partners (tenant_id, name) VALUES (1, 'NP Partner')`,
      )
      .run().lastInsertRowid,
  );
  clientId = Number(
    db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'NP Client', '70333444')`,
      )
      .run().lastInsertRowid,
  );
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  resetTransactionRepository();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  resetTransactionRepository();
  db.close();
});

describe("customer-pays custom service with no selling price is refused", () => {
  it("USD cost $3, no price, customer hands the cost → refused, nothing written", () => {
    const before = counts();
    const res = attempt({
      description: "Cost-only preset",
      cost_usd: 3,
      paid_by: "CASH",
      exchange_rate: RATE,
      payments: [{ method: "CASH", currency_code: "USD", amount: 3 }],
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe(NO_PRICE_MESSAGE);
    expect(counts()).toEqual(before);
  });

  it("LBP cost only, no price → refused", () => {
    const before = counts();
    const res = attempt({
      description: "LBP cost-only preset",
      cost_lbp: 270_000,
      paid_by: "CASH",
      exchange_rate: RATE,
      payments: [{ method: "CASH", currency_code: "LBP", amount: 270_000 }],
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe(NO_PRICE_MESSAGE);
    expect(counts()).toEqual(before);
  });

  it("legacy no-legs call (paid_by only), cost only → refused", () => {
    const res = attempt({
      description: "Legacy cost-only",
      cost_usd: 3,
      paid_by: "CASH",
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe(NO_PRICE_MESSAGE);
  });

  it("on account (CUSTOMER_ACCOUNT), cost only → refused (no debt booked at cost)", () => {
    const before = counts();
    const res = attempt({
      description: "On-account cost-only",
      cost_usd: 3,
      paid_by: "CUSTOMER_ACCOUNT",
      client_id: clientId,
      exchange_rate: RATE,
      payments: [
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 3 },
      ],
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe(NO_PRICE_MESSAGE);
    expect(counts()).toEqual(before);
  });

  it("Via partner (customer pays us), cost only → refused", () => {
    const res = attempt({
      description: "Via cost-only",
      cost_usd: 3,
      paid_by: "CASH",
      exchange_rate: RATE,
      partnerId,
      partnerMode: "VIA",
      payments: [{ method: "CASH", currency_code: "USD", amount: 3 }],
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe(NO_PRICE_MESSAGE);
  });
});

describe("with a selling price the payment reconciles against the PRICE", () => {
  it("price $5 / cost $3, customer pays $5 → accepted, amount = price", () => {
    const res = attempt({
      description: "Priced on the spot",
      cost_usd: 3,
      price_usd: 5,
      paid_by: "CASH",
      exchange_rate: RATE,
      payments: [{ method: "CASH", currency_code: "USD", amount: 5 }],
    });
    expect(res.success).toBe(true);
    const txn = db
      .prepare(
        `SELECT amount_usd, profit_usd FROM transactions
         WHERE source_table = 'custom_services' AND source_id = ? AND type = 'CUSTOM_SERVICE'`,
      )
      .get(res.id) as { amount_usd: number; profit_usd: number };
    expect(txn.amount_usd).toBe(5);
    expect(txn.profit_usd).toBe(2);
  });

  it("price $5 / cost $3, customer pays only the cost $3 → refused (short of the price)", () => {
    const before = counts();
    const res = attempt({
      description: "Underpaid",
      cost_usd: 3,
      price_usd: 5,
      paid_by: "CASH",
      exchange_rate: RATE,
      payments: [{ method: "CASH", currency_code: "USD", amount: 3 }],
    });
    expect(res.success).toBe(false);
    expect(res.error).not.toBe(NO_PRICE_MESSAGE);
    expect(counts()).toEqual(before);
  });

  it("price only (no cost) → accepted", () => {
    const res = attempt({
      description: "Price-only",
      price_lbp: 450_000,
      paid_by: "CASH",
      exchange_rate: RATE,
      payments: [{ method: "CASH", currency_code: "LBP", amount: 450_000 }],
    });
    expect(res.success).toBe(true);
  });
});

describe("flows that legitimately carry no customer price are untouched", () => {
  it("payout (Via partner, OUT) with arrived + paid-out → accepted", () => {
    const res = attempt({
      description: "Payout",
      cost_usd: 97,
      price_usd: 100,
      paid_by: "CASH",
      partnerId,
      partnerMode: "VIA",
      direction: "OUT",
    });
    expect(res.success).toBe(true);
  });

  it("For partner, cost only → still accepted (no customer pays; open owner question)", () => {
    const res = attempt({
      description: "For partner cost-only",
      cost_usd: 3,
      paid_by: "CASH",
      partnerId,
      partnerMode: "FOR",
    });
    expect(res.success).toBe(true);
  });

  it("session-basket item (deferPayment), cost only → still accepted (persisted baskets)", () => {
    const res = attempt({
      description: "Basket cost-only",
      cost_usd: 3,
      paid_by: "CASH",
      deferPayment: true,
    });
    expect(res.success).toBe(true);
  });
});
