/** @jest-environment jsdom */

/**
 * LIRA-387 F1 (owner 2026-11-11: "keep it consistent in all the payment
 * rows") — Custom Services refused Customer Account for a NEW client typed
 * as name + phone: the payment box showed no warning (hasClient was
 * "a name is typed"), then Submit stopped with "Please select a client for
 * debt payment." before "Save as client" could create the client. POS, Loto
 * and Mobile Recharge accept a new name + phone. Now the page registers the
 * client first, and the payment box's client props come from the shared
 * builder (`clientPaymentProps`).
 *
 * Payload names are read back through the real core schema (rule 24).
 * Rule 17: run against the unfixed page first and seen failing.
 * Harness copied from CustomServices.keptChangePayer.test.tsx (stable useApi
 * mock, rule 25).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createCustomServiceSchema } from "@liratek/core";
import CustomServices from "../index";

const mockCreateClient = jest.fn();
jest.mock("@/api/backendApi", () => ({
  ...jest.requireActual("@/api/backendApi"),
  createClient: (...a: unknown[]) => mockCreateClient(...a),
}));

jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: ({
    id,
    value,
    onChange,
  }: {
    id?: string;
    value: string;
    onChange: (v: string) => void;
  }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

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
    // Stand-in for the real widget: records its props, and lets the test
    // put the whole price on the customer's account (one IN line).
    MultiPaymentInput: (props: {
      onChange: (lines: unknown[]) => void;
    }) => {
      mockPaymentProps.push(props as Record<string, unknown>);
      return (
        <div data-testid="multi-payment-input">
          <button
            type="button"
            data-testid="pay-on-account"
            onClick={() =>
              props.onChange([
                {
                  id: "L1",
                  method: "CUSTOMER_ACCOUNT",
                  currencyCode: "USD",
                  amount: 5,
                },
              ])
            }
          >
            on account
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

function typeNewClient(name: string, phone: string) {
  fireEvent.change(document.getElementById("svc-client") as HTMLElement, {
    target: { value: name },
  });
  fireEvent.change(document.getElementById("svc-phone") as HTMLElement, {
    target: { value: phone },
  });
}

const lastPaymentProps = () => mockPaymentProps[mockPaymentProps.length - 1];

describe("CustomServices — a new client (name + phone) can be charged to account (LIRA-387 F1)", () => {
  let alertSpy: jest.SpyInstance;

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
    mockCreateClient.mockResolvedValue({ success: true, id: 91 });
    alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => alertSpy.mockRestore());

  it("the payment box is told the new client is chargeable (shortfall and change go to the account)", () => {
    render(<CustomServices />);
    fillCostAndPrice("3", "5");
    typeNewClient("Maya Khoury", "70555111");
    const props = lastPaymentProps();
    expect(props.hasClient).toBe(true);
    expect(props.autoDebtRemainder).toBe(true);
    expect(props.unreturnedChangeTo).toBe("CUSTOMER_ACCOUNT");
  });

  it("a name alone is not a chargeable client (no phone)", () => {
    render(<CustomServices />);
    fillCostAndPrice("3", "5");
    typeNewClient("Maya Khoury", "");
    const props = lastPaymentProps();
    expect(props.hasClient).toBe(false);
    expect(props.autoDebtRemainder).toBe(false);
    expect(props.unreturnedChangeTo).toBeUndefined();
  });

  it("Submit registers the client and sends its id with the account line", async () => {
    render(<CustomServices />);
    fillCostAndPrice("3", "5");
    typeNewClient("Maya Khoury", "70555111");
    fireEvent.click(screen.getByTestId("pay-on-account"));
    fireEvent.click(screen.getByText("Submit Service"));
    await waitFor(() =>
      expect(
        mockAddCustomService.mock.calls.length + alertSpy.mock.calls.length,
      ).toBeGreaterThan(0),
    );
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    const sent = createCustomServiceSchema.parse(
      mockAddCustomService.mock.calls[0][0],
    );
    expect(sent.client_id).toBe(91);
    expect(
      (sent.payments ?? []).some((l) => l.method === "CUSTOMER_ACCOUNT"),
    ).toBe(true);
  });

  it("in a session basket no client is created: the item joins the cart (the basket checkout owns the payment)", async () => {
    mockActiveSession = { id: 42 };
    render(<CustomServices />);
    fillCostAndPrice("3", "5");
    typeNewClient("Maya Khoury", "70555111");
    fireEvent.click(screen.getByTestId("pay-on-account"));
    fireEvent.click(screen.getByText("Submit Service"));
    await waitFor(() =>
      expect(
        mockAddToCart.mock.calls.length + alertSpy.mock.calls.length,
      ).toBeGreaterThan(0),
    );
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockAddCustomService).not.toHaveBeenCalled();
    // The basket item keeps the shared rule's view: change is the basket's.
    expect(lastPaymentProps().unreturnedChangeTo).toBeUndefined();
  });

  it("without an account line no client is registered (the 'Save as client' box decides)", async () => {
    render(<CustomServices />);
    fillCostAndPrice("3", "5");
    typeNewClient("Maya Khoury", "70555111");
    fireEvent.click(screen.getByText("Submit Service"));
    await waitFor(() => expect(mockAddCustomService).toHaveBeenCalled());
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});
