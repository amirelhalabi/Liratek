/** @jest-environment jsdom */
/**
 * LIRA-310 (T010) — Waive on the partner Settle modal, REWRITTEN for
 * LIRA-372 (owner 2026-11-05, rule 24): no settle screen shows Waive any
 * more; the cashier types the discount. These are now guards that the Waive
 * button is NOT offered (by amount and by day) when the payment is short,
 * and that a short payment stays a partial settlement (no discount is
 * invented for the gap).
 *
 * Renders the REAL page + real MultiPaymentInput. The payload is parsed
 * through the core schemas (rule 24).
 */
/**
 * LIRA-310 (T010) — Waive on the partner Settle modal.
 *
 * Balance $100, $98 handed over → Remaining $2 → Waive puts the gap into the
 * "Forgive (no cash)" line in the payment box, Remaining clears, Confirm stays
 * enabled, and the settlement is sent with `discount.amount_usd = 2`.
 * The discount can never exceed the room after the settlement
 * (`capSettlementDiscount`): discount + gap = that room exactly.
 *
 * Renders the REAL page + real MultiPaymentInput. The payload is parsed
 * through the core `partnerSettleSchema` (rule 24).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { partnerSettleDaysSchema, partnerSettleSchema } from "@liratek/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
    getSettleOpenRows: jest.fn(),
    getSettleMonthRows: jest.fn(),
    getSettleDayDetail: jest.fn(),
    settleDays: jest.fn(),
  },
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return { ...actual, useApi: () => mockApi };
});

// LIRA-346 — Settle opens the by-day sheet (TanStack queries); the old
// balance-based modal is reached through "Settle by amount (old way)".
jest.mock("@/shared/utils/localDay", () => {
  const actual = jest.requireActual("@/shared/utils/localDay");
  return { ...actual, localDay: () => "2026-10-26" };
});

/** One open partner row: For +$100 on 20 Oct (the partner owes the shop). */
const OPEN_FOR_ROW = {
  kind: "LEDGER" as const,
  id: 11,
  partner_id: 1,
  currency: "USD" as const,
  transaction_type: "FOR_POS",
  direction: "DEBIT" as const,
  reference_table: null,
  reference_id: null,
  notes: null,
  source_txn_id: null,
  created_at: "2026-10-20 09:00:00",
  shop_day: "2026-10-20",
  amount_usd: 100,
  amount_lbp: 0,
  covered_usd: 0,
  covered_lbp: 0,
  remaining_usd: 100,
  remaining_lbp: 0,
  row_scope: "DAY" as const,
  unit_class: "DAY" as const,
  relief_origin: null,
  relief_ref: null,
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Partners />
    </QueryClientProvider>,
  );
}

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
  renderPage();
  fireEvent.click(await screen.findByText("Acme Partner"));
  fireEvent.click(await screen.findByRole("button", { name: "Settle" }));
  // LIRA-346: the old balance-based modal, through the sheet's link.
  fireEvent.click(await screen.findByTestId("partner-settle-by-amount"));
  // The payment box is up (USD only, so no "1 USD = … LBP" box — owner
  // 2026-11-01: that box shows only when USD and LBP meet).
  await screen.findByTestId("multi-payment-input");
}

function pay(amount: string) {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  if (!input) throw new Error("no payment-amount input rendered");
  fireEvent.change(input, { target: { value: amount } });
}

// LIRA-318 — the forgive field now lives inside the payment box.
const discountInput = () =>
  screen.getByTestId("settle-discount-usd") as HTMLInputElement;

/** LIRA-346 — Settle opens the by-day sheet: 20 Oct For +$100 is picked. */
async function openByDay() {
  renderPage();
  fireEvent.click(await screen.findByText("Acme Partner"));
  fireEvent.click(await screen.findByRole("button", { name: "Settle" }));
  expect(
    await screen.findByTestId("partner-settle-payer-usd"),
  ).toHaveTextContent("Acme Partner pays you");
  // The payment box is up (USD only, so no "1 USD = … LBP" box — owner
  // 2026-11-01: that box shows only when USD and LBP meet).
  await screen.findByTestId("multi-payment-input");
}

async function submitByDay() {
  const submit = screen.getByTestId("partner-settle-submit");
  await waitFor(() => expect(submit).not.toBeDisabled());
  fireEvent.click(submit);
  await waitFor(() =>
    expect(mockApi.partners.settleDays).toHaveBeenCalledTimes(1),
  );
  return partnerSettleDaysSchema.parse(
    mockApi.partners.settleDays.mock.calls[0][0],
  );
}

describe("Partners page — no Waive on settle (LIRA-310 → LIRA-372)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.partners.getAllBalances.mockResolvedValue([PARTNER]);
    mockApi.partners.getLedger.mockResolvedValue({
      entries: [],
      balance: { usd: 100, lbp: 0, usdt: 0 },
      breakdown: null,
    });
    mockSettle.mockResolvedValue({ success: true, data: { id: 9 } });
    mockApi.partners.getSettleOpenRows.mockResolvedValue([OPEN_FOR_ROW]);
    mockApi.partners.getSettleMonthRows.mockResolvedValue([OPEN_FOR_ROW]);
    mockApi.partners.getSettleDayDetail.mockResolvedValue([]);
    mockApi.partners.settleDays.mockResolvedValue({ success: true, id: 9 });
  });

  it("balance 100, paid 98: no Waive button; the $2 stays owed and no discount is sent", async () => {
    await openSettle();
    pay("98");
    expect(await screen.findByTestId("remaining-row")).toBeInTheDocument();
    expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
    expect(discountInput().value).toBe("");
    fireEvent.click(screen.getByText("Confirm Settlement"));
    await waitFor(() => expect(mockSettle).toHaveBeenCalledTimes(1));
    const parsed = partnerSettleSchema.parse(mockSettle.mock.calls[0][0]);
    expect(parsed.amount).toBe(98);
    expect(parsed.discount).toBeUndefined();
  });

  it("by day: owed 100, paid 98 — no Waive button, no forgive sent", async () => {
    await openByDay();
    pay("98");
    expect(await screen.findByTestId("remaining-row")).toBeInTheDocument();
    expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
    const parsed = await submitByDay();
    expect(parsed.per_currency.USD).toEqual({
      payer: "PARTNER",
      payments: [{ method: "CASH", currency_code: "USD", amount: 98 }],
    });
    expect(mockSettle).not.toHaveBeenCalled();
  });
});
