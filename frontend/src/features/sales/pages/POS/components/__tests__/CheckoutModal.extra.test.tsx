/** @jest-environment jsdom */
/**
 * CheckoutModal — "+ Extra" on the payment box's Discount line (LIRA-319).
 *
 * Owner 2026-10-13: the POS cashier can charge a little more than the price
 * ($6 item, customer pays $7). The line's "− Discount | + Extra" switch picks
 * the side; the extra is sent as `extra_usd` (the sale's currency), the
 * payment line follows the new total, and a sale never carries a discount
 * and an extra together. Not offered on a partner sale or for a job that
 * goes into a session basket (the session checkout takes the extra there),
 * and only when the host opts in (`allowExtraCharge` — POS does).
 *
 * Payload names come from the schema (rule 24): every payload is parsed
 * through core's `saleProcessSchema` and the PARSED output is asserted, so a
 * key the schema does not know (Zod strips it) fails here.
 * Not proven failing-first: the props are new (rule 17).
 *
 * The REAL MultiPaymentInput renders. Rule 25: the `useApi` mock returns ONE
 * stable object.
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { saleProcessSchema } from "@liratek/core";
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
      totalAmount={6}
      currency="USD"
      allowExtraCharge={true}
      onComplete={onComplete}
      onSaveDraft={jest.fn().mockResolvedValue(undefined)}
      {...props}
    />,
  );
  return onComplete;
}

const lineInput = () =>
  screen.getByTestId("checkout-discount-input") as HTMLInputElement;

const paymentAmount = () =>
  document.querySelector<HTMLInputElement>('[data-testid^="payment-amount-"]');

/** The payload as the server's shared schema reads it (items are added by
 *  the POS page, not the modal). */
function parse(p: PaymentData) {
  return saleProcessSchema.parse({
    ...p,
    items: [{ product_id: 1, quantity: 1, price: 6 }],
  });
}

async function complete(onComplete: ReturnType<typeof renderModal>) {
  fireEvent.click(screen.getByText("Complete Sale"));
  await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  return onComplete.mock.calls[0][0];
}

describe("CheckoutModal — + Extra (LIRA-319)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("Extra 1 on a $6 sale → payment fills $7, After Extra $7.00, parsed payload has extra_usd 1, discount 0", async () => {
    const onComplete = renderModal();
    const box = await screen.findByTestId("payment-summary");
    fireEvent.click(within(box).getByTestId("discount-mode-extra"));
    fireEvent.change(lineInput(), { target: { value: "1" } });
    await waitFor(() => expect(paymentAmount()?.value).toBe("7"));
    expect(within(box).getByTestId("after-page-extra")).toHaveTextContent(
      "$7.00",
    );
    const parsed = parse(await complete(onComplete));
    expect(parsed.extra_usd).toBe(1);
    expect(parsed.extra_lbp).toBeUndefined();
    expect(parsed.discount).toBe(0);
    expect(parsed.total_amount).toBe(6);
    expect(parsed.final_amount).toBe(6);
    expect(parsed.payment_usd).toBe(7);
  });

  it("discount and extra are never sent together: switching sides clears the other amount", async () => {
    const onComplete = renderModal();
    await screen.findByTestId("payment-summary");
    // Discount 2 first …
    fireEvent.change(lineInput(), { target: { value: "2" } });
    await waitFor(() => expect(paymentAmount()?.value).toBe("4"));
    // … then switch to Extra: the discount is gone.
    fireEvent.click(screen.getByTestId("discount-mode-extra"));
    expect(lineInput().value).toBe("");
    fireEvent.change(lineInput(), { target: { value: "1" } });
    await waitFor(() => expect(paymentAmount()?.value).toBe("7"));
    // … and back to Discount: the extra is gone.
    fireEvent.click(screen.getByTestId("discount-mode-discount"));
    await waitFor(() => expect(paymentAmount()?.value).toBe("6"));
    const parsed = parse(await complete(onComplete));
    expect(parsed.discount).toBe(0);
    expect(parsed.extra_usd).toBeUndefined();
  });

  it("an extra above the sale itself is capped and says so", async () => {
    renderModal();
    await screen.findByTestId("payment-summary");
    fireEvent.click(screen.getByTestId("discount-mode-extra"));
    fireEvent.change(lineInput(), { target: { value: "9" } });
    expect(lineInput().value).toBe("6");
    expect(screen.getByText("Capped to max ($6.00)")).toBeInTheDocument();
  });

  it("control: the same small underpay on the Discount side DOES offer Waive", async () => {
    renderModal();
    await screen.findByTestId("payment-summary");
    const amt = paymentAmount();
    if (!amt) throw new Error("no payment-amount input rendered");
    fireEvent.change(amt, { target: { value: "5.9" } });
    expect(await screen.findByTestId("waive-remaining")).toBeInTheDocument();
  });

  it("Waive (a discount) is not offered on the Extra side", async () => {
    renderModal();
    await screen.findByTestId("payment-summary");
    fireEvent.click(screen.getByTestId("discount-mode-extra"));
    fireEvent.change(lineInput(), { target: { value: "1" } });
    // Underpay by a small amount — Waive would normally appear.
    const amt = paymentAmount();
    if (!amt) throw new Error("no payment-amount input rendered");
    fireEvent.change(amt, { target: { value: "6.9" } });
    expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
  });

  it("a draft with an extra restores on the Extra side", async () => {
    renderModal({ draftData: draft(0, { extra: 1 }) });
    const box = await screen.findByTestId("payment-summary");
    expect(within(box).getByTestId("discount-mode-extra")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(lineInput().value).toBe("1");
    await waitFor(() => expect(paymentAmount()?.value).toBe("7"));
  });

  it("session-basket checkout: no + Extra switch, and no extra_* in the payload", async () => {
    const onComplete = renderModal({ addsToSessionBasket: true });
    await screen.findByTestId("payment-summary");
    expect(screen.queryByTestId("discount-mode-extra")).not.toBeInTheDocument();
    const p = await complete(onComplete);
    expect("extra_usd" in p).toBe(false);
    expect("extra_lbp" in p).toBe(false);
  });

  it("a host that does not opt in (Maintenance) shows no switch", async () => {
    renderModal({ allowExtraCharge: false });
    await screen.findByTestId("payment-summary");
    expect(screen.queryByTestId("discount-mode-extra")).not.toBeInTheDocument();
  });

  it("partner sale: no switch and no extra_* sent", async () => {
    const onComplete = renderModal({
      allowForPartner: true,
      draftData: draft(0, { forPartner: true, selectedPartnerId: 3, extra: 1 }),
    });
    await screen.findByTestId("checkout-partner-no-payment-notice");
    expect(screen.queryByTestId("discount-mode-extra")).not.toBeInTheDocument();
    const p = await complete(onComplete);
    expect("extra_usd" in p).toBe(false);
  });
});
