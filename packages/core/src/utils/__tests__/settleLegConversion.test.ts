/**
 * LIRA-359 — the ONE conversion a settle box uses when it is paid in the
 * other currency (owner decisions 2026-10-29). Written with the helper (not
 * proven failing-first: the module is new).
 */
import {
  roundSettleAmount,
  settleLegsNetIn,
  settleLegsTotalByCurrency,
  splitBoxLinesAcrossCurrencies,
} from "../settleLegConversion";

const RATE = 89_000;
const lbp = (amount: number) => ({ currencyCode: "LBP", amount });
const usd = (amount: number) => ({ currencyCode: "USD", amount });

describe("settleLegsNetIn", () => {
  it("an LBP line in a $ box pays its dollar value, rounded to the cent", () => {
    expect(
      settleLegsNetIn([{ currency_code: "LBP", amount: 300_000 }], "USD", RATE),
    ).toBe(3.37);
  });
  it("a $ line in an LBP box pays its lira value", () => {
    expect(
      settleLegsNetIn([{ currency_code: "USD", amount: 8 }], "LBP", RATE),
    ).toBe(712_000);
  });
  it("change handed back is taken off", () => {
    expect(
      settleLegsNetIn(
        [
          { currency_code: "USD", amount: 10 },
          { currency_code: "LBP", amount: 178_000, direction: "OUT" },
        ],
        "USD",
        RATE,
      ),
    ).toBe(8);
  });
  it("rounds like the ledger", () => {
    expect(roundSettleAmount(3.3708, "USD")).toBe(3.37);
    expect(roundSettleAmount(711_999.6, "LBP")).toBe(712_000);
  });
});

describe("settleLegsTotalByCurrency — the Total line", () => {
  it("adds every box's lines by the currency paid in", () => {
    expect(
      settleLegsTotalByCurrency([
        { currency_code: "LBP", amount: 712_000 },
        { currency_code: "LBP", amount: 700_000 },
        { currency_code: "USD", amount: 5 },
        { currency_code: "USD", amount: 1, direction: "OUT" },
      ]),
    ).toEqual({ usd: 4, lbp: 1_412_000 });
  });
});

describe("splitBoxLinesAcrossCurrencies — one box for both currencies", () => {
  it("everything paid in LBP: 700,000 stays on LBP, 17,800,000 pays the $200", () => {
    const out = splitBoxLinesAcrossCurrencies(
      [lbp(18_500_000)],
      { USD: 200, LBP: 700_000 },
      RATE,
    );
    expect(out.LBP).toEqual([lbp(700_000)]);
    expect(out.USD).toEqual([lbp(17_800_000)]);
  });
  it("each currency pays itself first; extra stays in its own currency", () => {
    const out = splitBoxLinesAcrossCurrencies(
      [usd(210), lbp(800_000)],
      { USD: 200, LBP: 700_000 },
      RATE,
    );
    expect(out.USD).toEqual([usd(210)]);
    expect(out.LBP).toEqual([lbp(800_000)]);
  });
  it("dollars cover a lira shortfall", () => {
    const out = splitBoxLinesAcrossCurrencies(
      [usd(208)],
      { USD: 200, LBP: 712_000 },
      RATE,
    );
    expect(out.USD).toEqual([usd(200)]);
    expect(out.LBP).toEqual([usd(8)]);
  });
  it("a box that settles one currency takes every line", () => {
    const out = splitBoxLinesAcrossCurrencies([lbp(17_800_000)], { USD: 200 }, RATE);
    expect(out.USD).toEqual([lbp(17_800_000)]);
    expect(out.LBP).toEqual([]);
  });
});
