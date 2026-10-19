/** @jest-environment jsdom */

/**
 * LIRA-331 T044 (form half) — every Mobile Recharge form that builds its own
 * payload sends the SAME payload in English and in Arabic (research R9,
 * rule 28d). The page-level closures (MTC / Alfa credit, days and Alfa Gift;
 * Binance) are walked in pages/Recharge/__tests__/Recharge.payloadLanguage.
 *
 * Walked here, each once per language, the captured API calls deep-equal:
 *  - Katsh, iPick and Whish App bills (KatshForm / FinancialForm): walk-in,
 *    the cross-provider basket (one payment), the session basket, and the
 *    basket-wide For Partner order;
 *  - OMT App / Whish App transfers (OmtWhishAppTransferForm): send, receive
 *    (payout), session basket, For Partner;
 *  - MTC credit For Partner (TelecomForm) and Binance For Partner
 *    (CryptoForm), which bypass the page's closures.
 *  - added with the conversion (T052): Whish App bills in USD mode and in a
 *    session, Katsh BILL walk-in and in a session, OMT App receive, Whish App
 *    send walk-in, Whish App receive For Partner, the wallet exchange
 *    (WalletExchangePanel), the OMT App cash-out modal, the shop-line
 *    self-charge (KatshForm), Binance cash-out For Partner, OMT App / Whish
 *    App receive in a session, and iPick BILL walk-in.
 *
 * Selectors never depend on the language: data-testids, element ids, the
 * catalog items' own labels (data), and a ServiceTypeTabs stub keyed by the
 * option `id` (a code, never a translated label).
 *
 * Harness from RechargeBasket.crossProvider.test.tsx and
 * OmtWhishAppTransferForm.transactionDetails.test.tsx (rule 25: every useApi
 * / useSession mock is ONE module-level object).
 *
 * Rule 17: not failing-first (guard against future drift). Written before
 * the module's conversion and passing on the unconverted forms, as a payload
 * equality guard does by nature.
 */
import { useState } from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { i18n, switchLanguage } from "@/i18n/setup";
import { KatshForm } from "../KatshForm";
import { FinancialForm } from "../FinancialForm";
import { OmtWhishAppTransferForm } from "../OmtWhishAppTransferForm";
import { TelecomForm } from "../TelecomForm";
import { CryptoForm } from "../CryptoForm";
import { OmtAppCashoutModal } from "../OmtAppCashoutModal";
import { RechargeBasketProvider } from "../../context/RechargeBasketContext";
import type {
  ServiceItem,
  ProviderKey,
} from "../../hooks/useMobileServiceItems";
import { PROVIDER_CONFIGS, type ProviderConfig } from "../../types";

jest.mock("@liratek/core", () => jest.requireActual("@liratek/core"));

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 42 });
const mockProcessRecharge = jest
  .fn()
  .mockResolvedValue({ success: true, id: 43 });
const mockRechargeBasketCheckout = jest
  .fn()
  .mockResolvedValue({ success: true, sessionId: 9 });
const mockRechargePartnerOrder = jest
  .fn()
  .mockResolvedValue({ success: true, ids: [1, 2] });
const mockWalletExchangeCreate = jest
  .fn()
  .mockResolvedValue({ success: true, amountOut: 8_950_000 });
const mockCashoutConfirm = jest.fn().mockResolvedValue(undefined);
const mockSelfChargeTelecomItem = jest.fn().mockResolvedValue({
  success: true,
  data: { costLbp: 3_000_000, creditsAdded: 30, validityDaysAdded: 365 },
});
/** The shop's primary MTC line; only the self-charge scenario sets one. */
const mockPrimary: { mtc: Record<string, unknown> | null } = { mtc: null };

const mockApi = {
  addOMTTransaction: mockAddOMTTransaction,
  processRecharge: mockProcessRecharge,
  rechargeBasketCheckout: mockRechargeBasketCheckout,
  rechargePartnerOrder: mockRechargePartnerOrder,
  walletExchange: { create: mockWalletExchangeCreate },
  getAllSettings: jest.fn().mockResolvedValue([]),
  getActiveCarrierLines: jest.fn().mockResolvedValue([]),
  getClients: jest.fn().mockResolvedValue([]),
  getActiveMobileServiceItems: jest.fn().mockResolvedValue([]),
  getPrimaryCarrierLine: jest.fn(async (carrier: string) => ({
    success: true,
    data: carrier === "mtc" ? mockPrimary.mtc : null,
  })),
  // LIRA-338 — the charge window lists the active lines itself.
  getAllActiveCarrierLines: jest.fn(async () =>
    mockPrimary.mtc ? [mockPrimary.mtc] : [],
  ),
  getResaleLines: jest.fn().mockResolvedValue([]),
  selfChargeTelecomItem: mockSelfChargeTelecomItem,
  createMobileServiceItem: jest.fn().mockResolvedValue({ success: true }),
  getPendingCarrierLineOwedDeliveries: jest
    .fn()
    .mockResolvedValue({ success: true, data: [] }),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  // Keyed by the option id (a code), so the direction is picked the same
  // way in both languages.
  ServiceTypeTabs: (props: {
    options: Array<{ id: string; label: string }>;
    onChange: (id: string) => void;
  }) => (
    <div>
      {props.options.map((o) => (
        <button
          key={o.id}
          type="button"
          data-testid={`opt-${o.id}`}
          onClick={() => props.onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  ),
}));

const mockAddToCart = jest.fn();
const mockSession: { activeSession: { id: number } | null } = {
  activeSession: null,
};
const mockSessionValue = {
  get activeSession() {
    return mockSession.activeSession;
  },
  linkTransaction: jest.fn(),
  addToCart: mockAddToCart,
};
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => mockSessionValue,
}));

const mockAuthValue = { user: { id: 5, role: "admin" } };
jest.mock("@/features/auth/context/AuthContext", () => ({
  useOptionalAuth: () => mockAuthValue,
  useAuth: () => mockAuthValue,
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ buyRate: 89_000, sellRate: 89_500 }),
}));
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [{ code: "CASH", label: "Cash" }],
    drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
  }),
}));
jest.mock("../../utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn().mockResolvedValue({ ok: true, id: null }),
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
jest.mock("@/assets/logos/alfa.svg?react", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/assets/logos/mtc.svg?react", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: () => <input data-testid="stub-client-input" />,
}));
jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: (props: { onSelect: (id: number | null) => void }) => (
    <button
      type="button"
      data-testid="stub-pick-partner"
      onClick={() => props.onSelect(7)}
    />
  ),
}));
jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));
jest.mock("../HistoryModal", () => ({
  HistoryModal: () => null,
}));
jest.mock("../CarrierLinesPanel", () => ({
  CarrierLinesPanel: () => null,
}));
jest.mock("@/shared/utils/clientVouchers", () => ({
  fetchClientVouchers: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

/** PaymentSheet stub: pays the sheet's total in its own currency, exactly. */
jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: {
    open: boolean;
    totalAmount: number;
    totalAmountCurrency?: string;
    onPaymentChange: (lines: unknown[]) => void;
    onConfirm: () => void;
  }) =>
    props.open ? (
      <div data-testid="stub-payment-sheet">
        <button
          data-testid="stub-pay-exact"
          onClick={() =>
            props.onPaymentChange([
              {
                id: "L1",
                method: "CASH",
                currencyCode: props.totalAmountCurrency ?? "USD",
                amount: props.totalAmount,
              },
            ])
          }
        />
        <button data-testid="stub-confirm" onClick={props.onConfirm} />
      </div>
    ) : null,
}));

// A scenario that alerts or confirms "no" is a broken scenario; partner
// basket confirms are accepted.
const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
jest.spyOn(window, "confirm").mockReturnValue(true);

// ── Fixtures ────────────────────────────────────────────────────────────────

const KATSH_ITEM: ServiceItem = {
  key: "Katsh/Gaming/Pubg/60 UC",
  provider: "Katsh",
  category: "Gaming",
  subcategory: "Pubg",
  label: "60 UC",
  catalogCost: 82_340,
  catalogSellPrice: 90_000,
  sortOrder: 0,
};
const IPICK_ITEM: ServiceItem = {
  key: "iPick/Gaming/Free Fire/100 Diamonds",
  provider: "iPick",
  category: "Gaming",
  subcategory: "Free Fire",
  label: "100 Diamonds",
  catalogCost: 150_000,
  catalogSellPrice: 180_000,
  sortOrder: 0,
};
const WHISH_ITEM: ServiceItem = {
  key: "WHISH_APP/Gaming/PlayStation LEB/PSN $10 - LEBANON",
  provider: "WHISH_APP",
  category: "Gaming",
  subcategory: "PlayStation LEB",
  label: "PSN $10 - LEBANON",
  catalogCost: 897_000,
  catalogSellPrice: 900_000,
  catalogCostUsd: 9.5,
  catalogSellPriceUsd: 10,
  sortOrder: 0,
};

function catalogConfig(key: "Katsh" | "iPick" | "WHISH_APP"): ProviderConfig {
  return {
    key,
    label: key === "WHISH_APP" ? "Whish App" : key,
    module: "ipec_katch",
    drawer: key,
    formMode: "financial",
    color: "text-slate-400",
    bgTint: "bg-slate-400/10",
    activeBg: "bg-slate-500",
    activeText: "text-white",
    badgeCls: "bg-slate-400/10 text-slate-400",
    iconKey: "Zap",
    hasSupplier: true,
  };
}

const catalogItems = (p: ProviderKey, category: string): ServiceItem[] =>
  category !== "Gaming"
    ? []
    : p === "Katsh"
      ? [KATSH_ITEM]
      : p === "iPick"
        ? [IPICK_ITEM]
        : p === "WHISH_APP"
          ? [WHISH_ITEM]
          : [];

type Tab = "Katsh" | "iPick" | "WHISH_APP";

/** The Recharge page's catalog shape: KatshForm for Katsh / iPick,
 *  FinancialForm for Whish App bills, one shared basket. */
function CatalogPage({
  whishCurrency = "LBP",
}: { whishCurrency?: "USD" | "LBP" } = {}) {
  const [tab, setTab] = useState<Tab>("Katsh");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <RechargeBasketProvider>
        <button data-testid="tab-Katsh" onClick={() => setTab("Katsh")} />
        <button data-testid="tab-iPick" onClick={() => setTab("iPick")} />
        <button
          data-testid="tab-WHISH_APP"
          onClick={() => setTab("WHISH_APP")}
        />
        {tab === "WHISH_APP" ? (
          <FinancialForm
            activeConfig={catalogConfig("WHISH_APP")}
            finTransactions={[]}
            activeProvider="WHISH_APP"
            getCategoriesForProvider={() => ["Gaming"]}
            getServiceItems={catalogItems}
            methods={[{ code: "CASH", label: "Cash" }]}
            drawerAffectingMethods={[{ code: "CASH", label: "Cash" }]}
            clientName=""
            setClientName={jest.fn()}
            loadFinancialData={jest.fn()}
            formatAmount={(v) => String(v)}
            showHistory={false}
            setShowHistory={jest.fn()}
            currency={whishCurrency}
          />
        ) : (
          <KatshForm
            activeConfig={catalogConfig(tab)}
            activeProvider={tab}
            getCategoriesForProvider={() => ["Gaming"]}
            getServiceItems={catalogItems}
            methods={[{ code: "CASH", label: "Cash" }]}
            loadFinancialData={jest.fn()}
            formatAmount={(v) => String(v)}
            alfaCreditSellRate={100_000}
            exchangeRate={89_500}
            showHistory={false}
            setShowHistory={jest.fn()}
          />
        )}
      </RechargeBasketProvider>
    </QueryClientProvider>
  );
}

function TransferPage({ provider }: { provider: "OMT_APP" | "WHISH_APP" }) {
  return (
    <OmtWhishAppTransferForm
      activeProvider={provider}
      transactions={[]}
      loadFinancialData={jest.fn()}
      formatAmount={(v: number, c: string) => `${v} ${c}`}
    />
  );
}

function noop() {}

function TelecomPage() {
  return (
    <TelecomForm
      isMTC
      rechargeType="CREDIT_TRANSFER"
      setRechargeType={noop}
      isSubmitting={false}
      handleQuickAmount={noop}
      showHistory={false}
      setShowHistory={noop}
      rechargeHistory={[]}
      telecomAmount="3"
      setTelecomAmount={noop}
      onTelecomAmountChange={noop}
      telecomPrice="280000"
      setTelecomPrice={noop}
      phoneNumber="70123456"
      setPhoneNumber={noop}
      paidBy="CASH"
      setPaidBy={noop}
      methods={[{ code: "CASH", label: "Cash" }]}
      showClientSearch={false}
      setShowClientSearch={noop}
      telecomClientId={null}
      setTelecomClientId={noop}
      telecomClientName=""
      setTelecomClientName={noop}
      telecomClientPhone=""
      setTelecomClientPhone={noop}
      searchClients={noop}
      clientSearchResults={[]}
      selectClient={noop}
      activeProvider="MTC"
      activeConfig={undefined}
      handleTelecomSubmit={noop}
      giftTierKey=""
      setGiftTierKey={noop}
      giftAmountUsd=""
      setGiftAmountUsd={noop}
      giftPriceLbp=""
      setGiftPriceLbp={noop}
      giftCostLbp=""
      setGiftCostLbp={noop}
      handleAlfaGiftSubmit={noop}
      paymentLines={[]}
      setPaymentLines={noop}
      clientName=""
      setClientName={noop}
      alfaCreditCostRate={85000}
      telecomDaysCostUsd=""
      setTelecomDaysCostUsd={noop}
      isShopLineMatch={false}
      shopLineBuyback
      setShopLineBuyback={noop}
      primaryLine={null}
    />
  );
}

function CryptoPage({ type = "SEND" }: { type?: "SEND" | "RECEIVE" } = {}) {
  const config = PROVIDER_CONFIGS.find((c) => c.key === "BINANCE");
  if (!config) throw new Error("BINANCE provider config missing");
  return (
    <CryptoForm
      activeConfig={config}
      cryptoType={type}
      setCryptoType={noop}
      cryptoAmount="100"
      setCryptoAmount={noop}
      cryptoClientName=""
      setCryptoClientName={noop}
      cryptoClientPhone=""
      setCryptoClientPhone={noop}
      cryptoClientId={null}
      setCryptoClientId={noop}
      cryptoDescription="TRX-0x99"
      setCryptoDescription={noop}
      cryptoFee="2"
      setCryptoFee={noop}
      feeIncluded={false}
      setFeeIncluded={noop}
      feeCollectedSeparately={false}
      setFeeCollectedSeparately={noop}
      onCustomerLinesChange={noop}
      onCustomerForgivenChange={noop}
      customerPaymentMethods={[]}
      handleCryptoSubmit={noop}
      isSubmitting={false}
      binanceTransactions={[]}
      loadCryptoData={noop}
      showHistory={false}
      setShowHistory={noop}
      paymentMethods={[{ code: "CASH", label: "Cash" }]}
      onPaymentLinesChange={noop}
      exchangeRate={89500}
    />
  );
}

const SHOP_MTC_LINE = {
  id: 1,
  carrier: "mtc",
  phone_number: "03999999",
  label: "Shop MTC",
  credits: 100,
  validity_expires_at: "2026-12-31",
  days_owed: 0,
  is_primary: 1,
  is_active: 1,
};
const MTC_CARD: ServiceItem = {
  id: 11,
  key: "iPick/mtc/Prepaid/365",
  provider: "iPick",
  category: "mtc",
  subcategory: "Prepaid",
  label: "365",
  catalogCost: 3_000_000,
  catalogSellPrice: 3_400_000,
  sortOrder: 0,
  validityDays: 365,
  credits: 30,
};

/** iPick with one MTC card the shop can charge to its own line. */
function SelfChargePage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <RechargeBasketProvider>
        <KatshForm
          activeConfig={catalogConfig("iPick")}
          activeProvider="iPick"
          getCategoriesForProvider={() => ["mtc"]}
          getServiceItems={(p, c) =>
            p === "iPick" && c === "mtc" ? [MTC_CARD] : []
          }
          methods={[{ code: "CASH", label: "Cash" }]}
          loadFinancialData={jest.fn()}
          formatAmount={(v) => String(v)}
          alfaCreditSellRate={100_000}
          exchangeRate={89_500}
          showHistory={false}
          setShowHistory={jest.fn()}
        />
      </RechargeBasketProvider>
    </QueryClientProvider>
  );
}

// ── Steps (all language-independent) ────────────────────────────────────────

const click = (testId: string) => fireEvent.click(screen.getByTestId(testId));
async function pick(label: string) {
  fireEvent.click((await screen.findAllByText(label))[0]!);
}
function typeInto(id: string, value: string) {
  fireEvent.change(document.getElementById(id) as HTMLInputElement, {
    target: { value },
  });
}
async function payExactAndConfirm() {
  await screen.findByTestId("stub-payment-sheet");
  click("stub-pay-exact");
  click("stub-confirm");
}

const CALLS = {
  selfChargeTelecomItem: mockSelfChargeTelecomItem,
  walletExchangeCreate: mockWalletExchangeCreate,
  cashoutConfirm: mockCashoutConfirm,
  addOMTTransaction: mockAddOMTTransaction,
  processRecharge: mockProcessRecharge,
  rechargeBasketCheckout: mockRechargeBasketCheckout,
  rechargePartnerOrder: mockRechargePartnerOrder,
  addToCart: mockAddToCart,
};
type CallName = keyof typeof CALLS;

interface Scenario {
  name: string;
  session?: boolean;
  render: () => React.ReactElement;
  drive: () => Promise<void>;
  call: CallName;
  count?: number;
}

const SCENARIOS: Scenario[] = [
  {
    name: "Katsh card, walk-in",
    render: () => <CatalogPage />,
    drive: async () => {
      await pick("60 UC");
      click("katsh-proceed");
      await payExactAndConfirm();
    },
    call: "addOMTTransaction",
  },
  {
    name: "iPick card, walk-in",
    render: () => <CatalogPage />,
    drive: async () => {
      click("tab-iPick");
      await pick("100 Diamonds");
      click("katsh-proceed");
      await payExactAndConfirm();
    },
    call: "addOMTTransaction",
  },
  {
    name: "Whish App bill card, walk-in",
    render: () => <CatalogPage />,
    drive: async () => {
      click("tab-WHISH_APP");
      await pick("PSN $10 - LEBANON");
      click("financial-proceed");
      await payExactAndConfirm();
    },
    call: "addOMTTransaction",
  },
  {
    name: "Katsh + Whish App basket, one payment",
    render: () => <CatalogPage />,
    drive: async () => {
      await pick("60 UC");
      click("tab-WHISH_APP");
      await pick("PSN $10 - LEBANON");
      click("tab-Katsh");
      await screen.findAllByText("60 UC");
      click("katsh-proceed");
      await payExactAndConfirm();
    },
    call: "rechargeBasketCheckout",
  },
  {
    name: "iPick + Katsh, session basket (one cart entry per provider)",
    session: true,
    render: () => <CatalogPage />,
    drive: async () => {
      click("tab-iPick");
      await pick("100 Diamonds");
      click("tab-Katsh");
      await pick("60 UC");
      click("katsh-proceed");
    },
    call: "addToCart",
    count: 2,
  },
  {
    name: "Katsh + Whish App, For Partner",
    render: () => <CatalogPage />,
    drive: async () => {
      await pick("60 UC");
      click("tab-WHISH_APP");
      await pick("PSN $10 - LEBANON");
      click("tab-Katsh");
      await screen.findAllByText("60 UC");
      click("katsh-for-partner-toggle");
      click("stub-pick-partner");
      click("katsh-proceed");
    },
    call: "rechargePartnerOrder",
  },
  {
    name: "OMT App send, walk-in",
    render: () => <TransferPage provider="OMT_APP" />,
    drive: async () => {
      typeInto("transfer-amount", "100");
      typeInto("transfer-fee", "2");
      click("transfer-proceed");
      await payExactAndConfirm();
    },
    call: "addOMTTransaction",
  },
  {
    name: "Whish App receive (payout), walk-in",
    render: () => <TransferPage provider="WHISH_APP" />,
    drive: async () => {
      click("opt-RECEIVE");
      typeInto("transfer-amount", "50");
      typeInto("transfer-fee", "1");
      click("transfer-proceed");
      await payExactAndConfirm();
    },
    call: "addOMTTransaction",
  },
  {
    name: "Whish App send, session basket",
    session: true,
    render: () => <TransferPage provider="WHISH_APP" />,
    drive: async () => {
      // Whish App SEND has no fee field.
      typeInto("transfer-amount", "100");
      click("transfer-proceed");
    },
    call: "addToCart",
  },
  {
    name: "OMT App send, For Partner",
    render: () => <TransferPage provider="OMT_APP" />,
    drive: async () => {
      typeInto("transfer-amount", "100");
      typeInto("transfer-fee", "2");
      click("omt-whish-transfer-for-partner-toggle");
      click("stub-pick-partner");
      click("transfer-proceed");
    },
    call: "addOMTTransaction",
  },
  {
    name: "Whish App bill card, USD mode, walk-in",
    render: () => <CatalogPage whishCurrency="USD" />,
    drive: async () => {
      click("tab-WHISH_APP");
      await pick("PSN $10 - LEBANON");
      click("financial-proceed");
      await payExactAndConfirm();
    },
    call: "addOMTTransaction",
  },
  {
    name: "Whish App bill card, session basket",
    session: true,
    render: () => <CatalogPage />,
    drive: async () => {
      click("tab-WHISH_APP");
      await pick("PSN $10 - LEBANON");
      click("financial-proceed");
    },
    call: "addToCart",
  },
  {
    name: "Katsh BILL, walk-in",
    render: () => <CatalogPage />,
    drive: async () => {
      await screen.findAllByText("60 UC");
      fireEvent.change(screen.getByTestId("katsh-bill-amount"), {
        target: { value: "250000" },
      });
      click("katsh-add-bill");
      click("katsh-proceed");
      await payExactAndConfirm();
    },
    call: "addOMTTransaction",
  },
  {
    name: "Katsh BILL, session basket",
    session: true,
    render: () => <CatalogPage />,
    drive: async () => {
      await screen.findAllByText("60 UC");
      fireEvent.change(screen.getByTestId("katsh-bill-amount"), {
        target: { value: "250000" },
      });
      click("katsh-add-bill");
    },
    call: "addToCart",
  },
  {
    name: "OMT App receive, walk-in",
    render: () => <TransferPage provider="OMT_APP" />,
    drive: async () => {
      click("opt-RECEIVE");
      typeInto("transfer-amount", "75");
      click("transfer-proceed");
      await payExactAndConfirm();
    },
    call: "addOMTTransaction",
  },
  {
    name: "Whish App send, walk-in",
    render: () => <TransferPage provider="WHISH_APP" />,
    drive: async () => {
      typeInto("transfer-amount", "40");
      click("transfer-proceed");
      await payExactAndConfirm();
    },
    call: "addOMTTransaction",
  },
  {
    name: "Whish App receive, For Partner",
    render: () => <TransferPage provider="WHISH_APP" />,
    drive: async () => {
      click("opt-RECEIVE");
      typeInto("transfer-amount", "60");
      typeInto("transfer-fee", "1");
      click("omt-whish-transfer-for-partner-toggle");
      click("stub-pick-partner");
      click("transfer-proceed");
    },
    call: "addOMTTransaction",
  },
  {
    name: "OMT App wallet exchange, USD to LBP",
    render: () => <TransferPage provider="OMT_APP" />,
    drive: async () => {
      click("opt-EXCHANGE");
      fireEvent.change(await screen.findByTestId("wallet-exchange-amount"), {
        target: { value: "100" },
      });
      fireEvent.change(screen.getByTestId("wallet-exchange-rate"), {
        target: { value: "89500" },
      });
      click("wallet-exchange-confirm");
    },
    call: "walletExchangeCreate",
  },
  {
    name: "OMT App cash-out to OMT (modal), LBP",
    render: () => (
      <OmtAppCashoutModal
        isOpen
        onClose={jest.fn()}
        onConfirm={mockCashoutConfirm}
        walletBalance={{ usdBalance: 500, lbpBalance: 50_000_000 }}
      />
    ),
    drive: async () => {
      fireEvent.change(screen.getByTestId("omt-app-cashout-currency"), {
        target: { value: "LBP" },
      });
      fireEvent.change(screen.getByTestId("omt-app-cashout-amount"), {
        target: { value: "1500000" },
      });
      click("omt-app-cashout-submit");
    },
    call: "cashoutConfirm",
  },
  {
    name: "iPick card charged to the shop's own MTC line",
    render: () => {
      mockPrimary.mtc = SHOP_MTC_LINE;
      return <SelfChargePage />;
    },
    drive: async () => {
      fireEvent.click(await screen.findByTestId("katsh-self-charge"));
      await waitFor(() =>
        expect(screen.getByTestId("katsh-self-charge-confirm")).toBeEnabled(),
      );
      click("katsh-self-charge-confirm");
    },
    call: "selfChargeTelecomItem",
  },
  {
    name: "iPick BILL, walk-in",
    render: () => <CatalogPage />,
    drive: async () => {
      click("tab-iPick");
      await screen.findAllByText("100 Diamonds");
      fireEvent.change(screen.getByTestId("katsh-bill-amount"), {
        target: { value: "12.5" },
      });
      click("katsh-add-bill");
      click("katsh-proceed");
      await payExactAndConfirm();
    },
    call: "addOMTTransaction",
  },
  {
    name: "OMT App receive, session basket",
    session: true,
    render: () => <TransferPage provider="OMT_APP" />,
    drive: async () => {
      click("opt-RECEIVE");
      typeInto("transfer-amount", "75");
      click("transfer-proceed");
    },
    call: "addToCart",
  },
  {
    name: "Whish App receive, session basket",
    session: true,
    render: () => <TransferPage provider="WHISH_APP" />,
    drive: async () => {
      click("opt-RECEIVE");
      typeInto("transfer-amount", "50");
      typeInto("transfer-fee", "1");
      click("transfer-proceed");
    },
    call: "addToCart",
  },
  {
    name: "Binance cash-out, For Partner",
    render: () => <CryptoPage type="RECEIVE" />,
    drive: async () => {
      click("crypto-for-partner-toggle");
      click("stub-pick-partner");
      click("crypto-proceed");
    },
    call: "addOMTTransaction",
  },
  {
    name: "MTC credit, For Partner",
    render: () => <TelecomPage />,
    drive: async () => {
      click("recharge-for-partner-toggle");
      click("stub-pick-partner");
      click("telecom-proceed");
    },
    call: "processRecharge",
  },
  {
    name: "Binance send, For Partner",
    render: () => <CryptoPage />,
    drive: async () => {
      click("crypto-for-partner-toggle");
      click("stub-pick-partner");
      click("crypto-proceed");
    },
    call: "addOMTTransaction",
  },
];

type Captured = Record<CallName, unknown[]>;

/** Basket entry ids are uuids: numbered the same way in both runs. */
const uuidSpy = jest.spyOn(globalThis.crypto, "randomUUID");

/** Whether the last run's screen showed any Arabic text (proves the "ar"
 *  pass really rendered the converted, Arabic screen). */
let lastRunShowedArabic = false;

async function run(s: Scenario): Promise<Captured> {
  for (const m of Object.values(CALLS)) m.mockClear();
  let n = 0;
  uuidSpy.mockImplementation(
    () =>
      `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`,
  );
  render(s.render());
  lastRunShowedArabic = /[\u0600-\u06FF]/.test(document.body.textContent ?? "");
  await s.drive();
  await waitFor(() =>
    expect(CALLS[s.call]).toHaveBeenCalledTimes(s.count ?? 1),
  );
  const captured = Object.fromEntries(
    Object.entries(CALLS).map(([k, m]) => [k, m.mock.calls.map((c) => c[0])]),
  ) as Captured;
  cleanup();
  return captured;
}

/** The clock is pinned so `client_day` and any time-derived value agree. */
const NOW = new Date("2026-10-17T10:00:00");

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  alertSpy.mockClear();
});

afterEach(async () => {
  jest.useRealTimers();
  mockSession.activeSession = null;
  mockPrimary.mtc = null;
  await switchLanguage("en");
});

describe("Mobile Recharge forms — the payload does not depend on the language (LIRA-331)", () => {
  it.each(SCENARIOS)("$name", async (s) => {
    mockSession.activeSession = s.session ? { id: 5 } : null;

    await switchLanguage("en");
    const en = await run(s);
    await switchLanguage("ar");
    expect(i18n.language).toBe("ar");
    const ar = await run(s);
    expect(lastRunShowedArabic).toBe(true);

    expect(alertSpy).not.toHaveBeenCalled();
    expect(en[s.call]).toHaveLength(s.count ?? 1);
    expect(ar).toEqual(en);
  });
});
