/**
 * CQ-11 (part A) — partnerSettleSchema split-leg settlement contract.
 *
 * docs/plans/todo_plans/COUNTERPARTY_CONSOLIDATION_PLAN.md, "Extension
 * (2026-07-18)" — partner settlements accept split payment legs (e.g. settle
 * $100 as $60 CASH + $40 OMT) so the shared MultiPaymentInput settle modal
 * can be offered on the Partners page. `payments` is optional and additive —
 * the legacy single `settlementMethod` payload must keep parsing exactly as
 * before (proven in cq8Contract.test.ts, unchanged by this ticket).
 */

import { describe, it, expect } from "@jest/globals";
import { partnerSettleSchema } from "../partner.js";

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    partnerId: 1,
    amount: 100,
    currency: "USD",
    settlementMethod: "CASH",
    ...overrides,
  };
}

describe("partnerSettleSchema — CQ-11 split payment legs", () => {
  it("accepts a well-formed split-leg payload (legs sum to amount, same currency)", () => {
    const result = partnerSettleSchema.safeParse(
      basePayload({
        payments: [
          { method: "CASH", currency_code: "USD", amount: 60 },
          { method: "OMT", currency_code: "USD", amount: 40 },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts legs within the 0.005 sum tolerance", () => {
    const result = partnerSettleSchema.safeParse(
      basePayload({
        payments: [
          { method: "CASH", currency_code: "USD", amount: 60.003 },
          { method: "OMT", currency_code: "USD", amount: 39.998 },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects legs that do not sum to the settlement amount", () => {
    const result = partnerSettleSchema.safeParse(
      basePayload({
        payments: [
          { method: "CASH", currency_code: "USD", amount: 60 },
          { method: "OMT", currency_code: "USD", amount: 30 },
        ],
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          /sum to the settlement amount/i.test(i.message),
        ),
      ).toBe(true);
    }
  });

  it("rejects a leg whose currency_code differs from the settlement currency", () => {
    const result = partnerSettleSchema.safeParse(
      basePayload({
        currency: "USD",
        payments: [
          { method: "CASH", currency_code: "USD", amount: 60 },
          { method: "OMT", currency_code: "LBP", amount: 40 },
        ],
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          /currency_code must match the settlement currency/i.test(i.message),
        ),
      ).toBe(true);
    }
  });

  it("rejects a CLIENT_ACCOUNT leg inside payments[]", () => {
    const result = partnerSettleSchema.safeParse(
      basePayload({
        payments: [
          { method: "CASH", currency_code: "USD", amount: 60 },
          { method: "CLIENT_ACCOUNT", currency_code: "USD", amount: 40 },
        ],
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => /CLIENT_ACCOUNT/.test(i.message)),
      ).toBe(true);
    }
  });

  it("rejects settlementMethod CLIENT_ACCOUNT combined with payments[]", () => {
    const result = partnerSettleSchema.safeParse(
      basePayload({
        settlementMethod: "CLIENT_ACCOUNT",
        payments: [{ method: "CASH", currency_code: "USD", amount: 100 }],
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => /CLIENT_ACCOUNT/.test(i.message)),
      ).toBe(true);
    }
  });

  it("rejects an empty payments array (min 1 when present)", () => {
    const result = partnerSettleSchema.safeParse(basePayload({ payments: [] }));
    expect(result.success).toBe(false);
  });

  it("still accepts the legacy payload with no payments field at all", () => {
    const result = partnerSettleSchema.safeParse(basePayload());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payments).toBeUndefined();
    }
  });
});
