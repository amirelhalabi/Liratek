/** @jest-environment jsdom */
/**
 * ServiceDebtDetailModal — dual-currency totals regression test.
 *
 * Verified owner report: on an LBP-denominated financial service, a $15 USD
 * payment leg + a $3 USD account-charge (debt) leg rendered the "Paid (excl.
 * account)" and "Remaining debt" SUMMARY lines as "15 LBP" / "3 LBP" instead
 * of "$15.00" / "$3.00" — even though the per-leg rows showed "$15"/"$3"
 * correctly. Root cause (ServiceDebtDetailModal.tsx):
 *   1. `fmtCurrency` defaulted its currency to `fs.currency` (the SERVICE's
 *      own denomination) whenever no explicit currency code was passed.
 *   2. `totalPaid` summed payment-leg amounts across BOTH currencies into a
 *      single number, discarding which currency each leg was actually in.
 *
 * The stored data was always correct — this was a display-only bug.
 */

import { render, screen } from "@testing-library/react";
import {
  ServiceDebtDetailModal,
  type FinancialServiceData,
  type PaymentRowData,
} from "../ServiceDebtDetailModal";

function makeFs(
  overrides: Partial<FinancialServiceData> = {},
): FinancialServiceData {
  return {
    id: 1,
    provider: "OMT",
    service_type: "SEND",
    amount: 20000,
    currency: "LBP", // service is denominated in LBP
    omt_fee: 0,
    whish_fee: null,
    payment_method_fee: null,
    omt_service_type: null,
    client_name: "Jane Doe",
    phone_number: "71234567",
    reference_number: null,
    note: null,
    created_at: "2026-07-19 10:00:00",
    ...overrides,
  };
}

function makePayment(overrides: Partial<PaymentRowData>): PaymentRowData {
  return {
    id: 1,
    method: "CASH",
    drawer_name: "Main",
    currency_code: "USD",
    amount: 0,
    note: null,
    created_at: "2026-07-19 10:00:00",
    ...overrides,
  };
}

describe("ServiceDebtDetailModal — dual-currency totals", () => {
  it("renders USD paid/debt totals in USD, never in the LBP-denominated service's own currency", () => {
    const fs = makeFs();
    const payments: PaymentRowData[] = [
      makePayment({ id: 1, method: "CASH", currency_code: "USD", amount: 15 }),
      makePayment({
        id: 2,
        method: "CUSTOMER_ACCOUNT",
        currency_code: "USD",
        amount: 3,
      }),
    ];

    render(
      <ServiceDebtDetailModal
        financialService={fs}
        payments={payments}
        debtAmountUsd={3}
        debtAmountLbp={0}
        onClose={jest.fn()}
      />,
    );

    // Per-leg rows already render correctly — sanity check they still do.
    // (Also matched by the fixed "Paid (excl. account)" summary below, so
    // there are two matches once the bug is fixed.)
    expect(screen.getAllByText("$15.00").length).toBeGreaterThan(0);

    // "Paid (excl. account)" summary line — must be USD, never LBP.
    const paidTotal = screen.getByTestId("service-debt-paid-total");
    expect(paidTotal).toHaveTextContent("$15.00");
    expect(paidTotal).not.toHaveTextContent("LBP");

    // "Remaining debt" summary line — must be USD, never LBP.
    const remaining = screen.getByTestId("service-debt-remaining");
    expect(remaining).toHaveTextContent("$3.00");
    expect(remaining).not.toHaveTextContent("LBP");
  });

  it("renders genuinely mixed tender ($10 USD + 450,000 LBP) as both currencies in the paid total", () => {
    const fs = makeFs({ amount: 500000 });
    const payments: PaymentRowData[] = [
      makePayment({ id: 1, method: "CASH", currency_code: "USD", amount: 10 }),
      makePayment({
        id: 2,
        method: "CASH",
        currency_code: "LBP",
        amount: 450000,
      }),
    ];

    render(
      <ServiceDebtDetailModal
        financialService={fs}
        payments={payments}
        debtAmountUsd={0}
        debtAmountLbp={0}
        onClose={jest.fn()}
      />,
    );

    const paidTotal = screen.getByTestId("service-debt-paid-total");
    expect(paidTotal).toHaveTextContent("$10.00");
    expect(paidTotal).toHaveTextContent("450,000 LBP");
  });

  it("renders an LBP-denominated service debt's remaining amount in LBP, not $0 (regression: debtAmount used to be USD-only, dropping amount_lbp entirely)", () => {
    // Real caller shape (Debts/index.tsx `loadServiceDebtDetails`): the
    // debt/account-charge amount is now threaded through per-currency, from
    // the debt_ledger row's `amount_usd`/`amount_lbp` columns. A pure-LBP
    // service debt (amount_usd: 0, amount_lbp: 600000) must render its
    // "Remaining debt" as "600,000 LBP" — previously the single-currency
    // `debtAmount` prop only ever carried the USD side (0 here), so this
    // row never rendered at all (proven failing against the pre-fix code:
    // `getByTestId("service-debt-remaining")` threw "Unable to find an
    // element").
    const fs = makeFs({ amount: 600000, currency: "LBP" });

    render(
      <ServiceDebtDetailModal
        financialService={fs}
        payments={[]}
        debtAmountUsd={0}
        debtAmountLbp={600000}
        onClose={jest.fn()}
      />,
    );

    const remaining = screen.getByTestId("service-debt-remaining");
    expect(remaining).toHaveTextContent("600,000 LBP");
    expect(remaining).not.toHaveTextContent("$0");
  });
});
