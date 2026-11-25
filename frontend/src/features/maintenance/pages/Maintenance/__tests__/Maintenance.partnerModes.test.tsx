/**
 * LIRA-403 — the partner switch on the Maintenance page (same control and
 * meaning as Custom Services). Payloads are checked through the save schema
 * itself (rule 24):
 *   - For Partner: "Deliver to partner" saves Delivered_Paid with the partner
 *     and NO payment window / legs.
 *   - Via Partner: the normal checkout, legs + the partner, no extra switch.
 *   - A reopened job shows its saved mode; a status step sends no partner key.
 *
 * Written after the page change — NOT proven failing-first (rule 17); the
 * core guard `lira403.maintenancePartnerModes.test.ts` was.
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

jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: ({ onSelect }: { onSelect: (id: number) => void }) => (
    <button onClick={() => onSelect(7)}>Pick partner</button>
  ),
}));

let mockModalProps: Record<string, unknown> = {};
jest.mock("@/features/sales/pages/POS/components/CheckoutModal", () => ({
  __esModule: true,
  default: (props: {
    totalAmount: number;
    allowExtraCharge?: boolean;
    onComplete: (data: Record<string, unknown>) => Promise<void>;
  }) => {
    mockModalProps = { ...props };
    return (
      <button
        onClick={() =>
          props.onComplete({
            client_id: null,
            total_amount: props.totalAmount,
            discount: 0,
            final_amount: props.totalAmount,
            currency: "USD",
            payment_usd: props.totalAmount,
            payment_lbp: 0,
            payments: [
              {
                method: "CASH",
                currency_code: "USD",
                amount: props.totalAmount,
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
    );
  },
}));

const JOB = {
  id: 1,
  device_name: "Partner Job",
  issue_description: "Screen",
  status: "Ready",
  currency: "USD",
  cost_usd: 40,
  price_usd: 100,
  final_amount_usd: 100,
  paid_usd: 0,
  paid_lbp: 0,
};

async function openJob(job: Record<string, unknown> = JOB) {
  mockApi.getMaintenanceJobs.mockResolvedValue([job]);
  render(<Maintenance />);
  await waitFor(() => {
    expect(screen.getByText(String(job.device_name))).toBeInTheDocument();
  });
  fireEvent.click(screen.getByText(String(job.device_name)).closest("button")!);
}

describe("Maintenance partner switch (LIRA-403)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockModalProps = {};
    mockApi.saveMaintenanceJob.mockResolvedValue({ success: true, id: 1 });
  });

  it("For Partner: Deliver to partner saves Delivered_Paid with the partner and no payment", async () => {
    await openJob();
    fireEvent.click(screen.getByTestId("maintenance-for-partner-toggle"));
    expect(screen.getByTestId("maintenance-deliver-to-partner")).toBeDisabled();
    expect(screen.queryByText("Proceed to Checkout")).toBeNull();
    fireEvent.click(screen.getByText("Pick partner"));
    fireEvent.click(screen.getByTestId("maintenance-deliver-to-partner"));
    await waitFor(() => {
      expect(mockApi.saveMaintenanceJob).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("Mock Complete")).toBeNull();
    const parsed = saveMaintenanceJobSchema.safeParse(
      mockApi.saveMaintenanceJob.mock.calls[0][0],
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toMatchObject({
      id: 1,
      status: "Delivered_Paid",
      partner_mode: "FOR",
      partner_id: 7,
      final_amount_usd: 100,
    });
    expect(parsed.data.payments).toBeUndefined();
  });

  it("Via Partner: the normal checkout carries the legs and the partner, without the extra switch", async () => {
    await openJob();
    fireEvent.click(screen.getByTestId("maintenance-via-partner-toggle"));
    fireEvent.click(screen.getByText("Pick partner"));
    fireEvent.click(screen.getByText("Proceed to Checkout"));
    expect(mockModalProps.allowExtraCharge).toBe(false);
    fireEvent.click(await screen.findByText("Mock Complete"));
    await waitFor(() => {
      expect(mockApi.saveMaintenanceJob).toHaveBeenCalledTimes(1);
    });
    const parsed = saveMaintenanceJobSchema.safeParse(
      mockApi.saveMaintenanceJob.mock.calls[0][0],
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toMatchObject({
      status: "Delivered_Paid",
      partner_mode: "VIA",
      partner_id: 7,
      payments: [{ method: "CASH", currency_code: "USD", amount: 100 }],
    });
  });

  it("Customer: a checkout clears any partner (null), and keeps the extra switch", async () => {
    await openJob();
    fireEvent.click(screen.getByText("Proceed to Checkout"));
    expect(mockModalProps.allowExtraCharge).toBe(true);
    fireEvent.click(await screen.findByText("Mock Complete"));
    await waitFor(() => {
      expect(mockApi.saveMaintenanceJob).toHaveBeenCalledTimes(1);
    });
    expect(mockApi.saveMaintenanceJob.mock.calls[0][0]).toMatchObject({
      partner_mode: null,
      partner_id: null,
    });
  });

  it("a reopened For job shows its mode; a status step sends no partner key", async () => {
    await openJob({
      ...JOB,
      status: "Received",
      partner_mode: "FOR",
      partner_id: 7,
    });
    expect(screen.getByTestId("maintenance-for-partner-toggle")).toBeChecked();
    fireEvent.click(screen.getByText("Start"));
    await waitFor(() => {
      expect(mockApi.saveMaintenanceJob).toHaveBeenCalledTimes(1);
    });
    const payload = mockApi.saveMaintenanceJob.mock.calls[0][0];
    expect(payload).not.toHaveProperty("partner_mode");
    expect(payload).not.toHaveProperty("partner_id");
  });
});
