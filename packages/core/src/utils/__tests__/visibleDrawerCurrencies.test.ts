import { visibleDrawerCurrencies } from "../visibleDrawerCurrencies.js";

describe("visibleDrawerCurrencies", () => {
  it("keeps USD and LBP even at zero and hides other zero currencies", () => {
    expect(visibleDrawerCurrencies({ USD: 0, LBP: 0, AUD: 0, EUR: 12 })).toEqual({ USD: 0, LBP: 0, EUR: 12 });
  });

  it("keeps a zero LBP next to a non-zero USD", () => {
    expect(visibleDrawerCurrencies({ USD: 5, LBP: 0 })).toEqual({ USD: 5, LBP: 0 });
  });

  it("shows a drawer's own currencies when the rule would hide them all", () => {
    expect(visibleDrawerCurrencies({ USDT: 0 })).toEqual({ USDT: 0 });
  });

  it("keeps a non-zero non-main currency and drops nothing it should keep", () => {
    expect(visibleDrawerCurrencies({ USDT: 3.5 })).toEqual({ USDT: 3.5 });
    expect(visibleDrawerCurrencies({})).toEqual({});
  });
});
