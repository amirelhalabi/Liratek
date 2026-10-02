/**
 * LIRA-185 — profit-surface audit, module: recharge (MTC/Alfa telecom).
 *
 * Re-verification of the September audit's leads BY EXECUTION (CLAUDE.md
 * rule 28). Every case drives the REAL writers
 * (`RechargeRepository.processRecharge` / `processCreditBuyback`) against
 * the REAL schema (`electron-app/create_db.sql`, fresh in-memory DB per
 * case) and then reads every core-side surface the lead names:
 *   - the transactions profit stamp,
 *   - `ProfitService.getSummary` / `getByModule` (the Profits page),
 *   - `ClosingService.getDailyStatsSnapshot` (the Closing report),
 *   - `RechargeRepository.getTodayStats` / `getHistory` (module header /
 *     history modal source rows).
 *
 * Cases whose name starts with "CONFIRMED" assert the CORRECT value and are
 * expected to FAIL on the current code (rule-17 failing-first guard for the
 * later fix). All other cases pass and document the agreeing numbers.
 * Frontend-only leads (preview / history-mapping / Profits.tsx render) are
 * out of reach of this core suite and are not asserted here.
 */
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository";
import { ProfitRepository } from "../ProfitRepository";
import { ClosingRepository } from "../ClosingRepository";
import { ProfitService } from "../../services/ProfitService";
import { ClosingService } from "../../services/ClosingService";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetDebtService } from "../../services/DebtService";
import { resetDebtRepository } from "../DebtRepository";
import { resetCarrierLineRepository } from "../CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository";
import { resetCarrierLineService } from "../../services/CarrierLineService";

const SCHEMA = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "..",
    "electron-app",
    "create_db.sql",
  ),
  "utf-8",
);

type G = { __LIRATEK_TEST_DB__?: Database.Database };
let db: Database.Database;
let TODAY = "";

function resetSingletons(): void {
  resetTransactionRepository();
  resetDebtService();
  resetDebtRepository();
  resetCarrierLineRepository();
  resetCarrierLineMovementRepository();
  resetCarrierLineService();
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(SCHEMA);
  db.pragma("foreign_keys = OFF");
  (globalThis as G).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  resetSingletons();
  TODAY = (
    db.prepare(`SELECT date('now','localtime') AS d`).get() as { d: string }
  ).d;
  // Drawers stocked so no guard trips on a negative balance.
  const seed = db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  for (const [d, c, b] of [
    ["MTC", "USD", 1000],
    ["Alfa", "USD", 1000],
    ["General", "USD", 5000],
    ["General", "LBP", 500_000_000],
  ] as const)
    seed.run(d, c, b);
  // Shop's own primary MTC line (needed by the buy-back path).
  db.prepare(
    `INSERT INTO carrier_lines (tenant_id, carrier, phone_number, label, credits, validity_expires_at, is_active, is_primary)
     VALUES (1, 'mtc', '03123456', 'Shop MTC', 500, '2099-01-01', 1, 1)`,
  ).run();
});

afterEach(() => {
  resetTenantContext();
  resetSingletons();
  delete (globalThis as G).__LIRATEK_TEST_DB__;
  db.close();
});

const repo = () => new RechargeRepository();
const profitService = () => new ProfitService(new ProfitRepository());
const closingSnapshot = () =>
  new ClosingService(
    new ClosingRepository(),
    profitService(),
  ).getDailyStatsSnapshot({ day: TODAY }, { includeProfit: true });

/** The archetype: MTC $3 credit sold for 300,000 LBP cash (live-DB row 1). */
function sellMtc3(extra: Record<string, unknown> = {}): number {
  const res = repo().processRecharge({
    provider: "MTC",
    type: "CREDIT_TRANSFER",
    amount: 3,
    cost: 255_000,
    price: 300_000,
    currency: "LBP",
    phoneNumber: "03999001",
    payments: [{ method: "CASH", currencyCode: "LBP", amount: 300_000 }],
    userId: 1,
    ...extra,
  } as Parameters<RechargeRepository["processRecharge"]>[0]);
  if (!res.success) throw new Error(`processRecharge failed: ${res.error}`);
  return res.id as number;
}

function stamp(rechargeId: number) {
  return db
    .prepare(
      `SELECT type, profit_usd, profit_lbp FROM transactions WHERE source_table='recharges' AND source_id=? ORDER BY id LIMIT 1`,
    )
    .get(rechargeId) as { type: string; profit_usd: number; profit_lbp: number };
}

const r2 = (x: number | null | undefined) => Math.round((x ?? 0) * 100) / 100;

describe("LIRA-185 recharge — lead #0: closing books zero LBP recharge profit", () => {
  it("closing totalProfitLBP == Profits gross_profit_lbp == stamp (45,000) for an LBP recharge", () => {
    const id = sellMtc3();
    const s = stamp(id);
    const summary = profitService().getSummary(TODAY, TODAY);
    const snap = closingSnapshot();
    // eslint-disable-next-line no-console -- evidence print for the audit
    process.stdout.write(
      `#0 stamp=${JSON.stringify(s)} profits.recharges=${JSON.stringify(summary.recharges)} gross_lbp=${summary.totals.gross_profit_lbp} closing=${snap.totalProfitUSD}/${snap.totalProfitLBP}\n`,
    );
    expect(s.profit_lbp).toBe(45_000);
    expect(summary.recharges.profit_lbp).toBe(45_000);
    expect(r2(snap.totalProfitLBP)).toBe(r2(summary.totals.gross_profit_lbp));
    expect(r2(snap.totalProfitLBP)).toBe(45_000);
  });
});

describe("LIRA-185 recharge — leads #1/#2: preview & history gross formula vs SMS-netted stamp", () => {
  it("stamp is now GROSS (price - amount x cost rate), SMS fee booked as its own expense", () => {
    const id = sellMtc3();
    const s = stamp(id);
    const previewFormula = 300_000 - 3 * 85_000; // TelecomForm preview
    const hist = repo()
      .getHistory("MTC")
      .find((r) => r.id === id) as unknown as { price: number; cost: number };
    const historyFormula = hist.price - hist.cost; // Recharge/index.tsx mapping
    const sms = db
      .prepare(
        `SELECT amount_usd, amount_lbp FROM expenses WHERE category='SMS_Transfer_Fee' AND source_ref_table='recharges' AND source_ref_id=?`,
      )
      .all(id) as { amount_usd: number; amount_lbp: number }[];
    process.stdout.write(
      `#1/#2 stamp=${s.profit_lbp} preview=${previewFormula} history=${historyFormula} smsExpense=${JSON.stringify(sms)}\n`,
    );
    expect(s.profit_lbp).toBe(previewFormula);
    expect(historyFormula).toBe(s.profit_lbp);
    expect(sms).toHaveLength(1);
    expect(r2(sms[0].amount_usd)).toBe(0.16);
  });
});

describe("LIRA-185 recharge — lead #4: By-Module margin for an LBP-only row", () => {
  it("RECHARGE_MTC margin_pct is 15% (45,000 / 300,000), not 0", () => {
    sellMtc3();
    const rows = profitService().getByModule(TODAY, TODAY);
    const mtc = rows.find((r) => r.module === "RECHARGE_MTC");
    process.stdout.write(`#4 byModule MTC=${JSON.stringify(mtc)}\n`);
    expect(mtc).toBeDefined();
    expect(r2(mtc!.margin_pct)).toBe(15);
    expect(mtc!.margin_converted).toBe(false);
  });
});

describe("LIRA-185 recharge — lead #5: other-currency kept change", () => {
  it("$1.63 kept on an LBP recharge reaches stamp, Profits gross_profit_usd and closing", () => {
    // Customer tenders $5 (445,000 at the 89,000 till rate) for 300,000 LBP
    // and leaves the 145,000 change: kept_change_usd = 145,000/89,000.
    const kept = Math.round((145_000 / 89_000) * 100) / 100; // 1.63
    const id = sellMtc3({
      payments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
      tender_exchange_rate: 89_000,
      kept_change_usd: kept,
    });
    const s = stamp(id);
    const summary = profitService().getSummary(TODAY, TODAY);
    const snap = closingSnapshot();
    const mtc = profitService()
      .getByModule(TODAY, TODAY)
      .find((r) => r.module === "RECHARGE_MTC");
    process.stdout.write(
      `#5 stamp=${JSON.stringify(s)} profits.recharges=${JSON.stringify(summary.recharges)} gross=${summary.totals.gross_profit_usd}/${summary.totals.gross_profit_lbp} closing=${snap.totalProfitUSD}/${snap.totalProfitLBP} byModule=${JSON.stringify(mtc)}\n`,
    );
    expect(r2(s.profit_usd)).toBe(kept);
    expect(s.profit_lbp).toBe(45_000);
    expect(r2(summary.totals.gross_profit_usd)).toBe(kept);
    expect(r2(summary.totals.gross_profit_lbp)).toBe(45_000);
    expect(r2(snap.totalProfitUSD)).toBe(kept);
    expect(r2(snap.totalProfitLBP)).toBe(45_000);
  });
});

describe("LIRA-185 recharge — lead #6/#7 (core half): refunded & debt-pending rows", () => {
  it("getHistory still projects is_refunded=1 for a voided recharge (the frontend mapping drops it)", () => {
    const id = sellMtc3();
    db.prepare(`UPDATE recharges SET is_refunded=1, refunded_at=datetime('now') WHERE id=?`).run(id);
    const hist = repo()
      .getHistory("MTC")
      .find((r) => r.id === id) as unknown as Record<string, unknown>;
    const summary = profitService().getSummary(TODAY, TODAY);
    process.stdout.write(
      `#6 history.is_refunded=${String(hist.is_refunded)} price-cost=${Number(hist.price) - Number(hist.cost)} profits.recharges.profit_lbp=${summary.recharges.profit_lbp}\n`,
    );
    expect(hist.is_refunded).toBe(1);
    expect(summary.recharges.profit_lbp).toBe(0);
  });
});

describe("LIRA-185 recharge — lead #8: CREDIT_BUYBACK", () => {
  it("LBP buy-back: stamp spread reaches Profits (topups_buybacks) and closing equally", () => {
    const res = repo().processCreditBuyback({
      provider: "MTC",
      type: "CREDIT_BUYBACK",
      amount: 10,
      cost: 0,
      price: 800_000,
      currency: "LBP",
      phoneNumber: "03123456",
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 800_000 }],
      userId: 1,
    } as Parameters<RechargeRepository["processCreditBuyback"]>[0]);
    if (!res.success) throw new Error(`buyback failed: ${res.error}`);
    const s = stamp(res.id as number);
    const summary = profitService().getSummary(TODAY, TODAY);
    const snap = closingSnapshot();
    const expected = r2(10 - 800_000 / 90_000); // 1.11
    process.stdout.write(
      `#8 stamp=${JSON.stringify(s)} topups_buybacks=${JSON.stringify(summary.topups_buybacks)} gross=${summary.totals.gross_profit_usd}/${summary.totals.gross_profit_lbp} closing=${snap.totalProfitUSD}/${snap.totalProfitLBP}\n`,
    );
    expect(s.type).toBe("TELECOM_CREDIT_BUYBACK");
    expect(r2(s.profit_usd)).toBe(expected);
    expect(r2(summary.totals.gross_profit_usd)).toBe(expected);
    expect(r2(snap.totalProfitUSD)).toBe(expected);
  });

  it("USD buy-back with price 900 (REST default currency): closing never reads the payout as +$900 profit", () => {
    const res = repo().processCreditBuyback({
      provider: "MTC",
      type: "CREDIT_BUYBACK",
      amount: 10,
      cost: 0,
      price: 900,
      phoneNumber: "03123456",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 900 }],
      userId: 1,
    } as Parameters<RechargeRepository["processCreditBuyback"]>[0]);
    process.stdout.write(`#8b buyback result=${JSON.stringify(res)}\n`);
    if (!res.success) return; // rejected by a guard: nothing to mis-report
    const s = stamp(res.id as number);
    const summary = profitService().getSummary(TODAY, TODAY);
    const snap = closingSnapshot();
    process.stdout.write(
      `#8b stamp=${JSON.stringify(s)} gross=${summary.totals.gross_profit_usd} closing=${snap.totalProfitUSD}\n`,
    );
    expect(r2(snap.totalProfitUSD)).toBe(r2(s.profit_usd));
    expect(r2(snap.totalProfitUSD)).toBe(r2(summary.totals.gross_profit_usd));
  });
});

describe("LIRA-185 recharge — lead #9: MTC tab header Profit metric", () => {
  it("getTodayStats (the header's source since LIRA-250) reports the stamped 45,000 LBP", () => {
    sellMtc3();
    const stats = repo().getTodayStats("MTC");
    process.stdout.write(`#9 todayStats=${JSON.stringify(stats)}\n`);
    expect(stats.count).toBe(1);
    expect(stats.profit_lbp).toBe(45_000);
    expect(stats.byCurrency).toEqual([
      expect.objectContaining({ currency: "LBP", commission: 45_000, count: 1 }),
    ]);
  });
});

describe("LIRA-185 recharge — lead #10 (core half): an un-propagated discount", () => {
  it("price 300,000 with only 255,000 tendered and no client is rejected (the frontend never lowers price)", () => {
    const res = repo().processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 3,
      cost: 255_000,
      price: 300_000,
      currency: "LBP",
      phoneNumber: "03999002",
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 255_000 }],
      userId: 1,
    } as Parameters<RechargeRepository["processRecharge"]>[0]);
    process.stdout.write(`#10 result=${JSON.stringify(res)}\n`);
    expect(res.success).toBe(false);
  });
});

describe("LIRA-185 recharge — lead #12 (core half): DAYS default_price_to_client", () => {
  it("a DAYS sale stores whatever default_price_to_client the caller sends (30 x 100,000 = 3,000,000)", () => {
    const res = repo().processRecharge({
      provider: "MTC",
      type: "DAYS",
      amount: 30,
      cost: 76_500,
      price: 200_000,
      currency: "LBP",
      default_price_to_client: 30 * 100_000,
      phoneNumber: "03999003",
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 200_000 }],
      userId: 1,
    } as Parameters<RechargeRepository["processRecharge"]>[0]);
    process.stdout.write(`#12 result=${JSON.stringify(res)}\n`);
    if (!res.success) return;
    const row = db
      .prepare(`SELECT price, default_price_to_client FROM recharges WHERE id=?`)
      .get(res.id) as { price: number; default_price_to_client: number };
    process.stdout.write(
      `#12 row=${JSON.stringify(row)} marginOverride=${row.price - row.default_price_to_client}\n`,
    );
    expect(row.default_price_to_client).toBe(3_000_000);
  });
});
