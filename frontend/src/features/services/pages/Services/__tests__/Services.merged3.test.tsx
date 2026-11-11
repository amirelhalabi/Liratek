/**
 * Services — 2 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 2).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import * as fs from "fs";
import * as path from "path";
import * as core from "@liratek/core";
import { describe, it, expect } from "@jest/globals";

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("Services.feeTablesFromCore (LIRA-185)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Services page — the OMT commission rates and the INTRA / Western Union /
   * Whish fee tiers must come from @liratek/core, never a hand-copied table
   * (LIRA-185 display lead 11, rule 14).
   *
   * The page carried its own copies "must match omtFees.ts" — a second
   * definition nothing forced to agree with the first. If a core rate changed,
   * the form's preview would promise one commission while the repository
   * booked another. This guard fails if any of those tables (or the lookup
   * helpers built on them) is re-declared locally in the page, and if the core
   * tables are not reachable from the browser entry the frontend resolves.
   */

  const PAGE = path.resolve(__dirname, "../index.tsx");

  describe("Services page — fee tables are imported from @liratek/core", () => {
    const src = fs.readFileSync(PAGE, "utf8");

    it.each([
      "OMT_COMMISSION_RATES",
      "INTRA_FEE_TIERS",
      "WESTERN_UNION_FEE_TIERS",
      "WHISH_FEE_TIERS",
      "INTRA_LBP_MAX_AMOUNT",
    ])("does not declare its own %s", (name) => {
      expect(src).not.toMatch(new RegExp(`\\bconst\\s+${name}\\b`));
    });

    it.each(["lookupOmtFee", "lookupIntraLbpFee"])(
      "does not declare its own %s()",
      (name) => {
        expect(src).not.toMatch(new RegExp(`\\bfunction\\s+${name}\\b`));
      },
    );

    it("the core tables are exported from the browser entry the frontend resolves", () => {
      const c = core as unknown as Record<string, unknown>;
      expect(Array.isArray(c.INTRA_FEE_TIERS)).toBe(true);
      expect(Array.isArray(c.WESTERN_UNION_FEE_TIERS)).toBe(true);
      expect(Array.isArray(c.WHISH_FEE_TIERS)).toBe(true);
      expect((c.OMT_COMMISSION_RATES as Record<string, number>)?.INTRA).toBe(
        0.1,
      );
      expect(typeof c.lookupOmtFee).toBe("function");
      expect(typeof c.lookupIntraLbpFee).toBe("function");
    });
  });
});

describe("Services.multi-payment", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Unit tests for Services page multi-payment integration (Phase 3)
   */

  describe("Services Page - Multi-Payment Integration", () => {
    describe("Payment Mode Toggle", () => {
      it("should default to single payment mode", () => {
        const useMultiPayment = false;
        expect(useMultiPayment).toBe(false);
      });

      it("should toggle between single and multi payment modes", () => {
        let useMultiPayment = false;

        // Toggle to multi
        useMultiPayment = true;
        expect(useMultiPayment).toBe(true);

        // Toggle back to single
        useMultiPayment = false;
        expect(useMultiPayment).toBe(false);
      });
    });

    describe("Payment Data Submission", () => {
      it("should send paidByMethod in single payment mode", () => {
        const useMultiPayment = false;
        const paidByMethod = "CASH";
        const paymentLines: any[] = [];

        const payload =
          useMultiPayment && paymentLines.length > 0
            ? { payments: paymentLines }
            : { paidByMethod };

        expect(payload).toEqual({ paidByMethod: "CASH" });
      });

      it("should send payments array in multi-payment mode", () => {
        const useMultiPayment = true;
        const paidByMethod = "CASH";
        const paymentLines = [
          { id: "1", method: "CASH", currencyCode: "USD", amount: 50 },
          { id: "2", method: "OMT", currencyCode: "USD", amount: 50 },
        ];

        const payload =
          useMultiPayment && paymentLines.length > 0
            ? {
                payments: paymentLines.map((p) => ({
                  method: p.method,
                  currencyCode: p.currencyCode,
                  amount: p.amount,
                })),
              }
            : { paidByMethod };

        expect(payload).toEqual({
          payments: [
            { method: "CASH", currencyCode: "USD", amount: 50 },
            { method: "OMT", currencyCode: "USD", amount: 50 },
          ],
        });
      });

      it("should not include payment line IDs in submission", () => {
        const paymentLines = [
          { id: "uuid-1", method: "CASH", currencyCode: "USD", amount: 100 },
        ];

        const payments = paymentLines.map((p) => ({
          method: p.method,
          currencyCode: p.currencyCode,
          amount: p.amount,
        }));

        expect(payments[0]).not.toHaveProperty("id");
        expect(payments[0]).toEqual({
          method: "CASH",
          currencyCode: "USD",
          amount: 100,
        });
      });
    });

    describe("Form Reset", () => {
      it("should reset multi-payment state on successful submission", () => {
        let useMultiPayment = true;
        let paymentLines = [
          { id: "1", method: "CASH", currencyCode: "USD", amount: 50 },
        ];

        // Simulate reset
        useMultiPayment = false;
        paymentLines = [];

        expect(useMultiPayment).toBe(false);
        expect(paymentLines).toEqual([]);
      });
    });

    describe("Including Fees Checkbox", () => {
      it("should only show for SEND transactions", () => {
        const serviceType = "SEND" as const;
        const shouldShow = serviceType === "SEND";

        expect(shouldShow).toBe(true);
      });

      it("should not show for COLLECT transactions", () => {
        const serviceType: string = "COLLECT";
        const shouldShow = serviceType === "SEND";

        expect(shouldShow).toBe(false);
      });

      it("should default to false (fees not included)", () => {
        const includingFees = false;
        expect(includingFees).toBe(false);
      });
    });

    describe("UI Simplification", () => {
      it("should not require OMT fee input (backend calculates)", () => {
        // No frontend validation for OMT fee anymore
        // Should allow submission without omtFee
        const isValid = true; // No frontend validation
        expect(isValid).toBe(true);
      });

      it("should not display calculated commission preview", () => {
        // Commission calculation removed from frontend
        const showCommissionPreview = false;
        expect(showCommissionPreview).toBe(false);
      });
    });
  });
});
