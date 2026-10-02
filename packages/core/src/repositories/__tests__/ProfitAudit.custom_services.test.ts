/**
 * LIRA-185 — Profits accuracy audit, module `custom_services`.
 *
 * Each describe block reproduces one lead from the September audit with the
 * REAL writer (`CustomServiceRepository.createService` / `deleteService` /
 * `TransactionRepository.refundTransaction`) against the REAL fresh schema
 * (`electron-app/create_db.sql`), then reads every surface the lead names.
 *
 * Tests asserting the CORRECT value for a CONFIRMED lead are expected to FAIL
 * on the current code — they are the rule-17 failing-first guards for the
 * later fix. Tests for REFUTED / ALREADY_FIXED leads pass and pin the current
 * (correct) behaviour.
 *
 * Owner rules used as the "correct" side (docs/FEATURE_GUIDE.md, the
 * LIRA-219 bullet): profit counts "kept change in every module", "LBP for
 * every module", "proportional partner recognition (E-Q2) — a partner row
 * recognises the FRACTION the partner has actually covered". A voided or
 * refunded service carries no profit on the Profits page or in closing.
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
import { ProfitService } from "../../services/ProfitService";
import { ClosingService } from "../../services/ClosingService";
import { ClosingRepository } from "../ClosingRepository";
import { runWithTenant } from "../../db/tenantContext";
import {
  createCustomServiceSchema,
  type CreateCustomServiceInput,
} from "../../validators/customService";
import { dayBoundaryInstant } from "../testHelpers/boundaryInstant";

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

/** A fixed mid-day UTC instant: its calendar day is 2026-09-10 under any
 *  offset from -9h to +14h, so no Windows-vs-JS 'localtime' skew can move it. */
const DAY = "2026-09-10";
const MIDDAY = "2026-09-10T09:00:00.000Z";

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

function txnOf(serviceId: number): {
  id: number;
  profit_usd: number;
  profit_lbp: number;
} {
  return db
    .prepare(
      `SELECT id, profit_usd, profit_lbp FROM transactions
       WHERE source_table = 'custom_services' AND source_id = ? AND type = 'CUSTOM_SERVICE'`,
    )
    .get(serviceId) as { id: number; profit_usd: number; profit_lbp: number };
}

function profitsRow(from: string, to: string) {
  const svc = new ProfitService(new ProfitRepository());
  const rows = t(() => svc.getByModule(from, to));
  return rows.find((r) => r.module === "CUSTOM_SERVICE");
}

function closingProfit(day: string) {
  const closing = new ClosingService(
    new ClosingRepository(),
    new ProfitService(new ProfitRepository()),
  );
  return t(() =>
    closing.getDailyStatsSnapshot({ day }, { includeProfit: true }),
  );
}

function historyRow(serviceId: number) {
  return t(() => new CustomServiceRepository().getAll()).find(
    (r) => r.id === serviceId,
  );
}

function wideRange(): { from: string; to: string } {
  const now = Date.now();
  const d = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: d(now - 3 * 86_400_000), to: d(now + 3 * 86_400_000) };
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf8"));
  db.prepare(
    `INSERT INTO partners (tenant_id, name) VALUES (1, 'Audit Partner')`,
  ).run();
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  resetTransactionRepository();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  resetTransactionRepository();
  db.close();
});

// ─── Lead 1 — kept change ──────────────────────────────────────────────────
describe("Lead 1 — kept change: stamp vs module surfaces vs Profits/closing", () => {
  it("cost $3 / price $5 / customer hands $6, $1 kept: every surface shows $3 profit", () => {
    const id = create({
      description: "Screen protector install",
      cost_usd: 3,
      price_usd: 5,
      paid_by: "CASH",
      payments: [{ method: "CASH", currency_code: "USD", amount: 6 }],
      kept_change_usd: 1,
      transaction_time: MIDDAY,
    });

    const stamp = txnOf(id).profit_usd;
    const profits = profitsRow(DAY, DAY)?.profit_usd;
    const closing = closingProfit(DAY).totalProfitUSD;
    const history = historyRow(id)?.profit_usd;

    // Report the observed figures (visible in the failure output).
    const observed = { stamp, profits, closing, history };
    expect(observed).toEqual({
      stamp: 3,
      profits: 3,
      closing: 3,
      // Owner rule (FEATURE_GUIDE LIRA-219 bullet): kept change is profit in
      // every module — the module's own history row must agree.
      history: 3,
    });
  });

  it("Today's Profit card (getTodaySummary) includes the kept change too", () => {
    const id = create({
      description: "Screen protector install (today)",
      cost_usd: 3,
      price_usd: 5,
      paid_by: "CASH",
      payments: [{ method: "CASH", currency_code: "USD", amount: 6 }],
      kept_change_usd: 1,
    });
    const { from, to } = wideRange();
    const profits = profitsRow(from, to)?.profit_usd;
    const card = t(() => new CustomServiceRepository().getTodaySummary())
      .totalProfitUsd;
    expect({ stamp: txnOf(id).profit_usd, profits, card }).toEqual({
      stamp: 3,
      profits: 3,
      card: 3,
    });
  });
});

// ─── Lead 2 — LBP service in closing ───────────────────────────────────────
describe("Lead 2 — LBP-denominated service in the closing snapshot", () => {
  it("cost 200,000 / price 300,000 LBP: closing LBP profit = Profits LBP profit = 100,000", () => {
    const id = create({
      description: "SIM activation",
      cost_lbp: 200_000,
      price_lbp: 300_000,
      paid_by: "CASH",
      transaction_time: MIDDAY,
    });
    const stamp = txnOf(id);
    const profits = profitsRow(DAY, DAY);
    const closing = closingProfit(DAY);
    expect({
      stamp_lbp: stamp.profit_lbp,
      profits_lbp: profits?.profit_lbp,
      closing_lbp: closing.totalProfitLBP,
      closing_usd: closing.totalProfitUSD,
      history_lbp: historyRow(id)?.profit_lbp,
    }).toEqual({
      stamp_lbp: 100_000,
      profits_lbp: 100_000,
      closing_lbp: 100_000,
      closing_usd: 0,
      history_lbp: 100_000,
    });
  });
});

// ─── Lead 3 — partner coverage gating ──────────────────────────────────────
describe("Lead 3 — for-partner service, partner settled half", () => {
  function seedHalfCovered(withTime: boolean): number {
    const id = create({
      description: "For-partner job",
      cost_usd: 60,
      price_usd: 100,
      paid_by: "CASH",
      partnerMode: "FOR",
      partnerId: 1,
      ...(withTime ? { transaction_time: MIDDAY } : {}),
    });
    // Simulate the partner settling $50 of the $100 FOR_ ledger row.
    const upd = db
      .prepare(
        `UPDATE partner_ledger SET covered_amount = amount / 2
         WHERE reference_table = 'custom_services' AND reference_id = ?
           AND transaction_type LIKE 'FOR\\_%' ESCAPE '\\'`,
      )
      .run(id);
    expect(upd.changes).toBe(1);
    return id;
  }

  it("Profits and closing both recognise 50% of $40 = $20", () => {
    const id = seedHalfCovered(true);
    expect(txnOf(id).profit_usd).toBe(40);
    expect({
      profits: profitsRow(DAY, DAY)?.profit_usd,
      closing: closingProfit(DAY).totalProfitUSD,
    }).toEqual({ profits: 20, closing: 20 });
  });

  it("module Today's Profit card agrees with Profits ($20), not the full $40", () => {
    seedHalfCovered(false);
    const { from, to } = wideRange();
    const profits = profitsRow(from, to)?.profit_usd;
    const card = t(() => new CustomServiceRepository().getTodaySummary())
      .totalProfitUsd;
    expect({ profits, card }).toEqual({ profits: 20, card: 20 });
  });
});

// ─── Lead 4 — voided / refunded services on the card ───────────────────────
describe("Lead 4 — Today's Profit card after void / refund", () => {
  it("voided same day: card, history, Profits all show $0", () => {
    const id = create({
      description: "Voided job",
      cost_usd: 4,
      price_usd: 10,
      paid_by: "CASH",
    });
    const del = t(() => new CustomServiceRepository().deleteService(id));
    expect(del.success).toBe(true);
    const { from, to } = wideRange();
    const card = t(() => new CustomServiceRepository().getTodaySummary())
      .totalProfitUsd;
    expect({
      history: historyRow(id)?.profit_usd ?? 0,
      profits: profitsRow(from, to)?.profit_usd ?? 0,
      card,
    }).toEqual({ history: 0, profits: 0, card: 0 });
  });

  it("refunded same day: card and Profits both show $0", () => {
    const id = create({
      description: "Refunded job",
      cost_usd: 4,
      price_usd: 10,
      paid_by: "CASH",
    });
    const txnId = txnOf(id).id;
    t(() => getTransactionRepository().refundTransaction(txnId, 1));
    const flag = db
      .prepare(`SELECT is_refunded, status FROM custom_services WHERE id = ?`)
      .get(id) as { is_refunded: number; status: string };
    expect(flag.is_refunded).toBe(1);
    const { from, to } = wideRange();
    const card = t(() => new CustomServiceRepository().getTodaySummary())
      .totalProfitUsd;
    expect({
      profits: profitsRow(from, to)?.profit_usd ?? 0,
      card,
    }).toEqual({ profits: 0, card: 0 });
  });
});

// ─── Lead 5 — day boundary on the card ─────────────────────────────────────
describe("Lead 5 — Today's Profit card day boundary (local vs UTC)", () => {
  it("a service stored at 23:xx UTC that is 'today' in Beirut counts on the card under the Beirut offset", () => {
    const BEIRUT = 180;
    const boundaryUtc = dayBoundaryInstant(Date.now(), BEIRUT);
    const id = create({
      description: "After local midnight",
      cost_usd: 3,
      price_usd: 5,
      paid_by: "CASH",
    });
    db.prepare(`UPDATE custom_services SET created_at = ? WHERE id = ?`).run(
      boundaryUtc,
      id,
    );
    const card = runWithTenant(
      1,
      () => new CustomServiceRepository().getTodaySummary(),
      { clientTzOffsetMinutes: BEIRUT },
    ).totalProfitUsd;
    expect(card).toBe(2);
  });
});

// ─── Lead 6 — loss-making service (data side only) ─────────────────────────
// The defect itself is in three FRONTEND formatters (`usd > 0` guards turn
// -6 into "$0.00"); this core file can only pin that the DATA every one of
// them receives is the true negative, so the fix is display-only.
describe("Lead 6 — loss-making service: data handed to the module UI is -$6", () => {
  it("cost $10 / price $4: stamp, history row, Profits all carry -6", () => {
    const id = create({
      description: "Loss job",
      cost_usd: 10,
      price_usd: 4,
      paid_by: "CASH",
      transaction_time: MIDDAY,
    });
    expect({
      stamp: txnOf(id).profit_usd,
      history: historyRow(id)?.profit_usd,
      profits: profitsRow(DAY, DAY)?.profit_usd,
    }).toEqual({ stamp: -6, history: -6, profits: -6 });
  });
});

// ─── Lead 7 — Margin column for an LBP-only service ────────────────────────
describe("Lead 7 — Profits By-Module margin for an LBP-only service", () => {
  it("margin is computed from LBP (33.3%), never the USD-only 0%", () => {
    create({
      description: "SIM activation",
      cost_lbp: 200_000,
      price_lbp: 300_000,
      paid_by: "CASH",
      transaction_time: MIDDAY,
    });
    const row = profitsRow(DAY, DAY);
    expect(row?.revenue_lbp).toBe(300_000);
    expect(row?.profit_lbp).toBe(100_000);
    expect(row?.margin_pct).not.toBeNull();
    expect(row?.margin_pct as number).toBeCloseTo(33.333, 2);
  });
});

// ─── Lead 8 — dashboard profit tile ────────────────────────────────────────
describe("Lead 8 — dashboard profit tile includes custom services", () => {
  it("ProfitService.getByDate (the tile's source) carries the custom-service margin", () => {
    for (let i = 0; i < 10; i++) {
      create({
        description: `Job ${i}`,
        cost_usd: 3,
        price_usd: 5,
        paid_by: "CASH",
        transaction_time: MIDDAY,
      });
    }
    const svc = new ProfitService(new ProfitRepository());
    const rows = t(() => svc.getByDate(DAY, DAY));
    const net = rows.reduce((s, r) => s + r.net_profit_usd, 0);
    const summary = t(() => svc.getSummary(DAY, DAY));
    expect({ net, gross: summary.totals.gross_profit_usd }).toEqual({
      net: 20,
      gross: 20,
    });
  });
});

// ─── Lead 9 — By User / By Client LBP revenue for deferred partner rows ────
describe("Lead 9 — By-User/By-Client revenue_lbp for an unsettled for-partner LBP service", () => {
  it("By Module, By User and By Client all show 0 LBP revenue while the partner owes everything", () => {
    create({
      description: "For-partner LBP job",
      cost_lbp: 200_000,
      price_lbp: 300_000,
      paid_by: "CASH",
      partnerMode: "FOR",
      partnerId: 1,
      client_name: "Walk-in",
      transaction_time: MIDDAY,
    });
    const svc = new ProfitService(new ProfitRepository());
    const byModule = profitsRow(DAY, DAY);
    const byUser = t(() => svc.getByUser(DAY, DAY));
    const byClient = t(() => svc.getByClient(DAY, DAY));
    const sum = (rows: Array<{ revenue_lbp?: number }>) =>
      rows.reduce((s, r) => s + (r.revenue_lbp ?? 0), 0);
    expect({
      module: byModule?.revenue_lbp ?? 0,
      user: sum(byUser),
      client: sum(byClient),
    }).toEqual({ module: 0, user: 0, client: 0 });
    // Non-vacuity: the row IS in By User (counted), and once the partner
    // covers everything its LBP revenue appears in both tabs.
    expect(byUser.reduce((s, r) => s + r.transaction_count, 0)).toBe(1);
    db.prepare(`UPDATE partner_ledger SET covered_amount = amount`).run();
    expect({
      module: profitsRow(DAY, DAY)?.revenue_lbp,
      user: sum(t(() => svc.getByUser(DAY, DAY))),
    }).toEqual({ module: 300_000, user: 300_000 });
  });
});
