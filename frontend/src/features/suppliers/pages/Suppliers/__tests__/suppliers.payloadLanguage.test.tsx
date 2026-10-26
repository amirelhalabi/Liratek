/** @jest-environment jsdom */
/**
 * LIRA-331 (T049, rule 28d) — the Suppliers page sends the SAME payload in
 * Arabic as in English. Every write the page makes is driven once with the
 * language "en" and once with "ar"; the mocked API calls must be deeply
 * equal. A label that leaks into a payload (a translated note, an option
 * value, a direction) fails here.
 *
 * Writes walked: Pay / Receive (pay with a hand-typed discount — the page's
 * only forgiveness path, there is no Waive on Suppliers — and receive), Add
 * Credit / Debt (cash moved → cashflow; paper → ledger entry), Record Debt,
 * batch settle (legacy with the page's own default note; new-model OMT with a
 * commission; bills-only lump/rate × top-up/other payment), and the Settle
 * Account sheet (USD, USD + LBP with an LBP commission, a covered-types
 * choice, two picked days on the LIRA-343 calendar).
 *
 * Not failing-first: a guard against future drift, written before the
 * conversion and run green against the English-only screen.
 *
 * Renders the REAL page, the real CounterpartySettleModal / MultiPaymentInput
 * / AccountSettleSheet. Controls are found by test id or by data, never by a
 * label. `useApi` returns ONE stable object (rule 25).
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  buildDaySelections,
  supplierCashflowSchema,
  supplierSettleSchema,
  supplierSettleAccountSchema,
} from "@liratek/core";
import { i18n } from "@/i18n/setup";
import Suppliers from "../index";
import {
  endRun,
  firstPaymentAmount,
  paymentDiscountInput,
  setGuardLanguage,
  settleConfirmButton,
  snapshotCalls,
  type GuardLanguage,
} from "../../../testing/payloadLanguage";
import {
  LBP_ROW,
  OMT_ACCOUNT,
  SIX_USD_ROWS,
} from "../../../testing/accountSettleFixtures";
import { toggleCoveredType } from "../../../testing/coveredTypesPicker";

// LIRA-343 — the Settle Account calendar works from the device's today; pin
// it so the fixtures' October days are always "before today" and October is
// the month the sheet opens on.
jest.mock("@/shared/utils/localDay", () => {
  const actual = jest.requireActual("@/shared/utils/localDay");
  return { ...actual, localDay: () => "2026-10-26" };
});

const mockApi = {
  getSuppliers: jest.fn(),
  getSupplierBalances: jest.fn(),
  getSupplierAccountBalances: jest.fn(),
  getSupplierAccountLedger: jest.fn(),
  getSupplierAccountUnsettled: jest.fn(),
  getSupplierAccountMonthRows: jest.fn(),
  getSupplierAccountExpectedStatement: jest.fn(),
  getSupplierProductBalances: jest.fn(),
  getSupplierProductStockValue: jest.fn(),
  getSupplierLedger: jest.fn(),
  getSupplierProductItems: jest.fn(),
  getAllSupplierTransactions: jest.fn(),
  getUnsettledTransactions: jest.fn(),
  getOpenRecordedSupplierDebts: jest.fn(),
  getSupplierPurchases: jest.fn(),
  settleTransactions: jest.fn(),
  settleSupplierAccount: jest.fn(),
  recordSupplierCashflow: jest.fn(),
  addSupplierLedgerEntry: jest.fn(),
  recordSupplierDebt: jest.fn(),
  createSupplierPurchase: jest.fn(),
  supplierWriteOff: jest.fn(),
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
    appEvents: { emit: jest.fn() },
  };
});

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", role: "admin" } }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [
      { code: "CASH", label: "Cash" },
      { code: "OMT", label: "OMT" },
    ],
    drawerAffectingMethods: [],
    allMethods: [],
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
}));

jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({
    baseSystem: "OMT",
    partnerSystem: "WHISH",
    loading: false,
  }),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BASE_SUPPLIER = {
  contact_name: null,
  phone: null,
  note: null,
  is_active: 1,
  module_key: null,
  created_at: "2026-08-01T00:00:00Z",
};

const PRODUCT_SUPPLIER = {
  ...BASE_SUPPLIER,
  id: 5,
  name: "Acme Distributors",
  provider: null,
  is_system: 0,
};

const WHISH_APP_SUPPLIER = {
  ...BASE_SUPPLIER,
  id: 7,
  name: "Whish App",
  provider: "WHISH_APP",
  is_system: 1,
};

const OMT_SUPPLIER = {
  ...BASE_SUPPLIER,
  id: 2,
  name: "OMT",
  provider: "OMT",
  is_system: 1,
  commission_entry_mode: "LUMP" as const,
  commission_rate: null,
};

const KATSH_SUPPLIER = {
  ...BASE_SUPPLIER,
  id: 3,
  name: "Katsh",
  provider: "Katsh",
  is_system: 1,
  commission_entry_mode: "LUMP" as const,
  commission_rate: 20000,
  commission_rate_currency: "LBP" as const,
};

const LEGACY_ROW = {
  id: 201,
  service_type: "SEND" as const,
  amount: 100,
  currency: "USD",
  commission: 5,
  omt_fee: 2,
  omt_service_type: "OMT_TRANSFER",
  client_name: null,
  supplier_owed: 100,
  commission_model: 0,
  created_at: "2026-08-08T10:05:00Z",
};

const NEW_MODEL_ROW = {
  ...LEGACY_ROW,
  id: 202,
  commission: 0,
  omt_service_type: "INTRA",
  supplier_owed: 101,
  commission_model: 1,
};

const BILL_ROWS = [301, 302].map((id) => ({
  id,
  service_type: "BILL" as const,
  amount: 500000,
  currency: "LBP",
  commission: 0,
  omt_fee: null,
  omt_service_type: null,
  client_name: null,
  supplier_owed: 0,
  commission_model: 1,
  created_at: `2026-08-0${id - 300} 10:00:00`,
}));

// The OMT account (OMT counter + OMT App) for the Settle Account sheet.
const ACCOUNT_PARENT = {
  ...BASE_SUPPLIER,
  id: 1,
  name: "OMT",
  provider: "OMT",
  is_system: 1,
};
const ACCOUNT_CHILD = {
  ...BASE_SUPPLIER,
  id: 2,
  name: "OMT App",
  provider: "OMT_APP",
  is_system: 1,
  account_supplier_id: 1,
};

function baseMocks() {
  mockApi.getSuppliers.mockResolvedValue([]);
  mockApi.getSupplierBalances.mockResolvedValue([]);
  mockApi.getSupplierAccountBalances.mockResolvedValue([]);
  mockApi.getSupplierAccountLedger.mockResolvedValue([]);
  mockApi.getSupplierAccountUnsettled.mockResolvedValue([]);
  mockApi.getSupplierAccountMonthRows.mockResolvedValue([]);
  mockApi.getSupplierAccountExpectedStatement.mockResolvedValue(null);
  mockApi.getSupplierProductBalances.mockResolvedValue([]);
  mockApi.getSupplierProductStockValue.mockResolvedValue([]);
  mockApi.getSupplierLedger.mockResolvedValue([]);
  mockApi.getSupplierProductItems.mockResolvedValue([]);
  mockApi.getAllSupplierTransactions.mockResolvedValue([]);
  mockApi.getUnsettledTransactions.mockResolvedValue([]);
  mockApi.getOpenRecordedSupplierDebts.mockResolvedValue([]);
  mockApi.getSupplierPurchases.mockResolvedValue([]);
  mockApi.settleTransactions.mockResolvedValue({ success: true, id: 1 });
  mockApi.settleSupplierAccount.mockResolvedValue({ success: true, id: 1 });
  mockApi.recordSupplierCashflow.mockResolvedValue({ success: true, id: 1 });
  mockApi.addSupplierLedgerEntry.mockResolvedValue({ success: true, id: 1 });
  mockApi.recordSupplierDebt.mockResolvedValue({
    success: true,
    ledgerEntryId: 1,
    transactionId: 1,
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <Suppliers />
    </QueryClientProvider>,
  );
}

const click = (el: Element) => fireEvent.click(el);
const type = (el: Element, value: string) =>
  fireEvent.change(el, { target: { value } });

/**
 * Runs one write in `lang` and returns the calls the write mock received.
 * Each run asserts the write happened exactly once (a vacuous run would make
 * the en/ar comparison meaningless — rule 28a).
 */
async function runIn(
  lang: GuardLanguage,
  scenario: Scenario,
): Promise<unknown[][]> {
  jest.clearAllMocks();
  baseMocks();
  scenario.setup();
  await setGuardLanguage(lang);
  try {
    renderPage();
    await scenario.drive();
    const mock = mockApi[scenario.write];
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
    return snapshotCalls(mock.mock.calls as unknown[][]);
  } finally {
    endRun();
  }
}

interface Scenario {
  name: string;
  write:
    | "recordSupplierCashflow"
    | "addSupplierLedgerEntry"
    | "recordSupplierDebt"
    | "settleTransactions"
    | "settleSupplierAccount";
  setup: () => void;
  drive: () => Promise<void>;
  /** Schema-backed checks on the English payload (rule 24). */
  check: (calls: unknown[][]) => void;
}

// ─── Drivers ─────────────────────────────────────────────────────────────────

async function openProductSupplier(tab: "manual" | "items") {
  click(screen.getByTestId("supplier-category-products"));
  click(await screen.findByTestId("supplier-tile-5"));
  if (tab === "manual") click(await screen.findByTestId("supplier-tab-manual"));
}

async function openBatchSettle(tileId: string, rowIds: number[]) {
  click(await screen.findByTestId(tileId));
  for (const id of rowIds) {
    const row = await screen.findByTestId(`settle-row-${id}`);
    click(within(row).getByRole("checkbox"));
  }
  click(await screen.findByTestId("supplier-settle-open"));
  await screen.findByTestId("counterparty-settle-modal");
}

async function openAccountSheet() {
  click(await screen.findByTestId("supplier-account-settle-button"));
  return screen.findByTestId("supplier-account-settle-sheet");
}

/** LIRA-343 — the calendar day `YYYY-MM-DD`, found by data, not by label. */
async function calendarDayButton(
  sheet: HTMLElement,
  day: string,
): Promise<HTMLElement> {
  const cell = await waitFor(() => {
    const el = sheet.querySelector(`[data-day="${day}"]`);
    if (!el) throw new Error(`calendar day ${day} not rendered`);
    return el as HTMLElement;
  });
  return within(cell).getByRole("button");
}

/** The two days left picked, and the four unpicked, in the day scenario. */
const PICKED_DAYS = ["2026-10-01", "2026-10-02"];
const UNPICKED_DAYS = ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"];

const cashflowPayload = (calls: unknown[][]) =>
  supplierCashflowSchema.parse(calls[0]![0]);
const settlePayload = (calls: unknown[][]) =>
  supplierSettleSchema.parse(calls[0]![0]);
const accountPayload = (calls: unknown[][]) =>
  supplierSettleAccountSchema.parse({
    account_supplier_id: calls[0]![0],
    ...(calls[0]![1] as object),
  });

const SCENARIOS: Scenario[] = [
  {
    // LIRA-345 (S3) — a product supplier settles by day (no Pay / Receive);
    // the Pay form is shown on a company supplier that still has it.
    name: "Pay / Receive — pay $97 with a $3 discount, reason and note",
    write: "recordSupplierCashflow",
    setup: () => {
      mockApi.getSuppliers.mockResolvedValue([WHISH_APP_SUPPLIER]);
      mockApi.getSupplierBalances.mockResolvedValue([
        { supplier_id: 7, total_usd: 100, total_lbp: 0 },
      ]);
    },
    drive: async () => {
      click(await screen.findByTestId("supplier-tile-WHISH_APP"));
      click(await screen.findByTestId("supplier-tab-manual"));
      await screen.findByTestId("payment-exchange-rate");
      type(firstPaymentAmount(), "97");
      type(paymentDiscountInput(), "3");
      type(
        await screen.findByTestId("supplier-cashflow-discount-reason"),
        "Damaged box",
      );
      type(screen.getByTestId("supplier-cashflow-note"), "October invoice");
      click(settleConfirmButton());
    },
    check: (calls) => {
      const p = cashflowPayload(calls);
      expect(p.direction).toBe("PAY");
      expect(p.payments).toEqual([
        { method: "CASH", currency_code: "USD", amount: 97 },
      ]);
      expect(p.discount).toEqual({
        amount_usd: 3,
        amount_lbp: 0,
        reason: "Damaged box",
      });
      expect(p.note).toBe("October invoice");
    },
  },
  {
    name: "Pay / Receive — the supplier pays us 200,000 LBP",
    write: "recordSupplierCashflow",
    setup: () => {
      mockApi.getSuppliers.mockResolvedValue([WHISH_APP_SUPPLIER]);
      mockApi.getSupplierBalances.mockResolvedValue([
        { supplier_id: 7, total_usd: 0, total_lbp: -200000 },
      ]);
    },
    drive: async () => {
      click(await screen.findByTestId("supplier-tile-WHISH_APP"));
      click(await screen.findByTestId("supplier-tab-manual"));
      click(await screen.findByTestId("supplier-cashflow-direction-receive"));
      await screen.findByTestId("payment-exchange-rate");
      type(firstPaymentAmount(), "200000");
      type(screen.getByTestId("supplier-cashflow-note"), "Refund");
      click(settleConfirmButton());
    },
    check: (calls) => {
      const p = cashflowPayload(calls);
      expect(p.direction).toBe("RECEIVE");
      expect(p.payments).toEqual([
        { method: "CASH", currency_code: "LBP", amount: 200000 },
      ]);
      expect(p.note).toBe("Refund");
    },
  },
  {
    name: "Add Credit / Debt — CREDIT $40 with cash moved (cashflow)",
    write: "recordSupplierCashflow",
    setup: () => {
      mockApi.getSuppliers.mockResolvedValue([WHISH_APP_SUPPLIER]);
    },
    drive: async () => {
      click(await screen.findByTestId("supplier-tile-WHISH_APP"));
      click(await screen.findByTestId("supplier-adjust-open"));
      click(await screen.findByTestId("supplier-adjust-direction-credit"));
      type(screen.getByTestId("supplier-adjust-amount"), "40");
      type(screen.getByTestId("supplier-adjust-note"), "Top-up advance");
      click(screen.getByTestId("supplier-adjust-submit"));
    },
    check: (calls) => {
      const p = cashflowPayload(calls);
      expect(p.direction).toBe("RECEIVE");
      expect(p.payments).toEqual([
        { method: "CASH", currency_code: "USD", amount: 40 },
      ]);
    },
  },
  {
    name: "Add Credit / Debt — DEBIT 150,000 LBP on paper (ledger entry)",
    write: "addSupplierLedgerEntry",
    setup: () => {
      mockApi.getSuppliers.mockResolvedValue([WHISH_APP_SUPPLIER]);
    },
    drive: async () => {
      click(await screen.findByTestId("supplier-tile-WHISH_APP"));
      click(await screen.findByTestId("supplier-adjust-open"));
      click(await screen.findByTestId("supplier-adjust-direction-debit"));
      click(screen.getByTestId("supplier-adjust-currency-LBP"));
      type(screen.getByTestId("supplier-adjust-amount"), "150000");
      click(
        within(screen.getByTestId("supplier-cash-moved-toggle")).getByRole(
          "checkbox",
        ),
      );
      click(screen.getByTestId("supplier-adjust-submit"));
    },
    check: (calls) => {
      expect(calls[0]).toEqual([
        7,
        {
          entry_type: "ADJUSTMENT",
          amount_usd: 0,
          amount_lbp: -150000,
        },
      ]);
    },
  },
  {
    name: "Record Debt — $50 + 100,000 LBP with a note",
    write: "recordSupplierDebt",
    setup: () => {
      mockApi.getSuppliers.mockResolvedValue([PRODUCT_SUPPLIER]);
      mockApi.getSupplierProductBalances.mockResolvedValue([
        { supplier_id: 5, total_usd: 0, total_lbp: 0 },
      ]);
    },
    drive: async () => {
      await openProductSupplier("items");
      click(await screen.findByTestId("supplier-record-debt-open"));
      type(await screen.findByTestId("supplier-record-debt-usd"), "50");
      type(screen.getByTestId("supplier-record-debt-lbp"), "100000");
      type(screen.getByTestId("supplier-record-debt-note"), "20 units");
      click(screen.getByTestId("supplier-record-debt-submit"));
    },
    check: (calls) => {
      expect(calls[0]![0]).toEqual({
        supplier_id: 5,
        amount_usd: 50,
        amount_lbp: 100000,
        note: "20 units",
      });
    },
  },
  {
    name: "Batch settle — legacy row, note left empty (the page's own note)",
    write: "settleTransactions",
    setup: () => {
      mockApi.getSuppliers.mockResolvedValue([OMT_SUPPLIER]);
      mockApi.getUnsettledTransactions.mockImplementation((p: string) =>
        Promise.resolve(p === "OMT" ? [LEGACY_ROW] : []),
      );
    },
    drive: async () => {
      await openBatchSettle("supplier-tile-OMT", [201]);
      await screen.findByDisplayValue("100");
      click(settleConfirmButton());
    },
    check: (calls) => {
      const p = settlePayload(calls);
      expect(p.note).toBe("Settlement: 1 txns");
      expect(p.amount_usd).toBe(100);
      expect(p.commission_usd).toBe(5);
      expect(p.payments).toEqual([
        { method: "CASH", currency_code: "USD", amount: 100 },
      ]);
    },
  },
  {
    name: "Batch settle — new-model OMT row, $1 commission, typed note",
    write: "settleTransactions",
    setup: () => {
      mockApi.getSuppliers.mockResolvedValue([OMT_SUPPLIER]);
      mockApi.getUnsettledTransactions.mockImplementation((p: string) =>
        Promise.resolve(p === "OMT" ? [NEW_MODEL_ROW] : []),
      );
    },
    drive: async () => {
      await openBatchSettle("supplier-tile-OMT", [202]);
      click(screen.getByTestId("supplier-settle-mode-lump"));
      type(screen.getByTestId("supplier-settle-commission-usd"), "1");
      await screen.findByDisplayValue("100");
      type(screen.getByTestId("supplier-settle-note"), "Week 41");
      click(settleConfirmButton());
    },
    check: (calls) => {
      const p = settlePayload(calls);
      expect(p.amount_usd).toBe(100);
      expect(p.commission_usd).toBe(1);
      expect(p.entry_mode).toBe("LUMP");
      expect(p.note).toBe("Week 41");
    },
  },
  {
    name: "Batch settle — bills only, rate × count, top-up",
    write: "settleTransactions",
    setup: () => {
      mockApi.getSuppliers.mockResolvedValue([KATSH_SUPPLIER]);
      mockApi.getUnsettledTransactions.mockImplementation((p: string) =>
        Promise.resolve(p === "Katsh" ? BILL_ROWS : []),
      );
    },
    drive: async () => {
      await openBatchSettle("supplier-tile-Katsh", [301, 302]);
      click(screen.getByTestId("supplier-settle-mode-rate"));
      type(screen.getByTestId("supplier-settle-rate"), "20000");
      click(screen.getByTestId("supplier-settle-rate-currency-LBP"));
      type(screen.getByTestId("supplier-settle-count"), "2");
      click(screen.getByTestId("supplier-settle-collection-top_up"));
      click(settleConfirmButton());
    },
    check: (calls) => {
      const p = settlePayload(calls);
      expect(p.entry_mode).toBe("RATE");
      expect(p.commission_lbp).toBe(40000);
      expect(p.commission_rate).toBe(20000);
      expect(p.commission_unit_count).toBe(2);
      expect(p.commission_collection_mode).toBe("TOP_UP");
      expect(p.note).toBe("Settlement: 2 txns");
    },
  },
  {
    name: "Batch settle — bills only, lump LBP, other payment",
    write: "settleTransactions",
    setup: () => {
      mockApi.getSuppliers.mockResolvedValue([KATSH_SUPPLIER]);
      mockApi.getUnsettledTransactions.mockImplementation((p: string) =>
        Promise.resolve(p === "Katsh" ? BILL_ROWS : []),
      );
    },
    drive: async () => {
      await openBatchSettle("supplier-tile-Katsh", [301, 302]);
      click(screen.getByTestId("supplier-settle-mode-lump"));
      type(screen.getByTestId("supplier-settle-commission-lbp"), "40000");
      click(screen.getByTestId("supplier-settle-collection-other_payment"));
      await screen.findByTestId("payment-exchange-rate");
      await screen.findByDisplayValue("40,000");
      click(settleConfirmButton());
    },
    check: (calls) => {
      const p = settlePayload(calls);
      expect(p.commission_lbp).toBe(40000);
      expect(p.commission_collection_mode).toBe("OTHER_PAYMENT");
      expect(p.payments).toEqual([
        { method: "CASH", currency_code: "LBP", amount: 40000 },
      ]);
    },
  },
  {
    name: "Settle Account — USD only, $497 + $0.70 commission, typed note",
    write: "settleSupplierAccount",
    setup: () => {
      mockApi.getSuppliers.mockResolvedValue([ACCOUNT_PARENT, ACCOUNT_CHILD]);
      mockApi.getSupplierAccountBalances.mockResolvedValue([
        { ...OMT_ACCOUNT, total_lbp: 0 },
      ]);
      mockApi.getSupplierAccountUnsettled.mockResolvedValue(
        SIX_USD_ROWS.map((r) => ({ ...r, commission_model: 1 })),
      );
    },
    drive: async () => {
      const sheet = await openAccountSheet();
      const usd = await within(sheet).findByTestId(
        "supplier-account-settle-section-usd",
      );
      type(
        within(usd).getByTestId("supplier-account-settle-commission-usd"),
        "0.70",
      );
      type(
        within(sheet).getByTestId("supplier-account-settle-note"),
        "Statement 12",
      );
      const submit = within(sheet).getByTestId(
        "supplier-account-settle-submit",
      );
      await waitFor(() => expect(submit).not.toBeDisabled());
      click(submit);
    },
    check: (calls) => {
      const p = accountPayload(calls);
      expect(p.per_currency?.USD?.payments).toEqual([
        { method: "CASH", currency_code: "USD", amount: 497 },
      ]);
      expect(p.per_currency?.USD?.commission).toBeCloseTo(0.7, 2);
      expect(p.note).toBe("Statement 12");
    },
  },
  {
    name: "Settle Account — USD + LBP in one box, LBP commission",
    write: "settleSupplierAccount",
    setup: () => {
      mockApi.getSuppliers.mockResolvedValue([ACCOUNT_PARENT, ACCOUNT_CHILD]);
      mockApi.getSupplierAccountBalances.mockResolvedValue([OMT_ACCOUNT]);
      mockApi.getSupplierAccountUnsettled.mockResolvedValue([
        ...SIX_USD_ROWS,
        { ...LBP_ROW, commission_model: 1 },
      ]);
    },
    drive: async () => {
      const sheet = await openAccountSheet();
      const box = await within(sheet).findByTestId(
        "supplier-account-settle-section-usd-lbp",
      );
      type(
        within(box).getByTestId("supplier-account-settle-commission-lbp"),
        "10000",
      );
      const submit = within(sheet).getByTestId(
        "supplier-account-settle-submit",
      );
      await waitFor(() => expect(submit).not.toBeDisabled());
      click(submit);
    },
    check: (calls) => {
      const p = accountPayload(calls);
      expect(p.per_currency?.USD?.direction).toBe("PAY");
      expect(p.per_currency?.LBP?.payments).toEqual([
        { method: "CASH", currency_code: "LBP", amount: 900000 },
      ]);
      expect(p.per_currency?.LBP?.commission).toBe(10000);
    },
  },
  {
    // LIRA-343 — the old "Pick transfers" toggle is gone: transfers are
    // picked by DAY on the calendar. Every open day before today starts
    // picked (1–6 Oct); unpicking 3–6 Oct leaves the first two transfers.
    name: "Settle Account — covered types and two picked days",
    write: "settleSupplierAccount",
    setup: () => {
      mockApi.getSuppliers.mockResolvedValue([ACCOUNT_PARENT, ACCOUNT_CHILD]);
      mockApi.getSupplierAccountBalances.mockResolvedValue([
        { ...OMT_ACCOUNT, total_lbp: 0 },
      ]);
      mockApi.getSupplierAccountUnsettled.mockResolvedValue(SIX_USD_ROWS);
      mockApi.getSupplierAccountMonthRows.mockImplementation(
        async (_id: number, month: string) =>
          SIX_USD_ROWS.filter((r) => r.shop_day.startsWith(`${month}-`)),
      );
    },
    drive: async () => {
      const sheet = await openAccountSheet();
      await within(sheet).findByTestId("supplier-account-settle-section-usd");
      await toggleCoveredType("supplier-account-settle-covered", "INTRA");
      for (const day of UNPICKED_DAYS) {
        const button = await calendarDayButton(sheet, day);
        await waitFor(() =>
          expect(button).toHaveAttribute("aria-pressed", "true"),
        );
        click(button);
        await waitFor(() =>
          expect(button).toHaveAttribute("aria-pressed", "false"),
        );
      }
      const submit = within(sheet).getByTestId(
        "supplier-account-settle-submit",
      );
      await waitFor(() => expect(submit).not.toBeDisabled());
      click(submit);
    },
    check: (calls) => {
      const p = accountPayload(calls);
      expect(p.covered_omt_service_types).toEqual(["INTRA"]);
      // Rule 24 — the expected list comes from the ONE builder the sheet
      // uses, never a hand-typed row list.
      const expected = buildDaySelections(SIX_USD_ROWS, {
        pickedDays: new Set(PICKED_DAYS),
        coveredTypes: ["INTRA"],
      });
      expect(p.selections).toEqual(expected.selections);
      // Data sanity: the two picked days are the first two transfers.
      expect(expected.selections.map((sel) => sel.id)).toEqual([101, 102]);
      expect(p.per_currency?.USD?.payments).toEqual([
        { method: "CASH", currency_code: "USD", amount: 253 },
      ]);
    },
  },
];

describe("Suppliers page — the payload does not depend on the language (LIRA-331 T049)", () => {
  beforeAll(() => {
    jest.spyOn(window, "alert").mockImplementation(() => {});
  });
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it.each(SCENARIOS.map((s) => [s.name, s] as const))(
    "%s",
    async (_name, scenario) => {
      const en = await runIn("en", scenario);
      scenario.check(en);
      const ar = await runIn("ar", scenario);
      expect(ar).toEqual(en);
    },
  );
});
