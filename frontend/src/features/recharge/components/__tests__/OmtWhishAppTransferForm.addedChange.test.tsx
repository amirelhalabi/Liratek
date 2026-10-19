/** @jest-environment jsdom */

/**
 * OMT App / Whish App RECEIVE — the customer adds change (LIRA-336, T017).
 * Spec example: the customer sends $100 by Whish and is owed $97 in cash;
 * the cashier adds a second customer line, Cash USD 3, and hands out $100.
 * The existing "Customer pays" section gets `allowAddedChange`; the sheet
 * reports the added change via `onAddedChange` (payout currency) and the
 * form sends it as `added_change_*` through the ONE shared builder
 * (`buildWalletTransferPayload`, rule 22), with the customer's lines in
 * `customerPayments`. Never on a SEND, a session, For Partner, or a
 * customer-account payout. Phase 2 (FR-014): a wallet payout gets it too
 * (the cash-only term is gone; round-up stays cash-only).
 *
 * Real form, PaymentSheet stubbed (harness from
 * OmtWhishAppTransferForm.roundUp.test.tsx). Payload parsed through the core
 * schema (rule 24). Rule 17: run against the unwired form first — see the
 * task report.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createFinancialServiceSchema } from "@liratek/core";
import { OmtWhishAppTransferForm } from "../OmtWhishAppTransferForm";

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
// Stable reference (rule 25).
const mockApi = { addOMTTransaction: mockAddOMTTransaction };

type Added = { usd: number; lbp: number } | null;
interface StubCounterFlow {
  allowAddedChange?: boolean;
  onChange: (lines: unknown[]) => void;
  onStateChange?: (s: Record<string, unknown>) => void;
}
const BALANCED = {
  paid: 103,
  owedToAccount: 0,
  forgiven: 0,
  balanced: true,
  overpaid: false,
  needsClient: false,
  unaccounted: 0,
  addedChange: 3,
};

const mockSheetProps: { last?: Record<string, unknown> } = {};
jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: {
    open: boolean;
    onPaymentChange: (lines: unknown[]) => void;
    onAddedChange?: (a: Added) => void;
    counterFlow?: StubCounterFlow;
    onConfirm: () => void;
  }) => {
    mockSheetProps.last = props as unknown as Record<string, unknown>;
    return props.open ? (
      <div data-testid="stub-payment-sheet">
        {/* Customer: Whish $100 + Cash $3; shop pays Cash $100. */}
        <button
          data-testid="stub-customer-adds-3"
          onClick={() => {
            props.counterFlow?.onChange([
              { id: "C1", method: "WHISH", currencyCode: "USD", amount: 100 },
              { id: "C2", method: "CASH", currencyCode: "USD", amount: 3 },
            ]);
            props.counterFlow?.onStateChange?.(BALANCED);
            props.onPaymentChange([
              { id: "L1", method: "CASH", currencyCode: "USD", amount: 100 },
            ]);
            props.onAddedChange?.({ usd: 3, lbp: 0 });
          }}
        />
        {/* No added change: Whish $100 in (a 0 cash line left), $97 out. */}
        <button
          data-testid="stub-exact"
          onClick={() => {
            props.counterFlow?.onChange([
              { id: "C1", method: "WHISH", currencyCode: "USD", amount: 100 },
              { id: "C2", method: "CASH", currencyCode: "USD", amount: 0 },
            ]);
            props.counterFlow?.onStateChange?.({
              ...BALANCED,
              paid: 100,
              addedChange: 0,
            });
            props.onPaymentChange([
              { id: "L1", method: "CASH", currencyCode: "USD", amount: 97 },
            ]);
            props.onAddedChange?.(null);
          }}
        />
        {/* Paid out into the shop's Whish wallet instead of cash. */}
        <button
          data-testid="stub-payout-wallet"
          onClick={() =>
            props.onPaymentChange([
              { id: "L1", method: "WHISH", currencyCode: "USD", amount: 100 },
            ])
          }
        />
        {/* The customer's lines only (the payout set by its own click). */}
        <button
          data-testid="stub-customer-lines-3"
          onClick={() => {
            props.counterFlow?.onChange([
              { id: "C1", method: "WHISH", currencyCode: "USD", amount: 100 },
              { id: "C2", method: "CASH", currencyCode: "USD", amount: 3 },
            ]);
            props.counterFlow?.onStateChange?.(BALANCED);
            props.onAddedChange?.({ usd: 3, lbp: 0 });
          }}
        />
        {/* Paid into the customer's account instead. */}
        <button
          data-testid="stub-payout-account"
          onClick={() =>
            props.onPaymentChange([
              {
                id: "L1",
                method: "CUSTOMER_ACCOUNT",
                currencyCode: "USD",
                amount: 100,
              },
            ])
          }
        />
        <button data-testid="stub-confirm" onClick={props.onConfirm} />
      </div>
    ) : null;
  },
}));

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

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000 }),
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
  currency === "USD"
    ? `$${val.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    : `${val.toLocaleString()} ${currency}`;

function renderForm() {
  return render(
    <OmtWhishAppTransferForm
      activeProvider="WHISH_APP"
      transactions={[]}
      loadFinancialData={jest.fn()}
      formatAmount={formatAmount}
    />,
  );
}

async function openReceive(amount: string) {
  renderForm();
  fireEvent.click(screen.getByRole("button", { name: /Receive/i }));
  fireEvent.change(
    document.getElementById("transfer-amount") as HTMLInputElement,
    { target: { value: amount } },
  );
  fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
  await screen.findByTestId("stub-payment-sheet");
  await waitFor(() => expect(mockSheetProps.last?.payer).toBe("payout"));
}

function parsedPayload() {
  return createFinancialServiceSchema.parse(
    mockAddOMTTransaction.mock.calls[0][0],
  );
}

const sheetCounterFlow = (): StubCounterFlow | undefined =>
  mockSheetProps.last?.counterFlow as StubCounterFlow | undefined;

describe("OmtWhishAppTransferForm — RECEIVE, customer adds change (LIRA-336)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
    delete mockSheetProps.last;
  });

  it("CASH payout: the customer section allows added change and the sheet gets onAddedChange", async () => {
    await openReceive("100");
    expect(sheetCounterFlow()?.allowAddedChange).toBe(true);
    expect(typeof mockSheetProps.last?.onAddedChange).toBe("function");
  });

  it("Whish $100 + Cash $3 in, $100 out → customerPayments both lines + added_change_usd 3", async () => {
    await openReceive("100");
    fireEvent.click(screen.getByTestId("stub-customer-adds-3"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = parsedPayload();
    expect(parsed.serviceType).toBe("RECEIVE");
    expect(parsed.customerPayments).toEqual([
      { method: "WHISH", currencyCode: "USD", amount: 100 },
      { method: "CASH", currencyCode: "USD", amount: 3 },
    ]);
    expect(parsed.added_change_usd).toBe(3);
    expect(parsed.added_change_lbp ?? 0).toBe(0);
    expect(parsed.rounding_given_usd).toBeUndefined();
  });

  it("no added change: no added_change_*, the 0 cash line is dropped", async () => {
    await openReceive("100");
    fireEvent.click(screen.getByTestId("stub-customer-adds-3"));
    fireEvent.click(screen.getByTestId("stub-exact"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = parsedPayload();
    expect(parsed.added_change_usd).toBeUndefined();
    expect(parsed.added_change_lbp).toBeUndefined();
    expect(parsed.customerPayments).toEqual([
      { method: "WHISH", currencyCode: "USD", amount: 100 },
    ]);
  });

  it("wallet payout (FR-014): added change is offered and sent with cashoutMethod WHISH", async () => {
    await openReceive("100");
    fireEvent.click(screen.getByTestId("stub-payout-wallet"));
    // Checked only AFTER the wallet line is in (cashout starts as CASH).
    await waitFor(() =>
      expect(mockSheetProps.last?.onAddedChange).toEqual(expect.any(Function)),
    );
    await waitFor(() => expect(sheetCounterFlow()?.allowAddedChange).toBe(true));
    fireEvent.click(screen.getByTestId("stub-customer-lines-3"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = parsedPayload();
    expect(parsed.cashoutMethod).toBe("WHISH");
    expect(parsed.customerPayments).toEqual([
      { method: "WHISH", currencyCode: "USD", amount: 100 },
      { method: "CASH", currencyCode: "USD", amount: 3 },
    ]);
    expect(parsed.added_change_usd).toBe(3);
    // Round-up stays cash-only.
    expect(parsed.rounding_given_usd).toBeUndefined();
  });

  it("customer-account payout after added change: not wired, and the stale claim is not sent", async () => {
    await openReceive("100");
    fireEvent.click(screen.getByTestId("stub-customer-adds-3"));
    fireEvent.click(screen.getByTestId("stub-payout-account"));
    await waitFor(() =>
      expect(mockSheetProps.last?.onAddedChange).toBeUndefined(),
    );
    expect(sheetCounterFlow()?.allowAddedChange).toBeFalsy();
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const raw = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(raw).not.toHaveProperty("added_change_usd");
    expect(raw).not.toHaveProperty("added_change_lbp");
  });

  it("SEND: no onAddedChange", async () => {
    renderForm();
    fireEvent.change(
      document.getElementById("transfer-amount") as HTMLInputElement,
      { target: { value: "10" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");
    expect(mockSheetProps.last?.payer).not.toBe("payout");
    expect(mockSheetProps.last?.onAddedChange).toBeUndefined();
  });
});
