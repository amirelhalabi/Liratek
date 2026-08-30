/** @jest-environment jsdom */

/**
 * LIRA-154 — "Via Partner" custom services
 *
 * "Via Partner" is the MIRROR of the existing "For Partner" mode: instead of
 * no counter payment (FOR: the partner is billed the full price), a VIA
 * service has a real walk-in customer who pays US now, through the normal
 * payment section — and we separately owe the selected partner the COST
 * (not the price). Core booking (the CREDIT-of-cost ledger row) is covered
 * by CustomServiceRepository.viaPartner.test.ts; this file covers only the
 * page-level contract:
 *   1. VIA keeps the Payment Method section mounted and live (FOR hides it).
 *   2. Toggling VIA on does NOT clear any payment lines already entered —
 *      unlike toggling FOR on, which deliberately does.
 *   3. The submit guard blocks VIA with no partner selected, and separately
 *      with no payment leg.
 *   4. The submitted payload carries `partnerMode: "VIA"` + `partnerId`
 *      alongside the normal `payments` legs.
 *
 * Mirrors the existing CustomServices.test.tsx mock setup — jest.mock calls
 * are file-scoped, and that file's own suite already guards the FOR-mode
 * behaviors this file must not regress (LIRA-081/118/121), so they aren't
 * re-asserted exhaustively here beyond one direct regression check.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CustomServices from "../index";

// ── Mock useApi ──
const mockAddCustomService = jest.fn();
const mockDeleteCustomService = jest.fn();
const mockGetClients = jest.fn();
// Shared/overridable so individual tests can seed a specific partner list —
// a fresh jest.fn() per useApi() call would not be reachable from a test's
// mockResolvedValueOnce.
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
  // mocked out below, so DataTable is never actually rendered by anything
  // this suite exercises.
  // Simplified stand-in that mirrors the sibling CustomServices.test.tsx's
  // mock: a plain <select> commits ONE payment leg for the given method at
  // the current total. Real enough to prove "the payment section is
  // mounted and can add a leg" and "a leg survives a VIA toggle", which is
  // all these tests need from it.
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

// ── Mock useSession — no active session, so these tests exercise the
//    direct-submit branch, not the session-basket gate. ──
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

describe("CustomServices — Via Partner (LIRA-154)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAddCustomService.mockResolvedValue({ success: true, id: 99 });
    mockGetClients.mockResolvedValue([]);
    mockPartnersGetAll.mockResolvedValue([]);
  });

  it("renders a distinct Via Partner toggle alongside For Partner", () => {
    render(<CustomServices />);

    expect(
      screen.getByTestId("custom-service-for-partner-toggle"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("custom-service-via-partner-toggle"),
    ).toBeInTheDocument();
  });

  it("KEEPS the payment section mounted when Via Partner is checked (unlike For Partner, which hides it)", () => {
    render(<CustomServices />);

    expect(screen.getByTestId("multi-payment-input")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("custom-service-via-partner-toggle"));

    // Still there — VIA must not hide the payment section.
    expect(screen.getByTestId("multi-payment-input")).toBeInTheDocument();
    // ...and the VIA-specific notice appears ADDITIONALLY, not instead.
    expect(
      screen.getByTestId("custom-service-via-partner-notice"),
    ).toBeInTheDocument();
  });

  it("regression: For Partner still hides the payment section (unaffected by the VIA addition)", () => {
    render(<CustomServices />);

    fireEvent.click(screen.getByTestId("custom-service-for-partner-toggle"));

    expect(screen.queryByTestId("multi-payment-input")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("custom-service-partner-no-payment-notice"),
    ).toBeInTheDocument();
    // The VIA toggle must have been implicitly unchecked (mutually
    // exclusive modes) — its notice must not be showing.
    expect(
      screen.queryByTestId("custom-service-via-partner-notice"),
    ).not.toBeInTheDocument();
  });

  it("does NOT clear an already-entered payment line when Via Partner is toggled on", async () => {
    mockPartnersGetAll.mockResolvedValue([SOLE_PARTNER]);
    render(<CustomServices />);

    fillCostAndPrice("4", "10");

    // Enter a payment leg BEFORE turning VIA on.
    fireEvent.change(screen.getByTestId("paid-by-select"), {
      target: { value: "CASH" },
    });

    fireEvent.click(screen.getByTestId("custom-service-via-partner-toggle"));
    await screen.findByText("Partner: Fixit Co");

    // If the FOR-only clearing block had (wrongly) also run for VIA, the
    // leg entered above would be gone and the VIA payment-leg guard would
    // keep the submit button disabled. It must be enabled here.
    const submitButton = screen.getByText("Submit Service").closest("button");
    await waitFor(() => expect(submitButton).not.toBeDisabled());

    fireEvent.click(submitButton as HTMLElement);

    await waitFor(() => {
      expect(mockAddCustomService).toHaveBeenCalledWith(
        expect.objectContaining({
          partnerId: 21,
          partnerMode: "VIA",
          paid_by: "CASH",
          payments: expect.any(Array),
        }),
      );
    });
  });

  it("submit guard: blocks (stays disabled) when Via Partner is checked with no partner available", () => {
    // mockPartnersGetAll resolves [] (default) — no partner ever gets
    // auto-selected.
    render(<CustomServices />);

    fillCostAndPrice("2", "6");
    fireEvent.change(screen.getByTestId("paid-by-select"), {
      target: { value: "CASH" },
    });
    fireEvent.click(screen.getByTestId("custom-service-via-partner-toggle"));

    const submitButton = screen.getByText("Submit Service").closest("button");
    expect(submitButton).toBeDisabled();
    expect(mockAddCustomService).not.toHaveBeenCalled();
  });

  it("submit guard: blocks (stays disabled) when Via Partner is checked with a partner but no payment leg", async () => {
    mockPartnersGetAll.mockResolvedValue([SOLE_PARTNER]);
    render(<CustomServices />);

    fillCostAndPrice("2", "6");
    fireEvent.click(screen.getByTestId("custom-service-via-partner-toggle"));
    await screen.findByText("Partner: Fixit Co");

    // No payment leg was ever entered.
    const submitButton = screen.getByText("Submit Service").closest("button");
    expect(submitButton).toBeDisabled();
    expect(mockAddCustomService).not.toHaveBeenCalled();
  });

  it("carries partnerMode: VIA and the selected partnerId in the submitted payload, alongside normal payment legs", async () => {
    mockPartnersGetAll.mockResolvedValue([SOLE_PARTNER]);
    render(<CustomServices />);

    fillCostAndPrice("3", "8");
    fireEvent.click(screen.getByTestId("custom-service-via-partner-toggle"));
    await screen.findByText("Partner: Fixit Co");

    fireEvent.change(screen.getByTestId("paid-by-select"), {
      target: { value: "CARD" },
    });

    const submitButton = screen.getByText("Submit Service").closest("button");
    await waitFor(() => expect(submitButton).not.toBeDisabled());
    fireEvent.click(submitButton as HTMLElement);

    await waitFor(() => {
      expect(mockAddCustomService).toHaveBeenCalledWith(
        expect.objectContaining({
          cost_usd: 3,
          price_usd: 8,
          paid_by: "CARD",
          partnerId: 21,
          partnerMode: "VIA",
        }),
      );
    });
    // FOR's "no payments forwarded" rule must NOT apply to VIA.
    const call = mockAddCustomService.mock.calls[0][0];
    expect(call.payments).toBeDefined();
    expect(call.payments.length).toBeGreaterThan(0);

    await waitFor(() => expect(mockReload).toHaveBeenCalled());
  });

  it("shows the VIA-specific notice with both the customer-owed price and the partner-owed cost", () => {
    render(<CustomServices />);

    fillCostAndPrice("4", "9");
    fireEvent.click(screen.getByTestId("custom-service-via-partner-toggle"));

    const notice = screen.getByTestId("custom-service-via-partner-notice");
    expect(notice).toHaveTextContent("$9.00");
    expect(notice).toHaveTextContent("$4.00");
    expect(notice).toHaveTextContent("settled later on the Partners page");
  });
});
