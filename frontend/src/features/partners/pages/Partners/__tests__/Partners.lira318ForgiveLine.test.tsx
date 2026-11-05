/** @jest-environment jsdom */
/**
 * LIRA-318 — one discount line inside the payment box on Partners → Settle
 * (owner 2026-10-13). The separate "Discount / Forgive" block below the
 * payment form is gone.
 *
 * LIRA-372 (owner 2026-11-05) — rule 24 rewrite. The line is now the shared
 * "Discount" (`SettleDiscountLine`), capped at $5 / 450,000 LBP, and the
 * LIRA-318 rule "a forgive never moves the payment" is REVERSED: typing a
 * discount sets the payment to owed − discount, even a payment typed by
 * hand (option B). The payload's `discount` shape is unchanged — asserted
 * by parsing it through the core schemas (rule 24).
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
  // The payment box is up (USD only, so no "1 USD = … LBP" box — owner
  // 2026-11-01: that box shows only when USD and LBP meet).
  await screen.findByTestId("multi-payment-input");
}

const paymentInput = () => {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  if (!input) throw new Error("no payment-amount input rendered");
  return input;
};

const forgiveInput = () =>
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

describe("Partners settle — Discount line inside the payment box (LIRA-318 → LIRA-372)", () => {
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

  it("renders the Discount line inside the payment summary, not as a separate block", async () => {
    await openSettle();
    const summary = screen.getByTestId("payment-summary");
    expect(
      within(summary).getByTestId("settle-discount-line"),
    ).toBeInTheDocument();
    expect(within(summary).getByText("Discount")).toBeInTheDocument();
    expect(screen.queryByText("Forgive (no cash)")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Discount / Forgive (USD)"),
    ).not.toBeInTheDocument();
  });

  it("typed 80 then discount 5: the payment drops to 95 (owner option B), total 100 then After Discount 95", async () => {
    await openSettle();
    fireEvent.change(paymentInput(), { target: { value: "80" } });
    fireEvent.change(forgiveInput(), { target: { value: "5" } });

    await waitFor(() => expect(paymentInput().value).toBe("95"));
    const summary = screen.getByTestId("payment-summary");
    expect(within(summary).getByText("$100.00")).toBeInTheDocument();
    const after = within(summary).getByTestId("after-page-discount");
    expect(after).toHaveTextContent("After Discount");
    expect(after).toHaveTextContent("$95.00");

    fireEvent.click(screen.getByText("Confirm Settlement"));
    await waitFor(() => expect(mockSettle).toHaveBeenCalledTimes(1));
    const parsed = partnerSettleSchema.parse(mockSettle.mock.calls[0][0]);
    expect(parsed.amount).toBe(95);
    expect(parsed.currency).toBe("USD");
    expect(parsed.discount).toEqual(
      expect.objectContaining({ amount_usd: 5, amount_lbp: 0 }),
    );
  });

  it("discount typed while the payment covers everything: the payment drops by it, the discount is sent", async () => {
    await openSettle();
    await waitFor(() => expect(paymentInput().value).toBe("100"));
    fireEvent.change(forgiveInput(), { target: { value: "4" } });
    await waitFor(() => expect(paymentInput().value).toBe("96"));

    fireEvent.click(screen.getByText("Confirm Settlement"));
    await waitFor(() => expect(mockSettle).toHaveBeenCalledTimes(1));
    const parsed = partnerSettleSchema.parse(mockSettle.mock.calls[0][0]);
    expect(parsed.amount).toBe(96);
    expect(parsed.discount).toEqual(
      expect.objectContaining({ amount_usd: 4, amount_lbp: 0 }),
    );
  });

  it("payment edited AFTER the discount to the full 100: the extra $5 goes back as change, the settlement stays 95", async () => {
    await openSettle();
    fireEvent.change(forgiveInput(), { target: { value: "5" } });
    await waitFor(() => expect(paymentInput().value).toBe("95"));
    fireEvent.change(paymentInput(), { target: { value: "100" } });

    fireEvent.click(screen.getByText("Confirm Settlement"));
    await waitFor(() => expect(mockSettle).toHaveBeenCalledTimes(1));
    const parsed = partnerSettleSchema.parse(mockSettle.mock.calls[0][0]);
    expect(parsed.amount).toBe(95);
    expect(parsed.discount).toEqual(
      expect.objectContaining({ amount_usd: 5 }),
    );
  });

  it("discount typed 20: capped to the $5 max", async () => {
    await openSettle();
    fireEvent.change(forgiveInput(), { target: { value: "20" } });
    expect(await screen.findByTestId("discount-cap-note")).toHaveTextContent(
      "Capped to max ($5.00)",
    );
    await waitFor(() => expect(paymentInput().value).toBe("95"));
  });

  // Regression guard (behaviour unchanged, not failing-first): a paper-only
  // settle has no payment box, so the same Discount line sits below the
  // plain amount and is still sent.
  it("paper-only settle: the Discount line still shows and is sent", async () => {
    await openSettle();
    fireEvent.click(
      within(screen.getByTestId("partner-settle-cash-moved-toggle")).getByRole(
        "checkbox",
      ),
    );
    expect(screen.queryByTestId("payment-summary")).not.toBeInTheDocument();
    const amount = screen.getByTestId(
      "partner-settle-paper-amount",
    ) as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "95" } });
    fireEvent.change(forgiveInput(), { target: { value: "5" } });

    fireEvent.click(screen.getByText("Confirm Settlement"));
    await waitFor(() => expect(mockSettle).toHaveBeenCalledTimes(1));
    const parsed = partnerSettleSchema.parse(mockSettle.mock.calls[0][0]);
    expect(parsed.amount).toBe(95);
    expect(parsed.settlementMethod).toBe("CLIENT_ACCOUNT");
    expect(parsed.discount).toEqual(
      expect.objectContaining({ amount_usd: 5, amount_lbp: 0 }),
    );
  });
  // LIRA-346 — the by-day sheet keeps the one Discount line inside the
  // payment box.
  it("by day: typed 80 + discount 5 — the line is in the payment box, the payment drops to 95, discount sent per currency", async () => {
    await openByDay();
    const summary = screen.getByTestId("payment-summary");
    expect(
      within(summary).getByTestId("settle-discount-line"),
    ).toBeInTheDocument();
    fireEvent.change(paymentInput(), { target: { value: "80" } });
    fireEvent.change(forgiveInput(), { target: { value: "5" } });
    await waitFor(() => expect(paymentInput().value).toBe("95"));
    const after = within(summary).getByTestId("after-page-discount");
    expect(after).toHaveTextContent("After Discount");
    expect(after).toHaveTextContent("$95.00");
    const parsed = await submitByDay();
    expect(parsed.per_currency.USD?.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 95 },
    ]);
    expect(parsed.per_currency.USD?.forgive).toEqual({ amount: 5 });
  });
});
