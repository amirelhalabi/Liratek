/** @jest-environment jsdom */
/**
 * CheckoutModal — `initialCustomer` seeds the Customer fields as typed text
 * (shop-day test 2026-10-16, CLAUDE.md rule 11).
 *
 * Maintenance hands the job's typed name + phone to the checkout. They must
 * show in the two Customer fields and reach the payload, WITHOUT turning
 * into a "selected client": a selected chargeable client switches the first
 * payment line to Customer Account, and the customer here pays cash.
 *
 * The REAL MultiPaymentInput renders. Rule 25: one stable `useApi` object.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import CheckoutModal from "../CheckoutModal";

type OnComplete = ComponentProps<typeof CheckoutModal>["onComplete"];
type PaymentData = Parameters<OnComplete>[0];

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
    methods: mockMethods,
    drawerAffectingMethods: mockMethods.filter((m) => m.affects_drawer === 1),
    allMethods: mockMethods,
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89_500, buyRate: 89_000, isLoading: false }),
}));

jest.mock("@/hooks/useShopName", () => ({
  useShopInfo: () => ({ name: "Shop", phone: "", location: "", logo: "" }),
}));

describe("CheckoutModal — initialCustomer", () => {
  it("shows the name and phone, keeps Cash, and sends them on Complete", async () => {
    const onComplete = jest.fn<ReturnType<OnComplete>, [PaymentData]>(() =>
      Promise.resolve(),
    );
    render(
      <CheckoutModal
        totalAmount={5_400_000}
        currency="LBP"
        initialCustomer={{ name: "Hassan Zein", phone: "76998877" }}
        onComplete={onComplete}
        onSaveDraft={jest.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByTestId("client-autocomplete-field")).toHaveValue(
      "Hassan Zein",
    );
    expect(screen.getByPlaceholderText("Enter Phone Number...")).toHaveValue(
      "76998877",
    );

    const method = await waitFor(() => {
      const el = document.querySelector<HTMLSelectElement>(
        'select[data-testid^="payment-method-"]',
      );
      if (!el) throw new Error("no payment-method select rendered");
      return el;
    });
    expect(method.value).toBe("CASH");

    fireEvent.click(screen.getByText("Complete Sale"));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    const p = onComplete.mock.calls[0][0];
    expect(p.client_name).toBe("Hassan Zein");
    expect(p.client_phone).toBe("76998877");
  });

  it("phone only: the phone goes in the search field", () => {
    render(
      <CheckoutModal
        totalAmount={20}
        initialCustomer={{ name: "", phone: "70998811" }}
        onComplete={jest.fn().mockResolvedValue(undefined)}
        onSaveDraft={jest.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByTestId("client-autocomplete-field")).toHaveValue(
      "70998811",
    );
  });
});
