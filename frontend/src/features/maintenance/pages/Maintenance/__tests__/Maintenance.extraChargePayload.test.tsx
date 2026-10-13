/**
 * Maintenance checkout — the extra charge reaches the save payload (LIRA-319
 * T038, page half).
 *
 * The shared CheckoutModal shows the "− Discount | + Extra" switch only when
 * its host opts in (`allowExtraCharge`), and then sends `extra_usd` (USD
 * total) or `extra_lbp` (LBP total) next to an unchanged `final_amount`.
 * The Maintenance page must (a) opt in and (b) forward the extra into the
 * `maintenance:save` payload — without (b) the extra the customer paid is
 * dropped and the money lands in the drawer with no record of why.
 *
 * Harness mirrors Maintenance.keptChangePayload.test.tsx (a mocked
 * CheckoutModal whose "Mock Complete" echoes what the real modal sends), with
 * ONE stable api object (rule 25). Payloads are checked against the save
 * schema itself (rule 24).
 *
 * Rule 17: written and run RED against the page before the fix.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { saveMaintenanceJobSchema } from "@liratek/core";
import Maintenance from "../index";

const mockApi = {
  getMaintenanceJobs: jest.fn(),
  saveMaintenanceJob: jest.fn(),
  deleteMaintenanceJob: jest.fn(),
  getMaintenanceStatusHistory: jest.fn().mockResolvedValue([]),
  getProducts: jest.fn().mockResolvedValue([]),
  getAllSettings: jest.fn().mockResolvedValue([]),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({ activeSession: null, addToCart: jest.fn() }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "staff", role: "staff" } }),
}));

/** What the mocked modal adds to its onComplete payload (the extra keys). */
let mockExtraKeys: Record<string, number> = {};
/** The props the page rendered the modal with. */
let mockModalProps: Record<string, unknown> = {};

jest.mock("@/features/sales/pages/POS/components/CheckoutModal", () => ({
  __esModule: true,
  default: (props: {
    totalAmount: number;
    currency?: string;
    allowExtraCharge?: boolean;
    onComplete: (data: Record<string, unknown>) => Promise<void>;
  }) => {
    mockModalProps = { ...props };
    const extra = mockExtraKeys.extra_usd ?? mockExtraKeys.extra_lbp ?? 0;
    const cur = props.currency ?? "USD";
    return (
      <div data-testid="mock-checkout-modal">
        <button
          onClick={() =>
            // CheckoutModal.getPaymentData: final_amount is the item total
            // (no extra); the extra rides as its own key; the tender covers
            // total + extra.
            props.onComplete({
              client_id: null,
              total_amount: props.totalAmount,
              discount: 0,
              final_amount: props.totalAmount,
              currency: cur,
              ...mockExtraKeys,
              payment_usd: cur === "USD" ? props.totalAmount + extra : 0,
              payment_lbp: cur === "LBP" ? props.totalAmount + extra : 0,
              payments: [
                {
                  method: "CASH",
                  currency_code: cur,
                  amount: props.totalAmount + extra,
                },
              ],
              change_given_usd: 0,
              change_given_lbp: 0,
              exchange_rate: 89500,
            })
          }
        >
          Mock Complete
        </button>
      </div>
    );
  },
}));

const USD_JOB = {
  id: 1,
  device_name: "Extra USD Job",
  issue_description: "Screen swap",
  status: "Received",
  currency: "USD",
  cost_usd: 8,
  price_usd: 20,
  paid_usd: 0,
  paid_lbp: 0,
};

const LBP_JOB = {
  id: 2,
  device_name: "Extra LBP Job",
  issue_description: "Battery",
  status: "Received",
  currency: "LBP",
  cost_usd: 0,
  price_usd: 0,
  cost_lbp: 900000,
  price_lbp: 1800000,
  final_amount_lbp: 1800000,
  paid_usd: 0,
  paid_lbp: 0,
};

async function checkout(deviceName: string): Promise<Record<string, unknown>> {
  render(<Maintenance />);
  await waitFor(() => {
    expect(screen.getByText(deviceName)).toBeInTheDocument();
  });
  fireEvent.click(screen.getByText(deviceName).closest("button")!);
  fireEvent.click(screen.getByText("Proceed to Checkout"));
  fireEvent.click(await screen.findByText("Mock Complete"));
  await waitFor(() => {
    expect(mockApi.saveMaintenanceJob).toHaveBeenCalledTimes(1);
  });
  return mockApi.saveMaintenanceJob.mock.calls[0][0];
}

describe("Maintenance checkout — extra charge forwarding (LIRA-319)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExtraKeys = {};
    mockModalProps = {};
    mockApi.saveMaintenanceJob.mockResolvedValue({ success: true, id: 1 });
    mockApi.getMaintenanceJobs.mockResolvedValue([USD_JOB, LBP_JOB]);
  });

  it("opts the checkout into the extra switch", async () => {
    await checkout("Extra USD Job");
    expect(mockModalProps.allowExtraCharge).toBe(true);
  });

  it("USD job: forwards extra_usd; labour final stays $20 (the extra is not folded in)", async () => {
    mockExtraKeys = { extra_usd: 2 };
    const payload = await checkout("Extra USD Job");

    const parsed = saveMaintenanceJobSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toMatchObject({
      extra_usd: 2,
      final_amount_usd: 20,
      discount_usd: 0,
    });
    expect(parsed.data.extra_lbp).toBeUndefined();
  });

  it("LBP job: forwards extra_lbp in LBP (the job's currency)", async () => {
    mockExtraKeys = { extra_lbp: 100000 };
    const payload = await checkout("Extra LBP Job");

    const parsed = saveMaintenanceJobSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toMatchObject({
      currency: "LBP",
      extra_lbp: 100000,
      final_amount_lbp: 1800000,
    });
    expect(parsed.data.extra_usd).toBeUndefined();
  });

  it("no extra: the payload carries no extra key", async () => {
    const payload = await checkout("Extra USD Job");
    expect(payload).not.toHaveProperty("extra_usd");
    expect(payload).not.toHaveProperty("extra_lbp");
  });
});
