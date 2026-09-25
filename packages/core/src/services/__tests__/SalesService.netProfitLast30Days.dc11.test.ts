/**
 * SalesService.getNetProfitLast30Days — DC-11 (OWNER_NOTES_2026-09-21.md
 * §7.2). The "Monthly Net Profit" tile becomes "Net Profit — last 30 days":
 * Σ net profit (gross − expenses, both currencies) over the SAME rolling
 * 30-day window `getChartData("Profit")` reads, from the SAME
 * `ProfitService.getByDate` call family — "no second profit definition".
 *
 * RULE 17 (red observed 2026-09-24): before this method existed,
 * `service.getNetProfitLast30Days` is not a function — TS2339 at compile
 * time (`Property 'getNetProfitLast30Days' does not exist on type
 * 'SalesService'`). Restored after observing the failure.
 */

import { SalesService } from "../SalesService.js";
import type { SalesRepository } from "../../repositories/SalesRepository.js";
import type { ProfitService, ProfitByDate } from "../ProfitService.js";

/**
 * `profit_usd`/`profit_lbp` (GROSS, pre-expenses) are deliberately set to a
 * DIFFERENT value than `net_profit_usd`/`net_profit_lbp` (NET, the field
 * this method must actually sum) — an expenses_usd/expenses_lbp gap of 5/
 * 50,000 on every row. Summing the wrong (gross) field instead of net would
 * therefore change the total, so a regression that swaps `net_profit_usd`
 * for `profit_usd` (this file's own rule-17 proof) is caught, not masked by
 * the two fields happening to carry the same number.
 */
function row(
  date: string,
  net_profit_usd: number,
  net_profit_lbp: number,
): ProfitByDate {
  return {
    date,
    revenue_usd: 0,
    revenue_lbp: 0,
    cost_usd: 0,
    cost_lbp: 0,
    profit_usd: net_profit_usd + 5,
    profit_lbp: net_profit_lbp + 50_000,
    expenses_usd: 5,
    expenses_lbp: 50_000,
    net_profit_usd,
    net_profit_lbp,
  };
}

function makeService(rows: ProfitByDate[]) {
  const salesRepo = { getChartData: jest.fn() };
  const profitService = { getByDate: jest.fn().mockReturnValue(rows) };
  const service = new SalesService(
    salesRepo as unknown as SalesRepository,
    profitService as unknown as ProfitService,
  );
  return { service, profitService };
}

describe("SalesService.getNetProfitLast30Days — DC-11", () => {
  it("sums net_profit_usd/net_profit_lbp across every returned day, per currency", () => {
    const { service } = makeService([
      row("2026-09-01", 10, 100_000),
      row("2026-09-02", -3, -20_000), // a day can legitimately net negative
      row("2026-09-24", 42, 300_000),
    ]);

    const result = service.getNetProfitLast30Days("2026-09-24");

    expect(result.netProfitUSD).toBe(49); // 10 - 3 + 42
    expect(result.netProfitLBP).toBe(380_000); // 100000 - 20000 + 300000
  });

  it("queries ProfitService.getByDate over the SAME 30-day window as getChartData('Profit') — rule 14", () => {
    const { service, profitService } = makeService([]);

    service.getNetProfitLast30Days("2026-09-24");

    expect(profitService.getByDate).toHaveBeenCalledWith(
      "2026-08-26",
      "2026-09-24",
    );
  });

  it("returns 0/0 when the window has no rows at all (never NaN/undefined)", () => {
    const { service } = makeService([]);

    const result = service.getNetProfitLast30Days("2026-09-24");

    expect(result.netProfitUSD).toBe(0);
    expect(result.netProfitLBP).toBe(0);
  });

  it("falls back to clientDay()/localDay() when no endDay is given (rule 27)", () => {
    const { service, profitService } = makeService([]);

    service.getNetProfitLast30Days();

    expect(profitService.getByDate).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });
});
