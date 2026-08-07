/**
 * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §6bis finding 6 / Phase A2 Fix 3.
 *
 * The electron-app duplicate of createFinancialServiceSchema
 * (`FinancialServiceSchema` in ../index.ts) used to carry ZERO `.refine()`s
 * on the `feePayments` field — every misuse path the core validator guards
 * against (fee-included transactions, non-RECEIVE service types, partner
 * transactions, zero/omitted fee) would validate successfully through the
 * desktop IPC path. This file proves the four refines mirrored onto
 * `FinancialServiceSchema` actually reject those payloads, and that a
 * legitimate fee-on-top RECEIVE payload still passes (no regression).
 *
 * Rule 17 (prove regression tests against the buggy code): each `it` below
 * was run once with its guarding refine commented out in ../index.ts,
 * confirmed to wrongly pass (`result.success === true`), then re-run after
 * restoring the refine to confirm it correctly fails. See the task report
 * for the exact before/after output — this file itself only asserts the
 * fixed (current) behavior.
 */
import { FinancialServiceSchema } from "../index";

// A minimal, legitimate fee-on-top RECEIVE payload: no partnerId, a
// non-zero omtFee, includingFees false, feePayments summing to the fee.
// Every test below starts from this and overrides exactly the field(s)
// under test, so each case isolates ONE refine.
const basePayload = {
  provider: "OMT" as const,
  serviceType: "RECEIVE" as const,
  amount: 100,
  currency: "USD",
  omtFee: 5,
  includingFees: false,
  feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
};

function issuesFor(
  result: ReturnType<typeof FinancialServiceSchema.safeParse>,
) {
  if (result.success) return [];
  return result.error.issues.map((i) => ({
    path: i.path,
    message: i.message,
  }));
}

describe("FinancialServiceSchema — feePayments refines (§6bis finding 6)", () => {
  it("baseline: accepts feePayments on a valid fee-on-top RECEIVE payload", () => {
    const result = FinancialServiceSchema.safeParse(basePayload);
    expect(result.success).toBe(true);
  });

  it("rejects feePayments + partnerId present in FOR mode", () => {
    const result = FinancialServiceSchema.safeParse({
      ...basePayload,
      partnerId: 1,
      partnerMode: "FOR" as const,
    });
    expect(result.success).toBe(false);
    expect(issuesFor(result)).toContainEqual({
      path: ["feePayments"],
      message:
        "feePayments cannot be used on a partner transaction — the partner handles the fee",
    });
  });

  it("rejects feePayments + partnerId present in THROUGH mode", () => {
    const result = FinancialServiceSchema.safeParse({
      ...basePayload,
      partnerId: 1,
      partnerMode: "THROUGH" as const,
    });
    expect(result.success).toBe(false);
    expect(issuesFor(result)).toContainEqual({
      path: ["feePayments"],
      message:
        "feePayments cannot be used on a partner transaction — the partner handles the fee",
    });
  });

  it("rejects feePayments + omtFee: 0 (whishFee absent)", () => {
    const result = FinancialServiceSchema.safeParse({
      ...basePayload,
      omtFee: 0,
    });
    expect(result.success).toBe(false);
    expect(issuesFor(result)).toContainEqual({
      path: ["feePayments"],
      message:
        "feePayments requires a non-zero omtFee/whishFee/commission — there is no fee to collect",
    });
  });

  it("rejects feePayments + omtFee omitted entirely (whishFee absent)", () => {
    const { omtFee: _omtFee, ...withoutOmtFee } = basePayload;
    const result = FinancialServiceSchema.safeParse(withoutOmtFee);
    expect(result.success).toBe(false);
    expect(issuesFor(result)).toContainEqual({
      path: ["feePayments"],
      message:
        "feePayments requires a non-zero omtFee/whishFee/commission — there is no fee to collect",
    });
  });

  // §10.2 — BINANCE has no omtFee/whishFee field of its own; its fee
  // travels in `commission` (the live frontend contract, CryptoForm.tsx's
  // `commission: fee`). Without this escape clause the zero-fee refine
  // above would reject every legitimate BINANCE mode-C payload at the
  // schema layer, before it ever reaches the repository's own
  // (already-correct) `calculatedCommission`-aware guard. Mirrors
  // packages/core's `createFinancialServiceSchema` equivalent cases in
  // FinancialServiceRepository.receiveFeeLegs.test.ts (§10.2 block).
  it("accepts feePayments on a BINANCE fee-on-top RECEIVE via commission (no omtFee/whishFee)", () => {
    const result = FinancialServiceSchema.safeParse({
      provider: "BINANCE" as const,
      serviceType: "RECEIVE" as const,
      amount: 100,
      currency: "USDT",
      commission: 5,
      cashoutMethod: "CASH",
      feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects feePayments on a BINANCE RECEIVE when commission is 0 (no fee to collect)", () => {
    const result = FinancialServiceSchema.safeParse({
      provider: "BINANCE" as const,
      serviceType: "RECEIVE" as const,
      amount: 100,
      currency: "USDT",
      commission: 0,
      cashoutMethod: "CASH",
      feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
    });
    expect(result.success).toBe(false);
    expect(issuesFor(result)).toContainEqual({
      path: ["feePayments"],
      message:
        "feePayments requires a non-zero omtFee/whishFee/commission — there is no fee to collect",
    });
  });

  it("rejects feePayments + includingFees: true (sanity check — pre-existing-style refine)", () => {
    const result = FinancialServiceSchema.safeParse({
      ...basePayload,
      includingFees: true,
    });
    expect(result.success).toBe(false);
    expect(issuesFor(result)).toContainEqual({
      path: ["feePayments"],
      message:
        "feePayments is only valid when includingFees is false (fee-on-top RECEIVE) — a fee-included transaction nets the fee out of the payout instead of collecting it separately",
    });
  });

  it("rejects feePayments + serviceType: SEND (sanity check — pre-existing-style refine)", () => {
    const result = FinancialServiceSchema.safeParse({
      ...basePayload,
      serviceType: "SEND" as const,
    });
    expect(result.success).toBe(false);
    expect(issuesFor(result)).toContainEqual({
      path: ["feePayments"],
      message: "feePayments is only valid on serviceType RECEIVE",
    });
  });
});
