/**
 * `buildJobPayload`'s `parts` key presence contract (LIRA-176 phase 8b,
 * item 2) — the ONE `saveMaintenanceJob` payload builder deliberately omits
 * `parts` entirely (never `[]`) when a caller doesn't pass it, because
 * MaintenanceService treats an ABSENT key as "leave parts untouched" and an
 * explicit empty array as "delete every attached part and return its
 * stock". A status transition never touches parts, so its payload must
 * genuinely lack the key — not carry an empty array that LOOKS harmless but
 * would wipe a job's parts on every status click.
 *
 * Also covers item 3: a status transition must preserve an existing
 * discount (via `computeFinalAmount`) rather than resending the raw price —
 * this was the exact bug fixed before phase 7b (see
 * Maintenance.draftDiscount.test.tsx for the draft-save half; this is the
 * status-transition half, never previously covered).
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
    getMaintenanceStatusHistory: jest.fn().mockResolvedValue([]),
    getProducts: jest.fn().mockResolvedValue([]),
    getAllSettings: jest.fn().mockResolvedValue([]),
  }),
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "staff", role: "staff" } }),
}));

describe("buildJobPayload — `parts` key presence per save path", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSaveMaintenanceJob.mockResolvedValue({ success: true, id: 1 });
  });

  it("status transition ('Start' button): `parts` key is ABSENT, not empty", async () => {
    mockGetMaintenanceJobs.mockResolvedValue([
      {
        id: 10,
        device_name: "Status Transition Job",
        issue_description: "Diagnostics",
        status: "Received",
        currency: "USD",
        cost_usd: 5,
        price_usd: 50,
        discount_usd: 0,
        final_amount_usd: 50,
        paid_usd: 0,
        paid_lbp: 0,
        parts: [],
      },
    ]);

    render(<Maintenance />);
    await waitFor(() => {
      expect(screen.getByText("Status Transition Job")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle("Mark In Progress"));

    await waitFor(() => {
      expect(mockSaveMaintenanceJob).toHaveBeenCalledTimes(1);
    });
    const payload = mockSaveMaintenanceJob.mock.calls[0][0];

    expect(payload.status).toBe("In_Progress");
    // Strict "does not have the property at all" — not `toEqual([])`, not
    // `toBeUndefined()` (which passes for both an absent key AND a key
    // explicitly set to `undefined`, hiding the exact regression this test
    // guards).
    expect(Object.prototype.hasOwnProperty.call(payload, "parts")).toBe(false);
  });

  it("status transition preserves an existing discount instead of resending the raw price", async () => {
    // Checked out at price 100, discount 20 -> stored final_amount_usd = 80.
    mockGetMaintenanceJobs.mockResolvedValue([
      {
        id: 11,
        device_name: "Discounted Transition Job",
        issue_description: "Screen replacement",
        status: "Received",
        currency: "USD",
        cost_usd: 10,
        price_usd: 100,
        discount_usd: 20,
        final_amount_usd: 80,
        paid_usd: 0,
        paid_lbp: 0,
        parts: [],
      },
    ]);

    render(<Maintenance />);
    await waitFor(() => {
      expect(screen.getByText("Discounted Transition Job")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle("Mark In Progress"));

    await waitFor(() => {
      expect(mockSaveMaintenanceJob).toHaveBeenCalledTimes(1);
    });
    const payload = mockSaveMaintenanceJob.mock.calls[0][0];

    expect(payload.price_usd).toBe(100);
    expect(payload.discount_usd).toBe(20);
    // The regression: resending the raw price would come back as 100,
    // silently erasing the discount on every status click.
    expect(payload.final_amount_usd).toBe(80);
  });

  it("draft save (new job, no parts added): `parts` key is PRESENT as an empty array", async () => {
    mockGetMaintenanceJobs.mockResolvedValue([]);

    render(<Maintenance />);

    const deviceField = await screen.findByLabelText(/Device Name/i);
    fireEvent.change(deviceField, { target: { value: "New Draft Job" } });
    const priceField = await screen.findByLabelText(/Price to Client/i);
    fireEvent.change(priceField, { target: { value: "50" } });

    fireEvent.click(screen.getByText("Save as Draft"));

    await waitFor(() => {
      expect(mockSaveMaintenanceJob).toHaveBeenCalledTimes(1);
    });
    const payload = mockSaveMaintenanceJob.mock.calls[0][0];

    expect(Object.prototype.hasOwnProperty.call(payload, "parts")).toBe(true);
    expect(payload.parts).toEqual([]);
  });

  it("draft save on a job WITH a part: `parts` key is present and non-empty", async () => {
    mockGetMaintenanceJobs.mockResolvedValue([
      {
        id: 12,
        device_name: "Draft Job With Part",
        issue_description: "Battery swap",
        status: "Received",
        currency: "USD",
        cost_usd: 5,
        price_usd: 60,
        paid_usd: 0,
        paid_lbp: 0,
        parts: [
          {
            id: 3,
            maintenance_id: 12,
            product_id: 9,
            product_name: "Battery",
            quantity: 2,
            unit_cost_usd: 8,
            unit_price_usd: 15,
            stock_restored: 0,
            created_at: "2026-09-01 10:00:00",
            updated_at: "2026-09-01 10:00:00",
          },
        ],
      },
    ]);

    render(<Maintenance />);
    await waitFor(() => {
      expect(screen.getByText("Draft Job With Part")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Draft Job With Part").closest("button")!);

    fireEvent.click(screen.getByText("Save as Draft"));

    await waitFor(() => {
      expect(mockSaveMaintenanceJob).toHaveBeenCalledTimes(1);
    });
    const payload = mockSaveMaintenanceJob.mock.calls[0][0];

    expect(Object.prototype.hasOwnProperty.call(payload, "parts")).toBe(true);
    expect(payload.parts).toEqual([
      { id: 3, product_id: 9, quantity: 2, unit_price_usd: 15 },
    ]);
  });
});
