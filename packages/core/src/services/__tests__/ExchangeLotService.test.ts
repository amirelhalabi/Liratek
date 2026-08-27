/**
 * ExchangeLotService — read/admin API over ExchangeLotRepository
 * (EXCHANGE_LOT_SETTLEMENT.md Phase 4a). Unit-tested against MOCKED
 * repositories (rule 13 — services are testable without a DB), isolating
 * the money-safety invariants this service layer owns:
 *
 * 1. Market-rate normalization (`marketRateToUsdPerUnit`) is applied
 *    correctly for BOTH `is_stronger` orientations before it reaches the
 *    repository's `marketUnitCostUsd` input — get this backwards and every
 *    Q6 oversell-basis settlement is priced on the wrong side of the rate.
 * 2. A currency with no `exchange_rates` row falls back to the executed
 *    `unitProceedsUsd` (documented Phase 3 fallback — the MARKET slice then
 *    previews exactly 0 profit instead of throwing and blocking the whole
 *    preview).
 * 3. Non-lot-tracked currencies (USD/LBP, Q1) short-circuit BEFORE ever
 *    calling the repository or the rate repository — the form silently
 *    skips the preview/loss-dialog for these instead of erroring.
 * 4. `getPositions`' Q11 indicative unrealized P&L is `null` (not a
 *    fabricated 0) when there is no market rate, and correctly rounded to
 *    the cent when there is.
 */

import { ExchangeLotService } from "../ExchangeLotService.js";
import type { ExchangeLotRepository } from "../../repositories/ExchangeLotRepository.js";
import type { RateRepository } from "../../repositories/RateRepository.js";

function makeMockRepo() {
  return {
    createLot: jest.fn(),
    consumeFifo: jest.fn(),
    previewConsume: jest.fn(),
    restoreSettlements: jest.fn(),
    voidLotsBySource: jest.fn(),
    hasActiveSettlementsAgainstSource: jest.fn(),
    getPositions: jest.fn(),
    getSettlementsBySettler: jest.fn(),
    getSettlementsAgainstSource: jest.fn(),
    getSummaryForSettlers: jest.fn(),
    getSummaryForSources: jest.fn(),
    adjust: jest.fn(),
  } as unknown as jest.Mocked<ExchangeLotRepository>;
}

function makeMockRateRepo() {
  return {
    findAll: jest.fn(),
    findAllAsCurrencyRates: jest.fn(),
    findByCode: jest.fn(),
    upsert: jest.fn(),
    deleteByCode: jest.fn(),
    findAllRates: jest.fn(),
  } as unknown as jest.Mocked<RateRepository>;
}

describe("ExchangeLotService — previewSettlement", () => {
  it("short-circuits non-lot-tracked currencies (USD) WITHOUT calling either repository", () => {
    const repo = makeMockRepo();
    const rateRepo = makeMockRateRepo();
    const service = new ExchangeLotService(repo, rateRepo);

    const result = service.previewSettlement({
      currencyCode: "USD",
      qty: 100,
      unitProceedsUsd: 1,
    });

    expect(result).toEqual({ success: true, lotTracked: false });
    expect(repo.previewConsume).not.toHaveBeenCalled();
    expect(rateRepo.findByCode).not.toHaveBeenCalled();
  });

  it("short-circuits non-lot-tracked currencies (LBP) WITHOUT calling either repository", () => {
    const repo = makeMockRepo();
    const rateRepo = makeMockRateRepo();
    const service = new ExchangeLotService(repo, rateRepo);

    const result = service.previewSettlement({
      currencyCode: "LBP",
      qty: 1_000_000,
      unitProceedsUsd: 0.000011,
    });

    expect(result).toEqual({ success: true, lotTracked: false });
    expect(repo.previewConsume).not.toHaveBeenCalled();
    expect(rateRepo.findByCode).not.toHaveBeenCalled();
  });

  it("normalizes is_stronger = +1 (units-per-USD, e.g. LBP-shaped) to 1/market_rate", () => {
    const repo = makeMockRepo();
    const rateRepo = makeMockRateRepo();
    (rateRepo.findByCode as jest.Mock).mockReturnValue({
      id: 1,
      to_code: "XXX",
      market_rate: 90000,
      buy_rate: 89000,
      sell_rate: 91000,
      is_stronger: 1,
      updated_at: "2026-08-22 00:00:00",
    });
    (repo.previewConsume as jest.Mock).mockReturnValue({
      settlements: [],
      realizedProfitUsd: 0,
      coveredQty: 0,
      marketQty: 10,
    });
    const service = new ExchangeLotService(repo, rateRepo);

    const result = service.previewSettlement({
      currencyCode: "XXX",
      qty: 10,
      unitProceedsUsd: 0.00002,
    });

    expect(result.success).toBe(true);
    expect((result as { lotTracked: boolean }).lotTracked).toBe(true);
    expect(
      (result as { marketUnitCostUsd: number }).marketUnitCostUsd,
    ).toBeCloseTo(1 / 90000);
    expect(repo.previewConsume).toHaveBeenCalledWith({
      currencyCode: "XXX",
      qty: 10,
      unitProceedsUsd: 0.00002,
      marketUnitCostUsd: 1 / 90000,
    });
  });

  it("normalizes is_stronger = -1 (USD-per-unit, e.g. EUR-shaped) to market_rate itself", () => {
    const repo = makeMockRepo();
    const rateRepo = makeMockRateRepo();
    (rateRepo.findByCode as jest.Mock).mockReturnValue({
      id: 2,
      to_code: "EUR",
      market_rate: 1.18,
      buy_rate: 1.16,
      sell_rate: 1.2,
      is_stronger: -1,
      updated_at: "2026-08-22 00:00:00",
    });
    (repo.previewConsume as jest.Mock).mockReturnValue({
      settlements: [],
      realizedProfitUsd: 0,
      coveredQty: 5,
      marketQty: 0,
    });
    const service = new ExchangeLotService(repo, rateRepo);

    const result = service.previewSettlement({
      currencyCode: "EUR",
      qty: 5,
      unitProceedsUsd: 1.19,
    });

    expect(result.success).toBe(true);
    expect((result as { marketUnitCostUsd: number }).marketUnitCostUsd).toBe(
      1.18,
    );
    expect(repo.previewConsume).toHaveBeenCalledWith({
      currencyCode: "EUR",
      qty: 5,
      unitProceedsUsd: 1.19,
      marketUnitCostUsd: 1.18,
    });
  });

  it("falls back to unitProceedsUsd as the market basis when no rate row exists", () => {
    const repo = makeMockRepo();
    const rateRepo = makeMockRateRepo();
    (rateRepo.findByCode as jest.Mock).mockReturnValue(null);
    (repo.previewConsume as jest.Mock).mockReturnValue({
      settlements: [],
      realizedProfitUsd: 0,
      coveredQty: 0,
      marketQty: 3,
    });
    const service = new ExchangeLotService(repo, rateRepo);

    const result = service.previewSettlement({
      currencyCode: "GBP",
      qty: 3,
      unitProceedsUsd: 1.27,
    });

    expect((result as { marketUnitCostUsd: number }).marketUnitCostUsd).toBe(
      1.27,
    );
    expect(repo.previewConsume).toHaveBeenCalledWith(
      expect.objectContaining({ marketUnitCostUsd: 1.27 }),
    );
  });

  it("returns a structured failure (not a throw) when the repository throws", () => {
    const repo = makeMockRepo();
    const rateRepo = makeMockRateRepo();
    (rateRepo.findByCode as jest.Mock).mockReturnValue(null);
    (repo.previewConsume as jest.Mock).mockImplementation(() => {
      throw new Error("qty must be greater than 0");
    });
    const service = new ExchangeLotService(repo, rateRepo);

    const result = service.previewSettlement({
      currencyCode: "GBP",
      qty: 0,
      unitProceedsUsd: 1.27,
    });

    expect(result).toEqual({
      success: false,
      error: "qty must be greater than 0",
    });
  });

  // ---------------------------------------------------------------------------
  // FIX 2 (adversarial review) — cross pair with no USD anchor
  // ---------------------------------------------------------------------------

  it("skips the preview with reason NO_RATE_ANCHOR for a cross pair (both sides non-USD) where NEITHER side has a configured rate row", () => {
    const repo = makeMockRepo();
    const rateRepo = makeMockRateRepo();
    (rateRepo.findByCode as jest.Mock).mockReturnValue(null); // neither XAF nor XOF configured
    const service = new ExchangeLotService(repo, rateRepo);

    const result = service.previewSettlement({
      currencyCode: "XOF",
      fromCurrency: "XAF",
      qty: 900,
      unitProceedsUsd: 1.1,
    });

    expect(result).toEqual({
      success: true,
      lotTracked: false,
      reason: "NO_RATE_ANCHOR",
    });
    expect(repo.previewConsume).not.toHaveBeenCalled();
  });

  it("still previews normally when the cross pair HAS an anchor (fromCurrency's own rate row)", () => {
    const repo = makeMockRepo();
    const rateRepo = makeMockRateRepo();
    (rateRepo.findByCode as jest.Mock).mockImplementation((code: string) =>
      code === "EUR"
        ? {
            id: 1,
            to_code: "EUR",
            market_rate: 1.18,
            buy_rate: 1.16,
            sell_rate: 1.2,
            is_stronger: -1,
            updated_at: "2026-08-22 00:00:00",
          }
        : null,
    );
    (repo.previewConsume as jest.Mock).mockReturnValue({
      settlements: [],
      realizedProfitUsd: 250,
      coveredQty: 500,
      marketQty: 0,
    });
    const service = new ExchangeLotService(repo, rateRepo);

    const result = service.previewSettlement({
      currencyCode: "GBP", // no rate row of its own
      fromCurrency: "EUR", // anchors via ITS rate row (_crossUsdNotional's from-side priority)
      qty: 500,
      unitProceedsUsd: 2.0,
    });

    expect(result.success).toBe(true);
    expect((result as { lotTracked: boolean }).lotTracked).toBe(true);
    expect(repo.previewConsume).toHaveBeenCalled();
  });

  it("treats fromCurrency === LBP as always anchored, regardless of any configured rate row", () => {
    const repo = makeMockRepo();
    const rateRepo = makeMockRateRepo();
    (rateRepo.findByCode as jest.Mock).mockReturnValue(null); // no rate row for GBP either
    (repo.previewConsume as jest.Mock).mockReturnValue({
      settlements: [],
      realizedProfitUsd: 10,
      coveredQty: 100,
      marketQty: 0,
    });
    const service = new ExchangeLotService(repo, rateRepo);

    const result = service.previewSettlement({
      currencyCode: "GBP",
      fromCurrency: "LBP",
      qty: 100,
      unitProceedsUsd: 1.3,
    });

    expect(result.success).toBe(true);
    expect((result as { lotTracked: boolean }).lotTracked).toBe(true);
  });

  it("a DIRECT trade (fromCurrency === USD) never triggers the anchor check, even with no rate row", () => {
    const repo = makeMockRepo();
    const rateRepo = makeMockRateRepo();
    (rateRepo.findByCode as jest.Mock).mockReturnValue(null);
    (repo.previewConsume as jest.Mock).mockReturnValue({
      settlements: [],
      realizedProfitUsd: 60,
      coveredQty: 1000,
      marketQty: 0,
    });
    const service = new ExchangeLotService(repo, rateRepo);

    const result = service.previewSettlement({
      currencyCode: "EUR",
      fromCurrency: "USD",
      qty: 1000,
      unitProceedsUsd: 1.15,
    });

    expect(result.success).toBe(true);
    expect((result as { lotTracked: boolean }).lotTracked).toBe(true);
    expect(repo.previewConsume).toHaveBeenCalled();
  });

  it("omitting fromCurrency entirely (old caller) keeps the pre-FIX-2 behavior — never skips for a missing anchor", () => {
    const repo = makeMockRepo();
    const rateRepo = makeMockRateRepo();
    (rateRepo.findByCode as jest.Mock).mockReturnValue(null);
    (repo.previewConsume as jest.Mock).mockReturnValue({
      settlements: [],
      realizedProfitUsd: 5,
      coveredQty: 50,
      marketQty: 0,
    });
    const service = new ExchangeLotService(repo, rateRepo);

    const result = service.previewSettlement({
      currencyCode: "EUR",
      qty: 50,
      unitProceedsUsd: 1.1,
    });

    expect(result.success).toBe(true);
    expect((result as { lotTracked: boolean }).lotTracked).toBe(true);
  });
});

describe("ExchangeLotService — getPositions", () => {
  it("attaches current_market_unit_usd/unrealized_profit_usd, rounded to the cent, when a rate exists", () => {
    const repo = makeMockRepo();
    const rateRepo = makeMockRateRepo();
    (repo.getPositions as jest.Mock).mockReturnValue([
      {
        currency_code: "EUR",
        open_qty: 100,
        avg_unit_cost_usd: 1.1,
        lot_count: 2,
      },
    ]);
    (rateRepo.findByCode as jest.Mock).mockReturnValue({
      id: 1,
      to_code: "EUR",
      market_rate: 1.155,
      buy_rate: 1.14,
      sell_rate: 1.17,
      is_stronger: -1,
      updated_at: "2026-08-22 00:00:00",
    });
    const service = new ExchangeLotService(repo, rateRepo);

    const positions = service.getPositions();

    expect(positions).toEqual([
      {
        currency_code: "EUR",
        open_qty: 100,
        avg_unit_cost_usd: 1.1,
        lot_count: 2,
        current_market_unit_usd: 1.155,
        // 100 * (1.155 - 1.1) = 5.5 exactly, still exercised through the
        // rounding path.
        unrealized_profit_usd: 5.5,
      },
    ]);
  });

  it("returns null for BOTH market fields when no rate row exists (never a fabricated 0)", () => {
    const repo = makeMockRepo();
    const rateRepo = makeMockRateRepo();
    (repo.getPositions as jest.Mock).mockReturnValue([
      {
        currency_code: "AED",
        open_qty: 50,
        avg_unit_cost_usd: 0.27,
        lot_count: 1,
      },
    ]);
    (rateRepo.findByCode as jest.Mock).mockReturnValue(null);
    const service = new ExchangeLotService(repo, rateRepo);

    const positions = service.getPositions();

    expect(positions).toEqual([
      {
        currency_code: "AED",
        open_qty: 50,
        avg_unit_cost_usd: 0.27,
        lot_count: 1,
        current_market_unit_usd: null,
        unrealized_profit_usd: null,
      },
    ]);
  });

  it("returns [] (not a throw) if the repository throws", () => {
    const repo = makeMockRepo();
    const rateRepo = makeMockRateRepo();
    (repo.getPositions as jest.Mock).mockImplementation(() => {
      throw new Error("boom");
    });
    const service = new ExchangeLotService(repo, rateRepo);

    expect(service.getPositions()).toEqual([]);
  });
});

describe("ExchangeLotService — getBreakdown", () => {
  it("queries both directions against the exchange_transactions source table", () => {
    const repo = makeMockRepo();
    const rateRepo = makeMockRateRepo();
    (repo.getSettlementsBySettler as jest.Mock).mockReturnValue([
      { id: 1 } as never,
    ]);
    (repo.getSettlementsAgainstSource as jest.Mock).mockReturnValue([
      { id: 2 } as never,
    ]);
    const service = new ExchangeLotService(repo, rateRepo);

    const result = service.getBreakdown(42);

    expect(repo.getSettlementsBySettler).toHaveBeenCalledWith(
      "exchange_transactions",
      42,
    );
    expect(repo.getSettlementsAgainstSource).toHaveBeenCalledWith(
      "exchange_transactions",
      42,
    );
    expect(result).toEqual({
      asSettler: [{ id: 1 }],
      againstSource: [{ id: 2 }],
    });
  });

  it("returns empty arrays (not a throw) if the repository throws", () => {
    const repo = makeMockRepo();
    const rateRepo = makeMockRateRepo();
    (repo.getSettlementsBySettler as jest.Mock).mockImplementation(() => {
      throw new Error("boom");
    });
    const service = new ExchangeLotService(repo, rateRepo);

    expect(service.getBreakdown(1)).toEqual({
      asSettler: [],
      againstSource: [],
    });
  });
});

describe("ExchangeLotService — adjustPosition", () => {
  it("attaches the server-derived createdBy and delegates to repo.adjust", () => {
    const repo = makeMockRepo();
    const rateRepo = makeMockRateRepo();
    (repo.adjust as jest.Mock).mockReturnValue({
      adjustment: { id: 1 },
    } as never);
    const service = new ExchangeLotService(repo, rateRepo);

    const result = service.adjustPosition(
      { currencyCode: "EUR", qty: 100, unitCostUsd: 1.1 },
      "alice",
    );

    expect(repo.adjust).toHaveBeenCalledWith({
      currencyCode: "EUR",
      qty: 100,
      unitCostUsd: 1.1,
      createdBy: "alice",
    });
    expect(result).toEqual({
      success: true,
      data: { adjustment: { id: 1 } },
    });
  });

  it("returns a structured failure (not a throw) when the repository rejects the input", () => {
    const repo = makeMockRepo();
    const rateRepo = makeMockRateRepo();
    (repo.adjust as jest.Mock).mockImplementation(() => {
      throw new Error(
        "Exchange lot adjustments only apply to exotic currencies — USD uses the spread model, not lots",
      );
    });
    const service = new ExchangeLotService(repo, rateRepo);

    const result = service.adjustPosition(
      { currencyCode: "USD", qty: 10 },
      "alice",
    );

    expect(result).toEqual({
      success: false,
      error:
        "Exchange lot adjustments only apply to exotic currencies — USD uses the spread model, not lots",
    });
  });
});
