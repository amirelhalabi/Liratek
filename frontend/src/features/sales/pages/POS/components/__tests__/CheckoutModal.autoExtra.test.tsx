/** @jest-environment jsdom */
/**
 * CheckoutModal — round-up autofill of "+ Extra" (LIRA-334, owner
 * 2026-10-18). A $102.90 sale paid with $103.00: the line switches to
 * "+ Extra" with 0.10 filled in (the shop keeps it as an extra charge). The
 * cashier clears it to give the change back; it does not refill until the
 * payment changes. Never with a discount typed, above $5, or for a
 * session-basket job. Payload names from the schema (rule 24).
 *
 * Rule 17: run against CheckoutModal before the autofill — the autofill
 * cases failed (no extra side, extra_usd undefined); the guard cases passed.
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
      totalAmount={102.9}
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
    items: [{ product_id: 1, quantity: 1, price: 102.9 }],
  });
}

async function complete(onComplete: ReturnType<typeof renderModal>) {
  fireEvent.click(screen.getByText("Complete Sale"));
  await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  return onComplete.mock.calls[0][0];
}

async function pay(amount: string) {
  const amt = paymentAmount();
  if (!amt) throw new Error("no payment-amount input rendered");
  fireEvent.change(amt, { target: { value: amount } });
}

describe("CheckoutModal — round-up fills + Extra (LIRA-334)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("$103 on $102.90 → + Extra 0.10, no change box, payload extra_usd 0.1", async () => {
    const onComplete = renderModal();
    const box = await screen.findByTestId("payment-summary");
    await pay("103");
    await waitFor(() =>
      expect(within(box).getByTestId("discount-mode-extra")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(lineInput().value).toBe("0.1");
    expect(screen.queryByTestId("return-change")).not.toBeInTheDocument();
    const parsed = parse(await complete(onComplete));
    expect(parsed.extra_usd).toBeCloseTo(0.1, 2);
    expect(parsed.final_amount).toBe(102.9);
    expect(parsed.payment_usd).toBe(103);
  });

  it("clearing the extra gives the change box back and does not refill", async () => {
    const onComplete = renderModal();
    await screen.findByTestId("payment-summary");
    await pay("103");
    await waitFor(() => expect(lineInput().value).toBe("0.1"));
    fireEvent.change(lineInput(), { target: { value: "" } });
    expect(await screen.findByTestId("return-change")).toBeInTheDocument();
    expect(lineInput().value).toBe("");
    const p = await complete(onComplete);
    expect(parse(p).extra_usd ?? 0).toBe(0);
  });

  it("a discount already typed → nothing is filled in", async () => {
    renderModal();
    await screen.findByTestId("payment-summary");
    fireEvent.change(lineInput(), { target: { value: "0.9" } });
    await pay("103");
    expect(screen.getByTestId("discount-mode-discount")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await screen.findByTestId("return-change")).toBeInTheDocument();
  });

  it("above the $5 cap → nothing is filled in, change box as today", async () => {
    renderModal();
    await screen.findByTestId("payment-summary");
    await pay("110");
    expect(await screen.findByTestId("return-change")).toBeInTheDocument();
    expect(screen.getByTestId("discount-mode-discount")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("session-basket job → no autofill", async () => {
    const onComplete = renderModal({ addsToSessionBasket: true });
    await screen.findByTestId("payment-summary");
    await pay("103");
    const p = await complete(onComplete);
    expect("extra_usd" in p).toBe(false);
  });
});
