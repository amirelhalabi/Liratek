/** @jest-environment jsdom */

/**
 * Payment-window client parity — every Mobile Recharge payment window
 * (owner request 2026-11-11, after LIRA-386).
 *
 * LIRA-386 found the direct Alfa Gift sale's payment window with a bare name
 * box instead of the client picker, so Customer Account was always refused.
 * The owner asked that the client search and the payment method behave the
 * SAME in every payment window on the Recharge page. This table walks each
 * window through its REAL form on the REAL page (PaymentSheet,
 * MultiPaymentInput and ClientAutocompleteInput are NOT stubbed) and, per
 * row (rule 28d):
 *
 *   1. picked client  — type a name, the search reaches the API, pick the
 *      client, the method switches to Customer Account, Confirm → the payload
 *      parsed through the REAL core schema carries the client id and an
 *      account leg;
 *   2. wallet         — same client, method changed to a wallet → the leg
 *      carries that wallet and the client id still rides along;
 *   3. new client     — name + new phone typed, nobody picked → the method
 *      switches to Customer Account, no "client is required" warning, an
 *      underpayment goes on the client's account, and Confirm registers the
 *      client and sends its id.
 *
 * Field names are read off the PARSED schema output (rule 24): Zod strips
 * unknown keys, so a drifted name fails here instead of passing silently.
 *
 * Two pickers exist on this page — TelecomForm's own (searches through the
 * page's `searchClients` → `useApi().getClients(query)`) and the shared
 * ClientAutocompleteInput (loads the client list once through the dual-mode
 * `@/api/backendApi` adapter and filters locally). Both are dual-transport;
 * the search assertion is written per picker.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRechargeSchema,
  createFinancialServiceSchema,
  rechargeBasketCheckoutSchema,
} from "@liratek/core";
import MobileRecharge from "../../pages/Recharge/index";
import { RechargeBasketProvider } from "../../context/RechargeBasketContext";

jest.mock("@liratek/core", () => jest.requireActual("@liratek/core"));

// ── Clients ────────────────────────────────────────────────────────────────

const MAYA = {
  id: 7,
  full_name: "Maya Fares",
  phone_number: "03123456",
};
const NEW_CLIENT_ID = 99;

// ── API (rule 25: ONE module-level object, stable identity) ────────────────

const mockProcessRecharge = jest.fn();
const mockAddOMTTransaction = jest.fn();
const mockRechargeBasketCheckout = jest.fn();
const mockApi = {
  getAllSettings: jest.fn().mockResolvedValue([]),
  getRates: jest
    .fn()
    .mockResolvedValue([
      { to_code: "LBP", market_rate: 90000, buy_rate: 90000, sell_rate: 91000 },
    ]),
  getOMTHistory: jest.fn().mockResolvedValue([]),
  getOMTAnalytics: jest.fn().mockResolvedValue({
    today: { commission: 0, count: 0, byCurrency: [] },
    byProvider: [],
  }),
  getClients: jest.fn(),
  processRecharge: mockProcessRecharge,
  addOMTTransaction: mockAddOMTTransaction,
  rechargeBasketCheckout: mockRechargeBasketCheckout,
  getActiveCarrierLines: jest.fn().mockResolvedValue([]),
  getPrimaryCarrierLine: jest
    .fn()
    .mockResolvedValue({ success: true, data: null }),
  getPendingCarrierLineOwedDeliveries: jest
    .fn()
    .mockResolvedValue({ success: true, data: [] }),
  getRechargeHistory: jest.fn().mockResolvedValue([]),
  getRechargeTodayStats: jest.fn().mockResolvedValue({
    count: 0,
    profit_usd: 0,
    profit_lbp: 0,
    byCurrency: [],
  }),
  getActiveMobileServiceItems: jest.fn().mockResolvedValue([]),
  getResaleLines: jest.fn().mockResolvedValue({ success: true, data: [] }),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

// The shared picker and the new-client registration go through the dual-mode
// adapter module directly (not useApi) — mock just those three functions.
const mockGetClientsAdapter = jest.fn();
const mockCreateClient = jest.fn();
jest.mock("@/api/backendApi", () => ({
  ...jest.requireActual("@/api/backendApi"),
  getClients: (...a: unknown[]) => mockGetClientsAdapter(...a),
  getDebtors: jest.fn().mockResolvedValue([]),
  createClient: (...a: unknown[]) => mockCreateClient(...a),
}));

(globalThis as unknown as { window: { api: unknown } }).window = {
  ...(globalThis as unknown as { window: Record<string, unknown> }).window,
  api: {
    recharge: {
      getStock: jest.fn().mockResolvedValue({ mtc: 0, alfa: 0 }),
      getHistory: jest.fn().mockResolvedValue([]),
      getDrawerBalances: jest.fn().mockResolvedValue({}),
    },
  },
};

// Only the parts that play no role in a payment window are stubbed.
jest.mock("../../components", () => ({
  ...jest.requireActual("../../components"),
  CompactStats: () => null,
  OmtAppCashoutModal: () => null,
  ProviderTabs: ({
    onSelectProvider,
  }: {
    onSelectProvider: (p: string) => void;
  }) => (
    <div>
      {["MTC", "Alfa", "iPick", "Katsh", "WHISH_APP", "OMT_APP", "BINANCE"].map(
        (p) => (
          <button
            key={p}
            data-testid={`tab-${p}`}
            onClick={() => onSelectProvider(p)}
          />
        ),
      )}
    </div>
  ),
}));
jest.mock("@/assets/logos/alfa.svg?react", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/assets/logos/mtc.svg?react", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../CarrierLinesPanel", () => ({ CarrierLinesPanel: () => null }));
jest.mock("../HistoryModal", () => ({ HistoryModal: () => null }));
jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: () => null,
}));
jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));
jest.mock("@/shared/utils/clientVouchers", () => ({
  fetchClientVouchers: jest.fn().mockResolvedValue([]),
}));

const mockSession = {
  activeSession: null,
  linkTransaction: jest.fn(),
  addToCart: jest.fn(),
};
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => mockSession,
}));

const mockAuth = { user: { id: 1, role: "admin" } };
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => mockAuth,
  useOptionalAuth: () => mockAuth,
}));

// Every method a recharge window may offer: Cash, each wallet, Card, the
// customer's account. A form that drops one shows up as a failed row.
const ALL_METHODS = [
  { code: "CASH", label: "Cash" },
  { code: "OMT", label: "OMT Wallet" },
  { code: "WHISH", label: "Whish Wallet" },
  { code: "BINANCE", label: "Binance" },
  { code: "CARD", label: "Card" },
  { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
];
const mockMethods = {
  methods: ALL_METHODS,
  drawerAffectingMethods: ALL_METHODS.filter(
    (m) => m.code !== "CUSTOMER_ACCOUNT",
  ),
};
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => mockMethods,
}));

const mockRates = { sellRate: 91000, buyRate: 90000 };
jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => mockRates,
}));

const mockCurrency = {
  formatAmount: (v: number, c: string) => `${v} ${c}`,
};
jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => mockCurrency,
}));

// One catalog item per card-grid provider, so a card can be picked.
const CATALOG = {
  Katsh: {
    key: "Katsh/Gaming/Pubg/60",
    provider: "Katsh",
    category: "Gaming",
    subcategory: "Pubg",
    label: "60 UC",
    catalogCost: 80_000,
    catalogSellPrice: 90_000,
    sortOrder: 0,
  },
  iPick: {
    key: "iPick/Gaming/Pubg/60",
    provider: "iPick",
    category: "Gaming",
    subcategory: "Pubg",
    label: "60 UC",
    catalogCost: 80_000,
    catalogSellPrice: 90_000,
    sortOrder: 0,
  },
  WHISH_APP: {
    key: "WHISH_APP/Bills/Netflix/1",
    provider: "WHISH_APP",
    category: "Bills",
    subcategory: "Netflix",
    label: "Netflix 1 month",
    catalogCost: 800_000,
    catalogSellPrice: 900_000,
    sortOrder: 0,
  },
} as const;
const mockServiceItems = {
  getCategoriesForProvider: (p: keyof typeof CATALOG) =>
    CATALOG[p] ? [CATALOG[p].category] : [],
  getItems: (p: keyof typeof CATALOG, category?: string) =>
    CATALOG[p] && (!category || category === CATALOG[p].category)
      ? [CATALOG[p]]
      : [],
  refresh: jest.fn(),
};
jest.mock("../../hooks/useMobileServiceItems", () => ({
  ...jest.requireActual("../../hooks/useMobileServiceItems"),
  useMobileServiceItems: () => mockServiceItems,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

// ── Helpers ────────────────────────────────────────────────────────────────

type Payload = Record<string, unknown>;

function methodSelect(): HTMLSelectElement {
  const el = document.querySelector<HTMLSelectElement>(
    'select[data-testid^="payment-method-"]',
  );
  if (!el) throw new Error("payment window not open");
  return el;
}

function amountInput(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  if (!el) throw new Error("payment window not open");
  return el;
}

/** The open payment window's Confirm button (last button of the sheet). */
function confirmButton(): HTMLButtonElement {
  // The sheet is the `fixed inset-0` overlay holding the method select; its
  // footer button is the last button inside it.
  const sheet = methodSelect().closest("div.fixed.inset-0");
  if (!sheet) throw new Error("payment window root not found");
  const buttons = within(sheet as HTMLElement).getAllByRole("button");
  return buttons[buttons.length - 1] as HTMLButtonElement;
}

function fill(el: HTMLElement | null, value: string) {
  if (!el) throw new Error("input not found");
  fireEvent.change(el, { target: { value } });
}

interface Row {
  name: string;
  /** Schema the submitted payload is parsed through (rule 24). */
  schema: "recharge" | "financial";
  /** Which picker the row uses: telecom = page search; shared = autocomplete. */
  picker: "telecom" | "shared";
  /** Navigate to the form and fill it (no payment window yet). */
  setup: () => Promise<void>;
  /** Open the payment window. */
  openSheet: () => Promise<void>;
  /** The client boxes sit on the form, before the window opens. */
  clientBeforeSheet?: boolean;
  /** The client name box (search) and the new-client phone box. */
  nameBox: () => HTMLInputElement;
  phoneBox: () => HTMLInputElement;
  /** A payout window (shop pays the customer): no debt on a shortfall. */
  payout?: boolean;
  /** Wallet to switch to (must be offered). */
  wallet: string;
}

const SHOP_LINE_PHONE = "70555444";

async function renderPage(provider: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      {/* As in App.tsx: the Mobile Recharge basket spans the tabs. */}
      <RechargeBasketProvider>
        <MobileRecharge />
      </RechargeBasketProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(mockApi.getAllSettings).toHaveBeenCalled());
  fireEvent.click(screen.getByTestId(`tab-${provider}`));
}

const byPlaceholder = (re: RegExp) => () =>
  screen.getAllByPlaceholderText(re)[0] as HTMLInputElement;
const byId = (id: string) => () =>
  document.getElementById(id) as HTMLInputElement;

async function waitForSheet() {
  await waitFor(() => methodSelect());
}

function telecomRow(
  name: string,
  provider: "MTC" | "Alfa",
  tab: "Credit" | "Days" | "Alfa Gift" | "Buy-back",
): Row {
  return {
    name,
    schema: "recharge",
    picker: "telecom",
    wallet: "WHISH",
    ...(tab === "Buy-back" ? { payout: true } : {}),
    setup: async () => {
      await renderPage(provider);
      if (tab === "Days" || tab === "Alfa Gift") {
        fireEvent.click(
          await screen.findByRole("button", { name: new RegExp(`^${tab}$`) }),
        );
      }
      if (tab === "Alfa Gift") {
        fireEvent.click(await screen.findByText("1 GB"));
        return;
      }
      if (tab === "Buy-back") {
        await waitFor(() =>
          expect(mockApi.getActiveCarrierLines).toHaveBeenCalled(),
        );
      }
      fill(
        document.getElementById("telecom-phone"),
        tab === "Buy-back" ? SHOP_LINE_PHONE : "70999888",
      );
      if (tab === "Buy-back") {
        await screen.findByTestId("shop-line-buyback-note");
      }
      fill(
        document.getElementById("telecom-amount"),
        tab === "Days" ? "30" : "3",
      );
      if (tab === "Days") {
        fill(document.getElementById("telecom-days-cost"), "2");
      }
      fill(document.getElementById("telecom-price"), "300000");
    },
    openSheet: async () => {
      if (tab === "Alfa Gift") {
        fireEvent.click(screen.getByRole("button", { name: /^Pay$/ }));
      } else {
        fireEvent.click(screen.getByTestId("telecom-proceed"));
      }
      await waitForSheet();
    },
    nameBox: byPlaceholder(/search client/i),
    phoneBox: byPlaceholder(/registers a new client/i),
  };
}

function cardGridRow(provider: "Katsh" | "iPick"): Row {
  return {
    name: `${provider} — card checkout`,
    schema: "financial",
    picker: "shared",
    wallet: "WHISH",
    setup: async () => {
      await renderPage(provider);
      fireEvent.click(await screen.findByText(CATALOG[provider].label));
    },
    openSheet: async () => {
      fireEvent.click(screen.getByTestId("katsh-proceed"));
      await waitForSheet();
    },
    nameBox: byPlaceholder(/client name \(optional\)/i),
    phoneBox: byPlaceholder(/registers a new client/i),
  };
}

const whishBillsRow: Row = {
  name: "Whish App — Bills",
  schema: "financial",
  picker: "shared",
  wallet: "OMT",
  setup: async () => {
    await renderPage("WHISH_APP");
    fireEvent.click(await screen.findByRole("button", { name: /^Bills$/ }));
    fireEvent.click(await screen.findByText(CATALOG.WHISH_APP.label));
  },
  openSheet: async () => {
    fireEvent.click(screen.getByTestId("financial-proceed"));
    await waitForSheet();
  },
  nameBox: byPlaceholder(/client name \(optional\)/i),
  phoneBox: byPlaceholder(/registers a new client/i),
};

function transferRow(
  provider: "OMT_APP" | "WHISH_APP",
  direction: "SEND" | "RECEIVE",
): Row {
  const send = direction === "SEND";
  return {
    name: `${provider === "OMT_APP" ? "OMT App" : "Whish App"} — transfer ${direction}`,
    schema: "financial",
    picker: "shared",
    clientBeforeSheet: true,
    wallet: provider === "OMT_APP" ? "WHISH" : "OMT",
    ...(send ? {} : { payout: true }),
    setup: async () => {
      await renderPage(provider);
      if (!send) {
        fireEvent.click(
          await screen.findByRole("button", { name: /^Receive$/i }),
        );
      }
      fill(await waitFor(() => byId("transfer-amount")()), "100");
      const fee = byId("transfer-fee")();
      if (fee) fill(fee, "2");
    },
    openSheet: async () => {
      fireEvent.click(screen.getByTestId("transfer-proceed"));
      await waitForSheet();
    },
    nameBox: byId(send ? "sender-name" : "receiver-name"),
    phoneBox: byId(send ? "sender-phone" : "receiver-phone"),
  };
}

function binanceRow(direction: "SEND" | "RECEIVE"): Row {
  const send = direction === "SEND";
  return {
    name: `Binance — ${send ? "send" : "cash-out"}`,
    schema: "financial",
    picker: "shared",
    clientBeforeSheet: true,
    wallet: "WHISH",
    ...(send ? {} : { payout: true }),
    setup: async () => {
      await renderPage("BINANCE");
      if (!send) {
        fireEvent.click(
          await screen.findByRole("button", { name: /^Cash Out$/i }),
        );
      }
      fill(await waitFor(() => byId("crypto-amount")()), "100");
      fill(byId("crypto-fee")(), "2");
    },
    openSheet: async () => {
      fireEvent.click(screen.getByTestId("crypto-proceed"));
      await waitForSheet();
    },
    nameBox: byId("crypto-client"),
    phoneBox: byId("crypto-client-phone"),
  };
}

const ROWS: Row[] = [
  telecomRow("Alfa — Credit", "Alfa", "Credit"),
  telecomRow("Alfa — Days", "Alfa", "Days"),
  telecomRow("Alfa — Alfa Gift", "Alfa", "Alfa Gift"),
  telecomRow("MTC — Credit", "MTC", "Credit"),
  telecomRow("MTC — Days", "MTC", "Days"),
  telecomRow("Alfa — credit buy-back (shop line)", "Alfa", "Buy-back"),
  cardGridRow("Katsh"),
  cardGridRow("iPick"),
  whishBillsRow,
  transferRow("OMT_APP", "SEND"),
  transferRow("OMT_APP", "RECEIVE"),
  transferRow("WHISH_APP", "SEND"),
  transferRow("WHISH_APP", "RECEIVE"),
  binanceRow("SEND"),
  binanceRow("RECEIVE"),
];

// ── Assertions ─────────────────────────────────────────────────────────────

function captured(row: Row): Payload {
  const mock =
    row.schema === "recharge" ? mockProcessRecharge : mockAddOMTTransaction;
  expect(mock).toHaveBeenCalledTimes(1);
  return mock.mock.calls[0][0] as Payload;
}

interface Parsed {
  clientId?: number;
  payments?: Array<{ method: string; amount: number; currencyCode: string }>;
  cashoutMethod?: string;
}

function parse(row: Row, payload: Payload): Parsed {
  const schema =
    row.schema === "recharge"
      ? createRechargeSchema
      : createFinancialServiceSchema;
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `${row.name}: server schema refused the payload: ${JSON.stringify(parsed.error.issues)}`,
    );
  }
  return parsed.data as Parsed;
}

/** Every method the parsed payload moves money with: the legs, plus — on a
 *  payout (RECEIVE) sent without legs — the cash-out method it pays by. */
function legMethods(row: Row, data: Parsed): string[] {
  const methods = (data.payments ?? []).map((l) => l.method);
  // On a RECEIVE with legs the server pays each leg from its own method's
  // drawer (FinancialServiceRepository, the `payoutLegs.length > 0` branch
  // of the Binance/app-wallet RECEIVE); `cashoutMethod` (schema default
  // "CASH") is read only when no legs are sent.
  if (row.payout && methods.length === 0 && data.cashoutMethod) {
    methods.push(data.cashoutMethod);
  }
  return methods;
}

async function pickMaya(row: Row) {
  fill(row.nameBox(), "Maya");
  if (row.picker === "telecom") {
    // TelecomForm's picker searches through the page → useApi().getClients.
    await waitFor(() =>
      expect(mockApi.getClients).toHaveBeenCalledWith("Maya"),
    );
  } else {
    // ClientAutocompleteInput loads through the dual-mode adapter.
    expect(mockGetClientsAdapter).toHaveBeenCalled();
  }
  const option = await screen.findByRole("button", { name: /Maya Fares/ });
  // The shared dropdown picks on mouse-down (keeps the input focused).
  if (row.picker === "shared") fireEvent.mouseDown(option);
  else fireEvent.click(option);
}

async function typeNewClient(row: Row) {
  fill(row.nameBox(), "Nadia Khoury");
  fill(row.phoneBox(), "70111222");
}

/** Open the window and enter the client, in the order the form asks. */
async function openWithClient(row: Row, enter: (r: Row) => Promise<void>) {
  await row.setup();
  if (row.clientBeforeSheet) {
    await enter(row);
    await row.openSheet();
  } else {
    await row.openSheet();
    await enter(row);
  }
}

async function confirm() {
  await act(async () => {
    fireEvent.click(confirmButton());
  });
}

const noClientWarning = () =>
  expect(
    screen.queryByText(/Client is required when using DEBT/i),
  ).not.toBeInTheDocument();

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getAllSettings.mockResolvedValue([]);
  mockApi.getActiveCarrierLines.mockResolvedValue([
    { id: 1, carrier: "alfa", phone_number: SHOP_LINE_PHONE, is_active: 1 },
  ]);
  mockApi.getClients.mockImplementation((q: string) =>
    Promise.resolve(
      q && MAYA.full_name.toLowerCase().includes(q.toLowerCase()) ? [MAYA] : [],
    ),
  );
  mockGetClientsAdapter.mockResolvedValue([MAYA]);
  mockCreateClient.mockResolvedValue({ success: true, id: NEW_CLIENT_ID });
  mockProcessRecharge.mockResolvedValue({ success: true, id: 1 });
  mockAddOMTTransaction.mockResolvedValue({ success: true, id: 1 });
  mockRechargeBasketCheckout.mockResolvedValue({ success: true });
});

describe.each(ROWS)("payment window client parity — $name", (row) => {
  it("picked client: search → pick → Customer Account → payload carries the client and the account leg", async () => {
    await openWithClient(row, pickMaya);

    await waitFor(() => expect(methodSelect().value).toBe("CUSTOMER_ACCOUNT"));
    noClientWarning();

    await confirm();
    const data = parse(row, captured(row));
    expect(data.clientId).toBe(MAYA.id);
    expect(legMethods(row, data)).toContain("CUSTOMER_ACCOUNT");
  });

  it("picked client, then a wallet: every method is offered and the leg carries the wallet and the client id", async () => {
    await openWithClient(row, pickMaya);
    await waitFor(() => expect(methodSelect().value).toBe("CUSTOMER_ACCOUNT"));

    const offered = Array.from(methodSelect().options).map((o) => o.value);
    for (const m of ["CASH", row.wallet, "CUSTOMER_ACCOUNT"]) {
      expect(offered).toContain(m);
    }
    fireEvent.change(methodSelect(), { target: { value: row.wallet } });
    expect(methodSelect().value).toBe(row.wallet);

    await confirm();
    const data = parse(row, captured(row));
    expect(data.clientId).toBe(MAYA.id);
    expect(legMethods(row, data)).toEqual([row.wallet]);
  });

  it("new client (name + phone, nobody picked): Customer Account without a warning, client registered and sent", async () => {
    mockApi.getClients.mockResolvedValue([]);
    mockGetClientsAdapter.mockResolvedValue([]);
    await openWithClient(row, typeNewClient);

    await waitFor(() => expect(methodSelect().value).toBe("CUSTOMER_ACCOUNT"));
    noClientWarning();

    await confirm();
    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledTimes(1));
    const data = parse(row, captured(row));
    expect(data.clientId).toBe(NEW_CLIENT_ID);
    expect(legMethods(row, data)).toContain("CUSTOMER_ACCOUNT");
  });

  if (!row.payout) {
    it("new client, cash short of the total: the rest goes on the client's account", async () => {
      mockApi.getClients.mockResolvedValue([]);
      mockGetClientsAdapter.mockResolvedValue([]);
      await openWithClient(row, typeNewClient);
      await waitFor(() =>
        expect(methodSelect().value).toBe("CUSTOMER_ACCOUNT"),
      );

      fireEvent.change(methodSelect(), { target: { value: "CASH" } });
      const total = Number(amountInput().value.replace(/,/g, ""));
      expect(total).toBeGreaterThan(0);
      fill(amountInput(), String(Math.floor(total / 2)));
      noClientWarning();

      await confirm();
      await waitFor(() => expect(mockCreateClient).toHaveBeenCalledTimes(1));
      const data = parse(row, captured(row));
      expect(data.clientId).toBe(NEW_CLIENT_ID);
      expect(legMethods(row, data)).toEqual(
        expect.arrayContaining(["CASH", "CUSTOMER_ACCOUNT"]),
      );
    });
  } else {
    // A payout (the shop pays the customer) never books an automatic debt:
    // an IN account leg there would invert the sign of the unpaid remainder
    // (MultiPaymentInput's own warning). Paying out less leaves ONE line.
    it("payout, new client, cash short of the payout: no automatic account line", async () => {
      mockApi.getClients.mockResolvedValue([]);
      mockGetClientsAdapter.mockResolvedValue([]);
      await openWithClient(row, typeNewClient);
      await waitFor(() =>
        expect(methodSelect().value).toBe("CUSTOMER_ACCOUNT"),
      );

      fireEvent.change(methodSelect(), { target: { value: "CASH" } });
      const total = Number(amountInput().value.replace(/,/g, ""));
      expect(total).toBeGreaterThan(0);
      fill(amountInput(), String(Math.floor(total / 2)));

      expect(
        document.querySelectorAll('select[data-testid^="payment-method-"]'),
      ).toHaveLength(1);
      expect(methodSelect().value).toBe("CASH");
    });
  }
});

// ── Mixed basket (LIRA-326): iPick + Katsh picks, paid once ────────────────
// Same window and picker as the Katsh row, but the payload is the basket
// checkout envelope (`rechargeBasketCheckoutSchema`): the client rides at the
// top level and on every provider's sale inside it.

async function openMixedBasket() {
  await renderPage("iPick");
  fireEvent.click(await screen.findByText(CATALOG.iPick.label));
  fireEvent.click(screen.getByTestId("tab-Katsh"));
  fireEvent.click(await screen.findByText(CATALOG.Katsh.label));
  fireEvent.click(screen.getByTestId("katsh-proceed"));
  await waitForSheet();
}

const mixedNameBox = byPlaceholder(/client name \(optional\)/i);
const mixedPhoneBox = byPlaceholder(/registers a new client/i);

function parseBasket() {
  expect(mockRechargeBasketCheckout).toHaveBeenCalledTimes(1);
  expect(mockAddOMTTransaction).not.toHaveBeenCalled();
  const parsed = rechargeBasketCheckoutSchema.safeParse(
    mockRechargeBasketCheckout.mock.calls[0][0],
  );
  if (!parsed.success) {
    throw new Error(
      `basket schema refused the payload: ${JSON.stringify(parsed.error.issues)}`,
    );
  }
  return parsed.data;
}

/** The client on every sale inside the basket (cart items are opaque to the
 *  envelope schema; each is a `financial:create` batch or a bill). */
function saleClientIds(cartItems: unknown[]): unknown[] {
  return cartItems.flatMap((c) => {
    const fd = (c as { formData: { items?: unknown[]; clientId?: unknown } })
      .formData;
    return fd.items
      ? fd.items.map((it) => (it as { clientId?: unknown }).clientId)
      : [fd.clientId];
  });
}

describe("payment window client parity — mixed basket (iPick + Katsh)", () => {
  it("picked client: Customer Account, the basket and every sale carry the client", async () => {
    await openMixedBasket();
    fill(mixedNameBox(), "Maya");
    expect(mockGetClientsAdapter).toHaveBeenCalled();
    fireEvent.mouseDown(
      await screen.findByRole("button", { name: /Maya Fares/ }),
    );
    await waitFor(() => expect(methodSelect().value).toBe("CUSTOMER_ACCOUNT"));
    noClientWarning();

    await confirm();
    const data = parseBasket();
    expect(data.clientId).toBe(MAYA.id);
    expect((data.payments ?? []).map((l) => l.method)).toContain(
      "CUSTOMER_ACCOUNT",
    );
    const ids = saleClientIds(data.cartItems);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(ids.every((id) => id === MAYA.id)).toBe(true);
  });

  it("new client, cash short of the total: the rest goes on the client's account", async () => {
    mockGetClientsAdapter.mockResolvedValue([]);
    await openMixedBasket();
    fill(mixedNameBox(), "Nadia Khoury");
    fill(mixedPhoneBox(), "70111222");
    await waitFor(() => expect(methodSelect().value).toBe("CUSTOMER_ACCOUNT"));
    noClientWarning();

    fireEvent.change(methodSelect(), { target: { value: "CASH" } });
    const total = Number(amountInput().value.replace(/,/g, ""));
    expect(total).toBeGreaterThan(0);
    fill(amountInput(), String(Math.floor(total / 2)));

    await confirm();
    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledTimes(1));
    const data = parseBasket();
    expect(data.clientId).toBe(NEW_CLIENT_ID);
    expect((data.payments ?? []).map((l) => l.method)).toEqual(
      expect.arrayContaining(["CASH", "CUSTOMER_ACCOUNT"]),
    );
  });
});
