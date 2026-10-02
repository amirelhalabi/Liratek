/** @jest-environment jsdom */

/**
 * OmtWhishAppTransferForm — the payment sheet's "Shop Profit" line must show
 * the profit AFTER the operator's discount (LIRA-185 display lead 9).
 *
 * The bug this guards: the form books `commission: max(0, shopProfit -
 * discount)` (the stamp `transactions.profit_usd` and the Profits page both
 * read that figure), but the PaymentSheet summary row printed the GROSS
 * `shopProfit`. A Whish App RECEIVE of $100 (auto fee $1.00) with a $0.40
 * discount promised "$1.00" of shop profit on the confirm sheet while $0.60
 * was booked.
 *
 * rule 25: the useApi mock returns ONE stable object, never a fresh literal.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OmtWhishAppTransferForm } from "../OmtWhishAppTransferForm";

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
const mockApi = { addOMTTransaction: mockAddOMTTransaction };

interface StubSummaryLine {
  label: string;
  value: string;
}

// PaymentSheet stub: renders its summary rows as plain text and exposes the
// discount callback through a button (the real sheet's discount input).
jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: {
    open: boolean;
    summary?: StubSummaryLine[];
    onDiscountChange?: (d: number) => void;
    onPaymentChange: (lines: unknown[]) => void;
    onConfirm: () => void;
  }) =>
    props.open ? (
      <div data-testid="stub-payment-sheet">
        {(props.summary ?? []).map((line) => (
          <div key={line.label} data-testid={`summary-${line.label}`}>
            {line.value}
          </div>
        ))}
        <button
          data-testid="stub-discount"
          onClick={() => props.onDiscountChange?.(0.4)}
        />
        <button
          data-testid="stub-inject-payout"
          onClick={() =>
            props.onPaymentChange([
              { id: "P1", method: "CASH", currencyCode: "USD", amount: 100 },
            ])
          }
        />
        <button data-testid="stub-confirm" onClick={props.onConfirm} />
      </div>
    ) : null,
}));

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  DecimalInput: ({
    id,
    value,
    onChange,
  }: {
    id?: string;
    value: number;
    onChange: (n: number) => void;
  }) => (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={value === 0 ? "" : String(value)}
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

describe("OmtWhishAppTransferForm — Shop Profit line is net of discount", () => {
  beforeEach(() => mockAddOMTTransaction.mockClear());

  it("shows $0.60 (not the gross $1.00) after a $0.40 discount, matching the booked commission", async () => {
    render(
      <OmtWhishAppTransferForm
        activeProvider="WHISH_APP"
        transactions={[]}
        loadFinancialData={jest.fn()}
        formatAmount={formatAmount}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Receive/i }));
    fireEvent.change(
      document.getElementById("transfer-amount") as HTMLInputElement,
      { target: { value: "100" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");

    // Before any discount: gross = net = $1.00.
    expect(screen.getByTestId("summary-Shop Profit")).toHaveTextContent(
      "$1.00",
    );

    fireEvent.click(screen.getByTestId("stub-discount"));
    expect(screen.getByTestId("summary-Shop Profit")).toHaveTextContent(
      "$0.60",
    );

    // The displayed figure is the one that gets booked.
    fireEvent.click(screen.getByTestId("stub-inject-payout"));
    fireEvent.click(screen.getByTestId("stub-confirm"));
    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const payload = mockAddOMTTransaction.mock.calls[0][0] as {
      commission: number;
    };
    expect(payload.commission).toBeCloseTo(0.6, 4);
  });
});
