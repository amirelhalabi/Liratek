/**
 * Maintenance — the job's typed Client Name / Phone reach the checkout's
 * Customer fields (shop-day test 2026-10-16, CLAUDE.md rule 11).
 *
 * The cashier typed "Hassan Zein" / "76998877" on the job, pressed Proceed
 * to Checkout, and the checkout's Customer fields were EMPTY: the page never
 * handed them to CheckoutModal, so the cashier had to search the client
 * again (and, until they did, the change box had no "Account" option).
 *
 * CheckoutModal is mocked here so this proves exactly what the PAGE passes;
 * CheckoutModal.initialCustomer.test.tsx proves the modal shows it.
 * Rule 25: `useApi` returns ONE stable object.
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

let mockActiveSession: {
  id: number;
  customer_name: string;
  customer_phone: string;
} | null = null;
const mockAddToCart = jest.fn();
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: mockActiveSession,
    addToCart: mockAddToCart,
  }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "staff", role: "staff" } }),
}));

let lastInitialCustomer: unknown = "not rendered";

// Completes the way the REAL modal does with untouched Customer fields: the
// seeded name and phone come back as client_name / client_phone
// (CheckoutModal.initialCustomer.test.tsx proves that half).
jest.mock("@/features/sales/pages/POS/components/CheckoutModal", () => ({
  __esModule: true,
  default: (props: {
    totalAmount: number;
    initialCustomer?: { name: string; phone: string };
    onComplete: (data: Record<string, unknown>) => Promise<void>;
  }) => {
    lastInitialCustomer = props.initialCustomer;
    const seed = props.initialCustomer;
    return (
      <div data-testid="mock-checkout-modal">
        <button
          onClick={() =>
            props.onComplete({
              client_id: null,
              ...(seed?.name ? { client_name: seed.name } : {}),
              ...(seed?.phone ? { client_phone: seed.phone } : {}),
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
              exchange_rate: 89000,
            })
          }
        >
          Mock Complete
        </button>
      </div>
    );
  },
}));

describe("Maintenance — checkout opens with the job's client", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastInitialCustomer = "not rendered";
    mockActiveSession = null;
    mockApi.saveMaintenanceJob.mockResolvedValue({ success: true, id: 1 });
    mockApi.getMaintenanceJobs.mockResolvedValue([
      {
        id: 1,
        device_name: "iPhone 13 Pro Max",
        issue_description: "Back glass",
        status: "Received",
        currency: "LBP",
        cost_lbp: 1_300_000,
        price_lbp: 5_400_000,
        paid_usd: 0,
        paid_lbp: 0,
      },
    ]);
  });

  it("passes the typed name and phone to the checkout", async () => {
    render(<Maintenance />);
    await waitFor(() =>
      expect(screen.getByText("iPhone 13 Pro Max")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("iPhone 13 Pro Max").closest("button")!);

    fireEvent.change(screen.getByLabelText("Client Name"), {
      target: { value: "Hassan Zein" },
    });
    fireEvent.change(screen.getByLabelText("Phone Number"), {
      target: { value: "76998877" },
    });
    fireEvent.click(screen.getByText("Proceed to Checkout"));
    await screen.findByTestId("mock-checkout-modal");

    expect(lastInitialCustomer).toEqual({
      name: "Hassan Zein",
      phone: "76998877",
    });
  });

  it("a reopened job's untouched stored phone is still not re-sent (LIRA-263)", async () => {
    mockApi.getMaintenanceJobs.mockResolvedValue([
      {
        id: 2,
        device_name: "Galaxy A55",
        issue_description: "Screen",
        status: "Ready",
        currency: "USD",
        cost_usd: 10,
        price_usd: 40,
        paid_usd: 0,
        paid_lbp: 0,
        client_id: 7,
        client_name: "Rami Haddad",
        // Free text another module stored on the client — the save schema
        // refuses it, so an untouched phone must go out blank.
        client_phone: "03/123456",
      },
    ]);
    render(<Maintenance />);
    await waitFor(() =>
      expect(screen.getByText("Galaxy A55")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Galaxy A55").closest("button")!);
    fireEvent.click(screen.getByText("Proceed to Checkout"));
    fireEvent.click(await screen.findByText("Mock Complete"));

    await waitFor(() =>
      expect(mockApi.saveMaintenanceJob).toHaveBeenCalledTimes(1),
    );
    const payload = mockApi.saveMaintenanceJob.mock.calls[0][0];
    expect(payload.client_name).toBe("Rami Haddad");
    expect(payload.client_phone).toBe("");
    expect(() => saveMaintenanceJobSchema.parse(payload)).not.toThrow();
  });

  it("in a customer session the checkout fills itself (no seed passed)", async () => {
    mockActiveSession = {
      id: 97,
      customer_name: "Samir Aoun",
      customer_phone: "70998811",
    };
    render(<Maintenance />);
    await waitFor(() =>
      expect(screen.getByText("iPhone 13 Pro Max")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("iPhone 13 Pro Max").closest("button")!);
    fireEvent.click(screen.getByText("Proceed to Checkout"));
    await screen.findByTestId("mock-checkout-modal");
    expect(lastInitialCustomer).toBeUndefined();
  });
});
