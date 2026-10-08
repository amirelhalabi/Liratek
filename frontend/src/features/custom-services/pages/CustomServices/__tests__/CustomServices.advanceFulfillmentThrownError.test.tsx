/** @jest-environment jsdom */

/**
 * LIRA-247 — `HistoryModal.tsx`'s `handleAdvanceFulfillment` catch block
 * hardcodes `alert("Failed to update status.")` on ANY thrown error,
 * discarding the real reason. `requestJson` (web) throws a plain
 * `{status,message,details}` object on a non-2xx response (a role 403,
 * a business-rule refusal turned into a thrown error, etc.) — NOT an
 * `Error` instance — so a naive catch block has no way to recover the
 * server's actual message.
 *
 * Harness mirrors `CustomServices.insuranceFulfillmentHistory.test.tsx`
 * (same file's established pattern: real `<CustomServices />` + real
 * `HistoryModal`, mocking only the read boundary and the fulfilment
 * endpoint under test).
 *
 * Rule 17: this test was run against the pre-fix `HistoryModal.tsx` and
 * failed — the alert read the generic "Failed to update status." — before
 * `getApiErrorMessage` was wired into that catch block.
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
const mockAdvanceCustomServiceFulfillment = jest.fn();

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
      advanceCustomServiceFulfillment: mockAdvanceCustomServiceFulfillment,
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

const ORDERED_DESC = "Home insurance - Alice";

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
    created_by: 1,
    edited_by: null,
    edited_at: null,
    is_refunded: 0,
    refunded_at: null,
    partner_mode: null,
    fulfillment_status: null,
    fulfilled_at: null,
    ...overrides,
  };
}

describe("CustomServices history — advance-fulfillment thrown error is surfaced (LIRA-247)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetClients.mockResolvedValue([]);
    mockGetCustomServicesSummary.mockResolvedValue(ZERO_SUMMARY);
    mockGetCustomServices.mockResolvedValue([
      baseRow({
        id: 1,
        description: ORDERED_DESC,
        category: "insurance",
        fulfillment_status: "ORDERED",
        created_at: "2026-08-29 09:00:00",
      }),
    ]);
    window.alert = jest.fn();
  });

  it("alerts the thrown ApiError's real message instead of the generic 'Failed to update status.'", async () => {
    mockAdvanceCustomServiceFulfillment.mockRejectedValue({
      status: 403,
      message: "Only an admin can advance this status",
      details: {},
    });

    render(<CustomServices />);
    fireEvent.click(screen.getByText("History"));
    await waitFor(() => screen.getByText(ORDERED_DESC));

    const row = screen.getByText(ORDERED_DESC).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByText("Mark Issued"));

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalled();
    });
    const alertMessage = (window.alert as jest.Mock).mock.calls[0][0] as string;
    expect(alertMessage).toContain("Only an admin can advance this status");
    expect(alertMessage).not.toBe("Failed to update status.");
  });
});
