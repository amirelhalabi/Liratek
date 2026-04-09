/** @jest-environment jsdom */

/**
 * Tests for CustomServices Page
 *
 * Uses the new dedicated custom_services API (addCustomService, deleteCustomService).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CustomServices from "../index";

// ── Mock useApi ──
const mockAddCustomService = jest.fn();
const mockDeleteCustomService = jest.fn();
const mockGetClients = jest.fn();

jest.mock("@liratek/ui", () => ({
  useApi: () => ({
    addCustomService: mockAddCustomService,
    deleteCustomService: mockDeleteCustomService,
    getClients: mockGetClients,
  }),
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
  DataTable: ({
    columns,
    data,
    emptyMessage,
  }: {
    columns: unknown[];
    data: unknown[];
    emptyMessage?: string;
  }) => (
    <div data-testid="data-table">
      {data && (data as unknown[]).length === 0 ? (
        <div>{emptyMessage}</div>
      ) : (
        <table>
          <thead>
            <tr>
              {(columns as unknown[]).map((_, i) => (
                <th key={i}>Column {i}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data as unknown[]).map((_, i) => (
              <tr key={i}>
                <td>Row {i}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  ),
  MultiPaymentInput: ({
    totalAmount,
    onChange,
  }: {
    totalAmount?: number;
    onChange?: (payments: unknown[]) => void;
  }) => (
    <div data-testid="multi-payment-input">
      <input
        type="number"
        value={totalAmount}
        onChange={(e) =>
          onChange?.([{ method: "CASH", amount: parseFloat(e.target.value) }])
        }
      />
    </div>
  ),
}));

// ── Mock usePaymentMethods ──
jest.mock("../../../../../hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [
      { code: "CASH", label: "Cash" },
      { code: "CARD", label: "Card" },
      { code: "DEBT", label: "Debt" },
    ],
    drawerAffectingMethods: [
      { code: "CASH", label: "Cash" },
      { code: "CARD", label: "Card" },
    ],
  }),
}));

// ── Mock useSession ──
const mockLinkTransaction = jest.fn();
jest.mock("../../../../sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: mockLinkTransaction,
  }),
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
jest.mock("../../../../../utils/logger", () => ({
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

describe("CustomServices Page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAddCustomService.mockResolvedValue({ success: true, id: 42 });
    mockGetClients.mockResolvedValue([]);
  });

  it("should render the page header and stats cards", () => {
    render(<CustomServices />);

    expect(screen.getByText("Services")).toBeInTheDocument();
    expect(screen.getByText("Today's Services")).toBeInTheDocument();
    expect(screen.getByText("Today's Revenue")).toBeInTheDocument();
    expect(screen.getByText("Today's Profit")).toBeInTheDocument();
    expect(screen.getByText("New Service")).toBeInTheDocument();
    // History button should be present
    expect(screen.getByText("History")).toBeInTheDocument();
  });

  it("should render the form with required fields", () => {
    render(<CustomServices />);

    // Description
    expect(
      screen.getByPlaceholderText(/Phone screen repair/),
    ).toBeInTheDocument();
    // Dual-currency: 2 USD inputs (0.00 placeholder) + 2 LBP inputs (0 placeholder)
    expect(screen.getAllByPlaceholderText("0.00")).toHaveLength(2);
    expect(screen.getAllByPlaceholderText("0")).toHaveLength(2);
    expect(screen.getByText("Submit Service")).toBeInTheDocument();
  });

  it("should show History button", () => {
    render(<CustomServices />);

    // History button should be visible in header
    expect(screen.getByText("History")).toBeInTheDocument();
  });

  it("should validate empty description on submit", async () => {
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});

    render(<CustomServices />);

    fireEvent.click(screen.getByText("Submit Service"));

    expect(alertSpy).toHaveBeenCalledWith(
      "Please enter a service description.",
    );
    expect(mockAddCustomService).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });

  it("should validate cost/price on submit", async () => {
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});

    render(<CustomServices />);

    // Fill only description
    fireEvent.change(screen.getByPlaceholderText(/Phone screen repair/), {
      target: { value: "Test service" },
    });
    fireEvent.click(screen.getByText("Submit Service"));

    expect(alertSpy).toHaveBeenCalledWith("Please enter a cost or price.");
    expect(mockAddCustomService).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });

  it("should submit a valid service and reload", async () => {
    render(<CustomServices />);

    // Fill form
    fireEvent.change(screen.getByPlaceholderText(/Phone screen repair/), {
      target: { value: "SIM activation" },
    });

    const usdInputs = screen.getAllByPlaceholderText("0.00");
    fireEvent.change(usdInputs[0], { target: { value: "3" } }); // cost USD
    fireEvent.change(usdInputs[1], { target: { value: "5" } }); // price USD

    fireEvent.click(screen.getByText("Submit Service"));

    await waitFor(() => {
      expect(mockAddCustomService).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "SIM activation",
          cost_usd: 3,
          cost_lbp: 0,
          price_usd: 5,
          price_lbp: 0,
          paid_by: "CASH",
        }),
      );
    });

    await waitFor(() => {
      expect(mockReload).toHaveBeenCalled();
    });
  });

  it("should show profit indicator when cost and price are entered", () => {
    render(<CustomServices />);

    const usdInputs = screen.getAllByPlaceholderText("0.00");
    fireEvent.change(usdInputs[0], { target: { value: "5" } }); // cost USD
    fireEvent.change(usdInputs[1], { target: { value: "12" } }); // price USD

    expect(screen.getByText("Profit: $7.00")).toBeInTheDocument();
  });

  it("should show customer details section for all payment methods", () => {
    render(<CustomServices />);

    // Customer details are always visible (not only for DEBT)
    expect(screen.getByText("Customer Details")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Search or type name..."),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g., 03 123 456")).toBeInTheDocument();
  });

  it("should show required label for DEBT payment", () => {
    render(<CustomServices />);

    const select = screen.getByTestId("paid-by-select");
    fireEvent.change(select, { target: { value: "DEBT" } });

    expect(screen.getByText("(required for DEBT)")).toBeInTheDocument();
  });

  it("should validate client for DEBT payment", async () => {
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});

    render(<CustomServices />);

    fireEvent.change(screen.getByPlaceholderText(/Phone screen repair/), {
      target: { value: "Test" },
    });
    const usdInputs = screen.getAllByPlaceholderText("0.00");
    fireEvent.change(usdInputs[0], { target: { value: "5" } });
    fireEvent.change(usdInputs[1], { target: { value: "10" } });

    const select = screen.getByTestId("paid-by-select");
    fireEvent.change(select, { target: { value: "DEBT" } });

    fireEvent.click(screen.getByText("Submit Service"));

    expect(alertSpy).toHaveBeenCalledWith(
      "Please select a client for debt payment.",
    );

    alertSpy.mockRestore();
  });

  it("should include note in submission when provided", async () => {
    render(<CustomServices />);

    fireEvent.change(screen.getByPlaceholderText(/Phone screen repair/), {
      target: { value: "Screen fix" },
    });
    const usdInputs = screen.getAllByPlaceholderText("0.00");
    fireEvent.change(usdInputs[0], { target: { value: "10" } });
    fireEvent.change(usdInputs[1], { target: { value: "20" } });
    fireEvent.change(screen.getByPlaceholderText("Additional details..."), {
      target: { value: "iPhone 14" },
    });

    fireEvent.click(screen.getByText("Submit Service"));

    await waitFor(() => {
      expect(mockAddCustomService).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Screen fix",
          note: "iPhone 14",
        }),
      );
    });
  });

  it("should handle API error on submit", async () => {
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
    mockAddCustomService.mockResolvedValue({
      success: false,
      error: "DB error",
    });

    render(<CustomServices />);

    fireEvent.change(screen.getByPlaceholderText(/Phone screen repair/), {
      target: { value: "Test" },
    });
    const usdInputs = screen.getAllByPlaceholderText("0.00");
    fireEvent.change(usdInputs[0], { target: { value: "5" } });
    fireEvent.change(usdInputs[1], { target: { value: "10" } });

    fireEvent.click(screen.getByText("Submit Service"));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith("Error: DB error");
    });

    alertSpy.mockRestore();
  });
});
