/** @jest-environment jsdom */

/**
 * LIRA-155 — Insurance category (Custom Services form)
 *
 * "Insurance" is a new SERVICE_CATEGORIES entry that reuses the
 * hold_money precedent's mechanism — category selection swaps in extra
 * form behaviour — but NOT hold_money's shape: it is not a self-contained
 * section with its own table. It takes the STANDARD custom-service submit
 * path (description/cost/price/payment), and selecting it only:
 *   1. Pre-selects "Via Partner" (the insurer is normally the partner
 *      performing the service) — while leaving the operator free to change
 *      it (owner decision, item 2).
 *   2. Stamps `fulfillment_status: "ORDERED"` on the submitted payload, so
 *      the row starts fulfilment-tracked. Every other category omits the
 *      field entirely.
 * Payment is a fully independent axis — the Payment Method section behaves
 * exactly as it does for any other service, never gated on fulfilment
 * status (the explicit maintenance_jobs `isPaidStatus` anti-pattern this
 * ticket was told not to copy).
 *
 * Mock setup mirrors the sibling CustomServices.viaPartner.test.tsx, which
 * already covers VIA's own mechanics (payment section stays mounted,
 * submit guards, payload shape) — this file only covers what is NEW to
 * Insurance: the category swap itself, the VIA pre-select (and that it is
 * only a pre-select, not a lock), and the `fulfillment_status` stamp.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CustomServices from "../index";

// ── Mock useApi ──
const mockAddCustomService = jest.fn();
const mockDeleteCustomService = jest.fn();
const mockGetClients = jest.fn();
const mockPartnersGetAll = jest.fn().mockResolvedValue([]);

jest.mock("@liratek/ui", () => ({
  appEvents: { emit: jest.fn(), on: jest.fn(() => () => {}) },
  useApi: () => ({
    addCustomService: mockAddCustomService,
    deleteCustomService: mockDeleteCustomService,
    getClients: mockGetClients,
    getRates: jest.fn().mockResolvedValue([]),
    // useAutoPrintReceipt pulls shop info via useShopInfo(), which calls
    // this on mount.
    getAllSettings: jest.fn().mockResolvedValue([]),
    // PartnerSelector (rendered by ForPartnerToggle once checked) fetches
    // the partner list on mount.
    partners: { getAll: mockPartnersGetAll },
  }),
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
  // NOTE: no DataTable stub here — HistoryModal (the only consumer) is
  // mocked out below, so DataTable is never actually rendered.
  MultiPaymentInput: ({
    totalAmount,
    onChange,
    totals,
    currency,
    totalAmountCurrency,
  }: {
    totalAmount?: number;
    onChange?: (payments: unknown[]) => void;
    totals?: { amount: number; currency: string }[];
    currency?: string;
    totalAmountCurrency?: string;
  }) => (
    <div data-testid="multi-payment-input">
      <div data-testid="multi-payment-props">
        {JSON.stringify({ totals, currency, totalAmountCurrency })}
      </div>
      <select
        data-testid="paid-by-select"
        onChange={(e) =>
          onChange?.([
            {
              method: e.target.value,
              amount: totalAmount ?? 0,
              currencyCode: "USD",
            },
          ])
        }
      >
        <option value="">-- choose --</option>
        <option value="CASH">Cash</option>
        <option value="CARD">Card</option>
        <option value="CUSTOMER_ACCOUNT">Customer Account</option>
      </select>
    </div>
  ),
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
}));

// ── Mock usePaymentMethods ──
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

// ── Mock useSession — no active session ──
const mockLinkTransaction = jest.fn();
const mockAddToCart = jest.fn();
jest.mock("../../../../sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: mockLinkTransaction,
    addToCart: mockAddToCart,
  }),
}));

// ── Mock useSessionAutoFill ──
jest.mock("../../../../sessions/hooks/useSessionAutoFill", () => ({
  useSessionAutoFill: () => ({
    customerName: "",
    customerPhone: "",
  }),
}));

// ── Mock HistoryModal ──
jest.mock("../components/HistoryModal", () => ({
  HistoryModal: () => <div data-testid="history-modal" />,
}));

// ── Mock StatsCards ──
jest.mock("../../../components/StatsCards", () => ({
  StatsCards: () => <div data-testid="stats-cards" />,
}));

// ── Mock getExchangeRates ──
jest.mock("@/utils/exchangeRates", () => ({
  getExchangeRates: () => ({ buyRate: 89500, sellRate: 89500 }),
}));

// ── Mock useCustomServices hook ──
const mockReload = jest.fn();
jest.mock("../../../hooks/useCustomServices", () => ({
  useCustomServices: () => ({
    history: [],
    loading: false,
    error: null,
    reload: mockReload,
    summary: {
      count: 0,
      totalCostUsd: 0,
      totalCostLbp: 0,
      totalPriceUsd: 0,
      totalPriceLbp: 0,
      totalProfitUsd: 0,
      totalProfitLbp: 0,
    },
  }),
}));

// ── Mock logger ──
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

// ── Mock useSaveAsClient ──
jest.mock("@/shared/hooks/useSaveAsClient", () => ({
  useSaveAsClient: () => ({
    saveAsClient: false,
    setSaveAsClient: jest.fn(),
    showCheckbox: false,
    trySaveAsClient: jest.fn().mockResolvedValue({ clientId: null }),
    resetSaveAsClient: jest.fn(),
  }),
}));

// ── Mock SaveAsClientCheckbox ──
jest.mock("@/shared/components/SaveAsClientCheckbox", () => ({
  SaveAsClientCheckbox: () => null,
}));

const SOLE_PARTNER = {
  id: 21,
  name: "Fixit Co",
  phone: null,
  notes: null,
  is_active: 1,
  system_association: null,
  created_at: "",
  updated_at: "",
};

function fillCostAndPrice(costUsdStr: string, priceUsdStr: string) {
  const usdInputs = screen.getAllByPlaceholderText("0.00");
  fireEvent.change(usdInputs[0], { target: { value: costUsdStr } }); // cost USD
  fireEvent.change(usdInputs[1], { target: { value: priceUsdStr } }); // price USD
}

describe("CustomServices — Insurance category (LIRA-155)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAddCustomService.mockResolvedValue({ success: true, id: 501 });
    mockGetClients.mockResolvedValue([]);
    mockPartnersGetAll.mockResolvedValue([]);
  });

  it("renders an Insurance category button", () => {
    render(<CustomServices />);
    expect(screen.getByText("Insurance")).toBeInTheDocument();
  });

  it("swaps in insurance behaviour on the STANDARD form — not the self-contained Hold Money UI", () => {
    render(<CustomServices />);

    fireEvent.click(screen.getByText("Insurance"));

    // Still the ordinary description/search form...
    expect(screen.getByTestId("search-bar")).toBeInTheDocument();
    // ...never Hold Money's own section.
    expect(screen.queryByTestId("hold-money-submit")).not.toBeInTheDocument();
    // Header swaps its title/icon the same way it does for Hold Money.
    expect(screen.getByText("New Insurance")).toBeInTheDocument();
  });

  it("pre-selects Via Partner when Insurance is chosen, but leaves it changeable", async () => {
    render(<CustomServices />);

    fireEvent.click(screen.getByText("Insurance"));

    expect(
      screen.getByTestId("custom-service-via-partner-toggle"),
    ).toBeChecked();
    // VIA does not hide the payment section (unlike FOR).
    expect(screen.getByTestId("multi-payment-input")).toBeInTheDocument();

    // The operator can still turn it back off.
    fireEvent.click(screen.getByTestId("custom-service-via-partner-toggle"));
    expect(
      screen.getByTestId("custom-service-via-partner-toggle"),
    ).not.toBeChecked();
  });

  it("does not re-stomp an operator's deliberate switch to For Partner when Insurance is re-clicked", () => {
    render(<CustomServices />);

    fireEvent.click(screen.getByText("Insurance"));
    // Operator explicitly moves off VIA onto FOR.
    fireEvent.click(screen.getByTestId("custom-service-via-partner-toggle")); // VIA off
    fireEvent.click(screen.getByTestId("custom-service-for-partner-toggle")); // FOR on
    expect(
      screen.getByTestId("custom-service-for-partner-toggle"),
    ).toBeChecked();

    // Re-selecting Insurance (e.g. from a category re-click) must not
    // silently flip the operator's choice back to VIA.
    fireEvent.click(screen.getByText("Insurance"));
    expect(
      screen.getByTestId("custom-service-for-partner-toggle"),
    ).toBeChecked();
    expect(
      screen.getByTestId("custom-service-via-partner-toggle"),
    ).not.toBeChecked();
  });

  it("keeps the payment section visible and usable for an insurance sale — payment is independent of fulfilment status", () => {
    render(<CustomServices />);

    fireEvent.click(screen.getByText("Insurance"));
    fillCostAndPrice("10", "20");

    // Payment section is present and can take a leg, exactly like any
    // other service — nothing here is gated on a status the create form
    // doesn't even display.
    expect(screen.getByTestId("multi-payment-input")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("paid-by-select"), {
      target: { value: "CASH" },
    });
  });

  it("stamps fulfillment_status: ORDERED on submit for an insurance sale, alongside a normal payment leg (Via Partner)", async () => {
    mockPartnersGetAll.mockResolvedValue([SOLE_PARTNER]);
    render(<CustomServices />);

    fireEvent.click(screen.getByText("Insurance"));
    await screen.findByText("Partner: Fixit Co");

    fillCostAndPrice("20", "35");
    fireEvent.change(screen.getByTestId("paid-by-select"), {
      target: { value: "CASH" },
    });

    const submitButton = screen.getByText("Submit Service").closest("button");
    await waitFor(() => expect(submitButton).not.toBeDisabled());
    fireEvent.click(submitButton as HTMLElement);

    await waitFor(() => {
      expect(mockAddCustomService).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "insurance",
          fulfillment_status: "ORDERED",
          partnerMode: "VIA",
          partnerId: 21,
          paid_by: "CASH",
        }),
      );
    });
  });

  it("does NOT stamp fulfillment_status for an ordinary (non-insurance) service", async () => {
    render(<CustomServices />);

    fillCostAndPrice("2", "6");
    fireEvent.change(screen.getByTestId("paid-by-select"), {
      target: { value: "CASH" },
    });

    const submitButton = screen.getByText("Submit Service").closest("button");
    fireEvent.click(submitButton as HTMLElement);

    await waitFor(() => expect(mockAddCustomService).toHaveBeenCalled());
    const call = mockAddCustomService.mock.calls[0][0];
    expect(call.fulfillment_status).toBeUndefined();
  });
});
