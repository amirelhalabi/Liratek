/** @jest-environment jsdom */
/**
 * LIRA-318 — one "Forgive (no cash)" line inside the payment box on
 * Partners → Settle (owner 2026-10-13). The separate "Discount / Forgive"
 * block below the payment form is gone.
 *
 * Owner decision: typing a forgive amount NEVER changes the payment amount
 * the cashier entered. The forgive is still capped at what is left after the
 * payment (`capSettlementDiscount`), and the payload's `discount` shape is
 * unchanged — asserted by parsing it through the core `partnerSettleSchema`
 * (rule 24).
 *
 * Renders the REAL page + real MultiPaymentInput.
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
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
  await screen.findByTestId("payment-exchange-rate");
}

const paymentInput = () => {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  if (!input) throw new Error("no payment-amount input rendered");
  return input;
};

const forgiveInput = () =>
  screen.getByTestId("partner-settle-forgive-input") as HTMLInputElement;

/** LIRA-346 — Settle opens the by-day sheet: 20 Oct For +$100 is picked. */
async function openByDay() {
  renderPage();
  fireEvent.click(await screen.findByText("Acme Partner"));
  fireEvent.click(await screen.findByRole("button", { name: "Settle" }));
  expect(
    await screen.findByTestId("partner-settle-payer-usd"),
  ).toHaveTextContent("Acme Partner pays you");
  await screen.findByTestId("payment-exchange-rate");
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

describe("Partners settle — Forgive line inside the payment box (LIRA-318)", () => {
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

  it("renders the forgive line inside the payment summary, not as a separate block", async () => {
    await openSettle();
    const summary = screen.getByTestId("payment-summary");
    expect(
      within(summary).getByTestId("partner-settle-forgive"),
    ).toBeInTheDocument();
    expect(within(summary).getByText("Forgive (no cash)")).toBeInTheDocument();
    expect(
      screen.queryByText("Discount / Forgive (USD)"),
    ).not.toBeInTheDocument();
  });

  it("paid 80 + forgive 20: payment stays 80, total shows 100 then After Forgive 80, payload unchanged", async () => {
    await openSettle();
    fireEvent.change(paymentInput(), { target: { value: "80" } });
    fireEvent.change(forgiveInput(), { target: { value: "20" } });

    await waitFor(() => expect(forgiveInput().value).toBe("20"));
    expect(paymentInput().value).toBe("80");

    const summary = screen.getByTestId("payment-summary");
    expect(within(summary).getByText("$100.00")).toBeInTheDocument();
    const after = within(summary).getByTestId("after-page-discount");
    expect(after).toHaveTextContent("After Forgive");
    expect(after).toHaveTextContent("$80.00");

    fireEvent.click(screen.getByText("Confirm Settlement"));
    await waitFor(() => expect(mockSettle).toHaveBeenCalledTimes(1));
    const parsed = partnerSettleSchema.parse(mockSettle.mock.calls[0][0]);
    expect(parsed.amount).toBe(80);
    expect(parsed.currency).toBe("USD");
    expect(parsed.discount).toEqual(
      expect.objectContaining({ amount_usd: 20, amount_lbp: 0 }),
    );
  });

  it("forgive typed while the payment covers everything: payment does not move, hint says to lower it, no discount sent", async () => {
    await openSettle();
    await waitFor(() => expect(paymentInput().value).toBe("100"));
    fireEvent.change(forgiveInput(), { target: { value: "10" } });

    expect(paymentInput().value).toBe("100");
    expect(
      await screen.findByTestId("partner-settle-discount-room-hint"),
    ).toHaveTextContent(/lower the payment/i);

    fireEvent.click(screen.getByText("Confirm Settlement"));
    await waitFor(() => expect(mockSettle).toHaveBeenCalledTimes(1));
    const parsed = partnerSettleSchema.parse(mockSettle.mock.calls[0][0]);
    expect(parsed.amount).toBe(100);
    expect(parsed.discount).toBeUndefined();
  });

  it("paid 90, forgive typed 20: capped to the $10 left, payment stays 90", async () => {
    await openSettle();
    fireEvent.change(paymentInput(), { target: { value: "90" } });
    fireEvent.change(forgiveInput(), { target: { value: "20" } });

    expect(await screen.findByTestId("discount-cap-note")).toHaveTextContent(
      "Capped to max ($10.00)",
    );
    expect(paymentInput().value).toBe("90");

    fireEvent.click(screen.getByText("Confirm Settlement"));
    await waitFor(() => expect(mockSettle).toHaveBeenCalledTimes(1));
    const parsed = partnerSettleSchema.parse(mockSettle.mock.calls[0][0]);
    expect(parsed.amount).toBe(90);
    expect(parsed.discount).toEqual(
      expect.objectContaining({ amount_usd: 10, amount_lbp: 0 }),
    );
  });

  // Regression guard (behaviour unchanged, not failing-first): a paper-only
  // settle has no payment box, so the same Forgive line sits below the
  // plain amount and is still sent.
  it("paper-only settle: forgive line still shows and is sent", async () => {
    await openSettle();
    fireEvent.click(
      within(screen.getByTestId("partner-settle-cash-moved-toggle")).getByRole(
        "checkbox",
      ),
    );
    expect(screen.queryByTestId("payment-summary")).not.toBeInTheDocument();
    const amount = screen.getByPlaceholderText("0.00") as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "80" } });
    fireEvent.change(forgiveInput(), { target: { value: "20" } });

    fireEvent.click(screen.getByText("Confirm Settlement"));
    await waitFor(() => expect(mockSettle).toHaveBeenCalledTimes(1));
    const parsed = partnerSettleSchema.parse(mockSettle.mock.calls[0][0]);
    expect(parsed.amount).toBe(80);
    expect(parsed.settlementMethod).toBe("CLIENT_ACCOUNT");
    expect(parsed.discount).toEqual(
      expect.objectContaining({ amount_usd: 20, amount_lbp: 0 }),
    );
  });
  // LIRA-346 — the by-day sheet keeps the one Forgive line inside the
  // payment box (not failing-first: written after the sheet).
  it("by day: paid 80 + forgive 20 — the line is in the payment box, payment stays 80, forgive sent per currency", async () => {
    await openByDay();
    const summary = screen.getByTestId("payment-summary");
    expect(
      within(summary).getByTestId("partner-settle-forgive"),
    ).toBeInTheDocument();
    fireEvent.change(paymentInput(), { target: { value: "80" } });
    fireEvent.change(forgiveInput(), { target: { value: "20" } });
    await waitFor(() => expect(forgiveInput().value).toBe("20"));
    expect(paymentInput().value).toBe("80");
    const after = within(summary).getByTestId("after-page-discount");
    expect(after).toHaveTextContent("After Forgive");
    expect(after).toHaveTextContent("$80.00");
    const parsed = await submitByDay();
    expect(parsed.per_currency.USD?.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 80 },
    ]);
    expect(parsed.per_currency.USD?.forgive).toEqual({ amount: 20 });
  });
});
