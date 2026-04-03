import {
  calculateExchangeRate,
  isMoneyInTransaction,
  fetchAndCalculateRate,
} from "../exchangeRateCalculator";

describe("exchangeRateCalculator", () => {
  const mockRates = {
    buyRate: 89000,
    sellRate: 89500,
  };

  describe("calculateExchangeRate", () => {
    it("should use SELL rate for money IN transactions", () => {
      const result = calculateExchangeRate({
        transactionType: "SERVICE_PAYMENT",
        selectedCurrency: "LBP",
        isMoneyIn: true,
        rates: mockRates,
      });

      expect(result.rate).toBe(89500);
      expect(result.rateType).toBe("SELL");
      expect(result.description).toContain("SELL");
    });

    it("should use BUY rate for money OUT transactions", () => {
      const result = calculateExchangeRate({
        transactionType: "REFUND",
        selectedCurrency: "LBP",
        isMoneyIn: false,
        rates: mockRates,
      });

      expect(result.rate).toBe(89000);
      expect(result.rateType).toBe("BUY");
      expect(result.description).toContain("BUY");
    });

    it("should return 1 for USD (no conversion)", () => {
      const result = calculateExchangeRate({
        transactionType: "SALE",
        selectedCurrency: "USD",
        isMoneyIn: true,
        rates: mockRates,
      });

      expect(result.rate).toBe(1);
      expect(result.rateType).toBe("N/A");
    });

    it("should use fallback rate if rates are invalid", () => {
      const result = calculateExchangeRate({
        transactionType: "SALE",
        selectedCurrency: "LBP",
        isMoneyIn: true,
        rates: { buyRate: 0, sellRate: 0 },
        fallbackRate: 90000,
      });

      expect(result.rate).toBe(90000);
    });

    it("should handle SERVICE_PAYMENT for IPEC/KATCH/OMT", () => {
      const resultIn = calculateExchangeRate({
        transactionType: "SERVICE_PAYMENT",
        selectedCurrency: "LBP",
        isMoneyIn: true, // Customer pays
        rates: mockRates,
      });

      expect(resultIn.rate).toBe(89500); // SELL rate
      expect(resultIn.rateType).toBe("SELL");
    });

    it("should handle DEBT_PAYMENT correctly", () => {
      const result = calculateExchangeRate({
        transactionType: "DEBT_PAYMENT",
        selectedCurrency: "LBP",
        isMoneyIn: true, // Customer repays
        rates: mockRates,
      });

      expect(result.rate).toBe(89500); // SELL rate
      expect(result.rateType).toBe("SELL");
    });

    it("should handle CUSTOM_SERVICE correctly", () => {
      const result = calculateExchangeRate({
        transactionType: "CUSTOM_SERVICE",
        selectedCurrency: "LBP",
        isMoneyIn: true, // Customer pays
        rates: mockRates,
      });

      expect(result.rate).toBe(89500); // SELL rate
    });
  });

  describe("isMoneyInTransaction", () => {
    it("should return true for revenue transactions", () => {
      expect(isMoneyInTransaction("SALE")).toBe(true);
      expect(isMoneyInTransaction("DEBT_PAYMENT")).toBe(true);
      expect(isMoneyInTransaction("SERVICE_PAYMENT")).toBe(true);
      expect(isMoneyInTransaction("CUSTOM_SERVICE")).toBe(true);
      expect(isMoneyInTransaction("EXCHANGE_BUY_USD")).toBe(true);
    });

    it("should return false for expense transactions", () => {
      expect(isMoneyInTransaction("REFUND")).toBe(false);
      expect(isMoneyInTransaction("EXPENSE")).toBe(false);
      expect(isMoneyInTransaction("EXCHANGE_SELL_USD")).toBe(false);
    });
  });

  describe("fetchAndCalculateRate", () => {
    it("should fetch rates and calculate correctly", async () => {
      const mockApi = {
        getRates: async () => [
          { from_code: "USD", to_code: "LBP", rate: 89500 },
          { from_code: "LBP", to_code: "USD", rate: 89000 },
        ],
      };

      const rate = await fetchAndCalculateRate(
        mockApi,
        "SERVICE_PAYMENT",
        "LBP",
        89000,
      );

      expect(rate).toBe(89500); // SELL rate for money IN
    });

    it("should use fallback rate if API fails", async () => {
      const mockApi = {
        getRates: async () => {
          throw new Error("API error");
        },
      };

      const rate = await fetchAndCalculateRate(
        mockApi,
        "SERVICE_PAYMENT",
        "LBP",
        90000,
      );

      expect(rate).toBe(90000); // Fallback rate
    });
  });

  describe("Financial Impact Scenarios", () => {
    it("should calculate correct amount for $100 IPEC payment (Money IN)", () => {
      const result = calculateExchangeRate({
        transactionType: "SERVICE_PAYMENT",
        selectedCurrency: "LBP",
        isMoneyIn: true,
        rates: mockRates,
      });

      const amountUSD = 100;
      const amountLBP = amountUSD * result.rate;

      expect(result.rate).toBe(89500); // SELL rate
      expect(amountLBP).toBe(8950000); // Customer pays 8,950,000 LBP
    });

    it("should calculate correct amount for $100 IPEC refund (Money OUT)", () => {
      const result = calculateExchangeRate({
        transactionType: "REFUND",
        selectedCurrency: "LBP",
        isMoneyIn: false,
        rates: mockRates,
      });

      const amountUSD = 100;
      const amountLBP = amountUSD * result.rate;

      expect(result.rate).toBe(89000); // BUY rate
      expect(amountLBP).toBe(8900000); // We pay 8,900,000 LBP

      // Verify savings vs wrong rate
      const wrongAmount = amountUSD * mockRates.sellRate;
      const savings = wrongAmount - amountLBP;
      expect(savings).toBe(50000); // Save 50,000 LBP per $100 refund
    });
  });
});
