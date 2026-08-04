/**
 * Maintenance — CheckoutModal "Save as Draft" + amount-lock gate (owner
 * manual-test reports, 2026-07-28)
 *
 * Report 1/2: clicking "Save as Draft" INSIDE the CheckoutModal used to call
 * `handleCheckoutComplete` verbatim (`onSaveDraft={async (data) => {
 * await handleCheckoutComplete(data); }}`), which hardcodes
 * `status: "Delivered_Paid"` and forwards `payments`/`paid_usd`/`paid_lbp`
 * from whatever was typed into the payment sheet — so a "draft" came back as
 * a fully paid job with a real transaction. The fix routes the modal's
 * onSaveDraft through the page's own `handleSaveDraft` (the same function the
 * page's own "Save as Draft" button already used, and already gets correct
 * status/paid_usd/paid_lbp/no-payments semantics) instead.
 *
 * Failing-first recipe for part 1: revert the `onSaveDraft` wiring in
 * `Maintenance/index.tsx` back to
 * `onSaveDraft={async (data) => { await handleCheckoutComplete(data); }}`
 * — the assertions on `status`/`payments`/`paid_usd` below go red because the
 * mocked modal's canned payment data (payment_usd: 100, a CASH payment leg)
 * flows straight into the saved job.
 *
 * Report 3: after refunding a paid job, reopening it still showed "Paid job —
 * void or refund to change the amount" and kept the amount fields disabled —
 * wrong, since the owner had already refunded it. The UI's disabled-state
 * signal (`paid_usd > 0`) never agreed with the backend's real gate
 * (`jobHasActiveTransaction` + `is_refunded`), which itself never re-opened
 * after a refund/void (a permanently-ACTIVE sibling row always keeps
 * `getBySourceId` non-null). Fixed by combining the existing `paid_usd/lbp`
 * proxy with the already-plumbed `is_refunded` flag on both sides.
 *
 * Failing-first recipe for part 2: revert `isAmountLocked` back to just
 * `hasMoneyHistory` (drop the `&& !isRefundedOrVoided`) — the "already
 * refunded" scenario below goes red: the amount fields stay disabled and the
 * stale "Paid job — void or refund…" banner reappears instead of the
 * informational note.
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

// A minimal stand-in for the real CheckoutModal: exposes one button that
// invokes `onSaveDraft` with a canned, fully-paid-looking PaymentData payload
// (the same shape CheckoutModal.getPaymentData() produces) — proving what the
// PAGE does with it, independent of the real modal's payment-sheet UI.
jest.mock("@/features/sales/pages/POS/components/CheckoutModal", () => ({
  __esModule: true,
  default: (props: {
    onSaveDraft: (data: Record<string, unknown>) => Promise<void>;
  }) => (
    <div data-testid="mock-checkout-modal">
      <button
        onClick={() =>
          props.onSaveDraft({
            client_id: 42,
            client_name: "Jane Doe",
            client_phone: "71234567",
            total_amount: 100,
            discount: 0,
            final_amount: 100,
            currency: "USD",
            payment_usd: 100,
            payment_lbp: 0,
            payments: [{ method: "CASH", currency_code: "USD", amount: 100 }],
            change_given_usd: 0,
            change_given_lbp: 0,
            exchange_rate: 1,
          })
        }
      >
        Mock Modal Save Draft
      </button>
    </div>
  ),
}));

describe("Maintenance — CheckoutModal Save-as-Draft does not perform a checkout", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMaintenanceJobs.mockResolvedValue([]);
    mockSaveMaintenanceJob.mockResolvedValue({ success: true, id: 99 });
  });

  it("saves a Received (non-paid) job with no payments when the MODAL's Save-as-Draft is used", async () => {
    render(<Maintenance />);

    const deviceField = await screen.findByLabelText(/Device Name/i);
    fireEvent.change(deviceField, { target: { value: "iPhone 15" } });
    const priceField = await screen.findByLabelText(/Price to Client/i);
    fireEvent.change(priceField, { target: { value: "100" } });

    fireEvent.click(screen.getByText("Proceed to Checkout"));

    const modalDraftBtn = await screen.findByText("Mock Modal Save Draft");
    fireEvent.click(modalDraftBtn);

    await waitFor(() => {
      expect(mockSaveMaintenanceJob).toHaveBeenCalledTimes(1);
    });

    const payload = mockSaveMaintenanceJob.mock.calls[0][0];
    // The regression: this used to come back as "Delivered_Paid".
    expect(payload.status).toBe("Received");
    expect(payload.status).not.toBe("Delivered_Paid");
    // The regression: this used to be the modal's canned payments array.
    expect(payload.payments).toBeUndefined();
    // The regression: this used to be 100 (paymentData.payment_usd).
    expect(payload.paid_usd).toBe(0);
    expect(payload.paid_lbp).toBe(0);
    // Client info from the modal's own search box still propagates.
    expect(payload.client_id).toBe(42);
    expect(payload.client_name).toBe("Jane Doe");
    expect(payload.client_phone).toBe("71234567");
  });
});

describe("Maintenance — amount-lock gate mirrors the backend signal (paid && !is_refunded)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("(a) unpaid job: no lock banner, amount fields enabled", async () => {
    mockGetMaintenanceJobs.mockResolvedValue([
      {
        id: 1,
        device_name: "Unpaid Job",
        issue_description: "Diagnostics",
        status: "Received",
        currency: "USD",
        cost_usd: 5,
        price_usd: 50,
        paid_usd: 0,
        paid_lbp: 0,
        is_refunded: 0,
      },
    ]);

    render(<Maintenance />);
    await waitFor(() => screen.getByText("Unpaid Job"));
    fireEvent.click(screen.getByText("Unpaid Job").closest("button")!);

    expect(
      screen.queryByText(/Paid job — void or refund/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/voided or refunded/i)).not.toBeInTheDocument();
    const priceField = await screen.findByLabelText(/Price to Client/i);
    expect(priceField).not.toBeDisabled();
  });

  it("(b) paid job, ACTIVE transaction (not refunded): lock banner shown, amount fields disabled", async () => {
    mockGetMaintenanceJobs.mockResolvedValue([
      {
        id: 2,
        device_name: "Paid Active Job",
        issue_description: "Screen swap",
        status: "Delivered_Paid",
        currency: "USD",
        cost_usd: 10,
        price_usd: 80,
        paid_usd: 80,
        paid_lbp: 0,
        is_refunded: 0,
      },
    ]);

    render(<Maintenance />);
    await waitFor(() => screen.getByText("Paid Active Job"));
    fireEvent.click(screen.getByText("Paid Active Job").closest("button")!);

    expect(
      await screen.findByText(/Paid job — void or refund/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/voided or refunded/i)).not.toBeInTheDocument();
    const priceField = await screen.findByLabelText(/Price to Client/i);
    expect(priceField).toBeDisabled();
  });

  it("(d) paid job, already refunded: NO lock banner, informational note instead, amount fields re-enabled", async () => {
    mockGetMaintenanceJobs.mockResolvedValue([
      {
        id: 3,
        device_name: "Refunded Job",
        issue_description: "Battery swap",
        status: "Delivered_Paid",
        currency: "USD",
        cost_usd: 10,
        price_usd: 80,
        paid_usd: 80,
        paid_lbp: 0,
        is_refunded: 1,
      },
    ]);

    render(<Maintenance />);
    await waitFor(() => screen.getByText("Refunded Job"));
    fireEvent.click(screen.getByText("Refunded Job").closest("button")!);

    // The owner-reported wrong message must NOT appear once already refunded.
    expect(
      screen.queryByText(/Paid job — void or refund/i),
    ).not.toBeInTheDocument();
    expect(await screen.findByText(/voided or refunded/i)).toBeInTheDocument();
    const priceField = await screen.findByLabelText(/Price to Client/i);
    expect(priceField).not.toBeDisabled();
  });
});
