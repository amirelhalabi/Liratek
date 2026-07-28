/**
 * Maintenance draft-save — discount preservation (data-corruption fix)
 *
 * `handleSaveDraft` used to call `buildPricing(cost, price, currency)` with no
 * explicit `finalAmount`, so `buildPricing`'s default (`final = price`) silently
 * dropped any discount that was applied at checkout — resubmitting the FULL
 * price as `final_amount_*` and erasing the stored post-discount value. On a
 * job with money history this also tripped MaintenanceRepository.updateJob's
 * paid-job amount-immutability guard on a notes-only edit, since the bogus
 * final_amount differed from the stored one.
 *
 * This guards:
 *   (a) editing only the notes on a discounted, paid job resubmits the SAME
 *       final_amount_usd that was originally stored (price - discount), so
 *       the guard sees no amount change and the save succeeds.
 *   (b) changing the price recomputes final_amount_usd as the new price minus
 *       the job's existing discount.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Maintenance from "../index";

const mockGetMaintenanceJobs = jest.fn();
const mockSaveMaintenanceJob = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getMaintenanceJobs: mockGetMaintenanceJobs,
    saveMaintenanceJob: mockSaveMaintenanceJob,
    deleteMaintenanceJob: jest.fn(),
    // useAutoPrintReceipt -> useShopInfo() calls this on mount.
    getAllSettings: jest.fn().mockResolvedValue([]),
  }),
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    addToCart: jest.fn(),
  }),
}));

describe("Maintenance draft save — discount preservation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSaveMaintenanceJob.mockResolvedValue({ success: true });
  });

  it("(a) editing only the notes on a discounted, paid job resubmits the stored post-discount final_amount_usd", async () => {
    // Checked out at price 100, discount 20 -> stored final_amount_usd = 80
    // (this is exactly what handleCheckoutComplete would have written:
    // final = Math.max(0, totalAmount - discount)).
    mockGetMaintenanceJobs.mockResolvedValue([
      {
        id: 1,
        device_name: "iPhone 13",
        issue_description: "Screen replacement",
        status: "Delivered_Paid",
        currency: "USD",
        cost_usd: 10,
        price_usd: 100,
        discount_usd: 20,
        final_amount_usd: 80,
        paid_usd: 80,
        paid_lbp: 0,
      },
    ]);

    render(<Maintenance />);

    await waitFor(() => {
      expect(screen.getByText("iPhone 13")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("iPhone 13").closest("button")!);

    const issueField = await screen.findByLabelText(/Issue Description/i);
    fireEvent.change(issueField, {
      target: { value: "Screen replacement — customer confirmed pickup" },
    });

    fireEvent.click(screen.getByText("Save as Draft"));

    await waitFor(() => {
      expect(mockSaveMaintenanceJob).toHaveBeenCalledTimes(1);
    });

    const payload = mockSaveMaintenanceJob.mock.calls[0][0];
    expect(payload.price_usd).toBe(100);
    expect(payload.discount_usd).toBe(20);
    // The regression: this used to come back as 100 (the full price),
    // silently erasing the discount.
    expect(payload.final_amount_usd).toBe(80);
  });

  it("(b) changing the price recomputes final_amount_usd as price - discount", async () => {
    // Not yet paid, so the amount inputs are editable; discount_usd is
    // already on the record (e.g. set by an earlier partial flow) and must
    // be reapplied against the newly typed price.
    mockGetMaintenanceJobs.mockResolvedValue([
      {
        id: 2,
        device_name: "Samsung S21",
        issue_description: "Battery swap",
        status: "Ready",
        currency: "USD",
        cost_usd: 5,
        price_usd: 100,
        discount_usd: 20,
        final_amount_usd: 80,
        paid_usd: 0,
        paid_lbp: 0,
      },
    ]);

    render(<Maintenance />);

    await waitFor(() => {
      expect(screen.getByText("Samsung S21")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Samsung S21").closest("button")!);

    const priceField = await screen.findByLabelText(/Price to Client/i);
    fireEvent.change(priceField, { target: { value: "150" } });

    fireEvent.click(screen.getByText("Save as Draft"));

    await waitFor(() => {
      expect(mockSaveMaintenanceJob).toHaveBeenCalledTimes(1);
    });

    const payload = mockSaveMaintenanceJob.mock.calls[0][0];
    expect(payload.price_usd).toBe(150);
    expect(payload.discount_usd).toBe(20);
    expect(payload.final_amount_usd).toBe(130);
  });
});
