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
        type: "CREDIT_TRANSFER",
        amount: 10000,
        price: 5,
        phoneNumber: "+96170123456",
      };

      expect(() => createRechargeSchema.parse(validRecharge)).not.toThrow();
    });

    // CARRIER_LINES_VALIDITY_PLAN.md Phase 6a: this case used to assert that
    // `phoneNumber: "invalid"` throws, because the REST-only copy of this
    // schema used `phoneNumberSchema` (/^\+?[0-9]{8,15}$/). The consolidation
    // adopted the DESKTOP contract, which has always taken a free-form string
    // here — and it had to: the telecom form's Proceed button is not gated on
    // the phone field at all (TelecomForm.tsx:1020-1027), so a CREDIT_TRANSFER
    // submitted with a blank or half-typed number succeeds on desktop today.
    // Applying the regex to the shared schema would start rejecting those at
    // the counter. `phone_number` is a display/lookup label on the recharge
    // row, not money, so the loose side wins. Format checking belongs to the
    // form (and to Phase 6's normalizeLebanesePhone), not to the wire schema.
    it("accepts a free-form phone number (desktop contract — no format gate)", () => {
      const looseRecharge = {
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 10000,
        price: 5,
        phoneNumber: "70 12 34",
      };

      expect(() => createRechargeSchema.parse(looseRecharge)).not.toThrow();
    });

    it("still rejects a non-string phone number", () => {
      const invalidRecharge = {
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 10000,
        price: 5,
        phoneNumber: 70123456,
      };

      expect(() => createRechargeSchema.parse(invalidRecharge)).toThrow();
    });
  });

  describe("createExpenseSchema", () => {
    it("validates valid expense", () => {
      const validExpense = {
        category: "Utilities",
        amount_usd: 100,
        expense_date: "2026-09-23T00:00:00.000Z",
      };

      expect(() => createExpenseSchema.parse(validExpense)).not.toThrow();
    });

    it("uses default values", () => {
      const expense = {
        category: "Rent",
        amount_usd: 500,
        expense_date: "2026-09-23T00:00:00.000Z",
      };

      const parsed = createExpenseSchema.parse(expense);
      expect(parsed.amount_lbp).toBe(0);
      expect(parsed.paid_by_method).toBe("CASH");
    });

    /**
     * Owner ticket #26 (2026-09-23) regression guard, rule 17 (failing-first
     * — this DID fail before `expense_date` was added to the schema, since
     * the field simply didn't exist in the shape and every payload "passed"
     * by having it silently stripped instead of rejected) — rule 23: a
     * REST expense payload missing `expense_date` must be REJECTED here,
     * not silently stripped and forwarded to `ExpenseRepository
     * .createExpense` as `undefined` (which `better-sqlite3` binds as NULL,
     * permanently excluding the row from every Profits date-range query —
     * see `ProfitRepository.expenseReachesProfitsPage.test.ts`).
     */
    it("rejects a payload with no expense_date instead of silently stripping it", () => {
      const missingDate = {
        category: "Utilities",
        amount_usd: 100,
      };

      expect(() => createExpenseSchema.parse(missingDate)).toThrow();
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
        to_code: "LBP",
        market_rate: 90000,
        buy_rate: 89500,
        sell_rate: 90500,
        is_stronger: 1,
      };

      expect(() => setRateSchema.parse(validRate)).not.toThrow();
    });

    it("rejects zero rate", () => {
      const invalidRate = {
        to_code: "LBP",
        market_rate: 0,
        buy_rate: 0,
        sell_rate: 0,
        is_stronger: 1,
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

    // Web-only bug (dual-transport divergence, CLAUDE.md rule 14): the
    // maintenance form (frontend/src/features/maintenance/pages/Maintenance/
    // index.tsx) always sends `client_phone: ""` — never omits the key —
    // when no phone was entered for a walk-in. `phoneNumberSchema.optional()`
    // permits `undefined` but NOT `""`, so this parse used to throw
    // "Invalid phone number format" and the web app could never save a
    // maintenance job for a client without a phone number, even though the
    // desktop IPC copy (`electron-app/schemas/index.ts`'s
    // `client_phone: z.string().optional().nullable()`) has always allowed
    // it. See `optionalPhoneNumberSchema` in `common.ts`.
    it("accepts a blank client_phone (walk-in with no phone, matches desktop)", () => {
      const job = {
        device_name: "iPhone 14",
        price_usd: 150,
        client_phone: "",
      };

      expect(() => saveMaintenanceJobSchema.parse(job)).not.toThrow();
    });

    it("still rejects a malformed non-empty client_phone", () => {
      const job = {
        device_name: "iPhone 14",
        price_usd: 150,
        client_phone: "abc",
      };

      expect(() => saveMaintenanceJobSchema.parse(job)).toThrow(
        "Invalid phone number format",
      );
    });
  });

  describe("createFinancialServiceSchema", () => {
    it("validates OMT transaction", () => {
      const validTransaction = {
        provider: "OMT",
        serviceType: "SEND",
        amount: 500,
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
        amount: 1000,
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
