/** @jest-environment jsdom */
/**
 * CheckoutModal — no "For Partner" during a customer session.
 *
 * Owner rule 2026-10-16: a customer session never has partner sales. While a
 * session is open the For Partner toggle is not offered, and a For Partner
 * that is ON — restored from a draft, or left on when the session started —
 * is turned OFF, so the sale can never go out as a partner order.
 *
 * Rule 25: the `useApi` mock returns ONE stable object; the session mock is
 * one module-level object whose `activeSession` the tests flip.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import CheckoutModal, { type CheckoutDraftData } from "../CheckoutModal";

const mockApi = {
  getClients: jest.fn().mockResolvedValue([]),
  getAllSettings: jest.fn().mockResolvedValue([]),
  getRates: jest.fn().mockResolvedValue([]),
  partners: {
    getAll: jest
      .fn()
      .mockResolvedValue([
        { id: 5, name: "Ziad", system_association: null, is_active: 1 },
      ]),
  },
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return { ...actual, useApi: () => mockApi };
});

const mockSession: { activeSession: { id: number } | null } = {
  activeSession: null,
};
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => mockSession,
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

const PARTNER_DRAFT: CheckoutDraftData = {
  selectedClient: null,
  clientSearchInput: "",
  clientSearchSecondary: "",
  discount: 0,
  paidUSD: 0,
  paidLBP: 0,
  changeGivenUSD: 0,
  changeGivenLBP: 0,
  exchangeRate: 90_000,
  forPartner: true,
  selectedPartnerId: 5,
};

function modal(props: Partial<ComponentProps<typeof CheckoutModal>> = {}) {
  return (
    <CheckoutModal
      totalAmount={6}
      currency="USD"
      allowForPartner={true}
      onComplete={jest.fn().mockResolvedValue(undefined)}
      onSaveDraft={jest.fn().mockResolvedValue(undefined)}
      {...props}
    />
  );
}

describe("CheckoutModal — no For Partner during a customer session", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession.activeSession = null;
  });

  it("guard: with no session the For Partner toggle is offered", async () => {
    render(modal());
    expect(
      await screen.findByTestId("checkout-for-partner-toggle"),
    ).toBeInTheDocument();
  });

  it("session open: the For Partner toggle is not rendered", async () => {
    mockSession.activeSession = { id: 1 };
    render(modal());
    await screen.findByText("Complete Sale");
    expect(
      screen.queryByTestId("checkout-for-partner-toggle"),
    ).not.toBeInTheDocument();
  });

  it("session open + a draft restored with For Partner ON: it is turned off (no partner notice)", async () => {
    mockSession.activeSession = { id: 1 };
    render(modal({ draftData: PARTNER_DRAFT }));
    await screen.findByText("Complete Sale");
    await waitFor(() =>
      expect(
        screen.queryByTestId("checkout-partner-no-payment-notice"),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("checkout-for-partner-toggle"),
    ).not.toBeInTheDocument();
  });

  it("For Partner ON, then a session opens: it is turned OFF, and stays off when the session ends", async () => {
    const { rerender } = render(modal());
    fireEvent.click(await screen.findByTestId("checkout-for-partner-toggle"));
    expect(
      await screen.findByTestId("checkout-partner-no-payment-notice"),
    ).toBeInTheDocument();

    mockSession.activeSession = { id: 1 };
    rerender(modal());
    await waitFor(() =>
      expect(
        screen.queryByTestId("checkout-partner-no-payment-notice"),
      ).not.toBeInTheDocument(),
    );

    mockSession.activeSession = null;
    rerender(modal());
    expect(screen.getByTestId("checkout-for-partner-toggle")).not.toBeChecked();
  });
});
