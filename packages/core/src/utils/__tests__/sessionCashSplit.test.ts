import { splitBasketCashOmtFirst } from "../sessionCashSplit";

const RATE = 89_000;
const cash = (currencyCode: string, amount: number) => ({
  currencyCode,
  amount,
  eligible: true,
});

describe("splitBasketCashOmtFirst (LIRA-304, OMT first)", () => {
  it("full cash: the transfer drawer gets exactly the transfer", () => {
    expect(
      splitBasketCashOmtFirst({
        primaryChargeUsd: 101,
        primaryChargeLbp: 0,
        legs: [cash("USD", 134)],
        rate: RATE,
      }),
    ).toEqual([{ pcdAmount: 101, generalAmount: 33 }]);
  });

  it("partly paid: the cash covers the OMT first ($50 → all to the OMT drawer)", () => {
    expect(
      splitBasketCashOmtFirst({
        primaryChargeUsd: 101,
        primaryChargeLbp: 0,
        legs: [cash("USD", 50)],
        rate: RATE,
      }),
    ).toEqual([{ pcdAmount: 50, generalAmount: 0 }]);
  });

  it("overpaid: only the transfer's amount goes in; the rest (and the change) stays General", () => {
    expect(
      splitBasketCashOmtFirst({
        primaryChargeUsd: 101,
        primaryChargeLbp: 0,
        legs: [cash("USD", 150)],
        rate: RATE,
      }),
    ).toEqual([{ pcdAmount: 101, generalAmount: 49 }]);
  });

  it("LBP cash for a USD transfer is converted at the basket rate", () => {
    expect(
      splitBasketCashOmtFirst({
        primaryChargeUsd: 101,
        primaryChargeLbp: 0,
        legs: [cash("LBP", 10_000_000)],
        rate: RATE,
      }),
    ).toEqual([{ pcdAmount: 8_989_000, generalAmount: 1_011_000 }]);
  });

  it("same currency is used before the other currency", () => {
    expect(
      splitBasketCashOmtFirst({
        primaryChargeUsd: 101,
        primaryChargeLbp: 0,
        legs: [cash("LBP", 2_000_000), cash("USD", 100)],
        rate: RATE,
      }),
    ).toEqual([
      { pcdAmount: 89_000, generalAmount: 1_911_000 },
      { pcdAmount: 100, generalAmount: 0 },
    ]);
  });

  it("no transfer, or a non-cash leg → nothing to the transfer drawer", () => {
    expect(
      splitBasketCashOmtFirst({
        primaryChargeUsd: 0,
        primaryChargeLbp: 0,
        legs: [cash("USD", 40)],
        rate: RATE,
      }),
    ).toEqual([{ pcdAmount: 0, generalAmount: 40 }]);
    expect(
      splitBasketCashOmtFirst({
        primaryChargeUsd: 101,
        primaryChargeLbp: 0,
        legs: [{ currencyCode: "USD", amount: 101, eligible: false }],
        rate: RATE,
      }),
    ).toEqual([{ pcdAmount: 0, generalAmount: 101 }]);
  });
});
