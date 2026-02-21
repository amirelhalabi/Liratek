import { describe, it, expect } from "@jest/globals";
import {
  createSaleSchema,
  addRepaymentSchema,
  createExchangeSchema,
  createRechargeSchema,
  createExpenseSchema,
  createDailyClosingSchema,
  setOpeningBalancesSchema,
  setRateSchema,
  saveMaintenanceJobSchema,
  createFinancialServiceSchema,
} from "../index.js";

describe("Validation Schemas", () => {
  describe("createSaleSchema", () => {
    it("validates valid sale data", () => {
      const validSale = {
        items: [{ product_id: 1, quantity: 2, unit_price_usd: 10 }],
        total_usd: 20,
        final_amount: 20,
        payment_method: "CASH",
      };

      expect(() => createSaleSchema.parse(validSale)).not.toThrow();
    });

    it("rejects sale with no items", () => {
      const invalidSale = {
        items: [],
        total_usd: 0,
        final_amount: 0,
      };

      expect(() => createSaleSchema.parse(invalidSale)).toThrow(
        "At least one item is required",
      );
    });

    it("rejects negative amounts", () => {
      const invalidSale = {
        items: [{ product_id: 1, quantity: -2, unit_price_usd: 10 }],
        total_usd: 20,
        final_amount: 20,
      };

      expect(() => createSaleSchema.parse(invalidSale)).toThrow();
    });
  });

  describe("addRepaymentSchema", () => {
    it("validates repayment with USD only", () => {
      const validRepayment = {
        clientId: 1,
        amountUSD: 50,
        amountLBP: 0,
      };

      expect(() => addRepaymentSchema.parse(validRepayment)).not.toThrow();
    });

    it("validates repayment with LBP only", () => {
      const validRepayment = {
        clientId: 1,
        amountUSD: 0,
        amountLBP: 500000,
      };

      expect(() => addRepaymentSchema.parse(validRepayment)).not.toThrow();
    });

    it("rejects repayment with both amounts zero", () => {
      const invalidRepayment = {
        clientId: 1,
        amountUSD: 0,
        amountLBP: 0,
      };

      expect(() => addRepaymentSchema.parse(invalidRepayment)).toThrow(
        "At least one amount (USD or LBP) must be greater than 0",
      );
    });
  });

  describe("createExchangeSchema", () => {
    it("validates valid exchange", () => {
      const validExchange = {
        fromCurrency: "USD",
        toCurrency: "LBP",
        amountIn: 100,
        amountOut: 9000000,
        rate: 90000,
      };

      expect(() => createExchangeSchema.parse(validExchange)).not.toThrow();
    });

    it("rejects same currency exchange", () => {
      const invalidExchange = {
        fromCurrency: "USD",
        toCurrency: "USD",
        amountIn: 100,
        amountOut: 100,
        rate: 1,
      };

      expect(() => createExchangeSchema.parse(invalidExchange)).toThrow(
        "From and To currencies must be different",
      );
    });
  });

  describe("createRechargeSchema", () => {
    it("validates valid recharge", () => {
      const validRecharge = {
        provider: "MTC",
        type: "prepaid",
        amount: 10000,
        price: 5,
        phoneNumber: "+96170123456",
      };

      expect(() => createRechargeSchema.parse(validRecharge)).not.toThrow();
    });

    it("rejects invalid phone number", () => {
      const invalidRecharge = {
        provider: "MTC",
        type: "prepaid",
        amount: 10000,
        price: 5,
        phoneNumber: "invalid",
      };

      expect(() => createRechargeSchema.parse(invalidRecharge)).toThrow();
    });
  });

  describe("createExpenseSchema", () => {
    it("validates valid expense", () => {
      const validExpense = {
        category: "Utilities",
        amount_usd: 100,
      };

      expect(() => createExpenseSchema.parse(validExpense)).not.toThrow();
    });

    it("uses default values", () => {
      const expense = {
        category: "Rent",
        amount_usd: 500,
      };

      const parsed = createExpenseSchema.parse(expense);
      expect(parsed.amount_lbp).toBe(0);
      expect(parsed.paid_by_method).toBe("CASH");
    });
  });

  describe("setOpeningBalancesSchema", () => {
    it("validates valid opening balances", () => {
      const validData = {
        closingDate: "2024-02-14",
        amounts: [
          { currency: "USD", amount: 1000 },
          { currency: "LBP", amount: 90000000 },
        ],
        userId: 1,
      };

      expect(() => setOpeningBalancesSchema.parse(validData)).not.toThrow();
    });

    it("rejects invalid date format", () => {
      const invalidData = {
        closingDate: "14/02/2024",
        amounts: [{ currency: "USD", amount: 1000 }],
        userId: 1,
      };

      expect(() => setOpeningBalancesSchema.parse(invalidData)).toThrow();
    });

    it("rejects empty amounts array", () => {
      const invalidData = {
        closingDate: "2024-02-14",
        amounts: [],
        userId: 1,
      };

      expect(() => setOpeningBalancesSchema.parse(invalidData)).toThrow(
        "At least one drawer amount is required",
      );
    });
  });

  describe("createDailyClosingSchema", () => {
    it("validates valid daily closing", () => {
      const validData = {
        closingDate: "2024-02-14",
        amounts: [
          { currency: "USD", amount: 500 },
          { currency: "LBP", amount: 45000000 },
        ],
        userId: 1,
        notes: "All good",
      };

      expect(() => createDailyClosingSchema.parse(validData)).not.toThrow();
    });
  });

  describe("setRateSchema", () => {
    it("validates valid rate", () => {
      const validRate = {
        fromCurrency: "USD",
        toCurrency: "LBP",
        rate: 90000,
      };

      expect(() => setRateSchema.parse(validRate)).not.toThrow();
    });

    it("rejects zero rate", () => {
      const invalidRate = {
        fromCurrency: "USD",
        toCurrency: "LBP",
        rate: 0,
      };

      expect(() => setRateSchema.parse(invalidRate)).toThrow();
    });
  });

  describe("saveMaintenanceJobSchema", () => {
    it("validates new maintenance job", () => {
      const validJob = {
        device_name: "iPhone 14",
        price_usd: 150,
        client_phone: "+96170123456",
      };

      expect(() => saveMaintenanceJobSchema.parse(validJob)).not.toThrow();
    });

    it("validates job update with id", () => {
      const validUpdate = {
        id: 1,
        device_name: "iPhone 14 Pro",
        price_usd: 200,
        status: "Delivered_Paid",
      };

      expect(() => saveMaintenanceJobSchema.parse(validUpdate)).not.toThrow();
    });

    it("uses default status", () => {
      const job = {
        device_name: "Samsung S23",
        price_usd: 100,
      };

      const parsed = saveMaintenanceJobSchema.parse(job);
      expect(parsed.status).toBe("Received");
    });

    it("validates job with payment lines", () => {
      const job = {
        device_name: "MacBook Pro",
        price_usd: 300,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 200 },
          { method: "OMT", currency_code: "USD", amount: 100 },
        ],
        change_given_usd: 0,
        status: "Delivered_Paid",
      };

      expect(() => saveMaintenanceJobSchema.parse(job)).not.toThrow();
    });
  });

  describe("createFinancialServiceSchema", () => {
    it("validates OMT transaction", () => {
      const validTransaction = {
        provider: "OMT",
        serviceType: "SEND",
        referenceNumber: "OMT123456",
        senderName: "John Doe",
        receiverName: "Jane Smith",
        amountUSD: 500,
        commissionUSD: 5,
      };

      expect(() =>
        createFinancialServiceSchema.parse(validTransaction),
      ).not.toThrow();
    });

    it("validates WHISH transaction", () => {
      const validTransaction = {
        provider: "WHISH",
        serviceType: "RECEIVE",
        referenceNumber: "WHISH789",
        senderName: "Alice",
        receiverName: "Bob",
        amountUSD: 1000,
        commissionUSD: 10,
        drawer: "OMT_Drawer",
      };

      expect(() =>
        createFinancialServiceSchema.parse(validTransaction),
      ).not.toThrow();
    });
  });
});
