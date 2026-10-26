/** @jest-environment jsdom */
/**
 * Owner decision 2026-10-07 — a rate the cashier types by hand is sent
 * everywhere, and the transaction row saves it. The partner Settle modal's
 * payment input has a rate box; it used to go nowhere. Now the rate shown
 * there (typed, or the buy rate it starts at) is sent as `exchange_rate` and
 * stamped on the PARTNER_SETTLEMENT row. Stamp-only: the legs are locked to
 * the settlement currency, so nothing converts at it.
 *
 * Renders the REAL page + real MultiPaymentInput and types into its rate
 * box. The payload is parsed through the core `partnerSettleSchema`
 * (rule 24 — field names come from the schema; rule 23 — a key the schema
 * would strip fails here).
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

const BUY_RATE = 89000;
const TYPED_RATE = 87000;

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
  return screen.findByTestId("payment-exchange-rate");
}

async function confirm(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByText("Confirm Settlement"));
  await waitFor(() => expect(mockSettle).toHaveBeenCalled());
  return mockSettle.mock.calls[0][0] as Record<string, unknown>;
}

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

describe("Partners page — Settle sends the rate the cashier used", () => {
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

  it("a hand-typed rate is sent as exchange_rate", async () => {
    const rateBox = await openSettle();
    fireEvent.change(rateBox, { target: { value: String(TYPED_RATE) } });
    const parsed = partnerSettleSchema.parse(await confirm());
    expect(parsed.exchange_rate).toBe(TYPED_RATE);
  });

  it("an untouched rate box sends the buy rate it shows", async () => {
    await openSettle();
    const parsed = partnerSettleSchema.parse(await confirm());
    expect(parsed.exchange_rate).toBe(BUY_RATE);
  });
  // LIRA-346 — the by-day sheet stamps the same rate (not failing-first:
  // written after the sheet; the old-modal cases above are unchanged).
  it("by day: a hand-typed rate is sent as exchange_rate", async () => {
    await openByDay();
    fireEvent.change(screen.getByTestId("payment-exchange-rate"), {
      target: { value: String(TYPED_RATE) },
    });
    const parsed = await submitByDay();
    expect(parsed.exchange_rate).toBe(TYPED_RATE);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("by day: an untouched rate box sends the buy rate it shows", async () => {
    await openByDay();
    const parsed = await submitByDay();
    expect(parsed.exchange_rate).toBe(BUY_RATE);
  });
});
