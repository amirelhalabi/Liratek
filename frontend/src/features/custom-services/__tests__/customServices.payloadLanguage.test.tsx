/** @jest-environment jsdom */
/**
 * LIRA-331 (T049-customServices) — the screen's language never reaches the
 * money payload. Every payload the Services page sends is built twice
 * through the REAL page — once in English, once in Arabic — and the two
 * captured payloads must be deep-equal (rule 28d: every sub-type and mode):
 *
 *   - walk-in USD service: typed description, client, note, typed rate,
 *     change leg, kept change, discount
 *   - LBP service with an extra
 *   - insurance (pre-selects Via Partner, starts at ORDERED)
 *   - For Partner (no legs)
 *   - Via Partner payout (direction OUT)
 *   - in a customer session → basket item (label + formData)
 *   - Hold Money: hold USD + LBP
 *   - Hold Money: partial pickup
 *   - History: advance fulfilment, change work status, void
 *
 * Category, work-status and fulfilment values are codes; only their labels
 * are translated. The basket label is stored text, so it stays English in
 * both languages. Each scenario also asserts the English capture directly,
 * so en == ar cannot pass on two payloads wrong the same way.
 *
 * Not failing-first (guard against future drift): written before the
 * conversion and passing on the unconverted page.
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
import CustomServices from "../pages/CustomServices/index";

const mockAddToCart = jest.fn();
const mockSession: {
  activeSession: { id: number; customer_name: string } | null;
  addToCart: jest.Mock;
  linkTransaction: jest.Mock;
} = { activeSession: null, addToCart: mockAddToCart, linkTransaction: jest.fn() };

const HOLD = {
  id: 5,
  client_name: "Rami",
  phone_number: "70111222",
  client_id: null,
  usd_amount: 50,
  lbp_amount: 0,
  status: "held",
  notes: null,
  created_by: 1,
  collected_by: null,
  collected_at: null,
  created_at: "2026-10-01 10:00:00",
  updated_at: "2026-10-01 10:00:00",
  remaining_usd: 50,
  remaining_lbp: 0,
};

const ROW_BASE = {
  cost_lbp: 0,
  price_lbp: 0,
  profit_lbp: 0,
  client_name: "Ali",
  phone_number: "70123456",
  note: null,
  paid_by: "CASH",
  is_refunded: 0,
  edited_by: null,
  created_at: "2026-10-01 10:00:00",
};

const HISTORY = [
  {
    ...ROW_BASE,
    id: 11,
    description: "Car insurance",
    category: "insurance",
    fulfillment_status: "ORDERED",
    work_status: "Received",
    cost_usd: 20,
    price_usd: 30,
    profit_usd: 10,
  },
  {
    ...ROW_BASE,
    id: 12,
    description: "Screen fix",
    category: "repair",
    fulfillment_status: null,
    work_status: "Received",
    cost_usd: 4,
    price_usd: 10,
    profit_usd: 6,
  },
];

const mockApi = {
  addCustomService: jest.fn(),
  deleteCustomService: jest.fn(),
  advanceCustomServiceFulfillment: jest.fn(),
  setCustomServiceWorkStatus: jest.fn(),
  getProducts: jest.fn(),
  getAllSettings: jest.fn(),
  servicePresets: { list: jest.fn() },
  holdMoney: {
    list: jest.fn(),
    create: jest.fn(),
    collect: jest.fn(),
    pickups: jest.fn(),
    voidPickup: jest.fn(),
  },
};

let stubLines: PaymentLine[] = [];
let stubReturn: PaymentLine[] = [];

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
    appEvents: { emit: jest.fn(), on: jest.fn(() => () => {}) },
    DecimalInput: (p: {
      id?: string;
      value: number;
      onChange: (n: number) => void;
      placeholder?: string;
      "data-testid"?: string;
    }) => (
      <input
        id={p.id}
        data-testid={p["data-testid"]}
        placeholder={p.placeholder}
        value={p.value === 0 ? "" : String(p.value)}
        onChange={(e) => p.onChange(parseFloat(e.target.value) || 0)}
      />
    ),
    SearchBar: (p: { onFreeText?: (v: string) => void }) => (
      <input
        data-testid="stub-search"
        onChange={(e) => p.onFreeText?.(e.target.value)}
      />
    ),
    MultiPaymentInput: (p: {
      onChange: (l: PaymentLine[]) => void;
      onReturnChange?: (l: PaymentLine[]) => void;
      onKeptChange?: (k: { usd: number; lbp: number } | null) => void;
      onExchangeRateChange?: (r: number) => void;
      onDiscountChange?: (n: number) => void;
      onExtraChange?: (n: number) => void;
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
          stub-rate
        </button>
        <button
          type="button"
          onClick={() => p.onKeptChange?.({ usd: 0.5, lbp: 0 })}
        >
          stub-keep
        </button>
        <button type="button" onClick={() => p.onDiscountChange?.(1)}>
          stub-discount
        </button>
        <button type="button" onClick={() => p.onExtraChange?.(50000)}>
          stub-extra
        </button>
      </>
    ),
  };
});

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [
      { code: "CASH", label: "Cash" },
      { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
    ],
    drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
    allMethods: [],
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 90000, buyRate: 89000, isLoading: false }),
}));

jest.mock("@/hooks/useShopName", () => ({
  useShopInfo: () => ({ name: "Shop" }),
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => mockSession,
}));

jest.mock("@/features/sessions/hooks/useSessionAutoFill", () => ({
  useSessionAutoFill: () => undefined,
}));

jest.mock("@/features/partners/hooks/useForPartnerOffInSession", () => ({
  useForPartnerOffInSession: () => undefined,
}));

const mockReload = jest.fn();
jest.mock("../hooks/useCustomServices", () => ({
  useCustomServices: () => ({
    history: HISTORY,
    loading: false,
    error: null,
    reload: mockReload,
    summary: {
      count: 0,
      totalCostUsd: 0,
      totalCostLbp: 0,
      totalPriceUsd: 0,
      totalPriceLbp: 0,
      totalProfitUsd: 0,
      totalProfitLbp: 0,
    },
  }),
}));

jest.mock("@/shared/hooks/useSaveAsClient", () => ({
  useSaveAsClient: () => ({
    saveAsClient: false,
    setSaveAsClient: jest.fn(),
    showCheckbox: false,
    trySaveAsClient: jest.fn().mockResolvedValue({ clientId: null }),
    resetSaveAsClient: jest.fn(),
  }),
}));

jest.mock("@/shared/components/SaveAsClientCheckbox", () => ({
  SaveAsClientCheckbox: () => null,
}));

jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));

jest.mock("@/shared/hooks/useAutoPrintReceipt", () => ({
  useAutoPrintReceipt: () => jest.fn(),
}));

jest.mock("@/shared/utils/clientVouchers", () => ({
  fetchClientVouchers: jest.fn(async () => []),
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

jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: (p: { onSelect: (id: number) => void }) => (
    <button type="button" onClick={() => p.onSelect(21)}>
      stub-partner
    </button>
  ),
}));

jest.mock("../pages/CustomServices/components/PresetManagerModal", () => ({
  PresetManagerModal: () => null,
}));
jest.mock("../components/StatsCards", () => ({ StatsCards: () => null }));

/** The page's own text for `key`, in whatever language is active. */
const tx = (key: string, en: string): string =>
  (i18n.t as unknown as (k: string, o: { defaultValue: string }) => string)(
    `customServices:${key}`,
    { defaultValue: en },
  );

const byId = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not rendered`);
  return el;
};
const type = (id: string, value: string) =>
  fireEvent.change(byId(id), { target: { value } });
const click = (text: string) => fireEvent.click(screen.getByText(text));
const clickButton = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

/** The submit button, by its (possibly translated) label. */
async function submit(key: string, en: string) {
  const button = screen.getByText(tx(key, en)).closest("button")!;
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
}

type Captured = Record<string, unknown[]>;

type Scenario = {
  name: string;
  session?: boolean;
  setup?: () => void;
  run: () => Promise<void>;
  check: (c: Captured) => void;
};

const SCENARIOS: Scenario[] = [
  {
    name: "walk-in USD service: client, note, rate, change, kept, discount",
    setup: () => {
      stubLines = [{ id: "a", method: "CASH", currencyCode: "USD", amount: 12 }];
      stubReturn = [
        { id: "r", method: "CASH", currencyCode: "USD", amount: 3 },
      ];
    },
    run: async () => {
      clickButton(tx("categories.repair", "Repair"));
      fireEvent.change(screen.getByTestId("stub-search"), {
        target: { value: "Screen fix" },
      });
      type("svc-cost", "4");
      type("svc-price", "10");
      click("pick-client");
      type("svc-note", "glass only");
      click("stub-rate");
      click("stub-pay");
      click("stub-keep");
      click("stub-discount");
      await submit("form.submitService", "Submit Service");
      await waitFor(() => expect(mockApi.addCustomService).toHaveBeenCalled());
    },
    check: (c) => {
      expect(c.add[0]).toMatchObject({
        description: "Screen fix",
        category: "repair",
        cost_usd: 4,
        price_usd: 9,
        discount_usd: 1,
        exchange_rate: 87000,
        kept_change_usd: 0.5,
        client_id: 7,
        client_name: "Ali",
        note: "glass only",
        paid_by: "CASH",
      });
    },
  },
  {
    name: "LBP service with an extra",
    setup: () => {
      stubLines = [
        { id: "a", method: "CASH", currencyCode: "LBP", amount: 550000 },
      ];
    },
    run: async () => {
      fireEvent.change(screen.getByTestId("stub-search"), {
        target: { value: "SIM swap" },
      });
      clickButton("LBP");
      type("svc-cost", "100000");
      type("svc-price", "500000");
      click("stub-pay");
      click("stub-extra");
      await submit("form.submitService", "Submit Service");
      await waitFor(() => expect(mockApi.addCustomService).toHaveBeenCalled());
    },
    check: (c) => {
      expect(c.add[0]).toMatchObject({
        description: "SIM swap",
        cost_lbp: 100000,
        price_lbp: 500000,
        extra_lbp: 50000,
      });
    },
  },
  {
    name: "insurance: Via Partner pre-selected, starts at ORDERED",
    setup: () => {
      stubLines = [{ id: "a", method: "CASH", currencyCode: "USD", amount: 30 }];
    },
    run: async () => {
      clickButton(tx("categories.insurance", "Insurance"));
      fireEvent.change(screen.getByTestId("stub-search"), {
        target: { value: "Car insurance" },
      });
      type("svc-cost", "20");
      type("svc-price", "30");
      click("stub-partner");
      click("stub-pay");
      await submit("form.submitService", "Submit Service");
      await waitFor(() => expect(mockApi.addCustomService).toHaveBeenCalled());
    },
    check: (c) => {
      expect(c.add[0]).toMatchObject({
        category: "insurance",
        fulfillment_status: "ORDERED",
        partnerId: 21,
        partnerMode: "VIA",
      });
    },
  },
  {
    name: "For Partner (no legs)",
    run: async () => {
      fireEvent.change(screen.getByTestId("stub-search"), {
        target: { value: "Netflix" },
      });
      type("svc-cost", "5");
      type("svc-price", "15");
      fireEvent.click(screen.getByTestId("custom-service-for-partner-toggle"));
      click("stub-partner");
      await submit("form.submitToPartner", "Submit to Partner");
      await waitFor(() => expect(mockApi.addCustomService).toHaveBeenCalled());
    },
    check: (c) => {
      expect(c.add[0]).toMatchObject({ partnerId: 21, partnerMode: "FOR" });
      expect(c.add[0]).not.toHaveProperty("payments");
    },
  },
  {
    name: "Via Partner payout (direction OUT)",
    run: async () => {
      fireEvent.change(screen.getByTestId("stub-search"), {
        target: { value: "Syria transfer" },
      });
      fireEvent.click(screen.getByTestId("custom-service-via-partner-toggle"));
      click("stub-partner");
      fireEvent.click(screen.getByTestId("custom-service-payout-toggle"));
      type("svc-cost", "97");
      type("svc-price", "100");
      await submit("form.submitPayout", "Submit Payout");
      await waitFor(() => expect(mockApi.addCustomService).toHaveBeenCalled());
    },
    check: (c) => {
      expect(c.add[0]).toMatchObject({
        partnerMode: "VIA",
        direction: "OUT",
        cost_usd: 97,
        price_usd: 100,
      });
    },
  },
  {
    name: "in a customer session → basket item",
    session: true,
    setup: () => {
      stubLines = [{ id: "a", method: "CASH", currencyCode: "USD", amount: 10 }];
    },
    run: async () => {
      fireEvent.change(screen.getByTestId("stub-search"), {
        target: { value: "Screen fix" },
      });
      type("svc-cost", "4");
      type("svc-price", "10");
      click("stub-pay");
      await submit("form.submitService", "Submit Service");
      await waitFor(() => expect(mockAddToCart).toHaveBeenCalled());
    },
    check: (c) => {
      expect(c.add).toHaveLength(0);
      expect(c.cart[0]).toMatchObject({
        module: "custom_service",
        label: "Service: Screen fix - $10.00",
        amount: 10,
        currency: "USD",
        ipcChannel: "custom-services:add",
      });
    },
  },
  {
    name: "Hold Money: hold USD + LBP",
    setup: () => {
      stubLines = [
        { id: "a", method: "CASH", currencyCode: "USD", amount: 50 },
        { id: "b", method: "CASH", currencyCode: "LBP", amount: 100000 },
      ];
    },
    run: async () => {
      clickButton(tx("categories.hold_money", "Hold Money"));
      click("pick-client");
      type("hold-phone", "70999888");
      type("hold-note", "back Friday");
      type("hold-usd", "50");
      type("hold-lbp", "100000");
      click("stub-rate");
      click("stub-pay");
      const button = screen.getByTestId("hold-money-submit");
      await waitFor(() => expect(button).not.toBeDisabled());
      fireEvent.click(button);
      await waitFor(() => expect(mockApi.holdMoney.create).toHaveBeenCalled());
    },
    check: (c) => {
      expect(c.hold[0]).toMatchObject({
        client_name: "Ali",
        client_id: 7,
        phone_number: "70999888",
        notes: "back Friday",
        usd_amount: 50,
        lbp_amount: 100000,
        exchange_rate: 87000,
      });
    },
  },
  {
    name: "Hold Money: partial pickup",
    setup: () => {
      stubLines = [{ id: "a", method: "CASH", currencyCode: "USD", amount: 20 }];
    },
    run: async () => {
      clickButton(tx("categories.hold_money", "Hold Money"));
      fireEvent.click(await screen.findByTestId("hold-collect-5"));
      fireEvent.change(screen.getByTestId("hold-pickup-usd"), {
        target: { value: "20" },
      });
      click("stub-pay");
      const button = screen.getByTestId("hold-money-pickup-submit");
      await waitFor(() => expect(button).not.toBeDisabled());
      fireEvent.click(button);
      await waitFor(() => expect(mockApi.holdMoney.collect).toHaveBeenCalled());
    },
    check: (c) => {
      expect(c.collect[0]).toMatchObject({
        id: 5,
        usd_amount: 20,
        lbp_amount: 0,
        exchange_rate: 89000,
      });
    },
  },
  {
    name: "History: advance fulfilment, change work status, void",
    run: async () => {
      clickButton(tx("header.history", "History"));
      fireEvent.click(
        await screen.findByTestId("custom-service-advance-fulfillment-11"),
      );
      fireEvent.change(screen.getByTestId("custom-service-work-status-12"), {
        target: { value: "Ready" },
      });
      fireEvent.click(
        screen.getAllByTitle(tx("history.voidService", "Void service"))[0],
      );
      await waitFor(() =>
        expect(mockApi.deleteCustomService).toHaveBeenCalled(),
      );
    },
    check: (c) => {
      expect(c.advance).toEqual([{ id: 11, fulfillment_status: "ISSUED" }]);
      expect(c.work).toEqual([{ id: 12, work_status: "Ready" }]);
      expect(c.del).toEqual([12]);
    },
  },
];

function resetMocks() {
  jest.clearAllMocks();
  stubLines = [];
  stubReturn = [];
  mockApi.addCustomService.mockResolvedValue({ success: true, id: 99 });
  mockApi.deleteCustomService.mockResolvedValue({ success: true });
  mockApi.advanceCustomServiceFulfillment.mockResolvedValue({ success: true });
  mockApi.setCustomServiceWorkStatus.mockResolvedValue({ success: true });
  mockApi.getProducts.mockResolvedValue([]);
  mockApi.getAllSettings.mockResolvedValue([]);
  mockApi.servicePresets.list.mockResolvedValue({ success: true, data: [] });
  mockApi.holdMoney.list.mockResolvedValue({ success: true, data: [HOLD] });
  mockApi.holdMoney.create.mockResolvedValue({ success: true });
  mockApi.holdMoney.collect.mockResolvedValue({ success: true });
  mockApi.holdMoney.pickups.mockResolvedValue({ success: true, data: [] });
}

async function capture(s: Scenario): Promise<Captured> {
  resetMocks();
  s.setup?.();
  mockSession.activeSession = s.session
    ? { id: 3, customer_name: "Rami" }
    : null;
  render(<CustomServices />);
  await s.run();
  const calls = (m: jest.Mock) => m.mock.calls.map((c) => c[0]);
  const out: Captured = {
    add: calls(mockApi.addCustomService),
    cart: calls(mockAddToCart),
    hold: calls(mockApi.holdMoney.create),
    collect: calls(mockApi.holdMoney.collect),
    advance: calls(mockApi.advanceCustomServiceFulfillment),
    work: calls(mockApi.setCustomServiceWorkStatus),
    del: calls(mockApi.deleteCustomService),
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

describe("Services payloads are identical in English and Arabic (LIRA-331)", () => {
  it.each(SCENARIOS.map((s) => [s.name, s] as const))(
    "%s",
    async (_name, scenario) => {
      await i18n.changeLanguage("en");
      const en = await capture(scenario);
      scenario.check(en);

      const { loadLanguage } = await import("@/i18n/setup");
      await loadLanguage("ar");
      await i18n.changeLanguage("ar");
      expect(i18n.t("customServices:page.title")).toBe("الخدمات");

      const ar = await capture(scenario);
      expect(ar).toEqual(en);
    },
  );
});
