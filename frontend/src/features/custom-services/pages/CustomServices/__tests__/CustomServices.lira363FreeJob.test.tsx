/** @jest-environment jsdom */

/**
 * LIRA-363 (owner decisions 2026-10-30) — "Free — no charge" on the
 * Services page. Rayan's sister: a Sejel Adli done by partner Rawad, free
 * for her, cost 700,000 LBP owed to Rawad.
 *
 * Pinned here:
 *   1. without the tick an empty price still waits (2026-10-07 rule);
 *   2. ticked, via partner, cost only → no payment sheet, Submit enabled,
 *      the payload carries `is_free` with price 0 and no payment legs;
 *   3. ticked with a session open → saved at once, never added to the basket;
 *   4. the tick is not offered on For Partner.
 *
 * Payload field names are typed against the core schema (rule 24). Scaffold
 * copied from CustomServices.noSellingPrice.test.tsx (stable useApi mock,
 * rule 25). Rule 17: written after the page change — not proven
 * failing-first (the core guard, CustomServiceRepository.lira363FreeJob,
 * was).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { CreateCustomServiceInput } from "@liratek/core";
import CustomServices from "../index";

const mockAddToCart = jest.fn();
// A preset saved with a cost but NO selling price (owner decision 2026-10-07).
const mockPresets = [
  {
    id: 7,
    name: "Cost-only preset",
    category: "",
    cost_usd: 3,
    cost_lbp: 0,
    price_usd: 0,
    price_lbp: 0,
  },
];
let mockActiveSession: { id: number } | null = null;
const mockPaymentProps: Array<Record<string, unknown>> = [];

const mockAddCustomService = jest.fn();
const mockDeleteCustomService = jest.fn();
const mockGetClients = jest.fn();
const mockPartnersGetAll = jest.fn().mockResolvedValue([]);
const mockGetCustomServices = jest.fn();
const mockGetCustomServicesSummary = jest.fn();

// Rule 25: one module-level object so useApi() returns a STABLE reference.
const mockApi = {
  addCustomService: (...a: unknown[]) => mockAddCustomService(...a),
  deleteCustomService: (...a: unknown[]) => mockDeleteCustomService(...a),
  getClients: (...a: unknown[]) => mockGetClients(...a),
  getRates: () => Promise.resolve([]),
  getAllSettings: () => Promise.resolve([]),
  partners: { getAll: (...a: unknown[]) => mockPartnersGetAll(...a) },
  getCustomServices: (...a: unknown[]) => mockGetCustomServices(...a),
  getCustomServicesSummary: (...a: unknown[]) =>
    mockGetCustomServicesSummary(...a),
  servicePresets: {
    list: () => Promise.resolve({ success: true, data: mockPresets }),
  },
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    appEvents: { emit: jest.fn(), on: jest.fn(() => () => {}) },
    useApi: () => mockApi,
    // Real DataTable — HistoryModal's renderRow must actually execute for
    // this test to mean anything (a fake that skips renderRow, like the
    // sibling CustomServices.test.tsx uses for its unrelated form tests,
    // would make every assertion below vacuously pass).
    DataTable: actual.DataTable,
    DecimalInput: ({
      id,
      value,
      onChange,
      placeholder,
      className,
      disabled,
    }: {
      id?: string;
      disabled?: boolean;
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
        disabled={disabled}
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
    // Stand-in for the real widget: records its props and offers the "Keep
    // change" action ($1 kept), exactly the shape onKeptChange emits.
    MultiPaymentInput: (props: {
      payer?: string;
      totals?: Array<{ amount: number; currency: string }>;
      onKeptChange?: (k: { usd: number; lbp: number } | null) => void;
    }) => {
      mockPaymentProps.push(props as Record<string, unknown>);
      return (
        <div data-testid="multi-payment-input">
          <button
            type="button"
            data-testid="keep-one-dollar"
            onClick={() => props.onKeptChange?.({ usd: 1, lbp: 0 })}
          >
            keep $1
          </button>
        </div>
      );
    },
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
    activeSession: mockActiveSession,
    linkTransaction: jest.fn(),
    addToCart: (...a: unknown[]) => mockAddToCart(...a),
  }),
}));

jest.mock("../../../../sessions/hooks/useSessionAutoFill", () => ({
  useSessionAutoFill: () => ({
    customerName: "",
    customerPhone: "",
  }),
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

const PRICE_USD: keyof CreateCustomServiceInput = "price_usd";
const COST_USD: keyof CreateCustomServiceInput = "cost_usd";

function usdInputs() {
  const inputs = screen.getAllByPlaceholderText("0.00");
  return { cost: inputs[0], price: inputs[1] };
}

function submitButton(): HTMLButtonElement {
  return screen
    .getByText("Submit Service")
    .closest("button") as HTMLButtonElement;
}


const IS_FREE: keyof CreateCustomServiceInput = "is_free";
const PAYMENTS: keyof CreateCustomServiceInput = "payments";
const PARTNER_MODE: keyof CreateCustomServiceInput = "partnerMode";

describe("CustomServices — Free, no charge (LIRA-363)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPaymentProps.length = 0;
    mockActiveSession = null;
    mockGetClients.mockResolvedValue([]);
    // One partner → PartnerSelector auto-selects it.
    mockPartnersGetAll.mockResolvedValue([
      {
        id: 27,
        name: "RAWAD HMAIDI",
        phone: null,
        notes: null,
        is_active: 1,
        system_association: null,
        created_at: "",
        updated_at: "",
      },
    ]);
    mockGetCustomServicesSummary.mockResolvedValue({
      count: 0,
      totalCostUsd: 0,
      totalCostLbp: 0,
      totalPriceUsd: 0,
      totalPriceLbp: 0,
      totalProfitUsd: 0,
      totalProfitLbp: 0,
    });
    mockGetCustomServices.mockResolvedValue([]);
    mockAddCustomService.mockResolvedValue({ success: true, id: 1 });
  });

  async function viaPartnerCostOnly() {
    render(<CustomServices />);
    fireEvent.change(screen.getByTestId("search-bar"), {
      target: { value: "SEJEL ADLI" },
    });
    fireEvent.click(screen.getByTestId("custom-service-via-partner-toggle"));
    await screen.findByText(/RAWAD HMAIDI/);
    fireEvent.change(usdInputs().cost, { target: { value: "8" } });
  }

  it("without the tick, via partner with cost only still waits for a price", async () => {
    await viaPartnerCostOnly();
    expect(submitButton().disabled).toBe(true);
  });

  it("ticked: no payment sheet, Submit enabled, sent as free with price 0 and no payment", async () => {
    await viaPartnerCostOnly();
    fireEvent.click(screen.getByTestId("custom-service-free-toggle"));

    expect(screen.queryByTestId("multi-payment-input")).toBeNull();
    expect(screen.getByTestId("custom-service-free-notice")).toBeInTheDocument();
    expect((usdInputs().price as HTMLInputElement).disabled).toBe(true);
    expect(submitButton().disabled).toBe(false);

    fireEvent.click(submitButton());
    await waitFor(() => expect(mockAddCustomService).toHaveBeenCalled());
    const payload = mockAddCustomService.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload[IS_FREE]).toBe(true);
    expect(payload[PRICE_USD]).toBe(0);
    expect(payload[COST_USD]).toBe(8);
    expect(payload[PARTNER_MODE]).toBe("VIA");
    expect(payload).not.toHaveProperty(PAYMENTS);
  });

  it("ticked with a session open: saved at once, not added to the basket", async () => {
    mockActiveSession = { id: 42 };
    await viaPartnerCostOnly();
    fireEvent.click(screen.getByTestId("custom-service-free-toggle"));
    fireEvent.click(submitButton());
    await waitFor(() => expect(mockAddCustomService).toHaveBeenCalled());
    expect(mockAddToCart).not.toHaveBeenCalled();
  });

  it("the tick is not offered on For Partner", async () => {
    render(<CustomServices />);
    fireEvent.click(screen.getByTestId("custom-service-for-partner-toggle"));
    expect(screen.queryByTestId("custom-service-free-toggle")).toBeNull();
  });
});
