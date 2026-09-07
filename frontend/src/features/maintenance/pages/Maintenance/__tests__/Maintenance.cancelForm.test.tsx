/**
 * Maintenance form — Cancel (X) button (LIRA-176 phase 8b, item 7).
 *
 * `handleCancelForm` only prompts `confirm()` when the form is dirty
 * (`isFormDirty`, which now also checks `parts.length > 0` — a job with
 * ONLY a part attached and every text field empty must still be treated as
 * dirty). Confirming resets the form via `handleNewJob`, which clears the
 * parts draft (`setParts([])`) along with every other field — a part left
 * behind after Cancel would silently reappear (and redraw stock) on the
 * next save.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Maintenance from "../index";

const mockGetMaintenanceJobs = jest.fn();
const mockGetProducts = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getMaintenanceJobs: mockGetMaintenanceJobs,
    saveMaintenanceJob: jest.fn().mockResolvedValue({ success: true }),
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

describe("Maintenance — Cancel (X) button", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMaintenanceJobs.mockResolvedValue([]);
    mockGetProducts.mockResolvedValue([
      {
        id: 5,
        name: "Screen Assembly",
        category: "Parts",
        cost_price: 25,
        retail_price: 40,
        stock_quantity: 3,
      },
    ]);
  });

  it("does NOT prompt confirm() when the form is empty", async () => {
    window.confirm = jest.fn().mockReturnValue(true);
    render(<Maintenance />);
    await screen.findByLabelText(/Device Name/i);

    fireEvent.click(screen.getByTitle("Cancel"));

    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("prompts confirm() when only a part has been attached (no text fields filled)", async () => {
    window.confirm = jest.fn().mockReturnValue(true);
    render(<Maintenance />);
    await screen.findByLabelText(/Device Name/i);

    fireEvent.change(screen.getByPlaceholderText("Search parts..."), {
      target: { value: "screen" },
    });
    const result = await screen.findByText("Screen Assembly");
    fireEvent.click(result);

    // Confirm the part was actually added before exercising Cancel.
    await waitFor(() => {
      expect(screen.getByDisplayValue("40")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle("Cancel"));

    expect(window.confirm).toHaveBeenCalledWith("Discard unsaved changes?");
  });

  it("clears the parts draft (along with every other field) once Cancel is confirmed", async () => {
    window.confirm = jest.fn().mockReturnValue(true);
    render(<Maintenance />);
    const deviceField = await screen.findByLabelText(/Device Name/i);

    fireEvent.change(deviceField, { target: { value: "Temp Device" } });
    fireEvent.change(screen.getByPlaceholderText("Search parts..."), {
      target: { value: "screen" },
    });
    const result = await screen.findByText("Screen Assembly");
    fireEvent.click(result);

    await waitFor(() => {
      expect(screen.getByDisplayValue("40")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle("Cancel"));

    expect(window.confirm).toHaveBeenCalled();
    // Device name reset...
    expect((deviceField as HTMLInputElement).value).toBe("");
    // ...and the attached part is gone, not just visually hidden.
    expect(screen.queryByDisplayValue("40")).not.toBeInTheDocument();
    expect(screen.queryByText("Screen Assembly")).not.toBeInTheDocument();
  });

  it("does NOT reset the form when the confirm is dismissed", async () => {
    window.confirm = jest.fn().mockReturnValue(false);
    render(<Maintenance />);
    const deviceField = await screen.findByLabelText(/Device Name/i);

    fireEvent.change(deviceField, { target: { value: "Kept Device" } });
    fireEvent.click(screen.getByTitle("Cancel"));

    expect(window.confirm).toHaveBeenCalled();
    expect((deviceField as HTMLInputElement).value).toBe("Kept Device");
  });
});
