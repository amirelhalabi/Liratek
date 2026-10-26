/** @jest-environment jsdom */
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
import { render, screen } from "@testing-library/react";
import {
  ServiceDebtDetailModal,
  type FinancialServiceData,
  type PaymentRowData,
} from "../ServiceDebtDetailModal";

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
    expect(screen.getByTestId("service-debt-total-charged")).toHaveTextContent(
      "710,000 LBP",
    );
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
