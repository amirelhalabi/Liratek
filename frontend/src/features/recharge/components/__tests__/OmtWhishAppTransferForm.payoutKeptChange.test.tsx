/** @jest-environment jsdom */

/**
 * OMT App / Whish App RECEIVE is a PAYOUT (the shop pays the customer cash
 * for money received into its wallet). Owner decisions 2026-10-07
 * (FEATURE_GUIDE §4.1 "Kept change"): the RECEIVE payment sheet runs in
 * `payer="payout"` mode — no change (OUT) legs, even ones left in state by an
 * earlier SEND; a small shortfall rides the SAME payload as `kept_change_*`
 * (FinancialServiceRepository verifies it).
 *
 * Real form, PaymentSheet stubbed. Payload parsed through the core schema
 * (rule 24). Rule 17: run against the pre-change form first — see the task
 * report.
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
    onReturnChange?: (legs: unknown[]) => void;
    onKeptChange?: (kept: { usd: number; lbp: number } | null) => void;
    onConfirm: () => void;
  }) => {
    mockSheetProps.last = props as unknown as Record<string, unknown>;
    return props.open ? (
      <div data-testid="stub-payment-sheet">
        {/* Change handed back on an earlier SEND (customer overpaid). */}
        <button
          data-testid="stub-send-change"
          onClick={() =>
            props.onReturnChange?.([
              {
                id: "R1",
                method: "CASH",
                currencyCode: "USD",
                amount: 5,
                direction: "OUT",
              },
            ])
          }
        />
        {/* Payout $99.50 of the $100 owed, keeping $0.50. */}
        <button
          data-testid="stub-payout-short"
          onClick={() => {
            props.onPaymentChange([
              { id: "L1", method: "CASH", currencyCode: "USD", amount: 99.5 },
            ]);
            props.onKeptChange?.({ usd: 0.5, lbp: 0 });
          }}
        />
        {/* SEND under-return: customer-mode kept change. */}
        <button
          data-testid="stub-send-kept"
          onClick={() => props.onKeptChange?.({ usd: 4, lbp: 0 })}
        />
        {/* Exact payout of the $100 owed — nothing kept. */}
        <button
          data-testid="stub-payout-exact"
          onClick={() =>
            props.onPaymentChange([
              { id: "L1", method: "CASH", currencyCode: "USD", amount: 100 },
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

describe("OmtWhishAppTransferForm — RECEIVE is a payout", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
    delete mockSheetProps.last;
  });

  it("RECEIVE: payout sheet, kept change sent, no stale change leg", async () => {
    renderForm();
    // An earlier SEND on the same form left change legs in state.
    fireEvent.change(
      document.getElementById("transfer-amount") as HTMLInputElement,
      { target: { value: "10" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");
    expect(mockSheetProps.last?.payer).not.toBe("payout");
    fireEvent.click(screen.getByTestId("stub-send-change"));

    fireEvent.click(screen.getByRole("button", { name: /Receive/i }));
    fireEvent.change(
      document.getElementById("transfer-amount") as HTMLInputElement,
      { target: { value: "100" } },
    );
    await waitFor(() => expect(mockSheetProps.last?.payer).toBe("payout"));
    expect(mockSheetProps.last?.onReturnChange).toBeUndefined();
    expect(typeof mockSheetProps.last?.onKeptChange).toBe("function");

    fireEvent.click(screen.getByTestId("stub-payout-short"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(parsed.serviceType).toBe("RECEIVE");
    expect(parsed.kept_change_usd).toBe(0.5);
    expect(parsed.payments).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 99.5 }),
    ]);
    expect((parsed.payments ?? []).some((l) => l.direction === "OUT")).toBe(
      false,
    );
  });

  it("RECEIVE after a SEND under-return: the SEND's kept change is not sent on an exact payout", async () => {
    renderForm();
    fireEvent.change(
      document.getElementById("transfer-amount") as HTMLInputElement,
      { target: { value: "10" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");
    fireEvent.click(screen.getByTestId("stub-send-kept"));

    fireEvent.click(screen.getByRole("button", { name: /Receive/i }));
    fireEvent.change(
      document.getElementById("transfer-amount") as HTMLInputElement,
      { target: { value: "100" } },
    );
    await waitFor(() => expect(mockSheetProps.last?.payer).toBe("payout"));
    fireEvent.click(screen.getByTestId("stub-payout-exact"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(parsed.kept_change_usd ?? 0).toBe(0);
    expect(parsed.kept_change_lbp ?? 0).toBe(0);
  });
});
