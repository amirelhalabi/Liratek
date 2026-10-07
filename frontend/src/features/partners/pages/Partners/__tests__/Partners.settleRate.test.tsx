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
  render(<Partners />);
  fireEvent.click(await screen.findByText("Acme Partner"));
  fireEvent.click(await screen.findByRole("button", { name: "Settle" }));
  return screen.findByTestId("payment-exchange-rate");
}

async function confirm(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByText("Confirm Settlement"));
  await waitFor(() => expect(mockSettle).toHaveBeenCalled());
  return mockSettle.mock.calls[0][0] as Record<string, unknown>;
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
});
