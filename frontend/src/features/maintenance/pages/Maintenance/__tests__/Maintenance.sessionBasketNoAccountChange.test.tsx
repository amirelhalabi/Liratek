/** @jest-environment jsdom */
/**
 * Maintenance checkout in an active customer session — no "change to the
 * client's account" (LIRA-318 review finding).
 *
 * With a session open, Maintenance's checkout does not save the job: it adds
 * it to the session basket (`addToCart`), and the session checkout drops
 * OUT legs (`deferPayment`). So the change box's "Account" button would
 * promise a credit that is never booked. In that path the checkout must not
 * offer it (no `unreturnedChangeTo`), and the basket item must never carry a
 * CUSTOMER_ACCOUNT leg.
 *
 * The REAL CheckoutModal and MultiPaymentInput render; the client comes from
 * the session (name + phone → chargeable). Rule 25: ONE stable api object.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Maintenance from "../index";

const mockAddToCart = jest.fn();
const mockSession = {
  activeSession: {
    id: 7,
    customer_name: "Rami Haddad",
    customer_phone: "70123456",
  },
  addToCart: mockAddToCart,
};

const mockApi = {
  getMaintenanceJobs: jest.fn(),
  saveMaintenanceJob: jest.fn(),
  deleteMaintenanceJob: jest.fn(),
  getMaintenanceStatusHistory: jest.fn().mockResolvedValue([]),
  getProducts: jest.fn().mockResolvedValue([]),
  getAllSettings: jest.fn().mockResolvedValue([]),
  getClients: jest.fn().mockResolvedValue([]),
  getRates: jest.fn().mockResolvedValue([]),
  partners: { getAll: jest.fn().mockResolvedValue([]) },
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => mockSession,
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "staff", role: "staff" } }),
}));

const mockMethods = [
  {
    id: 1,
    code: "CASH",
    label: "Cash",
    drawer_name: "General",
    affects_drawer: 1,
    is_active: 1,
  },
  {
    id: 2,
    code: "CUSTOMER_ACCOUNT",
    label: "Customer Account",
    drawer_name: "General",
    affects_drawer: 0,
    is_active: 1,
  },
];

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: mockMethods,
    drawerAffectingMethods: mockMethods.filter((m) => m.affects_drawer === 1),
    allMethods: mockMethods,
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useShopName", () => ({
  useShopInfo: () => ({ name: "Shop", phone: "", location: "", logo: "" }),
}));

describe("Maintenance checkout in a session basket — no Account change (LIRA-318)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getMaintenanceJobs.mockResolvedValue([
      {
        id: 1,
        device_name: "Session Job",
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

  it("$50 job, $60 cash: the change box offers no Account, and the basket item has no CUSTOMER_ACCOUNT leg", async () => {
    render(<Maintenance />);
    await screen.findByText("Session Job");
    fireEvent.click(screen.getByText("Session Job").closest("button")!);
    fireEvent.click(screen.getByText("Proceed to Checkout"));

    const amount = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      );
      if (!el) throw new Error("no payment-amount input rendered");
      return el;
    });
    const method = document.querySelector<HTMLSelectElement>(
      'select[data-testid^="payment-method-"]',
    );
    if (method && method.value !== "CASH") {
      fireEvent.change(method, { target: { value: "CASH" } });
    }
    fireEvent.change(amount, { target: { value: "60" } });
    await screen.findByTestId("return-change");

    expect(
      screen.queryByTestId("change-destination-account"),
    ).not.toBeInTheDocument();
    // Owner 2026-10-13: no Keep either — the session save ignores kept
    // change, so the box must not promise "Keeping $10 as profit".
    expect(screen.queryByTestId("change-keep-all")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Complete Sale"));
    await waitFor(() => expect(mockAddToCart).toHaveBeenCalledTimes(1));
    expect(mockApi.saveMaintenanceJob).not.toHaveBeenCalled();
    const item = mockAddToCart.mock.calls[0][0] as {
      formData: { payments?: { method: string }[] };
    };
    expect(
      (item.formData.payments ?? []).some(
        (l) => l.method === "CUSTOMER_ACCOUNT",
      ),
    ).toBe(false);
  });
});
