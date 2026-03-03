/**
 * OMT Fee Calculator Tests
 */

import {
  calculateCommission,
  calculateOnlineBrokerageProfit,
  lookupOmtFee,
  requiresOmtFeeInput,
  hasZeroFees,
  getCommissionRateDisplay,
  OMT_COMMISSION_RATES,
  INTRA_FEE_TIERS,
  WESTERN_UNION_FEE_TIERS,
  ONLINE_BROKERAGE_DEFAULT_RATE,
  ONLINE_BROKERAGE_MIN_RATE,
  ONLINE_BROKERAGE_MAX_RATE,
  OmtServiceType,
} from "../omtFees";

describe("omtFees", () => {
  describe("calculateCommission", () => {
    it("should calculate 10% commission for INTRA", () => {
      expect(calculateCommission("INTRA", 1.0)).toBe(0.1); // $1 fee → $0.10 profit
      expect(calculateCommission("INTRA", 10.0)).toBe(1.0);
      expect(calculateCommission("INTRA", 5.0)).toBe(0.5);
    });

    it("should calculate 10% commission for WESTERN_UNION", () => {
      expect(calculateCommission("WESTERN_UNION", 10.0)).toBe(1.0);
      expect(calculateCommission("WESTERN_UNION", 8.0)).toBe(0.8);
    });

    it("should calculate 25% commission for CASH_TO_BUSINESS", () => {
      expect(calculateCommission("CASH_TO_BUSINESS", 20.0)).toBe(5.0);
      expect(calculateCommission("CASH_TO_BUSINESS", 12.0)).toBe(3.0);
    });

    it("should calculate 25% commission for CASH_TO_GOV", () => {
      expect(calculateCommission("CASH_TO_GOV", 10.0)).toBe(2.5);
    });

    it("should calculate 10% commission for OMT_CARD", () => {
      expect(calculateCommission("OMT_CARD", 10.0)).toBe(1.0);
    });

    it("should calculate 25% commission for OGERO_MECANIQUE", () => {
      expect(calculateCommission("OGERO_MECANIQUE", 10.0)).toBe(2.5);
    });

    it("should return 0 for OMT_WALLET", () => {
      expect(calculateCommission("OMT_WALLET", 10.0)).toBe(0);
      expect(calculateCommission("OMT_WALLET", 100.0)).toBe(0);
    });

    it("should throw error for ONLINE_BROKERAGE", () => {
      expect(() => calculateCommission("ONLINE_BROKERAGE", 10.0)).toThrow(
        "Use calculateOnlineBrokerageProfit()",
      );
    });

    it("should preserve 4 decimal places for small commissions", () => {
      // INTRA $100 transaction → $1 fee → 10% = $0.10
      expect(calculateCommission("INTRA", 1.0)).toBe(0.1);
      // INTRA with odd fee
      expect(calculateCommission("INTRA", 10.33)).toBe(1.033);
    });
  });

  describe("lookupOmtFee", () => {
    describe("INTRA fee table", () => {
      it("should return $1 for amounts 1–100", () => {
        expect(lookupOmtFee("INTRA", 1)).toBe(1);
        expect(lookupOmtFee("INTRA", 50)).toBe(1);
        expect(lookupOmtFee("INTRA", 100)).toBe(1);
      });

      it("should return $2 for amounts 101–150", () => {
        expect(lookupOmtFee("INTRA", 101)).toBe(2);
        expect(lookupOmtFee("INTRA", 150)).toBe(2);
      });

      it("should return $3 for amounts 151–200", () => {
        expect(lookupOmtFee("INTRA", 151)).toBe(3);
        expect(lookupOmtFee("INTRA", 200)).toBe(3);
      });

      it("should return $5 for amounts 251–300", () => {
        expect(lookupOmtFee("INTRA", 300)).toBe(5);
      });

      it("should return $8 for amounts 501–1000", () => {
        expect(lookupOmtFee("INTRA", 501)).toBe(8);
        expect(lookupOmtFee("INTRA", 1000)).toBe(8);
      });

      it("should return $35 for amounts up to 5000", () => {
        expect(lookupOmtFee("INTRA", 5000)).toBe(35);
      });

      it("should return null for amounts above 5000", () => {
        expect(lookupOmtFee("INTRA", 5001)).toBeNull();
      });
    });

    describe("WESTERN_UNION fee table", () => {
      it("should return $5 for amounts 1–50", () => {
        expect(lookupOmtFee("WESTERN_UNION", 1)).toBe(5);
        expect(lookupOmtFee("WESTERN_UNION", 50)).toBe(5);
      });

      it("should return $10 for amounts 50.01–200", () => {
        expect(lookupOmtFee("WESTERN_UNION", 51)).toBe(10);
        expect(lookupOmtFee("WESTERN_UNION", 200)).toBe(10);
      });

      it("should return $20 for amounts 500.01–1000", () => {
        expect(lookupOmtFee("WESTERN_UNION", 1000)).toBe(20);
      });

      it("should return $100 for amounts up to 7500", () => {
        expect(lookupOmtFee("WESTERN_UNION", 7500)).toBe(100);
      });

      it("should return null for amounts above 7500", () => {
        expect(lookupOmtFee("WESTERN_UNION", 7501)).toBeNull();
      });
    });

    describe("service types without fee tables", () => {
      it("should return null for CASH_TO_BUSINESS", () => {
        expect(lookupOmtFee("CASH_TO_BUSINESS", 100)).toBeNull();
      });

      it("should return null for CASH_TO_GOV", () => {
        expect(lookupOmtFee("CASH_TO_GOV", 100)).toBeNull();
      });

      it("should return null for OMT_CARD", () => {
        expect(lookupOmtFee("OMT_CARD", 100)).toBeNull();
      });

      it("should return null for OMT_WALLET", () => {
        expect(lookupOmtFee("OMT_WALLET", 100)).toBeNull();
      });

      it("should return null for OGERO_MECANIQUE", () => {
        expect(lookupOmtFee("OGERO_MECANIQUE", 100)).toBeNull();
      });

      it("should return null for ONLINE_BROKERAGE", () => {
        expect(lookupOmtFee("ONLINE_BROKERAGE", 100)).toBeNull();
      });
    });

    describe("end-to-end: INTRA $100 transaction", () => {
      it("should yield $0.10 profit (10% of $1 fee)", () => {
        const fee = lookupOmtFee("INTRA", 100);
        expect(fee).toBe(1);
        const profit = calculateCommission("INTRA", fee as number);
        expect(profit).toBe(0.1); // $0.10
      });
    });
  });

  describe("calculateOnlineBrokerageProfit", () => {
    it("should use default rate (0.25%) when not specified", () => {
      expect(calculateOnlineBrokerageProfit(800)).toBe(2.0); // 0.25% of 800
      expect(calculateOnlineBrokerageProfit(1000)).toBe(2.5); // 0.25% of 1000
    });

    it("should calculate with custom rate (0.1%)", () => {
      expect(calculateOnlineBrokerageProfit(800, 0.001)).toBe(0.8); // 0.1% of 800
    });

    it("should calculate with custom rate (0.4%)", () => {
      expect(calculateOnlineBrokerageProfit(800, 0.004)).toBe(3.2); // 0.4% of 800
    });

    it("should clamp rate to minimum (0.1%)", () => {
      expect(calculateOnlineBrokerageProfit(1000, 0.0005)).toBe(1.0); // Clamped to 0.1%
    });

    it("should clamp rate to maximum (0.4%)", () => {
      expect(calculateOnlineBrokerageProfit(1000, 0.01)).toBe(4.0); // Clamped to 0.4%
    });

    it("should round to 2 decimal places", () => {
      expect(calculateOnlineBrokerageProfit(333, 0.001)).toBe(0.33);
    });
  });

  describe("requiresOmtFeeInput", () => {
    it("should return true for standard services", () => {
      expect(requiresOmtFeeInput("INTRA")).toBe(true);
      expect(requiresOmtFeeInput("WESTERN_UNION")).toBe(true);
      expect(requiresOmtFeeInput("CASH_TO_BUSINESS")).toBe(true);
      expect(requiresOmtFeeInput("CASH_TO_GOV")).toBe(true);
      expect(requiresOmtFeeInput("OMT_CARD")).toBe(true);
      expect(requiresOmtFeeInput("OGERO_MECANIQUE")).toBe(true);
    });

    it("should return false for OMT_WALLET", () => {
      expect(requiresOmtFeeInput("OMT_WALLET")).toBe(false);
    });

    it("should return false for ONLINE_BROKERAGE", () => {
      expect(requiresOmtFeeInput("ONLINE_BROKERAGE")).toBe(false);
    });
  });

  describe("hasZeroFees", () => {
    it("should return true only for OMT_WALLET", () => {
      expect(hasZeroFees("OMT_WALLET")).toBe(true);
    });

    it("should return false for all other services", () => {
      expect(hasZeroFees("INTRA")).toBe(false);
      expect(hasZeroFees("WESTERN_UNION")).toBe(false);
      expect(hasZeroFees("CASH_TO_BUSINESS")).toBe(false);
      expect(hasZeroFees("CASH_TO_GOV")).toBe(false);
      expect(hasZeroFees("OMT_CARD")).toBe(false);
      expect(hasZeroFees("OGERO_MECANIQUE")).toBe(false);
      expect(hasZeroFees("ONLINE_BROKERAGE")).toBe(false);
    });
  });

  describe("getCommissionRateDisplay", () => {
    it("should format commission rates as percentages", () => {
      expect(getCommissionRateDisplay("INTRA")).toBe("10%");
      expect(getCommissionRateDisplay("WESTERN_UNION")).toBe("10%");
      expect(getCommissionRateDisplay("CASH_TO_BUSINESS")).toBe("25%");
      expect(getCommissionRateDisplay("CASH_TO_GOV")).toBe("25%");
      expect(getCommissionRateDisplay("OMT_WALLET")).toBe("0%");
      expect(getCommissionRateDisplay("OMT_CARD")).toBe("10%");
      expect(getCommissionRateDisplay("OGERO_MECANIQUE")).toBe("25%");
      expect(getCommissionRateDisplay("ONLINE_BROKERAGE")).toBe("0%");
    });
  });

  describe("OMT_COMMISSION_RATES", () => {
    it("should have rates for all 8 service types", () => {
      const serviceTypes: OmtServiceType[] = [
        "INTRA",
        "WESTERN_UNION",
        "CASH_TO_BUSINESS",
        "CASH_TO_GOV",
        "OMT_WALLET",
        "OMT_CARD",
        "OGERO_MECANIQUE",
        "ONLINE_BROKERAGE",
      ];

      serviceTypes.forEach((type) => {
        expect(OMT_COMMISSION_RATES[type]).toBeDefined();
        expect(typeof OMT_COMMISSION_RATES[type]).toBe("number");
      });
    });

    it("should have correct commission rates", () => {
      expect(OMT_COMMISSION_RATES.INTRA).toBe(0.1);
      expect(OMT_COMMISSION_RATES.WESTERN_UNION).toBe(0.1);
      expect(OMT_COMMISSION_RATES.CASH_TO_BUSINESS).toBe(0.25);
      expect(OMT_COMMISSION_RATES.CASH_TO_GOV).toBe(0.25);
      expect(OMT_COMMISSION_RATES.OMT_WALLET).toBe(0.0);
      expect(OMT_COMMISSION_RATES.OMT_CARD).toBe(0.1);
      expect(OMT_COMMISSION_RATES.OGERO_MECANIQUE).toBe(0.25);
      expect(OMT_COMMISSION_RATES.ONLINE_BROKERAGE).toBe(0.0);
    });
  });

  describe("ONLINE_BROKERAGE constants", () => {
    it("should have valid rate bounds", () => {
      expect(ONLINE_BROKERAGE_MIN_RATE).toBe(0.001); // 0.1%
      expect(ONLINE_BROKERAGE_MAX_RATE).toBe(0.004); // 0.4%
      expect(ONLINE_BROKERAGE_DEFAULT_RATE).toBe(0.0025); // 0.25%
    });

    it("should have default within bounds", () => {
      expect(ONLINE_BROKERAGE_DEFAULT_RATE).toBeGreaterThanOrEqual(
        ONLINE_BROKERAGE_MIN_RATE,
      );
      expect(ONLINE_BROKERAGE_DEFAULT_RATE).toBeLessThanOrEqual(
        ONLINE_BROKERAGE_MAX_RATE,
      );
    });
  });
});
