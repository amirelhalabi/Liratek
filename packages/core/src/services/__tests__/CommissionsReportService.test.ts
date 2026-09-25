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
  // Round 2 (adversarial review, LC-1) — BINANCE realized commission is
  // ALWAYS zero: its financial_services rows are stored with
  // currency = 'USDT' (CryptoForm.tsx, Recharge/index.tsx), but
  // getFinancialSettledByProvider (and the FSR profit stamp feeding
  // t.profit_usd/t.profit_lbp) buckets strictly on fs.currency = 'USD'/'LBP'
  // (PA-1.4). A USDT row therefore contributed realized_usd = 0,
  // realized_lbp = 0 while still incrementing `count` — "BINANCE — N
  // transactions — $0.00", which reads as "we earned nothing" rather than
  // "this figure isn't tracked in a currency this tab can show". Owner
  // decision needed for a real USDT figure (out of this lane's reach: it
  // would mean editing ProfitRepository.ts, which this lane may not touch,
  // or the FSR profit stamp, which is outside the two FSR functions this
  // lane owns and would violate this run's "no stored profit stamp changes"
  // invariant) — so BINANCE is EXCLUDED from the reportable set instead of
  // shown with a fabricated/misleading $0.00, and callers are told WHY via
  // `excludedProviders`.
  //
  // RULE 17 (failing-first proof, this session, `npx jest
  // CommissionsReportService --maxWorkers=1`, run against the
  // CommissionsReportService.ts that shipped in round 1 — BINANCE still a
  // member of COMMISSION_REPORT_PROVIDERS, no `excludedProviders` field on
  // `CommissionsReport` at all): the WHOLE SUITE failed to compile —
  //
  //   src/services/__tests__/CommissionsReportService.test.ts:291:19
  //   error TS2339: Property 'excludedProviders' does not exist on type
  //   'CommissionsReport'.
  //   (repeated at the other 3 `report.excludedProviders` call sites)
  //   Test Suites: 1 failed, 1 total / Tests: 0 total
  //
  // — i.e. ts-jest refused to run a single test because the type this file
  // asserts against didn't exist pre-fix, which is as unambiguous a red as
  // a runtime assertion failure. `excludedProviders` was then added to
  // `CommissionsReport`/`getReport()` and BINANCE dropped from
  // `COMMISSION_REPORT_PROVIDERS`, and the whole file was re-run: 11/11
  // passing (see this file's own header for the ORIGINAL round-1 proof of
  // the other cases).
  // ---------------------------------------------------------------------------

  it("excludes BINANCE from byProvider even when it has settled/unsettled rows (LC-1)", () => {
    const profitRepo = makeMockProfitRepo();
    (profitRepo.getFinancialSettledByProvider as jest.Mock).mockReturnValue([
      {
        provider: "BINANCE",
        revenue_usd: 0,
        revenue_lbp: 0,
        profit_usd: 0,
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

    expect(
      report.byProvider.find((r) => (r.provider as string) === "BINANCE"),
    ).toBeUndefined();
    expect(report.byProvider.map((r) => r.provider)).toEqual(["OMT"]);
    // Excluding BINANCE must not silently drop OMT's own totals.
    expect(report.realized_usd).toBe(2);
  });

  it("surfaces BINANCE in excludedProviders when it appears in either source, with a reason (LC-1)", () => {
    const profitRepo = makeMockProfitRepo();
    (profitRepo.getFinancialSettledByProvider as jest.Mock).mockReturnValue([
      {
        provider: "BINANCE",
        revenue_usd: 0,
        revenue_lbp: 0,
        profit_usd: 0,
        profit_lbp: 0,
        count: 2,
      },
    ]);
    const fsRepo = makeMockFsRepo();
    (fsRepo.getUnsettledSummaryByProvider as jest.Mock).mockReturnValue([]);
    const service = new CommissionsReportService(profitRepo, fsRepo);

    const report = service.getReport("2026-09-01", "2026-09-30");

    const excluded = report.excludedProviders ?? [];
    expect(excluded).toEqual([
      expect.objectContaining({ provider: "BINANCE" }),
    ]);
    expect(excluded[0].reason).toEqual(expect.any(String));
    expect(excluded[0].reason.length).toBeGreaterThan(0);
  });

  it("omits excludedProviders when Binance has no activity in either source (no permanent caption for shops that never use it)", () => {
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

  it("COMMISSION_REPORT_PROVIDERS no longer includes BINANCE (LC-1) — the canonical 5-provider list lives in constants/commissionProviders.ts instead (LC-3)", () => {
    expect([...COMMISSION_REPORT_PROVIDERS].sort()).toEqual(
      ["OMT", "OMT_APP", "WHISH", "WHISH_APP"].sort(),
    );
  });
});
