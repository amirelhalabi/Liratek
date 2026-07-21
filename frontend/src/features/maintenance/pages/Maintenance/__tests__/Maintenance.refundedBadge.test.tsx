/**
 * Maintenance jobs list — refunded-job visibility (note 22a)
 *
 * When a maintenance transaction is refunded/voided, `maintenance.is_refunded`
 * is set to 1 server-side. The History modal already renders a "Refunded"
 * badge for such rows, but the main Jobs list never read `is_refunded` and
 * kept showing the plain workflow status (e.g. "Delivered & Paid") as if
 * nothing had happened. This guards the main list badge.
 */
import { render, screen, waitFor } from "@testing-library/react";
import Maintenance from "../index";

const mockGetMaintenanceJobs = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getMaintenanceJobs: mockGetMaintenanceJobs,
    saveMaintenanceJob: jest.fn(),
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

describe("Maintenance jobs list — refunded badge", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMaintenanceJobs.mockResolvedValue([
      {
        id: 1,
        device_name: "Refunded Phone",
        issue_description: "Screen replacement",
        status: "Delivered_Paid",
        currency: "USD",
        price_usd: 40,
        is_refunded: 1,
      },
      {
        id: 2,
        device_name: "Normal Repair",
        issue_description: "Battery swap",
        status: "Received",
        currency: "USD",
        price_usd: 20,
        is_refunded: 0,
      },
    ]);
  });

  it("shows a Refunded badge on a refunded job in the main jobs list", async () => {
    render(<Maintenance />);

    await waitFor(() => {
      expect(screen.getByText("Refunded Phone")).toBeInTheDocument();
    });

    const refundedRow = screen.getByText("Refunded Phone").closest("button");
    expect(refundedRow).not.toBeNull();
    expect(
      screen.getByText("Refunded", { selector: "span" }),
    ).toBeInTheDocument();

    const normalRow = screen.getByText("Normal Repair").closest("button");
    expect(normalRow).not.toBeNull();
    // The non-refunded job's row must not carry the Refunded badge.
    expect(
      normalRow ? Array.from(normalRow.querySelectorAll("span")) : [],
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ textContent: "Refunded" }),
      ]),
    );
  });
});
