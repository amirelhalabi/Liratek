/**
 * ServiceDebtDetailModal — 2 per-ticket test files merged into one suite
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

import { render, screen } from "@testing-library/react";
import {
  ServiceDebtDetailModal,
  type FinancialServiceData,
  type PaymentRowData,
} from "../ServiceDebtDetailModal";

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("ServiceDebtDetailModal.splitCheckout (LIRA-349)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-349 A3 — the debt-detail popup of a multi-unit checkout put on the
   * customer's account.
   *
   * Owner repro (test tenant, tx 13107, services 819/820): a Whish App basket of
   * two items, 355,000 LBP each, 710,000 LBP on the account. The popup was
   * titled "WHISH_APP SEND", showed "Send Amount 355,000 / Total Charged
   * 355,000" beside a 710,000 debt, and never named the second item. The record
   * now carries `checkout_items` (core `findWithCheckoutItems`); the popup must
   * list each item with its price, total them, and say what was sold.
   *
   * Failing-first (rule 17): written and run against the unfixed modal first.
   */

  /** One unit on its own: the owner's carrier row without the checkout list. */
  function single(): FinancialServiceData {
    const { checkout_items: _items, ...rest } = ownerBasket();
    return rest;
  }

  function ownerBasket(): FinancialServiceData {
    return {
      id: 819,
      provider: "WHISH_APP",
      service_type: "SEND",
      amount: 355000,
      currency: "LBP",
      omt_fee: 0,
      whish_fee: 0,
      payment_method_fee: 0,
      omt_service_type: null,
      client_name: "Review Client 26-10",
      phone_number: null,
      reference_number: null,
      note: "alfa: 3.03 (Prepaid)",
      item_key: "WHISH_APP/alfa/Prepaid/3.03",
      created_at: "2026-10-26 22:15:30",
      checkout_items: [
        {
          provider: "WHISH_APP",
          serviceType: "SEND",
          name: "alfa: 3.03 (Prepaid)",
          amount: 355000,
          currency: "LBP",
        },
        {
          provider: "WHISH_APP",
          serviceType: "SEND",
          name: "alfa: 1GB Mobile Internet",
          amount: 355000,
          currency: "LBP",
        },
      ],
    };
  }

  describe("ServiceDebtDetailModal — split checkout (owner repro)", () => {
    it("lists every item with its price and totals the checkout", () => {
      render(
        <ServiceDebtDetailModal
          financialService={ownerBasket()}
          payments={[]}
          debtAmountUsd={0}
          debtAmountLbp={710000}
          onClose={jest.fn()}
        />,
      );
      const items = screen.getAllByTestId("service-debt-item");
      expect(items).toHaveLength(2);
      expect(items[0]).toHaveTextContent("alfa: 3.03 (Prepaid)");
      expect(items[0]).toHaveTextContent("355,000 LBP");
      expect(items[1]).toHaveTextContent("alfa: 1GB Mobile Internet");
      expect(items[1]).toHaveTextContent("355,000 LBP");
      expect(
        screen.getByTestId("service-debt-total-charged"),
      ).toHaveTextContent("710,000 LBP");
      expect(screen.queryByText("Send Amount")).toBeNull();
    });

    it("titles the popup by the provider's name and what was sold, not WHISH_APP SEND", () => {
      render(
        <ServiceDebtDetailModal
          financialService={ownerBasket()}
          payments={[]}
          debtAmountUsd={0}
          debtAmountLbp={710000}
          onClose={jest.fn()}
        />,
      );
      const title = screen.getByRole("heading", { level: 2 });
      expect(title).toHaveTextContent("Whish App");
      expect(title).toHaveTextContent("2 items");
      expect(title).not.toHaveTextContent("WHISH_APP");
      expect(title).not.toHaveTextContent("SEND");
    });

    it("a single bill is titled Bill", () => {
      render(
        <ServiceDebtDetailModal
          financialService={{
            ...single(),
            provider: "Katsh",
            service_type: "BILL",
            amount: 20,
            currency: "USD",
            note: null,
            item_key: null,
          }}
          payments={[]}
          debtAmountUsd={20}
          debtAmountLbp={0}
          onClose={jest.fn()}
        />,
      );
      const title = screen.getByRole("heading", { level: 2 });
      expect(title).toHaveTextContent("Katsh");
      expect(title).toHaveTextContent("Bill");
      expect(title).not.toHaveTextContent("BILL");
    });

    it("formats an LBP payment leg with thousands separators, not 355000.00", () => {
      const leg: PaymentRowData = {
        id: 1,
        method: "CASH",
        drawer_name: "General",
        currency_code: "LBP",
        amount: 355000,
        note: null,
        created_at: "2026-10-26 22:15:30",
      };
      render(
        <ServiceDebtDetailModal
          financialService={single()}
          payments={[leg]}
          debtAmountUsd={0}
          debtAmountLbp={0}
          onClose={jest.fn()}
        />,
      );
      expect(screen.queryByText(/355000\.00/)).toBeNull();
      expect(screen.getAllByText("355,000 LBP").length).toBeGreaterThan(0);
    });
  });
});

describe("ServiceDebtDetailModal", () => {
  beforeAll(resetBetweenFiles);

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
        makePayment({
          id: 1,
          method: "CASH",
          currency_code: "USD",
          amount: 15,
        }),
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
        makePayment({
          id: 1,
          method: "CASH",
          currency_code: "USD",
          amount: 10,
        }),
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
});
