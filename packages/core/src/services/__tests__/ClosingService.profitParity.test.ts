/**
 * LIRA-219 — closing's profit === the Profits page's profit for the day.
 *
 * `ClosingService.getDailyStatsSnapshot` no longer computes profit itself
 * (`ClosingRepository.getDailyActivityStats` has zero profit SQL — see its
 * own doc comment). It composes the snapshot from
 * `ProfitService.getSummary(day, day).totals.gross_*`, the ONE definition of
 * gross profit (rule 14) the Profits page's own headline card reads. This
 * file is the guarding spec for that composition (rule 17/24): every case
 * below is a module the OLD `ClosingRepository.getDailyStatsSnapshot` got
 * wrong (per-unit sales formula, no kept change, LBP dropped for every
 * module but loto, no day parameter — see
 * `docs/plans/ongoing_plans/LIRA-219_CLOSING_PROFIT_PARITY.md` §A), each
 * with an EXPLICIT hand-derived expected value AND an equality guard against
 * `getSummary` itself, so a future change to gross-profit arithmetic that
 * accidentally diverges the two surfaces is caught here too.
 *
 * RED EVIDENCE (rule 17): the "HEAD" column below was measured by running
 * the design's probe (`scratchpad/lira219/probe219.test.ts`, one module per
 * fresh DB, rows stamped exactly as each writer stamps them — cited per
 * seeder, reused here verbatim) against the pre-fix
 * `ClosingRepository.getDailyStatsSnapshot()` — 27 tests ran, 27 passed,
 * results written to `scratchpad/lira219/probe_results.txt`. That run IS
 * this file's red evidence: every "HEAD" figure quoted in a comment below is
 * copied from that recorded run, not re-derived or guessed. Re-introducing
 * the deleted profit SQL and re-running this file would reproduce the same
 * red; it is not re-verified interactively in this change because the
 * deletion already landed in the same commit as this file (the design
 * doc records the measurement that justified it).
 *
 * Schema: the REAL `electron-app/create_db.sql`, one fresh in-memory DB per
 * case (never the hand-rolled per-file schemas the old
 * `ClosingRepository.*Gates`/`lira16x*`/`localBusinessDay`/
 * `maintenancePartsProfit`/`cashlessSettlementDefersOnDebt`/
 * `LIRA158.closingCashBasis` test files used) — `ProfitService.getSummary`
 * runs ~20 queries against tables those minimal fixtures never created
 * (`reference_test_schema_completeness`), so only the real schema can run
 * it. This file REPLACES those files' scenarios (rule 24 — "rewrite, not
 * delete"): each gate/scenario they tested against the now-deleted
 * `ClosingRepository` profit SQL becomes one case here, re-derived against
 * the architecture that replaced it, rather than kept pointing at code that
 * no longer exists (there is no meaningful "assert the old path is not
 * taken" form for a method that was renamed and had all its profit SQL
 * removed in the same change).
 */
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { ClosingRepository } from "../../repositories/ClosingRepository.js";
import { ProfitRepository } from "../../repositories/ProfitRepository.js";
import { ProfitService } from "../ProfitService.js";
import { ClosingService } from "../ClosingService.js";
import { runWithTenant } from "../../db/tenantContext.js";

const SCHEMA = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "..", "..", "electron-app", "create_db.sql"),
  "utf-8",
);

type DB = Database.Database;
let db: DB;
let TS = "";
let TODAY = "";

/** Insert a row into `sales` and one `sale_items` row, mirroring
 *  `SalesRepository`'s own columns for the fields this file's cases need. */
function ins(sql: string, ...args: unknown[]): number {
  return Number(db.prepare(sql).run(...args).lastInsertRowid);
}

function fresh(): void {
  db = new Database(":memory:");
  db.exec(SCHEMA);
  db.pragma("foreign_keys = OFF");
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  TS = (
    db
      .prepare(`SELECT datetime(date('now','localtime') || ' 12:00:00', 'utc') AS ts`)
      .get() as { ts: string }
  ).ts;
  TODAY = (db.prepare(`SELECT date('now','localtime') AS d`).get() as { d: string }).d;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db?.close();
});

/** One real `ClosingService`, wired to real repositories against the fresh
 *  in-memory DB — no mocks below the service boundary, so this exercises
 *  the actual composition, not a stand-in for it. */
function snapshot(day: string) {
  return runWithTenant(1, () => {
    const service = new ClosingService(
      new ClosingRepository(),
      new ProfitService(new ProfitRepository()),
    );
    return service.getDailyStatsSnapshot({ day }, { includeProfit: true });
  });
}

function grossSummary(day: string) {
  return runWithTenant(1, () => new ProfitService(new ProfitRepository()).getSummary(day, day));
}

const r = (x: number | undefined) => Math.round(((x ?? 0) as number) * 100) / 100;

/**
 * Assert BOTH halves rule 17 asks for: the explicit hand-derived figure
 * (fails on the pre-fix code — see the file header's RED EVIDENCE note) AND
 * equality against `getSummary` directly (guards future drift between the
 * two surfaces even once both numbers happen to be right).
 */
function expectParity(day: string, expectedUsd: number, expectedLbp: number): void {
  const snap = snapshot(day);
  const summary = grossSummary(day);
  expect(r(snap.totalProfitUSD)).toBe(expectedUsd);
  expect(r(snap.totalProfitLBP)).toBe(expectedLbp);
  expect(r(snap.totalProfitUSD)).toBe(r(summary.totals.gross_profit_usd));
  expect(r(snap.totalProfitLBP)).toBe(r(summary.totals.gross_profit_lbp));
}

describe("LIRA-219 — ClosingService.getDailyStatsSnapshot profit parity", () => {
  beforeEach(fresh);

  // --- Failing-first cases (each was measured WRONG on the pre-fix
  //     ClosingRepository.getDailyStatsSnapshot — see the probe/design
  //     doc's §A table for the exact "Measured closing" figure cited below
  //     as HEAD) ---

  it("sale qty 3, $2 discount — per-unit×qty−discount, not per-unit alone (HEAD: 4/0)", () => {
    // SalesRepository.ts:538/817 — SALE profit_usd = Σ(item margin × qty) − discount
    const s = ins(
      `INSERT INTO sales (tenant_id,total_amount_usd,discount_usd,final_amount_usd,paid_usd,paid_lbp,exchange_rate_snapshot,status,created_at) VALUES (1,30,2,28,28,0,90000,'completed',?)`,
      TS,
    );
    ins(
      `INSERT INTO sale_items (tenant_id,sale_id,product_id,quantity,sold_price_usd,cost_price_snapshot_usd,is_refunded) VALUES (1,?,1,3,10,6,0)`,
      s,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'SALE','ACTIVE','sales',?,1,28,0,?,0,?)`,
      s,
      3 * (10 - 6) - 2,
      TS,
    );
    expectParity(TODAY, 10, 0);
  });

  it("sale + 10,000 LBP kept change — LBP kept change was dropped entirely (HEAD: 2/0)", () => {
    const s = ins(
      `INSERT INTO sales (tenant_id,total_amount_usd,discount_usd,final_amount_usd,paid_usd,paid_lbp,exchange_rate_snapshot,status,created_at) VALUES (1,5,0,5,5,0,90000,'completed',?)`,
      TS,
    );
    ins(
      `INSERT INTO sale_items (tenant_id,sale_id,product_id,quantity,sold_price_usd,cost_price_snapshot_usd,is_refunded) VALUES (1,?,1,1,5,3,0)`,
      s,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'SALE','ACTIVE','sales',?,1,5,0,2,10000,?)`,
      s,
      TS,
    );
    expectParity(TODAY, 2, 10000);
  });

  it("LBP recharge 500,000−450,000 + $1 kept change — LBP slice dropped, kept change dropped (HEAD: 0/0)", () => {
    // RechargeRepository.ts:748/780 — profit_<cur> = price − cost (+ kept change in tender currency)
    const rId = ins(
      `INSERT INTO recharges (tenant_id,carrier,recharge_type,amount,cost,price,currency_code,paid_by,created_at) VALUES (1,'MTC','CREDIT_TRANSFER',5,450000,500000,'LBP','CASH',?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'RECHARGE','ACTIVE','recharges',?,1,0,500000,1,50000,?)`,
      rId,
      TS,
    );
    expectParity(TODAY, 1, 50000);
  });

  it("USD recharge 10−9 + 45,000 LBP kept change (HEAD: 1/0)", () => {
    const rId = ins(
      `INSERT INTO recharges (tenant_id,carrier,recharge_type,amount,cost,price,currency_code,paid_by,created_at) VALUES (1,'MTC','CREDIT_TRANSFER',10,9,10,'USD','CASH',?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'RECHARGE','ACTIVE','recharges',?,1,10,0,1,45000,?)`,
      rId,
      TS,
    );
    expectParity(TODAY, 1, 45000);
  });

  it("FS model-0 LBP (OMT_APP) commission 100,000 — LBP excluded entirely (HEAD: 0/0)", () => {
    const f = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,is_settled,commission_model,created_at) VALUES (1,'OMT_APP','SEND',5000000,'LBP',100000,1,0,?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'FINANCIAL_SERVICE','ACTIVE','financial_services',?,1,0,5000000,0,100000,?)`,
      f,
      TS,
    );
    expectParity(TODAY, 0, 100000);
  });

  it("FS model-1 LBP WHISH SEND, settled today, 150,000 (cashless) — LBP settlement-day commission dropped (HEAD: 0/0)", () => {
    const L = ins(
      `INSERT INTO supplier_ledger (tenant_id,supplier_id,entry_type,amount_usd,amount_lbp,created_at) VALUES (1,2,'SETTLEMENT',0,-9000000,?)`,
      TS,
    );
    const f = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,is_settled,settlement_id,commission_model,created_at) VALUES (1,'WHISH','SEND',9000000,'LBP',0,1,?,1,?)`,
      L,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'FINANCIAL_SERVICE','ACTIVE','financial_services',?,1,0,9000000,0,0,?)`,
      f,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'SUPPLIER_SETTLEMENT','ACTIVE','supplier_ledger',?,1,0,0,0,150000,?)`,
      L,
      TS,
    );
    ins(
      `INSERT INTO settlement_commission_allocations (tenant_id,settlement_ledger_id,financial_service_id,service_type,provider,commission_usd,commission_lbp,created_at) VALUES (1,?,?,'SEND','WHISH',0,150000,?)`,
      L,
      f,
      TS,
    );
    expectParity(TODAY, 0, 150000);
  });

  it("bills-only settlement (Katsh BILL) $1.50 + 20,000 LBP — LBP dropped (HEAD: 1.5/0)", () => {
    const L = ins(
      `INSERT INTO supplier_ledger (tenant_id,supplier_id,entry_type,amount_usd,amount_lbp,created_at) VALUES (1,3,'SETTLEMENT',0,0,?)`,
      TS,
    );
    const f = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,cost,price,is_settled,settlement_id,commission_model,created_at) VALUES (1,'Katsh','BILL',10,'USD',0,10,10,1,?,1,?)`,
      L,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'SUPPLIER_SETTLEMENT','ACTIVE','supplier_ledger',?,1,0,0,1.5,20000,?)`,
      L,
      TS,
    );
    ins(
      `INSERT INTO settlement_commission_allocations (tenant_id,settlement_ledger_id,financial_service_id,service_type,provider,commission_usd,commission_lbp,created_at) VALUES (1,?,?,'BILL','Katsh',1.5,20000,?)`,
      L,
      f,
      TS,
    );
    expectParity(TODAY, 1.5, 20000);
  });

  it("PM fee $0.75 on a Binance row — source not read at all by the old closing (HEAD: 0/0)", () => {
    const f = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,is_settled,commission_model,payment_method_fee,created_at) VALUES (1,'BINANCE','SEND',50,'USD',0,1,0,0.75,?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'FINANCIAL_SERVICE','ACTIVE','financial_services',?,1,50,0,0,0,?)`,
      f,
      TS,
    );
    expectParity(TODAY, 0.75, 0);
  });

  it("mobile service iPick LBP price 500,000 cost 400,000 — LBP dropped (HEAD: 0/0)", () => {
    const f = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,cost,price,is_settled,commission_model,created_at) VALUES (1,'iPick','SEND',500000,'LBP',100000,400000,500000,1,0,?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'FINANCIAL_SERVICE','ACTIVE','financial_services',?,1,0,500000,0,100000,?)`,
      f,
      TS,
    );
    expectParity(TODAY, 0, 100000);
  });

  it("custom service USD 20−12 + $0.50 kept change — kept change dropped (HEAD: 8/0)", () => {
    // CustomServiceRepository.ts:289 — profit = price − cost + kept change
    const c = ins(
      `INSERT INTO custom_services (tenant_id,description,cost_usd,price_usd,status,created_at) VALUES (1,'x',12,20,'completed',?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'CUSTOM_SERVICE','ACTIVE','custom_services',?,1,20,0,8.5,0,?)`,
      c,
      TS,
    );
    expectParity(TODAY, 8.5, 0);
  });

  it("custom service LBP 300,000−100,000 — LBP never read (HEAD: 0/0)", () => {
    const c = ins(
      `INSERT INTO custom_services (tenant_id,description,cost_lbp,price_lbp,status,created_at) VALUES (1,'x',100000,300000,'completed',?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'CUSTOM_SERVICE','ACTIVE','custom_services',?,1,0,300000,0,200000,?)`,
      c,
      TS,
    );
    expectParity(TODAY, 0, 200000);
  });

  it("maintenance LBP job 3,000,000−1,000,000 — LBP never read (HEAD: 0/0)", () => {
    // MaintenanceRepository.ts:504 — profit_usd/lbp = parts margin + labour margin
    const m = ins(
      `INSERT INTO maintenance (tenant_id,device_name,cost_usd,cost_lbp,final_amount_usd,final_amount_lbp,currency,status,created_at) VALUES (1,'d',0,1000000,0,3000000,'LBP','Delivered_Paid',?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'MAINTENANCE','ACTIVE','maintenance',?,1,0,3000000,0,2000000,?)`,
      m,
      TS,
    );
    expectParity(TODAY, 0, 2000000);
  });

  it("loto: 50,000 commission + 5,000 LBP + $1 USD kept change (LO-R10) — USD kept change dropped (HEAD: 0/55,000)", () => {
    // LotoTicketRepository.ts:189 — profit_usd = kept_change_usd; profit_lbp = commission + kept_change_lbp
    const l = ins(
      `INSERT INTO loto_tickets (tenant_id,sale_amount,commission_amount,sale_date,created_at) VALUES (1,1000000,50000,date('now','localtime'),?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'LOTO','ACTIVE','loto_tickets',?,1,0,1000000,1,55000,?)`,
      l,
      TS,
    );
    expectParity(TODAY, 1, 55000);
  });

  it("debt repayment $0.50 kept change — source not read at all (HEAD: 0/0)", () => {
    // DebtRepository.ts:373 — DEBT_REPAYMENT profit = kept change
    const d = ins(
      `INSERT INTO debt_ledger (tenant_id,client_id,transaction_type,amount_usd,amount_lbp,created_at) VALUES (1,1,'Repayment',-20,0,?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'DEBT_REPAYMENT','ACTIVE','debt_ledger',?,1,20,0,0.5,0,?)`,
      d,
      TS,
    );
    expectParity(TODAY, 0.5, 0);
  });

  it("counterparty discount −$3 forgiven — source not read at all (HEAD: 0/0)", () => {
    const d = ins(
      `INSERT INTO debt_ledger (tenant_id,client_id,transaction_type,amount_usd,amount_lbp,created_at) VALUES (1,1,'Repayment',-3,0,?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'COUNTERPARTY_DISCOUNT','ACTIVE','debt_ledger',?,1,0,0,-3,0,?)`,
      d,
      TS,
    );
    expectParity(TODAY, -3, 0);
  });

  it("client Whish top-up LBP fee 50,000 — LBP excluded (HEAD: 0/0)", () => {
    // RechargeRepository.ts:2496/2513 — top-up: cost = cashPaid, price = amount, profit = fee
    const rId = ins(
      `INSERT INTO recharges (tenant_id,carrier,recharge_type,amount,cost,price,currency_code,paid_by,created_at) VALUES (1,'WHISH_APP','TOP_UP',1000000,950000,1000000,'LBP','CLIENT',?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'RECHARGE_TOPUP','ACTIVE','recharges',?,1,0,1000000,0,50000,?)`,
      rId,
      TS,
    );
    expectParity(TODAY, 0, 50000);
  });

  it("credit buyback: $20 credits for $18 cash — old closing over-counted the WHOLE payout as profit (HEAD: 18/0)", () => {
    // RechargeRepository.ts:1490/1528 — buyback: cost 0, price = payout; profit_usd = credits − payoutUsd
    const rId = ins(
      `INSERT INTO recharges (tenant_id,carrier,recharge_type,amount,cost,price,currency_code,paid_by,created_at) VALUES (1,'MTC','CREDIT_BUYBACK',20,0,18,'USD','CASH',?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'TELECOM_CREDIT_BUYBACK','ACTIVE','recharges',?,1,18,0,2,0,?)`,
      rId,
      TS,
    );
    expectParity(TODAY, 2, 0);
  });

  it("credit buyback: $20 credits for 1,620,000 LBP cash — LBP row excluded (HEAD: 0/0)", () => {
    const rId = ins(
      `INSERT INTO recharges (tenant_id,carrier,recharge_type,amount,cost,price,currency_code,paid_by,created_at) VALUES (1,'MTC','CREDIT_BUYBACK',20,0,1620000,'LBP','CASH',?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'TELECOM_CREDIT_BUYBACK','ACTIVE','recharges',?,1,0,1620000,2,0,?)`,
      rId,
      TS,
    );
    expectParity(TODAY, 2, 0);
  });

  it("explicit `day` (rule 27) — a row stamped YESTERDAY at noon local is picked up when day=yesterday", () => {
    // The pre-fix ClosingRepository.getDailyStatsSnapshot() took no argument
    // at all and asked SQLite for DATE('now','localtime') — the SERVER's
    // day, unconditionally. It could never honor an explicit client day, so
    // this case (and hence rule 27 compliance) simply could not be
    // expressed against it: passing any `day` was a silent no-op. The fixed
    // ClosingService takes `input.day` and threads it through
    // `ClosingRepository.getDailyActivityStats(day)` /
    // `ProfitService.getSummary(day, day)` — this proves it is actually
    // honored, not merely accepted and ignored.
    const yesterday = (
      db
        .prepare(`SELECT date('now','localtime','-1 day') AS d`)
        .get() as { d: string }
    ).d;
    const yesterdayTs = (
      db
        .prepare(`SELECT datetime(? || ' 12:00:00', 'utc') AS ts`)
        .get(yesterday) as { ts: string }
    ).ts;
    const s = ins(
      `INSERT INTO sales (tenant_id,total_amount_usd,discount_usd,final_amount_usd,paid_usd,paid_lbp,exchange_rate_snapshot,status,created_at) VALUES (1,5,0,5,5,0,90000,'completed',?)`,
      yesterdayTs,
    );
    ins(
      `INSERT INTO sale_items (tenant_id,sale_id,product_id,quantity,sold_price_usd,cost_price_snapshot_usd,is_refunded) VALUES (1,?,1,1,5,3,0)`,
      s,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'SALE','ACTIVE','sales',?,1,5,0,2,0,?)`,
      s,
      yesterdayTs,
    );

    expectParity(yesterday, 2, 0);
    // TODAY has no rows at all — a day mismatch would show up as $0 here.
    expectParity(TODAY, 0, 0);
  });

  it("ALL modules combined (excl. the out-of-scope partner case, LIRA-173) — HEAD: 79/55,000", () => {
    // Reruns every case above's seeder against ONE fresh DB, matching the
    // design doc's measured combined total exactly (§A "All combined" row,
    // excluding the partner-ticket case which stays out of LIRA-219's
    // scope per E-Q2/LIRA-173).
    const s1 = ins(
      `INSERT INTO sales (tenant_id,total_amount_usd,discount_usd,final_amount_usd,paid_usd,paid_lbp,exchange_rate_snapshot,status,created_at) VALUES (1,30,2,28,28,0,90000,'completed',?)`,
      TS,
    );
    ins(
      `INSERT INTO sale_items (tenant_id,sale_id,product_id,quantity,sold_price_usd,cost_price_snapshot_usd,is_refunded) VALUES (1,?,1,3,10,6,0)`,
      s1,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'SALE','ACTIVE','sales',?,1,28,0,10,0,?)`,
      s1,
      TS,
    );
    const s2 = ins(
      `INSERT INTO sales (tenant_id,total_amount_usd,discount_usd,final_amount_usd,paid_usd,paid_lbp,exchange_rate_snapshot,status,created_at) VALUES (1,5,0,5,5,0,90000,'completed',?)`,
      TS,
    );
    ins(
      `INSERT INTO sale_items (tenant_id,sale_id,product_id,quantity,sold_price_usd,cost_price_snapshot_usd,is_refunded) VALUES (1,?,1,1,5,3,0)`,
      s2,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'SALE','ACTIVE','sales',?,1,5,0,2,10000,?)`,
      s2,
      TS,
    );
    const r1 = ins(
      `INSERT INTO recharges (tenant_id,carrier,recharge_type,amount,cost,price,currency_code,paid_by,created_at) VALUES (1,'MTC','CREDIT_TRANSFER',5,450000,500000,'LBP','CASH',?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'RECHARGE','ACTIVE','recharges',?,1,0,500000,1,50000,?)`,
      r1,
      TS,
    );
    const r2 = ins(
      `INSERT INTO recharges (tenant_id,carrier,recharge_type,amount,cost,price,currency_code,paid_by,created_at) VALUES (1,'MTC','CREDIT_TRANSFER',10,9,10,'USD','CASH',?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'RECHARGE','ACTIVE','recharges',?,1,10,0,1,45000,?)`,
      r2,
      TS,
    );
    const f1 = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,is_settled,commission_model,created_at) VALUES (1,'BINANCE','SEND',100,'USD',2,1,0,?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'FINANCIAL_SERVICE','ACTIVE','financial_services',?,1,100,0,2,0,?)`,
      f1,
      TS,
    );
    const f2 = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,is_settled,commission_model,created_at) VALUES (1,'OMT_APP','SEND',5000000,'LBP',100000,1,0,?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'FINANCIAL_SERVICE','ACTIVE','financial_services',?,1,0,5000000,0,100000,?)`,
      f2,
      TS,
    );
    const L1 = ins(
      `INSERT INTO supplier_ledger (tenant_id,supplier_id,entry_type,amount_usd,amount_lbp,created_at) VALUES (1,1,'SETTLEMENT',-100,0,?)`,
      TS,
    );
    const f3 = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,is_settled,settlement_id,commission_model,created_at) VALUES (1,'OMT','SEND',100,'USD',1.5,1,?,1,?)`,
      L1,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'FINANCIAL_SERVICE','ACTIVE','financial_services',?,1,100,0,0,0,?)`,
      f3,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'SUPPLIER_SETTLEMENT','ACTIVE','supplier_ledger',?,1,0,0,3,0,?)`,
      L1,
      TS,
    );
    ins(
      `INSERT INTO settlement_commission_allocations (tenant_id,settlement_ledger_id,financial_service_id,service_type,provider,commission_usd,commission_lbp,created_at) VALUES (1,?,?,'SEND','OMT',3,0,?)`,
      L1,
      f3,
      TS,
    );
    const L2 = ins(
      `INSERT INTO supplier_ledger (tenant_id,supplier_id,entry_type,amount_usd,amount_lbp,created_at) VALUES (1,2,'SETTLEMENT',0,-9000000,?)`,
      TS,
    );
    const f4 = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,is_settled,settlement_id,commission_model,created_at) VALUES (1,'WHISH','SEND',9000000,'LBP',0,1,?,1,?)`,
      L2,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'FINANCIAL_SERVICE','ACTIVE','financial_services',?,1,0,9000000,0,0,?)`,
      f4,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'SUPPLIER_SETTLEMENT','ACTIVE','supplier_ledger',?,1,0,0,0,150000,?)`,
      L2,
      TS,
    );
    ins(
      `INSERT INTO settlement_commission_allocations (tenant_id,settlement_ledger_id,financial_service_id,service_type,provider,commission_usd,commission_lbp,created_at) VALUES (1,?,?,'SEND','WHISH',0,150000,?)`,
      L2,
      f4,
      TS,
    );
    const L3 = ins(
      `INSERT INTO supplier_ledger (tenant_id,supplier_id,entry_type,amount_usd,amount_lbp,created_at) VALUES (1,3,'SETTLEMENT',0,0,?)`,
      TS,
    );
    const f5 = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,cost,price,is_settled,settlement_id,commission_model,created_at) VALUES (1,'Katsh','BILL',10,'USD',0,10,10,1,?,1,?)`,
      L3,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'FINANCIAL_SERVICE','ACTIVE','financial_services',?,1,10,0,0,0,?)`,
      f5,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'SUPPLIER_SETTLEMENT','ACTIVE','supplier_ledger',?,1,0,0,1.5,20000,?)`,
      L3,
      TS,
    );
    ins(
      `INSERT INTO settlement_commission_allocations (tenant_id,settlement_ledger_id,financial_service_id,service_type,provider,commission_usd,commission_lbp,created_at) VALUES (1,?,?,'BILL','Katsh',1.5,20000,?)`,
      L3,
      f5,
      TS,
    );
    const f6 = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,is_settled,commission_model,payment_method_fee,created_at) VALUES (1,'BINANCE','SEND',50,'USD',0,1,0,0.75,?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'FINANCIAL_SERVICE','ACTIVE','financial_services',?,1,50,0,0,0,?)`,
      f6,
      TS,
    );
    const f7 = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,cost,price,is_settled,commission_model,created_at) VALUES (1,'iPick','SEND',5,'USD',1,4,5,1,0,?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'FINANCIAL_SERVICE','ACTIVE','financial_services',?,1,5,0,1,0,?)`,
      f7,
      TS,
    );
    const f8 = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,cost,price,is_settled,commission_model,created_at) VALUES (1,'iPick','SEND',500000,'LBP',100000,400000,500000,1,0,?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'FINANCIAL_SERVICE','ACTIVE','financial_services',?,1,0,500000,0,100000,?)`,
      f8,
      TS,
    );
    const c1 = ins(
      `INSERT INTO custom_services (tenant_id,description,cost_usd,price_usd,status,created_at) VALUES (1,'x',12,20,'completed',?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'CUSTOM_SERVICE','ACTIVE','custom_services',?,1,20,0,8.5,0,?)`,
      c1,
      TS,
    );
    const c2 = ins(
      `INSERT INTO custom_services (tenant_id,description,cost_lbp,price_lbp,status,created_at) VALUES (1,'x',100000,300000,'completed',?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'CUSTOM_SERVICE','ACTIVE','custom_services',?,1,0,300000,0,200000,?)`,
      c2,
      TS,
    );
    const m1 = ins(
      `INSERT INTO maintenance (tenant_id,device_name,cost_usd,final_amount_usd,currency,status,parts_cost_usd,parts_price_usd,created_at) VALUES (1,'d',20,60,'USD','Delivered_Paid',6,10,?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'MAINTENANCE','ACTIVE','maintenance',?,1,60,0,34,0,?)`,
      m1,
      TS,
    );
    const m2 = ins(
      `INSERT INTO maintenance (tenant_id,device_name,cost_usd,cost_lbp,final_amount_usd,final_amount_lbp,currency,status,created_at) VALUES (1,'d',0,1000000,0,3000000,'LBP','Delivered_Paid',?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'MAINTENANCE','ACTIVE','maintenance',?,1,0,3000000,0,2000000,?)`,
      m2,
      TS,
    );
    const ex = ins(
      `INSERT INTO exchange_transactions (tenant_id,type,from_currency,to_currency,amount_in,amount_out,rate,leg1_profit_usd,created_at) VALUES (1,'BUY','USD','LBP',100,8950000,89500,2.5,?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'EXCHANGE','ACTIVE','exchange_transactions',?,1,100,0,2.5,0,?)`,
      ex,
      TS,
    );
    const l = ins(
      `INSERT INTO loto_tickets (tenant_id,sale_amount,commission_amount,sale_date,created_at) VALUES (1,1000000,50000,date('now','localtime'),?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'LOTO','ACTIVE','loto_tickets',?,1,0,1000000,1,55000,?)`,
      l,
      TS,
    );
    const d1 = ins(
      `INSERT INTO debt_ledger (tenant_id,client_id,transaction_type,amount_usd,amount_lbp,created_at) VALUES (1,1,'Repayment',-20,0,?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'DEBT_REPAYMENT','ACTIVE','debt_ledger',?,1,20,0,0.5,0,?)`,
      d1,
      TS,
    );
    const d2 = ins(
      `INSERT INTO debt_ledger (tenant_id,client_id,transaction_type,amount_usd,amount_lbp,created_at) VALUES (1,1,'Repayment',-3,0,?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'COUNTERPARTY_DISCOUNT','ACTIVE','debt_ledger',?,1,0,0,-3,0,?)`,
      d2,
      TS,
    );
    const t1 = ins(
      `INSERT INTO recharges (tenant_id,carrier,recharge_type,amount,cost,price,currency_code,paid_by,created_at) VALUES (1,'WHISH_APP','TOP_UP',100,98,100,'USD','CLIENT',?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'RECHARGE_TOPUP','ACTIVE','recharges',?,1,100,0,2,0,?)`,
      t1,
      TS,
    );
    const t2 = ins(
      `INSERT INTO recharges (tenant_id,carrier,recharge_type,amount,cost,price,currency_code,paid_by,created_at) VALUES (1,'WHISH_APP','TOP_UP',1000000,950000,1000000,'LBP','CLIENT',?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'RECHARGE_TOPUP','ACTIVE','recharges',?,1,0,1000000,0,50000,?)`,
      t2,
      TS,
    );
    const b1 = ins(
      `INSERT INTO recharges (tenant_id,carrier,recharge_type,amount,cost,price,currency_code,paid_by,created_at) VALUES (1,'MTC','CREDIT_BUYBACK',20,0,18,'USD','CASH',?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'TELECOM_CREDIT_BUYBACK','ACTIVE','recharges',?,1,18,0,2,0,?)`,
      b1,
      TS,
    );
    const b2 = ins(
      `INSERT INTO recharges (tenant_id,carrier,recharge_type,amount,cost,price,currency_code,paid_by,created_at) VALUES (1,'MTC','CREDIT_BUYBACK',20,0,1620000,'LBP','CASH',?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'TELECOM_CREDIT_BUYBACK','ACTIVE','recharges',?,1,0,1620000,2,0,?)`,
      b2,
      TS,
    );
    ins(
      `INSERT INTO expenses (tenant_id,description,amount_usd,amount_lbp,status,expense_date) VALUES (1,'e',5,100000,'active',?)`,
      TS,
    );

    expectParity(TODAY, 71.75, 2780000);
  });

  // --- Gate-parity cases (rule 24 rewrite of the deleted
  //     lira160DebtPendingGates / lira160PartnerPendingGates /
  //     lira161SaleFullyPaidCoupling / lira161ExchangeAndLoto /
  //     moduleProfitGates / cashlessSettlementDefersOnDebt /
  //     LIRA158.closingCashBasis scenarios: each of those files exercised a
  //     gate against the OLD, now-deleted `ClosingRepository` profit SQL.
  //     Since closing now delegates to `ProfitService.getSummary` wholesale,
  //     the gate itself lives in `ProfitRepository` (already covered by that
  //     file's own tests) — what's missing, and what these cases add, is
  //     proof that CLOSING inherits each gate correctly through the
  //     delegation, with an expected value re-derived under the Profits
  //     page's rules (not the deleted closing-local rules). These are NOT
  //     failing-first against a still-live bug (there is no bug left to
  //     revert-and-observe — the deleted SQL cannot be reintroduced without
  //     resurrecting eight files rule 24 asks to retire); they are
  //     regression/parity coverage for the gates named in the LIRA-219
  //     verifier findings, each run against HEAD and its actual output
  //     recorded honestly below. ---

  it("[gate: refund] a same-day SALE fully reversed by its own REFUND nets to 0, not the SALE's raw profit", () => {
    const s = ins(
      `INSERT INTO sales (tenant_id,total_amount_usd,discount_usd,final_amount_usd,paid_usd,paid_lbp,exchange_rate_snapshot,status,created_at) VALUES (1,5,0,5,5,0,90000,'refunded',?)`,
      TS,
    );
    ins(
      `INSERT INTO sale_items (tenant_id,sale_id,product_id,quantity,sold_price_usd,cost_price_snapshot_usd,is_refunded) VALUES (1,?,1,1,5,3,1)`,
      s,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'SALE','ACTIVE','sales',?,1,5,0,2,0,?)`,
      s,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'REFUND','ACTIVE','sales',?,1,-5,0,-2,0,?)`,
      s,
      TS,
    );
    expectParity(TODAY, 0, 0);
  });

  it("[gate: sale tolerance] paid within the $0.05 tolerance still counts as fully paid", () => {
    const s = ins(
      `INSERT INTO sales (tenant_id,total_amount_usd,discount_usd,final_amount_usd,paid_usd,paid_lbp,exchange_rate_snapshot,status,created_at) VALUES (1,10,0,10,9.98,0,90000,'completed',?)`,
      TS,
    );
    ins(
      `INSERT INTO sale_items (tenant_id,sale_id,product_id,quantity,sold_price_usd,cost_price_snapshot_usd,is_refunded) VALUES (1,?,1,1,10,6,0)`,
      s,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'SALE','ACTIVE','sales',?,1,9.98,0,4,0,?)`,
      s,
      TS,
    );
    expectParity(TODAY, 4, 0);
  });

  it("[gate: sale underpaid] paid $2 short of the $0.05 tolerance is NOT recognized (non-partner, non-debt sale)", () => {
    const s = ins(
      `INSERT INTO sales (tenant_id,total_amount_usd,discount_usd,final_amount_usd,paid_usd,paid_lbp,exchange_rate_snapshot,status,created_at) VALUES (1,10,0,10,8,0,90000,'completed',?)`,
      TS,
    );
    ins(
      `INSERT INTO sale_items (tenant_id,sale_id,product_id,quantity,sold_price_usd,cost_price_snapshot_usd,is_refunded) VALUES (1,?,1,1,10,6,0)`,
      s,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'SALE','ACTIVE','sales',?,1,8,0,4,0,?)`,
      s,
      TS,
    );
    expectParity(TODAY, 0, 0);
  });

  it("[gate: debt-pending, uncovered] a recharge charged to CUSTOMER_ACCOUNT with an uncovered 'Recharge Debt' row defers its profit", () => {
    const rId = ins(
      `INSERT INTO recharges (tenant_id,carrier,recharge_type,amount,cost,price,currency_code,paid_by,created_at) VALUES (1,'MTC','CREDIT_TRANSFER',10,9,10,'USD','CUSTOMER_ACCOUNT',?)`,
      TS,
    );
    const t = ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'RECHARGE','ACTIVE','recharges',?,1,10,0,1,0,?)`,
      rId,
      TS,
    );
    ins(
      `INSERT INTO debt_ledger (tenant_id,client_id,transaction_type,amount_usd,amount_lbp,transaction_id,covered_usd,covered_lbp,created_at) VALUES (1,1,'Recharge Debt',10,0,?,0,0,?)`,
      t,
      TS,
    );
    expectParity(TODAY, 0, 0);
  });

  it("[gate: debt-pending, covered] the SAME shape, fully repaid — profit is now recognized", () => {
    const rId = ins(
      `INSERT INTO recharges (tenant_id,carrier,recharge_type,amount,cost,price,currency_code,paid_by,created_at) VALUES (1,'MTC','CREDIT_TRANSFER',10,9,10,'USD','CUSTOMER_ACCOUNT',?)`,
      TS,
    );
    const t = ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'RECHARGE','ACTIVE','recharges',?,1,10,0,1,0,?)`,
      rId,
      TS,
    );
    ins(
      `INSERT INTO debt_ledger (tenant_id,client_id,transaction_type,amount_usd,amount_lbp,transaction_id,covered_usd,covered_lbp,created_at) VALUES (1,1,'Recharge Debt',10,0,?,10,0,?)`,
      t,
      TS,
    );
    expectParity(TODAY, 1, 0);
  });

  // The deleted `lira160DebtPendingGates.test.ts` covered
  // `notDebtPending`/DBT-1 for every module-debt type (Recharge/Service/
  // Custom Service/Maintenance/Loto Debt), keyed generically by
  // `debt_ledger.transaction_id` against the unified transaction row
  // (`ProfitRepository.notDebtPending`, ProfitRepository.ts:574 — ONE
  // predicate, reused verbatim at every module's gross-profit query, rule
  // 14). Recharge Debt is covered above; the four pairs below carry the
  // SAME gate forward for the remaining module-debt types the verifier named
  // as uncovered by ANY surviving profit test in the repo (D1).

  it("[gate: debt-pending, uncovered] a Binance FS SEND charged to CUSTOMER_ACCOUNT with an uncovered 'Service Debt' row defers its commission", () => {
    const f = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,is_settled,commission_model,created_at) VALUES (1,'BINANCE','SEND',100,'USD',2,1,0,?)`,
      TS,
    );
    const t = ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'FINANCIAL_SERVICE','ACTIVE','financial_services',?,1,100,0,2,0,?)`,
      f,
      TS,
    );
    ins(
      `INSERT INTO debt_ledger (tenant_id,client_id,transaction_type,amount_usd,amount_lbp,transaction_id,covered_usd,covered_lbp,created_at) VALUES (1,1,'Service Debt',100,0,?,0,0,?)`,
      t,
      TS,
    );
    expectParity(TODAY, 0, 0);
  });

  it("[gate: debt-pending, covered] the SAME 'Service Debt' shape, fully repaid — commission is now recognized", () => {
    const f = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,is_settled,commission_model,created_at) VALUES (1,'BINANCE','SEND',100,'USD',2,1,0,?)`,
      TS,
    );
    const t = ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'FINANCIAL_SERVICE','ACTIVE','financial_services',?,1,100,0,2,0,?)`,
      f,
      TS,
    );
    ins(
      `INSERT INTO debt_ledger (tenant_id,client_id,transaction_type,amount_usd,amount_lbp,transaction_id,covered_usd,covered_lbp,created_at) VALUES (1,1,'Service Debt',100,0,?,100,0,?)`,
      t,
      TS,
    );
    expectParity(TODAY, 2, 0);
  });

  it("[gate: debt-pending, uncovered] a custom service charged to CUSTOMER_ACCOUNT with an uncovered 'Custom Service Debt' row defers its profit", () => {
    const c = ins(
      `INSERT INTO custom_services (tenant_id,description,cost_usd,price_usd,status,created_at) VALUES (1,'x',12,20,'completed',?)`,
      TS,
    );
    const t = ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'CUSTOM_SERVICE','ACTIVE','custom_services',?,1,20,0,8.5,0,?)`,
      c,
      TS,
    );
    ins(
      `INSERT INTO debt_ledger (tenant_id,client_id,transaction_type,amount_usd,amount_lbp,transaction_id,covered_usd,covered_lbp,created_at) VALUES (1,1,'Custom Service Debt',20,0,?,0,0,?)`,
      t,
      TS,
    );
    expectParity(TODAY, 0, 0);
  });

  it("[gate: debt-pending, covered] the SAME 'Custom Service Debt' shape, fully repaid — profit is now recognized", () => {
    const c = ins(
      `INSERT INTO custom_services (tenant_id,description,cost_usd,price_usd,status,created_at) VALUES (1,'x',12,20,'completed',?)`,
      TS,
    );
    const t = ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'CUSTOM_SERVICE','ACTIVE','custom_services',?,1,20,0,8.5,0,?)`,
      c,
      TS,
    );
    ins(
      `INSERT INTO debt_ledger (tenant_id,client_id,transaction_type,amount_usd,amount_lbp,transaction_id,covered_usd,covered_lbp,created_at) VALUES (1,1,'Custom Service Debt',20,0,?,20,0,?)`,
      t,
      TS,
    );
    expectParity(TODAY, 8.5, 0);
  });

  it("[gate: debt-pending, uncovered] a maintenance job charged to CUSTOMER_ACCOUNT with an uncovered 'Maintenance Debt' row defers its profit", () => {
    const m = ins(
      `INSERT INTO maintenance (tenant_id,device_name,cost_usd,final_amount_usd,currency,status,parts_cost_usd,parts_price_usd,created_at) VALUES (1,'d',20,60,'USD','Delivered_Paid',6,10,?)`,
      TS,
    );
    const t = ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'MAINTENANCE','ACTIVE','maintenance',?,1,60,0,34,0,?)`,
      m,
      TS,
    );
    ins(
      `INSERT INTO debt_ledger (tenant_id,client_id,transaction_type,amount_usd,amount_lbp,transaction_id,covered_usd,covered_lbp,created_at) VALUES (1,1,'Maintenance Debt',60,0,?,0,0,?)`,
      t,
      TS,
    );
    expectParity(TODAY, 0, 0);
  });

  it("[gate: debt-pending, covered] the SAME 'Maintenance Debt' shape, fully repaid — profit is now recognized", () => {
    const m = ins(
      `INSERT INTO maintenance (tenant_id,device_name,cost_usd,final_amount_usd,currency,status,parts_cost_usd,parts_price_usd,created_at) VALUES (1,'d',20,60,'USD','Delivered_Paid',6,10,?)`,
      TS,
    );
    const t = ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'MAINTENANCE','ACTIVE','maintenance',?,1,60,0,34,0,?)`,
      m,
      TS,
    );
    ins(
      `INSERT INTO debt_ledger (tenant_id,client_id,transaction_type,amount_usd,amount_lbp,transaction_id,covered_usd,covered_lbp,created_at) VALUES (1,1,'Maintenance Debt',60,0,?,60,0,?)`,
      t,
      TS,
    );
    expectParity(TODAY, 34, 0);
  });

  it("[gate: debt-pending, uncovered] a loto ticket charged to CUSTOMER_ACCOUNT with an uncovered 'Loto Debt' row defers its commission", () => {
    const l = ins(
      `INSERT INTO loto_tickets (tenant_id,sale_amount,commission_amount,sale_date,created_at) VALUES (1,1000000,50000,date('now','localtime'),?)`,
      TS,
    );
    const t = ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'LOTO','ACTIVE','loto_tickets',?,1,0,1000000,0,50000,?)`,
      l,
      TS,
    );
    ins(
      `INSERT INTO debt_ledger (tenant_id,client_id,transaction_type,amount_usd,amount_lbp,transaction_id,covered_usd,covered_lbp,created_at) VALUES (1,1,'Loto Debt',0,1000000,?,0,0,?)`,
      t,
      TS,
    );
    expectParity(TODAY, 0, 0);
  });

  it("[gate: debt-pending, covered] the SAME 'Loto Debt' shape, fully repaid — commission is now recognized", () => {
    const l = ins(
      `INSERT INTO loto_tickets (tenant_id,sale_amount,commission_amount,sale_date,created_at) VALUES (1,1000000,50000,date('now','localtime'),?)`,
      TS,
    );
    const t = ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'LOTO','ACTIVE','loto_tickets',?,1,0,1000000,0,50000,?)`,
      l,
      TS,
    );
    ins(
      `INSERT INTO debt_ledger (tenant_id,client_id,transaction_type,amount_usd,amount_lbp,transaction_id,covered_usd,covered_lbp,created_at) VALUES (1,1,'Loto Debt',0,1000000,?,0,1000000,?)`,
      t,
      TS,
    );
    expectParity(TODAY, 0, 50000);
  });

  it("[gate: partner proportional, E-Q2] a loto ticket 50% covered by its partner recognizes 50% of commission (design doc #26: 0/25,000)", () => {
    const l = ins(
      `INSERT INTO loto_tickets (tenant_id,sale_amount,commission_amount,sale_date,created_at) VALUES (1,1000000,50000,date('now','localtime'),?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'LOTO','ACTIVE','loto_tickets',?,1,0,1000000,0,50000,?)`,
      l,
      TS,
    );
    ins(
      `INSERT INTO partner_ledger (tenant_id,partner_id,transaction_type,reference_table,reference_id,amount,currency,direction,covered_amount,created_at) VALUES (1,1,'FOR_PARTNER_LOTO','loto_tickets',?,100,'LBP','CREDIT',50,?)`,
      l,
      TS,
    );
    expectParity(TODAY, 0, 25000);
  });

  it("[gate: maintenance not completed] a job still 'Received' contributes no profit yet", () => {
    const m = ins(
      `INSERT INTO maintenance (tenant_id,device_name,cost_usd,final_amount_usd,currency,status,created_at) VALUES (1,'d',6,40,'USD','Received',?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'MAINTENANCE','ACTIVE','maintenance',?,1,40,0,34,0,?)`,
      m,
      TS,
    );
    expectParity(TODAY, 0, 0);
  });

  it("[gate: model-1 unsettled] a model-1 FS row NOT yet settled contributes zero on its own transaction day, EVEN THOUGH the row carries a non-zero creation-time commission estimate", () => {
    // FinancialServiceRepository (:1625-1629/:2159-2167) stamps a model-1
    // row's `commission` column with `calculatedCommission` at CREATION
    // (an ESTIMATE settlement later overrides and never writes back — owner
    // decision D6, no stamp-back) but zeroes the commission TERM of the
    // transaction's own profit_usd/profit_lbp, deferring it whole to the
    // (not-yet-existing) settlement allocation. Seeding `commission = 0`
    // here (the pre-fix version of this case) left nothing for the
    // `fsStampRecognized`/model-1 gate to actually exclude — a regression
    // that zeroed the gate's numerator AND its would-be leak by the same
    // stroke would still read 0/0 and this case would not catch it. Seeding
    // a non-zero estimate (3, matching the writer's shape) while keeping the
    // TRANSACTION stamp at 0 (also matching the writer) proves the gate is
    // actively excluding a real number, not vacuously agreeing with an
    // already-zero one.
    const f = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,is_settled,commission_model,created_at) VALUES (1,'OMT','SEND',100,'USD',3,0,1,?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'FINANCIAL_SERVICE','ACTIVE','financial_services',?,1,100,0,0,0,?)`,
      f,
      TS,
    );
    expectParity(TODAY, 0, 0);
  });

  it("[gate: model-1 settled] the settlement-day commission ACTUALLY ENTERED is recognized, not the stale creation-time estimate", () => {
    // Pairs with the unsettled case above (D2). The row is born with a
    // `commission` estimate of 3 (creation time, never written back — D6).
    // At settlement the operator enters a DIFFERENT, real figure (5) into
    // `settlement_commission_allocations.commission_usd`, and the
    // SUPPLIER_SETTLEMENT transaction is stamped with THAT figure (5), not
    // the stale estimate (3) — matching
    // `SupplierRepository`'s settlement stamp (LIRA-158 D14). Expecting 5,
    // not 3, proves closing reads the settlement-entered figure through the
    // delegation, not a re-summed `financial_services.commission` column.
    const L = ins(
      `INSERT INTO supplier_ledger (tenant_id,supplier_id,entry_type,amount_usd,amount_lbp,created_at) VALUES (1,1,'SETTLEMENT',-100,0,?)`,
      TS,
    );
    const f = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,is_settled,settlement_id,commission_model,created_at) VALUES (1,'OMT','SEND',100,'USD',3,1,?,1,?)`,
      L,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'FINANCIAL_SERVICE','ACTIVE','financial_services',?,1,100,0,0,0,?)`,
      f,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'SUPPLIER_SETTLEMENT','ACTIVE','supplier_ledger',?,1,0,0,5,0,?)`,
      L,
      TS,
    );
    ins(
      `INSERT INTO settlement_commission_allocations (tenant_id,settlement_ledger_id,financial_service_id,service_type,provider,commission_usd,commission_lbp,created_at) VALUES (1,?,?,'SEND','OMT',5,0,?)`,
      L,
      f,
      TS,
    );
    expectParity(TODAY, 5, 0);
  });

  it("[gate: voided settlement] a SUPPLIER_SETTLEMENT fully reversed by its own REFUND nets to 0", () => {
    const L = ins(
      `INSERT INTO supplier_ledger (tenant_id,supplier_id,entry_type,amount_usd,amount_lbp,created_at) VALUES (1,3,'SETTLEMENT',0,0,?)`,
      TS,
    );
    const f = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,cost,price,is_settled,settlement_id,commission_model,created_at) VALUES (1,'Katsh','BILL',10,'USD',0,10,10,1,?,1,?)`,
      L,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'SUPPLIER_SETTLEMENT','ACTIVE','supplier_ledger',?,1,0,0,1.5,20000,?)`,
      L,
      TS,
    );
    ins(
      `INSERT INTO settlement_commission_allocations (tenant_id,settlement_ledger_id,financial_service_id,service_type,provider,commission_usd,commission_lbp,created_at) VALUES (1,?,?,'BILL','Katsh',1.5,20000,?)`,
      L,
      f,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'REFUND','ACTIVE','supplier_ledger',?,1,0,0,-1.5,-20000,?)`,
      L,
      TS,
    );
    expectParity(TODAY, 0, 0);
  });

  it("[gate: D17 cashless-on-debt deferral] a cashless (non-BILL) settlement allocation whose underlying transfer is still CUSTOMER_ACCOUNT-uncovered is deferred, not recognized at settlement", () => {
    const L = ins(
      `INSERT INTO supplier_ledger (tenant_id,supplier_id,entry_type,amount_usd,amount_lbp,created_at) VALUES (1,1,'SETTLEMENT',-100,0,?)`,
      TS,
    );
    const f = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,is_settled,settlement_id,commission_model,created_at) VALUES (1,'OMT','SEND',100,'USD',1.5,1,?,1,?)`,
      L,
      TS,
    );
    const t = ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'FINANCIAL_SERVICE','ACTIVE','financial_services',?,1,100,0,0,0,?)`,
      f,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'SUPPLIER_SETTLEMENT','ACTIVE','supplier_ledger',?,1,0,0,3,0,?)`,
      L,
      TS,
    );
    ins(
      `INSERT INTO settlement_commission_allocations (tenant_id,settlement_ledger_id,financial_service_id,service_type,provider,commission_usd,commission_lbp,created_at) VALUES (1,?,?,'SEND','OMT',3,0,?)`,
      L,
      f,
      TS,
    );
    // The customer who owes for this SEND has not repaid it yet — a
    // 'Service Debt' row on the SAME FINANCIAL_SERVICE transaction, uncovered.
    ins(
      `INSERT INTO debt_ledger (tenant_id,client_id,transaction_type,amount_usd,amount_lbp,transaction_id,covered_usd,covered_lbp,created_at) VALUES (1,1,'Service Debt',100,0,?,0,0,?)`,
      t,
      TS,
    );
    expectParity(TODAY, 0, 0);
  });

  // Refund coverage the deleted closing test files carried for
  // recharge/custom-service/financial-service/maintenance (the SALE refund
  // case near the top of this file already covers sales; these four fill
  // the gap the verifier named). Each module's own `notRefunded` gate keys
  // off the SOURCE row's `is_refunded` flag (ProfitRepository.ts:800,
  // `_markSourceRefunded`), not the presence of a REFUND transaction row —
  // unlike sales, which recognize via SALE+REFUND `transactions` rows
  // together (saleRecognitionWeight). So each case below sets
  // `is_refunded = 1` on the module's own source row while still seeding
  // the original (unreversed) profit-bearing transaction, to prove the
  // module join excludes it on that flag alone.

  it("[gate: refund] a refunded recharge (is_refunded=1 on the source row) contributes 0, even with an unreversed profit-bearing transaction", () => {
    const rId = ins(
      `INSERT INTO recharges (tenant_id,carrier,recharge_type,amount,cost,price,currency_code,paid_by,is_refunded,created_at) VALUES (1,'MTC','CREDIT_TRANSFER',5,450000,500000,'LBP','CASH',1,?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'RECHARGE','ACTIVE','recharges',?,1,0,500000,1,50000,?)`,
      rId,
      TS,
    );
    expectParity(TODAY, 0, 0);
  });

  it("[gate: refund] a refunded custom service (is_refunded=1) contributes 0", () => {
    const c = ins(
      `INSERT INTO custom_services (tenant_id,description,cost_usd,price_usd,status,is_refunded,created_at) VALUES (1,'x',12,20,'completed',1,?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'CUSTOM_SERVICE','ACTIVE','custom_services',?,1,20,0,8.5,0,?)`,
      c,
      TS,
    );
    expectParity(TODAY, 0, 0);
  });

  it("[gate: refund] a refunded financial-service SEND (is_refunded=1) contributes 0", () => {
    const f = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,is_settled,commission_model,is_refunded,created_at) VALUES (1,'BINANCE','SEND',100,'USD',2,1,0,1,?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'FINANCIAL_SERVICE','ACTIVE','financial_services',?,1,100,0,2,0,?)`,
      f,
      TS,
    );
    expectParity(TODAY, 0, 0);
  });

  it("[gate: refund] a refunded maintenance job (is_refunded=1) contributes 0", () => {
    const m = ins(
      `INSERT INTO maintenance (tenant_id,device_name,cost_usd,final_amount_usd,currency,status,parts_cost_usd,parts_price_usd,is_refunded,created_at) VALUES (1,'d',20,60,'USD','Delivered_Paid',6,10,1,?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'MAINTENANCE','ACTIVE','maintenance',?,1,60,0,34,0,?)`,
      m,
      TS,
    );
    expectParity(TODAY, 0, 0);
  });

  it("[gate: bills-only settlement unaffected by uncovered debt] a Katsh BILL batch's commission counts in full even though the underlying charge is an uncovered 'Service Debt' — only CASHLESS (non-BILL) batches gate on debt (D17)", () => {
    // Mirrors the base 'bills-only settlement' case (1.5/20,000), but the
    // FINANCIAL_SERVICE transaction underneath the BILL is ALSO charged to
    // CUSTOMER_ACCOUNT with an uncovered 'Service Debt' row. cashlessCommissionBatch
    // (ProfitRepository.ts:662) is false for an all-BILL settlement, and
    // allocationNotDebtPending is only consulted on the CASHLESS branch
    // (ProfitRepository.ts:3170-3171) — the bills-only branch
    // (ProfitRepository.ts:1250) never applies it. So the settlement figure
    // must be UNCHANGED (1.5/20,000) despite the uncovered debt — proving
    // immunity, not merely absence of a regression.
    const L = ins(
      `INSERT INTO supplier_ledger (tenant_id,supplier_id,entry_type,amount_usd,amount_lbp,created_at) VALUES (1,3,'SETTLEMENT',0,0,?)`,
      TS,
    );
    const f = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,cost,price,is_settled,settlement_id,commission_model,created_at) VALUES (1,'Katsh','BILL',10,'USD',0,10,10,1,?,1,?)`,
      L,
      TS,
    );
    const t = ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'FINANCIAL_SERVICE','ACTIVE','financial_services',?,1,10,0,0,0,?)`,
      f,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'SUPPLIER_SETTLEMENT','ACTIVE','supplier_ledger',?,1,0,0,1.5,20000,?)`,
      L,
      TS,
    );
    ins(
      `INSERT INTO settlement_commission_allocations (tenant_id,settlement_ledger_id,financial_service_id,service_type,provider,commission_usd,commission_lbp,created_at) VALUES (1,?,?,'BILL','Katsh',1.5,20000,?)`,
      L,
      f,
      TS,
    );
    ins(
      `INSERT INTO debt_ledger (tenant_id,client_id,transaction_type,amount_usd,amount_lbp,transaction_id,covered_usd,covered_lbp,created_at) VALUES (1,1,'Service Debt',10,0,?,0,0,?)`,
      t,
      TS,
    );
    expectParity(TODAY, 1.5, 20000);
  });

  it("[gate: mixed-currency fully-paid sale] a USD-priced sale paid partly in USD cash and partly in LBP cash, together covering the full amount, is fully recognized", () => {
    // saleFullyPaid (ProfitRepository.ts:441) combines BOTH tender
    // currencies against the sale's own snapshot rate:
    // `paid_usd + paid_lbp/exchange_rate_snapshot >= final_amount_usd - 0.05`.
    // Every other sale case in this file pays in a single currency; this one
    // pays $5 cash + 450,000 LBP cash against a $10 final amount at a
    // 90,000 snapshot rate (450,000/90,000 = $5, total $10), proving the
    // combined-currency tolerance itself, not just the single-currency path.
    const s = ins(
      `INSERT INTO sales (tenant_id,total_amount_usd,discount_usd,final_amount_usd,paid_usd,paid_lbp,exchange_rate_snapshot,status,created_at) VALUES (1,10,0,10,5,450000,90000,'completed',?)`,
      TS,
    );
    ins(
      `INSERT INTO sale_items (tenant_id,sale_id,product_id,quantity,sold_price_usd,cost_price_snapshot_usd,is_refunded) VALUES (1,?,1,1,10,6,0)`,
      s,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'SALE','ACTIVE','sales',?,1,5,450000,4,0,?)`,
      s,
      TS,
    );
    expectParity(TODAY, 4, 0);
  });

  it("[gate: pending custom service] a custom service still 'pending' (not completed) contributes no profit yet", () => {
    const c = ins(
      `INSERT INTO custom_services (tenant_id,description,cost_usd,price_usd,status,created_at) VALUES (1,'x',12,20,'pending',?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'CUSTOM_SERVICE','ACTIVE','custom_services',?,1,20,0,8.5,0,?)`,
      c,
      TS,
    );
    expectParity(TODAY, 0, 0);
  });

  it("[gate: cross-currency exchange, both legs] a USD→LBP-via-USD cross exchange sums leg1_profit_usd AND leg2_profit_usd, not just one leg", () => {
    // Every other exchange case in this file (including the base #17/
    // 'exchange leg profit $2.50' regression case) is a single-leg direct
    // exchange, where leg1 alone equals the transaction's whole profit_usd.
    // A cross-currency exchange (via_currency set) books TWO legs
    // (ExchangeRepository.ts:286-287/347) and the transaction's own
    // profit_usd is their SUM — this proves closing's delegated figure
    // reflects both legs, not merely a single-leg shape that happens to
    // equal the total.
    const ex = ins(
      `INSERT INTO exchange_transactions (tenant_id,type,from_currency,to_currency,amount_in,amount_out,rate,leg1_rate,leg1_profit_usd,leg2_rate,leg2_profit_usd,via_currency,created_at) VALUES (1,'BUY','EUR','LBP',100,8950000,89500,1.08,1,89500,1.5,'USD',?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'EXCHANGE','ACTIVE','exchange_transactions',?,1,100,0,2.5,0,?)`,
      ex,
      TS,
    );
    expectParity(TODAY, 2.5, 0);
  });

  // --- Equality guards (NOT failing-first — already agree on HEAD; kept as
  //     regression cases per the design doc's §D note. Their protection
  //     comes from the explicit-expected assertion, which a future change to
  //     a ProfitService gross term would break even though the "closing ==
  //     getSummary" half is trivially true once closing delegates). ---

  it("[regression, not failing-first] FS model-0 USD (Binance) commission $2", () => {
    const f = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,is_settled,commission_model,created_at) VALUES (1,'BINANCE','SEND',100,'USD',2,1,0,?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'FINANCIAL_SERVICE','ACTIVE','financial_services',?,1,100,0,2,0,?)`,
      f,
      TS,
    );
    expectParity(TODAY, 2, 0);
  });

  it("[regression, not failing-first] FS model-1 USD OMT SEND, settled today, $3 (cashless)", () => {
    const L = ins(
      `INSERT INTO supplier_ledger (tenant_id,supplier_id,entry_type,amount_usd,amount_lbp,created_at) VALUES (1,1,'SETTLEMENT',-100,0,?)`,
      TS,
    );
    const f = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,is_settled,settlement_id,commission_model,created_at) VALUES (1,'OMT','SEND',100,'USD',1.5,1,?,1,?)`,
      L,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'FINANCIAL_SERVICE','ACTIVE','financial_services',?,1,100,0,0,0,?)`,
      f,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'SUPPLIER_SETTLEMENT','ACTIVE','supplier_ledger',?,1,0,0,3,0,?)`,
      L,
      TS,
    );
    ins(
      `INSERT INTO settlement_commission_allocations (tenant_id,settlement_ledger_id,financial_service_id,service_type,provider,commission_usd,commission_lbp,created_at) VALUES (1,?,?,'SEND','OMT',3,0,?)`,
      L,
      f,
      TS,
    );
    expectParity(TODAY, 3, 0);
  });

  it("[regression, not failing-first] mobile service iPick USD price 5 cost 4", () => {
    const f = ins(
      `INSERT INTO financial_services (tenant_id,provider,service_type,amount,currency,commission,cost,price,is_settled,commission_model,created_at) VALUES (1,'iPick','SEND',5,'USD',1,4,5,1,0,?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'FINANCIAL_SERVICE','ACTIVE','financial_services',?,1,5,0,1,0,?)`,
      f,
      TS,
    );
    expectParity(TODAY, 1, 0);
  });

  it("[regression, not failing-first] maintenance USD job + parts", () => {
    const m = ins(
      `INSERT INTO maintenance (tenant_id,device_name,cost_usd,final_amount_usd,currency,status,parts_cost_usd,parts_price_usd,created_at) VALUES (1,'d',20,60,'USD','Delivered_Paid',6,10,?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'MAINTENANCE','ACTIVE','maintenance',?,1,60,0,34,0,?)`,
      m,
      TS,
    );
    expectParity(TODAY, 34, 0);
  });

  it("[regression, not failing-first] exchange leg profit $2.50", () => {
    const e = ins(
      `INSERT INTO exchange_transactions (tenant_id,type,from_currency,to_currency,amount_in,amount_out,rate,leg1_profit_usd,created_at) VALUES (1,'BUY','USD','LBP',100,8950000,89500,2.5,?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'EXCHANGE','ACTIVE','exchange_transactions',?,1,100,0,2.5,0,?)`,
      e,
      TS,
    );
    expectParity(TODAY, 2.5, 0);
  });

  it("[regression, not failing-first] client Whish top-up USD fee $2", () => {
    const rId = ins(
      `INSERT INTO recharges (tenant_id,carrier,recharge_type,amount,cost,price,currency_code,paid_by,created_at) VALUES (1,'WHISH_APP','TOP_UP',100,98,100,'USD','CLIENT',?)`,
      TS,
    );
    ins(
      `INSERT INTO transactions (tenant_id,type,status,source_table,source_id,user_id,amount_usd,amount_lbp,profit_usd,profit_lbp,created_at) VALUES (1,'RECHARGE_TOPUP','ACTIVE','recharges',?,1,100,0,2,0,?)`,
      rId,
      TS,
    );
    expectParity(TODAY, 2, 0);
  });

  it("[regression, not failing-first, control] expense $5 + 100,000 LBP — activity-stats expenses match Profits page expenses", () => {
    ins(
      `INSERT INTO expenses (tenant_id,description,amount_usd,amount_lbp,status,expense_date) VALUES (1,'e',5,100000,'active',?)`,
      TS,
    );
    const snap = snapshot(TODAY);
    const summary = grossSummary(TODAY);
    expect(r(snap.totalExpensesUSD)).toBe(5);
    expect(r(snap.totalExpensesLBP)).toBe(100000);
    expect(r(snap.totalExpensesUSD)).toBe(r(summary.expenses.total_usd));
    expect(r(snap.totalExpensesLBP)).toBe(r(summary.expenses.total_lbp));
  });

  // --- Structural: the composition itself, independent of any DB fixture ---

  it("structural: delegates to profitService.getSummary(day, day) and returns its gross_* untouched", () => {
    const getSummary = jest.fn().mockReturnValue({
      period: "2026-09-24 to 2026-09-24",
      sales: {},
      financial_services: {},
      mobile_services: {},
      recharges: {},
      custom_services: {},
      maintenance: {},
      loto: {},
      exchange: {},
      debt_repayments: {},
      discounts: {},
      kept_change: {},
      supplier_commission: {},
      topups_buybacks: {},
      expenses: { total_usd: 12.34, total_lbp: 56789, count: 3 },
      totals: {
        gross_revenue_usd: 0,
        gross_revenue_lbp: 0,
        total_cost_usd: 0,
        total_cost_lbp: 0,
        gross_profit_usd: 99.5,
        gross_profit_lbp: 246000,
        net_profit_usd: 0,
        net_profit_lbp: 0,
        lbp_buy_rate: null,
      },
      deferred: {},
    } as unknown as ReturnType<ProfitService["getSummary"]>);
    const mockProfitService = { getSummary } as unknown as ProfitService;
    const mockRepo = {
      getDailyActivityStats: jest.fn().mockReturnValue({
        salesCount: 0,
        totalSalesUSD: 0,
        totalSalesLBP: 0,
        debtPaymentsUSD: 0,
        debtPaymentsLBP: 0,
        totalExpensesUSD: 0,
        totalExpensesLBP: 0,
      }),
    } as unknown as ClosingRepository;

    const service = new ClosingService(
      mockRepo,
      mockProfitService,
    );
    const result = service.getDailyStatsSnapshot(
      { day: "2026-09-24" },
      { includeProfit: true },
    );

    expect(getSummary).toHaveBeenCalledWith("2026-09-24", "2026-09-24");
    expect(result.totalProfitUSD).toBe(99.5);
    expect(result.totalProfitLBP).toBe(246000);
    expect(result.totalExpensesUSD).toBe(12.34);
    expect(result.totalExpensesLBP).toBe(56789);
    expect(result.profitHidden).toBeUndefined();
    expect(result.profitUnavailable).toBeUndefined();
  });

  it("structural: includeProfit defaults to FALSE (fail closed) and sets profitHidden", () => {
    const getSummary = jest.fn();
    const mockProfitService = { getSummary } as unknown as ProfitService;
    const mockRepo = {
      getDailyActivityStats: jest.fn().mockReturnValue({
        salesCount: 1,
        totalSalesUSD: 10,
        totalSalesLBP: 0,
        debtPaymentsUSD: 0,
        debtPaymentsLBP: 0,
        totalExpensesUSD: 2,
        totalExpensesLBP: 0,
      }),
    } as unknown as ClosingRepository;

    const service = new ClosingService(
      mockRepo,
      mockProfitService,
    );
    const result = service.getDailyStatsSnapshot({ day: "2026-09-24" });

    expect(getSummary).not.toHaveBeenCalled();
    expect(result.profitHidden).toBe(true);
    expect(result.totalProfitUSD).toBeUndefined();
    expect(result.totalProfitLBP).toBeUndefined();
    // Activity stats still come through — E-Q6: a gated caller still gets
    // sales/expenses, only profit is withheld.
    expect(result.totalSalesUSD).toBe(10);
    expect(result.totalExpensesUSD).toBe(2);
  });

  it("structural (E-Q7): a getSummary throw sets profitUnavailable, never a silent $0.00", () => {
    const getSummary = jest.fn().mockImplementation(() => {
      throw new Error("boom");
    });
    const mockProfitService = { getSummary } as unknown as ProfitService;
    const mockRepo = {
      getDailyActivityStats: jest.fn().mockReturnValue({
        salesCount: 1,
        totalSalesUSD: 10,
        totalSalesLBP: 0,
        debtPaymentsUSD: 0,
        debtPaymentsLBP: 0,
        totalExpensesUSD: 2,
        totalExpensesLBP: 0,
      }),
    } as unknown as ClosingRepository;

    const service = new ClosingService(
      mockRepo,
      mockProfitService,
    );
    const result = service.getDailyStatsSnapshot(
      { day: "2026-09-24" },
      { includeProfit: true },
    );

    expect(result.profitUnavailable).toBe(true);
    expect(result.totalProfitUSD).toBeUndefined();
    expect(result.totalProfitLBP).toBeUndefined();
    expect(result.profitHidden).toBeUndefined();
    // Activity stats (this repository's own expense figures) still returned.
    expect(result.totalSalesUSD).toBe(10);
    expect(result.totalExpensesUSD).toBe(2);
  });

  it("structural: day resolves from input.day, not the server's bare local day", () => {
    const mockRepo = {
      getDailyActivityStats: jest.fn().mockReturnValue({
        salesCount: 0,
        totalSalesUSD: 0,
        totalSalesLBP: 0,
        debtPaymentsUSD: 0,
        debtPaymentsLBP: 0,
        totalExpensesUSD: 0,
        totalExpensesLBP: 0,
      }),
    } as unknown as ClosingRepository;
    const mockProfitService = {
      getSummary: jest.fn(),
    } as unknown as ProfitService;

    const service = new ClosingService(
      mockRepo,
      mockProfitService,
    );
    const result = service.getDailyStatsSnapshot({ day: "2020-01-15" });

    expect(mockRepo.getDailyActivityStats).toHaveBeenCalledWith("2020-01-15");
    expect(result.profitDay).toBe("2020-01-15");
  });

  it("structural (rule 27, verifier I4): with NO explicit day, the AMBIENT request clientDay reaches both getDailyActivityStats and getSummary — never the server's bare local day", () => {
    // Mirrors ClosingRepository.contextClientDay.test.ts's convention: pin
    // clientDay far from whatever day this suite actually runs on, so a
    // service that accidentally fell back to the server's own localDay()
    // instead of the request's clientDay() cannot pass by coincidence.
    const CLIENT_DAY = "2031-07-04";
    const mockRepo = {
      getDailyActivityStats: jest.fn().mockReturnValue({
        salesCount: 0,
        totalSalesUSD: 0,
        totalSalesLBP: 0,
        debtPaymentsUSD: 0,
        debtPaymentsLBP: 0,
        totalExpensesUSD: 0,
        totalExpensesLBP: 0,
      }),
    } as unknown as ClosingRepository;
    const getSummary = jest.fn().mockReturnValue({
      totals: { gross_profit_usd: 0, gross_profit_lbp: 0 },
      expenses: { total_usd: 0, total_lbp: 0 },
    } as unknown as ReturnType<ProfitService["getSummary"]>);
    const mockProfitService = { getSummary } as unknown as ProfitService;

    const service = new ClosingService(mockRepo, mockProfitService);
    const result = runWithTenant(
      1,
      () => service.getDailyStatsSnapshot(undefined, { includeProfit: true }),
      { clientDay: CLIENT_DAY },
    );

    expect(mockRepo.getDailyActivityStats).toHaveBeenCalledWith(CLIENT_DAY);
    expect(getSummary).toHaveBeenCalledWith(CLIENT_DAY, CLIENT_DAY);
    expect(result.profitDay).toBe(CLIENT_DAY);
  });
});
