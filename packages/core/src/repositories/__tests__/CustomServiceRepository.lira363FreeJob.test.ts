/**
 * LIRA-363 (owner decisions 2026-10-30) — a custom service marked "Free — no
 * charge" saves with price 0.
 *
 * Found on Cornertech: Rayan had Rawad (partner) do a Sejel Adli for his
 * sister and charged her nothing. The Services page refused price 0 (the
 * 2026-10-07 rule: an empty price means "type it"), so he booked an expense
 * plus a hand-added partner credit instead.
 *
 * Owner decisions:
 *   - an explicit `is_free` flag, never a bare 0 — an empty price without it
 *     is still refused (the 2026-10-07 rule stands);
 *   - via partner AND the shop's own jobs; never For Partner (the partner
 *     would be booked nothing) and never a payout;
 *   - a free job takes no payment at all and never goes through a session
 *     basket (nothing to collect).
 *
 * Money: no payment row and no drawer move on save; profit = −cost; a via
 * partner job books the partner the cost (CREDIT), exactly like a priced one.
 * Create + void nets to zero on every ledger touched (rule 20).
 *
 * Payload field names come from the core schema (rule 24). Rule 17: written
 * before the fix and run against the unfixed code first.
 */

import Database from "better-sqlite3";
import type { z } from "zod";
import fs from "fs";
import path from "path";
import { CustomServiceRepository } from "../CustomServiceRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetPartnerRepository } from "../PartnerRepository";
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

const RATE = 89_500;

let db: Database.Database;
let partnerId: number;

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
  return runWithTenant(1, () =>
    new CustomServiceRepository().createService(parsed, 1),
  );
}

function counts(): {
  services: number;
  txns: number;
  payments: number;
  partnerRows: number;
} {
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    services: n(`SELECT COUNT(*) AS n FROM custom_services`),
    txns: n(`SELECT COUNT(*) AS n FROM transactions`),
    payments: n(`SELECT COUNT(*) AS n FROM payments`),
    partnerRows: n(`SELECT COUNT(*) AS n FROM partner_ledger`),
  };
}

/** What the shop owes the partner, per currency (CREDIT − DEBIT). */
function owedToPartner(): { usd: number; lbp: number } {
  const sum = (currency: string) =>
    (
      db
        .prepare(
          `SELECT COALESCE(SUM(CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END), 0) AS n
             FROM partner_ledger WHERE partner_id = ? AND currency = ?`,
        )
        .get(partnerId, currency) as { n: number }
    ).n;
  return { usd: sum("USD"), lbp: sum("LBP") };
}

/** Every drawer balance, summed per currency. */
function drawers(): { usd: number; lbp: number } {
  const sum = (currency: string) =>
    (
      db
        .prepare(
          `SELECT COALESCE(SUM(balance), 0) AS n FROM drawer_balances WHERE currency_code = ?`,
        )
        .get(currency) as { n: number }
    ).n;
  return { usd: sum("USD"), lbp: sum("LBP") };
}

function txnOf(serviceId: number): {
  id: number;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  metadata_json: string;
} {
  return db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, profit_usd, profit_lbp, metadata_json
         FROM transactions WHERE source_table = 'custom_services' AND source_id = ?`,
    )
    .get(serviceId) as ReturnType<typeof txnOf>;
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf8"));
  partnerId = Number(
    db
      .prepare(`INSERT INTO partners (tenant_id, name) VALUES (1, 'RAWAD HMAIDI')`)
      .run().lastInsertRowid,
  );
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  resetTransactionRepository();
  resetPartnerRepository();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  resetTransactionRepository();
  resetPartnerRepository();
  db.close();
});

describe("LIRA-363 — a free job saves with price 0", () => {
  it("Rayan's case: Sejel Adli via Rawad, cost 700,000 LBP, free — partner owed 700,000, no drawer move, profit −700,000; void nets to zero", () => {
    const drawer0 = drawers();
    const res = attempt({
      description: "SEJEL ADLI",
      cost_lbp: 700_000,
      is_free: true,
      partnerId,
      partnerMode: "VIA",
      exchange_rate: RATE,
    });
    expect(res).toMatchObject({ success: true });

    expect(owedToPartner()).toEqual({ usd: 0, lbp: 700_000 });
    expect(drawers()).toEqual(drawer0);
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM payments`).get() as { n: number })
        .n,
    ).toBe(0);
    const txn = txnOf(res.id!);
    expect(txn.amount_usd).toBe(0);
    expect(txn.amount_lbp).toBe(0);
    expect(txn.profit_usd).toBe(0);
    expect(txn.profit_lbp).toBe(-700_000);
    expect(JSON.parse(txn.metadata_json).is_free).toBe(true);

    const voided = runWithTenant(1, () =>
      new CustomServiceRepository().deleteService(res.id!),
    );
    expect(voided.success).toBe(true);
    expect(owedToPartner()).toEqual({ usd: 0, lbp: 0 });
    expect(drawers()).toEqual(drawer0);
  });

  it("the shop's own free job: cost $5 — profit −$5, no payment, no partner row", () => {
    const drawer0 = drawers();
    const res = attempt({
      description: "Screen protector fitting (family)",
      cost_usd: 5,
      is_free: true,
      exchange_rate: RATE,
    });
    expect(res).toMatchObject({ success: true });
    const txn = txnOf(res.id!);
    expect(txn.profit_usd).toBe(-5);
    expect(drawers()).toEqual(drawer0);
    expect(counts()).toMatchObject({ payments: 0, partnerRows: 0 });
  });

  it("without the Free tick an empty price is still refused (2026-10-07 rule)", () => {
    const before = counts();
    const res = attempt({
      description: "SEJEL ADLI",
      cost_lbp: 700_000,
      partnerId,
      partnerMode: "VIA",
      exchange_rate: RATE,
    });
    expect(res.success).toBe(false);
    expect(counts()).toEqual(before);
  });

  it.each<[string, Input]>([
    [
      "a price",
      { cost_lbp: 700_000, price_lbp: 900_000, is_free: true },
    ],
    [
      "a payment",
      {
        cost_lbp: 700_000,
        is_free: true,
        payments: [{ method: "CASH", currency_code: "LBP", amount: 100_000 }],
      },
    ],
    [
      "For Partner",
      { cost_lbp: 700_000, is_free: true, partnerId: 1, partnerMode: "FOR" },
    ],
    [
      "a payout",
      {
        cost_lbp: 700_000,
        price_lbp: 700_000,
        is_free: true,
        partnerId: 1,
        partnerMode: "VIA",
        direction: "OUT",
      },
    ],
    [
      "kept change",
      { cost_lbp: 700_000, is_free: true, kept_change_lbp: 10_000 },
    ],
    [
      "on account",
      {
        cost_lbp: 700_000,
        is_free: true,
        paid_by: "CUSTOMER_ACCOUNT",
        client_id: 1,
      },
    ],
  ])("the schema refuses a free job with %s", (_label, input) => {
    expect(
      createCustomServiceSchema.safeParse({ description: "x", ...input })
        .success,
    ).toBe(false);
  });

  it("the schema refuses a free job with no cost", () => {
    expect(
      createCustomServiceSchema.safeParse({ description: "x", is_free: true })
        .success,
    ).toBe(false);
  });

  it("the server refuses a free job in a session basket, before any write", () => {
    const before = counts();
    const res = attempt({
      description: "SEJEL ADLI",
      cost_lbp: 700_000,
      is_free: true,
      exchange_rate: RATE,
      deferPayment: true,
    });
    expect(res.success).toBe(false);
    expect(counts()).toEqual(before);
  });
});
