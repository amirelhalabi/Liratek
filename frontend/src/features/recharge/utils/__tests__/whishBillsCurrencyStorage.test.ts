/** @jest-environment jsdom */
/**
 * LIRA-324 — the Whish App Bills LBP | USD switch is remembered on THIS
 * device. Anything missing, unknown or unreadable means LBP (today's
 * behaviour). Written before the module (rule 17).
 */
import {
  WHISH_BILLS_CURRENCY_KEY,
  loadWhishBillsCurrency,
  saveWhishBillsCurrency,
} from "../whishBillsCurrencyStorage";

describe("whishBillsCurrencyStorage (LIRA-324)", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => jest.restoreAllMocks());

  it("uses the agreed key", () => {
    expect(WHISH_BILLS_CURRENCY_KEY).toBe("liratek:whish-bills-currency");
  });

  it("defaults to LBP when nothing is stored", () => {
    expect(loadWhishBillsCurrency()).toBe("LBP");
  });

  it("defaults to LBP when the stored value is not a known currency", () => {
    window.localStorage.setItem(WHISH_BILLS_CURRENCY_KEY, "EUR");
    expect(loadWhishBillsCurrency()).toBe("LBP");
  });

  it("round-trips USD and LBP", () => {
    saveWhishBillsCurrency("USD");
    expect(window.localStorage.getItem(WHISH_BILLS_CURRENCY_KEY)).toBe("USD");
    expect(loadWhishBillsCurrency()).toBe("USD");
    saveWhishBillsCurrency("LBP");
    expect(loadWhishBillsCurrency()).toBe("LBP");
  });

  it("falls back to LBP and never throws when storage is blocked", () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadWhishBillsCurrency()).toBe("LBP");
    expect(() => saveWhishBillsCurrency("USD")).not.toThrow();
  });
});
