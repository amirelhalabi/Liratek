/** @jest-environment jsdom */
/**
 * CheckoutModal — one Discount line in the payment box (LIRA-318).
 *
 * Owner 2026-10-13: the POS / Maintenance checkout discount moves out of the
 * "Order Summary" panel and into the payment box, under "Total Amount",
 * through MultiPaymentInput's `discountRow` slot. The modal still owns the
 * value, the `maxDiscount` cap and the payload (`discount`, `final_amount`);
 * typing above the cap now says so ("Capped to max (…)") instead of clamping
 * silently. A partner sale has no payment box, so its discount field stays
 * in the order summary.
 *
 * The REAL MultiPaymentInput renders (no `@liratek/ui` component mock).
 * Rule 25: the `useApi` mock returns ONE stable object.
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import CheckoutModal, { type CheckoutDraftData } from "../CheckoutModal";

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

function draft(
  discount: number,
  extra: Partial<CheckoutDraftData> = {},
): CheckoutDraftData {
  return {
    selectedClient: null,
    clientSearchInput: "",
    clientSearchSecondary: "",
    discount,
    paidUSD: 0,
    paidLBP: 0,
    changeGivenUSD: 0,
    changeGivenLBP: 0,
    exchangeRate: 90_000,
    ...extra,
  };
}

function renderModal(
  props: Partial<ComponentProps<typeof CheckoutModal>> = {},
) {
  const onComplete = jest.fn<ReturnType<OnComplete>, [PaymentData]>(() =>
    Promise.resolve(),
  );
  render(
    <CheckoutModal
      totalAmount={100}
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

describe("CheckoutModal — Discount line in the payment box (LIRA-318)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("the discount field sits inside the payment box, not in the order summary", async () => {
    renderModal();
    const box = await screen.findByTestId("payment-summary");
    expect(
      within(box).getByTestId("checkout-discount-input"),
    ).toBeInTheDocument();
    // Exactly one discount field on the page.
    expect(screen.getAllByTestId("checkout-discount-input")).toHaveLength(1);
  });

  it("typing above maxDiscount caps the value and says so", async () => {
    renderModal({ maxDiscount: 10 });
    await screen.findByTestId("checkout-discount-input");
    expect(screen.queryByText(/Capped to max/)).not.toBeInTheDocument();
    fireEvent.change(discountInput(), { target: { value: "15" } });
    expect(discountInput().value).toBe("10");
    expect(screen.getByText("Capped to max ($10.00)")).toBeInTheDocument();
    // Back under the cap: the note goes away.
    fireEvent.change(discountInput(), { target: { value: "5" } });
    expect(screen.queryByText(/Capped to max/)).not.toBeInTheDocument();
  });

  it("a draft with a $20 discount restores into the payment-box line; Total Amount is gross, the payment pre-fills the net $80", async () => {
    renderModal({ draftData: draft(20) });
    const box = await screen.findByTestId("payment-summary");
    expect(
      (within(box).getByTestId("checkout-discount-input") as HTMLInputElement)
        .value,
    ).toBe("20");
    expect(within(box).getByTestId("after-page-discount")).toHaveTextContent(
      "$80.00",
    );
    await waitFor(() => expect(paymentAmount()?.value).toBe("80"));
  });

  it("payload is unchanged: discount 20 → discount 20, final_amount 80", async () => {
    const onComplete = renderModal();
    await screen.findByTestId("checkout-discount-input");
    fireEvent.change(discountInput(), { target: { value: "20" } });
    await waitFor(() => expect(paymentAmount()?.value).toBe("80"));
    fireEvent.click(screen.getByText("Complete Sale"));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    const p = onComplete.mock.calls[0][0];
    expect(p.discount).toBe(20);
    expect(p.final_amount).toBe(80);
  });

  it("partner sale (no payment box): the discount field is still offered, once", async () => {
    renderModal({
      allowForPartner: true,
      draftData: draft(5, { forPartner: true }),
    });
    await screen.findByTestId("checkout-partner-no-payment-notice");
    expect(screen.queryByTestId("payment-summary")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("checkout-discount-input")).toHaveLength(1);
    expect(discountInput().value).toBe("5");
  });
});
