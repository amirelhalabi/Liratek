/**
 * LIRA-185 — profit-surface audit, module `financial_services` (OMT / Whish /
 * OMT App / Whish App / Binance / iPick-Katsh-BOB rows of
 * `financial_services`). Verification-by-execution pass over the 12 leads the
 * September audit agent returned (its verification phase died, so these were
 * leads, not findings).
 *
 * HARNESS: the REAL production schema (`electron-app/create_db.sql` +
 * `runMigrations`, same pattern as `db/__tests__/tenantSplit.test.ts`) in an
 * in-memory better-sqlite3 DB, and the module's REAL writers
 * (`FinancialServiceRepository.createTransaction`,
 * `SupplierRepository.settleTransactions`). Every surface is then read
 * through its real reader (`ProfitService.getSummary/getByDate/getByModule/
 * getByPaymentMethod`, `ProfitRepository.getSupplierCommissionTotals/
 * getDeferredProfit`, `ClosingService.getDailyStatsSnapshot`,
 * `CommissionsReportService.getReport`, `FinancialServiceRepository
 * .getAnalytics/getHistory`).
 *
 * THREE KINDS OF TEST IN THIS FILE — read the describe-block names:
 *   - "CONFIRMED (guard, expected to FAIL until fixed)": rule-17 failing-first
 *     guards. They assert the CORRECT value and fail on current main. They
 *     are left failing on purpose — the fix is a later ticket.
 *   - "ALREADY_FIXED (passing proof)": the lead was true on the tree the
 *     audit read; the numbers below are what the surfaces return today and
 *     they agree.
 *   - "frontend-only leads": the wrong number lives only in a React render
 *     (Services history table, Whish/OMT App payment sheet), which core jest
 *     can't render; the BACKEND half is executed here and passes.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext";
import {
  FinancialServiceRepository,
  resetFinancialServiceRepository,
} from "../FinancialServiceRepository";
import { ProfitRepository, resetProfitRepository } from "../ProfitRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import {
  SupplierRepository,
  resetSupplierRepository,
} from "../SupplierRepository";
import { resetClosingRepository } from "../ClosingRepository";
import { ProfitService } from "../../services/ProfitService";
import { ClosingService } from "../../services/ClosingService";
import { CommissionsReportService } from "../../services/CommissionsReportService";
import {
  OMT_COMMISSION_RATES,
  INTRA_FEE_TIERS,
  WESTERN_UNION_FEE_TIERS,
} from "../../utils/omtFees";
import { WHISH_FEE_TIERS } from "../../utils/whishFees";

// packages/core/src/repositories/__tests__ -> repo root is 5 levels up.
const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");
const SERVICES_PAGE_PATH = path.join(
  REPO_ROOT,
  "frontend/src/features/services/pages/Services/index.tsx",
);

/** OMT system supplier id in the create_db.sql seed (iPick=1, Katsh=2, OMT=3). */
const OMT_SUPPLIER_ID = 3;

function buildDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  return db;
}

function localToday(db: Database.Database): string {
  return (
    db.prepare("SELECT date('now','localtime') AS d").get() as { d: string }
  ).d;
}

function addPartner(db: Database.Database, name = "Audit Partner"): number {
  return db
    .prepare("INSERT INTO partners (tenant_id, name) VALUES (1, ?)")
    .run(name).lastInsertRowid as number;
}

describe("LIRA-185 profit audit — financial_services", () => {
  let db: Database.Database;
  let day: string;
  let F: string;
  let T: string;

  beforeEach(() => {
    resetFinancialServiceRepository();
    resetProfitRepository();
    resetTransactionRepository();
    resetSupplierRepository();
    resetClosingRepository();
    db = buildDb();
    initFixedTenantContext(1);
    day = localToday(db);
    F = `${day} 00:00:00`;
    T = `${day} 23:59:59`;
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("CONFIRMED (guard, expected to FAIL until fixed)", () => {
    /**
     * Lead 12 — a cashless settlement commission on a FOR-partner row the
     * partner has not paid yet is stamped on the SUPPLIER_SETTLEMENT txn but
     * appears in neither the realized nor the deferred Profits bucket.
     *
     * Owner rule (PARTNER_PROPORTIONAL_RECOGNITION.md, 2026-09-05): the
     * partner-unpaid share is withheld from realized profit and shown as
     * DEFERRED. Realized = 12 × coverage(0) = 0 is correct; deferred must
     * then carry the withheld 12 × (1 − 0) = 12. Today it reads 0.
     */
    it("lead 12: the withheld share of a cashless partner-uncovered settlement commission is reported as deferred", () => {
      const repo = new FinancialServiceRepository();
      const pid = addPartner(db);
      const send = repo.createTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 500,
        currency: "USD",
        commission: 0,
        omtServiceType: "INTRA",
        omtFee: 10,
        paidByMethod: "CASH",
        exchangeRate: 90000,
        partnerId: pid,
        partnerMode: "FOR",
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 510, direction: "OUT" },
        ],
      });
      const settle = new SupplierRepository().settleTransactions({
        supplier_id: OMT_SUPPLIER_ID,
        financial_service_ids: [send.id],
        amount_usd: 0,
        amount_lbp: 0,
        commission_usd: 12,
        commission_lbp: 0,
        created_by: 1,
      });

      // The settlement row itself stamps the $12 (SupplierRepository).
      const stamp = db
        .prepare(
          `SELECT profit_usd FROM transactions
           WHERE type = 'SUPPLIER_SETTLEMENT' AND source_table = 'supplier_ledger' AND source_id = ?`,
        )
        .get(settle.id) as { profit_usd: number };
      expect(stamp.profit_usd).toBe(12);

      const pr = new ProfitRepository();
      // Realized: 0 — correct (partner has paid nothing).
      expect(pr.getSupplierCommissionTotals(F, T).profit_usd).toBe(0);

      // Deferred: must carry the withheld $12 (any deferred bucket).
      const def = pr.getDeferredProfit(F, T);
      expect(def.partner_profit_usd + def.client_debt_profit_usd).toBeCloseTo(
        12,
        2,
      );
    });

    /**
     * Lead 6 — two "Commission" figures for the same FS row on one Profits
     * page. Overview `financial_services.commission_usd` reads the
     * transaction STAMP (commission + kept change); By-Payment-Method
     * "Commission (Settled)" reads the raw `fs.commission` column (no kept
     * change). Rule 14: one concept, one definition — the two must agree.
     * (Value-agnostic: asserts parity, not which definition wins.)
     */
    it("lead 6: By-Payment-Method 'Commission (Settled)' equals the Overview financial-services commission (kept change included)", () => {
      const repo = new FinancialServiceRepository();
      repo.createTransaction({
        provider: "WHISH_APP",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 1,
        cashoutMethod: "CASH",
        exchangeRate: 90000,
        kept_change_usd: 0.25,
      });
      const svc = new ProfitService();
      const overview = svc.getSummary(day, day).financial_services;
      expect(overview.commission_usd).toBeCloseTo(1.25, 2);

      const commissionRow = svc
        .getByPaymentMethod(day, day)
        .find((r) => r.method === "Commission (Settled)");
      expect(commissionRow?.total_usd ?? 0).toBeCloseTo(
        overview.commission_usd,
        2,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("ALREADY_FIXED (passing proof)", () => {
    // Lead 2 — Commissions tab mixed LBP into USD at 1:1. The tab now reads
    // CommissionsReportService (9ed8d90f, lane LC), per-currency.
    it("lead 2: Commissions report keeps USD and LBP commission apart", () => {
      const repo = new FinancialServiceRepository();
      repo.createTransaction({ provider: "WHISH_APP", serviceType: "RECEIVE", amount: 9_000_000, currency: "LBP", commission: 90_000, cashoutMethod: "CASH", exchangeRate: 90000 });
      repo.createTransaction({ provider: "WHISH_APP", serviceType: "RECEIVE", amount: 200, currency: "USD", commission: 2, cashoutMethod: "CASH", exchangeRate: 90000 });
      const rep = new CommissionsReportService().getReport(day, day);
      expect(rep.realized_usd).toBe(2);
      expect(rep.realized_lbp).toBe(90_000);
      const sum = new ProfitService().getSummary(day, day).financial_services;
      expect(sum.commission_usd).toBe(2);
      expect(sum.commission_lbp).toBe(90_000);
    });

    // Lead 3 — closing dropped every LBP FS commission. Closing now reads
    // ProfitService.getSummary (LIRA-219, 9ed8d90f).
    it("lead 3: daily closing snapshot carries LBP FS commission, equal to Profits", () => {
      const repo = new FinancialServiceRepository();
      repo.createTransaction({ provider: "WHISH_APP", serviceType: "RECEIVE", amount: 9_000_000, currency: "LBP", commission: 90_000, cashoutMethod: "CASH", exchangeRate: 90000 });
      const snap = new ClosingService().getDailyStatsSnapshot({ day }, { includeProfit: true });
      const sum = new ProfitService().getSummary(day, day);
      expect(sum.totals.gross_profit_lbp).toBe(90_000);
      expect(snap.totalProfitLBP).toBe(90_000);
      expect(snap.totalProfitUSD).toBe(sum.totals.gross_profit_usd);
    });

    // Lead 4 — closing gated a partly-covered partner row all-or-nothing.
    it("lead 4: partly-covered for-partner commission is proportional on BOTH Profits and closing", () => {
      const repo = new FinancialServiceRepository();
      const pid = addPartner(db);
      repo.createTransaction({ provider: "WHISH_APP", serviceType: "RECEIVE", amount: 200, currency: "USD", commission: 10, cashoutMethod: "CASH", exchangeRate: 90000, partnerId: pid, partnerMode: "FOR" });
      db.prepare("UPDATE partner_ledger SET covered_amount = amount * 0.6").run();
      const sum = new ProfitService().getSummary(day, day);
      const snap = new ClosingService().getDailyStatsSnapshot({ day }, { includeProfit: true });
      expect(sum.financial_services.commission_usd).toBeCloseTo(6, 2);
      expect(snap.totalProfitUSD).toBeCloseTo(6, 2);
    });

    // Lead 5 — Overview counted unsettled model-1 revenue, By-Date did not.
    // Both now recognise a model-1 row at creation (PA-0.1 fsStampRecognized)
    // and PA-3.6 split pending revenue out.
    it("lead 5: a model-1 OMT SEND's revenue is the same on Overview and By-Date", () => {
      const repo = new FinancialServiceRepository();
      repo.createTransaction({ provider: "OMT", serviceType: "SEND", amount: 200, currency: "USD", commission: 0, omtServiceType: "INTRA", omtFee: 3, paidByMethod: "CASH", exchangeRate: 90000 });
      const svc = new ProfitService();
      const overview = svc.getSummary(day, day).financial_services;
      const byDate = svc.getByDate(day, day).find((r) => r.date === day);
      expect(overview.revenue_usd).toBe(200);
      expect(byDate?.revenue_usd).toBe(200);
      expect(overview.commission_usd).toBe(0);
      expect(byDate?.profit_usd).toBe(0);
    });

    // Lead 7 — By-Module margin divided USD columns only (0% for LBP-only).
    // Server-computed margin_pct (PA-4.21) now handles it.
    it("lead 7: an LBP-only Whish App row's By-Module margin is 1%, not 0%", () => {
      const repo = new FinancialServiceRepository();
      repo.createTransaction({ provider: "WHISH_APP", serviceType: "RECEIVE", amount: 4_500_000, currency: "LBP", commission: 45_000, cashoutMethod: "CASH", exchangeRate: 90000 });
      const row = new ProfitService().getByModule(day, day).find((r) => r.module === "FINANCIAL_SERVICE_WHISH_APP");
      expect(row?.revenue_lbp).toBe(4_500_000);
      expect(row?.profit_lbp).toBe(45_000);
      expect(row?.margin_pct).toBeCloseTo(1, 4);
    });

    // Lead 8 — getAnalytics bucketed "today" by the UTC date. Now uses
    // isToday()/isThisMonth() (LIRA-237, 8cf9361d). Run with a Beirut client
    // offset (+180) so the result doesn't depend on this runner's TZ.
    it("lead 8: a 00:01-local (previous UTC day) row is counted in getAnalytics 'today'", () => {
      const repo = new FinancialServiceRepository();
      const { id } = repo.createTransaction({ provider: "WHISH_APP", serviceType: "RECEIVE", amount: 500, currency: "USD", commission: 5, cashoutMethod: "CASH", exchangeRate: 90000 });
      const OFFSET_MIN = 180;
      const localMs = Date.now() + OFFSET_MIN * 60_000;
      const localDayStartMs = Math.floor(localMs / 86_400_000) * 86_400_000;
      const createdUtc = new Date(localDayStartMs - OFFSET_MIN * 60_000 + 60_000)
        .toISOString()
        .replace("T", " ")
        .slice(0, 19);
      db.prepare("UPDATE financial_services SET created_at = ? WHERE id = ?").run(createdUtc, id);
      db.prepare("UPDATE transactions SET created_at = ? WHERE source_table = 'financial_services' AND source_id = ?").run(createdUtc, id);

      // The stored UTC date really is "yesterday" relative to the local day —
      // the exact shape the lead described.
      const utcDate = createdUtc.slice(0, 10);
      const localDate = new Date(localMs).toISOString().slice(0, 10);
      expect(utcDate).not.toBe(localDate);

      const a = runWithTenant(1, () => new FinancialServiceRepository().getAnalytics(["WHISH_APP"]), { clientTzOffsetMinutes: OFFSET_MIN });
      expect(a.today.count).toBe(1);
      expect(a.today.commission).toBe(5);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("frontend-only leads — backend half executed", () => {
    // Lead 1 — Services history Profit cell prints `$${tx.commission.toFixed(4)}`
    // (frontend). Backend facts the cell is fed: LBP row, model 1, unsettled
    // estimate 5,000 LBP, while the stamp/Profits/closing book 0.
    it("lead 1: getHistory hands the table an LBP model-1 ESTIMATE that every money surface books as 0", () => {
      const repo = new FinancialServiceRepository();
      repo.createTransaction({ provider: "OMT", serviceType: "SEND", amount: 3_000_000, currency: "LBP", commission: 0, omtServiceType: "INTRA", omtFee: 50_000, paidByMethod: "CASH", exchangeRate: 90000 });
      const h = repo.getHistory("OMT")[0] as unknown as { commission: number; commission_model: number; currency: string; is_settled: number };
      expect(h).toMatchObject({ commission: 5000, commission_model: 1, currency: "LBP", is_settled: 0 });
      const t = db.prepare("SELECT profit_usd, profit_lbp FROM transactions WHERE type = 'FINANCIAL_SERVICE'").get() as { profit_usd: number; profit_lbp: number };
      expect(t).toEqual({ profit_usd: 0, profit_lbp: 0 });
      const sum = new ProfitService().getSummary(day, day);
      expect(sum.financial_services.commission_lbp).toBe(0);
      const snap = new ClosingService().getDailyStatsSnapshot({ day }, { includeProfit: true });
      expect(snap.totalProfitLBP).toBe(0);
    });

    // Lead 9 — the Whish/OMT App payment sheet shows gross "Shop Profit"
    // while the discounted commission is what's submitted and stamped.
    it("lead 9: the stamp books the post-discount commission (1.00 fee − 0.40 discount = 0.60)", () => {
      const repo = new FinancialServiceRepository();
      // The form submits commission = max(0, shopProfit − discount).
      repo.createTransaction({ provider: "WHISH_APP", serviceType: "RECEIVE", amount: 100, currency: "USD", commission: Math.max(0, 1.0 - 0.4), cashoutMethod: "CASH", exchangeRate: 90000 });
      const t = db.prepare("SELECT profit_usd FROM transactions WHERE type = 'FINANCIAL_SERVICE'").get() as { profit_usd: number };
      expect(t.profit_usd).toBeCloseTo(0.6, 4);
      expect(new ProfitService().getSummary(day, day).financial_services.commission_usd).toBeCloseTo(0.6, 4);
    });

    // Lead 11 — the Services page hand-copies OMT/Whish rate and fee tables.
    // Executed parity check of the copies against core: equal today (drift
    // channel only, no live wrong number).
    it("lead 11: the Services page's copied OMT/Whish tables still equal core's", () => {
      const src = fs.readFileSync(SERVICES_PAGE_PATH, "utf-8");
      const block = (name: string): string => {
        const m = src.match(new RegExp(`const ${name}[^=]*=\\s*([\\[{][\\s\\S]*?[\\]}]);`));
        if (!m) throw new Error(`${name} not found in Services page`);
        return m[1];
      };
      const tiers = (name: string) =>
        Array.from(block(name).matchAll(/maxAmount:\s*([\d_]+),\s*fee:\s*([\d.]+)/g)).map((m) => ({
          maxAmount: Number(m[1].replace(/_/g, "")),
          fee: Number(m[2]),
        }));
      const strip = (arr: Array<{ maxAmount: number; fee: number }>) => arr.map(({ maxAmount, fee }) => ({ maxAmount, fee }));
      expect(tiers("INTRA_FEE_TIERS")).toEqual(strip(INTRA_FEE_TIERS));
      expect(tiers("WESTERN_UNION_FEE_TIERS")).toEqual(strip(WESTERN_UNION_FEE_TIERS));
      expect(tiers("WHISH_FEE_TIERS")).toEqual(strip(WHISH_FEE_TIERS));
      const rates = Object.fromEntries(
        Array.from(block("OMT_COMMISSION_RATES").matchAll(/([A-Z_]+):\s*([\d.]+)/g)).map((m) => [m[1], Number(m[2])]),
      );
      for (const [k, v] of Object.entries(rates)) {
        expect([k, OMT_COMMISSION_RATES[k as keyof typeof OMT_COMMISSION_RATES]]).toEqual([k, v]);
      }
      // The copy omits these two — harmless only while the preview excludes them.
      expect(Object.keys(rates).sort()).toEqual(
        Object.keys(OMT_COMMISSION_RATES).filter((k) => k !== "OMT_WALLET" && k !== "ONLINE_BROKERAGE").sort(),
      );
    });
  });
});
