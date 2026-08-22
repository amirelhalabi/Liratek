/**
 * ExchangeService.getHistory — EXCHANGE_LOT_SETTLEMENT.md Phase 4b.
 *
 * Proves the cross-repo assembly this phase adds (rule 13 — this is exactly
 * what a service composes, never a JOIN inside `ExchangeRepository`): history
 * rows get `lot_summary`/`settler_summary` attached via exactly TWO batched
 * `ExchangeLotRepository` calls, never N+1, and the enrichment degrades to
 * null summaries (not a thrown error) when the lot repo fails — history
 * worked before lots existed and must not become fragile because of them.
 *
 * Unit-tested against MOCKED repositories (rule 13 — services are testable
 * without a DB), same pattern as `ExchangeLotService.test.ts`.
 */

import { ExchangeService } from "../ExchangeService.js";
import type { ExchangeRepository } from "../../repositories/ExchangeRepository.js";
import type { ExchangeLotRepository } from "../../repositories/ExchangeLotRepository.js";

function makeMockExchangeRepo() {
  return {
    getHistory: jest.fn(),
    getTodayTransactions: jest.fn(),
    getTodayStats: jest.fn(),
    findById: jest.fn(),
    updateMetadata: jest.fn(),
    createTransaction: jest.fn(),
  } as unknown as jest.Mocked<ExchangeRepository>;
}

function makeMockLotRepo() {
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

/** A minimal exchange_transactions row — only the fields these tests read. */
function makeRow(overrides: Record<string, unknown>) {
  return {
    id: 1,
    type: "BUY",
    from_currency: "USD",
    to_currency: "EUR",
    amount_in: 100,
    amount_out: 90,
    rate: 1.11,
    base_rate: 1.1,
    profit_usd: 0,
    leg1_rate: 1.11,
    leg1_market_rate: 1.1,
    leg1_profit_usd: 0,
    leg2_rate: null,
    leg2_market_rate: null,
    leg2_profit_usd: null,
    via_currency: null,
    client_name: null,
    note: null,
    created_at: "2026-08-22 10:00:00",
    created_by: 1,
    edited_by: null,
    edited_at: null,
    is_refunded: 0,
    refunded_at: null,
    ...overrides,
  } as never;
}

describe("ExchangeService.getHistory — lot summary enrichment", () => {
  it("attaches lot_summary to a BUY row after a partial sell, and settler_summary to the SELL row", () => {
    const exchangeRepo = makeMockExchangeRepo();
    const lotRepo = makeMockLotRepo();

    const buyRow = makeRow({ id: 1, type: "BUY" });
    const sellRow = makeRow({ id: 2, type: "SELL", from_currency: "EUR", to_currency: "USD" });
    (exchangeRepo.getHistory as jest.Mock).mockReturnValue([sellRow, buyRow]);

    (lotRepo.getSummaryForSources as jest.Mock).mockReturnValue({
      1: {
        original_qty: 90,
        remaining_qty: 40,
        settled_qty: 50,
        realized_profit_usd: 12.5,
        is_voided: 0,
      },
    });
    (lotRepo.getSummaryForSettlers as jest.Mock).mockReturnValue({
      2: {
        settled_qty: 50,
        realized_profit_usd: 12.5,
      },
    });

    const service = new ExchangeService(exchangeRepo, lotRepo);
    const history = service.getHistory(50);

    const buy = history.find((row) => row.id === 1)!;
    const sell = history.find((row) => row.id === 2)!;

    expect(buy.lot_summary).toEqual({
      original_qty: 90,
      remaining_qty: 40,
      settled_qty: 50,
      realized_profit_usd: 12.5,
      is_voided: 0,
    });
    expect(buy.settler_summary).toBeNull();

    expect(sell.settler_summary).toEqual({
      settled_qty: 50,
      realized_profit_usd: 12.5,
    });
    expect(sell.lot_summary).toBeNull();
  });

  it("attaches null lot_summary and null settler_summary to a USD<->LBP row that never touched a lot", () => {
    const exchangeRepo = makeMockExchangeRepo();
    const lotRepo = makeMockLotRepo();

    const usdLbpRow = makeRow({
      id: 3,
      type: "SELL",
      from_currency: "USD",
      to_currency: "LBP",
    });
    (exchangeRepo.getHistory as jest.Mock).mockReturnValue([usdLbpRow]);
    // Neither summary map has an entry for id 3 — USD/LBP never creates a lot.
    (lotRepo.getSummaryForSources as jest.Mock).mockReturnValue({});
    (lotRepo.getSummaryForSettlers as jest.Mock).mockReturnValue({});

    const service = new ExchangeService(exchangeRepo, lotRepo);
    const history = service.getHistory(50);

    expect(history).toHaveLength(1);
    expect(history[0].lot_summary).toBeNull();
    expect(history[0].settler_summary).toBeNull();
  });

  it("makes exactly TWO lot-repo calls for N rows (no N+1)", () => {
    const exchangeRepo = makeMockExchangeRepo();
    const lotRepo = makeMockLotRepo();

    const rows = [
      makeRow({ id: 1 }),
      makeRow({ id: 2 }),
      makeRow({ id: 3 }),
      makeRow({ id: 4 }),
      makeRow({ id: 5 }),
    ];
    (exchangeRepo.getHistory as jest.Mock).mockReturnValue(rows);
    (lotRepo.getSummaryForSources as jest.Mock).mockReturnValue({});
    (lotRepo.getSummaryForSettlers as jest.Mock).mockReturnValue({});

    const service = new ExchangeService(exchangeRepo, lotRepo);
    service.getHistory(50);

    expect(lotRepo.getSummaryForSources).toHaveBeenCalledTimes(1);
    expect(lotRepo.getSummaryForSettlers).toHaveBeenCalledTimes(1);
    expect(lotRepo.getSummaryForSources).toHaveBeenCalledWith(
      "exchange_transactions",
      [1, 2, 3, 4, 5],
    );
    expect(lotRepo.getSummaryForSettlers).toHaveBeenCalledWith(
      "exchange_transactions",
      [1, 2, 3, 4, 5],
    );
  });

  it("makes NO lot-repo calls when history is empty", () => {
    const exchangeRepo = makeMockExchangeRepo();
    const lotRepo = makeMockLotRepo();
    (exchangeRepo.getHistory as jest.Mock).mockReturnValue([]);

    const service = new ExchangeService(exchangeRepo, lotRepo);
    const history = service.getHistory(50);

    expect(history).toEqual([]);
    expect(lotRepo.getSummaryForSources).not.toHaveBeenCalled();
    expect(lotRepo.getSummaryForSettlers).not.toHaveBeenCalled();
  });

  it("returns rows with null summaries (not a throw) when the lot lookup throws", () => {
    const exchangeRepo = makeMockExchangeRepo();
    const lotRepo = makeMockLotRepo();

    const rows = [makeRow({ id: 1 }), makeRow({ id: 2 })];
    (exchangeRepo.getHistory as jest.Mock).mockReturnValue(rows);
    (lotRepo.getSummaryForSources as jest.Mock).mockImplementation(() => {
      throw new Error("lot repo unavailable");
    });

    const service = new ExchangeService(exchangeRepo, lotRepo);
    const history = service.getHistory(50);

    expect(history).toHaveLength(2);
    for (const row of history) {
      expect(row.lot_summary).toBeNull();
      expect(row.settler_summary).toBeNull();
    }
  });

  it("returns [] (not a throw) if the exchange repo itself throws", () => {
    const exchangeRepo = makeMockExchangeRepo();
    const lotRepo = makeMockLotRepo();
    (exchangeRepo.getHistory as jest.Mock).mockImplementation(() => {
      throw new Error("db unavailable");
    });

    const service = new ExchangeService(exchangeRepo, lotRepo);

    expect(service.getHistory(50)).toEqual([]);
    expect(lotRepo.getSummaryForSources).not.toHaveBeenCalled();
    expect(lotRepo.getSummaryForSettlers).not.toHaveBeenCalled();
  });
});
