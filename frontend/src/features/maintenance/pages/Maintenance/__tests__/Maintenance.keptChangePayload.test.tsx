/**
 * Maintenance checkout — kept-change forwarding (LIRA-185 D5)
 *
 * `allowKeepChange={true}` on the CheckoutModal (index.tsx:1259) lets the
 * operator tap "Keep change" — the REAL CheckoutModal then adds
 * `kept_change_usd`/`kept_change_lbp` to the `onComplete` payload (see
 * CheckoutModal.tsx:519-522, same shape POS/Loto/CustomServices already
 * forward). `buildJobPayload`'s `checkout` block (index.tsx) used to forward
 * only `exchange_rate`/`payments`/`paid_by`/`change_given_*` — so the kept
 * cash stayed in the drawer with no profit row anywhere (core's own
 * ProfitAudit.maintenance.test.ts "[D5]" case proves the money side; this
 * file proves the PAGE actually sends the field the backend already knows
 * how to stamp).
 *
 * Mirrors Maintenance.checkoutPartsPayload.test.tsx's harness: a mocked
 * CheckoutModal whose "Mock Complete" button echoes exactly what the real
 * modal would send for a kept-change checkout.
 *
 * Rule 17: this must be seen RED against the pre-fix buildJobPayload (no
 * kept_change_* key in the checkout block) before the fix lands.
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
            payments: [
              { method: "CASH", currency_code: "USD", amount: 60 },
            ],
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

describe("Maintenance checkout — kept-change forwarding (LIRA-185 D5)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSaveMaintenanceJob.mockResolvedValue({ success: true, id: 1 });
    mockGetMaintenanceJobs.mockResolvedValue([
      {
        id: 1,
        device_name: "Keep Change Job",
        issue_description: "Screen swap",
        status: "Received",
        currency: "USD",
        cost_usd: 20,
        price_usd: 50,
        paid_usd: 0,
        paid_lbp: 0,
      },
    ]);
  });

  it("forwards kept_change_usd/lbp from the checkout payload into saveMaintenanceJob's payload", async () => {
    await loadJobAndOpenCheckout("Keep Change Job");
    fireEvent.click(screen.getByText("Mock Complete"));

    await waitFor(() => {
      expect(mockSaveMaintenanceJob).toHaveBeenCalledTimes(1);
    });
    const payload = mockSaveMaintenanceJob.mock.calls[0][0];

    // The regression this guards: kept_change_usd must reach the backend —
    // before the fix, buildJobPayload's checkout block dropped it entirely.
    expect(payload.kept_change_usd).toBe(10);
    expect(payload.kept_change_lbp).toBe(0);
  });
});
