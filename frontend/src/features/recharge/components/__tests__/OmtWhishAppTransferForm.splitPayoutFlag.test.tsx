/** @jest-environment jsdom */

/**
 * LIRA-391 — OMT App / Whish App cash-out (RECEIVE): `cashoutMethod` follows
 * ALL the payout lines (`lumpMethodOf`), not the last time the sheet had one
 * line. Before: `setCashoutMethod(lines[0].method)` ran only at one line and
 * the flag was always sent on RECEIVE, so a seeded Customer Account line
 * followed by a second line kept `cashoutMethod: "CUSTOMER_ACCOUNT"` next to
 * the split legs.
 *
 * Real form, PaymentSheet stubbed. Field names from the core schema's input
 * type (rule 24); stable module-level useApi mock (rule 25).
 *
 * Rule 17 — run on 2026-11-14 against the unfixed form: the split case
 * FAILED (received "CUSTOMER_ACCOUNT"); the single-line cases passed.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { CreateFinancialServiceInput } from "@liratek/core";
import { OmtWhishAppTransferForm } from "../OmtWhishAppTransferForm";

const CASHOUT_KEY: keyof CreateFinancialServiceInput = "cashoutMethod";
const PAYMENTS_KEY: keyof CreateFinancialServiceInput = "payments";

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
// Stable reference (rule 25).
const mockApi = { addOMTTransaction: mockAddOMTTransaction };

const mockSheetProps: { last?: Record<string, unknown> } = {};
jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: {
    open: boolean;
    onPaymentChange: (lines: unknown[]) => void;
    onConfirm: () => void;
  }) => {
    mockSheetProps.last = props as unknown as Record<string, unknown>;
    const l = (id: string, method: string, amount: number) => ({
      id,
      method,
      currencyCode: "USD",
      amount,
    });
    return props.open ? (
      <div data-testid="stub-payment-sheet">
        <button
          data-testid="lines-account"
          onClick={() => props.onPaymentChange([l("L1", "CUSTOMER_ACCOUNT", 100)])}
        />
        <button
          data-testid="lines-account-plus-cash"
          onClick={() =>
            props.onPaymentChange([
              l("L1", "CUSTOMER_ACCOUNT", 40),
              l("L2", "CASH", 60),
            ])
          }
        />
        <button
          data-testid="lines-cash"
          onClick={() => props.onPaymentChange([l("L1", "CASH", 100)])}
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

const mockMethods = [
  { code: "CASH", label: "Cash" },
  { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
];
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: mockMethods,
    drawerAffectingMethods: mockMethods,
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

async function openReceiveSheet() {
  renderForm();
  fireEvent.click(screen.getByRole("button", { name: /Receive/i }));
  fireEvent.change(
    document.getElementById("transfer-amount") as HTMLInputElement,
    { target: { value: "100" } },
  );
  fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
  await screen.findByTestId("stub-payment-sheet");
  await waitFor(() => expect(mockSheetProps.last?.payer).toBe("payout"));
}

async function submitted(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByTestId("stub-confirm"));
  await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
  return mockAddOMTTransaction.mock.calls[0][0] as Record<string, unknown>;
}

describe("OMT App / Whish App cash-out — the lump payout method follows ALL the lines (LIRA-391)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
    delete mockSheetProps.last;
  });

  it("account line seeded, then split Account + Cash → no cashoutMethod, both legs sent", async () => {
    await openReceiveSheet();
    fireEvent.click(screen.getByTestId("lines-account"));
    fireEvent.click(screen.getByTestId("lines-account-plus-cash"));
    const payload = await submitted();
    expect(payload[CASHOUT_KEY]).toBeUndefined();
    expect(payload[PAYMENTS_KEY]).toEqual([
      expect.objectContaining({ method: "CUSTOMER_ACCOUNT", amount: 40 }),
      expect.objectContaining({ method: "CASH", amount: 60 }),
    ]);
  });

  it("a single Customer Account line → cashoutMethod CUSTOMER_ACCOUNT", async () => {
    await openReceiveSheet();
    fireEvent.click(screen.getByTestId("lines-account"));
    const payload = await submitted();
    expect(payload[CASHOUT_KEY]).toBe("CUSTOMER_ACCOUNT");
  });

  it("account line seeded, then a single Cash line → cashoutMethod CASH", async () => {
    await openReceiveSheet();
    fireEvent.click(screen.getByTestId("lines-account"));
    fireEvent.click(screen.getByTestId("lines-cash"));
    const payload = await submitted();
    expect(payload[CASHOUT_KEY]).toBe("CASH");
  });
});
