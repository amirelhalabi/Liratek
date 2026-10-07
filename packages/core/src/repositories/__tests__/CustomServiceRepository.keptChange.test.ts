/**
 * Custom Services — kept change through `resolveKeptChange` (POSTING_MAP G42,
 * owner decisions 2026-10-07, docs/FEATURE_GUIDE.md §4.1).
 *
 * Before this change `CustomServiceRepository.createService` booked
 * `data.kept_change_*` straight into the profit stamp and never reconciled
 * the payment legs at all, so:
 *   - a kept amount larger than the real change (or any kept on an exact
 *     payment) booked profit out of nothing;
 *   - legs that did not cover the price were accepted;
 *   - a FOR-partner service, a legacy no-legs call and a session-basket
 *     (deferred) item all booked a client-sent kept as profit with no cash
 *     behind it;
 *   - a payout silently ignored a hand-built kept instead of refusing it.
 *
 * The real writer runs against the real fresh schema
 * (`electron-app/create_db.sql`). Payload field names come from the core
 * schema: every input goes through `createCustomServiceSchema.parse`
 * (rule 24), so a renamed field fails the parse instead of silently passing.
 */

import Database from "better-sqlite3";
import type { z } from "zod";
import fs from "fs";
import path from "path";
import { CustomServiceRepository } from "../CustomServiceRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { ProfitRepository } from "../ProfitRepository";
import { ProfitService } from "../../services/ProfitService";
import { runWithTenant } from "../../db/tenantContext";
import {
  createCustomServiceSchema,
  type CreateCustomServiceInput,
} from "../../validators/customService";
import {
  ledgerDeltas,
  snapshotLedgers,
  type LedgerSnapshot,
} from "../testHelpers/postingAssert";

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

let db: Database.Database;

function t<T>(fn: () => T): T {
  return runWithTenant(1, fn);
}

// The schema's own input type — a misspelt key is a compile error here.
// `deferPayment` is server-only (the schema strips it), so it is re-applied
// AFTER the parse exactly as SessionCheckoutService.processCartItem does.
type Input = z.input<typeof createCustomServiceSchema> & {
  deferPayment?: boolean;
};

function attempt({ deferPayment, ...input }: Input): {
  success: boolean;
  id?: number;
  error?: string;
} {
  const parsed: CreateCustomServiceInput = {
    ...createCustomServiceSchema.parse(input),
    ...(deferPayment !== undefined ? { deferPayment } : {}),
  };
  return t(() => new CustomServiceRepository().createService(parsed, 1));
}

function create(input: Input): number {
  const res = attempt(input);
  if (!res.success || !res.id) {
    throw new Error(`createService failed: ${res.error}`);
  }
  return res.id;
}

function txnOf(serviceId: number) {
  return db
    .prepare(
      `SELECT id, profit_usd, profit_lbp FROM transactions
       WHERE source_table = 'custom_services' AND source_id = ? AND type = 'CUSTOM_SERVICE'`,
    )
    .get(serviceId) as { id: number; profit_usd: number; profit_lbp: number };
}

function rowCount(): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM custom_services`).get() as {
      n: number;
    }
  ).n;
}

function moduleProfit(): { usd: number; lbp: number } {
  const now = Date.now();
  const d = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const rows = t(() =>
    new ProfitService(new ProfitRepository()).getByModule(
      d(now - 3 * 86_400_000),
      d(now + 3 * 86_400_000),
    ),
  );
  const row = rows.find((r) => r.module === "CUSTOM_SERVICE");
  return { usd: row?.profit_usd ?? 0, lbp: row?.profit_lbp ?? 0 };
}

function snap(): LedgerSnapshot {
  return snapshotLedgers(db);
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf8"));
  db.prepare(`INSERT INTO partners (tenant_id, name) VALUES (1, 'KC Partner')`).run();
  db.prepare(
    `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'KC Client', '70111222')`,
  ).run();
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  resetTransactionRepository();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  resetTransactionRepository();
  db.close();
});

describe("Custom Services kept change — accepted claims land in the profit stamp", () => {
  it("USD: price $5 / cost $3, customer hands $6, $1 kept → profit $3, drawer +$6", () => {
    const before = snap();
    const id = create({
      description: "Screen protector",
      cost_usd: 3,
      price_usd: 5,
      paid_by: "CASH",
      exchange_rate: RATE,
      payments: [{ method: "CASH", currency_code: "USD", amount: 6 }],
      kept_change_usd: 1,
    });
    expect(txnOf(id)).toMatchObject({ profit_usd: 3, profit_lbp: 0 });
    expect(ledgerDeltas(before, snap()).drawers).toEqual({ "General|USD": 6 });
  });

  it("LBP: price 450,000 LBP, $10 handed at 90,000, 400,000 LBP change back, 50,000 LBP kept → profit_lbp 500,000", () => {
    const before = snap();
    const id = create({
      description: "Unlock",
      price_lbp: 450_000,
      paid_by: "CASH",
      exchange_rate: RATE,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 10 },
        { method: "CASH", currency_code: "LBP", amount: 400_000, direction: "OUT" },
      ],
      kept_change_lbp: 50_000,
    });
    expect(txnOf(id)).toMatchObject({ profit_usd: 0, profit_lbp: 500_000 });
    expect(ledgerDeltas(before, snap()).drawers).toEqual({
      "General|USD": 10,
      "General|LBP": -400_000,
    });
  });
});

describe("Custom Services kept change — refused claims write nothing", () => {
  it("refuses a kept amount larger than the change actually due (exact payment, $3 'kept')", () => {
    const res = attempt({
      description: "Tampered",
      cost_usd: 3,
      price_usd: 5,
      paid_by: "CASH",
      exchange_rate: RATE,
      payments: [{ method: "CASH", currency_code: "USD", amount: 5 }],
      kept_change_usd: 3,
    });
    expect(res.success).toBe(false);
    expect(rowCount()).toBe(0);
  });

  it("refuses a phantom kept that fits inside the $0.05 reconcile epsilon", () => {
    const res = attempt({
      description: "Phantom cents",
      price_usd: 5,
      paid_by: "CASH",
      exchange_rate: RATE,
      payments: [{ method: "CASH", currency_code: "USD", amount: 5 }],
      kept_change_usd: 0.04,
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/more than the change actually due/);
    expect(rowCount()).toBe(0);
  });

  it("refuses payment lines that do not cover the price", () => {
    const res = attempt({
      description: "Short",
      price_usd: 5,
      paid_by: "CASH",
      exchange_rate: RATE,
      payments: [{ method: "CASH", currency_code: "USD", amount: 2 }],
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/do not reconcile/);
    expect(rowCount()).toBe(0);
  });

  it("refuses kept change on a FOR-partner service (exact amount required)", () => {
    const res = attempt({
      description: "FOR with kept",
      cost_usd: 3,
      price_usd: 5,
      paid_by: "CASH",
      partnerMode: "FOR",
      partnerId: 1,
      kept_change_usd: 1,
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/partner transaction cannot keep change/);
    expect(rowCount()).toBe(0);
  });

  it("refuses kept change on a payout (hand-built payload — the page never sends it)", () => {
    const res = attempt({
      description: "Payout with kept",
      price_usd: 100,
      cost_usd: 97,
      partnerMode: "VIA",
      partnerId: 1,
      direction: "OUT",
      kept_change_usd: 0.5,
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/payout cannot keep change/);
    expect(rowCount()).toBe(0);
  });

  it("refuses kept change on a legacy call with no payment lines", () => {
    const res = attempt({
      description: "Legacy kept",
      price_usd: 5,
      paid_by: "CASH",
      kept_change_usd: 1,
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/nothing to keep it from/);
    expect(rowCount()).toBe(0);
  });
});

describe("Custom Services kept change — session basket item", () => {
  it("a deferred (basket) item books no item-level kept: the basket owns the cash and its own kept change", () => {
    const id = create({
      description: "Basket item",
      cost_usd: 3,
      price_usd: 5,
      paid_by: "CASH",
      exchange_rate: RATE,
      payments: [{ method: "CASH", currency_code: "USD", amount: 6 }],
      kept_change_usd: 1,
      deferPayment: true,
    });
    expect(txnOf(id)).toMatchObject({ profit_usd: 2, profit_lbp: 0 });
  });
});

describe("Custom Services kept change — void nets every ledger and profit to 0 per currency (rule 20)", () => {
  it("create (USD in, LBP change, LBP kept) then void → drawers, debt, partner, supplier and profit all back to 0", () => {
    const before = snap();
    const id = create({
      description: "Void me",
      price_lbp: 450_000,
      cost_lbp: 100_000,
      paid_by: "CASH",
      exchange_rate: RATE,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 10 },
        { method: "CASH", currency_code: "LBP", amount: 400_000, direction: "OUT" },
      ],
      kept_change_lbp: 50_000,
    });
    expect(moduleProfit()).toEqual({ usd: 0, lbp: 400_000 });
    t(() => getTransactionRepository().voidTransaction(txnOf(id).id, 1));
    expect(ledgerDeltas(before, snap())).toEqual({
      drawers: {},
      supplier: {},
      partner: {},
      debt: {},
    });
    expect(moduleProfit()).toEqual({ usd: 0, lbp: 0 });
  });

  it("create (split cash + customer account, USD kept) then refund → every ledger and profit back to 0", () => {
    const before = snap();
    const id = create({
      description: "Refund me",
      price_usd: 20,
      cost_usd: 5,
      paid_by: "CASH",
      client_id: 1,
      exchange_rate: RATE,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 15 },
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 6 },
      ],
      kept_change_usd: 1,
    });
    expect(txnOf(id).profit_usd).toBe(16);
    t(() => getTransactionRepository().refundTransaction(txnOf(id).id, 1));
    expect(ledgerDeltas(before, snap())).toEqual({
      drawers: {},
      supplier: {},
      partner: {},
      debt: {},
    });
    expect(moduleProfit()).toEqual({ usd: 0, lbp: 0 });
  });
});
