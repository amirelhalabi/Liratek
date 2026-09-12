/**
 * Maintenance checkout — parts payload correctness (LIRA-176 phase 8b, item 1/2)
 *
 * `handleCheckoutComplete` (Maintenance/index.tsx) computes `labourFinal` —
 * the LABOUR-ONLY final amount sent to `saveMaintenanceJob` — from the
 * CheckoutModal's `final_amount`. The two job currencies take DIFFERENT
 * paths:
 *
 *   - USD job: `totalAmount` handed to CheckoutModal already merges parts
 *     into the "$" figure (labour + parts ride in the same currency), so
 *     `final_amount` comes back with parts baked in and must be subtracted
 *     back out: `labourFinal = final_amount - partsPriceUsd`.
 *   - LBP job: parts NEVER enter `totalAmount` (they ride as a separate
 *     `extraTotals` USD entry) — `final_amount` is already labour-only, so
 *     `labourFinal = final_amount` with NO subtraction.
 *
 * A regression that applies the same formula to both currencies either
 * double-counts every part (LBP side subtracts a USD figure from an LBP
 * total) or loses them entirely (USD side stops subtracting and parts get
 * billed twice — once folded into totalAmount, once again via the `parts`
 * array the backend also folds in). This file proves both currencies
 * independently, with a real part attached via `handleEdit`'s job-load path
 * (mirrors what loading an existing job with parts, then checking out, does).
 *
 * Also covers item 2's checkout half: `parts` must be PRESENT (not merely
 * non-empty) in a checkout payload — the omission-vs-empty-array distinction
 * matters because MaintenanceService treats "no `parts` key" as "leave
 * parts untouched" and an explicit `[]` as "delete every part".
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Maintenance from "../index";

const mockGetMaintenanceJobs = jest.fn();
const mockSaveMaintenanceJob = jest.fn();

// Captured so each test can read exactly what the PAGE passed as props to
// CheckoutModal (totalAmount/currency/extraTotals) — the mock's "Mock
// Complete" button echoes totalAmount straight back as final_amount with a
// zero discount, which is exactly what the REAL CheckoutModal computes for
// a zero-discount checkout (`finalAmount = totalAmount - discount`). This
// proves what the PAGE computed and handed down, not the mock's own math.
let lastCheckoutProps: {
  totalAmount: number;
  currency?: string | undefined;
} | null = null;

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
  }) => {
    lastCheckoutProps = {
      totalAmount: props.totalAmount,
      currency: props.currency,
    };
    return (
      <div data-testid="mock-checkout-modal">
        <button
          onClick={() =>
            props.onComplete({
              client_id: null,
              total_amount: props.totalAmount,
              discount: 0,
              final_amount: props.totalAmount,
              currency: props.currency ?? "USD",
              payment_usd: props.currency === "LBP" ? 0 : props.totalAmount,
              payment_lbp: props.currency === "LBP" ? props.totalAmount : 0,
              payments: [
                {
                  method: "CASH",
                  currency_code: props.currency ?? "USD",
                  amount: props.totalAmount,
                },
              ],
              change_given_usd: 0,
              change_given_lbp: 0,
              exchange_rate: 90000,
            })
          }
        >
          Mock Complete
        </button>
      </div>
    );
  },
}));

const PART = {
  id: 7,
  maintenance_id: 1,
  product_id: 5,
  product_name: "Screen Assembly",
  quantity: 1,
  unit_cost_usd: 25,
  unit_price_usd: 40,
  stock_restored: 0,
  created_at: "2026-09-01 10:00:00",
  updated_at: "2026-09-01 10:00:00",
};

async function loadJobAndOpenCheckout(deviceName: string) {
  render(<Maintenance />);
  await waitFor(() => {
    expect(screen.getByText(deviceName)).toBeInTheDocument();
  });
  fireEvent.click(screen.getByText(deviceName).closest("button")!);
  fireEvent.click(screen.getByText("Proceed to Checkout"));
  await screen.findByText("Mock Complete");
}

describe("Maintenance checkout — labourFinal parts asymmetry per currency", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastCheckoutProps = null;
    mockSaveMaintenanceJob.mockResolvedValue({ success: true, id: 1 });
  });

  it("USD job: totalAmount merges parts; labourFinal subtracts them back out", async () => {
    mockGetMaintenanceJobs.mockResolvedValue([
      {
        id: 1,
        device_name: "USD Parts Job",
        issue_description: "Screen swap",
        status: "Received",
        currency: "USD",
        cost_usd: 10,
        price_usd: 100,
        paid_usd: 0,
        paid_lbp: 0,
        parts: [PART],
        parts_cost_usd: 25,
        parts_price_usd: 40,
      },
    ]);

    await loadJobAndOpenCheckout("USD Parts Job");

    // The page must have folded the $40 part into totalAmount for a USD job.
    expect(lastCheckoutProps?.totalAmount).toBe(140);
    expect(lastCheckoutProps?.currency).toBe("USD");

    fireEvent.click(screen.getByText("Mock Complete"));

    await waitFor(() => {
      expect(mockSaveMaintenanceJob).toHaveBeenCalledTimes(1);
    });
    const payload = mockSaveMaintenanceJob.mock.calls[0][0];

    // The regression this guards: labourFinal must be 100 (price alone), NOT
    // 140 (which would double-count the part — once here, once via `parts`).
    expect(payload.final_amount_usd).toBe(100);
    expect(payload.final_amount_lbp).toBe(0);
    expect(payload).toHaveProperty("parts");
    expect(payload.parts).toEqual([
      { id: 7, product_id: 5, quantity: 1, unit_price_usd: 40 },
    ]);
  });

  it("LBP job: totalAmount is labour-only; labourFinal does NOT subtract parts", async () => {
    mockGetMaintenanceJobs.mockResolvedValue([
      {
        id: 2,
        device_name: "LBP Parts Job",
        issue_description: "Battery swap",
        status: "Received",
        currency: "LBP",
        cost_lbp: 100000,
        price_lbp: 500000,
        paid_usd: 0,
        paid_lbp: 0,
        parts: [PART],
        parts_cost_usd: 25,
        parts_price_usd: 40,
      },
    ]);

    await loadJobAndOpenCheckout("LBP Parts Job");

    // Parts must NOT be folded into an LBP job's totalAmount — they ride as
    // a separate USD extraTotals entry instead (asserted via CheckoutModal's
    // own extraTotals prop indirectly: totalAmount stays labour-only here).
    expect(lastCheckoutProps?.totalAmount).toBe(500000);
    expect(lastCheckoutProps?.currency).toBe("LBP");

    fireEvent.click(screen.getByText("Mock Complete"));

    await waitFor(() => {
      expect(mockSaveMaintenanceJob).toHaveBeenCalledTimes(1);
    });
    const payload = mockSaveMaintenanceJob.mock.calls[0][0];

    // The regression this guards: labourFinal must stay 500000. A formula
    // that unconditionally subtracts partsPriceUsd (40, a USD figure) from
    // an LBP total would silently corrupt the stored LBP amount.
    expect(payload.final_amount_lbp).toBe(500000);
    expect(payload.final_amount_usd).toBe(0);
    expect(payload).toHaveProperty("parts");
    expect(payload.parts).toEqual([
      { id: 7, product_id: 5, quantity: 1, unit_price_usd: 40 },
    ]);
  });
});
