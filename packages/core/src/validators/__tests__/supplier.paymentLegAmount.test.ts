/**
 * CQ-5 zero/negative-leg follow-up (COUNTERPARTY_CONSOLIDATION_PLAN.md).
 *
 * DebtRepository's leg loops skip zero/negative-amount legs
 * (`if (leg.amount <= 0) continue;`); SupplierRepository's
 * `settleTransactions`/`recordSupplierCashflow` loops and PartnerRepository's
 * split-leg loop don't have an equivalent runtime guard. Investigation:
 * - PartnerRepository's `legs` param is unreachable with a zero/negative leg
 *   through any validated transport — `partnerSettlementLegSchema.amount` is
 *   already `z.number().positive()` (partner.ts).
 * - SupplierRepository's `payments` param WAS reachable with a zero (or even
 *   negative) leg through both IPC and REST: `supplierPaymentLegSchema.amount`
 *   was a bare `z.number()`. The one shipped UI caller (Suppliers/index.tsx)
 *   filters `.filter(l => l.amount > 0)` client-side, but that is not an
 *   input-validation boundary — a direct IPC/REST call could still send
 *   `amount: 0` (noise: a $0 payments row + a harmless no-op drawer upsert)
 *   or a negative amount (silently coerced to its magnitude by the
 *   repository's `Math.abs()` — a real, if obscure, money-shape wrinkle).
 *
 * Fix: tighten the shared `supplierPaymentLegSchema.amount` to
 * `z.number().positive()`, matching the partner leg schema's existing
 * convention, instead of adding runtime skip-guards to the repository loops
 * (right-sized: rejects malformed input at the boundary rather than
 * special-casing it after the fact).
 *
 * This suite is written failing-first: run it against the pre-fix schema
 * (bare `z.number()`) to see the "rejects a zero/negative leg" cases fail,
 * then apply the `.positive()` tightening and re-run to confirm green.
 */

import { describe, it, expect } from "@jest/globals";
import { supplierCashflowSchema, supplierSettleSchema } from "../supplier.js";

describe("supplierPaymentLegSchema (via supplierCashflowSchema) — leg amount bounds", () => {
  function cashflowPayload(amount: number) {
    return {
      supplier_id: 1,
      direction: "PAY" as const,
      payments: [{ method: "CASH", currency_code: "USD", amount }],
    };
  }

  it("rejects a zero-amount payment leg", () => {
    const result = supplierCashflowSchema.safeParse(cashflowPayload(0));
    expect(result.success).toBe(false);
  });

  it("rejects a negative-amount payment leg", () => {
    const result = supplierCashflowSchema.safeParse(cashflowPayload(-25));
    expect(result.success).toBe(false);
  });

  it("still accepts a well-formed positive-amount leg", () => {
    const result = supplierCashflowSchema.safeParse(cashflowPayload(25));
    expect(result.success).toBe(true);
  });
});

describe("supplierPaymentLegSchema (via supplierSettleSchema) — leg amount bounds", () => {
  function settlePayload(payments?: Array<{ amount: number }>) {
    return {
      supplier_id: 1,
      financial_service_ids: [1],
      amount_usd: 25,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
      drawer_name: "General",
      ...(payments
        ? {
            payments: payments.map((p) => ({
              method: "CASH",
              currency_code: "USD",
              amount: p.amount,
            })),
          }
        : {}),
    };
  }

  it("rejects a zero-amount payment leg", () => {
    const result = supplierSettleSchema.safeParse(
      settlePayload([{ amount: 0 }]),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a negative-amount payment leg", () => {
    const result = supplierSettleSchema.safeParse(
      settlePayload([{ amount: -10 }]),
    );
    expect(result.success).toBe(false);
  });

  it("still accepts a well-formed positive-amount leg", () => {
    const result = supplierSettleSchema.safeParse(
      settlePayload([{ amount: 25 }]),
    );
    expect(result.success).toBe(true);
  });

  it("still accepts the legacy payload with no payments field at all", () => {
    const result = supplierSettleSchema.safeParse(settlePayload());
    expect(result.success).toBe(true);
  });
});
