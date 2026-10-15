/**
 * LIRA-322 one-box follow-up — `assignChangeLegs`: which currency section
 * each change (OUT) leg of the ONE payment box is sent in. A change leg in a
 * SHORT section would be subtracted from that currency's payment and net the
 * two currencies, so change always goes to the overpaid currency.
 *
 * Written together with the helper — not proven failing-first.
 */
import { assignChangeLegs } from "../accountSettleMath";

const leg = (currencyCode: "USD" | "LBP", amount: number) => ({
  id: `${currencyCode}-${amount}`,
  method: "CASH",
  currencyCode,
  amount,
  direction: "OUT" as const,
});

describe("assignChangeLegs", () => {
  it("one currency overpaid: every change leg goes to that section, whatever its currency", () => {
    const out = assignChangeLegs(
      [leg("LBP", 267000)],
      { USD: 3, LBP: -900000 },
      "USD",
    );
    expect(out.USD.map((l) => [l.currencyCode, l.amount])).toEqual([
      ["LBP", 267000],
    ]);
    expect(out.LBP).toEqual([]);
  });

  it("only LBP overpaid: a $ change leg goes to the LBP section", () => {
    const out = assignChangeLegs(
      [leg("USD", 1)],
      { USD: 0, LBP: 89000 },
      "USD",
    );
    expect(out.LBP.map((l) => [l.currencyCode, l.amount])).toEqual([
      ["USD", 1],
    ]);
    expect(out.USD).toEqual([]);
  });

  it("both overpaid: each leg fills its own section first, the rest crosses over", () => {
    // $3 + 89,000 LBP over, all handed back in $ ($4).
    const out = assignChangeLegs(
      [leg("USD", 4)],
      { USD: 3, LBP: 89000 },
      "USD",
    );
    expect(out.USD.map((l) => [l.currencyCode, l.amount])).toEqual([
      ["USD", 3],
    ]);
    expect(out.LBP.map((l) => [l.currencyCode, l.amount])).toEqual([
      ["USD", 1],
    ]);
  });

  it("both overpaid, handed back in each currency: each leg stays in its own section", () => {
    const out = assignChangeLegs(
      [leg("USD", 3), leg("LBP", 89000)],
      { USD: 3, LBP: 89000 },
      "USD",
    );
    expect(out.USD.map((l) => [l.currencyCode, l.amount])).toEqual([
      ["USD", 3],
    ]);
    expect(out.LBP.map((l) => [l.currencyCode, l.amount])).toEqual([
      ["LBP", 89000],
    ]);
  });

  it("extras within the box's tolerance do not count as overpaid; zero legs are dropped", () => {
    const out = assignChangeLegs(
      [leg("USD", 0), leg("USD", 2)],
      { USD: 0.005, LBP: 50 },
      "LBP",
    );
    expect(out.LBP.map((l) => l.amount)).toEqual([2]);
    expect(out.USD).toEqual([]);
  });
});
