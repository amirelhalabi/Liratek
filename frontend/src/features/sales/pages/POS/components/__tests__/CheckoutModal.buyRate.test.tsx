/**
 * CheckoutModal — LBP converts at the shop's BUY rate (owner decision
 * 2026-10-07, extending the 2026-07-06 "every MultiPaymentInput converts at
 * buyRate" decision that c21948f3 applied to 15+ forms but missed here).
 *
 * The checkout used `useDynamicExchangeRate({ transactionType: "SALE" })`,
 * which maps SALE to the SELL rate — so a $10 item asked 900,000 LBP at a
 * 90,000 sell rate while every other screen asked 880,000 at the 88,000 buy
 * rate. The Maintenance page reuses this modal unchanged and only forwards
 * `paymentData.exchange_rate`, so its checkout is covered by the
 * Maintenance-shaped cases below.
 *
 * Rates deliberately avoid the hooks' 89,000/89,500 fallbacks so a pass proves
 * the DB row was read. No rate hook is mocked: the real hooks read the rows.
 *
 * Rule 17: written before the fix; the red run is in the task report.
 * Rule 25: the `useApi` mock returns ONE stable object.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CheckoutModal, { type PaymentData } from "../CheckoutModal";

type Money = { amount: number; currency: string };

const RATE_ROWS = [
  {
    to_code: "LBP",
    market_rate: 89000,
    buy_rate: 88000,
    sell_rate: 90000,
    is_stronger: 0,
  },
];

const mockApi = {
  getClients: jest.fn().mockResolvedValue([]),
  getAllSettings: jest.fn().mockResolvedValue([]),
  getRates: jest.fn().mockResolvedValue(RATE_ROWS),
};

const mockRateProps: number[] = [];

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
    MultiPaymentInput: (props: {
      totals: Money[];
      exchangeRate: number;
      onChange: (
        lines: { method: string; currencyCode: string; amount: number }[],
      ) => void;
    }) => {
      mockRateProps.push(props.exchangeRate);
      return (
        <div data-testid="mock-multi-payment-input">
          <span data-testid="mpi-rate">{props.exchangeRate}</span>
          <button
            onClick={() =>
              props.onChange(
                props.totals.map((t) => ({
                  method: "CASH",
                  currencyCode: t.currency,
                  amount: t.amount,
                })),
              )
            }
          >
            Pay Full
          </button>
        </div>
      );
    },
  };
});

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({ activeSession: null }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [],
    drawerAffectingMethods: [],
    allMethods: [{ id: 1, code: "CASH", label: "Cash", is_active: 1 }],
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useShopName", () => ({
  useShopInfo: () => ({ name: "Shop", phone: "", location: "", logo: "" }),
}));

async function waitForRatesApplied() {
  await waitFor(() => expect(mockApi.getRates).toHaveBeenCalled());
  // Let the resolved rates flow into state before asserting.
  await waitFor(() =>
    expect(screen.getByTestId("mpi-rate").textContent).not.toBe("89000"),
  );
}

async function completeAndCapture(onComplete: jest.Mock): Promise<PaymentData> {
  fireEvent.click(screen.getByText("Pay Full"));
  fireEvent.click(screen.getByTestId("checkout-complete-btn"));
  await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  return onComplete.mock.calls[0][0] as PaymentData;
}

describe("CheckoutModal — LBP converts at the BUY rate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRateProps.length = 0;
    mockApi.getClients.mockResolvedValue([]);
    mockApi.getAllSettings.mockResolvedValue([]);
    mockApi.getRates.mockResolvedValue(RATE_ROWS);
  });

  it("POS: a $10 item asks 880,000 LBP and the sale is sent at the buy rate", async () => {
    const onComplete = jest.fn().mockResolvedValue(undefined);
    render(
      <CheckoutModal
        totalAmount={10}
        currency="USD"
        onComplete={onComplete}
        onSaveDraft={jest.fn().mockResolvedValue(undefined)}
      />,
    );
    await screen.findByTestId("mock-multi-payment-input");
    await waitForRatesApplied();

    expect(screen.getByTestId("mpi-rate")).toHaveTextContent("88000");
    // The "≈ LBP" line follows the rate one effect later than the payment
    // input does (customExchangeRate is re-seeded in an effect), so wait for
    // it rather than asserting in the same tick (LIRA-296 removed an unrelated
    // mount-time state update that used to hide this race).
    expect(await screen.findByText(/≈ 880,000 LBP/)).toBeInTheDocument();
    expect(screen.queryByText(/900,000/)).not.toBeInTheDocument();

    const payload = await completeAndCapture(onComplete);
    expect(payload.exchange_rate).toBe(88000);
  });

  it("Maintenance (LBP job + USD parts): payload and payment input use the buy rate", async () => {
    const onComplete = jest.fn().mockResolvedValue(undefined);
    render(
      <CheckoutModal
        allowKeepChange={true}
        totalAmount={500000}
        currency="LBP"
        extraTotals={[{ amount: 10, currency: "USD" }]}
        onComplete={onComplete}
        onSaveDraft={jest.fn().mockResolvedValue(undefined)}
      />,
    );
    await screen.findByTestId("mock-multi-payment-input");
    await waitForRatesApplied();

    expect(screen.getByTestId("mpi-rate")).toHaveTextContent("88000");
    const payload = await completeAndCapture(onComplete);
    expect(payload.exchange_rate).toBe(88000);
  });

  it("Maintenance (USD job, discount capped at labour): payload uses the buy rate", async () => {
    const onComplete = jest.fn().mockResolvedValue(undefined);
    render(
      <CheckoutModal
        allowKeepChange={true}
        totalAmount={30}
        currency="USD"
        maxDiscount={20}
        onComplete={onComplete}
        onSaveDraft={jest.fn().mockResolvedValue(undefined)}
      />,
    );
    await screen.findByTestId("mock-multi-payment-input");
    await waitForRatesApplied();

    expect(screen.getByText(/≈ 2,640,000 LBP/)).toBeInTheDocument();
    const payload = await completeAndCapture(onComplete);
    expect(payload.exchange_rate).toBe(88000);
  });
});
