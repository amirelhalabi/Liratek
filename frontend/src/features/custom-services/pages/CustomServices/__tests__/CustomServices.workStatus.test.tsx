/** @jest-environment jsdom */

/**
 * LIRA-083 — the Work Status select in HistoryModal (Received/In_Progress/
 * Ready/Delivered): renders the row's current value, calls
 * `api.setCustomServiceWorkStatus` on change, refreshes the list on
 * success, and the "All work status" dropdown filters the table.
 *
 * Harness mirrors CustomServices.advanceFulfillmentThrownError.test.tsx
 * (same file's established pattern: real `<CustomServices />` + real
 * `HistoryModal`, mocking only the read boundary and the endpoint under
 * test).
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import CustomServices from "../index";

const mockAddCustomService = jest.fn();
const mockDeleteCustomService = jest.fn();
const mockGetClients = jest.fn();
const mockPartnersGetAll = jest.fn().mockResolvedValue([]);
const mockGetCustomServices = jest.fn();
const mockGetCustomServicesSummary = jest.fn();
const mockSetCustomServiceWorkStatus = jest.fn();

jest.mock("@/api/backendApi", () => ({
  getTransactionBySource: jest.fn(),
  refundTransaction: jest.fn(),
}));

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    appEvents: { emit: jest.fn(), on: jest.fn(() => () => {}) },
    useApi: () => ({
      addCustomService: mockAddCustomService,
      deleteCustomService: mockDeleteCustomService,
      getClients: mockGetClients,
      getRates: jest.fn().mockResolvedValue([]),
      getAllSettings: jest.fn().mockResolvedValue([]),
      partners: { getAll: mockPartnersGetAll },
      getCustomServices: mockGetCustomServices,
      getCustomServicesSummary: mockGetCustomServicesSummary,
      advanceCustomServiceFulfillment: jest.fn(),
      setCustomServiceWorkStatus: mockSetCustomServiceWorkStatus,
      servicePresets: {
        list: jest.fn().mockResolvedValue({ success: true, data: [] }),
      },
    }),
    DataTable: actual.DataTable,
    // HistoryModal renders the @liratek/ui DateRangeFilter (the only copy).
    DateRangeFilter: actual.DateRangeFilter,
    // The app's useModalFocusFix re-exports the @liratek/ui hook.
    useModalFocusFix: actual.useModalFocusFix,
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
    PageHeader: ({
      title,
      subtitle,
      actions,
    }: {
      title: string;
      subtitle?: string;
      icon?: unknown;
      actions?: React.ReactNode;
    }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
        {actions}
      </div>
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
      <select
        data-testid="paid-by-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    ),
    MultiPaymentInput: () => <div data-testid="multi-payment-input" />,
    SearchBar: ({
      onFreeText,
    }: {
      onSearch?: unknown;
      onFreeText?: (v: string) => void;
      placeholder?: string;
      [key: string]: unknown;
    }) => (
      <input
        data-testid="search-bar"
        placeholder="e.g., Phone screen repair, SIM activation"
        onChange={(e) => onFreeText?.(e.target.value)}
      />
    ),
  };
});

jest.mock("../../../../../hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [
      { code: "CASH", label: "Cash" },
      { code: "CARD", label: "Card" },
      { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
    ],
    drawerAffectingMethods: [
      { code: "CASH", label: "Cash" },
      { code: "CARD", label: "Card" },
    ],
  }),
}));

jest.mock("../../../../sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));

jest.mock("../../../../sessions/hooks/useSessionAutoFill", () => ({
  useSessionAutoFill: () => ({
    customerName: "",
    customerPhone: "",
  }),
}));

jest.mock("../../../components/StatsCards", () => ({
  StatsCards: () => <div data-testid="stats-cards" />,
}));

jest.mock("@/utils/exchangeRates", () => ({
  getExchangeRates: () => ({ buyRate: 89500, sellRate: 89500 }),
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
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

const ZERO_SUMMARY = {
  count: 0,
  totalCostUsd: 0,
  totalCostLbp: 0,
  totalPriceUsd: 0,
  totalPriceLbp: 0,
  totalProfitUsd: 0,
  totalProfitLbp: 0,
};

const RECEIVED_DESC = "Sejel 3adli - Karim";
const READY_DESC = "Official paper - Rana";

function baseRow(overrides: Record<string, unknown>) {
  return {
    cost_usd: 5,
    cost_lbp: 0,
    price_usd: 15,
    price_lbp: 0,
    profit_usd: 10,
    profit_lbp: 0,
    paid_by: "CASH",
    status: "completed",
    client_id: null,
    client_name: null,
    phone_number: null,
    note: null,
    category: null,
    created_by: 1,
    edited_by: null,
    edited_at: null,
    is_refunded: 0,
    refunded_at: null,
    partner_mode: null,
    fulfillment_status: null,
    fulfilled_at: null,
    work_status: "Received",
    ...overrides,
  };
}

describe("CustomServices history — work status (LIRA-083)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetClients.mockResolvedValue([]);
    mockGetCustomServicesSummary.mockResolvedValue(ZERO_SUMMARY);
    mockGetCustomServices.mockResolvedValue([
      baseRow({
        id: 1,
        description: RECEIVED_DESC,
        work_status: "Received",
        created_at: "2026-08-29 09:00:00",
      }),
      baseRow({
        id: 2,
        description: READY_DESC,
        work_status: "Ready",
        created_at: "2026-08-29 10:00:00",
      }),
    ]);
    window.alert = jest.fn();
    mockSetCustomServiceWorkStatus.mockResolvedValue({ success: true });
  });

  async function openHistory() {
    render(<CustomServices />);
    fireEvent.click(screen.getByText("History"));
    await waitFor(() => screen.getByText(RECEIVED_DESC));
    await waitFor(() => screen.getByText(READY_DESC));
  }

  it("changing a row's work status calls the API with the new value and refreshes on success", async () => {
    await openHistory();

    const row = screen.getByText(RECEIVED_DESC).closest("tr") as HTMLElement;
    const select = within(row).getByTestId(
      "custom-service-work-status-1",
    ) as HTMLSelectElement;
    expect(select.value).toBe("Received");

    fireEvent.change(select, { target: { value: "In_Progress" } });

    await waitFor(() => {
      expect(mockSetCustomServiceWorkStatus).toHaveBeenCalledWith({
        id: 1,
        work_status: "In_Progress",
      });
    });
    // Refreshed the list after a successful change.
    await waitFor(() => {
      expect(mockGetCustomServices.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it("the work-status filter narrows the visible rows to the selected status", async () => {
    await openHistory();

    const filter = screen.getByTestId("custom-service-work-status-filter");
    fireEvent.change(filter, { target: { value: "Ready" } });

    expect(screen.queryByText(RECEIVED_DESC)).not.toBeInTheDocument();
    expect(screen.getByText(READY_DESC)).toBeInTheDocument();
  });

  it("surfaces a server-side rejection via alert instead of silently discarding it", async () => {
    mockSetCustomServiceWorkStatus.mockResolvedValue({
      success: false,
      error: "Not allowed",
    });
    await openHistory();

    const row = screen.getByText(RECEIVED_DESC).closest("tr") as HTMLElement;
    const select = within(row).getByTestId("custom-service-work-status-1");
    fireEvent.change(select, { target: { value: "Delivered" } });

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith("Not allowed");
    });
  });
});
