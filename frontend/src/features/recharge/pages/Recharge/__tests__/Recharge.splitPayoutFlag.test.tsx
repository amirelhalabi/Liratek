/** @jest-environment jsdom */

/**
 * LIRA-391 — the Binance cash-out sends `cashoutMethod` only when every
 * payout line shares one method (`lumpMethodOf`). Before: the page kept
 * `cryptoPaidBy`, set only while the sheet had exactly ONE line; picking a
 * client seeds a Customer Account line, so after the cashier added a second
 * line the payload still said `cashoutMethod: "CUSTOMER_ACCOUNT"` next to the
 * split legs — and core credited the whole payout to the account.
 *
 * CryptoForm is stubbed so the real submit closure runs. Field names come
 * from the core schema's input type (rule 24); the useApi mock is one
 * module-level object (rule 25).
 *
 * Rule 17 — run on 2026-11-14 against the unfixed page: the split case
 * FAILED ("Expected: undefined, Received: \"CUSTOMER_ACCOUNT\""); the single
 * account line and single cash line cases passed (they already worked).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PaymentLine } from "@liratek/ui";
import type { CreateFinancialServiceInput } from "@liratek/core";
import MobileRecharge from "../index";

const CASHOUT_KEY: keyof CreateFinancialServiceInput = "cashoutMethod";
const PAYMENTS_KEY: keyof CreateFinancialServiceInput = "payments";

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
const mockProcessRecharge = jest.fn().mockResolvedValue({ success: true });
const mockGetAllSettings = jest.fn().mockResolvedValue([]);
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
  getActiveCarrierLines: jest.fn().mockResolvedValue([
    {
      id: 1,
      carrier: "mtc",
      phone_number: "70123456",
      credits: 0,
      validity_expires_at: null,
      is_active: 1,
      is_primary: 1,
    },
  ]),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
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

const line = (id: string, method: string, amount: number): PaymentLine =>
  ({ id, method, currencyCode: "USD", amount }) as PaymentLine;

jest.mock("../../../components", () => ({
  CompactStats: () => null,
  FinancialForm: () => null,
  KatshForm: () => null,
  OmtWhishAppTransferForm: () => null,
  OmtAppCashoutModal: () => null,
  TelecomForm: () => null,
  ProviderTabs: ({
    onSelectProvider,
  }: {
    onSelectProvider: (p: string) => void;
  }) => (
    <button
      data-testid="select-binance"
      onClick={() => onSelectProvider("BINANCE")}
    />
  ),
  CryptoForm: ({
    setCryptoAmount,
    setCryptoFee,
    setCryptoType,
    handleCryptoSubmit,
    onPaymentLinesChange,
  }: {
    setCryptoAmount: (v: string) => void;
    setCryptoFee: (v: string) => void;
    setCryptoType: (t: "SEND" | "RECEIVE") => void;
    handleCryptoSubmit: () => void;
    onPaymentLinesChange: (lines: PaymentLine[]) => void;
  }) => (
    <div data-testid="stub-crypto-form">
      <button
        data-testid="crypto-receive-100-fee-2"
        onClick={() => {
          setCryptoType("RECEIVE");
          setCryptoAmount("100");
          setCryptoFee("2");
        }}
      />
      {/* Picking a client seeds ONE Customer Account line for the payout. */}
      <button
        data-testid="lines-account"
        onClick={() => onPaymentLinesChange([line("L1", "CUSTOMER_ACCOUNT", 98)])}
      />
      <button
        data-testid="lines-account-plus-whish"
        onClick={() =>
          onPaymentLinesChange([
            line("L1", "CUSTOMER_ACCOUNT", 40),
            line("L2", "WHISH", 58),
          ])
        }
      />
      <button
        data-testid="lines-cash"
        onClick={() => onPaymentLinesChange([line("L1", "CASH", 98)])}
      />
      <button data-testid="crypto-confirm" onClick={handleCryptoSubmit} />
    </div>
  ),
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, role: "admin" } }),
}));

const mockMethods = [
  { code: "CASH", label: "Cash" },
  { code: "WHISH", label: "Whish" },
  { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
];
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: mockMethods,
    drawerAffectingMethods: mockMethods,
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
  ensureRechargeClient: jest.fn().mockResolvedValue({ ok: true, id: null }),
}));

jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: () => null,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

async function renderPage() {
  render(<MobileRecharge />);
  await waitFor(() => expect(mockGetAllSettings).toHaveBeenCalled());
  fireEvent.click(screen.getByTestId("select-binance"));
  await screen.findByTestId("stub-crypto-form");
  fireEvent.click(screen.getByTestId("crypto-receive-100-fee-2"));
}

async function submitted(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByTestId("crypto-confirm"));
  await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
  return mockAddOMTTransaction.mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(() => {
  mockAddOMTTransaction.mockClear();
});

describe("Binance cash-out — the lump payout method follows ALL the lines (LIRA-391)", () => {
  it("account line seeded, then split Account + Whish → no cashoutMethod, both legs sent", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("lines-account"));
    fireEvent.click(screen.getByTestId("lines-account-plus-whish"));
    const payload = await submitted();
    expect(payload[CASHOUT_KEY]).toBeUndefined();
    expect(payload[PAYMENTS_KEY]).toEqual([
      expect.objectContaining({ method: "CUSTOMER_ACCOUNT", amount: 40 }),
      expect.objectContaining({ method: "WHISH", amount: 58 }),
    ]);
  });

  it("a single Customer Account line → cashoutMethod CUSTOMER_ACCOUNT", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("lines-account"));
    const payload = await submitted();
    expect(payload[CASHOUT_KEY]).toBe("CUSTOMER_ACCOUNT");
  });

  it("account line seeded, then replaced by a single Cash line → cash (no account flag)", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("lines-account"));
    fireEvent.click(screen.getByTestId("lines-cash"));
    const payload = await submitted();
    expect(payload[CASHOUT_KEY] ?? "CASH").toBe("CASH");
  });
});
