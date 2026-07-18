/** @jest-environment jsdom */

/**
 * Services page — USD/LBP toggle → payment section currency guard.
 *
 * The bug this guards (owner-reported 2026-07-18): an OMT SEND of 420,000 LBP
 * showed "$420,000" as the payment total. The page's MultiPaymentInput
 * invocation hardcoded `currency: "USD"` in `totals` (and the summary
 * `currency` prop), ignoring the amount field's USD/LBP toggle — so the
 * total row was mislabeled and split legs were matched against a fake USD
 * total. The entered amount AND renderProviderFee are both denominated by
 * the toggle (LBP INTRA uses the LBP fee table), so the whole sum belongs
 * to the toggle currency.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Services from "../index";

const mockGetOMTHistory = jest.fn().mockResolvedValue([]);
const mockGetOMTAnalytics = jest.fn().mockResolvedValue({
  today: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
  month: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
  byProvider: [],
});
const mockGetSuppliers = jest.fn().mockResolvedValue([]);
const mockGetSupplierBalances = jest.fn().mockResolvedValue([]);
const mockPartnersGetAll = jest.fn().mockResolvedValue([]);

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getOMTHistory: mockGetOMTHistory,
    getOMTAnalytics: mockGetOMTAnalytics,
    getSuppliers: mockGetSuppliers,
    getSupplierBalances: mockGetSupplierBalances,
    partners: { getAll: mockPartnersGetAll },
    addOMTTransaction: jest.fn().mockResolvedValue({ success: true, id: 1 }),
  }),
  // Capture the currency contract the page feeds the payment section.
  MultiPaymentInput: ({
    totals,
    currency,
    totalAmountCurrency,
  }: {
    totals?: { amount: number; currency: string }[];
    currency?: string;
    totalAmountCurrency?: string;
  }) => (
    <div data-testid="multi-payment-props">
      {JSON.stringify({ totals, currency, totalAmountCurrency })}
    </div>
  ),
  // Plain input stand-in so fireEvent.change drives the amount state.
  DecimalInput: ({
    id,
    value,
    onChange,
    placeholder,
    className,
  }: {
    id?: string;
    value: number;
    onChange: (n: number) => void;
    placeholder?: string;
    className?: string;
  }) => (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={value === 0 ? "" : String(value)}
      placeholder={placeholder}
      className={className}
      onChange={(e) =>
        onChange(parseFloat(e.target.value.replace(/,/g, "")) || 0)
      }
    />
  ),
  Select: ({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
  }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  DataTable: () => <div data-testid="data-table" />,
  TopUpModal: () => null,
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [
      { code: "CASH", label: "Cash" },
      { code: "OMT", label: "OMT Wallet" },
    ],
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000 }),
}));

jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({
    baseSystem: "OMT",
    partnerSystem: "WHISH",
    loading: false,
  }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

jest.mock("@/shared/hooks/useSaveAsClient", () => ({
  useSaveAsClient: () => ({
    saveAsClient: false,
    setSaveAsClient: jest.fn(),
    showCheckbox: false,
    trySaveAsClient: jest.fn().mockResolvedValue({ clientId: null }),
    resetSaveAsClient: jest.fn(),
  }),
}));

jest.mock("@/shared/components/SaveAsClientCheckbox", () => ({
  SaveAsClientCheckbox: () => null,
}));

jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));

jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: () => null,
}));

jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: () => null,
}));

jest.mock("../../../components/StatsCards", () => ({
  StatsCards: () => <div data-testid="stats-cards" />,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const readPaymentProps = () =>
  JSON.parse(screen.getByTestId("multi-payment-props").textContent || "{}");

async function renderPage() {
  render(<Services />);
  await waitFor(() => expect(mockGetOMTHistory).toHaveBeenCalled());
}

describe("Services page — LBP toggle currency propagation", () => {
  it("feeds the payment section the toggle currency (OMT SEND)", async () => {
    await renderPage();

    const amountInput = document.getElementById(
      "service-amount",
    ) as HTMLInputElement;

    // USD mode (default): totals tagged USD.
    fireEvent.change(amountInput, { target: { value: "100" } });
    expect(readPaymentProps()).toMatchObject({
      totals: [expect.objectContaining({ currency: "USD" })],
      currency: "USD",
      totalAmountCurrency: "USD",
    });

    // LBP mode: 420,000 LBP INTRA send → LBP fee table gives 50,000, so the
    // customer total is 470,000 — and every prop must say LBP.
    fireEvent.click(screen.getByRole("button", { name: "LBP" }));
    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "420000" } },
    );
    expect(readPaymentProps()).toEqual({
      totals: [{ amount: 470000, currency: "LBP" }],
      currency: "LBP",
      totalAmountCurrency: "LBP",
    });
  });
});
