/**
 * LIRA-384 A — a settlement commission entered in a currency the batch has
 * no rows in used to vanish from Profits: `_bookCommissionAtSettlement`
 * splits each currency over that currency's rows only, so a USD commission
 * on an all-LBP batch (or the reverse) wrote 0 into every
 * `settlement_commission_allocations` row while `supplier_settlements` and
 * the supplier credit still carried the full figure.
 *
 * Rule (LIRA-384): such a commission is spread over EVERY row of the batch
 * (equal split), because the shape is a real flow — Katsh bills are booked
 * in USD and paid commission in LBP. Invariant for every batch: Σ
 * allocations per currency = the entered commission in that currency.
 *
 * Real production schema (create_db.sql + migrations), real writers.
 * Rule 17: the cross-currency cases were run red against the unfixed
 * repository (allocations summed to 0) before the fix — see the report.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { SupplierRepository } from "../SupplierRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetSettingsService } from "../../services/SettingsService";
import { resetSettingsRepository } from "../SettingsRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import {
  getProfitRepository,
  resetProfitRepository,
} from "../ProfitRepository";
import { ProfitService } from "../../services/ProfitService";
import {
  buildDb,
  fundDrawer,
  omtAccount,
  resetAll,
  seedLedgerRow,
  seedOmtSend,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";

let db: Database.Database;
let repo: SupplierRepository;
let acc: OmtAccount;

beforeEach(() => {
  resetAll();
  resetTransactionRepository();
  resetSettingsService();
  resetSettingsRepository();
  resetPaymentMethodRepository();
  resetProfitRepository();
  db = buildDb();
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  repo = new SupplierRepository();
  acc = omtAccount(db);
  for (const d of ["OMT_System", "General"]) {
    fundDrawer(db, d, "USD", 100_000);
    fundDrawer(db, d, "LBP", 1_000_000_000);
  }
});

afterEach(() => {
  resetTenantContext();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

const cash = (currency_code: "USD" | "LBP", amount: number) => ({
  method: "CASH",
  currency_code,
  amount,
});

function allocationSums(): { usd: number; lbp: number } {
  return db
    .prepare(
      `SELECT COALESCE(SUM(commission_usd), 0) AS usd,
              COALESCE(SUM(commission_lbp), 0) AS lbp
         FROM settlement_commission_allocations WHERE tenant_id = 1`,
    )
    .get() as { usd: number; lbp: number };
}

/** Settle `ids` paying gross − commission per currency in cash. */
function settle(
  ids: number[],
  gross: { usd: number; lbp: number },
  commission: { usd: number; lbp: number },
) {
  const amount_usd = Math.max(0, gross.usd - commission.usd);
  const amount_lbp = Math.max(0, gross.lbp - commission.lbp);
  return repo.settleTransactions({
    supplier_id: acc.omtId,
    financial_service_ids: ids,
    amount_usd,
    amount_lbp,
    commission_usd: commission.usd,
    commission_lbp: commission.lbp,
    created_by: 1,
    payments: [
      ...(amount_usd > 0 ? [cash("USD", amount_usd)] : []),
      ...(amount_lbp > 0 ? [cash("LBP", amount_lbp)] : []),
    ],
  });
}

/** Profit as Summary, By Module and By Date each count it (all dates). */
function profitViews() {
  const svc = new ProfitService();
  const from = "2000-01-01";
  const to = "2100-01-01";
  const sum = (rows: Array<{ profit_usd: number; profit_lbp: number }>) => ({
    usd: Math.round(rows.reduce((x, r) => x + r.profit_usd, 0) * 100) / 100,
    lbp: Math.round(rows.reduce((x, r) => x + r.profit_lbp, 0)),
  });
  const s = svc.getSummary(from, to);
  const totals = getProfitRepository().getSupplierCommissionTotals(
    `${from} 00:00:00`,
    `${to} 23:59:59`,
  );
  return {
    commissionTotals: {
      usd: Math.round(totals.profit_usd * 100) / 100,
      lbp: Math.round(totals.profit_lbp),
    },
    summary: {
      usd: Math.round(s.totals.gross_profit_usd * 100) / 100,
      lbp: Math.round(s.totals.gross_profit_lbp),
    },
    byModule: sum(svc.getByModule(from, to)),
    byDate: sum(svc.getByDate(from, to)),
  };
}

/** Allocation share per financial_services id, both currencies. */
function shares(): Map<number, { usd: number; lbp: number }> {
  const rows = db
    .prepare(
      `SELECT financial_service_id AS id, commission_usd AS usd, commission_lbp AS lbp
         FROM settlement_commission_allocations WHERE tenant_id = 1`,
    )
    .all() as Array<{ id: number; usd: number; lbp: number }>;
  return new Map(rows.map((r) => [r.id, { usd: r.usd, lbp: r.lbp }]));
}

describe("LIRA-384 — commission in a currency the batch has no rows in", () => {
  it("a USD commission on an all-LBP batch is spread over every row", () => {
    const a = seedOmtSend(db, acc.omtId, {
      amount: 1_000_000,
      currency: "LBP",
    });
    const b = seedOmtSend(db, acc.omtId, { amount: 500_000, currency: "LBP" });
    settle([a, b], { usd: 0, lbp: 1_500_000 }, { usd: 2, lbp: 0 });
    expect(allocationSums()).toEqual({ usd: 2, lbp: 0 });
    expect(shares().get(a)).toEqual({ usd: 1, lbp: 0 });
    expect(shares().get(b)).toEqual({ usd: 1, lbp: 0 });
    // Profits counts the $2 once, in every view (it read 0 before).
    const v = profitViews();
    expect(v.summary).toEqual({ usd: 2, lbp: 0 });
    expect(v.byModule).toEqual({ usd: 2, lbp: 0 });
    expect(v.byDate).toEqual({ usd: 2, lbp: 0 });
    expect(v.commissionTotals).toEqual({ usd: 2, lbp: 0 });
  });

  it("an LBP commission on an all-USD batch is spread over every row", () => {
    const a = seedOmtSend(db, acc.omtId, { amount: 100, currency: "USD" });
    const b = seedOmtSend(db, acc.omtId, { amount: 40, currency: "USD" });
    const c = seedOmtSend(db, acc.omtId, { amount: 10, currency: "USD" });
    settle([a, b, c], { usd: 150, lbp: 0 }, { usd: 0, lbp: 50_000 });
    expect(allocationSums()).toEqual({ usd: 0, lbp: 50_000 });
    const lbp = [a, b, c].map((id) => shares().get(id)!.lbp);
    expect(lbp.reduce((x, y) => x + y, 0)).toBe(50_000);
    expect(Math.max(...lbp) - Math.min(...lbp)).toBeLessThanOrEqual(1);
  });

  it("Katsh: USD bills with an LBP RATE commission (the real flow)", () => {
    const katsh = (
      db
        .prepare(
          `SELECT id FROM suppliers WHERE tenant_id = 1 AND provider = 'Katsh'`,
        )
        .get() as { id: number }
    ).id;
    const ids = [1, 2].map(() =>
      Number(
        db
          .prepare(
            `INSERT INTO financial_services
               (tenant_id, provider, service_type, amount, currency, commission,
                commission_model, is_settled, created_by)
             VALUES (1, 'Katsh', 'BILL', 20, 'USD', 0, 1, 0, 1)`,
          )
          .run().lastInsertRowid,
      ),
    );
    repo.settleTransactions({
      supplier_id: katsh,
      financial_service_ids: ids,
      amount_usd: 0,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 40_000,
      entry_mode: "RATE",
      commission_rate: 20_000,
      commission_unit_count: 2,
      created_by: 1,
    });
    expect(allocationSums()).toEqual({ usd: 0, lbp: 40_000 });
    // A bills-only batch is counted from the settlement's own stamp; the
    // allocations now carrying the 40,000 must not count it a second time.
    const v = profitViews();
    expect(v.summary).toEqual({ usd: 0, lbp: 40_000 });
    expect(v.byModule).toEqual({ usd: 0, lbp: 40_000 });
    expect(v.byDate).toEqual({ usd: 0, lbp: 40_000 });
    expect(v.commissionTotals).toEqual({ usd: 0, lbp: 40_000 });
  });

  it("the whole-row account settle books the same spread", () => {
    // An LBP transfer plus a USD account row on the same member: the USD
    // commission has no USD transfer to sit on, so it goes on the LBP one.
    const a = seedOmtSend(db, acc.omtId, {
      amount: 1_000_000,
      currency: "LBP",
    });
    const l = seedLedgerRow(db, acc.omtId, {
      entry_type: "TOP_UP",
      amount_usd: 50,
    });
    repo.settleAccount({
      account_supplier_id: acc.omtId,
      direction: "PAY",
      selections: [
        { kind: "FINANCIAL_SERVICE", id: a },
        { kind: "LEDGER", id: l },
      ],
      amount_usd: 48,
      amount_lbp: 1_000_000,
      commission_usd: 2,
      commission_lbp: 0,
      created_by: 1,
      payments: [cash("USD", 48), cash("LBP", 1_000_000)],
    });
    expect(shares().get(a)).toEqual({ usd: 2, lbp: 0 });
  });
});

describe("LIRA-384 — the account sheet follows the same rule", () => {
  function owed() {
    const q = repo.getAccountUnsettled(acc.omtId);
    return {
      usd: q.reduce((x, r) => x + r.remaining_usd, 0),
      lbp: q.reduce((x, r) => x + r.remaining_lbp, 0),
    };
  }

  it("a USD commission with only LBP transfers closing goes on those transfers", () => {
    const a = seedOmtSend(db, acc.omtId, { amount: 600_000, currency: "LBP" });
    const b = seedOmtSend(db, acc.omtId, { amount: 300_000, currency: "LBP" });
    repo.settleAccount({
      account_supplier_id: acc.omtId,
      per_currency: {
        LBP: { direction: "PAY", payments: [cash("LBP", 900_000)] },
        USD: { direction: "PAY", payments: [], commission: 2 },
      },
      expected_owed: owed(),
      created_by: 1,
    });
    expect(allocationSums()).toEqual({ usd: 2, lbp: 0 });
    expect(shares().get(a)).toEqual({ usd: 1, lbp: 0 });
    expect(shares().get(b)).toEqual({ usd: 1, lbp: 0 });
  });

  it("still refused when no transfer closes in either currency", () => {
    seedOmtSend(db, acc.omtId, { amount: 600_000, currency: "LBP" });
    expect(() =>
      repo.settleAccount({
        account_supplier_id: acc.omtId,
        per_currency: {
          LBP: { direction: "PAY", payments: [cash("LBP", 100_000)] },
          USD: { direction: "PAY", payments: [], commission: 2 },
        },
        expected_owed: owed(),
        created_by: 1,
      }),
    ).toThrow(/Commission can only be entered/);
  });
});

describe("LIRA-384 — Σ allocations = entered commission, per currency", () => {
  const cases: Array<{
    name: string;
    rows: Array<{ amount: number; currency: "USD" | "LBP" }>;
    commission: { usd: number; lbp: number };
  }> = [
    {
      name: "USD rows, USD commission",
      rows: [
        { amount: 100, currency: "USD" },
        { amount: 33, currency: "USD" },
      ],
      commission: { usd: 1.37, lbp: 0 },
    },
    {
      name: "LBP rows, LBP commission",
      rows: [
        { amount: 1_000_000, currency: "LBP" },
        { amount: 700_000, currency: "LBP" },
        { amount: 300_000, currency: "LBP" },
      ],
      commission: { usd: 0, lbp: 100_001 },
    },
    {
      name: "mixed rows, both commissions",
      rows: [
        { amount: 100, currency: "USD" },
        { amount: 2_000_000, currency: "LBP" },
      ],
      commission: { usd: 2, lbp: 30_000 },
    },
  ];

  it.each(cases)("$name", ({ rows, commission }) => {
    const ids = rows.map((r) =>
      seedOmtSend(db, acc.omtId, { amount: r.amount, currency: r.currency }),
    );
    const gross = {
      usd: rows
        .filter((r) => r.currency === "USD")
        .reduce((s, r) => s + r.amount, 0),
      lbp: rows
        .filter((r) => r.currency === "LBP")
        .reduce((s, r) => s + r.amount, 0),
    };
    settle(ids, gross, commission);
    const sums = allocationSums();
    expect(sums.usd).toBeCloseTo(commission.usd, 2);
    expect(sums.lbp).toBeCloseTo(commission.lbp, 0);
    const header = db
      .prepare(
        `SELECT commission_usd AS usd, commission_lbp AS lbp FROM supplier_settlements WHERE tenant_id = 1`,
      )
      .get() as { usd: number; lbp: number };
    expect(header.usd).toBeCloseTo(sums.usd, 2);
    expect(header.lbp).toBeCloseTo(sums.lbp, 0);
  });

  it("zero-gross LBP bills with an LBP commission (equal-split fallback)", () => {
    const ids = [1, 2, 3].map(() =>
      Number(
        db
          .prepare(
            `INSERT INTO financial_services
               (tenant_id, provider, service_type, amount, currency, commission,
                commission_model, is_settled, created_by)
             VALUES (1, 'Katsh', 'BILL', 0, 'LBP', 0, 1, 0, 1)`,
          )
          .run().lastInsertRowid,
      ),
    );
    const katsh = (
      db
        .prepare(
          `SELECT id FROM suppliers WHERE tenant_id = 1 AND provider = 'Katsh'`,
        )
        .get() as { id: number }
    ).id;
    repo.settleTransactions({
      supplier_id: katsh,
      financial_service_ids: ids,
      amount_usd: 0,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 60_001,
      created_by: 1,
    });
    expect(allocationSums()).toEqual({ usd: 0, lbp: 60_001 });
  });
});
