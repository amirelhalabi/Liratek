/**
 * SalesService.getChartData("Profit") — DC-10 (OWNER_NOTES_2026-09-21.md
 * §7.2).
 *
 * Pre-DC-10, the "Profit" branch lived in `SalesRepository.getChartData` as
 * its own per-unit SQL query (`SUM(si.sold_price_usd -
 * si.cost_price_snapshot_usd)`) — never × quantity, no discount, no partial
 * refund, no non-product module, no LBP: a SECOND, divergent profit
 * definition from the Profits page's own By Date figures (rule 14). DC-10
 * replaces it with a SERVICE-layer composition (rule 13) from the SAME
 * `ProfitService.getByDate` the Profits page's By Date tab reads — this file
 * proves the composition, with `salesRepo`/`profitService` both faked so it
 * never touches a real database.
 *
 * RULE 17 (red observed 2026-09-24, before the SalesService.getChartData
 * "Profit" branch existed): running this file against the PRE-DC-10 service
 * (which only had `return this.salesRepo.getChartData(type)` — no
 * `profitService` field at all) fails to even COMPILE
 * (`Property 'getByDate' does not exist` / constructor arity mismatch), and
 * once stubbed to compile, every "Profit" assertion below fails because the
 * fake `profitService.getByDate` is never called (`toHaveBeenCalledWith`
 * dies with "Number of calls: 0") and the returned rows carry no `profit`/
 * `lbp` fields the old branch never produced. Restored after observing the
 * failure; the implementation below is what makes it green.
 */

import { SalesService } from "../SalesService.js";
import type { SalesRepository } from "../../repositories/SalesRepository.js";
import type { ProfitService, ProfitByDate } from "../ProfitService.js";
import { localDay } from "../../utils/localDate.js";
import { addDaysToDateString } from "../../utils/calendarDate.js";

function makeFakeSalesRepo(): jest.Mocked<
  Pick<SalesRepository, "getChartData">
> {
  return {
    getChartData: jest.fn().mockReturnValue([{ date: "2026-09-01", usd: 5 }]),
  } as unknown as jest.Mocked<Pick<SalesRepository, "getChartData">>;
}

function makeFakeProfitService(
  rows: ProfitByDate[],
): jest.Mocked<Pick<ProfitService, "getByDate">> {
  return {
    getByDate: jest.fn().mockReturnValue(rows),
  } as unknown as jest.Mocked<Pick<ProfitService, "getByDate">>;
}

function row(
  date: string,
  profit_usd: number,
  profit_lbp: number,
): ProfitByDate {
  return {
    date,
    revenue_usd: 0,
    revenue_lbp: 0,
    cost_usd: 0,
    cost_lbp: 0,
    profit_usd,
    profit_lbp,
    expenses_usd: 0,
    expenses_lbp: 0,
    net_profit_usd: profit_usd,
    net_profit_lbp: profit_lbp,
  };
}

describe("SalesService.getChartData('Sales') — unaffected by DC-10", () => {
  it("still delegates to salesRepo.getChartData (with the resolved endDay, DAY-1) and never touches ProfitService", () => {
    const salesRepo = makeFakeSalesRepo();
    const profitService = makeFakeProfitService([]);
    const service = new SalesService(
      salesRepo as unknown as SalesRepository,
      profitService as unknown as ProfitService,
    );

    const result = service.getChartData("Sales", "2026-09-24");

    expect(result).toEqual([{ date: "2026-09-01", usd: 5 }]);
    expect(salesRepo.getChartData).toHaveBeenCalledWith("Sales", "2026-09-24");
    expect(profitService.getByDate).not.toHaveBeenCalled();
  });

  it("falls back to clientDay()/localDay() when no endDay is given, same as 'Profit' (DAY-1, rule 27)", () => {
    const salesRepo = makeFakeSalesRepo();
    const profitService = makeFakeProfitService([]);
    const service = new SalesService(
      salesRepo as unknown as SalesRepository,
      profitService as unknown as ProfitService,
    );

    service.getChartData("Sales");

    expect(salesRepo.getChartData).toHaveBeenCalledWith("Sales", localDay());
  });
});

describe("SalesService.getChartData — DAY-1: 'Sales' and 'Profit' share the SAME resolved day (CLAUDE.md rule 27)", () => {
  it("passes the identical endDay to salesRepo.getChartData('Sales', …) that it windows the 'Profit' series on — no second day source", () => {
    const salesRepo = makeFakeSalesRepo();
    const profitService = makeFakeProfitService([]);
    const service = new SalesService(
      salesRepo as unknown as SalesRepository,
      profitService as unknown as ProfitService,
    );

    service.getChartData("Sales", "2026-09-24");
    service.getChartData("Profit", "2026-09-24");

    // "Sales" is windowed by SalesRepository (bound endDay), "Profit" by
    // ProfitService.getByDate(from, to) — both must have been given the
    // SAME explicit endDay ("2026-09-24"), proving there is exactly one
    // place ("Sales"/"Profit" both read `to = endDay ?? clientDay()`) that
    // resolves "today" for this chart, not two independent ones.
    expect(salesRepo.getChartData).toHaveBeenCalledWith("Sales", "2026-09-24");
    expect(profitService.getByDate).toHaveBeenCalledWith(
      "2026-08-26",
      "2026-09-24",
    );
  });
});

describe("SalesService.getChartData('Profit') — DC-10 composition", () => {
  it("calls ProfitService.getByDate over the 30-day window ending on the given endDay (inclusive)", () => {
    const salesRepo = makeFakeSalesRepo();
    const profitService = makeFakeProfitService([]);
    const service = new SalesService(
      salesRepo as unknown as SalesRepository,
      profitService as unknown as ProfitService,
    );

    service.getChartData("Profit", "2026-09-24");

    // 30 days inclusive of both ends: 2026-08-26 .. 2026-09-24.
    expect(profitService.getByDate).toHaveBeenCalledWith(
      "2026-08-26",
      "2026-09-24",
    );
  });

  it("maps profit_usd -> profit and profit_lbp -> lbp for each returned day", () => {
    const salesRepo = makeFakeSalesRepo();
    const profitService = makeFakeProfitService([
      row("2026-09-24", 49, 20000),
    ]);
    const service = new SalesService(
      salesRepo as unknown as SalesRepository,
      profitService as unknown as ProfitService,
    );

    const result = service.getChartData("Profit", "2026-09-24");
    const last = result[result.length - 1];

    expect(last).toEqual({ date: "2026-09-24", profit: 49, lbp: 20000 });
  });

  it("0-fills a day ProfitService.getByDate did not return a row for", () => {
    const salesRepo = makeFakeSalesRepo();
    // Only one day of the 30-day window has activity.
    const profitService = makeFakeProfitService([
      row("2026-09-24", 49, 20000),
    ]);
    const service = new SalesService(
      salesRepo as unknown as SalesRepository,
      profitService as unknown as ProfitService,
    );

    const result = service.getChartData("Profit", "2026-09-24");

    expect(result).toHaveLength(30);
    expect(result[0]).toEqual({ date: "2026-08-26", profit: 0, lbp: 0 });
  });

  it("falls back to clientDay()/localDay() when no endDay is given (rule 27)", () => {
    const salesRepo = makeFakeSalesRepo();
    const profitService = makeFakeProfitService([]);
    const service = new SalesService(
      salesRepo as unknown as SalesRepository,
      profitService as unknown as ProfitService,
    );

    service.getChartData("Profit");

    const expectedTo = localDay();
    const expectedFrom = addDaysToDateString(expectedTo, -29);
    expect(profitService.getByDate).toHaveBeenCalledWith(
      expectedFrom,
      expectedTo,
    );
  });
});
