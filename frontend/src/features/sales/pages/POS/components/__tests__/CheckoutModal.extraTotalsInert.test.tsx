/**
 * CheckoutModal — `extraTotals` inertness guard (LIRA-176 phase 8b, item 9).
 *
 * `extraTotals` was added for maintenance's USD parts riding alongside an
 * LBP-priced job (LIRA-176 7a), but CheckoutModal is SHARED with the point
 * of sale and every other module that renders it — this is a regression
 * guard for THOSE callers, not for maintenance. When `extraTotals` is
 * absent, an empty array, or contains only zero-amount entries, the modal
 * must behave EXACTLY as it did before the prop existed:
 *   - the summary panel renders the single "Net Total" line (never the
 *     per-currency "Net Total (<currency>)" branch `hasMultipleCurrencyTotals`
 *     switches to), and
 *   - the payload handed to `onComplete` is identical across all three
 *     "no extra totals" shapes.
 *
 * `MultiPaymentInput` is stubbed out (it has its own extensive test surface
 * elsewhere) with a minimal double that pays the primary total in full via
 * one CASH leg, so `handleComplete`'s payment-completeness gate passes and
 * `getPaymentData()` actually reaches `onComplete`.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Money } from "@liratek/ui";
import CheckoutModal, { type PaymentData } from "../CheckoutModal";

const mockGetClients = jest.fn();
const mockMultiPaymentPropsLog: Array<{ totals: Money[] }> = [];

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => ({
      getClients: mockGetClients,
      getAllSettings: jest.fn().mockResolvedValue([]),
    }),
    MultiPaymentInput: (props: {
      totals: Money[];
      onChange: (
        lines: { method: string; currencyCode: string; amount: number }[],
      ) => void;
    }) => {
      mockMultiPaymentPropsLog.push({ totals: props.totals });
      return (
        <div data-testid="mock-multi-payment-input">
          <button
            onClick={() =>
              props.onChange([
                {
                  method: "CASH",
                  currencyCode: props.totals[0]?.currency ?? "USD",
                  amount: props.totals[0]?.amount ?? 0,
                },
              ])
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

jest.mock("@/hooks/useDynamicExchangeRate", () => ({
  useDynamicExchangeRate: () => ({
    rate: 90000,
    rateInfo: {},
    isBaseCurrency: true,
  }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [],
    drawerAffectingMethods: [],
    allMethods: [
      { id: 1, code: "CASH", label: "Cash", is_active: 1 },
      { id: 2, code: "CUSTOMER_ACCOUNT", label: "Account", is_active: 1 },
    ],
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useShopName", () => ({
  useShopInfo: () => ({ name: "Shop", phone: "", location: "", logo: "" }),
}));

function renderModal(extraTotals: Money[] | undefined) {
  const onComplete = jest.fn().mockResolvedValue(undefined);
  const onSaveDraft = jest.fn().mockResolvedValue(undefined);
  const utils = render(
    <CheckoutModal
      totalAmount={100}
      currency="USD"
      extraTotals={extraTotals}
      onComplete={onComplete}
      onSaveDraft={onSaveDraft}
    />,
  );
  return { ...utils, onComplete, onSaveDraft };
}

async function payFullAndCapture(
  extraTotals: Money[] | undefined,
): Promise<PaymentData> {
  const { onComplete, unmount } = renderModal(extraTotals);
  await screen.findByTestId("mock-multi-payment-input");
  fireEvent.click(screen.getByText("Pay Full"));
  fireEvent.click(screen.getByTestId("checkout-complete-btn"));
  await waitFor(() => {
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
  const payload = onComplete.mock.calls[0][0] as PaymentData;
  unmount();
  return payload;
}

describe("CheckoutModal — extraTotals inertness", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMultiPaymentPropsLog.length = 0;
    mockGetClients.mockResolvedValue([]);
  });

  it("renders the single 'Net Total' line when extraTotals is absent", async () => {
    renderModal(undefined);
    expect(await screen.findByText("Net Total")).toBeInTheDocument();
    expect(screen.queryByText(/Net Total \(/)).not.toBeInTheDocument();
  });

  it("renders the single 'Net Total' line when extraTotals is an empty array", async () => {
    renderModal([]);
    expect(await screen.findByText("Net Total")).toBeInTheDocument();
    expect(screen.queryByText(/Net Total \(/)).not.toBeInTheDocument();
  });

  it("renders the single 'Net Total' line when extraTotals contains only a zero-amount entry", async () => {
    renderModal([{ amount: 0, currency: "LBP" }]);
    expect(await screen.findByText("Net Total")).toBeInTheDocument();
    expect(screen.queryByText(/Net Total \(/)).not.toBeInTheDocument();
  });

  it("emits the SAME onComplete payload whether extraTotals is absent, [], or all-zero", async () => {
    const withUndefined = await payFullAndCapture(undefined);
    const withEmpty = await payFullAndCapture([]);
    const withZero = await payFullAndCapture([{ amount: 0, currency: "LBP" }]);

    expect(withUndefined).toEqual(withEmpty);
    expect(withUndefined).toEqual(withZero);

    // Sanity: this is genuinely the unmodified single-currency checkout
    // payload, not three empty objects passing a vacuous equality check.
    expect(withUndefined.total_amount).toBe(100);
    expect(withUndefined.final_amount).toBe(100);
    expect(withUndefined.currency).toBe("USD");
    expect(withUndefined.payment_usd).toBe(100);
    expect(withUndefined.payment_lbp).toBe(0);
    expect(withUndefined.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 100 },
    ]);
  });
});
