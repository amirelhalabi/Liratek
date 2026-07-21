/** @jest-environment jsdom */
/**
 * AdjustStockModal (LIRA-077) — form validation + delta/set math, and the
 * mutation payload it sends via useApi().adjustStock. History rendering
 * (loading/error/empty) is also covered since the modal owns both the form
 * and the per-product audit trail in one surface.
 *
 * Reason-required and delta-math are pure client-side guards — no core
 * service is involved, so these are plain RTL interaction tests against the
 * mocked useApi() adapter (api.adjustStock / api.getStockAdjustments).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdjustStockModal from "../AdjustStockModal";

const mockAdjustStock = jest.fn();
const mockGetStockAdjustments = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    adjustStock: mockAdjustStock,
    getStockAdjustments: mockGetStockAdjustments,
  }),
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

function renderModal(
  overrides: Partial<{
    onClose: () => void;
    onSuccess: () => void;
  }> = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = overrides.onClose ?? jest.fn();
  const onSuccess = overrides.onSuccess ?? jest.fn();

  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AdjustStockModal
        product={{
          id: 42,
          name: "Test Widget",
          barcode: "1234567890",
          stock_quantity: 10,
        }}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    </QueryClientProvider>,
  );

  return { ...utils, onClose, onSuccess };
}

describe("AdjustStockModal — validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStockAdjustments.mockResolvedValue([]);
  });

  it("rejects submitting with no reason", async () => {
    const { onSuccess } = renderModal();

    fireEvent.change(screen.getByPlaceholderText("0"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply Adjustment" }));

    expect(await screen.findByText("Reason is required")).toBeInTheDocument();
    expect(mockAdjustStock).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("rejects a non-integer quantity", async () => {
    renderModal();

    fireEvent.change(screen.getByPlaceholderText("0"), {
      target: { value: "abc" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "e.g. Physical recount, damaged goods, supplier correction…",
      ),
      { target: { value: "Recount" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply Adjustment" }));

    expect(await screen.findByText("Enter a whole number")).toBeInTheDocument();
    expect(mockAdjustStock).not.toHaveBeenCalled();
  });

  it("rejects a negative absolute quantity in set mode", async () => {
    renderModal();

    fireEvent.change(screen.getByPlaceholderText("0"), {
      target: { value: "-3" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "e.g. Physical recount, damaged goods, supplier correction…",
      ),
      { target: { value: "Recount" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply Adjustment" }));

    expect(
      await screen.findByText("Stock quantity cannot be negative"),
    ).toBeInTheDocument();
    expect(mockAdjustStock).not.toHaveBeenCalled();
  });

  it("rejects a zero delta in delta mode", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Add / remove (+/-)" }));
    fireEvent.change(screen.getByPlaceholderText("+10 or -5"), {
      target: { value: "0" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "e.g. Physical recount, damaged goods, supplier correction…",
      ),
      { target: { value: "Recount" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply Adjustment" }));

    expect(
      await screen.findByText("Delta must be non-zero"),
    ).toBeInTheDocument();
    expect(mockAdjustStock).not.toHaveBeenCalled();
  });
});

describe("AdjustStockModal — delta/set math + submission payload", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStockAdjustments.mockResolvedValue([]);
  });

  it("previews the new stock in set mode (absolute)", () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText("0"), {
      target: { value: "25" },
    });
    expect(screen.getByText(/New stock: 10 → 25 units/)).toBeInTheDocument();
  });

  it("previews the new stock in delta mode (current + delta)", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Add / remove (+/-)" }));
    fireEvent.change(screen.getByPlaceholderText("+10 or -5"), {
      target: { value: "-4" },
    });
    // current stock (10) + delta (-4) = 6
    expect(screen.getByText(/= 6 units/)).toBeInTheDocument();
  });

  it("submits {id, newQuantity, reason} in set mode", async () => {
    mockAdjustStock.mockResolvedValue({ success: true });
    const { onSuccess } = renderModal();

    fireEvent.change(screen.getByPlaceholderText("0"), {
      target: { value: "30" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "e.g. Physical recount, damaged goods, supplier correction…",
      ),
      { target: { value: "Physical recount" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply Adjustment" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(mockAdjustStock).toHaveBeenCalledWith({
      id: 42,
      newQuantity: 30,
      reason: "Physical recount",
    });
  });

  it("submits {id, delta, reason} in delta mode", async () => {
    mockAdjustStock.mockResolvedValue({ success: true });
    const { onSuccess } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Add / remove (+/-)" }));
    fireEvent.change(screen.getByPlaceholderText("+10 or -5"), {
      target: { value: "-2" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "e.g. Physical recount, damaged goods, supplier correction…",
      ),
      { target: { value: "Damaged units" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply Adjustment" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(mockAdjustStock).toHaveBeenCalledWith({
      id: 42,
      delta: -2,
      reason: "Damaged units",
    });
  });

  it("shows the service error and does not call onSuccess when the API reports failure", async () => {
    mockAdjustStock.mockResolvedValue({
      success: false,
      error: "Product not found",
    });
    const { onSuccess } = renderModal();

    fireEvent.change(screen.getByPlaceholderText("0"), {
      target: { value: "5" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "e.g. Physical recount, damaged goods, supplier correction…",
      ),
      { target: { value: "Recount" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply Adjustment" }));

    expect(await screen.findByText("Product not found")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

describe("AdjustStockModal — adjustment history states", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the empty state when there is no history", async () => {
    mockGetStockAdjustments.mockResolvedValue([]);
    renderModal();
    expect(
      await screen.findByText("No adjustments recorded yet."),
    ).toBeInTheDocument();
  });

  it("shows the error state when the history fetch fails", async () => {
    mockGetStockAdjustments.mockRejectedValue(new Error("network down"));
    renderModal();
    expect(
      await screen.findByText("Failed to load adjustment history."),
    ).toBeInTheDocument();
  });

  it("renders adjustment rows with delta, old→new, reason, and username", async () => {
    mockGetStockAdjustments.mockResolvedValue([
      {
        id: 1,
        product_id: 42,
        delta: -3,
        old_quantity: 10,
        new_quantity: 7,
        reason: "Damaged in transit",
        user_id: 2,
        username: "amir",
        created_at: "2026-07-19T10:00:00.000Z",
        updated_at: "2026-07-19T10:00:00.000Z",
      },
    ]);
    renderModal();

    expect(await screen.findByText(/Damaged in transit/)).toBeInTheDocument();
    expect(screen.getByText(/-3 \(10 → 7\)/)).toBeInTheDocument();
    expect(screen.getByText(/by amir/)).toBeInTheDocument();
  });
});
