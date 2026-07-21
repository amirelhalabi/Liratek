/**
 * LIRA-078 — refund tender-selection modal, pure logic (RefundMethodModal's
 * prefill/default-detection/validation core, extracted so it is unit
 * testable without rendering the page/modal — same pattern as
 * cashFlow.ts/formatPaymentLegs.test.ts).
 */
import {
  netByCurrency,
  buildDefaultRefundLines,
  linesMatchDefault,
  validateRefundLines,
} from "../refundLegOverride";
import type { TransactionPaymentLeg } from "../cashFlow";

const leg = (
  direction: "in" | "out",
  amount: number,
  currency_code: string,
  method = "CASH",
): TransactionPaymentLeg => ({
  direction,
  amount,
  signed_amount: direction === "out" ? -amount : amount,
  currency_code,
  method,
});

describe("netByCurrency", () => {
  it("sums IN legs positive, OUT legs negative, per currency", () => {
    const legs = [leg("in", 110, "USD", "CASH"), leg("out", 10, "USD", "CASH")];
    expect(netByCurrency(legs)).toEqual({ USD: 100 });
  });

  it("keeps currencies separate", () => {
    const legs = [leg("in", 50, "USD"), leg("in", 900_000, "LBP")];
    expect(netByCurrency(legs)).toEqual({ USD: 50, LBP: 900_000 });
  });

  it("returns {} for undefined/empty legs", () => {
    expect(netByCurrency(undefined)).toEqual({});
    expect(netByCurrency([])).toEqual({});
  });
});

describe("buildDefaultRefundLines", () => {
  it("builds ONE line per currency, method from the first leg seen for that currency", () => {
    const legs = [
      leg("in", 60, "USD", "CASH"),
      leg("in", 40, "USD", "WHISH"),
      leg("in", 900_000, "LBP", "CASH"),
    ];
    const lines = buildDefaultRefundLines(legs);
    expect(lines).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 100 },
      { method: "CASH", currencyCode: "LBP", amount: 900_000 },
    ]);
  });

  it("drops a currency whose net rounds to 0 (fully offset by change)", () => {
    const legs = [
      leg("in", 100, "USD", "CASH"),
      leg("out", 100, "USD", "CASH"),
    ];
    expect(buildDefaultRefundLines(legs)).toEqual([]);
  });

  it("single-method single-currency case mirrors today's plain reversal shape", () => {
    const legs = [leg("in", 100, "USD", "OMT")];
    expect(buildDefaultRefundLines(legs)).toEqual([
      { method: "OMT", currencyCode: "USD", amount: 100 },
    ]);
  });
});

describe("linesMatchDefault", () => {
  const defaults = [{ method: "CASH", currencyCode: "USD", amount: 100 }];

  it("true when unchanged", () => {
    expect(
      linesMatchDefault(
        [{ method: "CASH", currencyCode: "USD", amount: 100 }],
        defaults,
      ),
    ).toBe(true);
  });

  it("false when the method changed", () => {
    expect(
      linesMatchDefault(
        [{ method: "OMT", currencyCode: "USD", amount: 100 }],
        defaults,
      ),
    ).toBe(false);
  });

  it("false when the amount changed", () => {
    expect(
      linesMatchDefault(
        [{ method: "CASH", currencyCode: "USD", amount: 80 }],
        defaults,
      ),
    ).toBe(false);
  });

  it("false when a line was added (split)", () => {
    expect(
      linesMatchDefault(
        [
          { method: "CASH", currencyCode: "USD", amount: 60 },
          { method: "OMT", currencyCode: "USD", amount: 40 },
        ],
        defaults,
      ),
    ).toBe(false);
  });

  it("true within floating-point epsilon", () => {
    expect(
      linesMatchDefault(
        [{ method: "CASH", currencyCode: "USD", amount: 100.004 }],
        defaults,
      ),
    ).toBe(true);
  });
});

describe("validateRefundLines", () => {
  it("null (valid) when totals match exactly", () => {
    expect(
      validateRefundLines(
        [{ method: "OMT", currencyCode: "USD", amount: 100 }],
        { USD: 100 },
      ),
    ).toBeNull();
  });

  it("null when a split sums to the same per-currency total", () => {
    expect(
      validateRefundLines(
        [
          { method: "CASH", currencyCode: "USD", amount: 60 },
          { method: "OMT", currencyCode: "USD", amount: 40 },
        ],
        { USD: 100 },
      ),
    ).toBeNull();
  });

  it("rejects an under-total", () => {
    const err = validateRefundLines(
      [{ method: "OMT", currencyCode: "USD", amount: 60 }],
      { USD: 100 },
    );
    expect(err).toMatch(/USD/);
  });

  it("rejects an over-total", () => {
    const err = validateRefundLines(
      [{ method: "OMT", currencyCode: "USD", amount: 150 }],
      { USD: 100 },
    );
    expect(err).toMatch(/USD/);
  });

  it("rejects a currency the original never had, even when the covered currency matches", () => {
    const err = validateRefundLines(
      [
        { method: "OMT", currencyCode: "USD", amount: 100 },
        { method: "OMT", currencyCode: "LBP", amount: 9_000_000 },
      ],
      { USD: 100 },
    );
    expect(err).toMatch(/LBP/);
  });

  it("multi-currency: each currency validated independently", () => {
    expect(
      validateRefundLines(
        [
          { method: "OMT", currencyCode: "USD", amount: 50 },
          { method: "CASH", currencyCode: "LBP", amount: 900_000 },
        ],
        { USD: 50, LBP: 900_000 },
      ),
    ).toBeNull();

    const err = validateRefundLines(
      [
        { method: "OMT", currencyCode: "USD", amount: 50 },
        { method: "CASH", currencyCode: "LBP", amount: 800_000 },
      ],
      { USD: 50, LBP: 900_000 },
    );
    expect(err).toMatch(/LBP/);
  });
});
