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
import { OMT_RECEIVE_NO_FEE_MESSAGE } from "@liratek/core";

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
    // D1 (OWNER_NOTES_2026-09-21.md §2b): provider overridden from OMT to
    // WHISH — an OMT RECEIVE's feePayments are now blanket-rejected by this
    // schema's own D1 refine (see the "D1 blanket guard" describe block
    // below), so `basePayload` as-is no longer represents an accepted OMT
    // case. WHISH is unaffected by D1 and remains the representative
    // positive case here.
    const result = FinancialServiceSchema.safeParse({
      ...basePayload,
      provider: "WHISH" as const,
      whishFee: 5,
    });
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

  // D1 (OWNER_NOTES_2026-09-21.md §2b) — this schema's own blanket OMT
  // RECEIVE refine, mirroring the core one (rule 14/19b: both must reject
  // with the SAME message, or the desktop IPC path and the REST route
  // disagree — rule 19).
  describe("D1 blanket guard wins over the partner/zero-fee refines for an OMT RECEIVE", () => {
    it("rejects with the D1 message even when partnerId is attached", () => {
      const result = FinancialServiceSchema.safeParse({
        ...basePayload,
        partnerId: 1,
        partnerMode: "THROUGH" as const,
      });
      expect(result.success).toBe(false);
      const issues = issuesFor(result);
      expect(issues[0]).toEqual({
        path: ["feePayments"],
        message: OMT_RECEIVE_NO_FEE_MESSAGE,
      });
    });

    it("rejects with the D1 message even when omtFee is zero", () => {
      const result = FinancialServiceSchema.safeParse({
        ...basePayload,
        omtFee: 0,
      });
      expect(result.success).toBe(false);
      const issues = issuesFor(result);
      expect(issues[0]).toEqual({
        path: ["feePayments"],
        message: OMT_RECEIVE_NO_FEE_MESSAGE,
      });
    });

    it("does not affect WHISH — the same partner combo is still accepted with no feePayments", () => {
      const result = FinancialServiceSchema.safeParse({
        provider: "WHISH" as const,
        serviceType: "RECEIVE" as const,
        amount: 40,
        currency: "USD",
        whishFee: 3,
        partnerId: 1,
        partnerMode: "THROUGH" as const,
      });
      expect(result.success).toBe(true);
    });
  });

  // Owner decision 2026-09-25: "OMT App RECEIVE: refuse a fee with the SAME
  // D1 message as OMT system — one constant." OMT_APP's fee travels in
  // `commission`, not `omtFee`/`feePayments`, but both providers must reject
  // with the SAME message on this transport too (rule 19 — desktop and REST
  // agree), mirroring the core validator's own coverage.
  describe("D1 blanket guard also covers OMT_APP RECEIVE (owner decision 2026-09-25)", () => {
    it("rejects an OMT_APP RECEIVE with a nonzero commission, with the SAME D1 message", () => {
      const result = FinancialServiceSchema.safeParse({
        provider: "OMT_APP" as const,
        serviceType: "RECEIVE" as const,
        amount: 40,
        currency: "USD",
        commission: 3,
      });
      expect(result.success).toBe(false);
      const issues = issuesFor(result);
      expect(issues[0]).toEqual({
        path: ["feePayments"],
        message: OMT_RECEIVE_NO_FEE_MESSAGE,
      });
    });

    it("rejects an OMT_APP RECEIVE with includingFees: true and zero commission, with the SAME D1 message", () => {
      const result = FinancialServiceSchema.safeParse({
        provider: "OMT_APP" as const,
        serviceType: "RECEIVE" as const,
        amount: 40,
        currency: "USD",
        commission: 0,
        includingFees: true,
      });
      expect(result.success).toBe(false);
      const issues = issuesFor(result);
      expect(issues[0]).toEqual({
        path: ["feePayments"],
        message: OMT_RECEIVE_NO_FEE_MESSAGE,
      });
    });

    it("does not affect WHISH_APP — a commission is still accepted (D1 does not cover WHISH_APP)", () => {
      const result = FinancialServiceSchema.safeParse({
        provider: "WHISH_APP" as const,
        serviceType: "RECEIVE" as const,
        amount: 40,
        currency: "USD",
        commission: 3,
      });
      expect(result.success).toBe(true);
    });
  });
});
