/** @jest-environment jsdom */

/**
 * LIRA-269 follow-up — Services page OMT/Whish SEND must not offer a
 * discount.
 *
 * The shared payment input shows a discount field by default
 * (`showDiscount = true`), and this page never turned it off, so a SEND
 * showed a discount that nothing booked: the server reconciles the legs
 * against amount + fee, so a discount over $0.05 was refused, and a smaller
 * one silently left the drawer short.
 *
 * Why hidden rather than booked: an OMT/Whish system SEND has no fee margin
 * at creation for a discount to come out of. The whole fee is owed to the
 * provider (gross supplier ledger), the shop's commission is recognised only
 * at settlement (`commission_model = 1`, profit stamp 0 at creation), and a
 * Whish system SEND has no commission at all — so under the owner's rule (a
 * discount lowers the shop's profit, capped at the margin) the cap is 0.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Services from "../index";

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
const mockGetOMTHistory = jest.fn().mockResolvedValue([]);
const mockGetOMTAnalytics = jest.fn().mockResolvedValue({
  today: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
  month: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
  byProvider: [],
});
const mockGetSuppliers = jest.fn().mockResolvedValue([]);
const mockGetSupplierBalances = jest.fn().mockResolvedValue([]);
const mockPartnersGetAll = jest.fn().mockResolvedValue([]);

// rule 25: ONE stable object, never a fresh literal per render.
const mockApi = {
  getOMTHistory: mockGetOMTHistory,
  getOMTAnalytics: mockGetOMTAnalytics,
  getSuppliers: mockGetSuppliers,
  getSupplierBalances: mockGetSupplierBalances,
  partners: { getAll: mockPartnersGetAll },
  addOMTTransaction: mockAddOMTTransaction,
};

interface StubMpiProps {
  showDiscount?: boolean;
  payer?: string;
  onDiscountChange?: unknown;
}
const mockMpi: { last?: StubMpiProps } = {};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  // Stub recording the props the page passes the shared payment input.
  MultiPaymentInput: (props: StubMpiProps) => {
    mockMpi.last = props;
    return <div data-testid="stub-multi-payment-input" />;
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

const mockShopBase = { baseSystem: "OMT", partnerSystem: "WHISH" };
jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({ ...mockShopBase, loading: false }),
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

describe("Services page — no discount on an OMT/Whish SEND", () => {
  beforeEach(() => {
    delete mockMpi.last;
    mockShopBase.baseSystem = "OMT";
    mockShopBase.partnerSystem = "WHISH";
  });

  it("OMT SEND: the payment input's discount field is turned off", async () => {
    await renderPage();
    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "100" } },
    );
    await screen.findByTestId("stub-multi-payment-input");
    expect(mockMpi.last?.showDiscount).toBe(false);
  });

  it("Whish SEND: the payment input's discount field is turned off", async () => {
    // WHISH as the shop's base system, so its tab opens with no partner.
    mockShopBase.baseSystem = "WHISH";
    mockShopBase.partnerSystem = "OMT";
    await renderPage();
    const whishSend = screen
      .getAllByRole("button")
      .find(
        (b) =>
          (b.textContent ?? "").includes("WHISH") &&
          (b.textContent ?? "").includes("↑"),
      );
    expect(whishSend).toBeDefined();
    fireEvent.click(whishSend!);
    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "100" } },
    );
    await screen.findByTestId("stub-multi-payment-input");
    expect(mockMpi.last?.showDiscount).toBe(false);
  });
});
