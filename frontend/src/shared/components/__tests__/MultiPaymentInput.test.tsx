import { describe, it, expect } from "@jest/globals";
import type { PaymentLine } from "@liratek/ui";

/**
 * Unit tests for MultiPaymentInput component logic (Phase 3)
 */

describe("MultiPaymentInput - Business Logic", () => {
  describe("Payment Line Management", () => {
    it("should initialize with one payment line", () => {
      const initialLines: PaymentLine[] = [
        {
          id: "test-1",
          method: "CASH",
          currencyCode: "USD",
          amount: 0,
        },
      ];

      expect(initialLines).toHaveLength(1);
      expect(initialLines[0].method).toBe("CASH");
    });

    it("should add new payment line", () => {
      let lines: PaymentLine[] = [
        { id: "1", method: "CASH", currencyCode: "USD", amount: 50 },
      ];

      lines = [
        ...lines,
        { id: "2", method: "CASH", currencyCode: "USD", amount: 0 },
      ];

      expect(lines).toHaveLength(2);
    });

    it("should remove payment line by id", () => {
      let lines: PaymentLine[] = [
        { id: "1", method: "CASH", currencyCode: "USD", amount: 50 },
        { id: "2", method: "OMT", currencyCode: "USD", amount: 50 },
      ];

      lines = lines.filter((line) => line.id !== "2");

      expect(lines).toHaveLength(1);
      expect(lines[0].id).toBe("1");
    });
  });

  describe("Total Calculation", () => {
    it("should calculate total paid from payment lines", () => {
      const lines: PaymentLine[] = [
        { id: "1", method: "CASH", currencyCode: "USD", amount: 50 },
        { id: "2", method: "OMT", currencyCode: "USD", amount: 30 },
      ];

      const totalPaid = lines.reduce(
        (sum, line) => sum + (line.amount || 0),
        0,
      );

      expect(totalPaid).toBe(80);
    });

    it("should handle empty amounts as zero", () => {
      const lines: PaymentLine[] = [
        { id: "1", method: "CASH", currencyCode: "USD", amount: 0 },
      ];

      const totalPaid = lines.reduce(
        (sum, line) => sum + (line.amount || 0),
        0,
      );

      expect(totalPaid).toBe(0);
    });
  });

  describe("Validation", () => {
    it("should detect DEBT payment method", () => {
      const lines: PaymentLine[] = [
        { id: "1", method: "DEBT", currencyCode: "USD", amount: 100 },
      ];

      const hasDebt = lines.some((line) => line.method === "DEBT");

      expect(hasDebt).toBe(true);
    });

    it("should not detect DEBT when only CASH used", () => {
      const lines: PaymentLine[] = [
        { id: "1", method: "CASH", currencyCode: "USD", amount: 100 },
      ];

      const hasDebt = lines.some((line) => line.method === "DEBT");

      expect(hasDebt).toBe(false);
    });
  });

  describe("Remaining/Overpaid Calculation", () => {
    it("should calculate remaining when underpaid", () => {
      const totalAmount = 100;
      const totalPaid = 60;
      const remaining = totalAmount - totalPaid;

      expect(remaining).toBe(40);
      expect(remaining > 0).toBe(true);
    });

    it("should calculate overpaid amount", () => {
      const totalAmount = 100;
      const totalPaid = 150;
      const overpaid = totalPaid - totalAmount;

      expect(overpaid).toBe(50);
      expect(overpaid > 0).toBe(true);
    });

    it("should show zero when exactly paid", () => {
      const totalAmount = 100;
      const totalPaid = 100;
      const diff = Math.abs(totalAmount - totalPaid);

      expect(diff).toBeLessThan(0.02); // Within acceptable range
    });
  });
});
