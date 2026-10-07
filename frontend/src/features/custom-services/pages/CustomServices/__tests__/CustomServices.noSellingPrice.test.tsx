/** @jest-environment jsdom */

/**
 * Custom Services — a service with a cost but no selling price
 * (owner decision 2026-10-07).
 *
 * Owner: "no selling price set only means that when the custom service is
 * selected on the services page, the selling price is not auto-filled, and
 * the cashier fills it in on the spot. The payment form should be waiting
 * for a selling price."
 *
 * Before: the payment sheet's total fell back to the COST (`priceUsd ||
 * costUsd`), so the cashier could collect — and the server accepted — the
 * cost as the price. Same fallback on the session-basket line.
 *
 * Pinned here:
 *   1. price empty → nothing to collect (no payment total), Submit disabled,
 *      no sale sent, no basket line added;
 *   2. after typing a price → the payment total is the price and the payload
 *      carries it.
 *
 * Payload field names are typed against the core schema (rule 24). Scaffold
 * copied from CustomServices.keptChangePayer.test.tsx (stable useApi mock,
 * rule 25).
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
const KEPT_USD: keyof CreateCustomServiceInput = "kept_change_usd";
const COST_USD: keyof CreateCustomServiceInput = "cost_usd";

function usdInputs() {
  const inputs = screen.getAllByPlaceholderText("0.00");
  return { cost: inputs[0], price: inputs[1] };
}

/** The total the payment sheet currently asks the customer for, or 0 when
 *  no payment sheet is offered at all. */
function collectedTotal(): number {
  if (!screen.queryByTestId("multi-payment-input")) return 0;
  const last = mockPaymentProps[mockPaymentProps.length - 1] as {
    totals?: Array<{ amount: number }>;
  };
  return last.totals?.[0]?.amount ?? 0;
}

function submitButton(): HTMLButtonElement {
  return screen
    .getByText("Submit Service")
    .closest("button") as HTMLButtonElement;
}

describe("CustomServices — no selling price: the payment form waits for one", () => {
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

  it("cost typed, price empty → nothing to collect, cannot submit", async () => {
    render(<CustomServices />);
    fireEvent.change(usdInputs().cost, { target: { value: "3" } });

    expect(collectedTotal()).toBe(0);
    expect(submitButton().disabled).toBe(true);
    fireEvent.click(submitButton());
    // Give any async submit a chance to run before asserting it did not.
    await Promise.resolve();
    expect(mockAddCustomService).not.toHaveBeenCalled();
  });

  it("cost-only preset → price stays empty and the sale waits; typing a price lets it through with that price", async () => {
    render(<CustomServices />);
    fireEvent.click(await screen.findByText("Cost-only preset"));

    // Not auto-filled: the price box is empty, the cost is the preset's.
    expect((usdInputs().price as HTMLInputElement).value).toBe("");
    expect((usdInputs().cost as HTMLInputElement).value).toBe("3");
    expect(collectedTotal()).toBe(0);
    expect(submitButton().disabled).toBe(true);

    fireEvent.change(usdInputs().price, { target: { value: "5" } });
    expect(collectedTotal()).toBe(5);
    expect(submitButton().disabled).toBe(false);

    fireEvent.click(submitButton());
    await waitFor(() => expect(mockAddCustomService).toHaveBeenCalled());
    const payload = mockAddCustomService.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload[PRICE_USD]).toBe(5);
    expect(payload[COST_USD]).toBe(3);
  });

  it("in a session, cost only → no basket line at the cost; after a price → the line is the price", async () => {
    mockActiveSession = { id: 42 };
    render(<CustomServices />);
    fireEvent.change(screen.getByTestId("search-bar"), {
      target: { value: "Basket service" },
    });
    fireEvent.change(usdInputs().cost, { target: { value: "3" } });

    expect(submitButton().disabled).toBe(true);
    fireEvent.click(submitButton());
    await Promise.resolve();
    expect(mockAddToCart).not.toHaveBeenCalled();

    fireEvent.change(usdInputs().price, { target: { value: "5" } });
    fireEvent.click(submitButton());
    await waitFor(() => expect(mockAddToCart).toHaveBeenCalled());
    const item = mockAddToCart.mock.calls[0][0] as {
      amount: number;
      formData: Record<string, unknown>;
    };
    expect(item.amount).toBe(5);
    expect(item.formData[PRICE_USD]).toBe(5);
  });
  it("clearing the price drops what the old payment sheet held (no stale kept change)", async () => {
    render(<CustomServices />);
    fireEvent.change(usdInputs().cost, { target: { value: "3" } });
    fireEvent.change(usdInputs().price, { target: { value: "5" } });
    // The cashier keeps $1 on the $5 sheet...
    fireEvent.click(screen.getByTestId("keep-one-dollar"));
    // ...then clears the price (the sheet goes back to waiting) and types a
    // different one. The $1 belonged to the old sheet, not this sale.
    fireEvent.change(usdInputs().price, { target: { value: "" } });
    expect(collectedTotal()).toBe(0);
    fireEvent.change(usdInputs().price, { target: { value: "8" } });

    fireEvent.click(submitButton());
    await waitFor(() => expect(mockAddCustomService).toHaveBeenCalled());
    const payload = mockAddCustomService.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload[PRICE_USD]).toBe(8);
    expect(payload).not.toHaveProperty(KEPT_USD);
  });
});
