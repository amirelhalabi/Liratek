/**
 * LIRA-269 follow-up — OMT/Whish App SEND with a discount.
 *
 * The discount comes off the shop's fee: the customer pays `amount + fee −
 * discount`, the shop books `commission = fee − discount`, the wallet sends
 * the full amount. The sheet's target stays the UNDISCOUNTED total (a
 * customer-pays sheet subtracts the discount itself); `checkoutTotal` and
 * `commission` come from `walletSendAmounts`, the helper the server checks
 * the total against. Before the fix `checkoutTotal` was sent undiscounted
 * while the legs were discounted, so every discounted SEND was refused.
 *
 * Also: a fee mode left over from a RECEIVE ("deducted from payout") must
 * not leak into a SEND. (Inside a customer session the form skips the
 * payment sheet entirely, so no discount can be entered there.)
 *
 * Field names come from the core schema (rule 24); the useApi mock is one
 * stable object (rule 25).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createFinancialServiceSchema, walletSendAmounts } from "@liratek/core";
import { OmtWhishAppTransferForm } from "../OmtWhishAppTransferForm";

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
const mockApi = { addOMTTransaction: mockAddOMTTransaction };

interface StubSheetProps {
  open: boolean;
  confirmLabel?: string;
  totalAmount: number;
  showDiscount?: boolean;
  counterFlow?: { totalAmount: number };
  onDiscountChange?: (d: number) => void;
  onPaymentChange: (lines: unknown[]) => void;
  onConfirm: () => void;
}
const mockSheet: { last?: StubSheetProps; discount: number } = { discount: 0 };

// PaymentSheet stub: renders its summary rows as plain text and exposes the
// discount callback through a button (the real sheet's discount input).
jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: StubSheetProps) => {
    mockSheet.last = props;
    return props.open ? (
      <div data-testid="stub-payment-sheet">
        <button
          data-testid="stub-discount"
          onClick={() => {
            mockSheet.discount = 0.5;
            props.onDiscountChange?.(0.5);
          }}
        />
        <button
          data-testid="stub-inject-payout"
          onClick={() =>
            props.onPaymentChange([
              {
                id: "P1",
                method: "CASH",
                currencyCode: "USD",
                // A customer-pays sheet takes the discount off its target.
                amount: props.totalAmount - mockSheet.discount,
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

const mockSession: { activeSession: { id: number } | null } = {
  activeSession: null,
};
const mockLinkTransaction = jest.fn();
const mockAddToCart = jest.fn();
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: mockSession.activeSession,
    linkTransaction: mockLinkTransaction,
    addToCart: mockAddToCart,
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

function renderSend(provider: "OMT_APP" | "WHISH_APP" = "OMT_APP") {
  render(
    <OmtWhishAppTransferForm
      activeProvider={provider}
      transactions={[]}
      loadFinancialData={jest.fn()}
      formatAmount={formatAmount}
    />,
  );
}

function enterAmountAndFee(amount: string, fee: string) {
  fireEvent.change(
    document.getElementById("transfer-amount") as HTMLInputElement,
    { target: { value: amount } },
  );
  fireEvent.change(
    document.getElementById("transfer-fee") as HTMLInputElement,
    { target: { value: fee } },
  );
}

async function confirmAndParse() {
  fireEvent.click(screen.getByTestId("stub-inject-payout"));
  fireEvent.click(screen.getByTestId("stub-confirm"));
  await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
  return createFinancialServiceSchema.parse(
    mockAddOMTTransaction.mock.calls[0][0],
  );
}

describe("OmtWhishAppTransferForm — a SEND discount lowers what the customer pays and the fee booked", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
    mockAddToCart.mockClear();
    mockSession.activeSession = null;
    mockSheet.discount = 0;
    delete mockSheet.last;
  });

  it("OMT App $100 + $2 fee, $0.50 off → checkoutTotal $101.50, commission $1.50, $100 sent", async () => {
    renderSend();
    enterAmountAndFee("100", "2");
    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");
    fireEvent.click(screen.getByTestId("stub-discount"));
    // The sheet's own target stays undiscounted — it subtracts the discount.
    expect(mockSheet.last?.totalAmount).toBe(102);
    // The confirm button names what the customer really pays (added with
    // the fix — not proven failing-first).
    expect(mockSheet.last?.confirmLabel).toBe("Pay $101.50");

    const parsed = await confirmAndParse();
    const expected = walletSendAmounts({
      walletOutflow: 100,
      fee: 2,
      discount: 0.5,
    });
    expect(parsed.amount).toBe(100);
    expect(parsed.commission).toBe(expected.commission);
    expect(parsed.checkoutTotal).toEqual({
      usd: expected.customerPays,
      lbp: 0,
    });
    expect(parsed.payments?.[0]?.amount).toBe(expected.customerPays);
  });

  it("no discount: unchanged — checkoutTotal $102, commission $2", async () => {
    renderSend("OMT_APP");
    enterAmountAndFee("100", "2");
    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");
    const parsed = await confirmAndParse();
    expect(parsed.commission).toBe(2);
    expect(parsed.checkoutTotal).toEqual({ usd: 102, lbp: 0 });
  });

  it("a 'deducted from payout' fee mode left over from a RECEIVE no longer nets the fee out of what the SEND sends", async () => {
    // Whish App: the fee input and "deducted" exist only on a RECEIVE, and
    // both survive a switch to SEND (only the provider switch resets them).
    renderSend("WHISH_APP");
    fireEvent.click(screen.getByRole("button", { name: /Receive/i }));
    enterAmountAndFee("100", "2");
    fireEvent.click(screen.getByTestId("fee-mode-deducted"));
    fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");
    const parsed = await confirmAndParse();
    // What is sent + the fee booked must be exactly what the customer pays.
    expect(parsed.amount + (parsed.commission ?? 0)).toBe(
      parsed.checkoutTotal?.usd,
    );
    expect(parsed.amount).toBe(100);
  });
});
