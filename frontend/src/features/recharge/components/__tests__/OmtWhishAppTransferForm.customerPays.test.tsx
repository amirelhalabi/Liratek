/** @jest-environment jsdom */

/**
 * LIRA-321 US3 (T034 + T034b) — Whish App / OMT App cash-out: the
 * "Customer pays" section of the payment box.
 *
 * On every RECEIVE the customer's side is a section of its own: the
 * transfer line (Whish wallet on Whish App, OMT wallet on OMT App) plus, on
 * Whish App when the fee is "Customer pays separately", a Cash fee line. The
 * lines travel to the server as `customerPayments` — never `feePayments`.
 *
 * Field names in the assertions come from the schema: every captured payload
 * is parsed through `createFinancialServiceSchema` (rule 24), and the line
 * total is checked against what the server expects (amount + commission when
 * the fee is paid separately, else amount).
 *
 * The PaymentSheet is stubbed. Like the real "Customer pays" hook, the stub
 * reports the seed lines through `counterFlow.onChange` when it opens or the
 * seeds change (in an effect keyed on the seeds — never in render).
 */

import { useEffect } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createFinancialServiceSchema } from "@liratek/core";
import { OmtWhishAppTransferForm } from "../OmtWhishAppTransferForm";

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
  requiresClient?: boolean;
  hasClient?: boolean;
  onStateChange?: (s: StubState) => void;
}
interface StubSheetProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  onPaymentChange: (lines: unknown[]) => void;
  onDiscountChange?: (n: number) => void;
  totalAmount: number;
  counterFlow?: StubCounterFlow;
}

declare global {
  var __cpLines: StubLine[];
  var __cpState: StubState;
  var __cpDiscount: number;
  var __cpCounterFlow: StubCounterFlow | undefined;
}

function StubPaymentSheet(props: StubSheetProps) {
  const cf = props.counterFlow;
  globalThis.__cpCounterFlow = cf;
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
            globalThis.__cpLines.map((l, i) => ({ id: `C${i}`, ...l })),
          )
        }
      />
      <button
        data-testid="stub-report-state"
        onClick={() => cf?.onStateChange?.(globalThis.__cpState)}
      />
      <button
        data-testid="stub-discount"
        onClick={() => props.onDiscountChange?.(globalThis.__cpDiscount)}
      />
      <button data-testid="stub-close" onClick={props.onClose} />
      <button data-testid="stub-confirm" onClick={props.onConfirm} />
    </div>
  );
}

jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: StubSheetProps) => <StubPaymentSheet {...props} />,
}));

// Rule 25: the useApi mock returns ONE stable object.
const mockAddOMTTransaction = jest.fn();
const mockApi = { addOMTTransaction: mockAddOMTTransaction };

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

const mockSession = {
  activeSession: null,
  linkTransaction: jest.fn(),
  addToCart: jest.fn(),
};
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => mockSession,
}));

const mockRates = { sellRate: 89500, buyRate: 89000 };
jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => mockRates,
}));

const mockMethods = {
  methods: [
    { code: "CASH", label: "Cash" },
    { code: "OMT", label: "OMT Wallet" },
    { code: "WHISH", label: "Whish Wallet" },
    { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
    { code: "GIFT_CARD", label: "Gift card" },
  ],
  drawerAffectingMethods: [
    { code: "CASH", label: "Cash" },
    { code: "OMT", label: "OMT Wallet" },
    { code: "WHISH", label: "Whish Wallet" },
  ],
};
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => mockMethods,
}));

const mockEnsureClient = jest.fn();
jest.mock("../../utils/ensureClient", () => ({
  ensureRechargeClient: (...args: unknown[]) => mockEnsureClient(...args),
}));

const mockSaveAsClient = {
  saveAsClient: false,
  setSaveAsClient: jest.fn(),
  showCheckbox: false,
  trySaveAsClient: jest.fn().mockResolvedValue({ clientId: null }),
  resetSaveAsClient: jest.fn(),
};
jest.mock("@/shared/hooks/useSaveAsClient", () => ({
  useSaveAsClient: () => mockSaveAsClient,
}));

jest.mock("@/shared/components/SaveAsClientCheckbox", () => ({
  SaveAsClientCheckbox: () => null,
}));
jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));
jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: () => null,
}));
jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: () => null,
}));
jest.mock("../HistoryModal", () => ({
  HistoryModal: () => null,
}));
jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const formatAmount = (val: number, currency: string) =>
  currency === "USD" ? `$${val.toFixed(2)}` : `${val} ${currency}`;

function renderForm(activeProvider: "OMT_APP" | "WHISH_APP") {
  return render(
    <OmtWhishAppTransferForm
      activeProvider={activeProvider}
      transactions={[]}
      loadFinancialData={jest.fn()}
      formatAmount={formatAmount}
    />,
  );
}

function switchToReceive() {
  fireEvent.click(screen.getByRole("button", { name: /Receive/i }));
}

function typeAmount(value: string) {
  fireEvent.change(
    document.getElementById("transfer-amount") as HTMLInputElement,
    { target: { value } },
  );
}

function typeFee(value: string) {
  fireEvent.change(
    document.getElementById("transfer-fee") as HTMLInputElement,
    { target: { value } },
  );
}

async function openSheet() {
  fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
  await screen.findByTestId("stub-payment-sheet");
}

async function confirmAndCapture(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByTestId("stub-inject-payout"));
  fireEvent.click(screen.getByTestId("stub-confirm"));
  await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
  return mockAddOMTTransaction.mock.calls[0][0] as Record<string, unknown>;
}

/** Parse through the schema (rule 24) and check the server's balance rule. */
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

describe("OmtWhishAppTransferForm — Customer pays (LIRA-321 US3)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockReset();
    mockAddOMTTransaction.mockResolvedValue({ success: true, id: 1 });
    mockEnsureClient.mockReset();
    mockEnsureClient.mockResolvedValue({ ok: true, id: null });
    globalThis.__cpLines = [];
    globalThis.__cpDiscount = 0;
    globalThis.__cpCounterFlow = undefined;
  });

  it("Whish App, fee paid separately: seeds $100 Whish + $5 Cash (split) and sends customerPayments, not feePayments", async () => {
    renderForm("WHISH_APP");
    switchToReceive();
    typeAmount("100");
    typeFee("5");
    fireEvent.click(screen.getByTestId("fee-mode-separate"));
    await openSheet();

    const cf = globalThis.__cpCounterFlow;
    expect(cf).toBeDefined();
    expect(cf!.seedLines).toEqual([
      { method: "WHISH", currencyCode: "USD", amount: 100 },
      { method: "CASH", currencyCode: "USD", amount: 5 },
    ]);
    expect(cf!.totalAmount).toBe(105);
    expect(cf!.currency).toBe("USD");
    expect(cf!.maxForgive).toBe(5); // SHORTFALL_MAX.USD

    const payload = await confirmAndCapture();
    const data = expectServerAccepts(payload);
    expect(data.customerPayments).toEqual([
      { method: "WHISH", currencyCode: "USD", amount: 100 },
      { method: "CASH", currencyCode: "USD", amount: 5 },
    ]);
    expect(data.feeCollectedSeparately).toBe(true);
    expect(data.amount).toBe(100);
    expect(data.commission).toBe(5);
    expect("feePayments" in payload).toBe(false);
  });

  it("Whish App, fee separately with a discount: the fee line is the fee after the discount", async () => {
    renderForm("WHISH_APP");
    switchToReceive();
    typeAmount("100");
    typeFee("5");
    fireEvent.click(screen.getByTestId("fee-mode-separate"));
    await openSheet();
    globalThis.__cpDiscount = 2;
    fireEvent.click(screen.getByTestId("stub-discount"));

    await waitFor(() =>
      expect(globalThis.__cpCounterFlow!.seedLines).toEqual([
        { method: "WHISH", currencyCode: "USD", amount: 100 },
        { method: "CASH", currencyCode: "USD", amount: 3 },
      ]),
    );
    const data = expectServerAccepts(await confirmAndCapture());
    expect(data.commission).toBe(3);
  });

  it("OMT App: one OMT-wallet line for the transfer, single mode, no fee flag", async () => {
    renderForm("OMT_APP");
    switchToReceive();
    typeAmount("100");
    await openSheet();

    expect(globalThis.__cpCounterFlow!.seedLines).toEqual([
      { method: "OMT", currencyCode: "USD", amount: 100 },
    ]);
    const data = expectServerAccepts(await confirmAndCapture());
    expect(data.customerPayments).toEqual([
      { method: "OMT", currencyCode: "USD", amount: 100 },
    ]);
    expect(data.feeCollectedSeparately).toBeUndefined();
  });

  it("Whish App, fee added to the transfer (default): one Whish line for transfer + fee", async () => {
    renderForm("WHISH_APP");
    switchToReceive();
    typeAmount("100");
    typeFee("5");
    await openSheet();

    expect(globalThis.__cpCounterFlow!.seedLines).toEqual([
      { method: "WHISH", currencyCode: "USD", amount: 105 },
    ]);
    const data = expectServerAccepts(await confirmAndCapture());
    expect(data.feeCollectedSeparately).toBeUndefined();
  });

  // T034b
  it("switching the fee away from 'Customer pays separately' drops the fee line and returns to one line", async () => {
    renderForm("WHISH_APP");
    switchToReceive();
    typeAmount("100");
    typeFee("5");
    fireEvent.click(screen.getByTestId("fee-mode-separate"));
    await openSheet();
    expect(globalThis.__cpCounterFlow!.seedLines).toHaveLength(2);

    fireEvent.click(screen.getByTestId("stub-close"));
    await waitFor(() =>
      expect(screen.queryByTestId("stub-payment-sheet")).toBeNull(),
    );
    fireEvent.click(screen.getByTestId("fee-mode-deducted"));
    await openSheet();
    expect(globalThis.__cpCounterFlow!.seedLines).toEqual([
      { method: "WHISH", currencyCode: "USD", amount: 100 },
    ]);

    fireEvent.click(screen.getByTestId("stub-close"));
    fireEvent.click(screen.getByTestId("fee-mode-sender"));
    await openSheet();
    expect(globalThis.__cpCounterFlow!.seedLines).toEqual([
      { method: "WHISH", currencyCode: "USD", amount: 105 },
    ]);

    const data = expectServerAccepts(await confirmAndCapture());
    expect(data.customerPayments).toEqual([
      { method: "WHISH", currencyCode: "USD", amount: 105 },
    ]);
    expect(data.feeCollectedSeparately).toBeUndefined();
  });

  it("case (c): Whish $90 + Cash $5 fee + $10 on the account — sends the lines and the client", async () => {
    mockEnsureClient.mockResolvedValue({ ok: true, id: 42 });
    renderForm("WHISH_APP");
    switchToReceive();
    typeAmount("100");
    typeFee("5");
    fireEvent.click(screen.getByTestId("fee-mode-separate"));
    await openSheet();

    globalThis.__cpLines = [
      { method: "WHISH", currencyCode: "USD", amount: 90 },
      { method: "CASH", currencyCode: "USD", amount: 5 },
      { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 10 },
    ];
    fireEvent.click(screen.getByTestId("stub-set-customer-lines"));

    const payload = await confirmAndCapture();
    // The account line reaches the client check, so a new client is created.
    const ensureArgs = mockEnsureClient.mock.calls[0][0] as {
      paymentLines: Array<{ method: string }>;
    };
    expect(ensureArgs.paymentLines.map((l) => l.method)).toContain(
      "CUSTOMER_ACCOUNT",
    );
    const data = expectServerAccepts(payload);
    expect(data.clientId).toBe(42);
    expect(data.customerPayments).toEqual(globalThis.__cpLines);
  });

  it("a forgiven part rides customer_waived_amount; zero-amount lines are not sent", async () => {
    renderForm("OMT_APP");
    switchToReceive();
    typeAmount("100");
    await openSheet();

    globalThis.__cpLines = [
      { method: "OMT", currencyCode: "USD", amount: 97 },
      { method: "CASH", currencyCode: "USD", amount: 0 },
    ];
    fireEvent.click(screen.getByTestId("stub-set-customer-lines"));
    globalThis.__cpState = {
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
      { method: "OMT", currencyCode: "USD", amount: 97 },
    ]);
    expect(data.customer_waived_amount).toBe(3);
  });

  it("Confirm waits while the customer section is over, short or needs a client", async () => {
    renderForm("OMT_APP");
    switchToReceive();
    typeAmount("100");
    await openSheet();

    globalThis.__cpState = {
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

    globalThis.__cpState = { ...globalThis.__cpState, paid: 100, overpaid: false, balanced: true };
    fireEvent.click(screen.getByTestId("stub-report-state"));
    expect(screen.getByTestId("stub-confirm-disabled")).toHaveTextContent(
      "false",
    );
  });
});
