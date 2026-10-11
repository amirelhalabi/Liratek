/** @jest-environment jsdom */
/**
 * LIRA-310 (T010) — Waive on the partner Settle modal.
 *
 * Balance $100, $98 handed over → Remaining $2 → Waive puts the gap into the
 * bundled "Discount / Forgive" field, Remaining clears, Confirm stays
 * enabled, and the settlement is sent with `discount.amount_usd = 2`.
 * The discount can never exceed the room after the settlement
 * (`capSettlementDiscount`): discount + gap = that room exactly.
 *
 * Renders the REAL page + real MultiPaymentInput. The payload is parsed
 * through the core `partnerSettleSchema` (rule 24).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { partnerSettleSchema } from "@liratek/core";
import Partners from "../index";

const mockSettle = jest.fn();

// Rule 25: ONE stable object, never a fresh literal per useApi() call.
const mockApi = {
  partners: {
    getAllBalances: jest.fn(),
    getLedger: jest.fn(),
    recordTransaction: jest.fn(),
    settle: mockSettle,
    writeOff: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deactivate: jest.fn(),
    activate: jest.fn(),
    getBalance: jest.fn(),
  },
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return { ...actual, useApi: () => mockApi };
});

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", role: "admin" } }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
}));

const PARTNER = {
  id: 1,
  name: "Acme Partner",
  phone: null,
  notes: null,
  is_active: 1,
  system_association: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  usd: 100,
  lbp: 0,
  usdt: 0,
};

async function openSettle() {
  render(<Partners />);
  fireEvent.click(await screen.findByText("Acme Partner"));
  fireEvent.click(await screen.findByRole("button", { name: "Settle" }));
  await screen.findByTestId("payment-exchange-rate");
}

function pay(amount: string) {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  if (!input) throw new Error("no payment-amount input rendered");
  fireEvent.change(input, { target: { value: amount } });
}

const discountInput = () =>
  screen
    .getByText("Discount / Forgive (USD)")
    .closest("div.space-y-2")!
    .querySelector("input") as HTMLInputElement;

describe("Partners page — Waive (LIRA-310)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.partners.getAllBalances.mockResolvedValue([PARTNER]);
    mockApi.partners.getLedger.mockResolvedValue({
      entries: [],
      balance: { usd: 100, lbp: 0, usdt: 0 },
      breakdown: null,
    });
    mockSettle.mockResolvedValue({ success: true, data: { id: 9 } });
  });

  it("balance 100, paid 98: Waive sets the discount to 2 and sends it", async () => {
    await openSettle();
    pay("98");
    const waive = await screen.findByTestId("waive-remaining");
    fireEvent.click(waive);
    await waitFor(() => expect(discountInput().value).toBe("2"));
    expect(screen.queryByTestId("remaining-row")).not.toBeInTheDocument();
    const confirm = screen.getByText("Confirm Settlement") as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(mockSettle).toHaveBeenCalledTimes(1));
    const parsed = partnerSettleSchema.parse(mockSettle.mock.calls[0][0]);
    expect(parsed.amount).toBe(98);
    expect(parsed.discount).toEqual(
      expect.objectContaining({ amount_usd: 2, amount_lbp: 0 }),
    );
  });

  it("adds the gap to a discount already typed (1 + 1 = 2)", async () => {
    await openSettle();
    pay("98");
    fireEvent.change(discountInput(), { target: { value: "1" } });
    fireEvent.click(await screen.findByTestId("waive-remaining"));
    await waitFor(() => expect(discountInput().value).toBe("2"));
    fireEvent.click(screen.getByText("Confirm Settlement"));
    await waitFor(() => expect(mockSettle).toHaveBeenCalledTimes(1));
    const parsed = partnerSettleSchema.parse(mockSettle.mock.calls[0][0]);
    expect(parsed.discount).toEqual(expect.objectContaining({ amount_usd: 2 }));
  });
});
