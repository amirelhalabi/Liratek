import { addRepaymentSchema } from "../debt.js";

/**
 * The repayment payload speaks camelCase, on BOTH transports.
 *
 * The Debts page used to choose its payload shape from the transport:
 *
 *     window.api
 *       ? addRepayment({ clientId,  amountUSD,  amountLBP,  userId })
 *       : addRepayment({ client_id, amount_usd, amount_lbp, user_id })
 *
 * Both routes validate with THIS schema, and it speaks camelCase — so every
 * repayment made in the browser arrived with `clientId` undefined and was
 * refused with "Invalid input: expected number, received undefined". The
 * operator saw a filled-in modal rejected for a reason that named no field,
 * on a money action, with no way to tell which number was wrong.
 *
 * Worth recording why only `clientId` surfaced: `amountUSD` and `amountLBP`
 * carry `.default(0)`, so their snake_case twins failed silently into zeroes
 * rather than erroring. Had `clientId` also defaulted, the repayment would
 * have been ACCEPTED against the wrong client for $0 — the same drift, with
 * a far worse ending than an error message.
 */
describe("addRepaymentSchema — field names are part of the contract", () => {
  /** Exactly what the Debts page sends now, for both transports. */
  const camelCasePayload = {
    clientId: 42,
    amountUSD: 1221,
    amountLBP: 16_250_000,
    payments: [
      { method: "Cash", currencyCode: "USD", amount: 1221 },
      { method: "Cash", currencyCode: "LBP", amount: 16_250_000 },
    ],
    note: "PAID BY FIRO",
    userId: 7,
  };

  it("accepts the payload the page builds", () => {
    const parsed = addRepaymentSchema.parse(camelCasePayload);
    expect(parsed.clientId).toBe(42);
    expect(parsed.amountUSD).toBe(1221);
    expect(parsed.amountLBP).toBe(16_250_000);
    expect(parsed.payments).toHaveLength(2);
  });

  it("REFUSES the snake_case shape the web branch used to send", () => {
    // The bug, pinned. If someone reintroduces a per-transport payload this
    // fails, rather than the operator discovering it at the counter.
    const snakeCasePayload = {
      client_id: 42,
      amount_usd: 1221,
      amount_lbp: 16_250_000,
      payments: camelCasePayload.payments,
      user_id: 7,
    };

    const result = addRepaymentSchema.safeParse(snakeCasePayload);
    expect(result.success).toBe(false);
    if (!result.success) {
      // And specifically on clientId — the exact error the owner reported.
      expect(result.error.issues.some((i) => i.path.includes("clientId"))).toBe(
        true,
      );
    }
  });

  it("a missing clientId is what produces 'expected number, received undefined'", () => {
    const { clientId: _omitted, ...withoutClient } = camelCasePayload;

    const result = addRepaymentSchema.safeParse(withoutClient);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) =>
        i.path.includes("clientId"),
      );
      expect(issue).toBeDefined();
      expect(issue?.code).toBe("invalid_type");
    }
  });

  it("still accepts a payment leg's optional direction (CQ-8 change legs)", () => {
    // Guards the neighbouring field the same class of drift already cost once:
    // REST silently stripped `direction` off every leg until it was added here.
    const parsed = addRepaymentSchema.parse({
      ...camelCasePayload,
      payments: [
        { method: "Cash", currencyCode: "USD", amount: 1500 },
        { method: "Cash", currencyCode: "USD", amount: 279, direction: "OUT" },
      ],
    });
    expect(parsed.payments?.[1]?.direction).toBe("OUT");
  });
});
