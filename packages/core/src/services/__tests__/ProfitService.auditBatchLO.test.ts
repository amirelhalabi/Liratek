/**
 * OWNER_NOTES_2026-09-21.md §6 — Lane LO (Overview + By Module + By Date),
 * SERVICE-layer assembly items. Uses a lightweight FAKE ProfitRepository /
 * RateRepository (not a real SQLite fixture) — ProfitService's own header
 * comment states its job is "assembly, per-currency aggregation, currency-
 * splitting and business decisions", never SQL, so the fake exercises
 * exactly that assembly logic in isolation, matching the pattern rule 13
 * calls for (a mocked repo, unit-testable service).
 *
 * RULE 17 — every case below was run once against the pre-fix ProfitService
 * (`npx jest ProfitService.auditBatchLO --maxWorkers=1` from packages/core)
 * and failed with the message quoted in its own comment; re-run after the
 * implementation, all passed.
 */

import { ProfitService } from "../ProfitService";
import type {
  ProfitRepository,
  FinCurrencyRow,
  MobileCurrencyRow,
  RechargeCurrencyRow,
  CustomTotalsRow,
  MaintTotalsRow,
  LotoTotalsRow,
  PmFeeCurrencyRow,
  ExchangeTotalsRow,
  ExpenseTotalsRow,
  DeferredProfitRow,
  FinByProviderRow,
  RechargeByCarrierRow,
  SupplierCommissionTotalsRow,
  TopupBuybackProfitRow,
  SalesRevCostRow,
  SalesProfitRow,
  PendingSaleProfitRow,
  FsWaitingForRepaymentRow,
} from "../../repositories/ProfitRepository";

type FakeOverrides = Partial<{
  [K in keyof ProfitRepository]: ProfitRepository[K];
}>;

function emptyRow<T extends Record<string, number>>(shape: T): T {
  const zeroed = {} as T;
  for (const k of Object.keys(shape) as (keyof T)[]) {
    zeroed[k] = 0 as T[keyof T];
  }
  return zeroed;
}

/** A repo double returning all-zero/empty results, overridable per test. */
function makeFakeRepo(overrides: FakeOverrides = {}): ProfitRepository {
  const zeroSalesRevCost: SalesRevCostRow = {
    revenue_usd: 0,
    cost_usd: 0,
    count: 0,
  };
  const zeroSalesProfit: SalesProfitRow = { profit_usd: 0, profit_lbp: 0 };
  const zeroCustom: CustomTotalsRow = emptyRow({
    revenue_usd: 0,
    revenue_lbp: 0,
    cost_usd: 0,
    cost_lbp: 0,
    profit_usd: 0,
    profit_lbp: 0,
    count: 0,
  });
  const zeroMaint: MaintTotalsRow = emptyRow({
    revenue_usd: 0,
    revenue_lbp: 0,
    cost_usd: 0,
    cost_lbp: 0,
    profit_usd: 0,
    profit_lbp: 0,
    count: 0,
    parts_revenue_usd: 0,
    parts_cost_usd: 0,
  });
  const zeroLoto: LotoTotalsRow = emptyRow({
    revenue_lbp: 0,
    profit_lbp: 0,
    kept_change_usd: 0,
    count: 0,
  });
  const zeroExchange: ExchangeTotalsRow = emptyRow({
    revenue_usd: 0,
    profit_usd: 0,
    count: 0,
  });
  const zeroExpense: ExpenseTotalsRow = emptyRow({
    total_usd: 0,
    total_lbp: 0,
    count: 0,
  });
  const zeroDebtRepay = { profit_usd: 0, profit_lbp: 0, count: 0 };
  const zeroDiscount = { profit_usd: 0, profit_lbp: 0, count: 0 };
  const zeroSupplierCommission: SupplierCommissionTotalsRow = {
    profit_usd: 0,
    profit_lbp: 0,
    count: 0,
    bills_only_profit_usd: 0,
    bills_only_profit_lbp: 0,
    bills_only_count: 0,
    cashless_profit_usd: 0,
    cashless_profit_lbp: 0,
    cashless_count: 0,
  };
  const zeroTopupBuyback: TopupBuybackProfitRow = {
    profit_usd: 0,
    profit_lbp: 0,
    count: 0,
  };
  const zeroDeferred: DeferredProfitRow = {
    partner_profit_usd: 0,
    partner_profit_lbp: 0,
    client_debt_profit_usd: 0,
    client_debt_profit_lbp: 0,
    cashless_deferred_profit_usd: 0,
    cashless_deferred_profit_lbp: 0,
  };

  const base: Partial<ProfitRepository> = {
    getSalesRevCost: () => zeroSalesRevCost,
    getSalesProfit: () => zeroSalesProfit,
    getFinancialSettledByCurrency: (): FinCurrencyRow[] => [],
    getFinancialPendingByCurrency: (): FinCurrencyRow[] => [],
    // Owner decision (h), 2026-09-24 — the "waiting for repayment" line's
    // own repository query. Defaulted to empty here so every PRE-EXISTING
    // test in this file (none of which seed it) is unaffected; tests that
    // need a non-empty bucket override it explicitly (rule 24 — never a
    // hand-typed payload where the schema/type already exists).
    getFinancialWaitingForRepaymentByCurrency: (): FsWaitingForRepaymentRow[] =>
      [],
    getPendingCommissionTotals: () => ({
      total_usd: 0,
      total_lbp: 0,
      count: 0,
      awaiting_settlement_count: 0,
    }),
    getPmFeeTotals: (): PmFeeCurrencyRow[] => [],
    getMobileServicesByCurrency: (): MobileCurrencyRow[] => [],
    getRechargesByCurrency: (): RechargeCurrencyRow[] => [],
    getCustomServicesTotals: () => zeroCustom,
    getMaintenanceTotals: () => zeroMaint,
    getLotoTotals: () => zeroLoto,
    getExchangeTotals: () => zeroExchange,
    getDebtRepaymentProfit: () => zeroDebtRepay,
    getCounterpartyDiscountTotals: () => zeroDiscount,
    getSupplierCommissionTotals: () => zeroSupplierCommission,
    getTopupBuybackProfit: () => zeroTopupBuyback,
    getExpenseTotals: () => zeroExpense,
    getDeferredProfit: () => zeroDeferred,
    getPendingSaleProfit: (): PendingSaleProfitRow[] => [],
    getFinancialSettledByProvider: (): FinByProviderRow[] => [],
    getRechargesByCarrier: (): RechargeByCarrierRow[] => [],
    getByDate: () => [],
  };

  return { ...base, ...overrides } as ProfitRepository;
}

const FAKE_RATE_REPO = { findByCode: () => null } as never;

describe("PA-1.4 (FS part, Overview) — stop lumping non-USD/LBP currency into USD", () => {
  it("getSummary: a EUR row from getFinancialSettledByCurrency contributes to neither revenue_usd nor commission_usd", () => {
    // OBSERVED RED (pre-fix): financial_services.revenue_usd toBe(0)
    // received 40 — the old `else` branch treated "not LBP" as USD.
    const repo = makeFakeRepo({
      getFinancialSettledByCurrency: (): FinCurrencyRow[] => [
        {
          currency: "EUR",
          revenue: 40,
          commission: 4,
          count: 1,
          kept_change_usd: 0,
          kept_change_lbp: 0,
        },
      ],
    });
    const service = new ProfitService(repo, FAKE_RATE_REPO);
    const summary = service.getSummary("2026-01-01", "2026-01-01");
    expect(summary.financial_services.revenue_usd).toBe(0);
    expect(summary.financial_services.revenue_lbp).toBe(0);
    expect(summary.financial_services.commission_usd).toBe(0);
    expect(summary.financial_services.commission_lbp).toBe(0);
  });

  it("getSummary: a genuine USD row is unaffected", () => {
    const repo = makeFakeRepo({
      getFinancialSettledByCurrency: (): FinCurrencyRow[] => [
        {
          currency: "USD",
          revenue: 40,
          commission: 4,
          count: 1,
          kept_change_usd: 0,
          kept_change_lbp: 0,
        },
      ],
    });
    const service = new ProfitService(repo, FAKE_RATE_REPO);
    const summary = service.getSummary("2026-01-01", "2026-01-01");
    expect(summary.financial_services.revenue_usd).toBe(40);
    expect(summary.financial_services.commission_usd).toBe(4);
  });
});

describe("PA-3.6 — pending FS revenue no longer inflates gross Total Revenue", () => {
  it("getSummary: pending revenue lands in pending_revenue_usd, NOT in gross_revenue_usd", () => {
    // OBSERVED RED (pre-fix): totals.gross_revenue_usd toBe(0) received 100 —
    // pending (unsettled) FS revenue was folded straight into
    // finSvc.revenue_usd, which feeds gross_revenue_usd, while its
    // commission was correctly excluded from gross profit.
    const repo = makeFakeRepo({
      getFinancialPendingByCurrency: (): FinCurrencyRow[] => [
        { currency: "USD", revenue: 100, commission: 5, count: 1 },
      ],
    });
    const service = new ProfitService(repo, FAKE_RATE_REPO);
    const summary = service.getSummary("2026-01-01", "2026-01-01");
    expect(summary.financial_services.pending_revenue_usd).toBe(100);
    expect(summary.financial_services.pending_commission_usd).toBe(5);
    expect(summary.totals.gross_revenue_usd).toBe(0);
  });
});

describe("PA-3.1 (Overview/By Module) — sales kept change in LBP reaches net", () => {
  it("getSummary: sales.profit_lbp is wired from getSalesProfit and folded into gross_profit_lbp", () => {
    // OBSERVED RED (pre-fix): summary.sales had no profit_lbp field, and
    // totals.gross_profit_lbp toBe(90000) received 0 — grossProfitLbp had no
    // sales term at all.
    const repo = makeFakeRepo({
      getSalesProfit: () => ({ profit_usd: 2, profit_lbp: 90000 }),
    });
    const service = new ProfitService(repo, FAKE_RATE_REPO);
    const summary = service.getSummary("2026-01-01", "2026-01-01");
    expect(summary.sales.profit_lbp).toBe(90000);
    expect(summary.totals.gross_profit_lbp).toBe(90000);
  });

  it("getByModule: the SALE row's profit_lbp is populated, not hard-coded 0", () => {
    const repo = makeFakeRepo({
      getSalesRevCost: () => ({ revenue_usd: 6, cost_usd: 4, count: 1 }),
      getSalesProfit: () => ({ profit_usd: 2, profit_lbp: 90000 }),
    });
    const service = new ProfitService(repo, FAKE_RATE_REPO);
    const rows = service.getByModule("2026-01-01", "2026-01-01");
    const sale = rows.find((r) => r.module === "SALE");
    expect(sale?.profit_lbp).toBe(90000);
  });
});

describe("PA-2.1 — By Module gains kept change, discounts, bills-only supplier commission", () => {
  it("getByModule: adds a kept-change row when getDebtRepaymentProfit has nonzero profit", () => {
    // OBSERVED RED (pre-fix): rows.find(kept change) toBeDefined() failed —
    // getByModule never called getDebtRepaymentProfit at all.
    const repo = makeFakeRepo({
      getDebtRepaymentProfit: () => ({ profit_usd: 3, profit_lbp: 0, count: 1 }),
    });
    const service = new ProfitService(repo, FAKE_RATE_REPO);
    const rows = service.getByModule("2026-01-01", "2026-01-01");
    const keptChange = rows.find((r) => r.module === "KEPT_CHANGE");
    expect(keptChange).toBeDefined();
    expect(keptChange?.profit_usd).toBe(3);
  });

  it("getByModule: adds a discounts row when getCounterpartyDiscountTotals has nonzero profit", () => {
    const repo = makeFakeRepo({
      getCounterpartyDiscountTotals: () => ({
        profit_usd: -4,
        profit_lbp: 0,
        count: 1,
      }),
    });
    const service = new ProfitService(repo, FAKE_RATE_REPO);
    const rows = service.getByModule("2026-01-01", "2026-01-01");
    const discounts = rows.find((r) => r.module === "COUNTERPARTY_DISCOUNT");
    expect(discounts).toBeDefined();
    expect(discounts?.profit_usd).toBe(-4);
  });

  it("getByModule: adds a bills-only supplier-commission row (NOT the combined figure, which would double-count the cashless share already under the provider rows)", () => {
    const repo = makeFakeRepo({
      getSupplierCommissionTotals: () => ({
        profit_usd: 10, // combined (5 bills + 5 cashless)
        profit_lbp: 0,
        count: 2,
        bills_only_profit_usd: 5,
        bills_only_profit_lbp: 0,
        bills_only_count: 1,
        cashless_profit_usd: 5,
        cashless_profit_lbp: 0,
        cashless_count: 1,
      }),
    });
    const service = new ProfitService(repo, FAKE_RATE_REPO);
    const rows = service.getByModule("2026-01-01", "2026-01-01");
    const supplierCommission = rows.find(
      (r) => r.module === "SUPPLIER_COMMISSION",
    );
    expect(supplierCommission?.profit_usd).toBe(5);
  });
});

describe("PA-2.3 — top-ups / buybacks reach the Overview totals and a By Module row", () => {
  it("getSummary: getTopupBuybackProfit's profit is exposed as its own block and folded into gross profit", () => {
    // OBSERVED RED (pre-fix): summary.topups_buybacks did not exist —
    // TypeError reading .profit_usd of undefined.
    const repo = makeFakeRepo({
      getTopupBuybackProfit: () => ({ profit_usd: 4, profit_lbp: 0, count: 2 }),
    });
    const service = new ProfitService(repo, FAKE_RATE_REPO);
    const summary = service.getSummary("2026-01-01", "2026-01-01");
    expect(summary.topups_buybacks.profit_usd).toBe(4);
    expect(summary.totals.gross_profit_usd).toBe(4);
  });

  it("getByModule: adds a TOPUP_BUYBACK row", () => {
    const repo = makeFakeRepo({
      getTopupBuybackProfit: () => ({ profit_usd: 4, profit_lbp: 0, count: 2 }),
    });
    const service = new ProfitService(repo, FAKE_RATE_REPO);
    const rows = service.getByModule("2026-01-01", "2026-01-01");
    const row = rows.find((r) => r.module === "TOPUP_BUYBACK");
    expect(row?.profit_usd).toBe(4);
    expect(row?.count).toBe(2);
  });
});

describe("PA-2.4 — cashless settlement commission is exposed on the Financial Services block", () => {
  it("getSummary: financial_services.commission_at_settlement_usd carries the cashless share", () => {
    // OBSERVED RED (pre-fix): financial_services had no
    // commission_at_settlement_usd field at all.
    const repo = makeFakeRepo({
      getSupplierCommissionTotals: () => ({
        profit_usd: 8,
        profit_lbp: 0,
        count: 2,
        bills_only_profit_usd: 3,
        bills_only_profit_lbp: 0,
        bills_only_count: 1,
        cashless_profit_usd: 5,
        cashless_profit_lbp: 0,
        cashless_count: 1,
      }),
    });
    const service = new ProfitService(repo, FAKE_RATE_REPO);
    const summary = service.getSummary("2026-01-01", "2026-01-01");
    expect(summary.financial_services.commission_at_settlement_usd).toBe(5);
  });
});

describe("PA-3.11 — unpaid sales reach the Overview's deferred visibility block", () => {
  it("getSummary: deferred.unpaid_sales_outstanding_usd/potential_profit sum getPendingSaleProfit's rows", () => {
    // OBSERVED RED (pre-fix): deferred had no unpaid_sales_* fields.
    const repo = makeFakeRepo({
      getPendingSaleProfit: (): PendingSaleProfitRow[] => [
        {
          sale_id: 1,
          created_at: "2026-01-01",
          client_name: "A",
          client_phone: "",
          total_amount_usd: 10,
          paid_usd: 4,
          outstanding_usd: 6,
          potential_profit_usd: 2,
          items_summary: "",
        },
        {
          sale_id: 2,
          created_at: "2026-01-01",
          client_name: "B",
          client_phone: "",
          total_amount_usd: 20,
          paid_usd: 15,
          outstanding_usd: 5,
          potential_profit_usd: 1,
          items_summary: "",
        },
      ],
    });
    const service = new ProfitService(repo, FAKE_RATE_REPO);
    const summary = service.getSummary("2026-01-01", "2026-01-01");
    expect(summary.deferred.unpaid_sales_outstanding_usd).toBe(11);
    expect(summary.deferred.unpaid_sales_potential_profit_usd).toBe(3);
  });
});

describe("PA-4.16 — getByModule / getByDate rethrow instead of swallowing to []", () => {
  it("getByModule: a repository error propagates (is NOT swallowed to an empty array)", () => {
    // OBSERVED RED (pre-fix): expect(() => ...).toThrow() failed — the old
    // catch block logged and returned [].
    const repo = makeFakeRepo({
      getSalesRevCost: () => {
        throw new Error("boom");
      },
    });
    const service = new ProfitService(repo, FAKE_RATE_REPO);
    expect(() => service.getByModule("2026-01-01", "2026-01-01")).toThrow(
      "boom",
    );
  });

  it("getByDate: a repository error propagates (is NOT swallowed to an empty array)", () => {
    const repo = makeFakeRepo({
      getByDate: () => {
        throw new Error("boom");
      },
    });
    const service = new ProfitService(repo, FAKE_RATE_REPO);
    expect(() => service.getByDate("2026-01-01", "2026-01-01")).toThrow(
      "boom",
    );
  });
});

describe("PA-4.12 — By Module sorts by USD-equivalent at the LBP buy rate, and human-labels provider codes", () => {
  it("getByModule: an LBP-only module with a large LBP profit sorts ABOVE a small USD-only module once a buy rate is available", () => {
    // OBSERVED RED (pre-fix): the sort was `b.profit_usd - a.profit_usd`
    // only — an LBP-only row (profit_usd = 0) always sank to the bottom
    // regardless of its real USD-equivalent value.
    const repo = makeFakeRepo({
      getLotoTotals: () => ({
        revenue_lbp: 900000,
        profit_lbp: 900000,
        kept_change_usd: 0,
        count: 1,
      }), // ~$10 at 90,000
      getFinancialSettledByProvider: (): FinByProviderRow[] => [
        {
          provider: "OMT",
          revenue_usd: 1,
          revenue_lbp: 0,
          cost_usd: 0,
          cost_lbp: 0,
          profit_usd: 1,
          profit_lbp: 0,
          kept_change_usd: 0,
          kept_change_lbp: 0,
          count: 1,
        },
      ],
    });
    const rateRepo = { findByCode: () => ({ buy_rate: 90000 }) } as never;
    const service = new ProfitService(repo, rateRepo);
    const rows = service.getByModule("2026-01-01", "2026-01-01");
    const lotoIndex = rows.findIndex((r) => r.module === "LOTO");
    const omtIndex = rows.findIndex((r) => r.module === "FINANCIAL_SERVICE_OMT");
    expect(lotoIndex).toBeGreaterThanOrEqual(0);
    expect(omtIndex).toBeGreaterThanOrEqual(0);
    expect(lotoIndex).toBeLessThan(omtIndex);
  });

  it("getByModule: a provider code gets a human label (OMT_APP -> 'OMT App')", () => {
    const repo = makeFakeRepo({
      getFinancialSettledByProvider: (): FinByProviderRow[] => [
        {
          provider: "OMT_APP",
          revenue_usd: 1,
          revenue_lbp: 0,
          cost_usd: 0,
          cost_lbp: 0,
          profit_usd: 1,
          profit_lbp: 0,
          kept_change_usd: 0,
          kept_change_lbp: 0,
          count: 1,
        },
      ],
    });
    const service = new ProfitService(repo, FAKE_RATE_REPO);
    const rows = service.getByModule("2026-01-01", "2026-01-01");
    const row = rows.find((r) => r.module === "FINANCIAL_SERVICE_OMT_APP");
    expect(row?.label).toBe("OMT App");
  });
});

describe("note #3 (2026-09-24, CLOSED \"no change\") — the combined net-profit line is REMOVED; per-module margin", () => {
  // NOT RUN tonight — red/green proof pending (tomorrow). These guards
  // replace the old PA-4.21 pair that asserted combined_net_profit_lbp/
  // combined_rate_used WERE present; against the pre-fix code (the field
  // still on ProfitSummary.totals) the `not.toHaveProperty` assertions here
  // would fail, which is what proves they guard the removal (rule 17).
  it("getSummary: totals never returns combined_net_profit_lbp or combined_rate_used — net_profit_usd/net_profit_lbp stay separate per-currency figures (owner: credits are reduced in USD, so -0.32$ must never fold into an LBP total)", () => {
    const repo = makeFakeRepo({
      getLotoTotals: () => ({
        revenue_lbp: 90000,
        profit_lbp: 90000,
        kept_change_usd: 0,
        count: 1,
      }),
      getRechargesByCurrency: (): RechargeCurrencyRow[] => [
        {
          currency_code: "USD",
          revenue: 0,
          cost: 0.32,
          profit: -0.32,
          kept_change: 0,
          count: 1,
        },
      ],
    });
    const rateRepo = { findByCode: () => ({ buy_rate: 89000 }) } as never;
    const service = new ProfitService(repo, rateRepo);
    const summary = service.getSummary("2026-01-01", "2026-01-01");
    expect(summary.totals.net_profit_lbp).toBe(90000);
    expect(summary.totals.net_profit_usd).toBeCloseTo(-0.32, 5);
    expect(summary.totals).not.toHaveProperty("combined_net_profit_lbp");
    expect(summary.totals).not.toHaveProperty("combined_rate_used");
    // lbp_buy_rate survives the removal — it now feeds ONLY the By Module
    // TOTAL row's mixed-currency margin_pct weighting (LIRA-183, kept),
    // never a combined net-profit figure.
    expect(summary.totals.lbp_buy_rate).toBe(89000);
  });

  it("getSummary: totals.lbp_buy_rate is null when no LBP rate is configured (never a fabricated fallback rate); combined fields stay absent either way", () => {
    const repo = makeFakeRepo();
    const service = new ProfitService(repo, FAKE_RATE_REPO);
    const summary = service.getSummary("2026-01-01", "2026-01-01");
    expect(summary.totals).not.toHaveProperty("combined_net_profit_lbp");
    expect(summary.totals).not.toHaveProperty("combined_rate_used");
    expect(summary.totals.lbp_buy_rate).toBeNull();
  });

  it("getByModule: a pure-USD row's margin_pct is exact and rate-free (margin_converted = false)", () => {
    const repo = makeFakeRepo({
      getSalesRevCost: () => ({ revenue_usd: 10, cost_usd: 6, count: 1 }),
      getSalesProfit: () => ({ profit_usd: 4, profit_lbp: 0 }),
    });
    const service = new ProfitService(repo, FAKE_RATE_REPO);
    const rows = service.getByModule("2026-01-01", "2026-01-01");
    const sale = rows.find((r) => r.module === "SALE");
    expect(sale?.margin_pct).toBeCloseTo(40, 5);
    expect(sale?.margin_converted).toBe(false);
  });

  it("getByModule: a mixed USD+LBP row's margin_pct requires (and is marked as needing) a rate conversion", () => {
    const repo = makeFakeRepo({
      getCustomServicesTotals: () => ({
        revenue_usd: 10,
        revenue_lbp: 90000,
        cost_usd: 5,
        cost_lbp: 45000,
        profit_usd: 5,
        profit_lbp: 45000,
        count: 1,
      }),
    });
    const rateRepo = { findByCode: () => ({ buy_rate: 90000 }) } as never;
    const service = new ProfitService(repo, rateRepo);
    const rows = service.getByModule("2026-01-01", "2026-01-01");
    const row = rows.find((r) => r.module === "CUSTOM_SERVICE");
    expect(row?.margin_converted).toBe(true);
    expect(row?.margin_pct).toBeCloseTo(50, 5);
  });
});

// ---------------------------------------------------------------------------
// Owner decision (h), 2026-09-24 afternoon (OWNER_NOTES_2026-09-21.md §6.9,
// L0-4) — Financial Services card "waiting for repayment" line.
// ---------------------------------------------------------------------------

describe("Owner decision (h) — Financial Services 'waiting for repayment' line", () => {
  it("getSummary: wires getFinancialWaitingForRepaymentByCurrency into financial_services.waiting_for_repayment_usd/_lbp, per currency", () => {
    const repo = makeFakeRepo({
      getFinancialWaitingForRepaymentByCurrency: (): FsWaitingForRepaymentRow[] => [
        { currency: "USD", commission: 5, count: 1 },
        { currency: "LBP", commission: 30_000, count: 1 },
      ],
    });
    const service = new ProfitService(repo, FAKE_RATE_REPO);
    const summary = service.getSummary("2026-01-01", "2026-01-01");
    expect(summary.financial_services.waiting_for_repayment_usd).toBe(5);
    expect(summary.financial_services.waiting_for_repayment_lbp).toBe(30_000);
  });

  it("getSummary: waiting-for-repayment is NEVER added to gross or net profit/revenue — kept out of profit until repaid", () => {
    const repoWithout = makeFakeRepo();
    const repoWith = makeFakeRepo({
      getFinancialWaitingForRepaymentByCurrency: (): FsWaitingForRepaymentRow[] => [
        { currency: "USD", commission: 5, count: 1 },
      ],
    });
    const summaryWithout = new ProfitService(repoWithout, FAKE_RATE_REPO).getSummary(
      "2026-01-01",
      "2026-01-01",
    );
    const summaryWith = new ProfitService(repoWith, FAKE_RATE_REPO).getSummary(
      "2026-01-01",
      "2026-01-01",
    );
    expect(summaryWith.financial_services.waiting_for_repayment_usd).toBe(5);
    // Identical gross/net totals with and without the waiting-for-repayment
    // bucket present — proves it is additive visibility only.
    expect(summaryWith.totals).toEqual(summaryWithout.totals);
  });

  it("getSummary: defaults to 0 when the repository returns no rows (no debt-pending FS commission this period)", () => {
    const repo = makeFakeRepo();
    const service = new ProfitService(repo, FAKE_RATE_REPO);
    const summary = service.getSummary("2026-01-01", "2026-01-01");
    expect(summary.financial_services.waiting_for_repayment_usd).toBe(0);
    expect(summary.financial_services.waiting_for_repayment_lbp).toBe(0);
  });
});
