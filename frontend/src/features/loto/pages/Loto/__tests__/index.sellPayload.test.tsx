/** @jest-environment jsdom */

/**
 * LIRA-258 (G14 rollout) — the Loto page's sell payload.
 *
 * `LotoTicketRepository.createTicket` now reconciles the payment legs against
 * the ticket at `tender_exchange_rate ?? sell rate`, and redeems GIFT_CARD
 * legs by their `voucherCode`. The page's MultiPaymentInput converts at the
 * BUY rate, so:
 *   1. the payload must carry `tender_exchange_rate` = the buy rate the
 *      payment input converted at — otherwise a $ leg that covers the ticket
 *      at the buy rate is refused at the (higher) sell rate;
 *   2. a GIFT_CARD leg must keep its `voucherCode` (the leg map used to copy
 *      only method/currencyCode/amount/direction, so the code was dropped and
 *      every gift-card sale was refused), and the payment input must be given
 *      a voucher source (`clientId` + `fetchClientVouchers`) so a GIFT_CARD
 *      line can pick the client's voucher at all.
 *
 * The captured payload is parsed through the core `lotoSellSchema` (rule 24):
 * the assertion reads the schema's own field names off the parsed output, so
 * a key the schema would strip fails here instead of silently vanishing.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { lotoSellSchema } from "@liratek/core";
import type { PaymentLine } from "@liratek/ui";
import { LotoPage } from "../index";

const mockLotoSettingsGet = jest.fn();
const mockLotoReport = jest.fn();
const mockSell = jest.fn();
const mockFetchClientVouchers = jest.fn();

// Props the page hands MultiPaymentInput (captured by the stub below).
let lastPaymentProps: Record<string, unknown> = {};

const BUY_RATE = 89000;
const TYPED_RATE = 87000;

// Rule 25: ONE stable object, never a fresh literal per useApi() call.
const mockApi = {
  loto: {
    settings: { get: mockLotoSettingsGet },
    report: mockLotoReport,
    sell: mockSell,
  },
};

const LINES: PaymentLine[] = [
  {
    id: "l1",
    method: "GIFT_CARD",
    currencyCode: "LBP",
    amount: 300000,
    voucherCode: "GC-ABC",
  },
  { id: "l2", method: "CASH", currencyCode: "USD", amount: 3 },
];

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
    appEvents: { emit: jest.fn(), on: jest.fn(() => () => {}) },
    DecimalInput: (p: { onChange: (n: number) => void }) => (
      <input
        aria-label="sale-amount"
        onChange={(e) => p.onChange(Number(e.target.value))}
      />
    ),
    MultiPaymentInput: (p: Record<string, unknown>) => {
      lastPaymentProps = p;
      return (
        <>
          <button
            type="button"
            onClick={() => (p.onChange as (l: PaymentLine[]) => void)(LINES)}
          >
            stub-pay
          </button>
          {/* The cashier hand-types a rate in the payment input. */}
          <button
            type="button"
            onClick={() =>
              (p.onExchangeRateChange as ((r: number) => void) | undefined)?.(
                TYPED_RATE,
              )
            }
          >
            stub-type-rate
          </button>
        </>
      );
    },
  };
});

jest.mock("@/shared/utils/clientVouchers", () => ({
  fetchClientVouchers: (...a: unknown[]) => mockFetchClientVouchers(...a),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [],
    drawerAffectingMethods: [],
    allMethods: [],
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 90000, buyRate: 89000, isLoading: false }),
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({ activeSession: null, addToCart: jest.fn() }),
}));

jest.mock("@/shared/hooks/useAutoPrintReceipt", () => ({
  useAutoPrintReceipt: () => jest.fn(),
}));

jest.mock("@/features/recharge/utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn(async () => ({ ok: true, id: 7 })),
}));

jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));

jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: (p: {
    onClientSelect: (c: {
      id: number;
      full_name: string;
      phone_number: string;
    }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        p.onClientSelect({ id: 7, full_name: "Ali", phone_number: "70123456" })
      }
    >
      pick-client
    </button>
  ),
}));

jest.mock("@/features/partners/components/ForPartnerToggle", () => ({
  ForPartnerToggle: () => null,
  ForPartnerNotice: () => null,
}));

// Relative to THIS file (pages/Loto/__tests__/), not to index.tsx.
jest.mock("../../../components/StatsCards", () => ({
  StatsCards: () => null,
}));
jest.mock("../../../components/CheckpointHistory", () => ({
  CheckpointHistory: () => null,
}));
jest.mock("../../../components/TicketHistoryModal", () => ({
  TicketHistoryModal: () => null,
}));
jest.mock("../../../components/CheckpointScheduler", () => ({
  CheckpointScheduler: () => null,
}));
jest.mock("../../../components/SettlementVerification", () => ({
  SettlementVerification: () => null,
}));

async function sellWithStubLines(): Promise<Record<string, unknown>> {
  render(<LotoPage />);
  fireEvent.click(screen.getByText("pick-client"));
  fireEvent.change(screen.getByLabelText("sale-amount"), {
    target: { value: "570000" },
  });
  fireEvent.click(screen.getByText("stub-pay"));
  // The tab header is also a "Sell Ticket" button; the submit one is last.
  const sellButtons = screen.getAllByRole("button", { name: /sell ticket/i });
  fireEvent.click(sellButtons[sellButtons.length - 1]);
  await waitFor(() => expect(mockSell).toHaveBeenCalledTimes(1));
  return mockSell.mock.calls[0][0] as Record<string, unknown>;
}

describe("LotoPage — sell payload (LIRA-258 G14 rollout)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastPaymentProps = {};
    mockLotoSettingsGet.mockResolvedValue({ success: false });
    mockLotoReport.mockResolvedValue({ success: false });
    mockSell.mockResolvedValue({ success: true, ticket: { id: 1 } });
    mockFetchClientVouchers.mockResolvedValue([]);
  });

  it("carries tender_exchange_rate = the buy rate the payment input converts at", async () => {
    const raw = await sellWithStubLines();
    const parsed = lotoSellSchema.parse(raw);
    expect(parsed.tender_exchange_rate).toBe(BUY_RATE);
    expect(lastPaymentProps.exchangeRate).toBe(BUY_RATE);
  });

  // Owner decision 2026-10-07: a rate the cashier types by hand is sent —
  // the server reconciles at it and stamps it on the LOTO row.
  it("sends a hand-typed rate as tender_exchange_rate", async () => {
    render(<LotoPage />);
    fireEvent.click(screen.getByText("pick-client"));
    fireEvent.change(screen.getByLabelText("sale-amount"), {
      target: { value: "570000" },
    });
    fireEvent.click(screen.getByText("stub-pay"));
    fireEvent.click(screen.getByText("stub-type-rate"));
    const sellButtons = screen.getAllByRole("button", { name: /sell ticket/i });
    fireEvent.click(sellButtons[sellButtons.length - 1]);
    await waitFor(() => expect(mockSell).toHaveBeenCalledTimes(1));
    const parsed = lotoSellSchema.parse(mockSell.mock.calls[0][0]);
    expect(parsed.tender_exchange_rate).toBe(TYPED_RATE);
  });

  it("keeps voucherCode on a GIFT_CARD leg through the schema", async () => {
    const raw = await sellWithStubLines();
    const parsed = lotoSellSchema.parse(raw);
    const gift = (parsed.payments ?? []).find((p) => p.method === "GIFT_CARD");
    expect(gift?.voucherCode).toBe("GC-ABC");
    // A non-gift leg gets no voucherCode key at all.
    const cash = (parsed.payments ?? []).find((p) => p.method === "CASH");
    expect(cash && "voucherCode" in cash).toBe(false);
  });

  it("gives the payment input a voucher source for the selected client", async () => {
    render(<LotoPage />);
    fireEvent.click(screen.getByText("pick-client"));
    await waitFor(() => expect(lastPaymentProps.clientId).toBe(7));
    expect(typeof lastPaymentProps.fetchClientVouchers).toBe("function");
    await (lastPaymentProps.fetchClientVouchers as (id: number) => unknown)(7);
    expect(mockFetchClientVouchers).toHaveBeenCalledWith(7);
  });
});
