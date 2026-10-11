/** @jest-environment jsdom */
/**
 * CheckoutModal — Waive respects the discount ceiling (LIRA-310, T008).
 *
 * The checkout's Waive goes into the modal's own Discount. When the caller
 * caps that discount (`maxDiscount` — Maintenance passes the labour price),
 * Waive must never push the discount past the cap:
 *  - room left = maxDiscount − discount; a gap bigger than the room hides
 *    Waive (owner decision 2026-10-11: hide, never partially waive);
 *  - a gap that fits sets the discount to exactly the cap and clears
 *    Remaining.
 *
 * The REAL MultiPaymentInput renders here (no `@liratek/ui` component mock)
 * so the button the cashier sees is the one under test.
 * Rule 25: the `useApi` mock returns ONE stable object.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import CheckoutModal from "../CheckoutModal";

const mockApi = {
  getClients: jest.fn().mockResolvedValue([]),
  getAllSettings: jest.fn().mockResolvedValue([]),
  getRates: jest.fn().mockResolvedValue([]),
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

function renderModal() {
  return render(
    <CheckoutModal
      totalAmount={100}
      currency="USD"
      maxDiscount={10}
      onComplete={jest.fn().mockResolvedValue(undefined)}
      onSaveDraft={jest.fn().mockResolvedValue(undefined)}
    />,
  );
}

function setDiscount(value: string) {
  fireEvent.change(screen.getByTestId("checkout-discount-input"), {
    target: { value },
  });
}

function pay(amount: string) {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  if (!input) throw new Error("no payment-amount input rendered");
  fireEvent.change(input, { target: { value: amount } });
}

const waive = () => screen.queryByTestId("waive-remaining");

describe("CheckoutModal — Waive and maxDiscount (LIRA-310)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("hides Waive when the gap is more than the discount room left ($8 of $10 used, $3 short)", async () => {
    renderModal();
    await screen.findByTestId("checkout-discount-input");
    setDiscount("8");
    pay("89"); // net 92 → $3 short, room $2
    expect(screen.getByTestId("remaining-row")).toBeInTheDocument();
    expect(waive()).not.toBeInTheDocument();
  });

  it("a gap that fits sets the discount to exactly the cap ($8 + $2 = $10)", async () => {
    renderModal();
    await screen.findByTestId("checkout-discount-input");
    setDiscount("8");
    pay("90"); // net 92 → $2 short, room $2
    fireEvent.click(waive()!);
    expect(
      (screen.getByTestId("checkout-discount-input") as HTMLInputElement).value,
    ).toBe("10");
    expect(screen.queryByTestId("remaining-row")).not.toBeInTheDocument();
  });
});
