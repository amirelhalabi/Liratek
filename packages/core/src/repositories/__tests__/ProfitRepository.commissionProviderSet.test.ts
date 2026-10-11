/**
 * COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 3, LIRA-108 residual — "provider
 * set of the Commission row", decided under owner decision D11
 * (2026-08-08): "Commission" means money a SUPPLIER grants the shop
 * (OMT/Whish/wallets + bill commission from settlement). An iPick/Katsh/BOB
 * card margin (price − cost) is PROFIT and lives under Mobile Services only.
 * Each figure gets exactly ONE home on the Profits page.
 *
 * What this file measures (rule 28 — run, don't argue), on the REAL schema
 * (`create_db.sql` + `runMigrations`) and the REAL writer
 * (`FinancialServiceRepository.createTransaction`):
 *
 *   1. A cost/price iPick sale is born `commission_model = 0`,
 *      `is_settled = 1`, with its margin stored in `financial_services
 *      .commission` — i.e. it satisfies every gate of
 *      `getRealizedCommissionTotals` EXCEPT a provider filter.
 *   2. That margin's one home is Mobile Services
 *      (`getMobileServicesByCurrency`).
 *   3. The Overview's commission bucket (`getFinancialSettledByCurrency`) and
 *      the By-Payment-Method "Commission (Settled)" row (sourced from the same
 *      query since LIRA-185 lead 6) do NOT count it.
 *   4. `getRealizedCommissionTotals` — the last commission total that was
 *      still unfiltered by provider — must not count it either. This is the
 *      rule-17 guard: it failed on the pre-fix code (iPick's 2.00 + BOB's
 *      3.00 were summed into total_usd next to the legacy OMT 1.50 control
 *      row, 6.50 instead of 1.50) and passes once the method adopts
 *      `provider IN (COMMISSION_PROVIDERS)`.
 *
 * `getRealizedCommissionTotals` has had NO production caller since LIRA-185
 * lead 6 (ProfitService.getByPaymentMethod moved to
 * getFinancialSettledByCurrency; FinancialRepository.getMonthlyPL was
 * deleted), so aligning it changes no figure any screen shows — it removes
 * the last divergent definition of "realized commission" (rule 14).
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
import {
  FinancialServiceRepository,
  resetFinancialServiceRepository,
} from "../FinancialServiceRepository";
import { ProfitRepository, resetProfitRepository } from "../ProfitRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { ProfitService } from "../../services/ProfitService";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");

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

interface FsRowShape {
  provider: string;
  commission: number;
  commission_model: number;
  is_settled: number;
}

describe("Profits 'Commission' provider set — D11 (one home per figure)", () => {
  let db: Database.Database;
  let day: string;
  let F: string;
  let T: string;

  /**
   * Legacy (pre-cutover) OMT row, settled, 1.50 commission — the control.
   *
   * `created_at` is seeded as UTC (`datetime('now')`) because that is how
   * every real writer stores it (`requestNow()` / `CURRENT_TIMESTAMP`), and
   * `dateRange` shifts the stored value to the operator's local day before
   * comparing. Seeding `datetime('now','localtime')` double-shifted it: after
   * 21:00 Beirut (UTC+3; the test script pins TZ=Asia/Beirut) the row read
   * as tomorrow and fell outside today's window, so this file failed every
   * evening only.
   */
  function seedLegacyOmtSettled(): void {
    const fsId = db
      .prepare(
        `INSERT INTO financial_services
           (tenant_id, provider, service_type, amount, currency, commission,
            cost, price, is_settled, commission_model, created_at)
         VALUES (1, 'OMT', 'SEND', 100, 'USD', 1.5, 0, 0, 1, 0, datetime('now'))`,
      )
      .run().lastInsertRowid as number;
    db.prepare(
      `INSERT INTO transactions
         (tenant_id, type, status, source_table, source_id, user_id,
          amount_usd, profit_usd, created_at)
       VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 1, 100, 1.5, datetime('now'))`,
    ).run(fsId);
  }

  beforeEach(() => {
    resetFinancialServiceRepository();
    resetProfitRepository();
    resetTransactionRepository();
    resetSupplierRepository();
    db = buildDb();
    initFixedTenantContext(1);
    day = localToday(db);
    F = `${day} 00:00:00`;
    T = `${day} 23:59:59`;

    const fsRepo = new FinancialServiceRepository();
    // iPick card sale: price 10, cost 8 → margin 2.
    fsRepo.createTransaction({
      provider: "iPick",
      serviceType: "SEND",
      amount: 10,
      currency: "USD",
      commission: 0,
      cost: 8,
      price: 10,
      paidByMethod: "CASH",
    });
    // BOB cost/price sale: price 13, cost 10 → margin 3.
    fsRepo.createTransaction({
      provider: "BOB",
      serviceType: "SEND",
      amount: 13,
      currency: "USD",
      commission: 0,
      cost: 10,
      price: 13,
      paidByMethod: "CASH",
    });
    seedLegacyOmtSettled();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("the cost/price rows are born legacy (model 0), settled, with the margin in `commission`", () => {
    const rows = db
      .prepare(
        `SELECT provider, commission, commission_model, is_settled
         FROM financial_services WHERE provider IN ('iPick', 'BOB') ORDER BY provider`,
      )
      .all() as FsRowShape[];
    expect(rows).toEqual([
      { provider: "BOB", commission: 3, commission_model: 0, is_settled: 1 },
      { provider: "iPick", commission: 2, commission_model: 0, is_settled: 1 },
    ]);
  });

  it("Mobile Services is the margins' one home (iPick 2 + BOB 3 = 5)", () => {
    const repo = new ProfitRepository();
    const usd = repo
      .getMobileServicesByCurrency(F, T)
      .find((r) => r.currency === "USD");
    expect(usd?.profit).toBeCloseTo(5, 2);
  });

  it("the Overview commission bucket counts only the supplier commission (1.50)", () => {
    const repo = new ProfitRepository();
    const usd = repo
      .getFinancialSettledByCurrency(F, T)
      .find((r) => r.currency === "USD");
    expect(usd?.commission).toBeCloseTo(1.5, 2);
    expect(usd?.count).toBe(1);
  });

  it("By Payment Method 'Commission (Settled)' counts only the supplier commission (1.50)", () => {
    const service = new ProfitService(new ProfitRepository());
    const row = service
      .getByPaymentMethod(day, day)
      .find((r) => r.method === "Commission (Settled)");
    expect(row?.total_usd).toBeCloseTo(1.5, 2);
    expect(row?.count).toBe(1);
  });

  it("getRealizedCommissionTotals counts only COMMISSION_PROVIDERS rows — no card margin (rule-17 guard)", () => {
    const repo = new ProfitRepository();
    const r = repo.getRealizedCommissionTotals(F, T);
    expect(r.total_usd).toBeCloseTo(1.5, 2);
    expect(r.count).toBe(1);
  });
});
