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
const mockReceiveStock = jest.fn();
const mockGetStockAdjustments = jest.fn();
const mockGetOpenStockBatches = jest.fn();
const mockRegisterProductUnits = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    adjustStock: mockAdjustStock,
    receiveStock: mockReceiveStock,
    getStockAdjustments: mockGetStockAdjustments,
    getOpenStockBatches: mockGetOpenStockBatches,
    productUnits: {
      register: mockRegisterProductUnits,
    },
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
    tracksImeiUnits: boolean;
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
          ...(overrides.tracksImeiUnits ? { tracks_imei_units: 1 } : {}),
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
    mockGetOpenStockBatches.mockResolvedValue([]);
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
    mockGetOpenStockBatches.mockResolvedValue([]);
    mockReceiveStock.mockResolvedValue({ success: true });
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

  // Owner decision (SUPPLIER_STOCK_INTAKE_PLAN.md, D4): a set-mode INCREASE
  // is a real delivery too — it now books through `receiveStock` (FIFO cost
  // batch + supplier debit) instead of the plain audit-only `adjustStock`,
  // exactly like a delta-mode increase already did before this ticket.
  it("submits a receiveStock payload for a set-mode increase", async () => {
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
    expect(mockReceiveStock).toHaveBeenCalledWith({
      product_id: 42,
      quantity: 20,
      unit_cost_usd: 0,
      supplier: null,
      is_old_stock: false,
      reason: "Physical recount",
    });
    expect(mockAdjustStock).not.toHaveBeenCalled();
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
    mockGetOpenStockBatches.mockResolvedValue([]);
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

// Owner report 2026-09-07 — a product can hold stock bought at several
// different prices (2 iPhones received at $1,300 on top of 2 already held
// at $1,200, with no way to see the split). The section is gated at >= 2
// batches: a single batch says nothing the "Current stock" row above
// doesn't (see AdjustStockModal.tsx's comment on the section itself), so
// that gating is pinned here too, not just the render-with-data case.
describe("AdjustStockModal — cost batches section (owner report 2026-09-07)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStockAdjustments.mockResolvedValue([]);
  });

  it("shows each batch's remaining units and unit cost when two or more batches come back", async () => {
    mockGetOpenStockBatches.mockResolvedValue([
      {
        id: 1,
        tenant_id: 1,
        product_id: 42,
        supplier_id: null,
        quantity: 2,
        quantity_remaining: 2,
        unit_cost_usd: 1200,
        books_debt: 1,
        ledger_entry_id: null,
        transaction_id: null,
        is_opening: 0,
        created_by: 1,
        created_at: "2026-08-01T10:00:00.000Z",
        updated_at: "2026-08-01T10:00:00.000Z",
      },
      {
        id: 2,
        tenant_id: 1,
        product_id: 42,
        supplier_id: null,
        quantity: 2,
        quantity_remaining: 2,
        unit_cost_usd: 1300,
        books_debt: 1,
        ledger_entry_id: null,
        transaction_id: null,
        is_opening: 0,
        created_by: 1,
        created_at: "2026-09-01T10:00:00.000Z",
        updated_at: "2026-09-01T10:00:00.000Z",
      },
    ]);
    renderModal();

    expect(await screen.findByText("Cost Batches")).toBeInTheDocument();
    expect(screen.getByText(/2 units @ \$1200\.00/)).toBeInTheDocument();
    expect(screen.getByText(/2 units @ \$1300\.00/)).toBeInTheDocument();
  });

  it("does not show the Cost Batches section for a single batch", async () => {
    mockGetOpenStockBatches.mockResolvedValue([
      {
        id: 1,
        tenant_id: 1,
        product_id: 42,
        supplier_id: null,
        quantity: 4,
        quantity_remaining: 4,
        unit_cost_usd: 1200,
        books_debt: 1,
        ledger_entry_id: null,
        transaction_id: null,
        is_opening: 0,
        created_by: 1,
        created_at: "2026-08-01T10:00:00.000Z",
        updated_at: "2026-08-01T10:00:00.000Z",
      },
    ]);
    renderModal();

    await screen.findByText("No adjustments recorded yet.");
    await waitFor(() =>
      expect(mockGetOpenStockBatches).toHaveBeenCalledWith(42),
    );

    expect(screen.queryByText("Cost Batches")).not.toBeInTheDocument();
  });
});

// Migration v165 (owner-reported 2026-09-07): stock_adjustments gained a
// nullable unit_cost_usd column, populated only by a real delivery
// (ProductRepository.receiveStock). Pins both sides of the annotation: it
// shows up when a cost was actually recorded, and — the important case —
// a pre-v165 or non-delivery row (unit_cost_usd null) renders exactly as
// it always did, never a fabricated figure.
describe("AdjustStockModal — unit cost annotation (migration v165)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOpenStockBatches.mockResolvedValue([]);
  });

  it("shows the unit cost inline on a history row when unit_cost_usd is present", async () => {
    mockGetStockAdjustments.mockResolvedValue([
      {
        id: 20,
        product_id: 42,
        delta: 2,
        old_quantity: 2,
        new_quantity: 4,
        reason: "New shipment",
        user_id: 2,
        username: "amir",
        unit_cost_usd: 1300,
        created_at: "2026-09-07T10:00:00.000Z",
        updated_at: "2026-09-07T10:00:00.000Z",
      },
    ]);
    renderModal();

    expect(
      await screen.findByText(/\+2 @ \$1300\.00 \(2 → 4\)/),
    ).toBeInTheDocument();
  });

  it("renders a history row unchanged (no cost shown) when unit_cost_usd is null", async () => {
    mockGetStockAdjustments.mockResolvedValue([
      {
        id: 21,
        product_id: 42,
        delta: -3,
        old_quantity: 10,
        new_quantity: 7,
        reason: "Damaged in transit",
        user_id: 2,
        username: "amir",
        unit_cost_usd: null,
        created_at: "2026-07-19T10:00:00.000Z",
        updated_at: "2026-07-19T10:00:00.000Z",
      },
    ]);
    renderModal();

    expect(await screen.findByText(/-3 \(10 → 7\)/)).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
});

// LIRA-143 Phase 6b (decision #6) — the optional IMEI-intake step after a
// stock INCREASE on a category that tracks IMEI units. Decreases and
// flag-OFF products must stay byte-identical to the pre-Phase-6b flow
// (straight to onSuccess(), no intake step ever shown).
describe("AdjustStockModal — IMEI intake step (decision #6)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStockAdjustments.mockResolvedValue([]);
    mockGetOpenStockBatches.mockResolvedValue([]);
    mockAdjustStock.mockResolvedValue({ success: true });
    mockReceiveStock.mockResolvedValue({ success: true });
  });

  it("flag-OFF product: calls onSuccess immediately on an increase, no intake step", async () => {
    const { onSuccess } = renderModal({ tracksImeiUnits: false });

    fireEvent.change(screen.getByPlaceholderText("0"), {
      target: { value: "15" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "e.g. Physical recount, damaged goods, supplier correction…",
      ),
      { target: { value: "Restock" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply Adjustment" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("stock-intake-step")).not.toBeInTheDocument();
    expect(mockRegisterProductUnits).not.toHaveBeenCalled();
  });

  it("flag-ON product but a DECREASE: calls onSuccess immediately, no intake step", async () => {
    const { onSuccess } = renderModal({ tracksImeiUnits: true });

    fireEvent.change(screen.getByPlaceholderText("0"), {
      target: { value: "5" }, // 10 -> 5 is a decrease
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "e.g. Physical recount, damaged goods, supplier correction…",
      ),
      { target: { value: "Damaged units" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply Adjustment" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("stock-intake-step")).not.toBeInTheDocument();
  });

  it("flag-ON product with an INCREASE: shows the intake step instead of closing", async () => {
    const { onSuccess } = renderModal({ tracksImeiUnits: true });

    fireEvent.change(screen.getByPlaceholderText("0"), {
      target: { value: "13" }, // 10 -> 13, +3
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "e.g. Physical recount, damaged goods, supplier correction…",
      ),
      { target: { value: "New shipment" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply Adjustment" }));

    expect(await screen.findByTestId("stock-intake-step")).toBeInTheDocument();
    expect(screen.getByText(/Scan 3 IMEIs/)).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("Done calls onSuccess without registering any units when none were scanned", async () => {
    const { onSuccess } = renderModal({ tracksImeiUnits: true });

    fireEvent.change(screen.getByPlaceholderText("0"), {
      target: { value: "12" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "e.g. Physical recount, damaged goods, supplier correction…",
      ),
      { target: { value: "New shipment" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply Adjustment" }));
    await screen.findByTestId("stock-intake-step");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(mockRegisterProductUnits).not.toHaveBeenCalled();
  });

  it("registers each scanned IMEI immediately via ImeiAddRow, one call per scan", async () => {
    mockRegisterProductUnits
      .mockResolvedValueOnce({
        success: true,
        data: {
          units: [],
          drift: { inStockUnits: 11, stockQuantity: 12, matches: false },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          units: [],
          drift: { inStockUnits: 12, stockQuantity: 12, matches: true },
        },
      });
    const { onSuccess } = renderModal({ tracksImeiUnits: true });

    fireEvent.change(screen.getByPlaceholderText("0"), {
      target: { value: "12" }, // +2
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "e.g. Physical recount, damaged goods, supplier correction…",
      ),
      { target: { value: "New shipment" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply Adjustment" }));
    const input = await screen.findByTestId("imei-add-input");

    fireEvent.change(input, { target: { value: "111111111111111" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(mockRegisterProductUnits).toHaveBeenNthCalledWith(1, {
        product_id: 42,
        imeis: ["111111111111111"],
      }),
    );
    await waitFor(() => expect(input).toHaveValue(""));

    fireEvent.change(input, { target: { value: "222222222222222" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(mockRegisterProductUnits).toHaveBeenNthCalledWith(2, {
        product_id: 42,
        imeis: ["222222222222222"],
      }),
    );

    expect(await screen.findByText("111111111111111")).toBeInTheDocument();
    expect(screen.getByText("222222222222222")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("shows the service error inline and keeps the input value when registration fails", async () => {
    mockRegisterProductUnits.mockResolvedValue({
      success: false,
      error: "IMEI already registered",
    });
    const { onSuccess } = renderModal({ tracksImeiUnits: true });

    fireEvent.change(screen.getByPlaceholderText("0"), {
      target: { value: "11" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "e.g. Physical recount, damaged goods, supplier correction…",
      ),
      { target: { value: "New shipment" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply Adjustment" }));
    const input = await screen.findByTestId("imei-add-input");
    fireEvent.change(input, { target: { value: "111111111111111" } });
    fireEvent.click(screen.getByTestId("imei-add-button"));

    expect(
      await screen.findByText("IMEI already registered"),
    ).toBeInTheDocument();
    expect(input).toHaveValue("111111111111111");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("delta mode with a positive delta on a flag-ON product also triggers the intake step", async () => {
    const { onSuccess } = renderModal({ tracksImeiUnits: true });

    fireEvent.click(screen.getByRole("button", { name: "Add / remove (+/-)" }));
    fireEvent.change(screen.getByPlaceholderText("+10 or -5"), {
      target: { value: "4" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "e.g. Physical recount, damaged goods, supplier correction…",
      ),
      { target: { value: "New shipment" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply Adjustment" }));

    expect(await screen.findByTestId("stock-intake-step")).toBeInTheDocument();
    expect(screen.getByText(/Scan 4 IMEIs/)).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
