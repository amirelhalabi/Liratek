/**
 * CustomServices — 2 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 2).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createCustomServiceSchema } from "@liratek/core";
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
    // loadPresets() (CustomServices/index.tsx) fires unconditionally on
    // mount — unmocked, it logs "Cannot read properties of undefined
    // (reading 'list')" noise even though the (caught) error doesn't fail
    // these tests.
    servicePresets: {
      list: jest.fn().mockResolvedValue({ success: true, data: [] }),
    },
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

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockAddCustomService as unknown as jest.Mock).mockReset();
  (mockDeleteCustomService as unknown as jest.Mock).mockReset();
  (mockGetClients as unknown as jest.Mock).mockReset();
  (mockPartnersGetAll as unknown as jest.Mock).mockReset();
  (mockPartnersGetAll as unknown as jest.Mock).mockResolvedValue([]);
  (mockLinkTransaction as unknown as jest.Mock).mockReset();
  (mockAddToCart as unknown as jest.Mock).mockReset();
  (mockReload as unknown as jest.Mock).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("CustomServices.insurance (LIRA-155)", () => {
  beforeAll(resetBetweenFiles);

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
      // Owner decision 2026-10-07: the payment sheet waits for a selling
      // price, so enter one before looking for it.
      fireEvent.change(screen.getAllByPlaceholderText("0.00")[1], {
        target: { value: "10" },
      });
      // VIA does not hide the payment section (unlike FOR).
      expect(screen.getByTestId("multi-payment-input")).toBeInTheDocument();

      // The operator can still turn it back off (back to Customer).
      fireEvent.click(screen.getByTestId("custom-service-partner-mode-none"));
      expect(
        screen.getByTestId("custom-service-via-partner-toggle"),
      ).not.toBeChecked();
    });

    it("does not re-stomp an operator's deliberate switch to For Partner when Insurance is re-clicked", () => {
      render(<CustomServices />);

      fireEvent.click(screen.getByText("Insurance"));
      // Operator explicitly moves off VIA onto FOR.
      fireEvent.click(screen.getByTestId("custom-service-partner-mode-none")); // VIA off
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
      // LIRA-360: an insurance sale needs its type before it can be submitted.
      fireEvent.change(screen.getByTestId("insurance-type-select"), {
        target: { value: "COMPULSORY" },
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

  /**
   * LIRA-360 — the insurance type picker. Not proven failing-first: written
   * after the picker was added (rule 17 — said plainly, not re-broken).
   */
  describe("CustomServices — insurance type (LIRA-360)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("shows the type picker only for the Insurance category", () => {
      render(<CustomServices />);
      expect(
        screen.queryByTestId("insurance-type-select"),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByText("Insurance"));
      expect(screen.getByTestId("insurance-type-select")).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "Domestic worker" }),
      ).toBeInTheDocument();
    });

    it("blocks the sale until a type is picked, then sends it in the schema's shape", async () => {
      mockPartnersGetAll.mockResolvedValue([SOLE_PARTNER]);
      render(<CustomServices />);
      fireEvent.click(screen.getByText("Insurance"));
      await screen.findByText("Partner: Fixit Co");
      fillCostAndPrice("20", "35");
      fireEvent.change(screen.getByTestId("paid-by-select"), {
        target: { value: "CASH" },
      });

      const submitButton = screen.getByText("Submit Service").closest("button");
      expect(submitButton).toBeDisabled();

      fireEvent.change(screen.getByTestId("insurance-type-select"), {
        target: { value: "LIFE" },
      });
      await waitFor(() => expect(submitButton).not.toBeDisabled());
      fireEvent.click(submitButton as HTMLElement);

      await waitFor(() => expect(mockAddCustomService).toHaveBeenCalled());
      // Rule 24: read the field back through the real schema, not by hand.
      const parsed = createCustomServiceSchema.parse(
        mockAddCustomService.mock.calls[0][0],
      );
      expect(parsed.insurance_type).toBe("LIFE");
    });

    it("never sends a type for another category", async () => {
      render(<CustomServices />);
      fireEvent.click(screen.getByText("Insurance"));
      fireEvent.change(screen.getByTestId("insurance-type-select"), {
        target: { value: "LIFE" },
      });
      fireEvent.click(screen.getByText("Repair"));
      // Insurance pre-selected Via Partner; this repair is a plain sale.
      fireEvent.click(screen.getByTestId("custom-service-partner-mode-none"));
      fillCostAndPrice("2", "6");
      fireEvent.change(screen.getByTestId("paid-by-select"), {
        target: { value: "CASH" },
      });
      fireEvent.click(
        screen.getByText("Submit Service").closest("button") as HTMLElement,
      );
      await waitFor(() => expect(mockAddCustomService).toHaveBeenCalled());
      expect(
        createCustomServiceSchema.safeParse(
          mockAddCustomService.mock.calls[0][0],
        ).success,
      ).toBe(true);
    });
  });
});

describe("CustomServices.viaPartner (LIRA-154)", () => {
  beforeAll(resetBetweenFiles);

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

  // Setup notes from this file (its mocks are the shared ones above):
  // Shared/overridable so individual tests can seed a specific partner list —
  // a fresh jest.fn() per useApi() call would not be reachable from a test's
  // mockResolvedValueOnce.
  // ── Mock useSession — no active session, so these tests exercise the
  //    direct-submit branch, not the session-basket gate. ──

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
      // Owner decision 2026-10-07: the payment sheet waits for a selling
      // price, so enter one before looking for it.
      fireEvent.change(screen.getAllByPlaceholderText("0.00")[1], {
        target: { value: "10" },
      });

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

      expect(
        screen.queryByTestId("multi-payment-input"),
      ).not.toBeInTheDocument();
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
});
