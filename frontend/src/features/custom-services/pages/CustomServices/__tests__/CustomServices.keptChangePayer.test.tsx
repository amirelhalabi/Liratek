/** @jest-environment jsdom */

/**
 * Custom Services — kept change wiring on the page (POSTING_MAP G42).
 *
 *   1. The payment widget is told who pays: `payer="customer"` (the customer
 *      pays the shop; kept change = shop profit). Declared explicitly rather
 *      than relying on the widget's default.
 *   2. A session-basket item never carries kept change: the basket checkout
 *      owns the customer's cash and its own kept change, and the server books
 *      no item-level kept for a deferred item — so the page must not send it
 *      into the cart, and its Profit preview must not show it.
 *   3. Outside a session the kept amount still reaches the payload.
 *
 * Kept field names are typed against the core schema's own type (rule 24).
 * Scaffold copied from CustomServices.profitDisplay.test.tsx (stable useApi
 * mock, rule 25), with a MultiPaymentInput stand-in that records its props.
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import type { CreateCustomServiceInput } from "@liratek/core";
import CustomServices from "../index";

const KEPT_USD: keyof CreateCustomServiceInput = "kept_change_usd";
const KEPT_LBP: keyof CreateCustomServiceInput = "kept_change_lbp";

const mockAddToCart = jest.fn();
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
    list: () => Promise.resolve({ success: true, data: [] }),
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
    // Stand-in for the real widget: records its props and offers the "Keep
    // change" action ($1 kept), exactly the shape onKeptChange emits.
    MultiPaymentInput: (props: {
      payer?: string;
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

function fillCostAndPrice(costUsdStr: string, priceUsdStr: string) {
  const usdInputs = screen.getAllByPlaceholderText("0.00");
  fireEvent.change(usdInputs[0], { target: { value: costUsdStr } });
  fireEvent.change(usdInputs[1], { target: { value: priceUsdStr } });
}

describe("CustomServices — kept change wiring (G42)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPaymentProps.length = 0;
    mockActiveSession = null;
    mockGetClients.mockResolvedValue([]);
    mockPartnersGetAll.mockResolvedValue([]);
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

  it('tells the payment widget the customer pays (payer="customer")', () => {
    render(<CustomServices />);
    expect(mockPaymentProps.length).toBeGreaterThan(0);
    expect(mockPaymentProps[mockPaymentProps.length - 1].payer).toBe(
      "customer",
    );
  });

  it("outside a session, the kept amount reaches the payload", async () => {
    render(<CustomServices />);
    fillCostAndPrice("3", "5");
    fireEvent.click(screen.getByTestId("keep-one-dollar"));
    fireEvent.click(screen.getByText("Submit Service"));
    await waitFor(() => expect(mockAddCustomService).toHaveBeenCalled());
    const payload = mockAddCustomService.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload[KEPT_USD]).toBe(1);
  });

  it("in a session, the cart item carries no kept change and the preview leaves it out", async () => {
    mockActiveSession = { id: 42 };
    const { container } = render(<CustomServices />);
    fillCostAndPrice("3", "5");
    // The item sheet offers no "keep change" (an unwired onKeptChange hides it).
    expect(
      mockPaymentProps[mockPaymentProps.length - 1].onKeptChange,
    ).toBeUndefined();
    fireEvent.click(screen.getByTestId("keep-one-dollar"));
    // The basket owns kept change — the item preview stays price − cost.
    expect(container.textContent).toContain("Profit: $2.00");
    fireEvent.click(screen.getByText("Submit Service"));
    await waitFor(() => expect(mockAddToCart).toHaveBeenCalled());
    const item = mockAddToCart.mock.calls[0][0] as {
      formData: Record<string, unknown>;
    };
    expect(item.formData).not.toHaveProperty(KEPT_USD);
    expect(item.formData).not.toHaveProperty(KEPT_LBP);
    expect(mockAddCustomService).not.toHaveBeenCalled();
  });
});
