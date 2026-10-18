/** @jest-environment jsdom */

/**
 * OMT App / Whish App RECEIVE — payout round-up (LIRA-334, T025). Handing out
 * a little MORE than owed on a CASH payout is a round-up the shop books as
 * change rounding: the sheet reports it via `onRoundUpChange` and the form
 * sends `rounding_given_*` through the ONE shared builder
 * (`buildWalletTransferPayload`, rule 22). Never on a SEND, a session, or a
 * wallet / customer-account payout (the server refuses those).
 *
 * Real form, PaymentSheet stubbed (harness from
 * OmtWhishAppTransferForm.payoutKeptChange.test.tsx). Payload parsed through
 * the core schema (rule 24). Rule 17: run against the unwired form first —
 * see the task report.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createFinancialServiceSchema } from "@liratek/core";
import { OmtWhishAppTransferForm } from "../OmtWhishAppTransferForm";

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
// Stable reference (rule 25).
const mockApi = { addOMTTransaction: mockAddOMTTransaction };

// PaymentSheet stub: exposes onPaymentChange/onConfirm so the test can inject
// a single (non-split) leg and confirm — mirrors FinancialForm.legsCarrier's
// stub pattern. Also exposes onExchangeRateChange — the operator-editable
// header rate field the real MultiPaymentInput fires on mount and on every
// edit — so tests can prove the EDITED rate (not just the static prop)
// reaches the submit payload.
const mockSheetProps: { last?: Record<string, unknown> } = {};
jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: {
    open: boolean;
    onPaymentChange: (lines: unknown[]) => void;
    onKeptChange?: (kept: { usd: number; lbp: number } | null) => void;
    onRoundUpChange?: (r: { usd: number; lbp: number } | null) => void;
    onConfirm: () => void;
  }) => {
    mockSheetProps.last = props as unknown as Record<string, unknown>;
    return props.open ? (
      <div data-testid="stub-payment-sheet">
        {/* $100 owed, $100.25 handed out → $0.25 rounded up. */}
        <button
          data-testid="stub-payout-roundup"
          onClick={() => {
            props.onPaymentChange([
              { id: "L1", method: "CASH", currencyCode: "USD", amount: 100.25 },
            ]);
            props.onKeptChange?.(null);
            props.onRoundUpChange?.({ usd: 0.25, lbp: 0 });
          }}
        />
        <button
          data-testid="stub-payout-exact"
          onClick={() => {
            props.onPaymentChange([
              { id: "L1", method: "CASH", currencyCode: "USD", amount: 100 },
            ]);
            props.onRoundUpChange?.(null);
          }}
        />
        {/* Paid out into the shop's Whish wallet instead of cash (lines
            only — the input does not re-report when its props change). */}
        <button
          data-testid="stub-payout-wallet"
          onClick={() =>
            props.onPaymentChange([
              { id: "L1", method: "WHISH", currencyCode: "USD", amount: 100 },
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

describe("OmtWhishAppTransferForm — RECEIVE payout round-up (LIRA-334)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
    delete mockSheetProps.last;
  });

  it("CASH payout: $100.25 on $100 sends rounding_given_usd 0.25 and no kept change", async () => {
    await openReceive("100");
    expect(typeof mockSheetProps.last?.onRoundUpChange).toBe("function");
    fireEvent.click(screen.getByTestId("stub-payout-roundup"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = parsedPayload();
    expect(parsed.serviceType).toBe("RECEIVE");
    expect(parsed.rounding_given_usd).toBe(0.25);
    expect(parsed.rounding_given_lbp ?? 0).toBe(0);
    expect(parsed.kept_change_usd).toBeUndefined();
    expect(parsed.payments).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 100.25 }),
    ]);
  });

  it("exact payout: no rounding_given_* is sent", async () => {
    await openReceive("100");
    fireEvent.click(screen.getByTestId("stub-payout-roundup"));
    fireEvent.click(screen.getByTestId("stub-payout-exact"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = parsedPayload();
    expect(parsed.rounding_given_usd).toBeUndefined();
    expect(parsed.rounding_given_lbp).toBeUndefined();
  });

  it("wallet payout after a cash round-up: not wired, and the stale round-up is not sent", async () => {
    await openReceive("100");
    fireEvent.click(screen.getByTestId("stub-payout-roundup"));
    fireEvent.click(screen.getByTestId("stub-payout-wallet"));
    await waitFor(() =>
      expect(mockSheetProps.last?.onRoundUpChange).toBeUndefined(),
    );
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = parsedPayload();
    expect(parsed.rounding_given_usd).toBeUndefined();
    expect(parsed.rounding_given_lbp).toBeUndefined();
  });

  it("SEND: the sheet never gets onRoundUpChange", async () => {
    renderForm();
    fireEvent.change(
      document.getElementById("transfer-amount") as HTMLInputElement,
      { target: { value: "10" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");
    expect(mockSheetProps.last?.payer).not.toBe("payout");
    expect(mockSheetProps.last?.onRoundUpChange).toBeUndefined();
  });
});
