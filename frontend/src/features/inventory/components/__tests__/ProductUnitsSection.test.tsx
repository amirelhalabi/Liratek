/** @jest-environment jsdom */
/**
 * LIRA-143 Phase 6b — ProductUnitsSection: unit list rendering (IN_STOCK/
 * SOLD, defective badge), the drift-warning banner (owner decision #6,
 * warn-never-block — `computeUnitDrift` itself is covered in
 * productUnitsLogic.test.ts; this covers the component actually RENDERING
 * that predicate's result), batch IMEI intake, and IN_STOCK-only delete.
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProductUnitsSection } from "../ProductUnitsSection";

const mockGetForProduct = jest.fn();
const mockRegister = jest.fn();
const mockDelete = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    productUnits: {
      getForProduct: mockGetForProduct,
      register: mockRegister,
      delete: mockDelete,
    },
  }),
}));

function renderSection(stockQuantity = 2) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProductUnitsSection productId={42} stockQuantity={stockQuantity} />
    </QueryClientProvider>,
  );
}

describe("ProductUnitsSection — unit list", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the empty state when there are no units yet", async () => {
    mockGetForProduct.mockResolvedValue([]);
    renderSection(0);
    expect(
      await screen.findByText("No units registered yet."),
    ).toBeInTheDocument();
  });

  it("renders IN_STOCK and SOLD units with status badges", async () => {
    mockGetForProduct.mockResolvedValue([
      { id: 1, imei: "111111111111111", status: "IN_STOCK", is_defective: 0 },
      { id: 2, imei: "222222222222222", status: "SOLD", is_defective: 0 },
    ]);
    renderSection(1);

    expect(await screen.findByText("111111111111111")).toBeInTheDocument();
    expect(screen.getByText("222222222222222")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("product-unit-1")).getByText("IN_STOCK"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("product-unit-2")).getByText("SOLD"),
    ).toBeInTheDocument();
  });

  it("shows a Defective badge only for units with is_defective truthy", async () => {
    mockGetForProduct.mockResolvedValue([
      { id: 1, imei: "111111111111111", status: "SOLD", is_defective: 1 },
      { id: 2, imei: "222222222222222", status: "IN_STOCK", is_defective: 0 },
    ]);
    renderSection(1);

    await screen.findByText("111111111111111");
    expect(
      within(screen.getByTestId("product-unit-1")).getByText("Defective"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("product-unit-2")).queryByText("Defective"),
    ).not.toBeInTheDocument();
  });

  it("offers delete for IN_STOCK units but not for SOLD ones", async () => {
    mockGetForProduct.mockResolvedValue([
      { id: 1, imei: "111111111111111", status: "IN_STOCK", is_defective: 0 },
      { id: 2, imei: "222222222222222", status: "SOLD", is_defective: 0 },
    ]);
    renderSection(1);

    await screen.findByText("111111111111111");
    expect(
      within(screen.getByTestId("product-unit-1")).getByRole("button"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("product-unit-2")).queryByRole("button"),
    ).not.toBeInTheDocument();
  });

  it("deletes an IN_STOCK unit on confirm", async () => {
    window.confirm = jest.fn().mockReturnValue(true);
    mockGetForProduct.mockResolvedValue([
      { id: 1, imei: "111111111111111", status: "IN_STOCK", is_defective: 0 },
    ]);
    mockDelete.mockResolvedValue({ success: true });
    renderSection(1);

    await screen.findByText("111111111111111");
    fireEvent.click(screen.getByRole("button", { name: /Remove unit/ }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(1));
  });
});

describe("ProductUnitsSection — drift warning (decision #6, warn-never-block)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows no drift banner when IN_STOCK count matches stock_quantity", async () => {
    mockGetForProduct.mockResolvedValue([
      { id: 1, imei: "111111111111111", status: "IN_STOCK", is_defective: 0 },
    ]);
    renderSection(1);
    await screen.findByText("111111111111111");
    expect(screen.queryByTestId("unit-drift-warning")).not.toBeInTheDocument();
  });

  it("shows an amber drift banner when IN_STOCK count is BELOW stock_quantity", async () => {
    mockGetForProduct.mockResolvedValue([
      { id: 1, imei: "111111111111111", status: "IN_STOCK", is_defective: 0 },
    ]);
    renderSection(5);
    // Wait for the query to resolve (the unit's imei renders) before reading
    // the drift banner's final content — it's already present on the
    // pre-data render (units defaults to []), just with a stale "0 units"
    // count, so `findByTestId` alone would race the query.
    await screen.findByText("111111111111111");
    expect(screen.getByTestId("unit-drift-warning")).toHaveTextContent(
      "1 unit registered in-stock, but the product's stock quantity is 5",
    );
  });

  it("shows an amber drift banner when IN_STOCK count is ABOVE stock_quantity", async () => {
    mockGetForProduct.mockResolvedValue([
      { id: 1, imei: "111111111111111", status: "IN_STOCK", is_defective: 0 },
      { id: 2, imei: "222222222222222", status: "IN_STOCK", is_defective: 0 },
    ]);
    renderSection(1);
    await screen.findByText("222222222222222");
    expect(screen.getByTestId("unit-drift-warning")).toHaveTextContent(
      "2 units registered in-stock, but the product's stock quantity is 1",
    );
  });

  it("never disables the Add button when a drift is present (warn only)", async () => {
    mockGetForProduct.mockResolvedValue([
      { id: 1, imei: "111111111111111", status: "IN_STOCK", is_defective: 0 },
    ]);
    renderSection(5);
    await screen.findByText("111111111111111");
    expect(screen.getByTestId("unit-drift-warning")).toHaveTextContent(
      "1 unit registered in-stock",
    );

    fireEvent.change(screen.getByTestId("imei-add-input"), {
      target: { value: "222222222222222" },
    });
    expect(screen.getByTestId("imei-add-button")).not.toBeDisabled();
  });
});

describe("ProductUnitsSection — single-IMEI add row (ImeiAddRow)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetForProduct.mockResolvedValue([]);
  });

  it("registers exactly one IMEI via the register mutation on Add click", async () => {
    mockRegister.mockResolvedValue({
      success: true,
      data: {
        units: [],
        drift: { inStockUnits: 1, stockQuantity: 1, matches: true },
      },
    });
    renderSection(0);
    await screen.findByText("No units registered yet.");

    fireEvent.change(screen.getByTestId("imei-add-input"), {
      target: { value: "111111111111111" },
    });
    fireEvent.click(screen.getByTestId("imei-add-button"));

    await waitFor(() =>
      expect(mockRegister).toHaveBeenCalledWith({
        product_id: 42,
        imeis: ["111111111111111"],
      }),
    );
  });

  it("registers on Enter in the input (scanner-friendly) and clears + refocuses on success", async () => {
    mockRegister.mockResolvedValue({
      success: true,
      data: {
        units: [],
        drift: { inStockUnits: 1, stockQuantity: 1, matches: true },
      },
    });
    renderSection(0);
    await screen.findByText("No units registered yet.");

    const input = screen.getByTestId("imei-add-input");
    fireEvent.change(input, { target: { value: "111111111111111" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mockRegister).toHaveBeenCalledWith({
        product_id: 42,
        imeis: ["111111111111111"],
      }),
    );
    await waitFor(() => expect(input).toHaveValue(""));
    expect(input).toHaveFocus();
  });

  it("registers a second scan immediately after the first (consecutive adds, no clicks)", async () => {
    mockRegister
      .mockResolvedValueOnce({
        success: true,
        data: {
          units: [],
          drift: { inStockUnits: 1, stockQuantity: 2, matches: false },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          units: [],
          drift: { inStockUnits: 2, stockQuantity: 2, matches: true },
        },
      });
    renderSection(0);
    await screen.findByText("No units registered yet.");

    const input = screen.getByTestId("imei-add-input");
    fireEvent.change(input, { target: { value: "111111111111111" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(input).toHaveValue(""));

    fireEvent.change(input, { target: { value: "222222222222222" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(2));
    expect(mockRegister).toHaveBeenNthCalledWith(2, {
      product_id: 42,
      imeis: ["222222222222222"],
    });
  });

  it("shows the named service error inline and KEEPS the input value on failure", async () => {
    mockRegister.mockResolvedValue({
      success: false,
      error: "IMEI already registered in stock on product X",
    });
    renderSection(0);
    await screen.findByText("No units registered yet.");

    const input = screen.getByTestId("imei-add-input");
    fireEvent.change(input, { target: { value: "111111111111111" } });
    fireEvent.click(screen.getByTestId("imei-add-button"));

    expect(
      await screen.findByText("IMEI already registered in stock on product X"),
    ).toBeInTheDocument();
    expect(input).toHaveValue("111111111111111");
  });

  it("no-ops on an empty/whitespace-only submit — Add stays disabled, no call made", async () => {
    renderSection(0);
    await screen.findByText("No units registered yet.");

    const input = screen.getByTestId("imei-add-input");
    expect(screen.getByTestId("imei-add-button")).toBeDisabled();

    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.getByTestId("imei-add-button")).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockRegister).not.toHaveBeenCalled();
  });
});
