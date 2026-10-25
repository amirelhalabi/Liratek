/** @jest-environment jsdom */
/**
 * CheckoutModal — change not handed back goes on the client's account
 * (owner 2026-10-13).
 *
 * The POS checkout now passes `unreturnedChangeTo="CUSTOMER_ACCOUNT"` to the
 * payment form. With a chargeable client (name + phone) the change box's
 * "Account" button puts the change on the client's account: the sale payload
 * carries the IN legs PLUS one CUSTOMER_ACCOUNT OUT leg, and cash change
 * stays on `change_given_*` only (never a CASH OUT leg — SalesRepository
 * would debit the drawer twice). Without a client there is no account: the
 * same slot is "Keep", and the change is kept as profit exactly as before
 * (no OUT leg, `kept_change_*`).
 *
 * The REAL MultiPaymentInput renders (no `@liratek/ui` component mock), so
 * the buttons under test are the ones the cashier taps. The selected client
 * is restored through `draftData` (the modal's own seed path); the $30 cash
 * is typed. Rule 25: the `useApi` mock returns ONE stable object.
 *
 * Rule 17: written AFTER the production change — not proven failing-first.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { Client } from "@liratek/ui";
import { salePaymentLegSchema } from "@liratek/core";
import CheckoutModal, { type CheckoutDraftData } from "../CheckoutModal";

type OnComplete = ComponentProps<typeof CheckoutModal>["onComplete"];
type PaymentData = Parameters<OnComplete>[0];
/** Rule 24 — leg field names come from the sale schema, not hand-typed:
 *  the expected legs are typed as the schema's output, and the captured
 *  legs are parsed through it (Zod would strip a key it does not know,
 *  e.g. a mistyped `direction`). POS forwards `payments` unchanged
 *  (`...paymentData` in handleCompleteSale) to processSale. */
type SaleLeg = ReturnType<typeof salePaymentLegSchema.parse>;
const parsedLegs = (p: PaymentData): SaleLeg[] =>
  (p.payments ?? []).map((l) => salePaymentLegSchema.parse(l));

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

const CLIENT: Client = {
  id: 42,
  full_name: "Rami Haddad",
  phone_number: "70123456",
  notes: null,
  whatsapp_opt_in: 0,
  created_at: "2026-10-01 10:00:00",
};

function draft(selectedClient: Client | null): CheckoutDraftData {
  return {
    selectedClient,
    clientSearchInput: "",
    clientSearchSecondary: "",
    discount: 0,
    paidUSD: 0,
    paidLBP: 0,
    changeGivenUSD: 0,
    changeGivenLBP: 0,
    exchangeRate: 90_000,
  };
}

async function renderSale(selectedClient: Client | null) {
  const onComplete = jest.fn<ReturnType<OnComplete>, [PaymentData]>(() =>
    Promise.resolve(),
  );
  render(
    <CheckoutModal
      totalAmount={14}
      currency="USD"
      allowKeepChange={true}
      draftData={draft(selectedClient)}
      onComplete={onComplete}
      onSaveDraft={jest.fn().mockResolvedValue(undefined)}
    />,
  );
  // The client comes from the draft; the cashier types $30 cash → $16 due.
  const amount = await waitFor(() => {
    const el = document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );
    if (!el) throw new Error("no payment-amount input rendered");
    return el;
  });
  // A chargeable client pre-selects Customer Account on the line (existing
  // behaviour); the customer hands over CASH, so the cashier picks Cash.
  const method = document.querySelector<HTMLSelectElement>(
    'select[data-testid^="payment-method-"]',
  );
  if (method && method.value !== "CASH") {
    fireEvent.change(method, { target: { value: "CASH" } });
  }
  fireEvent.change(amount, { target: { value: "30" } });
  await screen.findByTestId("return-change");
  return onComplete;
}

async function completeSale(onComplete: jest.Mock): Promise<PaymentData> {
  fireEvent.click(screen.getByText("Complete Sale"));
  await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  return onComplete.mock.calls[0][0] as PaymentData;
}

describe("CheckoutModal — change to the client's account (owner 2026-10-13)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("client with a phone, $14 cart, $30 cash, Account → IN CASH 30 + OUT CUSTOMER_ACCOUNT 16, change_given_usd 0", async () => {
    const onComplete = await renderSale(CLIENT);
    fireEvent.click(screen.getByTestId("change-destination-account"));
    // cc58f92d (owner): a Keep button now sits beside Account — the
    // account choice is still the one this test makes.
    expect(screen.getByTestId("change-keep-all")).toBeInTheDocument();

    const p = await completeSale(onComplete);
    expect(p.client_id).toBe(42);
    const expected: SaleLeg[] = [
      { method: "CASH", currency_code: "USD", amount: 30 },
      {
        method: "CUSTOMER_ACCOUNT",
        currency_code: "USD",
        amount: 16,
        direction: "OUT",
      },
    ];
    expect(p.payments).toEqual(expected);
    // Survives the schema with its direction intact (an OUT leg read as IN
    // would charge the client instead of crediting them).
    expect(parsedLegs(p)).toEqual(expected);
    // Cash change never travels as a leg, and none was handed back.
    expect(
      (p.payments ?? []).some(
        (l) => l.method === "CASH" && l.direction === "OUT",
      ),
    ).toBe(false);
    expect(p.change_given_usd).toBe(0);
    expect(p.change_given_lbp).toBe(0);
    // Not kept as profit — it is the client's credit.
    expect(p.kept_change_usd ?? 0).toBe(0);
    expect(p.kept_change_lbp ?? 0).toBe(0);
  });

  it("client, change handed back as cash (untouched): change_given_usd 16 and NO OUT leg of any kind", async () => {
    const onComplete = await renderSale(CLIENT);
    const p = await completeSale(onComplete);
    const expected: SaleLeg[] = [
      { method: "CASH", currency_code: "USD", amount: 30 },
    ];
    expect(parsedLegs(p)).toEqual(expected);
    expect(p.change_given_usd).toBe(16);
    expect(p.kept_change_usd ?? 0).toBe(0);
  });

  it("no client: Keep (no Account) → no OUT leg, the $16 is kept change as before", async () => {
    const onComplete = await renderSale(null);
    expect(
      screen.queryByTestId("change-destination-account"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("change-keep-all"));

    const p = await completeSale(onComplete);
    const expected: SaleLeg[] = [
      { method: "CASH", currency_code: "USD", amount: 30 },
    ];
    expect(parsedLegs(p)).toEqual(expected);
    expect((p.payments ?? []).some((l) => l.direction === "OUT")).toBe(false);
    expect(p.change_given_usd).toBe(0);
    expect(p.change_given_lbp).toBe(0);
    expect(p.kept_change_usd).toBe(16);
    expect(p.kept_change_lbp ?? 0).toBe(0);
  });
});
