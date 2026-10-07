/**
 * CheckoutModal — "where does this sale's money go" line (production test
 * 2026-10-07).
 *
 * The checkout used to say "This sale will be recorded in: DRAWER B" for
 * every sale — a hard-coded label (`DEFAULT_DRAWER_NAME`) — while the
 * server posts each payment line to its payment method's configured drawer
 * (`paymentMethodToDrawerName`, which reads `payment_methods.drawer_name`)
 * and cash change always out of General. The line must name the drawer(s)
 * the money actually lands in, derived from the SAME payment-method rows,
 * and disappear when nothing moves a drawer.
 *
 * Rule 17: written before the fix; the red run is in the task report.
 * Rule 25: the `useApi` mock returns ONE stable object.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import CheckoutModal from "../CheckoutModal";

type MockLine = { method: string; currencyCode: string; amount: number };

const mockLinesToSend: { lines: MockLine[]; returns: MockLine[] } = {
  lines: [],
  returns: [],
};

const mockApi = {
  getClients: jest.fn().mockResolvedValue([]),
  getAllSettings: jest.fn().mockResolvedValue([]),
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
    MultiPaymentInput: (props: {
      onChange: (lines: MockLine[]) => void;
      onReturnChange?: (lines: MockLine[]) => void;
    }) => (
      <div data-testid="mock-multi-payment-input">
        <button
          onClick={() => {
            props.onChange(mockLinesToSend.lines);
            props.onReturnChange?.(mockLinesToSend.returns);
          }}
        >
          Enter Lines
        </button>
      </div>
    ),
  };
});

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({ activeSession: null }),
}));

jest.mock("@/hooks/useDynamicExchangeRate", () => ({
  useDynamicExchangeRate: () => ({
    rate: 90000,
    rateInfo: {},
    isBaseCurrency: true,
  }),
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
    code: "WHISH",
    label: "Whish",
    drawer_name: "Whish_App",
    affects_drawer: 1,
    is_active: 1,
  },
  {
    id: 3,
    code: "CUSTOMER_ACCOUNT",
    label: "Account",
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

async function renderWithLines(lines: MockLine[], returns: MockLine[] = []) {
  mockLinesToSend.lines = lines;
  mockLinesToSend.returns = returns;
  render(
    <CheckoutModal
      totalAmount={100}
      currency="USD"
      onComplete={jest.fn().mockResolvedValue(undefined)}
      onSaveDraft={jest.fn().mockResolvedValue(undefined)}
    />,
  );
  await screen.findByTestId("mock-multi-payment-input");
  fireEvent.click(screen.getByText("Enter Lines"));
}

describe("CheckoutModal — drawer the sale's money goes to", () => {
  it("a cash sale names General (the cash method's drawer), never DRAWER B", async () => {
    await renderWithLines([{ method: "CASH", currencyCode: "USD", amount: 100 }]);
    const line = screen.getByTestId("checkout-drawer-destination");
    expect(line).toHaveTextContent("Cash → General");
    expect(screen.queryByText(/DRAWER B/i)).not.toBeInTheDocument();
  });

  it("a split cash + Whish sale names both drawers", async () => {
    await renderWithLines([
      { method: "CASH", currencyCode: "USD", amount: 60 },
      { method: "WHISH", currencyCode: "USD", amount: 40 },
    ]);
    const line = screen.getByTestId("checkout-drawer-destination");
    expect(line).toHaveTextContent("Cash → General");
    expect(line).toHaveTextContent("Whish → Whish App");
  });

  it("cash change handed back from a Whish-only payment names General for the change", async () => {
    await renderWithLines(
      [{ method: "WHISH", currencyCode: "USD", amount: 110 }],
      [{ method: "CASH", currencyCode: "USD", amount: 10 }],
    );
    const line = screen.getByTestId("checkout-drawer-destination");
    expect(line).toHaveTextContent("Whish → Whish App");
    expect(line).toHaveTextContent("change paid from General");
  });

  it("a sale charged entirely to the customer's account names no drawer", async () => {
    await renderWithLines([
      { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 100 },
    ]);
    expect(
      screen.queryByTestId("checkout-drawer-destination"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/DRAWER B/i)).not.toBeInTheDocument();
  });
});
