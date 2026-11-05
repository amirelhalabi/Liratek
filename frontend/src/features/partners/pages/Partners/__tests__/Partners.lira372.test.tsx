/** @jest-environment jsdom */
/**
 * LIRA-372 — Partners settle (by amount, and by day) shows the ONE shared
 * Discount line (`SettleDiscountLine`), capped at $5 / 450,000 LBP, with no
 * Waive. Owner 2026-11-05: typing a discount sets the payment to
 * owed − discount (option B: even a payment typed by hand), in both
 * directions. Payload keys are read back through the core schemas (rule 24).
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

const discountInput = () =>
  screen.getByTestId("settle-discount-usd") as HTMLInputElement;

/** LIRA-346 — Settle opens the by-day sheet: 20 Oct For +$100 is picked. */
async function openByDay() {
  renderPage();
  fireEvent.click(await screen.findByText("Acme Partner"));
  fireEvent.click(await screen.findByRole("button", { name: "Settle" }));
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


/** The shop owes the partner $500 on 20 Oct (by-day SHOP payer). */
const OPEN_SHOP_ROW = {
  ...OPEN_FOR_ROW,
  id: 12,
  direction: "CREDIT" as const,
  transaction_type: "PARTNER_PAYOUT",
  amount_usd: -500,
  remaining_usd: -500,
};

function setBalance(usd: number, rows: unknown[]) {
  mockApi.partners.getAllBalances.mockResolvedValue([{ ...PARTNER, usd }]);
  mockApi.partners.getLedger.mockResolvedValue({
    entries: [],
    balance: { usd, lbp: 0, usdt: 0 },
    breakdown: null,
  });
  mockApi.partners.getSettleOpenRows.mockResolvedValue(rows);
  mockApi.partners.getSettleMonthRows.mockResolvedValue(rows);
}

const PARTNER_OWES_500 = { ...OPEN_FOR_ROW, amount_usd: 500, remaining_usd: 500 };

describe("Partners settle — one Discount line (LIRA-372)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setBalance(500, [PARTNER_OWES_500]);
    mockSettle.mockResolvedValue({ success: true, data: { id: 9 } });
    mockApi.partners.getSettleDayDetail.mockResolvedValue([]);
    mockApi.partners.settleDays.mockResolvedValue({ success: true, id: 9 });
  });

  describe("by amount", () => {
    it("partner owes $500, discount 5 → the pay line reads 495 and the payload carries it", async () => {
      await openSettle();
      await waitFor(() => expect(paymentInput().value).toBe("500"));
      const summary = screen.getByTestId("payment-summary");
      expect(within(summary).getByTestId("settle-discount-line")).toBeInTheDocument();
      expect(within(summary).getByText("Discount")).toBeInTheDocument();
      fireEvent.change(discountInput(), { target: { value: "5" } });
      await waitFor(() => expect(paymentInput().value).toBe("495"));

      fireEvent.click(screen.getByText("Confirm Settlement"));
      await waitFor(() => expect(mockSettle).toHaveBeenCalledTimes(1));
      const parsed = partnerSettleSchema.parse(mockSettle.mock.calls[0][0]);
      expect(parsed.amount).toBe(495);
      expect(parsed.discount).toEqual(
        expect.objectContaining({ amount_usd: 5, amount_lbp: 0 }),
      );
    });

    it("the shop owes $500, discount 5 → the pay line reads 495", async () => {
      setBalance(-500, [OPEN_SHOP_ROW]);
      await openSettle();
      await waitFor(() => expect(paymentInput().value).toBe("500"));
      fireEvent.change(discountInput(), { target: { value: "5" } });
      await waitFor(() => expect(paymentInput().value).toBe("495"));
    });

    it("typed 6 → capped at $5 with the note, and 5 is sent", async () => {
      await openSettle();
      fireEvent.change(discountInput(), { target: { value: "6" } });
      expect(await screen.findByTestId("discount-cap-note")).toHaveTextContent(
        "Capped to max ($5.00)",
      );
      await waitFor(() => expect(paymentInput().value).toBe("495"));
      fireEvent.click(screen.getByText("Confirm Settlement"));
      await waitFor(() => expect(mockSettle).toHaveBeenCalledTimes(1));
      const parsed = partnerSettleSchema.parse(mockSettle.mock.calls[0][0]);
      expect(parsed.discount).toEqual(
        expect.objectContaining({ amount_usd: 5 }),
      );
    });

    it("a payment typed by hand ($500) is lowered to $495 when 5 is typed (owner option B)", async () => {
      await openSettle();
      fireEvent.change(paymentInput(), { target: { value: "500" } });
      fireEvent.change(discountInput(), { target: { value: "5" } });
      await waitFor(() => expect(paymentInput().value).toBe("495"));
      expect(screen.getByText("Confirm Settlement")).not.toBeDisabled();
    });

    it("no Waive button on the settle screen", async () => {
      await openSettle();
      fireEvent.change(paymentInput(), { target: { value: "400" } });
      expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
    });
  });

  describe("by day", () => {
    it("partner owes $500 on picked days, discount 5 → pay line 495, forgive sent", async () => {
      await openByDay();
      await waitFor(() => expect(paymentInput().value).toBe("500"));
      fireEvent.change(discountInput(), { target: { value: "5" } });
      await waitFor(() => expect(paymentInput().value).toBe("495"));
      const parsed = await submitByDay();
      expect(parsed.per_currency.USD?.payments).toEqual([
        { method: "CASH", currency_code: "USD", amount: 495 },
      ]);
      expect(parsed.per_currency.USD?.forgive).toEqual({ amount: 5 });
    });

    it("the shop owes $500 (SHOP payer): the line shows, discount 3 → pay line 497", async () => {
      setBalance(-500, [OPEN_SHOP_ROW]);
      renderPage();
      fireEvent.click(await screen.findByText("Acme Partner"));
      fireEvent.click(await screen.findByRole("button", { name: "Settle" }));
      await screen.findByTestId("multi-payment-input");
      await waitFor(() => expect(paymentInput().value).toBe("500"));
      fireEvent.change(discountInput(), { target: { value: "3" } });
      await waitFor(() => expect(paymentInput().value).toBe("497"));
      const parsed = await submitByDay();
      expect(parsed.per_currency.USD?.payer).toBe("SHOP");
      expect(parsed.per_currency.USD?.forgive).toEqual({ amount: 3 });
    });

    it("typed 6 is capped at 5; a typed $500 is lowered to $495; no Waive", async () => {
      await openByDay();
      fireEvent.change(paymentInput(), { target: { value: "500" } });
      fireEvent.change(discountInput(), { target: { value: "6" } });
      expect(await screen.findByTestId("discount-cap-note")).toHaveTextContent(
        "Capped to max ($5.00)",
      );
      await waitFor(() => expect(paymentInput().value).toBe("495"));
      expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
    });
  });
});
