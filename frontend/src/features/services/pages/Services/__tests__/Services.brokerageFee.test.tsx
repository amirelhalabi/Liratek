/** @jest-environment jsdom */

/**
 * OMT SEND, Online Brokerage: the "BINANCE Fee (charged to customer)" the
 * cashier types is part of the payment total, so it must be sent as the
 * transfer's fee. It was dropped from the payload, and the server refused
 * the send ("payment is more than the total … diff $0.37"), verified on the
 * test tenant 2026-10-16. Field names come from the shared schema (rule 24).
 * Written before the fix (rule 17).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createFinancialServiceSchema } from "@liratek/core";
import Services from "../index";

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
const mockGetOMTHistory = jest.fn().mockResolvedValue([]);
const mockApi = {
  getOMTHistory: mockGetOMTHistory,
  getOMTAnalytics: jest.fn().mockResolvedValue({
    today: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
    month: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
    byProvider: [],
  }),
  getSuppliers: jest.fn().mockResolvedValue([]),
  getSupplierBalances: jest.fn().mockResolvedValue([]),
  partners: { getAll: jest.fn().mockResolvedValue([]) },
  addOMTTransaction: mockAddOMTTransaction,
};
const mockSeen: {
  onExtraChange?: ((extra: number) => void) | undefined;
  showDiscount?: boolean | undefined;
  payer?: string | undefined;
} = {};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  // Stable reference (rule 25).
  useApi: () => mockApi,
  MultiPaymentInput: (props: {
    onChange: (lines: unknown[]) => void;
    onExtraChange?: (extra: number) => void;
    showDiscount?: boolean;
    payer?: string;
  }) => {
    mockSeen.onExtraChange = props.onExtraChange;
    mockSeen.showDiscount = props.showDiscount;
    mockSeen.payer = props.payer;
    return (
      <div data-testid="stub-multi-payment-input">
        <button
          data-testid="mpi-extra-1"
          onClick={() => {
            props.onExtraChange?.(1);
            props.onChange([
              { id: "L1", method: "CASH", currencyCode: "USD", amount: 102 },
            ]);
          }}
        />
        <button
          data-testid="mpi-no-extra"
          onClick={() =>
            props.onChange([
              { id: "L1", method: "CASH", currencyCode: "USD", amount: 101 },
            ])
          }
        />
      </div>
    );
  },
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

async function renderPage() {
  render(<Services />);
  await waitFor(() => expect(mockGetOMTHistory).toHaveBeenCalled());
}

beforeEach(() => {
  mockAddOMTTransaction.mockClear();
  delete mockSeen.onExtraChange;
});

async function chooseBrokerage(): Promise<void> {
  const select = Array.from(document.querySelectorAll("select")).find((s) =>
    Array.from(s.options).some((o) => o.value === "ONLINE_BROKERAGE"),
  ) as HTMLSelectElement | undefined;
  expect(select).toBeDefined();
  fireEvent.change(select as HTMLSelectElement, {
    target: { value: "ONLINE_BROKERAGE" },
  });
  fireEvent.change(
    document.getElementById("service-amount") as HTMLInputElement,
    { target: { value: "2" } },
  );
}

async function submitSend(): Promise<
  ReturnType<typeof createFinancialServiceSchema.parse>
> {
  fireEvent.click(screen.getByRole("button", { name: /Record Send/i }));
  await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
  return createFinancialServiceSchema.parse(
    mockAddOMTTransaction.mock.calls[0][0],
  );
}

describe("Services page — Online Brokerage fee", () => {
  it("a fee charged to the customer is sent as the transfer's fee", async () => {
    await renderPage();
    await chooseBrokerage();
    fireEvent.click(screen.getByLabelText(/Charge BINANCE fee to customer/i));
    fireEvent.change(
      document.getElementById("binance-fee") as HTMLInputElement,
      { target: { value: "0.37" } },
    );
    fireEvent.click(screen.getByTestId("mpi-no-extra"));
    const sent = await submitSend();
    expect(sent.omtServiceType).toBe("ONLINE_BROKERAGE");
    expect(sent.payFee).toBe(true);
    expect(sent.omtFee).toBe(0.37);
  });

  it("no fee is sent when it is not charged to the customer", async () => {
    await renderPage();
    await chooseBrokerage();
    fireEvent.click(screen.getByTestId("mpi-no-extra"));
    const sent = await submitSend();
    expect(sent.omtFee ?? 0).toBe(0);
  });
});
