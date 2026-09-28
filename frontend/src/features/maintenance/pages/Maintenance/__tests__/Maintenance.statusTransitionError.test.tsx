/**
 * LIRA-211 — `handleStatusTransition` had `if (result.success) {...}` with
 * NO `else` branch, so a refused status change (e.g. a staff-role 403 on
 * web, found in a real web-app test 2026-09-28) was completely silent: no
 * alert, no reload, and the job stayed on its old status with nothing
 * telling the operator why. Worse, `requestJson` (web transport) THROWS a
 * plain `{status,message,details}` object on a non-2xx response — never
 * caught anywhere in the original handler — so on web this wasn't merely
 * silent, it was an UNCAUGHT promise rejection (an uncaught page error).
 *
 * Fix: wrap the call in try/catch and alert the real reason on either a
 * resolved `{success:false}` OR a thrown ApiError-shaped object, mirroring
 * the sibling `handleSaveDraft`/`handleCheckoutComplete` failure branches
 * already in this file (`alert("Error: " + message)`).
 *
 * Harness mirrors the sibling `Maintenance.cancelForm.test.tsx` (same
 * `useApi()` mock shape, same lightweight "let the real page render"
 * approach).
 *
 * Rule 17: proven to fail against the pre-fix handler — a rejected promise
 * from `saveMaintenanceJob` reached nothing (no alert call), and a resolved
 * `{success:false}` was silently ignored too.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Maintenance from "../index";

const mockGetMaintenanceJobs = jest.fn();
const mockSaveMaintenanceJob = jest.fn();
const mockGetProducts = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getMaintenanceJobs: mockGetMaintenanceJobs,
    saveMaintenanceJob: mockSaveMaintenanceJob,
    deleteMaintenanceJob: jest.fn(),
    getMaintenanceStatusHistory: jest.fn().mockResolvedValue([]),
    getProducts: mockGetProducts,
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

const RECEIVED_JOB = {
  id: 1,
  status: "Received",
  device_name: "iPhone 13",
  issue_description: "Screen cracked",
  client_name: "",
  client_phone: "",
  currency: "USD",
  price_usd: 50,
  cost_usd: 20,
  parts_price_usd: 0,
  parts: [],
  created_at: "2026-09-28T10:00:00.000Z",
};

describe("Maintenance — status transition failure is surfaced (LIRA-211)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMaintenanceJobs.mockResolvedValue([RECEIVED_JOB]);
    mockGetProducts.mockResolvedValue([]);
    window.alert = jest.fn();
  });

  it("alerts the server's error when the status-change request RESOLVES with {success:false}", async () => {
    mockSaveMaintenanceJob.mockResolvedValue({
      success: false,
      error: "Forbidden",
    });

    render(<Maintenance />);
    const startButton = await screen.findByTitle("Mark In Progress");
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(
        expect.stringContaining("Forbidden"),
      );
    });
  });

  it("alerts the server's error when the status-change request THROWS (web 403 shape — requestJson throws {status,message,details}, not an Error)", async () => {
    mockSaveMaintenanceJob.mockRejectedValue({
      status: 403,
      message: "Forbidden",
      details: { error: "Forbidden" },
    });

    render(<Maintenance />);
    const startButton = await screen.findByTitle("Mark In Progress");
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(
        expect.stringContaining("Forbidden"),
      );
    });
  });

  it("does NOT alert when the status change succeeds (unchanged behavior)", async () => {
    mockSaveMaintenanceJob.mockResolvedValue({ success: true, id: 1 });
    mockGetMaintenanceJobs
      .mockResolvedValueOnce([RECEIVED_JOB])
      .mockResolvedValue([{ ...RECEIVED_JOB, status: "In_Progress" }]);

    render(<Maintenance />);
    const startButton = await screen.findByTitle("Mark In Progress");
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(mockGetMaintenanceJobs).toHaveBeenCalledTimes(2);
    });
    expect(window.alert).not.toHaveBeenCalled();
  });
});
