/**
 * LIRA-258 / POSTING_INTEGRITY_PLAN.md 4.2 / POSTING_MAP.md G16 — via-partner
 * custom service profit timing (owner decision D5, 2026-10-06: "count it when
 * the partner pays", same coverage rule as FOR rows).
 *
 * A Via-Partner PAYOUT (`partnerMode: "VIA"`, `direction: "OUT"`) books a
 * `THROUGH_CUSTOM_SERVICE` partner_ledger DEBIT for the price — the partner
 * owes the shop that money. Its profit (price − cost) must therefore be
 * recognised in proportion to how much of that DEBIT the partner has settled,
 * exactly like a FOR_% row:
 *   - the partner has paid nothing yet → $0 counted,
 *   - a partner settlement covers the DEBIT FIFO (PartnerRepository
 *     .applySettlementCoverage) → the covered fraction counts,
 *   - voiding that settlement gives the coverage back (TransactionRepository
 *     ._unwindPartnerSettlementCoverage) → deferred again.
 *
 * A Via-Partner IN service (the customer paid us; the shop owes the partner
 * the COST, a CREDIT) is NOT deferred: the partner owes the shop nothing, so
 * there is nothing to wait for. And voiding such an IN service writes a
 * THROUGH_CUSTOM_SERVICE DEBIT *reversal* row — that row is not a partner
 * obligation and must never soak up a real partner settlement.
 *
 * Real writers + the real fresh schema (`electron-app/create_db.sql`).
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { CustomServiceRepository } from "../CustomServiceRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { ProfitRepository } from "../ProfitRepository";
import { PartnerRepository } from "../PartnerRepository";
import { ProfitService } from "../../services/ProfitService";
import { PartnerService } from "../../services/PartnerService";
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

const DAY = "2026-09-10";
const MIDDAY = "2026-09-10T09:00:00.000Z";
const PARTNER_ID = 1;

let db: Database.Database;

function t<T>(fn: () => T): T {
  return runWithTenant(1, fn);
}

function create(input: Record<string, unknown>): number {
  const parsed = createCustomServiceSchema.parse(
    input,
  ) as CreateCustomServiceInput;
  const res = t(() => new CustomServiceRepository().createService(parsed, 1));
  if (!res.success || !res.id) {
    throw new Error(`createService failed: ${res.error}`);
  }
  return res.id;
}

function payout(): number {
  return create({
    description: "Syria transfer payout",
    price_usd: 100,
    cost_usd: 97,
    partnerMode: "VIA",
    partnerId: PARTNER_ID,
    direction: "OUT",
    transaction_time: MIDDAY,
  });
}

function customServiceProfitUsd(): number {
  const rows = t(() =>
    new ProfitService(new ProfitRepository()).getByModule(DAY, DAY),
  );
  return rows.find((r) => r.module === "CUSTOM_SERVICE")?.profit_usd ?? 0;
}

function settle(amount: number): number {
  const entry = t(() =>
    new PartnerService(new PartnerRepository()).settle({
      partnerId: PARTNER_ID,
      amount,
      currency: "USD",
      settlementMethod: "CASH",
      userId: 1,
    }),
  );
  return entry.id;
}

function throughRows(serviceId: number) {
  return db
    .prepare(
      `SELECT id, direction, amount, covered_amount FROM partner_ledger
       WHERE reference_table = 'custom_services' AND reference_id = ?
         AND transaction_type = 'THROUGH_CUSTOM_SERVICE'
       ORDER BY id ASC`,
    )
    .all(serviceId) as Array<{
    id: number;
    direction: "DEBIT" | "CREDIT";
    amount: number;
    covered_amount: number;
  }>;
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf8"));
  db.prepare(
    `INSERT INTO partners (tenant_id, name) VALUES (1, 'Syria Partner')`,
  ).run();
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  resetTransactionRepository();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  resetTransactionRepository();
  db.close();
});

describe("G16 — Via-Partner PAYOUT profit waits for the partner", () => {
  it("unsettled payout: stamp is $3 but Profits counts $0", () => {
    const id = payout();
    const stamp = db
      .prepare(
        `SELECT profit_usd FROM transactions
         WHERE source_table = 'custom_services' AND source_id = ? AND type = 'CUSTOM_SERVICE'`,
      )
      .get(id) as { profit_usd: number };
    expect(stamp.profit_usd).toBeCloseTo(3, 2);
    expect(customServiceProfitUsd()).toBeCloseTo(0, 2);
  });

  it("partner pays $50 of $100 → settlement covers the payout DEBIT, half the profit counts", () => {
    const id = payout();
    settle(50);
    const [row] = throughRows(id);
    expect(row.direction).toBe("DEBIT");
    expect(row.covered_amount).toBeCloseTo(50, 2);
    expect(customServiceProfitUsd()).toBeCloseTo(1.5, 2);
  });

  it("partner pays the full $100 → full $3 counts", () => {
    const id = payout();
    settle(100);
    expect(throughRows(id)[0].covered_amount).toBeCloseTo(100, 2);
    expect(customServiceProfitUsd()).toBeCloseTo(3, 2);
  });

  it("voiding the settlement gives the coverage back → deferred again", () => {
    const id = payout();
    const entryId = settle(100);
    const txn = t(() =>
      getTransactionRepository().getBySourceId("partner_ledger", entryId),
    );
    expect(txn).toBeTruthy();
    t(() => getTransactionRepository().voidTransaction(txn!.id, 1));
    expect(throughRows(id)[0].covered_amount).toBeCloseTo(0, 2);
    expect(customServiceProfitUsd()).toBeCloseTo(0, 2);
  });
});

describe("G16 — Via-Partner IN is not deferred (pins, not failing-first)", () => {
  it("IN service: the shop owes the partner, so the full $40 counts today", () => {
    create({
      description: "Partner-performed repair",
      price_usd: 100,
      cost_usd: 60,
      paid_by: "CASH",
      partnerMode: "VIA",
      partnerId: PARTNER_ID,
      transaction_time: MIDDAY,
    });
    expect(customServiceProfitUsd()).toBeCloseTo(40, 2);
  });

  it("a voided IN service's DEBIT reversal row never absorbs a real partner settlement", () => {
    const inId = create({
      description: "Partner-performed repair (voided)",
      price_usd: 100,
      cost_usd: 60,
      paid_by: "CASH",
      partnerMode: "VIA",
      partnerId: PARTNER_ID,
      transaction_time: MIDDAY,
    });
    const del = t(() => new CustomServiceRepository().deleteService(inId));
    expect(del.success).toBe(true);
    const inRows = throughRows(inId);
    // CREDIT (cost owed to partner) + its DEBIT reversal.
    expect(inRows.map((r) => r.direction)).toEqual(["CREDIT", "DEBIT"]);

    const outId = payout();
    settle(100);

    expect(throughRows(inId).map((r) => r.covered_amount)).toEqual([0, 0]);
    expect(throughRows(outId)[0].covered_amount).toBeCloseTo(100, 2);
    expect(customServiceProfitUsd()).toBeCloseTo(3, 2);
  });
});
