/** @jest-environment jsdom */

/**
 * LIRA-321 US4 (T042) — Binance cash-out: the "Customer pays" section.
 *
 * On every walk-in Binance cash-out the customer's side is its own section:
 * the USDT line (method BINANCE, in USDT) plus, when the fee is "Customer
 * pays separately", a Cash fee line in USD. The lines reach the server as
 * `customerPayments` — never `feePayments`.
 *
 * The page renders the REAL CryptoForm (it owns the seed lines) with the
 * PaymentSheet stubbed; the page owns the payload. Field names come from the
 * schema: every captured payload is parsed through
 * `createFinancialServiceSchema` (rule 24), and because Zod strips unknown
 * keys the parsed values are asserted explicitly (a misspelt
 * `customerWaivedAmount` would otherwise pass silently).
 *
 * Like the real section hook, the stub reports the seed lines through
 * `counterFlow.onChange` when it opens or the seeds change.
 */

import { useEffect } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createFinancialServiceSchema } from "@liratek/core";
import MobileRecharge from "../index";

interface StubLine {
  method: string;
  currencyCode: string;
  amount: number;
}
interface StubState {
  paid: number;
  owedToAccount: number;
  forgiven: number;
  balanced: boolean;
  overpaid: boolean;
  needsClient: boolean;
  unaccounted: number;
}
interface StubCounterFlow {
  label: string;
  totalAmount: number;
  currency: string;
  onChange: (lines: Array<StubLine & { id: string }>) => void;
  seedLines?: StubLine[];
  maxForgive?: number;
  currencies?: Array<{ code: string; symbol: string }>;
  onStateChange?: (s: StubState) => void;
}
interface StubSheetProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  onPaymentChange: (lines: unknown[]) => void;
  totalAmount: number;
  counterFlow?: StubCounterFlow;
}

declare global {
  var __bnLines: StubLine[];
  var __bnState: StubState;
  var __bnCounterFlow: StubCounterFlow | undefined;
}

function StubPaymentSheet(props: StubSheetProps) {
  const cf = props.counterFlow;
  globalThis.__bnCounterFlow = cf;
  const seedKey = JSON.stringify(cf?.seedLines ?? null);
  useEffect(() => {
    if (props.open && cf?.seedLines) {
      cf.onChange(cf.seedLines.map((s, i) => ({ id: `S${i}`, ...s })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, seedKey]);
  if (!props.open) return null;
  return (
    <div data-testid="stub-payment-sheet">
      <span data-testid="stub-confirm-disabled">
        {String(!!props.confirmDisabled)}
      </span>
      <button
        data-testid="stub-inject-payout"
        onClick={() =>
          props.onPaymentChange([
            {
              id: "P1",
              method: "CASH",
              currencyCode: "USD",
              amount: props.totalAmount,
            },
          ])
        }
      />
      <button
        data-testid="stub-set-customer-lines"
        onClick={() =>
          cf?.onChange(
            globalThis.__bnLines.map((l, i) => ({ id: `C${i}`, ...l })),
          )
        }
      />
      <button
        data-testid="stub-report-state"
        onClick={() => cf?.onStateChange?.(globalThis.__bnState)}
      />
      <button data-testid="stub-close" onClick={props.onClose} />
      <button data-testid="stub-confirm" onClick={props.onConfirm} />
    </div>
  );
}

jest.mock("../../../components/PaymentSheet", () => ({
  PaymentSheet: (props: StubSheetProps) => <StubPaymentSheet {...props} />,
}));

// Rule 25: the useApi mock returns ONE stable object.
const mockAddOMTTransaction = jest.fn();
const mockApi = {
  getAllSettings: jest.fn().mockResolvedValue([]),
  getOMTHistory: jest.fn().mockResolvedValue([]),
  getOMTAnalytics: jest.fn().mockResolvedValue({
    today: { commission: 0, count: 0, byCurrency: [] },
    byProvider: [],
  }),
  getClients: jest.fn().mockResolvedValue([]),
  processRecharge: jest.fn().mockResolvedValue({ success: true }),
  addOMTTransaction: mockAddOMTTransaction,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  DecimalInput: ({
    id,
    value,
    onChange,
    placeholder,
    className,
  }: {
    id?: string;
    value: number;
    onChange: (n: number) => void;
    placeholder?: string;
    className?: string;
  }) => (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={value === 0 ? "" : String(value)}
      placeholder={placeholder}
      className={className}
      onChange={(e) =>
        onChange(parseFloat(e.target.value.replace(/,/g, "")) || 0)
      }
    />
  ),
}));

jest.mock("../../../components", () => ({
  CompactStats: () => null,
  FinancialForm: () => null,
  KatshForm: () => null,
  TelecomForm: () => null,
  OmtWhishAppTransferForm: () => null,
  OmtAppCashoutModal: () => null,
  // The real form: it owns the "Customer pays" seed lines.
  CryptoForm: jest.requireActual("../../../components/CryptoForm").CryptoForm,
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
}));

jest.mock("../../../components/HistoryModal", () => ({
  HistoryModal: () => null,
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
}));

const mockMethods = {
  methods: [
    { code: "CASH", label: "Cash" },
    { code: "BINANCE", label: "Binance" },
    { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
    { code: "GIFT_CARD", label: "Gift card" },
  ],
  drawerAffectingMethods: [
    { code: "CASH", label: "Cash" },
    { code: "BINANCE", label: "Binance" },
  ],
};
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => mockMethods,
}));

const mockRates = { sellRate: 89500, buyRate: 89000 };
jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => mockRates,
}));

const mockCurrency = {
  formatAmount: (v: number, c: string) => `${v} ${c}`,
};
jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => mockCurrency,
}));

const mockServiceItems = {
  getCategoriesForProvider: () => [],
  getItems: () => [],
  refresh: jest.fn(),
};
jest.mock("../../../hooks/useMobileServiceItems", () => ({
  useMobileServiceItems: () => mockServiceItems,
  formatCatalogItemName: (item: { label: string }) => item.label,
}));

const mockEnsureClient = jest.fn();
jest.mock("../../../utils/ensureClient", () => ({
  ensureRechargeClient: (...args: unknown[]) => mockEnsureClient(...args),
}));

jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: () => null,
}));
jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: () => null,
}));
jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

async function openBinanceCashOut(amount: string, fee: string) {
  render(<MobileRecharge />);
  await waitFor(() => expect(mockApi.getAllSettings).toHaveBeenCalled());
  fireEvent.click(screen.getByTestId("select-binance"));
  fireEvent.click(await screen.findByRole("button", { name: /^Cash Out$/i }));
  fireEvent.change(
    document.getElementById("crypto-amount") as HTMLInputElement,
    { target: { value: amount } },
  );
  if (fee) {
    fireEvent.change(
      document.getElementById("crypto-fee") as HTMLInputElement,
      { target: { value: fee } },
    );
  }
}

async function openSheet() {
  fireEvent.click(screen.getByRole("button", { name: /Confirm Cash Out/i }));
  await screen.findByTestId("stub-payment-sheet");
}

async function confirmAndCapture(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByTestId("stub-inject-payout"));
  fireEvent.click(screen.getByTestId("stub-confirm"));
  await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
  return mockAddOMTTransaction.mock.calls[0][0] as Record<string, unknown>;
}

/** Parse through the schema (rule 24) and check the server's balance rule:
 *  lines + forgiven = USDT amount (+ fee when paid separately), 1 USDT = $1. */
function expectServerAccepts(payload: Record<string, unknown>) {
  const parsed = createFinancialServiceSchema.safeParse(payload);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  const data = parsed.data;
  const legs = data.customerPayments ?? [];
  const forgiven = data.customer_waived_amount ?? 0;
  const expected =
    data.amount + (data.feeCollectedSeparately ? (data.commission ?? 0) : 0);
  const sum = legs.reduce((s, l) => s + l.amount, 0) + forgiven;
  expect(sum).toBeCloseTo(expected, 6);
  expect(data.feePayments).toBeUndefined();
  return data;
}

describe("Recharge page — Binance cash-out, Customer pays (LIRA-321 US4)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockReset();
    mockAddOMTTransaction.mockResolvedValue({ success: true, id: 1 });
    mockEnsureClient.mockReset();
    mockEnsureClient.mockResolvedValue({ ok: true, id: null });
    globalThis.__bnLines = [];
    globalThis.__bnCounterFlow = undefined;
  });

  it("fee paid separately: seeds 100 USDT Binance + $2 Cash and sends customerPayments, not feePayments", async () => {
    await openBinanceCashOut("100", "2");
    fireEvent.click(screen.getByTestId("crypto-fee-mode-separate"));
    await openSheet();

    const cf = globalThis.__bnCounterFlow;
    expect(cf).toBeDefined();
    expect(cf!.seedLines).toEqual([
      { method: "BINANCE", currencyCode: "USDT", amount: 100 },
      { method: "CASH", currencyCode: "USD", amount: 2 },
    ]);
    expect(cf!.totalAmount).toBe(102);
    expect(cf!.currency).toBe("USD");
    expect(cf!.maxForgive).toBe(5); // SHORTFALL_MAX.USD
    // The Binance line can be in USDT; cash lines in USD or LBP.
    expect(cf!.currencies?.map((c) => c.code)).toEqual(["USDT", "USD", "LBP"]);

    const payload = await confirmAndCapture();
    const data = expectServerAccepts(payload);
    expect(data.provider).toBe("BINANCE");
    expect(data.serviceType).toBe("RECEIVE");
    expect(data.currency).toBe("USDT");
    expect(data.amount).toBe(100);
    expect(data.commission).toBe(2);
    expect(data.customerPayments).toEqual([
      { method: "BINANCE", currencyCode: "USDT", amount: 100 },
      { method: "CASH", currencyCode: "USD", amount: 2 },
    ]);
    expect(data.feeCollectedSeparately).toBe(true);
    expect(data.customer_waived_amount).toBe(0);
    expect("feePayments" in payload).toBe(false);
  });

  it("fee added to the transfer (default): one Binance line for USDT amount + fee, no fee flag", async () => {
    await openBinanceCashOut("100", "2");
    await openSheet();

    expect(globalThis.__bnCounterFlow!.seedLines).toEqual([
      { method: "BINANCE", currencyCode: "USDT", amount: 102 },
    ]);
    const data = expectServerAccepts(await confirmAndCapture());
    expect(data.amount).toBe(102);
    expect(data.customerPayments).toEqual([
      { method: "BINANCE", currencyCode: "USDT", amount: 102 },
    ]);
    expect(data.feeCollectedSeparately).toBeUndefined();
  });

  it("switching the fee away from 'Customer pays separately' removes the fee line and returns to one line", async () => {
    await openBinanceCashOut("100", "2");
    fireEvent.click(screen.getByTestId("crypto-fee-mode-separate"));
    await openSheet();
    expect(globalThis.__bnCounterFlow!.seedLines).toHaveLength(2);

    fireEvent.click(screen.getByTestId("stub-close"));
    await waitFor(() =>
      expect(screen.queryByTestId("stub-payment-sheet")).toBeNull(),
    );
    fireEvent.click(screen.getByTestId("crypto-fee-mode-deducted"));
    await openSheet();
    expect(globalThis.__bnCounterFlow!.seedLines).toEqual([
      { method: "BINANCE", currencyCode: "USDT", amount: 100 },
    ]);

    const data = expectServerAccepts(await confirmAndCapture());
    expect(data.customerPayments).toEqual([
      { method: "BINANCE", currencyCode: "USDT", amount: 100 },
    ]);
    expect(data.feeCollectedSeparately).toBeUndefined();
  });

  it("US4.2/US4.3: 80 USDT Binance + $20 on the account + $2 fee — sends the lines and the client", async () => {
    mockEnsureClient.mockResolvedValue({ ok: true, id: 42 });
    await openBinanceCashOut("100", "2");
    fireEvent.click(screen.getByTestId("crypto-fee-mode-separate"));
    await openSheet();

    globalThis.__bnLines = [
      { method: "BINANCE", currencyCode: "USDT", amount: 80 },
      { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 20 },
      { method: "CASH", currencyCode: "USD", amount: 2 },
    ];
    fireEvent.click(screen.getByTestId("stub-set-customer-lines"));

    const payload = await confirmAndCapture();
    // The account line reaches the client check.
    const ensureArgs = mockEnsureClient.mock.calls[0][0] as {
      paymentLines: Array<{ method: string }>;
    };
    expect(ensureArgs.paymentLines.map((l) => l.method)).toContain(
      "CUSTOMER_ACCOUNT",
    );
    const data = expectServerAccepts(payload);
    expect(data.clientId).toBe(42);
    expect(data.customerPayments).toEqual(globalThis.__bnLines);
  });

  it("a forgiven part rides customer_waived_amount; zero-amount lines are not sent", async () => {
    await openBinanceCashOut("100", "");
    await openSheet();

    globalThis.__bnLines = [
      { method: "BINANCE", currencyCode: "USDT", amount: 97 },
      { method: "CASH", currencyCode: "USD", amount: 0 },
    ];
    fireEvent.click(screen.getByTestId("stub-set-customer-lines"));
    globalThis.__bnState = {
      paid: 97,
      owedToAccount: 0,
      forgiven: 3,
      balanced: true,
      overpaid: false,
      needsClient: false,
      unaccounted: 0,
    };
    fireEvent.click(screen.getByTestId("stub-report-state"));

    const data = expectServerAccepts(await confirmAndCapture());
    expect(data.customerPayments).toEqual([
      { method: "BINANCE", currencyCode: "USDT", amount: 97 },
    ]);
    expect(data.customer_waived_amount).toBe(3);
  });

  it("Confirm waits while the customer section is over, short or needs a client", async () => {
    await openBinanceCashOut("100", "");
    await openSheet();

    globalThis.__bnState = {
      paid: 110,
      owedToAccount: 0,
      forgiven: 0,
      balanced: false,
      overpaid: true,
      needsClient: false,
      unaccounted: 0,
    };
    fireEvent.click(screen.getByTestId("stub-report-state"));
    expect(screen.getByTestId("stub-confirm-disabled")).toHaveTextContent(
      "true",
    );

    globalThis.__bnState = {
      ...globalThis.__bnState,
      paid: 100,
      overpaid: false,
      balanced: true,
    };
    fireEvent.click(screen.getByTestId("stub-report-state"));
    expect(screen.getByTestId("stub-confirm-disabled")).toHaveTextContent(
      "false",
    );
  });
});
