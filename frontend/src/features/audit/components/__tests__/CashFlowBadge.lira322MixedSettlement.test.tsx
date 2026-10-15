/** @jest-environment jsdom */

/**
 * LIRA-322 (US3, T036) — one OMT account settlement can pay OMT in one
 * currency and take money from OMT in the other. Its Transactions badge
 * then shows both directions side by side — "OUT $497.00 · IN 2,000,000
 * LBP" — each read from that currency's own payment legs, not from the
 * static SUPPLIER_SETTLEMENT direction. A one-direction settlement keeps
 * today's single badge exactly.
 */

import { render, screen, within } from "@testing-library/react";
import { CashFlowBadge } from "../CashFlowBadge";
import type { TransactionPaymentLeg } from "../../cashFlow";

function leg(currency: "USD" | "LBP", signed: number): TransactionPaymentLeg {
  return {
    direction: signed < 0 ? "out" : "in",
    amount: Math.abs(signed),
    signed_amount: signed,
    currency_code: currency,
    method: "CASH",
  };
}

const MIXED_META = JSON.stringify({
  per_currency: {
    USD: { direction: "PAY", paid: 497, commission: 0, waive: 0, extra: 0 },
    LBP: {
      direction: "COLLECT",
      paid: 2000000,
      commission: 0,
      waive: 0,
      extra: 0,
    },
  },
});

describe("CashFlowBadge — SUPPLIER_SETTLEMENT paying one currency and collecting the other (LIRA-322)", () => {
  it("shows OUT $497.00 · IN 2,000,000 LBP from the legs", () => {
    render(
      <CashFlowBadge
        type="SUPPLIER_SETTLEMENT"
        amountUsd={497}
        amountLbp={2000000}
        metaJson={MIXED_META}
        legs={[leg("USD", -497), leg("LBP", 2000000)]}
        providerBalance={false}
      />,
    );

    const badge = screen.getByTestId("cash-flow-badge");
    expect(badge).toHaveAttribute("data-direction", "mixed");
    const parts = within(badge).getAllByTestId("cash-flow-badge-part");
    expect(
      parts.map((p) => [
        p.getAttribute("data-direction"),
        p.getAttribute("data-currency"),
      ]),
    ).toEqual([
      ["out", "USD"],
      ["in", "LBP"],
    ]);
    expect(badge.textContent).toContain("OUT $497.00");
    expect(badge.textContent).toContain("IN 2,000,000 LBP");
  });

  it("a currency with no payment lines falls back to its per_currency direction", () => {
    render(
      <CashFlowBadge
        type="SUPPLIER_SETTLEMENT"
        amountUsd={497}
        amountLbp={2000000}
        metaJson={MIXED_META}
        legs={[leg("USD", -497)]}
        providerBalance={false}
      />,
    );

    const parts = screen.getAllByTestId("cash-flow-badge-part");
    expect(parts[1]).toHaveAttribute("data-direction", "in");
    expect(parts[1].textContent).toContain("IN 2,000,000 LBP");
  });

  it("a one-direction settlement keeps today's single badge (even with change in the other currency)", () => {
    render(
      <CashFlowBadge
        type="SUPPLIER_SETTLEMENT"
        amountUsd={101}
        amountLbp={0}
        metaJson={JSON.stringify({
          per_currency: {
            USD: {
              direction: "PAY",
              paid: 150,
              commission: 0,
              waive: 0,
              extra: 49,
            },
          },
        })}
        legs={[leg("USD", -150), leg("LBP", 4361000)]}
        providerBalance={false}
      />,
    );

    const badge = screen.getByTestId("cash-flow-badge");
    expect(badge).toHaveAttribute("data-direction", "out");
    expect(screen.queryAllByTestId("cash-flow-badge-part")).toHaveLength(0);
  });
});
