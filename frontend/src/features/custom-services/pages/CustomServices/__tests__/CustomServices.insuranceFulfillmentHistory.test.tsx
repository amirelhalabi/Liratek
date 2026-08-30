/** @jest-environment jsdom */

/**
 * LIRA-155 — Insurance fulfilment status + Cancel-as-refund (History modal)
 *
 * Interaction-level (rule 17's spirit, same approach as LIRA-130's
 * CustomServices.refundedHistoryDisplay.test.tsx): renders the REAL
 * `<CustomServices />` page with the REAL `HistoryModal` and `DataTable`,
 * mocking only `useApi().getCustomServices()` (the read boundary) and
 * `@/api/backendApi`'s `getTransactionBySource`/`refundTransaction` (the
 * Cancel boundary) — a shallow props check on a helper would not catch a
 * wiring mistake in `renderRow`, exactly like every prior bug in this file.
 *
 * Covers:
 *   1. The Status column renders a fulfilment badge + the ONE legal next
 *      step for a tracked, non-refunded insurance row — never a menu of
 *      skip-ahead options (D4.2's strict forward-only, single-step rule).
 *   2. A terminal (DELIVERED) row offers no advance control.
 *   3. A refunded insurance row renders "Cancelled" in the Status column —
 *      derived from `is_refunded`, never a stored status (D4.2b).
 *   4. A non-insurance row's Status cell is blank (untracked).
 *   5. Clicking the advance button calls `useApi().advanceCustomServiceFulfillment`
 *      — the dual-transport endpoint — not a raw `window.api` call.
 *   6. Cancel looks up the unified transaction by source and calls the
 *      GENERIC refund path (`refundTransaction`) — never `deleteCustomService`
 *      (which hard-voids and vanishes the row from `getAll`).
 *   7. Cancel is not offered on an already-cancelled row (not undoable).
 *   8. The "Insurance" history tab filters the list to just that category.
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import CustomServices from "../index";
import { getTransactionBySource, refundTransaction } from "@/api/backendApi";

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
      // The real read path under test: useCustomServices() calls these two
      // directly through useApi().
      getCustomServices: mockGetCustomServices,
      getCustomServicesSummary: mockGetCustomServicesSummary,
      // The fulfilment endpoint HistoryModal's advance button calls.
      advanceCustomServiceFulfillment: mockAdvanceCustomServiceFulfillment,
    }),
    // Real DataTable — HistoryModal's renderRow must actually execute.
    DataTable: actual.DataTable,
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
const DELIVERED_DESC = "Car insurance - Bob";
const CANCELLED_DESC = "Travel insurance - Cara";
const NON_INSURANCE_DESC = "Screen repair walk-in";

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

describe("CustomServices history — Insurance fulfilment + Cancel (LIRA-155)", () => {
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
      baseRow({
        id: 2,
        description: DELIVERED_DESC,
        category: "insurance",
        fulfillment_status: "DELIVERED",
        fulfilled_at: "2026-08-29 10:00:00",
        created_at: "2026-08-29 08:00:00",
      }),
      baseRow({
        id: 3,
        description: CANCELLED_DESC,
        category: "insurance",
        fulfillment_status: "ISSUED",
        is_refunded: 1,
        refunded_at: "2026-08-29 11:00:00",
        created_at: "2026-08-29 07:00:00",
      }),
      baseRow({
        id: 4,
        description: NON_INSURANCE_DESC,
        category: "repair",
        fulfillment_status: null,
        created_at: "2026-08-29 06:00:00",
      }),
    ]);
  });

  async function openHistory() {
    render(<CustomServices />);
    fireEvent.click(screen.getByText("History"));
    await waitFor(() => screen.getByText(ORDERED_DESC));
    await waitFor(() => screen.getByText(DELIVERED_DESC));
    await waitFor(() => screen.getByText(CANCELLED_DESC));
    await waitFor(() => screen.getByText(NON_INSURANCE_DESC));
  }

  it("renders the fulfilment badge and offers only the ONE legal next step (ORDERED -> Mark Issued)", async () => {
    await openHistory();

    const row = screen.getByText(ORDERED_DESC).closest("tr") as HTMLElement;
    expect(within(row).getByText("Ordered")).toBeInTheDocument();
    expect(within(row).getByText("Mark Issued")).toBeInTheDocument();
    // No skip-ahead options offered — never a menu, just the one button.
    expect(within(row).queryByText("Mark Received")).not.toBeInTheDocument();
    expect(within(row).queryByText("Mark Delivered")).not.toBeInTheDocument();
  });

  it("offers no advance control once a row is terminal (Delivered)", async () => {
    await openHistory();

    const row = screen.getByText(DELIVERED_DESC).closest("tr") as HTMLElement;
    expect(within(row).getByText("Delivered")).toBeInTheDocument();
    expect(within(row).queryByText(/^Mark /)).not.toBeInTheDocument();
  });

  it('renders "Cancelled" — derived from is_refunded, never the raw fulfilment status — for a refunded insurance', async () => {
    await openHistory();

    const row = screen.getByText(CANCELLED_DESC).closest("tr") as HTMLElement;
    expect(within(row).getByText("Cancelled")).toBeInTheDocument();
    expect(within(row).queryByText("Issued")).not.toBeInTheDocument();
  });

  it("leaves the Status cell blank for a non-insurance row (untracked)", async () => {
    await openHistory();

    const row = screen
      .getByText(NON_INSURANCE_DESC)
      .closest("tr") as HTMLElement;
    expect(within(row).queryByText(/^Mark /)).not.toBeInTheDocument();
    expect(within(row).queryByText("Cancelled")).not.toBeInTheDocument();
    expect(within(row).queryByText("Ordered")).not.toBeInTheDocument();
  });

  it("clicking the advance button calls useApi().advanceCustomServiceFulfillment with the single next status", async () => {
    mockAdvanceCustomServiceFulfillment.mockResolvedValue({ success: true });
    await openHistory();

    const row = screen.getByText(ORDERED_DESC).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByText("Mark Issued"));

    await waitFor(() => {
      expect(mockAdvanceCustomServiceFulfillment).toHaveBeenCalledWith({
        id: 1,
        fulfillment_status: "ISSUED",
      });
    });
  });

  it("Cancel looks up the transaction by source and calls the GENERIC refund path — never deleteCustomService", async () => {
    window.confirm = jest.fn().mockReturnValue(true);
    (getTransactionBySource as jest.Mock).mockResolvedValue({ id: 777 });
    (refundTransaction as jest.Mock).mockResolvedValue({ success: true });

    await openHistory();

    const row = screen.getByText(ORDERED_DESC).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByTitle("Cancel insurance (refund)"));

    await waitFor(() => {
      expect(getTransactionBySource).toHaveBeenCalledWith("custom_services", 1);
      expect(refundTransaction).toHaveBeenCalledWith(777);
    });
    expect(mockDeleteCustomService).not.toHaveBeenCalled();
  });

  it("does not offer Cancel on an already-cancelled (refunded) insurance row", async () => {
    await openHistory();

    const row = screen.getByText(CANCELLED_DESC).closest("tr") as HTMLElement;
    expect(
      within(row).queryByTitle("Cancel insurance (refund)"),
    ).not.toBeInTheDocument();
  });

  it("still shows the ordinary Void action (not Cancel) for a non-insurance row", async () => {
    await openHistory();

    const row = screen
      .getByText(NON_INSURANCE_DESC)
      .closest("tr") as HTMLElement;
    expect(within(row).getByTitle("Void service")).toBeInTheDocument();
    expect(
      within(row).queryByTitle("Cancel insurance (refund)"),
    ).not.toBeInTheDocument();
  });

  it('filters the list to Insurance-only rows via the "Insurance" history tab', async () => {
    await openHistory();

    fireEvent.click(screen.getByTestId("custom-service-history-tab-insurance"));

    expect(screen.queryByText(NON_INSURANCE_DESC)).not.toBeInTheDocument();
    expect(screen.getByText(ORDERED_DESC)).toBeInTheDocument();
    expect(screen.getByText(DELIVERED_DESC)).toBeInTheDocument();
    expect(screen.getByText(CANCELLED_DESC)).toBeInTheDocument();

    // Switching back to "All" restores it.
    fireEvent.click(screen.getByTestId("custom-service-history-tab-all"));
    expect(screen.getByText(NON_INSURANCE_DESC)).toBeInTheDocument();
  });
});
