/**
 * LIRA-329 T019 — an OMT App / Whish App transfer sends what the
 * transaction keeps in its details: the discount exactly as typed and who
 * pays the fee. Harness copied from
 * OmtWhishAppTransferForm.sendDiscount.test.tsx (stub PaymentSheet with a
 * discount button; one stable useApi object, rule 25).
 *
 * Field names come from the core schema (rule 24): the payload is parsed
 * through `createFinancialServiceSchema`, which strips undeclared keys.
 *
 * Rule 17: run against the unchanged form first — the typed-discount
 * assertion failed (absent). The fee-payer assertion passed already: it is
 * derived inside core's shared `buildWalletTransferPayload`, changed before
 * this file was written (not proven failing-first).
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

describe("OmtWhishAppTransferForm — LIRA-329 details fields", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
    mockAddToCart.mockClear();
    mockSession.activeSession = null;
    mockSheet.discount = 0;
    delete mockSheet.last;
  });

  it("a discounted OMT App send keeps the discount as typed and who pays the fee", async () => {
    renderSend();
    enterAmountAndFee("100", "2");
    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");
    fireEvent.click(screen.getByTestId("stub-discount"));
    const parsed = await confirmAndParse();
    expect(parsed.typedDiscount).toEqual({ amount: 0.5, currency: "USD" });
    expect(parsed.feePaidBy).toBe("SENDER");
  });

  it("no discount: no typed discount is sent", async () => {
    renderSend();
    enterAmountAndFee("100", "2");
    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");
    const parsed = await confirmAndParse();
    expect(parsed.typedDiscount).toBeUndefined();
  });
});
