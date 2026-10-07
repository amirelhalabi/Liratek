/**
 * CommissionsReportService — unit-tested against MOCKED repositories (rule
 * 13: services are testable without a DB; the SQL correctness of the two
 * sources this service composes is already proven by
 * `ProfitRepository.fsStampModel1Recognition.test.ts` /
 * `ProfitRepository.commissionGates.test.ts` (getFinancialSettledByProvider)
 * and FinancialServiceRepository's own getUnsettledSummaryByProvider tests —
 * this file only proves the COMPOSITION: provider filtering, per-provider
 * merge, currency-split totals, and the [from,to] → fromDt/toDt bridge.
 *
 * OWNER_NOTES_2026-09-21.md §6, lane LC: PA-1.1 (provider filter — no mobile
 * margins), PA-1.6 (LBP pending, not just USD), PA-2.7 (realized includes
 * settlement commission — proven by construction: this service sources
 * "realized" from getFinancialSettledByProvider, which already includes it),
 * PA-3.4 (recognition gates — same reasoning), PA-4.17 (from/to reach the
 * realized query un-mangled), PA-4.18 (one row per provider with both
 * currencies as sibling fields — a `{[provider]: row}` map could never
 * silently collide the USD and LBP rows the old getAnalytics.byProvider
 * shape produced, because there IS no per-currency row here to collide).
 *
 * RULE 17 (failing-first proof, done WITHOUT reverting the implementation —
 * see the shared-tree protocol): this session ran the "excludes mobile
 * margins" and "adds the LBP pending figure, not just USD" cases below
 * against a deliberately reintroduced bug in CommissionsReportService.ts
 * (temporarily: (a) dropped the `isCommissionReportProvider` filter in both
 * loops, i.e. included every provider unconditionally, and (b) read only
 * `unsettled.pending_commission_usd`, leaving `pending_lbp` at 0) and
 * OBSERVED:
 *
 *   "excludes non-commission providers (PA-1.1)" › byProvider
 *     Expected length: 1   Received length: 2
 *     (the 'Katsh' cost/price-flow row survived into the report)
 *   "includes LBP pending, not just USD (PA-1.6)" › pending_lbp
 *     Expected: 500000   Received: 0
 *
 * The reintroduced lines were then reverted (git diff confirmed clean) and
 * this file was re-run: 8/8 passing.
 */

import {
  CommissionsReportService,
  COMMISSION_REPORT_PROVIDERS,
} from "../CommissionsReportService.js";
import type { ProfitRepository } from "../../repositories/ProfitRepository.js";
import type { FinancialServiceRepository } from "../../repositories/FinancialServiceRepository.js";

function makeMockProfitRepo() {
  return {
    getFinancialSettledByProvider: jest.fn(),
  } as unknown as jest.Mocked<ProfitRepository>;
}

function makeMockFsRepo() {
  return {
    getUnsettledSummaryByProvider: jest.fn(),
  } as unknown as jest.Mocked<FinancialServiceRepository>;
}

describe("CommissionsReportService", () => {
  it("passes [from,to] through as datetime bounds ('YYYY-MM-DD 00:00:00'/'23:59:59'), matching every other ProfitService method (PA-4.17)", () => {
    const profitRepo = makeMockProfitRepo();
    (profitRepo.getFinancialSettledByProvider as jest.Mock).mockReturnValue(
      [],
    );
    const fsRepo = makeMockFsRepo();
    (fsRepo.getUnsettledSummaryByProvider as jest.Mock).mockReturnValue([]);
    const service = new CommissionsReportService(profitRepo, fsRepo);

    service.getReport("2026-09-01", "2026-09-30");

    expect(profitRepo.getFinancialSettledByProvider).toHaveBeenCalledWith(
      "2026-09-01 00:00:00",
      "2026-09-30 23:59:59",
    );
  });

  it("does NOT scope getUnsettledSummaryByProvider to [from,to] — pending is a current-state snapshot (PA-3.8 precedent, PA-4.17's 'label the window' branch)", () => {
    const profitRepo = makeMockProfitRepo();
    (profitRepo.getFinancialSettledByProvider as jest.Mock).mockReturnValue(
      [],
    );
    const fsRepo = makeMockFsRepo();
    (fsRepo.getUnsettledSummaryByProvider as jest.Mock).mockReturnValue([]);
    const service = new CommissionsReportService(profitRepo, fsRepo);

    service.getReport("2026-09-01", "2026-09-30");

    expect(fsRepo.getUnsettledSummaryByProvider).toHaveBeenCalledWith();
  });

  it("excludes non-commission providers — no mobile-margin provider (Katsh/iPick/BOB) reaches the report (PA-1.1)", () => {
    const profitRepo = makeMockProfitRepo();
    (profitRepo.getFinancialSettledByProvider as jest.Mock).mockReturnValue([
      { provider: "OMT", revenue_usd: 100, revenue_lbp: 0, profit_usd: 5, profit_lbp: 0, count: 1 },
      { provider: "Katsh", revenue_usd: 200, revenue_lbp: 0, profit_usd: 30, profit_lbp: 0, count: 4 },
    ]);
    const fsRepo = makeMockFsRepo();
    (fsRepo.getUnsettledSummaryByProvider as jest.Mock).mockReturnValue([]);
    const service = new CommissionsReportService(profitRepo, fsRepo);

    const report = service.getReport("2026-09-01", "2026-09-30");

    expect(report.byProvider.map((r) => r.provider)).toEqual(["OMT"]);
    expect(report.realized_usd).toBe(5);
  });

  it("includes LBP pending, not just USD (PA-1.6)", () => {
    const profitRepo = makeMockProfitRepo();
    (profitRepo.getFinancialSettledByProvider as jest.Mock).mockReturnValue(
      [],
    );
    const fsRepo = makeMockFsRepo();
    (fsRepo.getUnsettledSummaryByProvider as jest.Mock).mockReturnValue([
      {
        provider: "WHISH",
        count: 2,
        bill_count: 0,
        pending_commission_usd: 3,
        pending_commission_lbp: 500000,
        awaiting_settlement_count: 1,
        total_owed_usd: 0,
        total_owed_lbp: 0,
      },
    ]);
    const service = new CommissionsReportService(profitRepo, fsRepo);

    const report = service.getReport("2026-09-01", "2026-09-30");

    expect(report.pending_usd).toBe(3);
    expect(report.pending_lbp).toBe(500000);
    expect(report.byProvider[0].pending_lbp).toBe(500000);
  });

  it("merges a provider present in only the settled source, or only the unsettled source, into ONE row (PA-4.18 — never a provider×currency-keyed duplicate)", () => {
    const profitRepo = makeMockProfitRepo();
    (profitRepo.getFinancialSettledByProvider as jest.Mock).mockReturnValue([
      { provider: "OMT", revenue_usd: 50, revenue_lbp: 10, profit_usd: 4, profit_lbp: 1, count: 2 },
    ]);
    const fsRepo = makeMockFsRepo();
    (fsRepo.getUnsettledSummaryByProvider as jest.Mock).mockReturnValue([
      {
        provider: "WHISH",
        count: 1,
        bill_count: 1,
        pending_commission_usd: 7,
        pending_commission_lbp: 0,
        awaiting_settlement_count: 1,
        total_owed_usd: 20,
        total_owed_lbp: 0,
      },
    ]);
    const service = new CommissionsReportService(profitRepo, fsRepo);

    const report = service.getReport("2026-09-01", "2026-09-30");

    expect(report.byProvider).toHaveLength(2);
    const omt = report.byProvider.find((r) => r.provider === "OMT");
    const whish = report.byProvider.find((r) => r.provider === "WHISH");
    expect(omt).toMatchObject({ realized_usd: 4, pending_usd: 0 });
    expect(whish).toMatchObject({ realized_usd: 0, pending_usd: 7 });
  });

  it("revenue_usd/revenue_lbp come from getFinancialSettledByProvider's revenue fields, not commission (PA-4.18 — 'Revenue by Provider' plotted commission)", () => {
    const profitRepo = makeMockProfitRepo();
    (profitRepo.getFinancialSettledByProvider as jest.Mock).mockReturnValue([
      { provider: "OMT", revenue_usd: 1000, revenue_lbp: 2000, profit_usd: 15, profit_lbp: 5, count: 3 },
    ]);
    const fsRepo = makeMockFsRepo();
    (fsRepo.getUnsettledSummaryByProvider as jest.Mock).mockReturnValue([]);
    const service = new CommissionsReportService(profitRepo, fsRepo);

    const report = service.getReport("2026-09-01", "2026-09-30");

    expect(report.byProvider[0].revenue_usd).toBe(1000);
    expect(report.byProvider[0].revenue_usd).not.toBe(
      report.byProvider[0].realized_usd,
    );
  });

  it("byProvider is sorted by provider name — stable render order", () => {
    const profitRepo = makeMockProfitRepo();
    (profitRepo.getFinancialSettledByProvider as jest.Mock).mockReturnValue([
      { provider: "WHISH", revenue_usd: 1, revenue_lbp: 0, profit_usd: 1, profit_lbp: 0, count: 1 },
      { provider: "OMT_APP", revenue_usd: 1, revenue_lbp: 0, profit_usd: 1, profit_lbp: 0, count: 1 },
      { provider: "OMT", revenue_usd: 1, revenue_lbp: 0, profit_usd: 1, profit_lbp: 0, count: 1 },
    ]);
    const fsRepo = makeMockFsRepo();
    (fsRepo.getUnsettledSummaryByProvider as jest.Mock).mockReturnValue([]);
    const service = new CommissionsReportService(profitRepo, fsRepo);

    const report = service.getReport("2026-09-01", "2026-09-30");

    expect(report.byProvider.map((r) => r.provider)).toEqual([
      "OMT",
      "OMT_APP",
      "WHISH",
    ]);
  });

  // ---------------------------------------------------------------------------
  // Round 2 (LC-1) excluded BINANCE here because its USDT rows reached no
  // USD/LBP bucket and would have read "$0.00". LIRA-268 made the shared
  // source (`getFinancialSettledByProvider`) report USDT as USD with the
  // Binance fee included, so BINANCE is a normal provider on this tab again.
  // These cases were the exclusion guards; rewritten (rule 24) into guards
  // that BINANCE is now carried through like any other provider and never
  // captioned as excluded. The real-DB agreement with the Overview is pinned
  // in ProfitService.binanceProfitVisible.test.ts.
  // Rule 17: these four rewritten cases were edited AFTER the fix — not
  // proven failing-first (the real-DB case above them was).
  // ---------------------------------------------------------------------------

  it("carries BINANCE through byProvider like any other provider (settled + unsettled)", () => {
    const profitRepo = makeMockProfitRepo();
    (profitRepo.getFinancialSettledByProvider as jest.Mock).mockReturnValue([
      {
        provider: "BINANCE",
        revenue_usd: 200,
        revenue_lbp: 0,
        profit_usd: 4.5,
        profit_lbp: 0,
        count: 3,
      },
      { provider: "OMT", revenue_usd: 10, revenue_lbp: 0, profit_usd: 2, profit_lbp: 0, count: 1 },
    ]);
    const fsRepo = makeMockFsRepo();
    (fsRepo.getUnsettledSummaryByProvider as jest.Mock).mockReturnValue([
      {
        provider: "BINANCE",
        count: 1,
        bill_count: 0,
        pending_commission_usd: 12,
        pending_commission_lbp: 0,
        awaiting_settlement_count: 0,
        total_owed_usd: 40,
        total_owed_lbp: 0,
      },
    ]);
    const service = new CommissionsReportService(profitRepo, fsRepo);

    const report = service.getReport("2026-09-01", "2026-09-30");

    expect(report.byProvider.map((r) => r.provider)).toEqual(["BINANCE", "OMT"]);
    const binance = report.byProvider.find((r) => r.provider === "BINANCE")!;
    expect(binance.realized_usd).toBe(4.5);
    expect(binance.count).toBe(3);
    expect(binance.pending_usd).toBe(12);
    expect(binance.total_owed_usd).toBe(40);
    expect(report.realized_usd).toBe(6.5);
  });

  it("never captions BINANCE as excluded, even when it has activity", () => {
    const profitRepo = makeMockProfitRepo();
    (profitRepo.getFinancialSettledByProvider as jest.Mock).mockReturnValue([
      {
        provider: "BINANCE",
        revenue_usd: 100,
        revenue_lbp: 0,
        profit_usd: 2,
        profit_lbp: 0,
        count: 2,
      },
    ]);
    const fsRepo = makeMockFsRepo();
    (fsRepo.getUnsettledSummaryByProvider as jest.Mock).mockReturnValue([]);
    const service = new CommissionsReportService(profitRepo, fsRepo);

    const report = service.getReport("2026-09-01", "2026-09-30");

    expect(report.excludedProviders).toEqual([]);
  });

  it("excludedProviders is [] when no provider is excluded (no permanent caption)", () => {
    const profitRepo = makeMockProfitRepo();
    (profitRepo.getFinancialSettledByProvider as jest.Mock).mockReturnValue([
      { provider: "OMT", revenue_usd: 1, revenue_lbp: 0, profit_usd: 1, profit_lbp: 0, count: 1 },
    ]);
    const fsRepo = makeMockFsRepo();
    (fsRepo.getUnsettledSummaryByProvider as jest.Mock).mockReturnValue([]);
    const service = new CommissionsReportService(profitRepo, fsRepo);

    const report = service.getReport("2026-09-01", "2026-09-30");

    expect(report.excludedProviders).toEqual([]);
  });

  it("COMMISSION_REPORT_PROVIDERS is the full commission-provider list, BINANCE included", () => {
    expect([...COMMISSION_REPORT_PROVIDERS].sort()).toEqual(
      ["BINANCE", "OMT", "OMT_APP", "WHISH", "WHISH_APP"].sort(),
    );
  });
});
