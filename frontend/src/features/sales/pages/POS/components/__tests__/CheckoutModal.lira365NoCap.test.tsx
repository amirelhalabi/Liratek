/** @jest-environment jsdom */
/**
 * LIRA-365 US4 (T029) — POS keeps its uncapped discount (owner 2026-10-31:
 * the $5 / 450,000 LBP cap is for Exchange, OMT/Whish system send and
 * voucher sale only). POS renders CheckoutModal with no `maxDiscount`, so a
 * $30 discount on a $300 sale goes through whole.
 *
 * Not a failing-first guard: it pins existing behaviour so the LIRA-365 cap
 * never leaks into POS.
 *
 * The REAL MultiPaymentInput renders. Rule 25: one stable `useApi` object.
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import CheckoutModal from "../CheckoutModal";

type OnComplete = ComponentProps<typeof CheckoutModal>["onComplete"];
type PaymentData = Parameters<OnComplete>[0];

const mockApi = {
  getClients: jest.fn().mockResolvedValue([]),
  getAllSettings: jest.fn().mockResolvedValue([]),
  getRates: jest.fn().mockResolvedValue([]),
  partners: { getAll: jest.fn().mockResolvedValue([]) },
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return { ...actual, useApi: () => mockApi };
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

function renderModal(
  props: Partial<ComponentProps<typeof CheckoutModal>> = {},
) {
  const onComplete = jest.fn<ReturnType<OnComplete>, [PaymentData]>(() =>
    Promise.resolve(),
  );
  render(
    <CheckoutModal
      totalAmount={300}
      currency="USD"
      onComplete={onComplete}
      onSaveDraft={jest.fn().mockResolvedValue(undefined)}
      {...props}
    />,
  );
  return onComplete;
}

const discountInput = () =>
  screen.getByTestId("checkout-discount-input") as HTMLInputElement;

const paymentAmount = () =>
  document.querySelector<HTMLInputElement>('[data-testid^="payment-amount-"]');

describe("LIRA-365 US4 — POS discount stays uncapped", () => {
  beforeEach(() => jest.clearAllMocks());

  it("$30 discount on a $300 sale (as POS renders it, no maxDiscount) → discount 30, final 270", async () => {
    const onComplete = renderModal();
    await screen.findByTestId("checkout-discount-input");
    fireEvent.change(discountInput(), { target: { value: "30" } });
    expect(discountInput().value).toBe("30");
    expect(screen.queryByText(/Capped to max/)).not.toBeInTheDocument();
    await waitFor(() => expect(paymentAmount()?.value).toBe("270"));
    fireEvent.click(screen.getByText("Complete Sale"));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    const p = onComplete.mock.calls[0][0];
    expect(p.discount).toBe(30);
    expect(p.final_amount).toBe(270);
  });
});
