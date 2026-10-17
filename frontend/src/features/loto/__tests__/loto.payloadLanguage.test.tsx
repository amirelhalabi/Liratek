/** @jest-environment jsdom */
/**
 * LIRA-331 (T049-loto) — the screen's language never reaches the money
 * payload. Every payload the Loto screens send is built twice through the
 * REAL components — once in English, once in Arabic — and the two captured
 * payloads must be deep-equal (rule 28d: every mode, not just the happy path):
 *
 *   - ticket sale, walk-in: gift-card + USD legs, hand-typed rate, client
 *   - ticket sale in a customer session → basket item (label + formData)
 *   - ticket sale For Partner (no legs, partnerId/partnerMode)
 *   - cash prize, walk-in, with a ticket number
 *   - cash prize in a customer session → basket item
 *   - manual checkpoint from the header (its stored note)
 *   - settlement: Settle All over two checkpoints, short payment + Waive
 *   - settlement: Create Checkpoint & Settle over unchecked activity
 *
 * Basket labels and checkpoint notes are stored text, so they stay English
 * in both languages; each scenario also asserts the English capture
 * directly, so en == ar cannot pass on two payloads wrong the same way.
 *
 * Not failing-first (guard against future drift): written before the
 * conversion and passing on the unconverted screens.
 *
 * Rule 25: ONE stable api object and ONE stable session object.
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import type { PaymentLine } from "@liratek/ui";
import { i18n } from "@/i18n/setup";
import { LotoPage } from "../pages/Loto/index";
import { SettlementVerification } from "../components/SettlementVerification";

const mockAddToCart = jest.fn();
const mockSession: {
  activeSession: { id: number; customer_name: string } | null;
  addToCart: jest.Mock;
} = { activeSession: null, addToCart: mockAddToCart };

const mockApi = {
  loto: {
    settings: { get: jest.fn() },
    report: jest.fn(),
    sell: jest.fn(),
    getUncheckpointed: jest.fn(),
    cashPrize: {
      create: jest.fn(),
      getTotalUnreimbursed: jest.fn(),
      getUnreimbursed: jest.fn(),
    },
    checkpoint: {
      getLast: jest.fn(),
      create: jest.fn(),
      getUnsettled: jest.fn(),
      settle: jest.fn(),
      settleBatch: jest.fn(),
      createScheduled: jest.fn(),
    },
  },
};

let stubLines: PaymentLine[] = [];
let stubReturn: PaymentLine[] = [];
let stubWaive = 0;

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
    appEvents: { emit: jest.fn(), on: jest.fn(() => () => {}) },
    // One amount input per tab (sale or prize), so one test id is enough.
    DecimalInput: (p: { onChange: (n: number) => void }) => (
      <input
        data-testid="amount"
        onChange={(e) => p.onChange(Number(e.target.value))}
      />
    ),
    MultiPaymentInput: (p: {
      onChange: (l: PaymentLine[]) => void;
      onReturnChange?: (l: PaymentLine[]) => void;
      onKeptChange?: (k: { usd: number; lbp: number } | null) => void;
      onExchangeRateChange?: (r: number) => void;
      onWaiveRemaining?: (
        amount: number,
        byCcy: Array<{ currency: string; amount: number }>,
      ) => void;
      waiveDisabled?: boolean;
    }) => (
      <>
        <button
          type="button"
          onClick={() => {
            p.onChange(stubLines);
            p.onReturnChange?.(stubReturn);
          }}
        >
          stub-pay
        </button>
        <button type="button" onClick={() => p.onExchangeRateChange?.(87000)}>
          stub-type-rate
        </button>
        <button
          type="button"
          onClick={() => p.onKeptChange?.({ usd: 0, lbp: 20000 })}
        >
          stub-keep
        </button>
        {p.onWaiveRemaining && !p.waiveDisabled && (
          <button
            type="button"
            onClick={() =>
              p.onWaiveRemaining?.(stubWaive, [
                { currency: "LBP", amount: stubWaive },
              ])
            }
          >
            stub-waive
          </button>
        )}
      </>
    ),
  };
});

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
  useSession: () => mockSession,
}));

jest.mock("@/shared/hooks/useAutoPrintReceipt", () => ({
  useAutoPrintReceipt: () => jest.fn(),
}));

jest.mock("@/shared/utils/clientVouchers", () => ({
  fetchClientVouchers: jest.fn(async () => []),
}));

jest.mock("@/features/recharge/utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn(async (a: { clientId: number | null }) => ({
    ok: true,
    id: a.clientId,
  })),
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
  ForPartnerToggle: (p: {
    onChange: (v: boolean) => void;
    onPartnerChange: (id: number | null) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        p.onChange(true);
        p.onPartnerChange(5);
      }}
    >
      stub-partner
    </button>
  ),
  ForPartnerNotice: () => null,
}));

jest.mock("@/features/partners/hooks/useForPartnerOffInSession", () => ({
  useForPartnerOffInSession: () => undefined,
}));

jest.mock("../components/StatsCards", () => ({ StatsCards: () => null }));
jest.mock("../components/CheckpointHistory", () => ({
  CheckpointHistory: () => null,
}));
jest.mock("../components/TicketHistoryModal", () => ({
  TicketHistoryModal: () => null,
}));
jest.mock("../components/CheckpointScheduler", () => ({
  CheckpointScheduler: () => null,
}));

/** The screen's own text for `key`, in whatever language is active. */
const tx = (key: string, en: string, o: Record<string, unknown> = {}): string =>
  (i18n.t as unknown as (k: string, o: Record<string, unknown>) => string)(
    `loto:${key}`,
    { defaultValue: en, ...o },
  );

/** The submit button — the last button with that name (tabs share it). */
function clickLast(name: string) {
  const all = screen.getAllByRole("button", { name });
  fireEvent.click(all[all.length - 1]);
}

function cp(id: number, sales: number, commission: number, prizes: number) {
  return {
    id,
    checkpoint_date: "2026-10-01",
    period_start: "2026-10-01",
    period_end: "2026-10-01",
    total_sales: sales,
    total_commission: commission,
    total_tickets: 1,
    total_prizes: 0,
    total_cash_prizes: prizes,
    total_cash_prizes_count: prizes > 0 ? 1 : 0,
    is_settled: 0,
  };
}

type Captured = {
  sell: unknown[];
  cart: unknown[];
  prize: unknown[];
  checkpoint: unknown[];
  settle: unknown[];
  settleBatch: unknown[];
  createScheduled: unknown[];
};

type Scenario = {
  name: string;
  session?: boolean;
  screen: "page" | "settle";
  setup?: () => void;
  run: () => Promise<void>;
  check: (c: Captured) => void;
};

async function sellSteps() {
  fireEvent.change(screen.getByTestId("amount"), {
    target: { value: "570000" },
  });
  fireEvent.click(screen.getByText("stub-pay"));
  clickLast(tx("sell.submit", "Sell Ticket"));
}

async function prizeSteps() {
  fireEvent.click(screen.getByRole("button", { name: tx("tabs.cashPrize", "Cash Prize") }));
  fireEvent.change(screen.getByTestId("amount"), {
    target: { value: "250000" },
  });
  fireEvent.change(
    screen.getByPlaceholderText(
      tx("prize.ticketPlaceholder", "Winning ticket number (optional)"),
    ),
    { target: { value: "A-123" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: tx("prize.submit", "Record Cash Prize") }),
  );
}

async function openSettle() {
  fireEvent.click(screen.getByRole("button", { name: tx("settle.open", "Settle") }));
  await waitFor(() =>
    expect(mockApi.loto.cashPrize.getUnreimbursed).toHaveBeenCalled(),
  );
  await screen.findByText("stub-pay");
}

const SCENARIOS: Scenario[] = [
  {
    name: "ticket sale, walk-in: gift card + USD legs, typed rate, kept change",
    screen: "page",
    setup: () => {
      stubLines = [
        {
          id: "l1",
          method: "GIFT_CARD",
          currencyCode: "LBP",
          amount: 300000,
          voucherCode: "GC-ABC",
        },
        { id: "l2", method: "CASH", currencyCode: "USD", amount: 4 },
      ];
      stubReturn = [
        { id: "r1", method: "CASH", currencyCode: "LBP", amount: 50000 },
      ];
    },
    run: async () => {
      fireEvent.click(screen.getByText("pick-client"));
      fireEvent.click(screen.getByText("stub-type-rate"));
      fireEvent.click(screen.getByText("stub-keep"));
      await sellSteps();
      await waitFor(() => expect(mockApi.loto.sell).toHaveBeenCalled());
    },
    check: (c) => {
      expect(c.sell).toHaveLength(1);
      expect(c.sell[0]).toMatchObject({
        sale_amount: 570000,
        payment_method: "SPLIT",
        currency: "LBP",
        tender_exchange_rate: 87000,
        kept_change_lbp: 20000,
        clientId: 7,
        clientName: "Ali",
        clientPhone: "70123456",
      });
    },
  },
  {
    name: "ticket sale in a customer session → basket item",
    screen: "page",
    session: true,
    setup: () => {
      stubLines = [
        { id: "l1", method: "CASH", currencyCode: "LBP", amount: 570000 },
      ];
    },
    run: async () => {
      await sellSteps();
      await waitFor(() => expect(mockAddToCart).toHaveBeenCalled());
    },
    check: (c) => {
      expect(c.sell).toHaveLength(0);
      expect(c.cart[0]).toMatchObject({
        module: "loto_ticket",
        label: "Loto Ticket - 570,000 LBP",
        amount: 570000,
        currency: "LBP",
        ipcChannel: "loto:sell",
      });
    },
  },
  {
    name: "ticket sale For Partner (no legs)",
    screen: "page",
    run: async () => {
      fireEvent.click(screen.getByText("stub-partner"));
      fireEvent.change(screen.getByTestId("amount"), {
        target: { value: "400000" },
      });
      clickLast(tx("sell.submit", "Sell Ticket"));
      await waitFor(() => expect(mockApi.loto.sell).toHaveBeenCalled());
    },
    check: (c) => {
      expect(c.sell[0]).toMatchObject({
        sale_amount: 400000,
        payments: [],
        partnerId: 5,
        partnerMode: "FOR",
      });
      expect(c.sell[0]).not.toHaveProperty("payment_method");
    },
  },
  {
    name: "cash prize, walk-in",
    screen: "page",
    run: async () => {
      await prizeSteps();
      await waitFor(() =>
        expect(mockApi.loto.cashPrize.create).toHaveBeenCalled(),
      );
    },
    check: (c) => {
      expect(c.prize[0]).toMatchObject({
        prize_amount: 250000,
        ticket_number: "A-123",
      });
    },
  },
  {
    name: "cash prize in a customer session → basket item",
    screen: "page",
    session: true,
    run: async () => {
      await prizeSteps();
      await waitFor(() => expect(mockAddToCart).toHaveBeenCalled());
    },
    check: (c) => {
      expect(c.prize).toHaveLength(0);
      expect(c.cart[0]).toMatchObject({
        module: "loto_prize",
        label: "Loto Prize - 250,000 LBP (#A-123)",
        amount: -250000,
        ipcChannel: "loto:cash-prize:create",
      });
    },
  },
  {
    name: "manual checkpoint from the header",
    screen: "page",
    run: async () => {
      fireEvent.click(
        screen.getByRole("button", { name: tx("header.checkpoint", "Checkpoint") }),
      );
      await waitFor(() =>
        expect(mockApi.loto.checkpoint.create).toHaveBeenCalled(),
      );
    },
    check: (c) => {
      expect(c.checkpoint[0]).toMatchObject({
        period_start: "2026-10-02",
        note: expect.stringMatching(/^Manual checkpoint for \d+\/\d+\/\d{4}$/),
      });
    },
  },
  {
    name: "settlement: Settle All, short payment + Waive",
    screen: "settle",
    setup: () => {
      mockApi.loto.checkpoint.getUnsettled.mockResolvedValue({
        success: true,
        checkpoints: [cp(1, 1_000_000, 50_000, 2_000_000), cp(2, 0, 0, 500_000)],
      });
      // net = 2,500,000 − 950,000 = 1,550,000 (LOTO pays us)
      stubLines = [
        { id: "l1", method: "CASH", currencyCode: "LBP", amount: 1_350_000 },
      ];
      stubWaive = 200_000;
    },
    run: async () => {
      await openSettle();
      fireEvent.click(screen.getByText("stub-pay"));
      fireEvent.click(screen.getByText("stub-waive"));
      fireEvent.click(
        screen.getByRole("button", {
          name: tx("settle.settleAll", "Settle All ({{count}})", { count: 2 }),
        }),
      );
      await waitFor(() =>
        expect(mockApi.loto.checkpoint.settleBatch).toHaveBeenCalled(),
      );
    },
    check: (c) => {
      expect(c.settleBatch[0]).toMatchObject({
        checkpointIds: [1, 2],
        payments: [{ method: "CASH", currency_code: "LBP", amount: 1_350_000 }],
        discount_lbp: 200_000,
        tender_exchange_rate: 89000,
      });
    },
  },
  {
    name: "settlement: Create Checkpoint & Settle (unchecked activity)",
    screen: "settle",
    setup: () => {
      mockApi.loto.checkpoint.getUnsettled.mockResolvedValue({
        success: true,
        checkpoints: [],
      });
      mockApi.loto.getUncheckpointed.mockResolvedValue({
        success: true,
        tickets: [{ sale_amount: 500_000, commission_amount: 22_250 }],
      });
      mockApi.loto.checkpoint.createScheduled.mockResolvedValue({
        success: true,
        checkpoint: {
          id: 9,
          total_sales: 500_000,
          total_commission: 22_250,
          total_prizes: 0,
        },
      });
      stubLines = [
        { id: "l1", method: "CASH", currencyCode: "LBP", amount: 477_750 },
      ];
    },
    run: async () => {
      await openSettle();
      fireEvent.click(screen.getByText("stub-pay"));
      fireEvent.click(
        screen.getByRole("button", {
          name: tx("settle.createAndSettle", "Create Checkpoint & Settle"),
        }),
      );
      await waitFor(() =>
        expect(mockApi.loto.checkpoint.settle).toHaveBeenCalled(),
      );
    },
    check: (c) => {
      expect(c.createScheduled).toHaveLength(1);
      expect(c.settle[0]).toMatchObject({
        id: 9,
        totalSales: 500_000,
        payments: [{ method: "CASH", currency_code: "LBP", amount: -477_750 }],
      });
      expect(c.settle[0]).not.toHaveProperty("discount_lbp");
    },
  },
];

function resetMocks() {
  jest.clearAllMocks();
  stubLines = [];
  stubReturn = [];
  stubWaive = 0;
  const l = mockApi.loto;
  l.settings.get.mockResolvedValue({ success: false });
  l.report.mockResolvedValue({ success: false });
  l.sell.mockResolvedValue({ success: true, ticket: { id: 1 } });
  l.getUncheckpointed.mockResolvedValue({ success: true, tickets: [{}] });
  l.cashPrize.create.mockResolvedValue({ success: true });
  l.cashPrize.getTotalUnreimbursed.mockResolvedValue({ success: true, total: 0 });
  l.cashPrize.getUnreimbursed.mockResolvedValue({ success: true, prizes: [] });
  l.checkpoint.getLast.mockResolvedValue({
    success: true,
    checkpoint: { period_end: "2026-10-01" },
  });
  l.checkpoint.create.mockResolvedValue({ success: true });
  l.checkpoint.getUnsettled.mockResolvedValue({ success: true, checkpoints: [] });
  l.checkpoint.settle.mockResolvedValue({ success: true });
  l.checkpoint.settleBatch.mockResolvedValue({ success: true });
  l.checkpoint.createScheduled.mockResolvedValue({ success: true });
}

async function capture(s: Scenario): Promise<Captured> {
  resetMocks();
  s.setup?.();
  mockSession.activeSession = s.session
    ? { id: 3, customer_name: "Rami" }
    : null;
  render(s.screen === "page" ? <LotoPage /> : <SettlementVerification />);
  await s.run();
  const l = mockApi.loto;
  const out: Captured = {
    sell: l.sell.mock.calls.map((c) => c[0]),
    cart: mockAddToCart.mock.calls.map((c) => c[0]),
    prize: l.cashPrize.create.mock.calls.map((c) => c[0]),
    checkpoint: l.checkpoint.create.mock.calls.map((c) => c[0]),
    settle: l.checkpoint.settle.mock.calls.map((c) => c[0]),
    settleBatch: l.checkpoint.settleBatch.mock.calls.map((c) => c[0]),
    createScheduled: l.checkpoint.createScheduled.mock.calls.map((c) => c[0]),
  };
  cleanup();
  return out;
}

beforeAll(() => {
  window.alert = jest.fn();
  window.confirm = jest.fn(() => true);
});

afterEach(async () => {
  mockSession.activeSession = null;
  await i18n.changeLanguage("en");
});

describe("Loto payloads are identical in English and Arabic (LIRA-331)", () => {
  it.each(SCENARIOS.map((s) => [s.name, s] as const))(
    "%s",
    async (_name, scenario) => {
      await i18n.changeLanguage("en");
      const en = await capture(scenario);
      scenario.check(en);

      const { loadLanguage } = await import("@/i18n/setup");
      await loadLanguage("ar");
      await i18n.changeLanguage("ar");
      expect(i18n.t("loto:page.title")).toBe("لوتو");

      const ar = await capture(scenario);
      expect(ar).toEqual(en);
    },
  );
});
