/** @jest-environment jsdom */

/**
 * Services page — inside an active customer session the SEND payment sheet
 * must NOT offer "change to the customer's account".
 *
 * In a session the transfer goes into the basket, and the server drops the
 * item's OUT legs (deferPayment) — the basket checkout owns the change. An
 * Account button here would promise a store credit that is never booked.
 * The session's name+phone pre-fill the sender, so the client gate alone
 * does not stop it; `!activeSession` must.
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
const mockPartnersGetAll = jest.fn().mockResolvedValue([
  { id: 7, name: "Ziad Supplies", system_association: null, is_active: 1 },
]);
const mockAddToCart = jest.fn();
const mockMpiProps: Array<Record<string, unknown>> = [];

// Rule 25: ONE stable object — a fresh literal per useApi() call is the
// unstable identity production hides.
const mockApi = {
  getOMTHistory: (...a: unknown[]) => mockGetOMTHistory(...a),
  getOMTAnalytics: (...a: unknown[]) => mockGetOMTAnalytics(...a),
  getSuppliers: (...a: unknown[]) => mockGetSuppliers(...a),
  getSupplierBalances: (...a: unknown[]) => mockGetSupplierBalances(...a),
  partners: { getAll: (...a: unknown[]) => mockPartnersGetAll(...a) },
  addOMTTransaction: (...a: unknown[]) => mockAddOMTTransaction(...a),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  MultiPaymentInput: (props: Record<string, unknown>) => {
    mockMpiProps.push(props);
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

// Active session — the RECEIVE-in-session combination this contract covers.
// Only `customer_name`/`customer_phone` are read by index.tsx from this
// object; `addToCart` is what captures the cart payload we assert against.
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: {
      id: 1,
      customer_name: "Jane Doe",
      customer_phone: "70111222",
    },
    linkTransaction: jest.fn(),
    addToCart: mockAddToCart,
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

// Switchable so the Whish guard can make WHISH the shop's own (base) system,
// as Services.whishReceiveFee.test.tsx does — otherwise WHISH is gated
// behind a partner.
let mockBaseSystem: "OMT" | "WHISH" = "OMT";
jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({
    baseSystem: mockBaseSystem,
    partnerSystem: mockBaseSystem === "OMT" ? "WHISH" : "OMT",
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

// Selects partner #7 on mount — stands in for the real selector's
// single-partner auto-select.
jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: ({ onSelect }: { onSelect: (id: number) => void }) => {
    const { useEffect } = jest.requireActual("react");
    useEffect(() => {
      onSelect(7);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  },
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

describe("Services page — session SEND offers no change-to-account", () => {
  beforeEach(() => {
    mockMpiProps.length = 0;
    mockBaseSystem = "OMT";
  });

  it("does not pass unreturnedChangeTo to the payment sheet in a session", async () => {
    await renderPage();
    const sendTab = screen
      .getAllByRole("button")
      .find(
        (b) =>
          (b.textContent ?? "").includes("OMT") &&
          (b.textContent ?? "").includes("\u2191"),
      );
    expect(sendTab).toBeDefined();
    fireEvent.click(sendTab!);
    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "100" } },
    );

    // Rule 28a: the sheet actually rendered on the SEND tab, with the
    // session's client pre-filled (so the client gate alone would pass).
    await waitFor(() => expect(mockMpiProps.length).toBeGreaterThan(0));
    const last = mockMpiProps[mockMpiProps.length - 1];
    expect(last.onReturnChange).toBeDefined();
    expect(last.unreturnedChangeTo).toBeUndefined();
  });
});
