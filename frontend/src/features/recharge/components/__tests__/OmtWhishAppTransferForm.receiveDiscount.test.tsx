/**
 * LIRA-269 — OMT/Whish App RECEIVE payout sheet with a discount.
 *
 * The discount comes off the shop's fee, so the customer receives MORE. The
 * sheet's payout target, the fee to collect (customer-pays-separately) and
 * the booked `commission` all come from ONE helper (`walletReceiveAmounts`,
 * which the server pays out by). Before the fix the sheet target stayed at
 * the undiscounted payout (and the shared input then took the discount OFF
 * it), while the server paid wallet − (fee − discount): the payout was
 * refused.
 *
 * rule 25: the useApi mock returns ONE stable object, never a fresh literal.
 */

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
import { createFinancialServiceSchema } from "@liratek/core";
import { OmtWhishAppTransferForm } from "../OmtWhishAppTransferForm";

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
const mockApi = { addOMTTransaction: mockAddOMTTransaction };

interface StubSheetProps {
  open: boolean;
  totalAmount: number;
  showDiscount?: boolean;
  counterFlow?: { totalAmount: number };
  onDiscountChange?: (d: number) => void;
  onPaymentChange: (lines: unknown[]) => void;
  onConfirm: () => void;
}
const mockSheet: { last?: StubSheetProps } = {};

// PaymentSheet stub: renders its summary rows as plain text and exposes the
// discount callback through a button (the real sheet's discount input).
jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: StubSheetProps) => {
    mockSheet.last = props;
    return props.open ? (
      <div data-testid="stub-payment-sheet">
        <button
          data-testid="stub-discount"
          onClick={() => props.onDiscountChange?.(0.4)}
        />
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

function renderReceive100(separately = false) {
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
  if (separately) fireEvent.click(screen.getByTestId("fee-mode-separate"));
  fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
}

describe("OmtWhishAppTransferForm — a RECEIVE discount raises what the customer receives", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
    delete mockSheet.last;
  });

  it("Whish App $100 + $1 fee, $0.40 off → sheet pays out $100.40, books $0.60", async () => {
    renderReceive100();
    await screen.findByTestId("stub-payment-sheet");
    expect(mockSheet.last?.totalAmount).toBe(100);

    fireEvent.click(screen.getByTestId("stub-discount"));
    expect(mockSheet.last?.totalAmount).toBeCloseTo(100.4, 9);

    fireEvent.click(screen.getByTestId("stub-inject-payout"));
    fireEvent.click(screen.getByTestId("stub-confirm"));
    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(parsed.amount).toBe(101);
    expect(parsed.commission).toBeCloseTo(0.6, 9);
    expect(parsed.payments?.[0]?.amount).toBeCloseTo(100.4, 9);
  });

  it("customer pays the fee separately: payout stays $100, the fee to collect drops to $0.60", async () => {
    renderReceive100(true);
    await screen.findByTestId("stub-payment-sheet");
    expect(mockSheet.last?.counterFlow?.totalAmount).toBe(1);

    fireEvent.click(screen.getByTestId("stub-discount"));
    expect(mockSheet.last?.totalAmount).toBe(100);
    expect(mockSheet.last?.counterFlow?.totalAmount).toBeCloseTo(0.6, 9);
  });
});
