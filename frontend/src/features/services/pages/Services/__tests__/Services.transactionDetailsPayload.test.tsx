/** @jest-environment jsdom */

/**
 * LIRA-329 T012 — the Services page sends every field the transaction's
 * `omt_whish_transfer` details are built from: OMT service type, reference,
 * the customer's name and phone (a SEND shows only the sender — A2), the OMT
 * fee and the "fee included" choice. One payload per operation (rule 22); field names are read back
 * through the shared schema (rule 24), so a key the server would strip
 * fails here.
 *
 * CHARACTERIZATION — NOT proven failing-first (rule 17): the page already
 * sent all of these before LIRA-329 (the gap was repository → transaction,
 * closed in core). This pins that the payload keeps carrying them.
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
  ClientAutocompleteInput: ({
    id,
    value,
    onChange,
  }: {
    id?: string;
    value: string;
    onChange: (v: string) => void;
  }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
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

function input(id: string): HTMLInputElement {
  const el = document.getElementById(id) as HTMLInputElement | null;
  expect(el).not.toBeNull();
  return el as HTMLInputElement;
}

describe("Services page — the payload carries every details field (LIRA-329)", () => {
  it("an OMT send sends service type, reference, the sender's name and phone, fee and the fee-included choice", async () => {
    await renderPage();
    const typeSelect = Array.from(document.querySelectorAll("select")).find(
      (s) => Array.from(s.options).some((o) => o.value === "CASH_TO_BUSINESS"),
    ) as HTMLSelectElement | undefined;
    expect(typeSelect).toBeDefined();
    fireEvent.change(typeSelect as HTMLSelectElement, {
      target: { value: "CASH_TO_BUSINESS" },
    });
    fireEvent.change(input("service-amount"), { target: { value: "100" } });
    fireEvent.change(input("service-omt-fee"), { target: { value: "1" } });
    fireEvent.change(input("service-sender-name"), {
      target: { value: "Ali Saad" },
    });
    fireEvent.change(input("service-sender-phone"), {
      target: { value: "70123456" },
    });
    fireEvent.change(input("service-reference"), {
      target: { value: "R-123" },
    });
    fireEvent.click(screen.getByTestId("service-including-fees-toggle"));
    fireEvent.click(screen.getByTestId("mpi-no-extra"));

    fireEvent.click(screen.getByRole("button", { name: /Record Send/i }));
    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const sent = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );

    expect(sent).toMatchObject({
      provider: "OMT",
      serviceType: "SEND",
      omtServiceType: "CASH_TO_BUSINESS",
      referenceNumber: "R-123",
      senderName: "Ali Saad",
      senderPhone: "70123456",
      omtFee: 1,
      includingFees: true,
    });
  });
});
