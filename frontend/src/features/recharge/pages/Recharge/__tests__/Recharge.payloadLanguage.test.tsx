/** @jest-environment jsdom */

/**
 * LIRA-331 T044 (page half) — the Mobile Recharge page builds the SAME
 * payload whatever language the screen is in (research R9, rule 28d).
 *
 * The page owns the MTC / Alfa (Credit, Days, Alfa Gift) and Binance submit
 * closures. The forms are stubbed so those real closures run; every scenario
 * is driven once in English and once in Arabic and the captured API calls
 * (direct sale or session-basket item) must be deep-equal. The forms that
 * build their own payloads (Katsh / iPick, OMT App / Whish App, For Partner)
 * are walked in components/__tests__/recharge.payloadLanguage.test.tsx.
 *
 * Also walked (added with the conversion, T051/T052): the four Top-Up
 * confirm handlers (drawer transfer, supplier credit, partner, client) and
 * the OMT App "Cash Out to OMT" handler, with the TopUpModal and cash-out
 * modal stubbed to hand the page fixed data.
 *
 * Every selector is a data-testid on the stubs, so the test drives the page
 * identically in both languages.
 *
 * Rule 17: not failing-first (guard against future drift). Written before
 * the module's conversion and passing on the unconverted page, as a payload
 * equality guard does by nature (tasks.md, "Tests").
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import type { PaymentLine } from "@liratek/ui";
import { i18n, switchLanguage } from "@/i18n/setup";
import MobileRecharge from "../index";

const mockProcessRecharge = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 2 });
const mockAddToCart = jest.fn();
const mockTopUpApp = jest.fn().mockResolvedValue({ success: true });
const mockTopUpFromSupplier = jest.fn().mockResolvedValue({ success: true });
const mockTopUpFromPartner = jest.fn().mockResolvedValue({ success: true });
const mockTopUpFromClient = jest.fn().mockResolvedValue({ success: true });
const mockCashoutToSupplier = jest.fn().mockResolvedValue({ success: true });
const mockGetAllSettings = jest.fn().mockResolvedValue([]);

// One stable api object (rule 25).
const mockApi = {
  getAllSettings: mockGetAllSettings,
  getOMTHistory: jest.fn().mockResolvedValue([]),
  getOMTAnalytics: jest.fn().mockResolvedValue({
    today: { commission: 0, count: 0, byCurrency: [] },
    byProvider: [],
  }),
  getClients: jest.fn().mockResolvedValue([]),
  processRecharge: mockProcessRecharge,
  addOMTTransaction: mockAddOMTTransaction,
  topUpApp: mockTopUpApp,
  topUpFromSupplier: mockTopUpFromSupplier,
  topUpFromPartner: mockTopUpFromPartner,
  topUpFromClient: mockTopUpFromClient,
  cashoutToSupplier: mockCashoutToSupplier,
  getRechargeDrawerBalances: jest.fn().mockResolvedValue([]),
  getActiveCarrierLines: jest.fn().mockResolvedValue([]),
  getRechargeHistory: jest.fn().mockResolvedValue([]),
  getRechargeTodayStats: jest.fn().mockResolvedValue({
    count: 0,
    profit_usd: 0,
    profit_lbp: 0,
    byCurrency: [],
  }),
};

type TopUpStubProps = {
  isOpen: boolean;
  onConfirm: (d: {
    amount: number;
    currency: "USD" | "LBP";
    sourceDrawer: string;
  }) => Promise<void>;
  onConfirmSupplier?: (d: {
    amount: number;
    currency: "USD" | "LBP";
  }) => Promise<void>;
  onConfirmPartner?: (d: {
    partnerId: number;
    amount: number;
    currency: "USD" | "LBP";
  }) => Promise<void>;
  onConfirmClient?: (d: {
    amount: number;
    currency: "USD" | "LBP";
    fee: number;
    payments: { method: string; currencyCode: string; amount: number }[];
    clientId: number;
  }) => Promise<void>;
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  // Hands the page the same fixed data in both languages.
  TopUpModal: (p: TopUpStubProps) =>
    p.isOpen ? (
      <div>
        <button
          data-testid="stub-topup-drawer"
          onClick={() =>
            void p.onConfirm({
              amount: 100,
              currency: "USD",
              sourceDrawer: "General",
            })
          }
        />
        <button
          data-testid="stub-topup-supplier"
          onClick={() =>
            void p.onConfirmSupplier?.({ amount: 50, currency: "USD" })
          }
        />
        <button
          data-testid="stub-topup-partner"
          onClick={() =>
            void p.onConfirmPartner?.({
              partnerId: 7,
              amount: 2_000_000,
              currency: "LBP",
            })
          }
        />
        <button
          data-testid="stub-topup-client"
          onClick={() =>
            void p.onConfirmClient?.({
              amount: 20,
              currency: "USD",
              fee: 1,
              payments: [{ method: "CASH", currencyCode: "USD", amount: 19 }],
              clientId: 7,
            })
          }
        />
      </div>
    ) : null,
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

type Line = PaymentLine;

type TelecomStubProps = {
  setRechargeType: (t: string) => void;
  setTelecomAmount: (v: string) => void;
  setTelecomPrice: (v: string) => void;
  setTelecomDaysCostUsd: (v: string) => void;
  onDaysPriceUsdChange?: (v: string) => void;
  setPhoneNumber: (v: string) => void;
  setTelecomClientName: (v: string) => void;
  setTelecomClientPhone: (v: string) => void;
  setPaymentLines: (l: Line[]) => void;
  onReturnChange?: (l: Line[]) => void;
  onDiscountChange?: (d: number) => void;
  onExtraChange?: (e: number) => void;
  handleTelecomSubmit: () => void;
  handleAlfaGiftSubmit: () => void;
  setGiftTierKey: (v: string) => void;
  setGiftAmountUsd: (v: string) => void;
  setGiftPriceLbp: (v: string) => void;
  setGiftCostLbp: (v: string) => void;
};

type CryptoStubProps = {
  setCryptoType: (t: "SEND" | "RECEIVE") => void;
  setCryptoAmount: (v: string) => void;
  setCryptoFee: (v: string) => void;
  setCryptoClientName: (v: string) => void;
  setCryptoDescription: (v: string) => void;
  onPaymentLinesChange: (lines: Line[]) => void;
  onReturnChange?: (lines: Line[]) => void;
  onDiscountChange?: (d: number) => void;
  handleCryptoSubmit: () => void;
};

jest.mock("../../../components", () => ({
  CompactStats: () => null,
  FinancialForm: () => null,
  KatshForm: () => null,
  OmtWhishAppTransferForm: () => null,
  OmtAppCashoutModal: (p: {
    isOpen: boolean;
    onConfirm: (d: { amount: number; currency: "USD" | "LBP" }) => void;
  }) =>
    p.isOpen ? (
      <button
        data-testid="stub-cashout-confirm"
        onClick={() => p.onConfirm({ amount: 1_500_000, currency: "LBP" })}
      />
    ) : null,
  ProviderTabs: ({
    onSelectProvider,
  }: {
    onSelectProvider: (p: string) => void;
  }) => (
    <div>
      <button data-testid="tab-MTC" onClick={() => onSelectProvider("MTC")} />
      <button data-testid="tab-Alfa" onClick={() => onSelectProvider("Alfa")} />
      <button
        data-testid="tab-BINANCE"
        onClick={() => onSelectProvider("BINANCE")}
      />
      <button
        data-testid="tab-OMT_APP"
        onClick={() => onSelectProvider("OMT_APP")}
      />
      <button
        data-testid="tab-WHISH_APP"
        onClick={() => onSelectProvider("WHISH_APP")}
      />
      <button
        data-testid="tab-Katsh"
        onClick={() => onSelectProvider("Katsh")}
      />
    </div>
  ),
  TelecomForm: (p: TelecomStubProps) => (
    <div data-testid="stub-telecom-form">
      <button
        data-testid="credit-sale"
        onClick={() => {
          p.setRechargeType("CREDIT_TRANSFER");
          p.setPhoneNumber("70123456");
          p.setTelecomAmount("3");
          p.setTelecomPrice("280000");
          p.setTelecomClientName("Rami Haddad");
          p.setTelecomClientPhone("71111222");
        }}
      />
      <button
        data-testid="credit-pay-usd-change-lbp"
        onClick={() => {
          p.setPaymentLines([
            { id: "L1", method: "CASH", currencyCode: "USD", amount: 5 },
          ]);
          p.onReturnChange?.([
            {
              id: "R1",
              method: "CASH",
              currencyCode: "LBP",
              amount: 165000,
            },
          ]);
          p.onDiscountChange?.(10000);
          p.onExtraChange?.(5000);
        }}
      />
      <button
        data-testid="pick-days"
        onClick={() => p.setRechargeType("DAYS")}
      />
      <button
        data-testid="days-sale"
        onClick={() => {
          p.setTelecomAmount("30");
          p.setTelecomDaysCostUsd("5");
          p.onDaysPriceUsdChange?.("7");
          p.setTelecomPrice("630000");
          p.setPaymentLines([
            { id: "L1", method: "CASH", currencyCode: "LBP", amount: 630000 },
          ]);
        }}
      />
      <button
        data-testid="gift-sale"
        onClick={() => {
          p.setGiftTierKey("7GB");
          p.setGiftAmountUsd("9");
          p.setGiftPriceLbp("900000");
          p.setGiftCostLbp("800000");
          p.setTelecomClientName("Rami Haddad");
          p.setPaymentLines([
            { id: "L1", method: "CASH", currencyCode: "LBP", amount: 900000 },
          ]);
        }}
      />
      <button data-testid="submit-telecom" onClick={p.handleTelecomSubmit} />
      <button data-testid="submit-gift" onClick={p.handleAlfaGiftSubmit} />
    </div>
  ),
  CryptoForm: (p: CryptoStubProps) => (
    <div data-testid="stub-crypto-form">
      <button
        data-testid="crypto-send"
        onClick={() => {
          p.setCryptoType("SEND");
          p.setCryptoAmount("100");
          p.setCryptoFee("2");
          p.setCryptoClientName("Rami Haddad");
          p.setCryptoDescription("TRX-0x99");
          p.onDiscountChange?.(0.5);
          p.onPaymentLinesChange([
            { id: "L1", method: "CASH", currencyCode: "USD", amount: 110 },
          ]);
          p.onReturnChange?.([
            { id: "R1", method: "CASH", currencyCode: "LBP", amount: 760750 },
          ]);
        }}
      />
      <button
        data-testid="crypto-receive"
        onClick={() => {
          p.setCryptoType("RECEIVE");
          p.setCryptoAmount("50");
          p.setCryptoFee("1");
          p.setCryptoClientName("Rami Haddad");
          p.onPaymentLinesChange([
            { id: "L1", method: "CASH", currencyCode: "USD", amount: 49 },
          ]);
        }}
      />
      <button data-testid="crypto-confirm" onClick={p.handleCryptoSubmit} />
    </div>
  ),
}));

const mockSession: { activeSession: { id: number } | null } = {
  activeSession: null,
};
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: mockSession.activeSession,
    linkTransaction: jest.fn(),
    addToCart: mockAddToCart,
  }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, role: "admin" } }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [{ code: "CASH", label: "Cash" }],
    drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000 }),
}));

jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => ({
    formatAmount: (v: number, c: string) => `${v} ${c}`,
  }),
}));

jest.mock("../../../hooks/useMobileServiceItems", () => ({
  useMobileServiceItems: () => ({
    getCategoriesForProvider: () => [],
    getItems: () => [],
    refresh: jest.fn(),
  }),
  formatCatalogItemName: (item: { label: string }) => item.label,
}));

jest.mock("../../../utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn().mockResolvedValue({ ok: true, id: 7 }),
}));

jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: () => null,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

// The page alerts on a refusal; a scenario that alerts is a broken scenario.
const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});

const CALLS = {
  processRecharge: mockProcessRecharge,
  addOMTTransaction: mockAddOMTTransaction,
  addToCart: mockAddToCart,
  topUpApp: mockTopUpApp,
  topUpFromSupplier: mockTopUpFromSupplier,
  topUpFromPartner: mockTopUpFromPartner,
  topUpFromClient: mockTopUpFromClient,
  cashoutToSupplier: mockCashoutToSupplier,
};
type CallName = keyof typeof CALLS;
type Tab = "MTC" | "Alfa" | "BINANCE" | "OMT_APP" | "WHISH_APP" | "Katsh";
type Captured = Record<CallName, unknown[]>;

/** The clock is pinned so `client_day` and any time-derived value agree. */
const NOW = new Date("2026-10-17T10:00:00");

async function runScenario(
  tab: Tab,
  steps: string[],
  expectCall: CallName,
): Promise<Captured> {
  for (const m of Object.values(CALLS)) m.mockClear();

  render(<MobileRecharge />);
  await waitFor(() => expect(mockGetAllSettings).toHaveBeenCalled());
  fireEvent.click(screen.getByTestId(`tab-${tab}`));
  await screen.findByTestId(
    tab === "BINANCE"
      ? "stub-crypto-form"
      : tab === "MTC" || tab === "Alfa"
        ? "stub-telecom-form"
        : "recharge-topup-button",
  );
  // A step may only appear after the previous one (a modal opening).
  for (const id of steps) fireEvent.click(await screen.findByTestId(id));

  await waitFor(() => expect(CALLS[expectCall]).toHaveBeenCalledTimes(1));

  const captured = Object.fromEntries(
    Object.entries(CALLS).map(([k, m]) => [k, m.mock.calls.map((c) => c[0])]),
  ) as Captured;
  cleanup();
  return captured;
}

/** Runs one scenario in English, then in Arabic; returns both captures. */
async function inBothLanguages(
  run: () => Promise<Captured>,
): Promise<{ en: Captured; ar: Captured }> {
  await switchLanguage("en");
  const en = await run();
  await switchLanguage("ar");
  expect(i18n.language).toBe("ar");
  const ar = await run();
  await switchLanguage("en");
  return { en, ar };
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  mockSession.activeSession = null;
  alertSpy.mockClear();
});

afterEach(async () => {
  jest.useRealTimers();
  await switchLanguage("en");
});

const SCENARIOS: {
  name: string;
  tab: Tab;
  session: boolean;
  steps: string[];
  call: CallName;
}[] = [
  {
    name: "MTC credit, walk-in, USD paid with LBP change, discount + extra",
    tab: "MTC",
    session: false,
    steps: ["credit-sale", "credit-pay-usd-change-lbp", "submit-telecom"],
    call: "processRecharge",
  },
  {
    name: "Alfa credit, session basket",
    tab: "Alfa",
    session: true,
    steps: ["credit-sale", "submit-telecom"],
    call: "addToCart",
  },
  {
    name: "Alfa days, walk-in",
    tab: "Alfa",
    session: false,
    steps: ["pick-days", "days-sale", "submit-telecom"],
    call: "processRecharge",
  },
  {
    name: "MTC days, session basket",
    tab: "MTC",
    session: true,
    steps: ["pick-days", "days-sale", "submit-telecom"],
    call: "addToCart",
  },
  {
    name: "Alfa Gift, walk-in",
    tab: "Alfa",
    session: false,
    steps: ["gift-sale", "submit-gift"],
    call: "processRecharge",
  },
  {
    name: "Alfa Gift, session basket",
    tab: "Alfa",
    session: true,
    steps: ["gift-sale", "submit-gift"],
    call: "addToCart",
  },
  {
    name: "Binance send, walk-in, discount, USD paid with LBP change",
    tab: "BINANCE",
    session: false,
    steps: ["crypto-send", "crypto-confirm"],
    call: "addOMTTransaction",
  },
  {
    name: "Binance cash-out, walk-in",
    tab: "BINANCE",
    session: false,
    steps: ["crypto-receive", "crypto-confirm"],
    call: "addOMTTransaction",
  },
  {
    name: "Binance send, session basket",
    tab: "BINANCE",
    session: true,
    steps: ["crypto-send", "crypto-confirm"],
    call: "addToCart",
  },
  {
    name: "Katsh top-up from a drawer",
    tab: "Katsh",
    session: false,
    steps: ["recharge-topup-button", "stub-topup-drawer"],
    call: "topUpApp",
  },
  {
    name: "OMT App top-up on OMT credit (supplier)",
    tab: "OMT_APP",
    session: false,
    steps: ["recharge-topup-button", "stub-topup-supplier"],
    call: "topUpFromSupplier",
  },
  {
    name: "Whish App top-up from a partner",
    tab: "WHISH_APP",
    session: false,
    steps: ["recharge-topup-button", "stub-topup-partner"],
    call: "topUpFromPartner",
  },
  {
    name: "Whish App top-up bought from a client",
    tab: "WHISH_APP",
    session: false,
    steps: ["recharge-topup-button", "stub-topup-client"],
    call: "topUpFromClient",
  },
  {
    name: "OMT App cash-out to OMT",
    tab: "OMT_APP",
    session: false,
    steps: ["omt-app-cashout-button", "stub-cashout-confirm"],
    call: "cashoutToSupplier",
  },
];

describe("Recharge page — the payload does not depend on the language (LIRA-331)", () => {
  it.each(SCENARIOS)("$name", async ({ tab, session, steps, call }) => {
    mockSession.activeSession = session ? { id: 5 } : null;
    const { en, ar } = await inBothLanguages(() =>
      runScenario(tab, steps, call),
    );
    expect(alertSpy).not.toHaveBeenCalled();
    expect(en[call]).toHaveLength(1);
    expect(ar).toEqual(en);
  });
});
