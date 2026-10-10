/** @jest-environment jsdom */
/**
 * LIRA-296 (T043, user story 5) — a repair's own warranty on the job form:
 * "Repair warranty (months)" is sent as `warranty_months` with the job, and
 * every save carries the shop's own day (`client_day`, rule 27) so the end
 * day is stamped on the shop's calendar when the job is delivered and paid.
 * Same harness as Maintenance.keptChangePayload.test.tsx.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Maintenance from "../index";
import { localDay } from "@/shared/utils/localDay";

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

jest.mock("@/features/sales/pages/POS/components/CheckoutModal", () => ({
  __esModule: true,
  default: (props: {
    totalAmount: number;
    currency?: string;
    onComplete: (data: Record<string, unknown>) => Promise<void>;
  }) => (
    <div data-testid="mock-checkout-modal">
      <button
        onClick={() =>
          // Customer owes $50, hands over $60, operator taps "Keep change"
          // — this is exactly the shape CheckoutModal.tsx:507-523 sends: no
          // change_given_* (cashReturnUSD stays 0 when kept), kept_change_usd
          // present instead.
          props.onComplete({
            client_id: null,
            total_amount: props.totalAmount,
            discount: 0,
            final_amount: props.totalAmount,
            currency: props.currency ?? "USD",
            payment_usd: 60,
            payment_lbp: 0,
            payments: [{ method: "CASH", currency_code: "USD", amount: 60 }],
            change_given_usd: 0,
            change_given_lbp: 0,
            kept_change_usd: 10,
            kept_change_lbp: 0,
            exchange_rate: 90000,
          })
        }
      >
        Mock Complete
      </button>
    </div>
  ),
}));

async function loadJobAndOpenCheckout(deviceName: string) {
  render(<Maintenance />);
  await waitFor(() => {
    expect(screen.getByText(deviceName)).toBeInTheDocument();
  });
  fireEvent.click(screen.getByText(deviceName).closest("button")!);
  fireEvent.click(screen.getByText("Proceed to Checkout"));
  await screen.findByText("Mock Complete");
}

describe("Maintenance — repair warranty (LIRA-296)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSaveMaintenanceJob.mockResolvedValue({ success: true, id: 1 });
    mockGetMaintenanceJobs.mockResolvedValue([
      {
        id: 1,
        device_name: "Warranty Job",
        issue_description: "Screen swap",
        status: "Ready",
        currency: "USD",
        cost_usd: 20,
        price_usd: 50,
        paid_usd: 0,
        paid_lbp: 0,
        warranty_months: 2,
      },
    ]);
  });

  it("shows the job's warranty months and sends a changed value at checkout, with the shop's day", async () => {
    await loadJobAndOpenCheckout("Warranty Job");
    // Re-open the form behind the modal: the field kept the job's value.
    const field = screen.getByLabelText("Repair warranty (months)");
    expect(field).toHaveValue(2);
    fireEvent.change(field, { target: { value: "3" } });
    fireEvent.click(screen.getByText("Mock Complete"));
    await waitFor(() =>
      expect(mockSaveMaintenanceJob).toHaveBeenCalledTimes(1),
    );
    const payload = mockSaveMaintenanceJob.mock.calls[0][0];
    expect(payload.warranty_months).toBe(3);
    expect(payload.client_day).toBe(localDay());
    expect(payload.status).toBe("Delivered_Paid");
  });

  it("an empty field means no warranty (null)", async () => {
    await loadJobAndOpenCheckout("Warranty Job");
    fireEvent.change(screen.getByLabelText("Repair warranty (months)"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByText("Mock Complete"));
    await waitFor(() =>
      expect(mockSaveMaintenanceJob).toHaveBeenCalledTimes(1),
    );
    expect(mockSaveMaintenanceJob.mock.calls[0][0].warranty_months).toBeNull();
  });
});
