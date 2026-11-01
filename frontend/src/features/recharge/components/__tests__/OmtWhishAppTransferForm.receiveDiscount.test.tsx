/**
 * LIRA-269 — OMT/Whish App RECEIVE payout sheet with a discount.
 * LIRA-365 US2 (2026-11-01): on a WALK-IN cash-out that fee discount is
 * gone (the Discount moved into the "Customer pays" box); the cases below
 * now guard that. The history below is kept for context.
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
  counterFlow?: {
    totalAmount: number;
    seedLines?: Array<{ method: string; currencyCode: string; amount: number }>;
  };
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

// LIRA-365 US2 (owner 2026-11-01): one Discount per screen, in the box
// where the customer pays. On a walk-in cash-out that is the "Customer pays"
// box (its Discount is booked as `customer_waived_amount`), so the Shop pays
// box offers no fee Discount any more — and a stray one would change
// nothing. These two cases used to assert the LIRA-269 fee discount on a
// walk-in cash-out; they now guard that it is gone.
describe("OmtWhishAppTransferForm — a walk-in cash-out has no fee Discount (LIRA-365)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
    delete mockSheet.last;
  });

  it("Whish App $100 + $1 fee: no fee Discount; a stray one changes neither payout nor commission", async () => {
    renderReceive100();
    await screen.findByTestId("stub-payment-sheet");
    expect(mockSheet.last?.showDiscount).toBe(false);
    expect(mockSheet.last?.totalAmount).toBe(100);

    fireEvent.click(screen.getByTestId("stub-discount"));
    expect(mockSheet.last?.totalAmount).toBe(100);

    fireEvent.click(screen.getByTestId("stub-inject-payout"));
    fireEvent.click(screen.getByTestId("stub-confirm"));
    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(parsed.amount).toBe(101);
    expect(parsed.commission).toBeCloseTo(1, 9);
    expect(parsed.payments?.[0]?.amount).toBeCloseTo(100, 9);
    expect(parsed.typedDiscount).toBeUndefined();
  });

  it("customer pays the fee separately: the fee line stays $1 (the Discount is in Customer pays)", async () => {
    renderReceive100(true);
    await screen.findByTestId("stub-payment-sheet");
    expect(mockSheet.last?.showDiscount).toBe(false);
    expect(mockSheet.last?.counterFlow?.totalAmount).toBe(101);

    fireEvent.click(screen.getByTestId("stub-discount"));
    expect(mockSheet.last?.totalAmount).toBe(100);
    expect(mockSheet.last?.counterFlow?.totalAmount).toBe(101);
    expect(mockSheet.last?.counterFlow?.seedLines?.[1]).toEqual({
      method: "CASH",
      currencyCode: "USD",
      amount: 1,
    });
  });
});
