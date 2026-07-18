/** @jest-environment jsdom */

/**
 * OmtWhishAppTransferForm — USD/LBP toggle → payment section currency guard.
 *
 * The bug this guards: the form's USD/LBP toggle denominates the entered
 * amount (and its fee), but the PaymentSheet invocation hardcoded
 * `currency="USD"` and omitted `totalAmountCurrency`, so a 420,000 LBP
 * transfer showed "$420,000" as the payment total (and split legs were
 * matched against a fake USD total). The sticky bottom bar and the sheet's
 * subtitle/confirm/summary rows had the same hardcoded "$".
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { OmtWhishAppTransferForm } from "../OmtWhishAppTransferForm";

// ── Capture the props the form feeds PaymentSheet ──
jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: {
    totalAmount?: number;
    totalAmountCurrency?: string;
    currency?: string;
    subtitle?: string;
    confirmLabel?: string;
  }) => (
    <div data-testid="payment-sheet-props">
      {JSON.stringify({
        totalAmount: props.totalAmount,
        totalAmountCurrency: props.totalAmountCurrency,
        currency: props.currency,
        subtitle: props.subtitle,
        confirmLabel: props.confirmLabel,
      })}
    </div>
  ),
}));

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    addOMTTransaction: jest.fn().mockResolvedValue({ success: true, id: 1 }),
  }),
  // Plain input stand-in so fireEvent.change drives the amount state.
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

// Currency-aware formatter matching CurrencyContext.formatAmount's shape.
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
      activeProvider="OMT_APP"
      transactions={[]}
      loadFinancialData={jest.fn()}
      formatAmount={formatAmount}
    />,
  );
}

const readSheetProps = () =>
  JSON.parse(screen.getByTestId("payment-sheet-props").textContent || "{}");

describe("OmtWhishAppTransferForm — LBP toggle currency propagation", () => {
  it("passes the toggle currency to the PaymentSheet totals", () => {
    renderForm();

    // Default USD mode sanity check.
    const amountInput = document.getElementById(
      "transfer-amount",
    ) as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: "100" } });
    expect(readSheetProps()).toMatchObject({
      totalAmount: 100,
      totalAmountCurrency: "USD",
      currency: "USD",
    });

    // LBP mode: the payment sheet must be told the total is LBP.
    fireEvent.click(screen.getByRole("button", { name: "LBP" }));
    fireEvent.change(
      document.getElementById("transfer-amount") as HTMLInputElement,
      { target: { value: "420000" } },
    );
    expect(readSheetProps()).toMatchObject({
      totalAmount: 420000,
      totalAmountCurrency: "LBP",
      currency: "LBP",
    });
  });

  it("renders LBP amounts without a hardcoded $ in the bar, subtitle and confirm label", () => {
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "LBP" }));
    fireEvent.change(
      document.getElementById("transfer-amount") as HTMLInputElement,
      { target: { value: "420000" } },
    );

    // Sticky bottom bar total.
    expect(screen.getByText("420,000 LBP")).toBeInTheDocument();
    expect(screen.queryByText("$420000.00")).not.toBeInTheDocument();

    // PaymentSheet subtitle + confirm label.
    const sheet = readSheetProps();
    expect(sheet.subtitle).toContain("420,000 LBP");
    expect(sheet.subtitle).not.toContain("$");
    expect(sheet.confirmLabel).toBe("Pay 420,000 LBP");
  });
});
