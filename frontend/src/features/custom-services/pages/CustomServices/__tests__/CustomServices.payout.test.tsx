/** @jest-environment jsdom */

/**
 * NOT RUN — proven at the end-of-batch gate.
 *
 * OWNER_NOTES_REMAINING_BUILD.md #16 — "Pay out" (Route A, the Syria
 * transfer OUT, migration v185). Not a 3rd partner mode — a payout is still
 * `partnerMode: "VIA"` underneath, gated by a plain sub-checkbox that only
 * appears once "Via Partner" is checked and flips `direction: "OUT"`.
 * Mirrors CustomServices.viaPartner.test.tsx's mock scaffold and
 * `fillCostAndPrice` helper verbatim — the page-level contract only; core
 * booking is covered by CustomServiceRepository.payout.test.ts.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CustomServices from "../index";
import { createCustomServiceSchema } from "@liratek/core";

const mockAddCustomService = jest.fn();
const mockDeleteCustomService = jest.fn();
const mockGetClients = jest.fn();
const mockPartnersGetAll = jest.fn().mockResolvedValue([]);

// Fix-round I7 (rule 25): `useApi()` must return a STABLE reference across
// renders — production only gets away with a fresh object because
// `ApiProvider` happens to hand out a module-level singleton
// (`backendApiAdapter`), which is an implicit contract, not a guarantee. A
// `jest.mock` factory that returns `{ ...literal }` from inside the
// `useApi: () => (...)` arrow allocates a NEW object every call, which is
// exactly the unstable identity production hides — see
// `FeatureFlagContext.tsx` / `CurrencyContext.authGate.test.tsx` for the
// canonical hazard this guards against (rule 25's `PartPicker.tsx`
// incident). This page doesn't currently put `api` in a dependency array,
// so the unstable literal used previously didn't break anything TODAY, but
// the mock should not model behaviour production never allows.
const mockApi = {
  addCustomService: mockAddCustomService,
  deleteCustomService: mockDeleteCustomService,
  getClients: mockGetClients,
  getRates: jest.fn().mockResolvedValue([]),
  getAllSettings: jest.fn().mockResolvedValue([]),
  partners: { getAll: mockPartnersGetAll },
  servicePresets: {
    list: jest.fn().mockResolvedValue({ success: true, data: [] }),
  },
};

jest.mock("@liratek/ui", () => ({
  appEvents: { emit: jest.fn(), on: jest.fn(() => () => {}) },
  useApi: () => mockApi,
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
  MultiPaymentInput: ({
    totalAmount,
    onChange,
  }: {
    totalAmount?: number;
    onChange?: (payments: unknown[]) => void;
  }) => (
    <div data-testid="multi-payment-input">
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

jest.mock("../../../../../hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [
      { code: "CASH", label: "Cash" },
      { code: "CARD", label: "Card" },
    ],
    drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
  }),
}));

const mockLinkTransaction = jest.fn();
const mockAddToCart = jest.fn();
jest.mock("../../../../sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: mockLinkTransaction,
    addToCart: mockAddToCart,
  }),
}));

jest.mock("../../../../sessions/hooks/useSessionAutoFill", () => ({
  useSessionAutoFill: () => ({ customerName: "", customerPhone: "" }),
}));

jest.mock("../components/HistoryModal", () => ({
  HistoryModal: () => <div data-testid="history-modal" />,
}));

jest.mock("../../../components/StatsCards", () => ({
  StatsCards: () => <div data-testid="stats-cards" />,
}));

jest.mock("@/utils/exchangeRates", () => ({
  getExchangeRates: () => ({ buyRate: 89500, sellRate: 89500 }),
}));

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

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
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

const SOLE_PARTNER = {
  id: 55,
  name: "Syria Corridor Partner",
  phone: null,
  notes: null,
  is_active: 1,
  system_association: null,
  created_at: "",
  updated_at: "",
};

function fillCostAndPrice(costUsdStr: string, priceUsdStr: string) {
  const usdInputs = screen.getAllByPlaceholderText("0.00");
  fireEvent.change(usdInputs[0], { target: { value: costUsdStr } }); // cost/"Paid Out" USD
  fireEvent.change(usdInputs[1], { target: { value: priceUsdStr } }); // price/"Arrived" USD
}

describe("CustomServices — Pay out (OWNER_NOTES_REMAINING_BUILD.md #16)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAddCustomService.mockResolvedValue({ success: true, id: 101 });
    mockGetClients.mockResolvedValue([]);
    mockPartnersGetAll.mockResolvedValue([]);
  });

  it("the Pay out checkbox does not exist until Via Partner is checked", () => {
    render(<CustomServices />);

    expect(
      screen.queryByTestId("custom-service-payout-toggle"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("custom-service-via-partner-toggle"));

    expect(
      screen.getByTestId("custom-service-payout-toggle"),
    ).toBeInTheDocument();
  });

  it("checking Pay out HIDES the Payment Method section and shows the payout notice", async () => {
    mockPartnersGetAll.mockResolvedValue([SOLE_PARTNER]);
    render(<CustomServices />);

    fireEvent.click(screen.getByTestId("custom-service-via-partner-toggle"));
    await screen.findByText(`Partner: ${SOLE_PARTNER.name}`);
    expect(screen.getByTestId("multi-payment-input")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("custom-service-payout-toggle"));

    expect(
      screen.queryByTestId("multi-payment-input"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("custom-service-payout-notice"),
    ).toBeInTheDocument();
    // The ordinary VIA notice must not also render underneath.
    expect(
      screen.queryByTestId("custom-service-via-partner-notice"),
    ).not.toBeInTheDocument();
  });

  it("unchecking Via Partner also clears Pay out (it cannot outlive its parent mode)", async () => {
    mockPartnersGetAll.mockResolvedValue([SOLE_PARTNER]);
    render(<CustomServices />);

    fireEvent.click(screen.getByTestId("custom-service-via-partner-toggle"));
    await screen.findByText(`Partner: ${SOLE_PARTNER.name}`);
    fireEvent.click(screen.getByTestId("custom-service-payout-toggle"));
    expect(
      screen.getByTestId("custom-service-payout-notice"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("custom-service-via-partner-toggle"));

    expect(
      screen.queryByTestId("custom-service-payout-toggle"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("custom-service-payout-notice"),
    ).not.toBeInTheDocument();
  });

  it("submit guard: disabled until BOTH the arrived amount and the paid-out amount are entered", async () => {
    mockPartnersGetAll.mockResolvedValue([SOLE_PARTNER]);
    render(<CustomServices />);

    fireEvent.click(screen.getByTestId("custom-service-via-partner-toggle"));
    await screen.findByText(`Partner: ${SOLE_PARTNER.name}`);
    fireEvent.click(screen.getByTestId("custom-service-payout-toggle"));

    const submitButton = () =>
      screen.getByText("Submit Payout").closest("button");
    expect(submitButton()).toBeDisabled();

    // Only "paid out" (cost) filled — still disabled.
    fillCostAndPrice("97", "0");
    expect(submitButton()).toBeDisabled();

    // Both filled — now enabled.
    fillCostAndPrice("97", "100");
    expect(submitButton()).not.toBeDisabled();
  });

  it("owner example: submits direction OUT with price=100/cost=97, no payment legs, and resets the toggle on success", async () => {
    mockPartnersGetAll.mockResolvedValue([SOLE_PARTNER]);
    render(<CustomServices />);

    fireEvent.click(screen.getByTestId("custom-service-via-partner-toggle"));
    await screen.findByText(`Partner: ${SOLE_PARTNER.name}`);
    fireEvent.click(screen.getByTestId("custom-service-payout-toggle"));
    fillCostAndPrice("97", "100");

    const submitButton = screen.getByText("Submit Payout").closest("button");
    expect(submitButton).not.toBeDisabled();
    fireEvent.click(submitButton as HTMLElement);

    await waitFor(() => {
      expect(mockAddCustomService).toHaveBeenCalled();
    });
    // Fix-round I7 (rule 24): assert field NAMES/values by parsing the
    // actual payload through the core schema rather than hand-typing an
    // `objectContaining` literal — a hand-typed assertion encodes whatever
    // was true (or broken) the day it was written and can't catch a field
    // silently renamed/dropped on either side of the contract. Parsing also
    // proves this exact payload independently passes
    // `createCustomServiceSchema`'s payout refines (both price AND cost
    // present, direction "OUT" requires partnerMode "VIA").
    const call = mockAddCustomService.mock.calls[0][0];
    const parsed = createCustomServiceSchema.parse(call);
    expect(parsed.cost_usd).toBe(97);
    expect(parsed.price_usd).toBe(100);
    expect(parsed.partnerId).toBe(55);
    expect(parsed.partnerMode).toBe("VIA");
    expect(parsed.direction).toBe("OUT");
    // No customer payment leg was ever collected — a payout pays OUT.
    expect(parsed.payments).toBeUndefined();
    expect(parsed.voucher_code).toBeUndefined();
    expect(parsed.kept_change_usd).toBeUndefined();

    await waitFor(() => expect(mockReload).toHaveBeenCalled());
    // The toggle resets after a successful submit — the payout checkbox
    // no longer renders because Via Partner itself was reset too.
    expect(
      screen.queryByTestId("custom-service-payout-toggle"),
    ).not.toBeInTheDocument();
  });

  it("relabels the amount fields and the profit indicator for a payout", async () => {
    mockPartnersGetAll.mockResolvedValue([SOLE_PARTNER]);
    const { container } = render(<CustomServices />);

    fireEvent.click(screen.getByTestId("custom-service-via-partner-toggle"));
    await screen.findByText(`Partner: ${SOLE_PARTNER.name}`);
    fireEvent.click(screen.getByTestId("custom-service-payout-toggle"));
    fillCostAndPrice("97", "100");

    expect(screen.getByText("Paid Out USD")).toBeInTheDocument();
    expect(screen.getByText("Arrived USD")).toBeInTheDocument();
    // Matched against the whole render's text content (rather than
    // `getByText`) since "Commission:" and the formatted amount are
    // separate JSX expressions inside the same element — a plain string
    // matcher on a single node is not guaranteed to line up with how RTL
    // splits/normalizes text nodes.
    expect(container.textContent).toContain("Commission:");
    expect(container.textContent).toContain("$3.00");
  });
});
